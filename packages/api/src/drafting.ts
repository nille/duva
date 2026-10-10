// Drafts, the approvals their sends wait for, and where each send stands. A draft is in its
// mailbox's partition. An approval has its own partition, so a decision finds it by ID alone, and
// while it is pending its approver's partition lists a copy, so an approver's pending approvals are
// one query away. Each step is written in one transaction with its entry in the mailbox's change
// feed. Approving leaves the draft approved, which the table's stream hands the sender, and the
// sender moves it on to sending and then sent, failed or unclear, each move on condition of the last.
// A send that needs no approval, as a human's from their own mailbox, leaves the draft approved at once.
import { randomUUID } from "node:crypto";
import { ConditionalCheckFailedException, TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { GetCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { components } from "@duva/openapi";
import type { Table } from "./deployment.ts";
import { entryKey, recordChanges } from "./feed.ts";
import { type SendFeedback, type StoredMessage, storeSentMessage } from "./mail.ts";
import { startWaiting, stopWaiting, type WaitingSend } from "./limits.ts";
import { sponsorAccessAllows, sponsorAccessIn } from "./access.ts";
import { listDecision, unlistDecision } from "./decisions.ts";
import { linksOf } from "./linked-files.ts";
import {
  type Actor,
  type Agent,
  agentSettings,
  agentSettingsUnchanged,
  agentUnpaused,
  findActor,
  type Mailbox,
  mailboxFeed,
  mailboxKey,
  organizationSettings,
  ownedMailboxes,
} from "./organization.ts";
import { documents, isNew, pk, sk, type TransactItem } from "./table.ts";

export type Draft = components["schemas"]["Draft"];
export type Approval = components["schemas"]["Approval"];
export type SendStatus = components["schemas"]["SendStatus"];
type Edits = components["schemas"]["Edits"];
type Attachment = components["schemas"]["Attachment"];
type DraftAttachment = components["schemas"]["DraftAttachment"];
/**
 * A draft's attachment as Duva keeps it: a forwarded one with its place among the attachments of
 * the message it forwards, and a linked file of that message with the shared file it carries. Of
 * the others, only those chosen keep linked, since which are needed follows from their sizes.
 */
export type DraftFile = Omit<DraftAttachment, "linked"> & { linked?: "chosen"; place?: number; carries?: { holder: string; draft: string; file: string } };
/** Drafts written before their attachments had IDs list those of the message they forward, all of them in order. */
type StoredFile = DraftFile | Attachment;
type DraftContent = Omit<Draft, "id" | "updatedAt" | "updatedBy" | "send" | "attachments"> & { attachments?: DraftFile[] };
/**
 * Where a draft's send stands as stored, with the actor who asked to send it if it needs no
 * approval, and when they asked, which sends held while an agent is paused are released in, and
 * whether its sponsor sent it now, past the agent's send limits.
 */
type StoredSend = SendStatus & { by?: string; askedAt?: string; pastLimit?: boolean };
/**
 * A draft as stored, with the count of its writes, which each write checks, so of two at once one
 * retries, and the IDs of the approvals it asked for, so erasure finds them. Drafts written before
 * approvals were listed list none, and erasure finds theirs in the mailbox's change feed.
 */
type StoredDraft = Omit<Draft, "send" | "attachments"> & { attachments?: StoredFile[]; send?: StoredSend; version: number; approvals?: string[] };
/**
 * An approval as stored, with the position of its decision in the mailbox's change feed once it is
 * decided, and of its decisions before that, undone or rejected before it was sent after all, so
 * erasure finds each. Once its send went out or failed, it keeps how it went, which stays after its
 * draft is gone.
 */
type StoredApproval = Approval & { decidedIn?: number; decidedBefore?: number[]; outcome?: SendOutcome };

/** The approval with the ID as the table stores it, or undefined if there is none. */
async function storedItem(table: Table, id: string): Promise<StoredApproval | undefined> {
  const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: approvalKey(id), ConsistentRead: true }));
  return Item as StoredApproval | undefined;
}

/** The write that keeps where an earlier decision on the approval is in the feed, if it is anywhere. */
const keepEarlier = (decidedIn: number | undefined) =>
  decidedIn === undefined
    ? { expression: "", values: {} }
    : { expression: ", decidedBefore = list_append(if_not_exists(decidedBefore, :none), :earlier)", values: { ":none": [], ":earlier": [decidedIn] } };

/** Whether the draft's send is approved and its approver can still undo it, now. */
export const undoable = (send: Pick<SendStatus, "state" | "undoUntil"> | undefined): send is SendStatus & { undoUntil: string } =>
  send?.state === "approved" && send.undoUntil !== undefined && Date.parse(send.undoUntil) > Date.now();
/** How an approved send went, as its approval keeps it. */
export interface SendOutcome {
  state: "sent" | "failed" | "unclear";
  thread?: string;
  message?: string;
  reason?: string;
}

const draftKey = (mailbox: string, draft: string) => ({ [pk]: mailboxKey(mailbox)[pk]!, [sk]: `draft#${draft}` });
const approvalKey = (approval: string) => ({ [pk]: `approval#${approval}`, [sk]: "approval" });
// While an approval is pending, its approver's partition holds a copy, sorted by when it was asked for.
const pendingPrefix = "pending#";
const pendingKey = (approver: string, askedAt: string, approval: string) => ({ [pk]: `actor#${approver}`, [sk]: `${pendingPrefix}${askedAt}#${approval}` });

/** The draft already waits for an approval. */
export class AlreadyWaiting extends Error {}

/** The draft was approved, so it is sent or being sent, and can't change. */
export class AlreadyApproved extends Error {
  readonly state: ApprovedState;
  constructor(state: ApprovedState) {
    super(`The draft is ${state}.`);
    this.state = state;
  }
}

// The states a send reaches once its approver approved it, after which the draft never changes.
type ApprovedState = "approved" | "waitingForLimit" | "sending" | "sent" | "unclear";
const approvedStates: SendStatus["state"][] = ["approved", "waitingForLimit", "sending", "sent", "unclear"] satisfies ApprovedState[];
/** What became of an approved draft, by its send's state, as a refusal says it. */
export const approvedOutcomes: Record<ApprovedState, string> = {
  approved: "is about to be sent",
  waitingForLimit: "waits for the agent's send limits",
  sending: "is being sent",
  sent: "was sent",
  unclear: "may have been sent, which a human checks",
};

