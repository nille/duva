// Drafts, the approvals their sends wait for, and where each send stands. A draft is in its
// mailbox's partition. An approval has its own partition, so a decision finds it by ID alone, and
// while it is pending its approver's partition lists a copy, so an approver's pending approvals are
// one query away. Each step is written in one transaction with its entry in the mailbox's change
// feed. Approving leaves the draft approved, which the table's stream hands the sender, and the
// sender moves it on to sending and then sent, failed or unclear, each move on condition of the last.
// A human's send from their own mailbox needs no approval, so asking leaves the draft approved at once.
import { randomUUID } from "node:crypto";
import { ConditionalCheckFailedException, TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { GetCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { components } from "@duva/openapi";
import type { Table } from "./deployment.ts";
import { recordChanges } from "./feed.ts";
import { mailboxFeed, type StoredMessage, storeSentMessage } from "./mail.ts";
import { type Agent, mailboxKey } from "./organization.ts";
import { documents, isNew, pk, sk, type TransactItem } from "./table.ts";

export type Draft = components["schemas"]["Draft"];
export type Approval = components["schemas"]["Approval"];
export type SendStatus = components["schemas"]["SendStatus"];
type Edits = components["schemas"]["Edits"];
type DraftContent = Omit<Draft, "id" | "updatedAt" | "send">;
/** Where a draft's send stands as stored, with the actor who asked to send it if it needs no approval. */
type StoredSend = SendStatus & { by?: string };
/** A draft as stored, with the count of its writes, which each write checks, so of two at once one retries. */
type StoredDraft = Omit<Draft, "send"> & { send?: StoredSend; version: number };

const draftKey = (mailbox: string, draft: string) => ({ [pk]: mailboxKey(mailbox)[pk]!, [sk]: `draft#${draft}` });
const approvalKey = (approval: string) => ({ [pk]: `approval#${approval}`, [sk]: "approval" });
// While an approval is pending, its approver's partition holds a copy, sorted by when it was asked for.
const pendingPrefix = "pending#";
const pendingKey = (approver: string, askedAt: string, approval: string) => ({ [pk]: `actor#${approver}`, [sk]: `${pendingPrefix}${askedAt}#${approval}` });

/** The draft already waits for an approval. */
export class AlreadyWaiting extends Error {}

/** The draft was approved, so it is sent or being sent, and can't change. */
export class AlreadyApproved extends Error {
  readonly state: SendStatus["state"];
  constructor(state: SendStatus["state"]) {
    super(`The draft is ${state}.`);
    this.state = state;
  }
}

// The states a send reaches once its approver approved it, after which the draft never changes.
const approvedStates: SendStatus["state"][] = ["approved", "sending", "sent", "unclear"];
const refuseApproved = (draft: Pick<Draft, "send">) => {
  if (draft.send !== undefined && approvedStates.includes(draft.send.state)) throw new AlreadyApproved(draft.send.state);
};

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

/** The draft as the sender sends it: with the actor who asked to send it, if its send needs no approval. */
export async function draftToSend(table: Table, mailbox: string, id: string): Promise<(Draft & { send?: StoredSend }) | undefined> {
  const stored = await storedDraft(table, mailbox, id);
  return stored && { ...draftOf(stored), ...(stored.send !== undefined && { send: stored.send }) };
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
    for (const item of page.Items ?? []) drafts.push(draftOf(item as StoredDraft));
    start = page.LastEvaluatedKey;
  } while (start !== undefined);
  return drafts.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * Changes the draft, on behalf of the actor `by`. If it waits for an approval, the change
 * withdraws it, so the approver never decides on text they didn't see. Throws AlreadyApproved
 * once it was approved. Returns undefined if the mailbox has no such draft.
 */
export async function changeDraft(
  table: Table,
  { mailbox, id, by, changes }: { mailbox: string; id: string; by: string; changes: Partial<Pick<Draft, "to" | "cc" | "bcc" | "subject" | "text">> },
): Promise<Draft | undefined> {
  return retried(async () => {
    const draft = await storedDraft(table, mailbox, id);
    if (draft === undefined) return undefined;
    refuseApproved(draft);
    const waiting = draft.send?.state === "waiting" ? draft.send : undefined;
    const changed: StoredDraft = {
      ...draft,
      ...Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined)),
      updatedAt: new Date().toISOString(),
      send: waiting ? { approval: waiting.approval, state: "withdrawn" } : draft.send,
      version: draft.version + 1,
    };
    const items: TransactItem[] = [{ Put: { TableName: table.name, Item: { ...draftKey(mailbox, id), ...changed }, ...unchanged(draft) } }];
    const withdrawn = await withdrawing(table, id, waiting);
    await recordChanges(table, mailboxFeed(mailbox), {
      by,
      changes: [{ type: "draftChanged", draft: id }, ...withdrawn.changes],
      items: [...items, ...withdrawn.items],
    });
    return draftOf(changed);
  });
}

