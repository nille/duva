// Drafts and the approvals their sends wait for. A draft is in its mailbox's partition. An approval
// has its own partition, so a decision finds it by ID alone, and while it is pending its approver's
// partition lists a copy, so an approver's pending approvals are one query away. Each step is
// written in one transaction with its entry in the mailbox's change feed.
import { randomUUID } from "node:crypto";
import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { components } from "@duva/openapi";
import type { Table } from "./deployment.ts";
import { recordChanges } from "./feed.ts";
import { mailboxFeed } from "./mail.ts";
import { type Agent, mailboxKey } from "./organization.ts";
import { documents, isNew, pk, sk, type TransactItem } from "./table.ts";

export type Draft = components["schemas"]["Draft"];
export type Approval = components["schemas"]["Approval"];
type DraftContent = Omit<Draft, "id" | "updatedAt" | "send">;
/** A draft as stored, with the count of its writes, which each write checks, so of two at once one retries. */
type StoredDraft = Draft & { version: number };

const draftKey = (mailbox: string, draft: string) => ({ [pk]: mailboxKey(mailbox)[pk]!, [sk]: `draft#${draft}` });
const approvalKey = (approval: string) => ({ [pk]: `approval#${approval}`, [sk]: "approval" });
// While an approval is pending, its approver's partition holds a copy, sorted by when it was asked for.
const pendingPrefix = "pending#";
const pendingKey = (approver: string, askedAt: string, approval: string) => ({ [pk]: `actor#${approver}`, [sk]: `${pendingPrefix}${askedAt}#${approval}` });

/** The draft already waits for an approval. */
export class AlreadyWaiting extends Error {}

/** The approval was decided, or withdrawn, before this decision. */
export class AlreadyDecided extends Error {
  readonly approval: Approval;
  constructor(approval: Approval) {
    super(`The approval is ${approval.state}.`);
    this.approval = approval;
  }
}

/** Writes a new draft in the mailbox, on behalf of the actor `by`. */
export async function addDraft(table: Table, { mailbox, by, content }: { mailbox: string; by: string; content: DraftContent }): Promise<Draft> {
  const draft: Draft = { id: randomUUID(), ...content, updatedAt: new Date().toISOString() };
  await recordChanges(table, mailboxFeed(mailbox), {
    by,
    changes: [{ type: "draftWritten", draft: draft.id }],
    items: [{ Put: { TableName: table.name, Item: { ...draftKey(mailbox, draft.id), ...draft, version: 1 }, ...isNew } }],
  });
  return draft;
}

/** The draft with the ID in the mailbox, or undefined if it has none. */
export async function findDraft(table: Table, mailbox: string, id: string): Promise<Draft | undefined> {
  const stored = await storedDraft(table, mailbox, id);
  return stored && draftOf(stored);
}

async function storedDraft(table: Table, mailbox: string, id: string): Promise<StoredDraft | undefined> {
  const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: draftKey(mailbox, id), ConsistentRead: true }));
  return Item as StoredDraft | undefined;
}

/** The mailbox's drafts, the most recently written or changed first. */
export async function draftsIn(table: Table, mailbox: string): Promise<Draft[]> {
  const drafts: Draft[] = [];
  let start: Record<string, unknown> | undefined;
  do {
    const page = await documents(table).send(
      new QueryCommand({
        TableName: table.name,
        KeyConditionExpression: `${pk} = :mailbox AND begins_with(${sk}, :draft)`,
        ExpressionAttributeValues: { ":mailbox": mailboxKey(mailbox)[pk], ":draft": draftKey(mailbox, "")[sk] },
        ExclusiveStartKey: start,
      }),
    );
    for (const item of page.Items ?? []) drafts.push(draftOf(item as Draft));
    start = page.LastEvaluatedKey;
  } while (start !== undefined);
  return drafts.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * Changes the draft, on behalf of the actor `by`. If it waits for an approval, the change
 * withdraws it, so the approver never decides on text they didn't see. Returns undefined if the
 * mailbox has no such draft.
 */
export async function changeDraft(
  table: Table,
  { mailbox, id, by, changes }: { mailbox: string; id: string; by: string; changes: Partial<Pick<Draft, "to" | "subject" | "text">> },
): Promise<Draft | undefined> {
  return retried(async () => {
    const draft = await storedDraft(table, mailbox, id);
    if (draft === undefined) return undefined;
    const waiting = draft.send?.state === "waiting" ? draft.send : undefined;
    const changed: StoredDraft = {
      ...draft,
      ...Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined)),
      updatedAt: new Date().toISOString(),
      send: waiting ? { approval: waiting.approval, state: "withdrawn" } : draft.send,
      version: draft.version + 1,
    };
    const items: TransactItem[] = [{ Put: { TableName: table.name, Item: { ...draftKey(mailbox, id), ...changed }, ...unchanged(draft) } }];
    if (waiting !== undefined) {
      const approval = await findApproval(table, waiting.approval);
      if (approval === undefined) throw new Error(`The approval ${waiting.approval} that draft ${id} waits for is missing.`);
      items.push(...settle(table, approval, { state: "withdrawn" }));
    }
    await recordChanges(table, mailboxFeed(mailbox), {
      by,
      changes: [{ type: "draftChanged", draft: id }, ...(waiting ? [{ type: "approvalWithdrawn", draft: id, approval: waiting.approval }] : [])],
      items,
    });
    return draftOf(changed);
  });
}