const refuseApproved = (draft: Pick<Draft, "send">) => {
  if (draft.send !== undefined && approvedStates.includes(draft.send.state)) throw new AlreadyApproved(draft.send.state as ApprovedState);
};

/** How long an approver's note on a rejection is at most. */
export const maxNote = 2000;

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
  const draft = { id: randomUUID(), ...content, updatedAt: new Date().toISOString(), updatedBy: by };
  await recordChanges(table, mailboxFeed(mailbox), {
    by,
    changes: [{ type: "draftWritten", draft: draft.id }],
    items: [{ Put: { TableName: table.name, Item: { ...draftKey(mailbox, draft.id), ...draft, version: 1, approvals: [] }, ...isNew } }],
  });
  return draftOf(draft);
}

/** The draft with the ID in the mailbox, or undefined if it has none. */
export async function findDraft(table: Table, mailbox: string, id: string): Promise<Draft | undefined> {
  const stored = await storedDraft(table, mailbox, id);
  return stored && draftOf(stored);
}

/**
 * The draft as the sender sends it: with the actor who asked to send it, if its send needs no
 * approval, and its attachments as Duva keeps them.
 */
export async function draftToSend(table: Table, mailbox: string, id: string): Promise<(Draft & { send?: StoredSend; files: DraftFile[] }) | undefined> {
  const stored = await storedDraft(table, mailbox, id);
  return stored && { ...draftOf(stored), ...(stored.send !== undefined && { send: stored.send }), files: filesOf(stored.attachments) };
}

/** The draft's attachments as Duva keeps them, with the IDs and places of those of drafts from before attachments had IDs. */
export const filesOf = (stored: StoredFile[] | undefined): DraftFile[] =>
  (stored ?? []).map((file, index) => ("id" in file ? file : { id: forwardedId(index), ...file, source: "forwarded", place: index }));

/** The ID of the forwarded message's attachment at the place, as a draft lists it. */
export const forwardedId = (place: number) => `forwarded-${place}`;

/** How many files a draft carries at most, which keeps it within what DynamoDB stores in one item. */
export const maxFiles = 100;

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
export function changeDraft(
  table: Table,
  { mailbox, id, by, changes }: { mailbox: string; id: string; by: string; changes: Partial<Pick<Draft, "from" | "to" | "cc" | "bcc" | "subject" | "text" | "linkDays">> },
): Promise<Draft | undefined> {
  return rewrite(table, { mailbox, id, by }, () => Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined)));
}

/** The draft already carries as many files as it can. */
export class TooManyFiles extends Error {}

/** The draft already carries the file. */
export class AlreadyAttached extends Error {}

/**
 * Attaches the uploaded file to the draft, on behalf of the actor `by`, with the `items` written
 * too, as a change of the draft is. Throws AlreadyApproved once it was approved, and TooManyFiles
 * when it carries as many as it can. Returns undefined if the mailbox has no such draft.
 */
export function attachFile(table: Table, { mailbox, id, by, file, items }: { mailbox: string; id: string; by: string; file: DraftFile; items: TransactItem[] }): Promise<Draft | undefined> {
  return rewrite(
    table,
    { mailbox, id, by },
    (draft) => {
      const files = filesOf(draft.attachments);
      if (files.some(({ id }) => id === file.id)) throw new AlreadyAttached();
      if (files.length >= maxFiles) throw new TooManyFiles();
      return { attachments: [...files, file] };
    },
    items,
  );
}

/** The draft has no such attachment. */
export class NoSuchAttachment extends Error {}

/** The attachment is a linked file of the message the draft forwards, which always goes as its link. */
export class CarriedLink extends Error {}

/**
 * Has the draft's attachment go as a linked file by choice, or not, on behalf of the actor `by`,
 * as a change of the draft is. Throws AlreadyApproved once it was approved, NoSuchAttachment if
 * the draft doesn't carry it, and CarriedLink for a linked file of the message it forwards.
 * Returns undefined if the mailbox has no such draft.
 */
export function chooseLink(table: Table, { mailbox, id, by, attachment, linked }: { mailbox: string; id: string; by: string; attachment: string; linked: boolean }): Promise<Draft | undefined> {
  return rewrite(table, { mailbox, id, by }, (stored) => {
    const files = filesOf(stored.attachments);
    const file = files.find((each) => each.id === attachment);
    if (file === undefined) throw new NoSuchAttachment();
    if (file.source === "linked") throw new CarriedLink();
    const { linked: _, ...carried } = file;
    return { attachments: files.map((each) => (each !== file ? each : linked ? { ...carried, linked: "chosen" as const } : carried)) };
  });
}

/**
 * Takes the attachment off the draft, on behalf of the actor `by`, as a change of the draft is.
 * Throws AlreadyApproved once it was approved, and NoSuchAttachment if the draft doesn't carry it.
 * Returns the draft and the attachment taken off, or undefined if the mailbox has no such draft.
 */
export async function removeAttachment(table: Table, { mailbox, id, by, attachment }: { mailbox: string; id: string; by: string; attachment: string }): Promise<{ draft: Draft; removed: DraftFile } | undefined> {
  let removed: DraftFile | undefined;
  const draft = await rewrite(table, { mailbox, id, by }, (stored) => {
    const files = filesOf(stored.attachments);
    removed = files.find((file) => file.id === attachment);
    if (removed === undefined) throw new NoSuchAttachment();
    return { attachments: files.filter((file) => file !== removed) };
  });
  return draft && { draft, removed: removed! };
}

/**
 * Writes the draft with the `change` made to it as read, on behalf of the actor `by`, with the
 * `items` written too. If it waits for an approval, the change withdraws it, so the approver never
 * decides on a draft they didn't see. Throws AlreadyApproved once it was approved. Returns
 * undefined if the mailbox has no such draft.
 */
