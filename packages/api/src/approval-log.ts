// The approval log: each sponsor's decisions on their agents' sends, newest first, read from the
// listings in their partition (decisions.ts), each with what became of it, from its approval record
// and its draft while the draft is still the one it decided. Decisions made before the log existed
// are listed by setup, once, from the change feeds that recorded them.
import { GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { components } from "@duva/openapi";
import { type OperationHandler, refusal } from "./api.ts";
import type { Table } from "./deployment.ts";
import { type Decision, decisionKey, decisionPrefix, listDecision } from "./decisions.ts";
import { asAsked, findDraft, storedApproval, undoable } from "./drafting.ts";
import type { Feed } from "./feed.ts";
import { allMailboxes, findActor, mailboxFeed } from "./organization.ts";
import { documents, pk, sk } from "./table.ts";

type Entry = components["schemas"]["ApprovalLogEntry"];

/** How many entries a page of the log lists, unless the call asks for fewer or more. */
const entriesPerPage = 50;
const entriesAtMost = 100;

export const listApprovalLog: OperationHandler = async (event, deployment, actor) => {
  const query = event.queryStringParameters ?? {};
  const limit = query.limit ?? String(entriesPerPage);
  if (!/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > entriesAtMost) {
    return refusal(400, `${JSON.stringify(limit)} isn't a limit Duva takes. Give limit as a whole number from 1 to ${entriesAtMost}.`);
  }
  const after = query.after === undefined ? undefined : Buffer.from(query.after, "base64url").toString();
  if (after !== undefined && !after.startsWith(decisionPrefix)) {
    return refusal(400, `${JSON.stringify(query.after)} isn't where a page starts. Give after as the next of the page before, or leave it out for the first page.`);
  }
  const partition = decisionKey(actor!.id, "", "")[pk];
  const entries: Entry[] = [];
  let start: Record<string, unknown> | undefined = after === undefined ? undefined : { [pk]: partition, [sk]: after };
  let next: string | undefined;
  // A listing whose approval erasure took meanwhile has no entry, so a page reads on until it is full.
  do {
    const page = await documents(deployment.table).send(
      new QueryCommand({
        TableName: deployment.table.name,
        KeyConditionExpression: `${pk} = :approver AND begins_with(${sk}, :decided)`,
        ExpressionAttributeValues: { ":approver": partition, ":decided": decisionPrefix },
        ScanIndexForward: false,
        Limit: Number(limit) - entries.length,
        ExclusiveStartKey: start,
      }),
    );
    for (const item of page.Items ?? []) {
      const entry = await entryOf(deployment.table, item as Decision);
      if (entry !== undefined) entries.push(entry);
      next = item[sk] as string;
    }
    start = page.LastEvaluatedKey;
  } while (start !== undefined && entries.length < Number(limit));
  // DynamoDB says where a full page stopped even when nothing follows, so the next page may be empty.
  return {
    statusCode: 200,
    body: { entries, ...(start !== undefined && next !== undefined && { next: Buffer.from(next).toString("base64url") }) } satisfies components["schemas"]["ApprovalLog"],
  };
};

/** The log's entry for the decision, with what became of it, or undefined if its approval record was erased. */
async function entryOf(table: Table, decision: Decision): Promise<Entry | undefined> {
  const { approval: id, agent, agentName, decidedBy, decidedAt } = decision;
  const base = { approval: id, agent, agentName, decidedBy, decidedAt };
  const approval = await storedApproval(table, id);
  if (approval === undefined || (approval.state !== "approved" && approval.state !== "rejected")) return undefined;
  const draft = await findDraft(table, approval.mailbox, approval.draft.id);
  // The draft's send is this decision's until the agent asks again.
  const send = draft?.send?.approval === id ? draft.send : undefined;
  const asked = approval.draft;
  const sent = { subject: approval.edits?.subject ?? asked.subject, to: approval.edits?.to ?? asked.to, cc: asked.cc };
  const thread = approval.outcome?.thread ?? send?.thread ?? asked.thread;
  const common = { ...base, mailbox: approval.mailbox, draft: asked.id, ...sent, ...(thread !== undefined && { thread }) };
  if (approval.state === "rejected") {
    const afterAll = send?.state === "rejected" && asAsked(draft!, approval);
    return { ...common, outcome: "rejected", ...(approval.note !== undefined && { note: approval.note }), ...(afterAll && { reversal: "sendAfterAll" }) };
  }
  const outcome = approval.outcome ?? (send?.state === "sent" || send?.state === "failed" || send?.state === "unclear" ? { state: send.state, message: send.message, reason: send.reason } : undefined);
  if (outcome !== undefined) {
    return {
      ...common,
      outcome: outcome.state,
      ...(outcome.message !== undefined && { message: outcome.message }),
      ...(outcome.reason !== undefined && { reason: outcome.reason }),
      ...(outcome.state === "sent" && { reversal: "correction" }),
    };
  }
  return { ...common, outcome: "approved", ...(undoable(send) && { undoUntil: send.undoUntil, reversal: "undo" }) };
}

// Setup lists the decisions made before the log existed once, and marks that it did.
const listedKey = { [pk]: "organization", [sk]: "approvalLog" };

/**
 * Lists in their approvers' logs the decisions the change feeds recorded before the log existed,
 * those whose approval records are kept. Run again, it lists the same, so one that stopped partway
 * is finished by the next setup, and once it finished, it does nothing.
 */
export async function listEarlierDecisions(table: Table): Promise<void> {
  const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: listedKey, ConsistentRead: true }));
  if (Item !== undefined) return;
  const names = new Map<string, string>();
  const nameOf = async (agent: string) => {
    if (!names.has(agent)) {
      const found = await findActor(table, agent);
      names.set(agent, found?.kind === "agent" ? found.name : "");
    }
    return names.get(agent)!;
  };
  const list = async (approver: string, decision: Omit<Decision, "agentName">) =>
    documents(table).send(new PutCommand(listDecision(table, approver, { ...decision, agentName: await nameOf(decision.agent) }).Put!));
  for (const mailbox of await allMailboxes(table)) {
    for (const id of await approvalsDecidedIn(table, mailboxFeed(mailbox))) {
      const approval = await storedApproval(table, id);
      if (approval?.decidedAt === undefined || (approval.state !== "approved" && approval.state !== "rejected")) continue;
      await list(approval.approver, { approval: id, agent: approval.agent, decidedBy: approval.approver, decidedAt: approval.decidedAt });
    }
  }
  await documents(table).send(new PutCommand({ TableName: table.name, Item: listedKey }));
}

/** The IDs of the approvals whose decisions the feed records, each once. */
async function approvalsDecidedIn(table: Table, feed: Feed): Promise<Set<string>> {
  const ids = new Set<string>();
  let start: Record<string, unknown> | undefined;
  do {
    const page = await documents(table).send(
      new QueryCommand({
        TableName: table.name,
        KeyConditionExpression: `${pk} = :feed`,
        FilterExpression: "#type = :decided",
        ExpressionAttributeNames: { "#type": "type" },
        ExpressionAttributeValues: { ":feed": feed.partition, ":decided": "approvalDecided" },
        ProjectionExpression: "approval",
        ExclusiveStartKey: start,
      }),
    );
    for (const { approval } of page.Items ?? []) ids.add(approval as string);
    start = page.LastEvaluatedKey;
  } while (start !== undefined);
  return ids;
}
