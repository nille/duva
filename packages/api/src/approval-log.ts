// The approval log: each sponsor's decisions on their agents' sends, newest first, read from the
// listings in their partition (decisions.ts), each with what became of it, from its approval record
// and its draft while the draft is still the one it decided. Each human's decisions on their Coo's
// payments are among them, with what became of each from the payment as it stands (#186).
// Decisions made before the log listed them are listed by setup, once, from the change feeds that
// recorded them.
import { GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { components } from "@duva/openapi";
import { type OperationHandler, refusal } from "./operation-handler.ts";
import type { Table } from "./deployment.ts";
import { type Decision, decisionKey, decisionPrefix, listDecision } from "./decisions.ts";
import { asAsked, findDraft, storedApproval, undoable } from "./drafting.ts";
import type { Feed } from "./feed.ts";
import { allHumans, allMailboxes, findActor, mailboxFeed } from "./organization.ts";
import { decidedPayments, findPayment } from "./payments.ts";
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
  // A listing whose approval erasure took meanwhile, or whose payment went with its card, has no
  // entry, so a page reads on until it is full.
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
      const entry = await entryOf(deployment.table, actor!.id, item as Decision);
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

/** The approver's log's entry for the decision, with what became of it, or undefined if its approval record was erased, or its payment went with its card. */
async function entryOf(table: Table, approver: string, decision: Decision): Promise<Entry | undefined> {
  if ("payment" in decision) return paymentEntryOf(table, approver, decision);
  const { approval: id, agent, agentName, decidedBy, decidedAt } = decision;
  const base = { kind: "send" as const, approval: id, agent, agentName, decidedBy, decidedAt };
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

/** The human's log's entry for their decision on their Coo's payment, as the payment stands now. */
async function paymentEntryOf(table: Table, human: string, { payment: id, agent, agentName, decidedBy, decidedAt }: Extract<Decision, { payment: string }>): Promise<Entry | undefined> {
  const payment = await findPayment(table, human, id);
  if (payment === undefined || payment.state === "waiting") return undefined;
  const { state, cardName, site, amount, currency, for: what, mailbox, paidAt, notMade } = payment;
  // One the run that went back couldn't pay stays approved, for a run of the turn or task that asked, until it lapses.
  const outcome = state === "approved" && notMade !== undefined ? "notMade" : state;
  return {
    kind: "payment",
    payment: id,
    agent,
    agentName,
    decidedBy,
    decidedAt,
    outcome,
    cardName,
    site,
    amount,
    currency,
    for: what,
    mailbox,
    ...(paidAt !== undefined && { paidAt }),
    ...(notMade !== undefined && { notMade }),
  };
}

// Setup lists the decisions made before the log listed them once, and marks that it did: those on
// sends, and apart, those on payments, which the log lists since #186.
const listedKey = { [pk]: "organization", [sk]: "approvalLog" };
const paymentsListedKey = { [pk]: "organization", [sk]: "approvalLog#payments" };

/**
 * Lists in their approvers' logs the decisions made before the log listed them: those on sends the
 * change feeds recorded, whose approval records are kept, and each human's on their Coo's payments.
 * Run again, it lists the same, so one that stopped partway is finished by the next setup, and once
 * it finished, it does nothing.
 */
export async function listEarlierDecisions(table: Table): Promise<void> {
  const names = new Map<string, string>();
  const nameOf = async (agent: string) => {
    if (!names.has(agent)) {
      const found = await findActor(table, agent);
      names.set(agent, found?.kind === "agent" ? found.name : "");
    }
    return names.get(agent)!;
  };
  const list = async (approver: string, decision: Decision) =>
    documents(table).send(new PutCommand(listDecision(table, approver, { ...decision, agentName: await nameOf(decision.agent) }).Put!));
  await once(table, listedKey, async () => {
    for (const mailbox of await allMailboxes(table)) {
      for (const id of await approvalsDecidedIn(table, mailboxFeed(mailbox))) {
        const approval = await storedApproval(table, id);
        if (approval?.decidedAt === undefined || (approval.state !== "approved" && approval.state !== "rejected")) continue;
        await list(approval.approver, { approval: id, agent: approval.agent, agentName: "", decidedBy: approval.approver, decidedAt: approval.decidedAt });
      }
    }
  });
  await once(table, paymentsListedKey, async () => {
    // Each human decides only their own Coo's payments.
    for (const { id: human } of await allHumans(table)) {
      for (const { id, agent, decidedAt } of await decidedPayments(table, human)) await list(human, { payment: id, agent, agentName: "", decidedBy: human, decidedAt: decidedAt! });
    }
  });
}

/** Does the work unless the marker says it was done, then marks that it was. */
async function once(table: Table, marker: Record<string, unknown>, work: () => Promise<void>): Promise<void> {
  const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: marker, ConsistentRead: true }));
  if (Item !== undefined) return;
  await work();
  await documents(table).send(new PutCommand({ TableName: table.name, Item: marker }));
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