function rewrite(
  table: Table,
  { mailbox, id, by }: { mailbox: string; id: string; by: string },
  change: (draft: StoredDraft) => Partial<StoredDraft>,
  items: TransactItem[] = [],
): Promise<Draft | undefined> {
  return retried(async () => {
    const draft = await storedDraft(table, mailbox, id);
    if (draft === undefined) return undefined;
    refuseApproved(draft);
    const waiting = draft.send?.state === "waiting" ? draft.send : undefined;
    const changed: StoredDraft = {
      ...draft,
      ...change(draft),
      updatedAt: new Date().toISOString(),
      updatedBy: by,
      send: waiting ? { approval: waiting.approval, state: "withdrawn" } : draft.send,
      version: draft.version + 1,
    };
    const withdrawn = await withdrawing(table, id, waiting);
    await recordChanges(table, mailboxFeed(mailbox), {
      by,
      changes: [{ type: "draftChanged", draft: id }, ...withdrawn.changes],
      items: [{ Put: { TableName: table.name, Item: { ...draftKey(mailbox, id), ...changed }, ...unchanged(draft) } }, ...withdrawn.items, ...items],
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
    if (draft.send?.state === "approved" || draft.send?.state === "waitingForLimit" || draft.send?.state === "sending") throw new BeingSent();
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

/** Why a draft from an address its mailbox no longer has isn't sent. */
export const notFrom = (from: string) => `The draft is from ${from}, which the mailbox no longer has, so it can't be sent. Write it again as a new draft.`;

/** Why a draft from a group its mailbox's owner was taken out of isn't sent. */
export const notMember = (group: string) =>
  `The draft is from the group ${group}, which the mailbox's owner is no longer a member of, so it can't be sent. Ask an admin to add them back, or send it from another address.`;

/** Why a draft from the address can't be sent, with where the mailbox stands with it, or undefined if it can. */
export const unsendableFrom = (standing: "own" | "group" | "notMember" | "none", from: string) =>
  standing === "none" ? notFrom(from) : standing === "notMember" ? notMember(from) : undefined;

/** The draft has no recipient in To, so it can't be sent. */
export class NoRecipient extends Error {}

/** The agent's sponsor access no longer lets it send from its sponsor's mailbox. */
export class SendNotAllowed extends Error {}

/**
 * Asks for the draft to be sent, on behalf of the actor. A human's send from their own mailbox
 * needs no approval. An agent sends as its sponsor, from their mailbox, which needs send sponsor
 * access there, and its send waits for its sponsor's approval while that switch is on.
 * The ask holds only if the agent's settings are still as read, so a change to them at the same
 * time either comes first or finds the ask. Throws SendNotAllowed once send access there is gone,
 * NoRecipient without a recipient in To, AlreadyWaiting if an agent's ask that needs approval
 * already waits for one, and AlreadyApproved once it was approved. Returns undefined if the mailbox
 * has no such draft.
 */
export async function askToSend(table: Table, { mailbox, id, actor }: { mailbox: Mailbox; id: string; actor: Actor }): Promise<Draft | undefined> {
  return retried(async () => {
    const draft = await storedDraft(table, mailbox.id, id);
    if (draft === undefined) return undefined;
    if (actor.kind !== "agent") return sendAtOnce(table, { mailbox: mailbox.id, draft, by: actor.id, held: [] });
    const read = await agentSettings(table, actor.id);
    if (!sponsorAccessAllows(sponsorAccessIn(read.settings, mailbox.id), "send")) throw new SendNotAllowed();
    const held = [agentSettingsUnchanged(table, actor.id, read)];
    return read.settings.approvalAsSponsor
      ? waitForApproval(table, { mailbox: mailbox.id, draft, agent: actor, held })
      : sendAtOnce(table, { mailbox: mailbox.id, draft, by: actor.id, held });
  });
}

/**
 * Writes the mailbox agent's mail to a sender's unsubscribe address, and asks to send it at once,
 * without its owner's approval, since choosing nowhere was their consent and it only unsubscribes
 * (ADR-0031). The sender sends it as the agent's, with the disclosure, within its send limits.
 */
export async function sendUnsubscribeRequest(table: Table, { mailbox, agent, content }: { mailbox: string; agent: string; content: DraftContent }): Promise<Draft> {
  const { id } = await addDraft(table, { mailbox, by: agent, content });
  return sendAtOnce(table, { mailbox, draft: (await storedDraft(table, mailbox, id))!, by: agent, held: [] });
}

/**
 * Approves the draft at once, on behalf of the actor `by`, whose send needs no approval, and the
 * sender sends it. If it waits for an approval, this withdraws it. A failed draft can be sent again.
 */
async function sendAtOnce(table: Table, { mailbox, draft, by, held }: { mailbox: string; draft: StoredDraft; by: string; held: TransactItem[] }): Promise<Draft> {
  refuseApproved(draft);
  if (draft.to.length === 0) throw new NoRecipient();
  const asked: StoredDraft = { ...draft, send: { state: "approved", by, askedAt: new Date().toISOString() }, version: draft.version + 1 };
  const withdrawn = await withdrawing(table, draft.id, draft.send?.state === "waiting" ? draft.send : undefined);
  await recordChanges(table, mailboxFeed(mailbox), {
    by,
    changes: [...withdrawn.changes, { type: "sendAsked", draft: draft.id }],
    items: [{ Put: { TableName: table.name, Item: { ...draftKey(mailbox, draft.id), ...asked }, ...unchanged(draft) } }, ...withdrawn.items, ...held],
  });
  return draftOf(asked);
}

/** Asks the agent's sponsor to approve the draft's send, on behalf of the agent. */
async function waitForApproval(table: Table, { mailbox, draft, agent, held }: { mailbox: string; draft: StoredDraft; agent: Agent; held: TransactItem[] }): Promise<Draft> {
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
  const asked: StoredDraft = {
    ...draft,
    send: { approval: approval.id, state: "waiting" },
    version: draft.version + 1,
    ...(draft.approvals !== undefined && { approvals: [...draft.approvals, approval.id] }),
  };
  await recordChanges(table, mailboxFeed(mailbox), {
    by: agent.id,
    changes: [{ type: "approvalAsked", draft: draft.id, approval: approval.id }],
    items: [
      { Put: { TableName: table.name, Item: { ...draftKey(mailbox, draft.id), ...asked }, ...unchanged(draft) } },
      { Put: { TableName: table.name, Item: { ...approvalKey(approval.id), ...approval }, ...isNew } },
      { Put: { TableName: table.name, Item: { ...pendingKey(approval.approver, approval.askedAt, approval.id), ...approval }, ...isNew } },
      ...held,
    ],
  });
  return draftOf(asked);
}

/**
 * Withdraws the agent's pending approvals in the mailboxes, on behalf of the actor `by`, its
 * sponsor unless given, each recorded in its mailbox's change feed. The drafts stay, marked withdrawn.
 */
export async function withdrawPendingApprovals(table: Table, { agent, mailboxes, by = agent.sponsor }: { agent: Agent; mailboxes: string[]; by?: string }): Promise<void> {
  for (const approval of await pendingApprovals(table, agent.sponsor)) {
    if (approval.agent !== agent.id || !mailboxes.includes(approval.mailbox)) continue;
    await retried(async () => {
      const draft = await storedDraft(table, approval.mailbox, approval.draft.id);
      // A change, a deletion or a decision since the listing settled it already.
      if (draft?.send?.state !== "waiting" || draft.send.approval !== approval.id) return;
      const withdrawn = await withdrawing(table, draft.id, draft.send);
      const changed: StoredDraft = { ...draft, send: { approval: approval.id, state: "withdrawn" }, version: draft.version + 1 };
      await recordChanges(table, mailboxFeed(approval.mailbox), {
        by,
        changes: withdrawn.changes,
        items: [{ Put: { TableName: table.name, Item: { ...draftKey(approval.mailbox, draft.id), ...changed }, ...unchanged(draft) } }, ...withdrawn.items],
      });
    });
  }
}

/** The approval with the ID, or undefined if there is none. */
export async function findApproval(table: Table, id: string): Promise<Approval | undefined> {
  const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: approvalKey(id), ConsistentRead: true }));
  return Item && approvalOf(Item as Approval);
}

/** The approval with the ID as stored, with how its send went once it went out or failed, or undefined if there is none. */
export async function storedApproval(table: Table, id: string): Promise<(Approval & { outcome?: SendOutcome }) | undefined> {
  const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: approvalKey(id), ConsistentRead: true }));
  if (Item === undefined) return undefined;
  const { outcome } = Item as StoredApproval;
  return { ...approvalOf(Item as Approval), ...(outcome !== undefined && { outcome }) };
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
        // Withdrawing on a lowering of sponsor access finds an approval asked for just before.
        ConsistentRead: true,
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