/** The writes that withdraw the pending approval the draft waits for, if it waits for one, and the change that records it. */
async function withdrawing(table: Table, draft: string, waiting: StoredSend | undefined): Promise<{ items: TransactItem[]; changes: object[] }> {
  if (waiting?.approval === undefined) return { items: [], changes: [] };
  const approval = await findApproval(table, waiting.approval);
  if (approval === undefined) throw new Error(`The approval ${waiting.approval} that draft ${draft} waits for is missing.`);
  return { items: settle(table, approval, { state: "withdrawn" }), changes: [{ type: "approvalWithdrawn", draft, approval: approval.id }] };
}

/** The draft is being sent, so it can't be deleted until its send is done. */
export class BeingSent extends Error {}

/**
 * Deletes the draft, on behalf of the actor `by`. If it waits for an approval, deleting withdraws
 * it. Throws BeingSent while it is approved or sending, since the sender still needs it. Returns
 * the draft as it was, or undefined if the mailbox has no such draft.
 */
export async function deleteDraft(table: Table, { mailbox, id, by }: { mailbox: string; id: string; by: string }): Promise<Draft | undefined> {
  return retried(async () => {
    const draft = await storedDraft(table, mailbox, id);
    if (draft === undefined) return undefined;
    if (draft.send?.state === "approved" || draft.send?.state === "sending") throw new BeingSent();
    const waiting = draft.send?.state === "waiting" ? draft.send : undefined;
    const withdrawn = await withdrawing(table, id, waiting);
    await recordChanges(table, mailboxFeed(mailbox), {
      by,
      changes: [{ type: "draftDeleted", draft: id }, ...withdrawn.changes],
      items: [{ Delete: { TableName: table.name, Key: draftKey(mailbox, id), ...unchanged(draft) } }, ...withdrawn.items],
    });
    return draftOf(draft);
  });
}

/** The draft has no recipient in To, so it can't be sent. */
export class NoRecipient extends Error {}

/**
 * Asks for the draft to be sent, on behalf of the human who owns its mailbox, which needs no
 * approval, so the draft is approved at once and the sender sends it. A failed draft can be sent
 * again. Throws NoRecipient without a recipient in To, and AlreadyApproved once it was approved.
 * Returns undefined if the mailbox has no such draft.
 */
export async function sendAtOnce(table: Table, { mailbox, id, by }: { mailbox: string; id: string; by: string }): Promise<Draft | undefined> {
  return retried(async () => {
    const draft = await storedDraft(table, mailbox, id);
    if (draft === undefined) return undefined;
    refuseApproved(draft);
    if (draft.to.length === 0) throw new NoRecipient();
    const asked: StoredDraft = { ...draft, send: { state: "approved", by }, version: draft.version + 1 };
    await recordChanges(table, mailboxFeed(mailbox), {
      by,
      changes: [{ type: "sendAsked", draft: id }],
      items: [{ Put: { TableName: table.name, Item: { ...draftKey(mailbox, id), ...asked }, ...unchanged(draft) } }],
    });
    return draftOf(asked);
  });
}

/**
 * Asks for the draft to be sent, on behalf of the agent that owns its mailbox, which needs the
 * agent's sponsor's approval. Throws AlreadyWaiting if it already waits for one, and
 * AlreadyApproved once it was approved. Returns undefined if the mailbox has no such draft.
 */