/**
 * Asks for the draft to be sent, on behalf of the agent that owns its mailbox, which needs the
 * agent's sponsor's approval. Throws AlreadyWaiting if it already waits for one. Returns undefined
 * if the mailbox has no such draft.
 */
export async function askToSend(table: Table, { mailbox, id, agent }: { mailbox: string; id: string; agent: Agent }): Promise<Draft | undefined> {
  return retried(async () => {
    const draft = await storedDraft(table, mailbox, id);
    if (draft === undefined) return undefined;
    if (draft.send?.state === "waiting") throw new AlreadyWaiting();
    const approval: Approval = {
      id: randomUUID(),
      state: "pending",
      mailbox,
      agent: agent.id,
      approver: agent.sponsor,
      draft: approvalDraftOf(draft),
      askedAt: new Date().toISOString(),
    };
    const asked: StoredDraft = { ...draft, send: { approval: approval.id, state: "waiting" }, version: draft.version + 1 };
    await recordChanges(table, mailboxFeed(mailbox), {
      by: agent.id,
      changes: [{ type: "approvalAsked", draft: id, approval: approval.id }],
      items: [
        { Put: { TableName: table.name, Item: { ...draftKey(mailbox, id), ...asked }, ...unchanged(draft) } },
        { Put: { TableName: table.name, Item: { ...approvalKey(approval.id), ...approval }, ...isNew } },
        { Put: { TableName: table.name, Item: { ...pendingKey(approval.approver, approval.askedAt, approval.id), ...approval }, ...isNew } },
      ],
    });
    return draftOf(asked);
  });
}

/** The approval with the ID, or undefined if there is none. */
export async function findApproval(table: Table, id: string): Promise<Approval | undefined> {
  const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: approvalKey(id), ConsistentRead: true }));
  return Item && approvalOf(Item as Approval);
}

/** The approvals pending for the approver, newest first. */
export async function pendingApprovals(table: Table, approver: string): Promise<Approval[]> {
  const { [pk]: partition } = pendingKey(approver, "", "");
  const approvals: Approval[] = [];
  let start: Record<string, unknown> | undefined;
  do {
    const page = await documents(table).send(
      new QueryCommand({
        TableName: table.name,
        KeyConditionExpression: `${pk} = :approver AND begins_with(${sk}, :approval)`,
        ExpressionAttributeValues: { ":approver": partition, ":approval": pendingPrefix },
        ScanIndexForward: false,
        ExclusiveStartKey: start,
      }),
    );
    for (const item of page.Items ?? []) approvals.push(approvalOf(item as Approval));
    start = page.LastEvaluatedKey;
  } while (start !== undefined);
  return approvals;
}

/**
 * Rejects the pending approval with the note, on behalf of the approver `by`, and gives the draft
 * back to its agent with the note. The decision is a conditional write, so of two at once one
 * wins and the other throws AlreadyDecided.
 */