/** The agent is paused, so its approvals can't be sent until it is unpaused. */
export class AgentPaused extends Error {}

/** The agent changed, deleted or asked again for the draft of a rejected approval, so it can't be sent after all. */
export class DraftMovedOn extends Error {}

/**
 * Approves the pending approval, on behalf of the approver `by`, with the approver's edits to the
 * draft, if any, which the draft then carries. That leaves the draft approved, and the sender sends
 * it once the organization's undo window is over. A rejected approval is approved after all, while
 * its draft is still as the agent asked it, and throws DraftMovedOn once it isn't. The decision is
 * a conditional write, so of two at once one wins and the other throws AlreadyDecided. It holds
 * only while the agent isn't paused, and throws AgentPaused if it is.
 */
export async function approve(table: Table, { approval, by, edits }: { approval: Approval; by: string; edits?: Edits }): Promise<Approval> {
  let rejected: { draftVersion: number; decidedIn?: number } | undefined;
  if (approval.state === "rejected") {
    const draft = await storedDraft(table, approval.mailbox, approval.draft.id);
    if (draft === undefined || draft.send?.approval !== approval.id || draft.send.state !== "rejected" || !asAsked(draft, approval)) throw new DraftMovedOn();
    rejected = { draftVersion: draft.version, decidedIn: (await storedItem(table, approval.id))?.decidedIn };
  }
  try {
    return await decide(table, approval, by, { state: "approved", edits, rejected }, [agentUnpaused(table, approval.agent)]);
  } catch (error) {
    const agent = changedMeanwhile(error) ? await findActor(table, approval.agent) : undefined;
    if (agent?.kind === "agent" && agent.paused !== undefined) throw new AgentPaused();
    throw error;
  }
}

/** Whether the draft is as the agent asked for it to be sent with the approval. */
export const asAsked = (draft: Pick<StoredDraft, "from" | "to" | "cc" | "bcc" | "subject" | "text" | "attachments" | "linkDays">, approval: Approval) => {
  const fields = ({ from, to, cc = [], bcc = [], subject, text, attachments, linkDays }: Pick<StoredDraft, "from" | "to" | "cc" | "bcc" | "subject" | "text" | "attachments" | "linkDays">) =>
    JSON.stringify([from, [to, cc, bcc].map((list) => list.map(({ address }) => address)), subject, text, filesOf(attachments).map(({ id, linked }) => [id, linked ?? null]), linkDays ?? null]);
  return fields(draft) === fields(approval.draft);
};

/**
 * Decides the pending approval, or approves a rejected one after all, on behalf of the approver
 * `by`, and gives the draft the decision's send status and edits, with the `checks` written too.
 * Approving holds the send for the organization's undo window. The decision is listed in the
 * approver's log, at its new time if it was decided before. A rejected approval's draft must still
 * be at the version read, and where its rejection is in the feed is kept.
 */
async function decide(
  table: Table,
  approval: Approval,
  by: string,
  { state, note, edits, rejected }: { state: "approved" | "rejected"; note?: string; edits?: Edits; rejected?: { draftVersion: number; decidedIn?: number } },
  checks: TransactItem[] = [],
): Promise<Approval> {
  const again = approval.state === "rejected" && state === "approved";
  if (approval.state !== "pending" && !again) throw new AlreadyDecided(approval);
  const decidedAt = new Date().toISOString();
  const window = state === "approved" ? (await organizationSettings(table)).settings.undoWindowSeconds : 0;
  const undoUntil = window > 0 ? new Date(Date.parse(decidedAt) + window * 1000).toISOString() : undefined;
  const agent = await findActor(table, approval.agent);
  const { mailbox, draft } = approval;
  const send: SendStatus = { approval: approval.id, state, note, undoUntil };
  const draftSet = setting({ ...edits, ...(edits !== undefined && { updatedAt: decidedAt, updatedBy: by }), send });
  const asRead = rejected === undefined ? undefined : { condition: " AND version = :version", values: { ":version": rejected.draftVersion } };
  try {
    await recordChanges(table, mailboxFeed(mailbox), {
      by,
      changes: [{ type: "approvalDecided", draft: draft.id, approval: approval.id, decision: state, edits, note }],
      items: (decidedIn) => [
        ...settle(table, approval, { state, decidedAt, note, edits, decidedIn, undoUntil }, rejected?.decidedIn),
        {
          Update: {
            TableName: table.name,
            Key: draftKey(mailbox, draft.id),
            UpdateExpression: `${draftSet.UpdateExpression}, version = version + :one`,
            ConditionExpression: `#send.approval = :approval${asRead?.condition ?? ""}`,
            ExpressionAttributeNames: draftSet.ExpressionAttributeNames,
            ExpressionAttributeValues: { ...draftSet.ExpressionAttributeValues, ":one": 1, ":approval": approval.id, ...asRead?.values },
          },
        },
        listDecision(table, approval.approver, { approval: approval.id, agent: approval.agent, agentName: agent?.kind === "agent" ? agent.name : "", decidedBy: by, decidedAt }),
        ...(again ? [unlistDecision(table, approval.approver, approval.decidedAt!, approval.id)] : []),
        ...checks,
      ],
    });
  } catch (error) {
    if (!changedMeanwhile(error)) throw error;
    const current = await findApproval(table, approval.id);
    if (again) throw current?.state === "rejected" ? new DraftMovedOn() : new AlreadyDecided(current ?? approval);
    throw current?.state === "pending" ? error : new AlreadyDecided(current ?? approval);
  }
  const { note: _, ...decided } = approval;
  return approvalOf({ ...decided, state, decidedAt, ...(note !== undefined && { note }), edits, undoUntil });
}