export async function askToSend(table: Table, { mailbox, id, agent }: { mailbox: string; id: string; agent: Agent }): Promise<Draft | undefined> {
  return retried(async () => {
    const draft = await storedDraft(table, mailbox, id);
    if (draft === undefined) return undefined;
    if (draft.send?.state === "waiting") throw new AlreadyWaiting();
    refuseApproved(draft);
    if (draft.to.length === 0) throw new NoRecipient();
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
export function reject(table: Table, { approval, by, note }: { approval: Approval; by: string; note: string }): Promise<Approval> {
  return decide(table, approval, by, { state: "rejected", note });
}

/**
 * Approves the pending approval, on behalf of the approver `by`, with the approver's edits to the
 * draft, if any, which the draft then carries. That leaves the draft approved, and the sender sends
 * it from there. The decision is a conditional write, so of two at once one wins and the other
 * throws AlreadyDecided.
 */
export function approve(table: Table, { approval, by, edits }: { approval: Approval; by: string; edits?: Edits }): Promise<Approval> {
  return decide(table, approval, by, { state: "approved", edits });
}

/** Decides the pending approval, on behalf of the approver `by`, and gives the draft the decision's send status and edits. */
async function decide(table: Table, approval: Approval, by: string, { state, note, edits }: { state: "approved" | "rejected"; note?: string; edits?: Edits }): Promise<Approval> {
  if (approval.state !== "pending") throw new AlreadyDecided(approval);
  const decidedAt = new Date().toISOString();
  const { mailbox, draft } = approval;
  const send: SendStatus = { approval: approval.id, state, note };
  const draftSet = setting({ ...edits, ...(edits !== undefined && { updatedAt: decidedAt }), send });
  try {
    await recordChanges(table, mailboxFeed(mailbox), {
      by,
      changes: [{ type: "approvalDecided", draft: draft.id, approval: approval.id, decision: state, edits, note }],
      items: [
        ...settle(table, approval, { state, decidedAt, note, edits }),
        {
          Update: {
            TableName: table.name,
            Key: draftKey(mailbox, draft.id),
            UpdateExpression: `${draftSet.UpdateExpression}, version = version + :one`,
            ConditionExpression: "#send.approval = :approval",
            ExpressionAttributeNames: draftSet.ExpressionAttributeNames,
            ExpressionAttributeValues: { ...draftSet.ExpressionAttributeValues, ":one": 1, ":approval": approval.id },
          },
        },
      ],
    });
  } catch (error) {
    if (!changedMeanwhile(error)) throw error;
    const current = await findApproval(table, approval.id);
    throw current?.state === "pending" ? error : new AlreadyDecided(current ?? approval);
  }
  return approvalOf({ ...approval, state, decidedAt, note, edits });
}

/**
 * The writes that move a pending approval to its outcome: the approval, on condition that it is
 * still pending, and the removal of its copy from the approver's pending approvals.
 */
function settle(table: Table, approval: Approval, outcome: Pick<Approval, "state" | "decidedAt" | "note" | "edits">): TransactItem[] {
  const set = setting(outcome);
  return [
    {
      Update: {
        TableName: table.name,
        Key: approvalKey(approval.id),
        ...set,
        ConditionExpression: "#state = :pending",
        ExpressionAttributeNames: { ...set.ExpressionAttributeNames, "#state": "state" },
        ExpressionAttributeValues: { ...set.ExpressionAttributeValues, ":pending": "pending" },
      },
    },
    { Delete: { TableName: table.name, Key: pendingKey(approval.approver, approval.askedAt, approval.id) } },
  ];
}

/** An update that sets each attribute given a value to it. */
function setting(attributes: Record<string, unknown>) {
  const values = Object.entries(attributes).filter(([, value]) => value !== undefined);
  return {
    UpdateExpression: `SET ${values.map(([name]) => `#${name} = :${name}`).join(", ")}`,
    ExpressionAttributeNames: Object.fromEntries(values.map(([name]) => [`#${name}`, name])),
    ExpressionAttributeValues: Object.fromEntries(values.map(([name, value]) => [`:${name}`, value])),
  };
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
export const approvalOf = ({ id, state, mailbox, agent, approver, draft, askedAt, decidedAt, edits, note }: Approval, original?: Approval["original"]): Approval => ({
  id,
  state,
  mailbox,
  agent,
  approver,
  draft: approvalDraftOf(draft),
  ...(original !== undefined && { original }),
  askedAt,
  ...(decidedAt !== undefined && { decidedAt }),
  ...(edits !== undefined && { edits: editsOf(edits) }),
  ...(note !== undefined && { note }),
});

const editsOf = ({ to, subject, text }: Edits): Edits => ({
  ...(to !== undefined && { to: to.map(addressOf) }),
  ...(subject !== undefined && { subject }),
  ...(text !== undefined && { text }),
});

// Drafts and approvals stored before Cc and Bcc existed have neither.
const approvalDraftOf = ({ id, answers, thread, from, to, cc = [], bcc = [], subject, text }: Approval["draft"]): Approval["draft"] => ({
  id,
  ...(answers !== undefined && { answers, thread }),
  from,
  to: to.map(addressOf),
  cc: cc.map(addressOf),
  bcc: bcc.map(addressOf),
  subject,
  text,
});

const addressOf = ({ name, address }: components["schemas"]["EmailAddress"]) => (name === undefined ? { address } : { name, address });

/** The draft in the order the contract lists its fields, without what only Duva keeps. */
const draftOf = ({ id, answers, thread, from, to, cc = [], bcc = [], subject, text, updatedAt, send }: Omit<StoredDraft, "version">): Draft => ({
  id,
  ...(answers !== undefined && { answers, thread }),
  from,
  to: to.map(addressOf),
  cc: cc.map(addressOf),
  bcc: bcc.map(addressOf),
  subject,
  text,
  updatedAt,
  ...(send !== undefined && { send: sendOf(send) }),
});

const sendOf = ({ approval, state, note, reason, thread, message, messageId }: SendStatus): SendStatus => ({
  ...(approval !== undefined && { approval }),
  state,
  ...(note !== undefined && { note }),
  ...(reason !== undefined && { reason }),
  ...(thread !== undefined && { thread }),
  ...(message !== undefined && { message }),
  ...(messageId !== undefined && { messageId }),
});

/** Where in the table a draft is, from the keys of its item, or undefined if they are another item's. */
export function draftAt(keys: Record<string, string>): { mailbox: string; draft: string } | undefined {
  const mailbox = /^mailbox#(.+)$/.exec(keys[pk] ?? "")?.[1];
  const draft = /^draft#(.+)$/.exec(keys[sk] ?? "")?.[1];
  return mailbox === undefined || draft === undefined ? undefined : { mailbox, draft };
}

/**
 * Moves the approved draft to sending, as the message with the ID in Duva, on condition that it is
 * still approved for the same request. Returns false if it no longer is.
 */
export async function startSending(table: Table, sending: Sending): Promise<boolean> {
  const { mailbox, draft, message } = sending;
  const request = sameRequest(sending);
  return conditionally(
    documents(table).send(
      new UpdateCommand({
        TableName: table.name,
        Key: draftKey(mailbox, draft),
        UpdateExpression: "SET #send = :sending, version = version + :one",
        ConditionExpression: `${request.condition} AND #send.#state = :approved`,
        ExpressionAttributeNames: { "#send": "send", "#state": "state", ...request.names },
        ExpressionAttributeValues: { ":sending": { ...outcomeOf(sending, "sending"), message }, ":one": 1, ...request.values, ":approved": "approved" },
      }),
    ),
  );
}

/** The write that moves the draft from sending the message to the outcome, on condition that it is still sending it. */
function sendingSettles(table: Table, sending: Sending, outcome: StoredSend): TransactItem {
  const { mailbox, draft, message } = sending;
  const request = sameRequest(sending);
  return {
    Update: {
      TableName: table.name,
      Key: draftKey(mailbox, draft),
      UpdateExpression: "SET #send = :outcome, version = version + :one",
      ConditionExpression: `${request.condition} AND #send.#state = :sending AND #send.message = :message`,
      ExpressionAttributeNames: { "#send": "send", "#state": "state", ...request.names },
      ExpressionAttributeValues: { ":outcome": outcome, ":one": 1, ...request.values, ":sending": "sending", ":message": message },
    },
  };
}

/** The condition that the draft's send is still the request being sent: the same approval, or the same ask without one. */
const sameRequest = ({ approval, by }: Sending): { condition: string; names: Record<string, string>; values: Record<string, string> } =>
  approval === undefined
    ? { condition: "attribute_not_exists(#send.approval) AND #send.#by = :by", names: { "#by": "by" }, values: { ":by": by } }
    : { condition: "#send.approval = :approval", names: {}, values: { ":approval": approval } };

/** A send status in the state, for the same request as the sending. */
const outcomeOf = ({ approval, by }: Sending, state: SendStatus["state"]): StoredSend => (approval === undefined ? { state, by } : { approval, state });

/**
 * A draft the sender is sending, as the message with the ID in Duva, on behalf of the actor `by`:
 * the agent whose send the approval let go, or the human who sent it without one.
 */
export interface Sending {
  mailbox: string;
  draft: string;
  approval?: string;
  message: string;
  by: string;
}

/**
 * Marks the draft sent as the message, which SES accepted and gave the Message-ID its recipients
 * see, and stores the message in the draft's thread, or in a new one if it isn't a reply, where
 * that Message-ID points at it, naming the approval it went out with, if it needed one. A human's
 * send from their own mailbox needs none. Returns false if the draft was no longer sending it.
 */
export function markSent(
  table: Table,
  sending: Sending,
  {
    thread,
    messageId,
    stored,
    text,
    approval,
  }: { thread: string | undefined; messageId: string; stored: Omit<StoredMessage, "id" | "messageId" | "sentBy" | "approval">; text: string; approval: Approval | undefined },
): Promise<boolean> {
  const { mailbox, draft, message, by } = sending;
  const once = (sentThread: string) => sendingSettles(table, sending, { ...outcomeOf(sending, "sent"), thread: sentThread, message, messageId });
  // The sender sends only drafts whose approval was decided, so it has a time.
  const approved = approval && { id: approval.id, approver: approval.approver, approvedAt: approval.decidedAt!, ...(approval.edits !== undefined && { edits: approval.edits }) };
  return storeSentMessage(table, { mailbox, message: { ...stored, id: message, messageId, sentBy: by, ...(approved !== undefined && { approval: approved }) }, text, thread, draft, once });
}

/** Marks the draft failed with SES's reason, which those who read the mailbox see. Returns false if it was no longer sending. */
export function markFailed(table: Table, sending: Sending, reason: string): Promise<boolean> {
  const { mailbox, draft, approval, by } = sending;
  return conditionally(
    recordChanges(table, mailboxFeed(mailbox), {
      by,
      changes: [{ type: "sendFailed", draft, approval, reason }],
      items: [sendingSettles(table, sending, { ...outcomeOf(sending, "failed"), reason })],
    }),
  );
}

/**
 * Marks the draft unclear: sending it stopped before SES answered, so a human checks whether it
 * went out, and Duva never sends it again. Without SES's answer, the Message-ID its recipients see
 * is unknown. Returns false if it was no longer sending.
 */
export function markUnclear(table: Table, sending: Sending): Promise<boolean> {
  const { mailbox, draft, approval, by } = sending;
  return conditionally(
    recordChanges(table, mailboxFeed(mailbox), {
      by,
      changes: [{ type: "sendUnclear", draft, approval }],
      items: [sendingSettles(table, sending, outcomeOf(sending, "unclear"))],
    }),
  );
}

/** Whether the write held, or false if its condition failed. */
async function conditionally(write: Promise<unknown>): Promise<boolean> {
  try {
    await write;
    return true;
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException || changedMeanwhile(error)) return false;
    throw error;
  }
}