export async function reject(table: Table, { approval, by, note }: { approval: Approval; by: string; note: string }): Promise<Approval> {
  if (approval.state !== "pending") throw new AlreadyDecided(approval);
  const rejected: Approval = { ...approval, state: "rejected", decidedAt: new Date().toISOString(), note };
  const { mailbox, draft } = approval;
  try {
    await recordChanges(table, mailboxFeed(mailbox), {
      by,
      changes: [{ type: "approvalDecided", draft: draft.id, approval: approval.id, decision: "rejected", note }],
      items: [
        ...settle(table, approval, { state: "rejected", decidedAt: rejected.decidedAt, note }),
        {
          Update: {
            TableName: table.name,
            Key: draftKey(mailbox, draft.id),
            UpdateExpression: "SET #send = :send, version = version + :one",
            ConditionExpression: "#send.approval = :approval",
            ExpressionAttributeNames: { "#send": "send" },
            ExpressionAttributeValues: { ":send": { approval: approval.id, state: "rejected", note }, ":one": 1, ":approval": approval.id },
          },
        },
      ],
    });
  } catch (error) {
    if (!changedMeanwhile(error)) throw error;
    const current = await findApproval(table, approval.id);
    throw current?.state === "pending" ? error : new AlreadyDecided(current ?? approval);
  }
  return approvalOf(rejected);
}

/**
 * The writes that move a pending approval to its outcome: the approval, on condition that it is
 * still pending, and the removal of its copy from the approver's pending approvals.
 */
function settle(table: Table, approval: Approval, outcome: Pick<Approval, "state" | "decidedAt" | "note">): TransactItem[] {
  const values = Object.entries(outcome).filter(([, value]) => value !== undefined);
  return [
    {
      Update: {
        TableName: table.name,
        Key: approvalKey(approval.id),
        UpdateExpression: `SET ${values.map(([name]) => `#${name} = :${name}`).join(", ")}`,
        ConditionExpression: "#state = :pending",
        ExpressionAttributeNames: Object.fromEntries(values.map(([name]) => [`#${name}`, name])),
        ExpressionAttributeValues: { ...Object.fromEntries(values.map(([name, value]) => [`:${name}`, value])), ":pending": "pending" },
      },
    },
    { Delete: { TableName: table.name, Key: pendingKey(approval.approver, approval.askedAt, approval.id) } },
  ];
}

// A write of a draft holds only if nothing wrote it since it was read.
const unchanged = (draft: StoredDraft) => ({
  ConditionExpression: "version = :version",
  ExpressionAttributeValues: { ":version": draft.version },
});

const changedMeanwhile = (error: unknown) =>
  error instanceof TransactionCanceledException && (error.CancellationReasons ?? []).some(({ Code }) => Code === "ConditionalCheckFailed");

/** Runs the read and write again while another write got in between, a few times at most. */
async function retried<T>(attempt: () => Promise<T>): Promise<T> {
  for (let tries = 1; ; tries++) {
    try {
      return await attempt();
    } catch (error) {
      if (!changedMeanwhile(error) || tries === 5) throw error;
    }
  }
}

/**
 * The approval in the order the contract lists its fields, without what only Duva keeps, and with
 * the message its draft replies to, if given.
 */
export const approvalOf = ({ id, state, mailbox, agent, approver, draft, askedAt, decidedAt, note }: Approval, original?: Approval["original"]): Approval => ({
  id,
  state,
  mailbox,
  agent,
  approver,
  draft: approvalDraftOf(draft),
  ...(original !== undefined && { original }),
  askedAt,
  ...(decidedAt !== undefined && { decidedAt }),
  ...(note !== undefined && { note }),
});

const approvalDraftOf = ({ id, answers, thread, from, to, subject, text }: Approval["draft"]): Approval["draft"] => ({
  id,
  ...(answers !== undefined && { answers, thread }),
  from,
  to: to.map(addressOf),
  subject,
  text,
});

const addressOf = ({ name, address }: components["schemas"]["EmailAddress"]) => (name === undefined ? { address } : { name, address });

/** The draft in the order the contract lists its fields, without what only Duva keeps. */
const draftOf = ({ id, answers, thread, from, to, subject, text, updatedAt, send }: Draft): Draft => ({
  id,
  ...(answers !== undefined && { answers, thread }),
  from,
  to: to.map(addressOf),
  subject,
  text,
  updatedAt,
  ...(send !== undefined && { send }),
});