/**
 * The writes that move a pending approval to its outcome: the approval, on condition that it is
 * still pending, and the removal of its copy from the approver's pending approvals. A rejected
 * approval approved after all loses its note, and was listed as pending no more.
 */
function settle(
  table: Table,
  approval: Approval,
  outcome: Pick<StoredApproval, "state" | "decidedAt" | "note" | "edits" | "decidedIn" | "undoUntil">,
  rejectedIn?: number,
): TransactItem[] {
  const set = setting(outcome);
  const from = approval.state === "rejected" ? "rejected" : "pending";
  const earlier = keepEarlier(rejectedIn);
  return [
    {
      Update: {
        TableName: table.name,
        Key: approvalKey(approval.id),
        ...set,
        UpdateExpression: `${set.UpdateExpression}${earlier.expression}${from === "rejected" ? " REMOVE note" : ""}`,
        ConditionExpression: "#state = :from",
        ExpressionAttributeNames: { ...set.ExpressionAttributeNames, "#state": "state" },
        ExpressionAttributeValues: { ...set.ExpressionAttributeValues, ...earlier.values, ":from": from },
      },
    },
    ...(from === "pending" ? [{ Delete: { TableName: table.name, Key: pendingKey(approval.approver, approval.askedAt, approval.id) } }] : []),
  ];
}

/** The approval can't be undone: it isn't approved, its undo window is over, or the sender took it. */
export class NotUndoable extends Error {}

/**
 * Undoes the approved approval during its undo window, on behalf of its approver `by`: it waits
 * for them again, as the agent asked it, without their edits, listed among their pending
 * approvals and off their log, and its draft waits for it. The sender takes the draft only once
 * the window is over, on condition that it is still approved, so of the two one wins. Throws
 * NotUndoable once the window is over or the sender took it.
 */
export function undo(table: Table, { approval, by }: { approval: Approval; by: string }): Promise<Approval> {
  return retried(async () => {
    const stored = await storedItem(table, approval.id);
    const current = stored && approvalOf(stored);
    const draft = await storedDraft(table, approval.mailbox, approval.draft.id);
    if (current?.state !== "approved" || draft === undefined || draft.send?.approval !== approval.id || !undoable(draft.send)) throw new NotUndoable();
    const earlier = keepEarlier(stored!.decidedIn);
    const { decidedAt, edits, undoUntil: _, ...asked } = current;
    const waiting: Approval = { ...asked, state: "pending" };
    const now = new Date().toISOString();
    const restored: StoredDraft = {
      ...draft,
      ...(edits !== undefined && { to: current.draft.to, subject: current.draft.subject, text: current.draft.text, updatedAt: now, updatedBy: by }),
      send: { approval: approval.id, state: "waiting" },
      version: draft.version + 1,
    };
    await recordChanges(table, mailboxFeed(approval.mailbox), {
      by,
      changes: [{ type: "approvalUndone", draft: draft.id, approval: approval.id }],
      items: [
        { Put: { TableName: table.name, Item: { ...draftKey(approval.mailbox, draft.id), ...restored }, ...unchanged(draft) } },
        {
          Update: {
            TableName: table.name,
            Key: approvalKey(approval.id),
            UpdateExpression: `SET #state = :pending${earlier.expression} REMOVE decidedAt, edits, undoUntil, decidedIn`,
            ConditionExpression: "#state = :approved",
            ExpressionAttributeNames: { "#state": "state" },
            ExpressionAttributeValues: { ":pending": "pending", ":approved": "approved", ...earlier.values },
          },
        },
        { Put: { TableName: table.name, Item: { ...pendingKey(waiting.approver, waiting.askedAt, waiting.id), ...approvalOf(waiting) } } },
        unlistDecision(table, waiting.approver, decidedAt!, waiting.id),
      ],
    });
    return approvalOf(waiting);
  });
}

/**
 * Erases the approval records of the draft's sends: each approval it asked for, with the draft its
 * approver saw and any edit they made. Their decisions stay in the mailbox's change feed, naming
 * the decision and its actor, without the edit or the note. Run again, it finishes what an earlier
 * run left.
 */
export async function eraseApprovals(table: Table, mailbox: string, stored: Record<string, unknown>): Promise<void> {
  const draft = stored as StoredDraft;
  const feed = mailboxFeed(mailbox);
  // Where each approval's decision is in the feed, for those that don't keep it.
  const listed = draft.approvals === undefined ? await approvalsInFeed(table, mailbox, draft.id) : undefined;
  for (const id of draft.approvals ?? listed!.keys()) {
    const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: approvalKey(id), ConsistentRead: true }));
    if (Item === undefined) continue;
    const { decidedIn: kept, decidedBefore = [], approver, decidedAt } = Item as StoredApproval;
    const decidedIn = kept ?? listed?.get(id);
    // Each decision on it, an undone or rejected one before the last included, loses its edit and note.
    const positions = [...decidedBefore, ...(decidedIn === undefined ? [] : [decidedIn])];
    await documents(table).send(
      new TransactWriteCommand({
        TransactItems: [
          { Delete: { TableName: table.name, Key: approvalKey(id) } },
          ...(decidedAt === undefined ? [] : [unlistDecision(table, approver, decidedAt, id)]),
          ...positions.map((position) => ({
            Update: {
              TableName: table.name,
              Key: entryKey(feed, position),
              UpdateExpression: "REMOVE edits, note",
              ConditionExpression: "approval = :approval",
              ExpressionAttributeValues: { ":approval": id },
            },
          })),
        ],
      }),
    );
  }
}

/** The approvals the draft asked for, as the mailbox's change feed records them, each with where its decision is, once decided. */
async function approvalsInFeed(table: Table, mailbox: string, draft: string): Promise<Map<string, number | undefined>> {
  const approvals = new Map<string, number | undefined>();
  let start: Record<string, unknown> | undefined;
  do {
    const page = await documents(table).send(
      new QueryCommand({
        TableName: table.name,
        KeyConditionExpression: `${pk} = :feed`,
        FilterExpression: "draft = :draft AND #type IN (:asked, :decided)",
        ExpressionAttributeNames: { "#type": "type" },
        ExpressionAttributeValues: { ":feed": mailboxFeed(mailbox).partition, ":draft": draft, ":asked": "approvalAsked", ":decided": "approvalDecided" },
        ConsistentRead: true,
        ExclusiveStartKey: start,
      }),
    );
    for (const { type, approval, position } of page.Items ?? []) {
      approvals.set(approval as string, type === "approvalDecided" ? (position as number) : approvals.get(approval as string));
    }
    start = page.LastEvaluatedKey;
  } while (start !== undefined);
  return approvals;
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
export const approvalOf = ({ id, state, mailbox, agent, approver, draft, askedAt, decidedAt, undoUntil, edits, note }: Approval, original?: Approval["original"]): Approval => ({
  id,
  state,
  mailbox,
  agent,
  approver,
  draft: approvalDraftOf(draft),
  ...(original !== undefined && { original }),
  askedAt,
  ...(decidedAt !== undefined && { decidedAt }),
  ...(undoUntil !== undefined && { undoUntil }),
  ...(edits !== undefined && { edits: editsOf(edits) }),
  ...(note !== undefined && { note }),
});

const editsOf = ({ to, subject, text }: Edits): Edits => ({
  ...(to !== undefined && { to: to.map(addressOf) }),
  ...(subject !== undefined && { subject }),
  ...(text !== undefined && { text }),
});

// Drafts and approvals stored before Cc and Bcc existed have neither.
const approvalDraftOf = ({ id, answers, forwards, thread, from, to, cc = [], bcc = [], subject, text, attachments, linkDays }: Omit<Approval["draft"], "attachments"> & { attachments?: StoredFile[] }): Approval["draft"] => ({
  id,
  ...(answers !== undefined && { answers }),
  ...(forwards !== undefined && { forwards }),
  ...(thread !== undefined && { thread }),
  from,
  to: to.map(addressOf),
  cc: cc.map(addressOf),
  bcc: bcc.map(addressOf),
  subject,
  text,
  ...(attachments !== undefined && { attachments: attachmentsOf(attachments, text) }),
  ...(linkDays !== undefined && { linkDays }),
});

/** The draft's attachments as the contract lists them, each with whether it goes as a linked file. */
const attachmentsOf = (stored: StoredFile[], text: string): DraftAttachment[] => {
  const files = filesOf(stored);
  const links = linksOf(files, text);
  return files.map(({ id, name, type, size, source, until }) => {
    const linked = links.get(id);
    return { id, ...(name !== undefined && { name }), type, size, source, ...(linked !== undefined && { linked }), ...(until !== undefined && { until }) };
  });
};

const addressOf = ({ name, address }: components["schemas"]["EmailAddress"]) => (name === undefined ? { address } : { name, address });

/** The draft in the order the contract lists its fields, without what only Duva keeps. */
const draftOf = ({ id, answers, forwards, thread, from, to, cc = [], bcc = [], subject, text, attachments, linkDays, updatedAt, updatedBy, send }: Omit<StoredDraft, "version">): Draft => ({
  id,
  ...(answers !== undefined && { answers }),
  ...(forwards !== undefined && { forwards }),
  ...(thread !== undefined && { thread }),
  from,
  to: to.map(addressOf),
  cc: cc.map(addressOf),
  bcc: bcc.map(addressOf),
  subject,
  text,
  ...(attachments !== undefined && { attachments: attachmentsOf(attachments, text) }),
  ...(linkDays !== undefined && { linkDays }),
  updatedAt,
  ...(updatedBy !== undefined && { updatedBy }),
  ...(send !== undefined && { send: sendOf(send) }),
});

const sendOf = ({ approval, state, undoUntil, note, reason, thread, message, messageId, feedback }: SendStatus): SendStatus => ({
  ...(approval !== undefined && { approval }),
  state,
  ...(undoUntil !== undefined && { undoUntil }),
  ...(note !== undefined && { note }),
  ...(reason !== undefined && { reason }),
  ...(thread !== undefined && { thread }),
  ...(message !== undefined && { message }),
  ...(messageId !== undefined && { messageId }),
  ...(feedback !== undefined && { feedback }),
});

/** Where in the table a draft is, from the keys of its item, or undefined if they are another item's. */
export function draftAt(keys: Record<string, string>): { mailbox: string; draft: string } | undefined {
  const mailbox = /^mailbox#(.+)$/.exec(keys[pk] ?? "")?.[1];
  const draft = /^draft#(.+)$/.exec(keys[sk] ?? "")?.[1];
  return mailbox === undefined || draft === undefined ? undefined : { mailbox, draft };
}

/** When the draft's send was approved, or asked for if it needed no approval, which the sends of a paused or limited agent go out in. */
export const approvedAt = (draft: Pick<Draft, "updatedAt"> & { send?: StoredSend }, approval: Approval | undefined) => approval?.decidedAt ?? draft.send?.askedAt ?? draft.updatedAt;

/**
 * Moves the draft to sending, as the message with the ID in Duva, on condition that it is still
 * approved, or waiting for the agent's limits if `from` says so, for the same request, and with
 * the `checks` written too. Returns false if it no longer is, or a check failed.
 */
export async function startSending(table: Table, sending: Sending, checks: TransactItem[] = [], from: "approved" | "waitingForLimit" = "approved"): Promise<boolean> {
  const { mailbox, draft, message } = sending;
  const request = sameRequest(sending);
  const window = sameWindow(sending);
  return conditionally(
    documents(table).send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: table.name,
              Key: draftKey(mailbox, draft),
              UpdateExpression: "SET #send = :sending, version = version + :one",
              ConditionExpression: `${request.condition} AND ${window.condition} AND #send.#state = :approved`,
              ExpressionAttributeNames: { "#send": "send", "#state": "state", ...request.names },
              ExpressionAttributeValues: { ":sending": { ...outcomeOf(sending, "sending"), message }, ":one": 1, ...request.values, ...window.values, ":approved": from },
            },
          },
          ...checks,
        ],
      }),
    ),
  );
}

/**
 * Has the agent's approved draft wait for its send limits, listed among its sends that wait, with
 * the `checks` written too, recorded in the mailbox's change feed under the agent. Returns false if
 * the draft is no longer approved for the same request, or a check failed.
 */
export function waitForLimit(table: Table, { mailbox, draft, approval, by, undoUntil }: Omit<Sending, "message">, approvedAt: string, checks: TransactItem[]): Promise<boolean> {
  const request = sameRequest({ approval, by });
  const window = sameWindow({ undoUntil });
  const waiting: WaitingSend = { mailbox, draft, approvedAt };
  return conditionally(
    recordChanges(table, mailboxFeed(mailbox), {
      by,
      changes: [{ type: "sendWaitingForLimit", draft, approval }],
      items: [
        {
          Update: {
            TableName: table.name,
            Key: draftKey(mailbox, draft),
            UpdateExpression: "SET #send.#state = :waiting, version = version + :one",
            ConditionExpression: `${request.condition} AND ${window.condition} AND #send.#state = :approved`,
            ExpressionAttributeNames: { "#send": "send", "#state": "state", ...request.names },
            ExpressionAttributeValues: { ":waiting": "waitingForLimit", ":one": 1, ...request.values, ...window.values, ":approved": "approved" },
          },
        },
        startWaiting(table, by, waiting),
        ...checks,
      ],
    }),
  );
}

/** The draft isn't waiting for its agent's send limits. */
export class NotWaitingForLimit extends Error {}

/**
 * Sends the draft waiting for its agent's send limits now, past them, on behalf of the agent's
 * sponsor `by`: it is approved again, marked to go past the limits, which the sender then sends,
 * and no longer listed among the agent's sends that wait. Recorded in the mailbox's change feed.
 * Throws NotWaitingForLimit if it isn't waiting.
 */
export function sendNow(table: Table, { mailbox, id, agent, by }: { mailbox: string; id: string; agent: string; by: string }): Promise<Draft> {
  return retried(async () => {
    const draft = await storedDraft(table, mailbox, id);
    const status = draft?.send;
    if (draft === undefined || status?.state !== "waitingForLimit") throw new NotWaitingForLimit();
    const approval = status.approval === undefined ? undefined : await findApproval(table, status.approval);
    const now: StoredDraft = { ...draft, send: { ...status, state: "approved", pastLimit: true }, version: draft.version + 1 };
    await recordChanges(table, mailboxFeed(mailbox), {
      by,
      changes: [{ type: "sentNow", draft: id, approval: status.approval }],
      items: [
        { Put: { TableName: table.name, Item: { ...draftKey(mailbox, id), ...now }, ...unchanged(draft) } },
        stopWaiting(table, agent, { mailbox, draft: id, approvedAt: approvedAt(draft, approval) }),
      ],
    });
    return draftOf(now);
  });
}

/**
 * Releases the agent's sends that the sender held while it was paused, in its sponsor's mailboxes,
 * where it sends as them: each draft still approved for the agent is written again, the first approved first, so the table's stream
 * hands it to the sender once more. Run again, it finishes what an earlier run left. The stream
 * keeps order within a mailbox, so sends from different mailboxes may go out in either order.
 */
export async function releaseHeldSends(table: Table, agent: Agent): Promise<void> {
  const mailboxes = (await ownedMailboxes(table, agent.sponsor)).map(({ id }) => id);
  const held: { mailbox: string; draft: StoredDraft; approvedAt: string }[] = [];
  for (const mailbox of mailboxes) {
    let start: Record<string, unknown> | undefined;
    do {
      const page = await documents(table).send(
        new QueryCommand({
          TableName: table.name,
          KeyConditionExpression: `${pk} = :mailbox AND begins_with(${sk}, :draft)`,
          FilterExpression: "#send.#state = :approved",
          ExpressionAttributeNames: { "#send": "send", "#state": "state" },
          ExpressionAttributeValues: { ":mailbox": mailboxKey(mailbox)[pk], ":draft": draftKey(mailbox, "")[sk], ":approved": "approved" },
          // An unpause finds a send the sender held just before it.
          ConsistentRead: true,
          ExclusiveStartKey: start,
        }),
      );
      for (const item of page.Items ?? []) {
        const draft = item as StoredDraft;
        const approval = draft.send?.approval === undefined ? undefined : await findApproval(table, draft.send.approval);
        if ((approval?.agent ?? draft.send?.by) !== agent.id) continue;
        held.push({ mailbox, draft, approvedAt: approvedAt(draft, approval) });
      }
      start = page.LastEvaluatedKey;
    } while (start !== undefined);
  }
  for (const { mailbox, draft } of held.sort((a, b) => a.approvedAt.localeCompare(b.approvedAt))) {
    // The sender may have taken it since it was read, so it is written only if it wasn't.
    await conditionally(
      documents(table).send(
        new UpdateCommand({ TableName: table.name, Key: draftKey(mailbox, draft.id), UpdateExpression: "SET version = version + :one", ...unchanged(draft), ExpressionAttributeValues: { ":one": 1, ":version": draft.version } }),
      ),
    );
  }
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
const sameRequest = ({ approval, by }: Pick<Sending, "approval" | "by">): { condition: string; names: Record<string, string>; values: Record<string, string> } =>
  approval === undefined
    ? { condition: "attribute_not_exists(#send.approval) AND #send.#by = :by", names: { "#by": "by" }, values: { ":by": by } }
    : { condition: "#send.approval = :approval", names: {}, values: { ":approval": approval } };

/**
 * The condition that the draft's send was approved with the same undo window as read, so an approval
 * undone and approved again since waits for its new window.
 */
const sameWindow = ({ undoUntil }: Pick<Sending, "undoUntil">): { condition: string; values: Record<string, string> } =>
  undoUntil === undefined ? { condition: "attribute_not_exists(#send.undoUntil)", values: {} } : { condition: "#send.undoUntil = :undoUntil", values: { ":undoUntil": undoUntil } };

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
  /** Until when its approver could undo the approval, as the sender read it. */
  undoUntil?: string;
}

/** A message the sender sent, by the ID SES gave it, so what SES reports about it finds it. */
export interface SentBySes {
  mailbox: string;
  draft: string;
  message: string;
  /** The actor whose send it was: the agent for an agent's draft. */
  by: string;
}

// What SES reports about a message it sent is in a partition of its own, by the ID SES gave it.
export const sesMessagePartition = (sesMessageId: string) => `ses-message#${sesMessageId}`;
const sentBySesKey = (sesMessageId: string) => ({ [pk]: sesMessagePartition(sesMessageId), [sk]: "sent" });

/** The message SES sent with the ID, as the sender recorded it, or undefined if the sender didn't send it. */
export async function sentBySes(table: Table, sesMessageId: string): Promise<SentBySes | undefined> {
  const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: sentBySesKey(sesMessageId), ConsistentRead: true }));
  return Item === undefined ? undefined : { mailbox: Item.mailbox, draft: Item.draft, message: Item.message, by: Item.by };
}

/**
 * Marks the draft sent as the message, which SES accepted with the ID `sesMessageId` and gave the
 * Message-ID its recipients see, and stores the message in the draft's thread, or in a new one if
 * it isn't a reply, where that Message-ID points at it, naming the approval it went out with, if it
 * needed one. A human's send from their own mailbox needs none. Returns false if the draft was no
 * longer sending it.
 */
export function markSent(
  table: Table,
  sending: Sending,
  {
    thread,
    sesMessageId,
    messageId,
    stored,
    text,
    approval,
  }: {
    thread: string | undefined;
    sesMessageId: string;
    messageId: string;
    stored: Omit<StoredMessage, "id" | "messageId" | "sentBy" | "approval">;
    text: string;
    approval: Approval | undefined;
  },
): Promise<boolean> {
  const { mailbox, draft, message, by } = sending;
  const once = (sentThread: string) => sendingSettles(table, sending, { ...outcomeOf(sending, "sent"), thread: sentThread, message, messageId });
  // The sender sends only drafts whose approval was decided, so it has a time.
  const approved = approval && { id: approval.id, approver: approval.approver, approvedAt: approval.decidedAt!, ...(approval.edits !== undefined && { edits: approval.edits }) };
  const sentBy: SentBySes = { mailbox, draft, message, by };
  return storeSentMessage(table, {
    mailbox,
    message: { ...stored, id: message, messageId, sentBy: by, ...(approved !== undefined && { approval: approved }) },
    text,
    thread,
    draft,
    once,
    also: [{ Put: { TableName: table.name, Item: { ...sentBySesKey(sesMessageId), ...sentBy } } }],
  });
}

/**
 * The write that adds what SES reported to the send of the draft, if it is still the draft that
 * sent the message, or undefined if it isn't, as when it was deleted.
 */
export async function feedbackOnSend(table: Table, { mailbox, draft, message }: SentBySes, feedback: SendFeedback): Promise<TransactItem | undefined> {
  const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: draftKey(mailbox, draft), ConsistentRead: true }));
  if ((Item as StoredDraft | undefined)?.send?.message !== message) return undefined;
  return {
    Update: {
      TableName: table.name,
      Key: draftKey(mailbox, draft),
      UpdateExpression: "SET #send.feedback = list_append(if_not_exists(#send.feedback, :none), :feedback), version = version + :one",
      ConditionExpression: "#send.message = :message",
      ExpressionAttributeNames: { "#send": "send" },
      ExpressionAttributeValues: { ":none": [], ":feedback": [feedback], ":one": 1, ":message": message },
    },
  };
}

/** Marks the draft failed with SES's reason, which those who read the mailbox see, with the items written too. Returns false if it was no longer sending. */
export function markFailed(table: Table, sending: Sending, reason: string, items: TransactItem[] = []): Promise<boolean> {
  const { mailbox, draft, approval, by } = sending;
  return conditionally(
    recordChanges(table, mailboxFeed(mailbox), {
      by,
      changes: [{ type: "sendFailed", draft, approval, reason }],
      items: [sendingSettles(table, sending, { ...outcomeOf(sending, "failed"), reason }), ...outcomeKept(table, approval, { state: "failed", reason }), ...items],
    }),
  );
}

/** The write that keeps how the send went on the approval that let it go, if it needed one. */
const outcomeKept = (table: Table, approval: string | undefined, outcome: SendOutcome): TransactItem[] =>
  approval === undefined
    ? []
    : [{ Update: { TableName: table.name, Key: approvalKey(approval), UpdateExpression: "SET outcome = :outcome", ExpressionAttributeValues: { ":outcome": outcome } } }];

/**
 * Keeps on the approval that the send went out as the message in the thread, so the approval log
 * says so after the draft is gone. Run again, it writes the same. An approval erased meanwhile stays erased.
 */
export async function keepSent(table: Table, approval: string, sent: { thread: string; message: string }): Promise<void> {
  await conditionally(
    documents(table).send(
      new UpdateCommand({ TableName: table.name, Key: approvalKey(approval), UpdateExpression: "SET outcome = :outcome", ConditionExpression: `attribute_exists(${pk})`, ExpressionAttributeValues: { ":outcome": { state: "sent", ...sent } } }),
    ),
  );
}

/**
 * Marks the draft unclear: sending it stopped before SES answered, so a human checks whether it
 * went out, and Duva never sends it again. Without SES's answer, the Message-ID its recipients see
 * is unknown. The items are written too. Returns false if it was no longer sending.
 */
export function markUnclear(table: Table, sending: Sending, items: TransactItem[] = []): Promise<boolean> {
  const { mailbox, draft, approval, by } = sending;
  return conditionally(
    recordChanges(table, mailboxFeed(mailbox), {
      by,
      changes: [{ type: "sendUnclear", draft, approval }],
      items: [sendingSettles(table, sending, outcomeOf(sending, "unclear")), ...outcomeKept(table, approval, { state: "unclear" }), ...items],
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
