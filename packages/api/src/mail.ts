// The mail in a mailbox: its threads, their messages and labels, and the mailbox's change feed.
// Everything is in the mailbox's own partitions. A message's body stays in the raw message in the
// mail bucket, and is read from there.
import { randomUUID } from "node:crypto";
import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { BatchGetCommand, type BatchGetCommandOutput, GetCommand, PutCommand, QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import type { components } from "@duva/openapi";
import type { Table } from "./deployment.ts";
import { changesAfter, changesPerPage, recordChanges } from "./feed.ts";
import type { MailBucket } from "./mail-bucket.ts";
import { contentIdsIn, serveHtml, type ServedHtml } from "./html.ts";
import { type ParsedMail, type Part, parseMail } from "./mime.ts";
import { readableLine } from "./readable-line.ts";
import { allMailboxes, defaultAgentSettings, mailboxFeed, mailboxKey } from "./organization.ts";
import { documents, isNew, pk, sk, type TransactItem } from "./table.ts";

export type ThreadSummary = components["schemas"]["ThreadSummary"];
export type ThreadList = components["schemas"]["ThreadList"];
export type Thread = components["schemas"]["Thread"];
export type Message = components["schemas"]["Message"];
export type MailboxChange = components["schemas"]["MailboxChange"];
export type MailboxChangePage = components["schemas"]["MailboxChangePage"];
// Duva records the recipients of all it is told, and leaves them out only of an admin's activity.
export type SendFeedback = components["schemas"]["SendFeedback"] & { recipients: string[] };
export type { StoredMessage };

/** The label new mail gets. */
export const inbox = "inbox";
/** The label for newsletters, which a sender's delivery files their mail under instead of the Inbox. */
export const feed = "feed";
/** The label for receipts and notifications, likewise. */
export const paperTrail = "paperTrail";
/** The labels that say where a thread lies: one at most, which adding another replaces. */
const places = [inbox, feed, paperTrail];
/** The label mail SES judged to be spam gets instead. */
export const spam = "spam";
/** The label deleted threads get. */
export const trash = "trash";
/**
 * The built-in state of threads waiting in the Screener, kept among their labels. No actor adds or
 * removes it as a label: deciding on the sender does, or adding the Inbox.
 */
export const screener = "screener";

/** How many threads a page of a listing gives at most. */
export const threadsPerPage = 100;

/** How many threads one request can mark at once. */
export const threadsMarkedAtOnce = 100;

/** How long a thread's snippet is at most, before the ellipsis. */
const snippetLength = 200;

const partition = (mailbox: string) => mailboxKey(mailbox)[pk]!;
// A thread's messages sort before the thread itself, oldest first, and nothing else starts with its prefix.
const threadPrefix = (thread: string) => `thread#${thread}#`;
const threadKey = (mailbox: string, thread: string) => ({ [pk]: partition(mailbox), [sk]: `${threadPrefix(thread)}thread` });
const messageKey = (mailbox: string, thread: string, receivedAt: string, message: string) => ({
  [pk]: partition(mailbox),
  [sk]: `${threadPrefix(thread)}message#${receivedAt}#${message}`,
});
// Each listing lists its threads by their place, each with its summary: each label, Sent, All mail and Remind me.
const listingKey = (mailbox: string, listing: Listing, place: string, thread: string) => ({
  [pk]: `${partition(mailbox)}#${listing}`,
  [sk]: `${place}#${thread}`,
});
/**
 * The thread's place in the listing: in Remind me when it comes back, and elsewhere when its
 * newest message arrived, or when it came back from Remind me if that was later, so it comes back
 * to the top.
 */
const placeIn = (listing: Listing, { latestAt, reminder, back }: ThreadSummary): string =>
  listing === reminders ? reminder!.at : back !== undefined && back.at > latestAt ? back.at : latestAt;
/** The thread's entry in the listing, at its place there. */
const entryIn = (mailbox: string, listing: Listing, summary: ThreadSummary) => listingKey(mailbox, listing, placeIn(listing, summary), summary.id);
// A page of a listing's threads ends at an entry, whose sort key is the next page's cursor.
const labelPosition = /^\d{4}-\d\d-\d\dT[\d:.]+Z#[\w-]+$/;
const cursorAt = (position: string) => Buffer.from(position).toString("base64url");
// Each Message-ID points at its message, so a reply can find the thread it belongs in.
const messageIdKey = (mailbox: string, messageId: string) => ({ [pk]: partition(mailbox), [sk]: `message-id#${messageId}` });
// Each message in Duva points at its thread and its place there, so a reply can find what it answers.
const messageRefKey = (mailbox: string, message: string) => ({ [pk]: partition(mailbox), [sk]: `message#${message}` });
// Each SES message is stored once per mailbox, however often SES's event is processed.
const receivedKey = (mailbox: string, sesMessageId: string) => ({ [pk]: partition(mailbox), [sk]: `received#${sesMessageId}` });
// Each SES message whose sender's mail goes nowhere is dropped once per mailbox, likewise.
const droppedKey = (mailbox: string, sesMessageId: string) => ({ [pk]: partition(mailbox), [sk]: `dropped#${sesMessageId}` });
// Each message another member sent as a group is copied to the mailbox once, by the sent message's ID in Duva.
const copiedKey = (mailbox: string, message: string) => ({ [pk]: partition(mailbox), [sk]: `copied#${message}` });
// Each address the mailbox has sent to is noted, in lower case, so mail from it skips the Screener.
const sentToKey = (mailbox: string, address: string) => ({ [pk]: partition(mailbox), [sk]: `sent-to#${address.toLowerCase()}` });
// Each thread in Spam or Trash is listed, across mailboxes, by when it got the label, so the eraser finds those past the retention period.
const labelledKey = (labelledAt: string, mailbox: string, thread: string, label: ErasedLabel) => ({ [pk]: "erasure#labelled", [sk]: `${labelledAt}#${mailbox}#${thread}#${label}` });

/** What erasure.ts, and the test harness's deployment from before the Screener, need of how a mailbox's mail is stored. */
// A thread's own item's sort key, which no message's matches, gives back its thread's ID.
const threadOf = (sortKey: string) => /^thread#(.+)#thread$/.exec(sortKey)?.[1];

export const keys = { partition, threadPrefix, threadKey, threadOf, messageIdKey, messageRefKey, receivedKey, labelledKey, entryIn, sentToKey };

/** A message SES received for one of the mailbox's addresses. */
export interface Arrival {
  mailbox: string;
  /** The ID SES gave the message, which is the same each time its event is processed. */
  sesMessageId: string;
  /** Where the raw message is in the mail bucket. */
  rawKey: string;
  /** The mailbox's address SES delivered it to, with its plus tag, or the group's it came through. */
  recipient: string;
  plusTag?: string;
  /** The address of the group it came through, if it is a member's copy. */
  group?: string;
  /** The envelope sender, for mail without a From. */
  sender: string;
  receivedAt: string;
  parsed: ParsedMail;
  /** Whether SES judged the message to be spam. */
  spam: boolean;
  /** Whether Duva knows an agent sent it, by its disclosure header on mail from the organization's domain with a DMARC pass. */
  fromAgent: boolean;
  /** The sender's logo, if their domain publishes one Duva shows (ADR-0023). */
  logo?: components["schemas"]["SenderLogo"];
  /** Where the message goes, as the Screener decided, and the writes that hold only while that decision does. */
  screening?: Screening;
}

/**
 * Where a message goes, as the mailbox's Screener decides from its sender's delivery: the label a
 * thread it starts gets, the Inbox or the Screener or where the delivery files it, and the one a
 * thread it joins gets. `screened` and `delivered` say what its arrival's change says. Its items go in the same transaction as the
 * message, and a condition among them that fails throws ScreeningChanged.
 */
export interface Screening {
  label: string;
  joined: string;
  screened?: "waiting";
  delivered?: components["schemas"]["Delivery"];
  items: TransactItem[];
}

/** What the Screener decided from changed before the message was stored, so it decides again. */
export class ScreeningChanged extends Error {}

/** The labels whose threads are erased once they have had them for the retention period. */
export type ErasedLabel = typeof spam | typeof trash;
const erasedLabels: ErasedLabel[] = [spam, trash];

/**
 * A thread's summary as stored, with whether the mailbox sent in it and when it got Spam and Trash
 * if it has them. Threads stored before Sent existed don't say, and those that got Spam or Trash
 * before erasure existed have no time for it.
 */
export type StoredSummary = ThreadSummary & { sent?: boolean; labelledAt?: Partial<Record<ErasedLabel, string>> };

/** How many of the messages a reply names are looked up, newest first, to find its thread. */
const answersLookedUp = 100;

/** A message as the mailbox stores it. Its body stays in the raw message. */
interface StoredMessage {
  id: string;
  messageId?: string;
  from: components["schemas"]["EmailAddress"];
  to: components["schemas"]["EmailAddress"][];
  cc: components["schemas"]["EmailAddress"][];
  /** The Bcc recipients, of a message sent from the mailbox only. */
  bcc?: components["schemas"]["EmailAddress"][];
  recipient: string;
  plusTag?: string;
  /** The address of the group it came through, if it is a member's copy. */
  group?: string;
  subject: string;
  date: string;
  receivedAt: string;
  sentBy?: string;
  /** On a copy of what another member sent as a group, who sent it and as which group. */
  sentAs?: components["schemas"]["SentAsGroup"];
  /** Set when Duva knows an agent sent it. */
  fromAgent?: true;
  /** The sender's logo, on received mail whose sender's domain publishes one Duva shows. */
  logo?: components["schemas"]["SenderLogo"];
  /** The approval an agent's message went out with. */
  approval?: components["schemas"]["SentApproval"];
  /** What SES reported about a message sent from the mailbox, oldest first. */
  feedback?: SendFeedback[];
  /** Where the raw message is in the mail bucket. */
  rawKey: string;
}

/**
 * Stores the message in the thread of the first message it answers that the mailbox has, in the
 * order of ParsedMail's answers, or as a new thread, with the label its screening gives either,
 * the Inbox without one. Spam is kept apart instead: it starts its own thread with the Spam label,
 * and no reply joins that thread. Records its arrival in the mailbox's change feed, naming no
 * actor. Returns false if the mailbox already has it, and throws ScreeningChanged if a condition
 * of its screening failed.
 */
export async function receiveMessage(table: Table, arrival: Arrival): Promise<boolean> {
  const { mailbox, sesMessageId, rawKey, recipient, plusTag, group, sender, receivedAt, parsed } = arrival;
  const screening = arrival.spam ? undefined : arrival.screening;
  const label = (joined: boolean) => (arrival.spam ? spam : ((joined ? screening?.joined : screening?.label) ?? inbox));
  const { Item: received } = await documents(table).send(new GetCommand({ TableName: table.name, Key: receivedKey(mailbox, sesMessageId), ConsistentRead: true }));
  if (received !== undefined) return false;

  const message: StoredMessage = {
    id: randomUUID(),
    messageId: parsed.messageId,
    from: parsed.from ?? { address: sender },
    to: parsed.to,
    cc: parsed.cc,
    recipient,
    plusTag,
    group,
    subject: parsed.subject,
    date: parsed.date ?? receivedAt,
    receivedAt,
    rawKey,
    ...(arrival.fromAgent && { fromAgent: true }),
    ...(arrival.logo !== undefined && { logo: arrival.logo }),
  };
  return storeMessage(table, {
    mailbox,
    message,
    text: parsed.text,
    thread: async () => (arrival.spam ? undefined : threadAnswered(table, mailbox, parsed.answers)),
    label,
    // Mail makes its thread unread, unless the thread lies only in the Feed or the Paper Trail, which are read as they come.
    unread: (labels) => labels.includes(inbox) || !labels.some((label) => label === feed || label === paperTrail),
    findable: !arrival.spam,
    by: undefined,
    change: (thread, joined, labels) => ({
      type: "messageReceived",
      thread,
      message: message.id,
      ...(arrival.spam ? { spam: true } : {}),
      ...(!joined && screening?.screened !== undefined && { screened: screening.screened }),
      ...(screening?.delivered !== undefined && { delivered: screening.delivered }),
      // A thread in Spam or Trash, or lying in another place, doesn't get the delivery's label.
      ...(screening?.delivered !== undefined && labels.includes(label(joined)) && { deliveredTo: label(joined) }),
    }),
    once: () => ({ Put: { TableName: table.name, Item: receivedKey(mailbox, sesMessageId), ...isNew } }),
    checks: screening?.items ?? [],
  });
}

/**
 * Drops the message from the address, whose mail goes nowhere, keeping none of it, and records
 * the drop in the mailbox's change feed, naming no actor, in one transaction with the checks.
 * Returns false if the mailbox already dropped or stored it, and throws ScreeningChanged if a
 * check's condition failed.
 */
export async function dropMessage(table: Table, { mailbox, sesMessageId, address, checks }: { mailbox: string; sesMessageId: string; address: string; checks: TransactItem[] }): Promise<boolean> {
  const { Item: received } = await documents(table).send(new GetCommand({ TableName: table.name, Key: receivedKey(mailbox, sesMessageId), ConsistentRead: true }));
  if (received !== undefined) return false;
  try {
    await recordChanges(table, mailboxFeed(mailbox), {
      by: undefined,
      changes: [{ type: "messageDropped", address }],
      items: [{ Put: { TableName: table.name, Item: droppedKey(mailbox, sesMessageId), ...isNew } }, ...checks],
    });
    return true;
  } catch (error) {
    // recordChanges gives the items' cancellation reasons after the counter's and the one change's.
    const reasons = error instanceof TransactionCanceledException ? (error.CancellationReasons ?? []) : [];
    if (reasons[2]?.Code === "ConditionalCheckFailed") return false;
    if (reasons.slice(3).some((reason) => reason.Code === "ConditionalCheckFailed")) throw new ScreeningChanged();
    throw error;
  }
}

/**
 * Stores the message the actor `sentBy` sent from the mailbox, which SES accepted, in the thread
 * of the message it answers, whose read state it keeps, or as a new read thread without labels.
 * Either way Sent lists the thread. `once` gives the write that marks
 * the draft sent in the thread, on condition that it is still sending, so the message is stored once, and `also`
 * any other writes that go with it. Records the send in the mailbox's change feed, naming the sender.
 * Returns false if `once`'s condition failed.
 */
export async function storeSentMessage(
  table: Table,
  {
    mailbox,
    message,
    text,
    thread,
    draft,
    once,
    also,
  }: { mailbox: string; message: StoredMessage & { sentBy: string }; text: string; thread: string | undefined; draft: string; once: (thread: string) => TransactItem; also: TransactItem[] },
): Promise<boolean> {
  // SES accepted the message, so the mailbox has sent to its recipients whether or not it is stored.
  const recipients = new Set([...message.to, ...message.cc, ...(message.bcc ?? [])].map(({ address }) => address.toLowerCase()));
  await noteSentTo(table, mailbox, recipients);
  return storeMessage(table, {
    mailbox,
    message,
    text,
    thread: async () => (thread === undefined ? undefined : threadSummary(table, mailbox, thread)),
    findable: true,
    sent: true,
    by: message.sentBy,
    change: (id) => ({ type: "messageSent", draft, thread: id, message: message.id }),
    once,
    also,
  });
}

/**
 * Stores the copy of the message with the ID `sent` that another member sent as a group, once, in
 * the thread of the first message it answers that the mailbox has, whose labels and read state it
 * keeps, or as a new read thread without labels, so only All mail lists it. Replies to it join its
 * thread. Records it in the mailbox's change feed as arriving mail, naming no actor. Returns false if
 * the mailbox already has it.
 */
export function storeGroupCopy(
  table: Table,
  { mailbox, sent, message, text, answers }: { mailbox: string; sent: string; message: StoredMessage & { sentAs: components["schemas"]["SentAsGroup"] }; text: string; answers: string[] },
): Promise<boolean> {
  return storeMessage(table, {
    mailbox,
    message,
    text,
    thread: () => threadAnswered(table, mailbox, answers),
    findable: true,
    by: undefined,
    change: (thread) => ({ type: "messageReceived", thread, message: message.id }),
    once: () => ({ Put: { TableName: table.name, Item: copiedKey(mailbox, sent), ...isNew } }),
  });
}

/** Whether Duva sent the message with the Message-ID from the mailbox. */
export async function sentFromMailbox(table: Table, mailbox: string, messageId: string): Promise<boolean> {
  const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: messageIdKey(mailbox, messageId), ConsistentRead: true }));
  if (Item === undefined) return false;
  return (await storedMessage(table, mailbox, Item.message as string))?.sentBy !== undefined;
}

/**
 * Stores the message in the thread `thread` finds, or else in a new one, with the label `label`
 * gives for either if it gives one, in one transaction with the write `once` gives for the thread,
 * the checks, and the change in the mailbox's change feed. If `findable`, its Message-ID points at
 * it, so replies to it join its thread. If `unread` is given, the thread becomes unread or read. If
 * `sent`, Sent lists the thread from then on. If the message is the thread's newest, its text gives the thread's snippet. `also`
 * gives unconditional writes that go with it. Returns false if that write's condition failed, since then the
 * message is already stored, and throws ScreeningChanged if a check's did.
 */
async function storeMessage(
  table: Table,
  { mailbox, message, text, thread: find, label: labelFor, unread, findable, sent, by, change, once, also = [], checks = [] }: {
    mailbox: string;
    message: StoredMessage;
    text: string;
    thread: () => Promise<StoredSummary | undefined>;
    label?: (joined: boolean) => string;
    unread?: boolean | ((labels: string[]) => boolean);
    findable: boolean;
    sent?: boolean;
    by: string | undefined;
    change: (thread: string, joined: boolean, labels: string[]) => object;
    once: (thread: string) => TransactItem;
    also?: TransactItem[];
    checks?: TransactItem[];
  },
): Promise<boolean> {
  const { id, receivedAt } = message;
  // recordChanges gives the items' cancellation reasons after the counter's and the one change's.
  const [onceReason, threadReason] = [2, 3];
  const put = (Item: Record<string, unknown>, condition = {}) => ({ Put: { TableName: table.name, Item, ...condition } });
  for (let attempt = 1; ; attempt++) {
    const joined = await find();
    const label = labelFor?.(joined !== undefined);
    const thread = joined?.id ?? randomUUID();
    const newest = joined === undefined || receivedAt > joined.latestAt;
    // A member's copy, of mail to the group or of what another member sent as it, marks its thread with the group.
    const group = message.group ?? message.sentAs?.group;
    const groups = group === undefined || joined?.groups?.includes(group) ? joined?.groups : [...(joined?.groups ?? []), group];
    const summary: StoredSummary =
      joined === undefined
        ? {
            id: thread,
            subject: message.subject,
            from: message.from,
            ...(message.fromAgent && { fromAgent: true }),
            ...(message.logo !== undefined && { logo: message.logo }),
            snippet: snippetOf(text),
            labels: label === undefined ? [] : [label],
            unread: false,
            latestAt: receivedAt,
            messages: 1,
            ...(groups !== undefined && { groups }),
            ...(sent && { sent }),
          }
        : {
            ...joined,
            snippet: newest ? snippetOf(text) : joined.snippet,
            // New mail brings a thread back to where it goes, unless it is in Spam or Trash, waits in the Screener or lies somewhere already.
            labels: label === undefined || joined.labels.includes(label) || hidden(joined) || (places.includes(label) && joined.labels.some((each) => places.includes(each))) ? joined.labels : [...joined.labels, label],
            unread: joined.unread,
            latestAt: newest ? receivedAt : joined.latestAt,
            messages: joined.messages + 1,
            ...(groups !== undefined && { groups }),
            ...((sent || joined.sent) && { sent: true }),
          };
    summary.unread = typeof unread === "function" ? unread(summary.labels) : (unread ?? summary.unread);
    timeErasedLabels(joined, summary);
    // New mail brings a thread set aside back early.
    const early = joined?.reminder !== undefined && label !== undefined;
    if (early) comeBack(summary, new Date());
    const items = [
      once(thread),
      put({ ...threadKey(mailbox, thread), ...summary }, joined === undefined ? isNew : asRead(joined)),
      put({ ...messageKey(mailbox, thread, receivedAt, id), ...message, thread }),
      ...listingWrites(table, mailbox, joined, summary),
      ...labelledWrites(table, mailbox, joined, summary),
      ...(message.messageId === undefined || !findable ? [] : [put({ ...messageIdKey(mailbox, message.messageId), thread, message: id })]),
      put({ ...messageRefKey(mailbox, id), thread, receivedAt }),
      ...also,
      ...checks,
    ];
    try {
      const changes = [change(thread, joined !== undefined, summary.labels), ...(early ? [{ type: "threadBack", thread, setAsideAt: joined.reminder!.setAt, early: true }] : [])];
      await recordChanges(table, mailboxFeed(mailbox), { by, changes, items });
      return true;
    } catch (error) {
      const reasons = error instanceof TransactionCanceledException ? (error.CancellationReasons ?? []) : [];
      // Another processing of the same event stored it first.
      if (reasons[onceReason]?.Code === "ConditionalCheckFailed") return false;
      if (reasons.slice(onceReason + items.length - checks.length).some((reason) => reason.Code === "ConditionalCheckFailed")) throw new ScreeningChanged();
      // Another message changed the thread since it was read, so it is read again.
      if (reasons[threadReason]?.Code !== "ConditionalCheckFailed" || attempt === 10) throw error;
    }
  }
}

/**
 * The condition that a thread is as it was read, so changes made together each count. Threads
 * stored before read state existed have none, and are read.
 */
export function asRead({ messages, labels, unread, reminder }: ThreadSummary) {
  return {
    ConditionExpression: [
      "messages = :messages AND labels = :labels",
      unread ? "unread = :unread" : "(unread = :unread OR attribute_not_exists(unread))",
      reminder === undefined ? "attribute_not_exists(reminder)" : "reminder.#at = :reminderAt",
    ].join(" AND "),
    ...(reminder !== undefined && { ExpressionAttributeNames: { "#at": "at" } }),
    ExpressionAttributeValues: { ":messages": messages, ":labels": labels, ":unread": unread, ...(reminder !== undefined && { ":reminderAt": reminder.at }) },
  };
}

/**
 * Marks each thread unread or read, with a change in the mailbox's change feed attributed to the
 * actor `by` for each that wasn't already, and returns the threads as they are now, in the order
 * given. Returns the IDs the mailbox has no thread for instead, and marks none, if there are any.
 */
export function markThreads(
  table: Table,
  { mailbox, threads, unread, by }: { mailbox: string; threads: string[]; unread: boolean; by: string },
): Promise<{ threads: ThreadSummary[] } | { missing: string[] }> {
  return changeThreads(table, { mailbox, threads, by }, (current) =>
    current.unread === unread ? undefined : { summary: { ...current, unread }, change: { type: unread ? "threadUnread" : "threadRead", thread: current.id } },
  );
}

/**
 * Adds and removes the labels on each thread, with the built-in labels' rules: Spam and Trash
 * each take a thread out of the Inbox, removing one puts it back unless it has the other, waits in
 * the Screener, lies in the Feed or the Paper Trail, or the Inbox is removed too, the Inbox takes it
 * out of all three, and the Inbox, the Feed and the Paper Trail each take it out of the others. Records a change in the mailbox's change feed attributed to the actor
 * `by` for each thread whose labels change, and returns the threads as they are now, in the order
 * given. Returns the IDs the mailbox has no thread for instead, and labels none, if there are any.
 */
export function labelThreads(
  table: Table,
  { mailbox, threads, add, remove, by }: { mailbox: string; threads: string[]; add: string[]; remove: string[]; by: string },
): Promise<{ threads: ThreadSummary[] } | { missing: string[] }> {
  return changeThreads(table, { mailbox, threads, by }, (current) => {
    const labels = relabelled(current.labels, add, remove);
    const added = labels.filter((label) => !current.labels.includes(label));
    const removed = current.labels.filter((label) => !labels.includes(label));
    if (added.length === 0 && removed.length === 0) return undefined;
    return { summary: { ...current, labels }, change: { type: "threadLabelsChanged", thread: current.id, added, removed } };
  });
}

/**
 * Sets each thread aside in Remind me until the time, to the second: it leaves the Inbox if it is
 * there, and one already set aside gets the new time, keeping when it was first set aside. Records
 * the reminder in the mailbox's change feed attributed to the actor `by`, with its leaving the
 * Inbox. Returns the threads as they are now, in the order given, or the IDs the mailbox has no
 * thread for, or else those in Spam or Trash or waiting in the Screener, and changes none, if there are any.
 */
export async function setThreadsAside(
  table: Table,
  { mailbox, threads, at, by }: { mailbox: string; threads: string[]; at: Date; by: string },
): Promise<{ threads: ThreadSummary[] } | { missing: string[] } | { hidden: string[] }> {
  const found = await Promise.all(threads.map((thread) => threadSummary(table, mailbox, thread)));
  const shut = found.filter((summary): summary is StoredSummary => summary !== undefined && hidden(summary)).map(({ id }) => id);
  if (shut.length > 0 && !found.includes(undefined)) return { hidden: shut };
  const until = toTheSecond(at);
  const setAt = toTheSecond(new Date());
  return changeThreads(table, { mailbox, threads, by }, (current) => {
    // Moved to Spam or Trash meanwhile, it stays there.
    if (hidden(current) || current.reminder?.at === until) return undefined;
    const labels = current.labels.filter((label) => label !== inbox);
    const { back: _, ...summary } = current;
    return {
      summary: { ...summary, labels, reminder: { at: until, setAt: current.reminder?.setAt ?? setAt } },
      change: [
        { type: "reminderSet", thread: current.id, until },
        ...(labels.length < current.labels.length ? [{ type: "threadLabelsChanged", thread: current.id, added: [], removed: [inbox] }] : []),
      ],
    };
  });
}

/**
 * Cancels each thread's reminder, which puts it back in the Inbox at its own place, recorded in
 * the mailbox's change feed attributed to the actor `by`. Threads not set aside are left as they
 * are. Returns the threads as they are now, in the order given, or the IDs the mailbox has no
 * thread for instead, changing none, if there are any.
 */
export function endReminders(table: Table, { mailbox, threads, by }: { mailbox: string; threads: string[]; by: string }): Promise<{ threads: ThreadSummary[] } | { missing: string[] }> {
  return changeThreads(table, { mailbox, threads, by }, (current) => {
    if (current.reminder === undefined) return undefined;
    const { reminder: _, ...summary } = current;
    const added = current.labels.includes(inbox) ? [] : [inbox];
    return {
      summary: { ...summary, labels: [...current.labels, ...added] },
      change: [
        { type: "reminderCancelled", thread: current.id },
        ...(added.length > 0 ? [{ type: "threadLabelsChanged", thread: current.id, added, removed: [] }] : []),
      ],
    };
  });
}

/**
 * Brings the thread back from Remind me, if it is still set aside until the time `at`, as its
 * reminder's schedule asks when the time comes: to the top of the Inbox, unread, with its Back
 * mark. Records it in the mailbox's change feed, naming no actor.
 */
export async function bringBack(table: Table, { mailbox, thread, at }: { mailbox: string; thread: string; at: string }): Promise<void> {
  await changeThreads(table, { mailbox, threads: [thread], by: undefined }, (current) => {
    const { reminder } = current;
    if (reminder?.at !== at) return undefined;
    const summary = { ...current, unread: true };
    comeBack(summary, new Date(at));
    return { summary, change: { type: "threadBack", thread: current.id, setAsideAt: reminder.setAt } };
  });
}

/** Has the thread set aside come back at the time: to the Inbox with its Back mark, its reminder ended. */
function comeBack(summary: StoredSummary, at: Date) {
  if (!summary.labels.includes(inbox)) summary.labels = [...summary.labels, inbox];
  summary.back = { at: toTheSecond(at), setAsideAt: summary.reminder!.setAt };
  delete summary.reminder;
}

/** The time as an ISO string, to the second, as schedules run. */
const toTheSecond = (at: Date) => new Date(Math.floor(at.getTime() / 1000) * 1000).toISOString();

/** The labels after adding and removing those given, with the built-in labels' rules. */
function relabelled(labels: string[], add: string[], remove: string[]): string[] {
  const placed = places.filter((place) => add.includes(place));
  const out = new Set([
    ...remove,
    ...(add.includes(inbox) ? [spam, trash, screener] : []),
    ...(placed.length > 0 ? places.filter((place) => !placed.includes(place)) : []),
    ...(add.includes(spam) || add.includes(trash) ? [inbox] : []),
  ]);
  const next = [...labels.filter((label) => !out.has(label)), ...add.filter((label) => !labels.includes(label))];
  const restored = labels.some((label) => (label === spam || label === trash) && !next.includes(label));
  return restored && !remove.includes(inbox) && ![spam, trash, screener, ...places].some((label) => next.includes(label)) ? [...next, inbox] : [...new Set(next)];
}

/**
 * Changes each thread as `change` says, in its own transaction with the changes in the mailbox's
 * change feed attributed to the actor `by`, or to none, and leaves those it answers undefined for
 * as they are. A thread that leaves the Inbox loses its Back mark, and one set aside that is moved
 * to the Inbox, Spam or Trash has its reminder end. Returns the threads as they are now, in the
 * order given, or the IDs the mailbox has no thread for instead, changing none, if there are any.
 */
async function changeThreads(
  table: Table,
  { mailbox, threads, by }: { mailbox: string; threads: string[]; by: string | undefined },
  change: (current: StoredSummary) => { summary: StoredSummary; change: object | object[] } | undefined,
): Promise<{ threads: ThreadSummary[] } | { missing: string[] }> {
  const found = await Promise.all(threads.map((thread) => threadSummary(table, mailbox, thread)));
  const missing = threads.filter((_, index) => found[index] === undefined);
  if (missing.length > 0) return { missing };
  // recordChanges gives the items' cancellation reasons after the counter's and the one change's.
  const threadReason = 2;
  const changed = [];
  for (let [index, current] of found.entries()) {
    for (let attempt = 1; ; attempt++) {
      const next = change(current!);
      if (next === undefined) break;
      const changes = [next.change].flat();
      timeErasedLabels(current, next.summary);
      if (!next.summary.labels.includes(inbox)) delete next.summary.back;
      if (next.summary.reminder !== undefined && [inbox, spam, trash].some((label) => next.summary.labels.includes(label))) {
        delete next.summary.reminder;
        changes.push({ type: "reminderCancelled", thread: current!.id });
      }
      try {
        await recordChanges(table, mailboxFeed(mailbox), {
          by,
          changes,
          items: [
            { Put: { TableName: table.name, Item: { ...threadKey(mailbox, current!.id), ...next.summary }, ...asRead(current!) } },
            ...listingWrites(table, mailbox, current, next.summary),
            ...labelledWrites(table, mailbox, current, next.summary),
          ],
        });
        current = next.summary;
        break;
      } catch (error) {
        // Mail joined the thread since its summary was fetched, or it was changed, so it is fetched again.
        const reasons = error instanceof TransactionCanceledException ? (error.CancellationReasons ?? []) : [];
        if (reasons[threadReason]?.Code !== "ConditionalCheckFailed" || attempt === 10) throw error;
        current = await threadSummary(table, mailbox, threads[index]!);
        // The thread was erased meanwhile, so it is left out.
        if (current === undefined) break;
      }
    }
    if (current !== undefined) changed.push(current);
  }
  return { threads: changed.map(summaryOf) };
}

/**
 * A listing a thread can be in: one of its labels, Sent if the mailbox sent in it, All mail, Remind
 * me while it is set aside, or the threads from an address or from everyone at a domain, by the
 * thread's first message, in lower case.
 */
type Listing = `label#${string}` | "sent" | "all" | typeof reminders | `from#${string}` | `from-domain#${string}`;

/** The listing of the threads set aside in Remind me, soonest back first. */
const reminders = "reminders";

/** The listing of the threads from the address, or from everyone at exactly the domain. */
export const fromListing = (sender: { address: string } | { domain: string }): Listing => ("address" in sender ? `from#${sender.address}` : `from-domain#${sender.domain}`);

/** Whether the thread is in Spam or Trash, or waits in the Screener, which leaves it out of every listing but those. */
const hidden = ({ labels }: ThreadSummary) => labels.includes(spam) || labels.includes(trash) || labels.includes(screener);

/**
 * The listings the thread is in: each of its labels, Sent if the mailbox sent in it, All mail
 * unless it is in Spam or Trash or waits in the Screener, Remind me while it is set aside, and
 * those of the address and the domain it is from.
 */
export const listingsOf = (summary: StoredSummary): Listing[] => {
  const address = summary.from.address.toLowerCase();
  return [
    ...summary.labels.map((label) => `label#${label}` as const),
    ...(summary.sent ? (["sent"] as const) : []),
    ...(hidden(summary) ? [] : (["all"] as const)),
    ...(summary.reminder === undefined ? [] : ([reminders] as const)),
    fromListing({ address }),
    fromListing({ domain: address.slice(address.lastIndexOf("@") + 1) }),
  ];
};

/**
 * The writes that move the thread's entries in its listings from how it was to how it is: an entry
 * in each listing it is in, at its place there, and none where it was and isn't. A delete and a put
 * of the same item can't share a transaction, so an entry that keeps its place is overwritten.
 */
function listingWrites(table: Table, mailbox: string, was: StoredSummary | undefined, is: StoredSummary): TransactItem[] {
  const listings = listingsOf(is);
  const left = was === undefined ? [] : listingsOf(was).filter((listing) => !listings.includes(listing) || placeIn(listing, was) !== placeIn(listing, is));
  return [
    ...left.map((listing) => ({ Delete: { TableName: table.name, Key: entryIn(mailbox, listing, was!) } })),
    ...listings.map((listing) => ({ Put: { TableName: table.name, Item: { ...entryIn(mailbox, listing, is), ...is } } })),
  ];
}

/**
 * Gives the summary the time it got Spam and Trash, if it has them: the time it had before, or
 * now if it just got the label.
 */
function timeErasedLabels(was: StoredSummary | undefined, is: StoredSummary) {
  const now = new Date().toISOString();
  const labelledAt = Object.fromEntries(
    erasedLabels.filter((label) => is.labels.includes(label)).flatMap((label) => {
      const at = was?.labels.includes(label) ? was.labelledAt?.[label] : now;
      return at === undefined ? [] : [[label, at]];
    }),
  );
  if (Object.keys(labelledAt).length > 0) is.labelledAt = labelledAt;
  else delete is.labelledAt;
}

/** The writes that move the thread's entries among those listed by when they got Spam or Trash, from how it was to how it is. */
function labelledWrites(table: Table, mailbox: string, was: StoredSummary | undefined, is: StoredSummary): TransactItem[] {
  return erasedLabels.flatMap((label) => {
    const [before, after] = [was?.labelledAt?.[label], is.labelledAt?.[label]];
    if (before === after) return [];
    return [
      ...(before === undefined ? [] : [{ Delete: { TableName: table.name, Key: labelledKey(before, mailbox, is.id, label) } }]),
      ...(after === undefined ? [] : [{ Put: { TableName: table.name, Item: { ...labelledKey(after, mailbox, is.id, label), mailbox, thread: is.id, label, labelledAt: after } } }]),
    ];
  });
}

/**
 * Gives each thread that got Spam or Trash before erasure existed, and so has no time for it, the
 * time now, from which the retention period counts. Records no change, since nothing a reader
 * sees changes. A thread changed meanwhile keeps none, until this runs again on the next setup.
 */
export async function timeEarlierLabels(table: Table): Promise<void> {
  const now = new Date().toISOString();
  for (const mailbox of await allMailboxes(table)) {
    for (const label of erasedLabels) {
      let start: Record<string, unknown> | undefined;
      do {
        const page = await documents(table).send(
          new QueryCommand({
            TableName: table.name,
            KeyConditionExpression: `${pk} = :listing`,
            FilterExpression: "attribute_not_exists(labelledAt.#label)",
            ExpressionAttributeNames: { "#label": label },
            ExpressionAttributeValues: { ":listing": listingKey(mailbox, `label#${label}`, "", "")[pk] },
            ExclusiveStartKey: start,
          }),
        );
        for (const { id } of (page.Items ?? []) as ThreadSummary[]) {
          const current = await threadSummary(table, mailbox, id);
          if (current === undefined || current.labelledAt?.[label] !== undefined) continue;
          const next: StoredSummary = { ...current, labelledAt: { ...current.labelledAt, [label]: now } };
          try {
            await documents(table).send(
              new TransactWriteCommand({
                TransactItems: [
                  { Put: { TableName: table.name, Item: { ...threadKey(mailbox, id), ...next }, ...asRead(current) } },
                  ...listingWrites(table, mailbox, current, next),
                  ...labelledWrites(table, mailbox, current, next),
                ],
              }),
            );
          } catch (error) {
            if (!(error instanceof TransactionCanceledException)) throw error;
          }
        }
        start = page.LastEvaluatedKey;
      } while (start !== undefined);
    }
  }
}

/** The thread's summary as stored, or undefined if the mailbox has no such thread, or it is being erased. */
export async function threadSummary(table: Table, mailbox: string, thread: string): Promise<StoredSummary | undefined> {
  const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: threadKey(mailbox, thread), ConsistentRead: true }));
  if (Item === undefined || Item.erasing === true) return undefined;
  return {
    ...summaryOf(Item as ThreadSummary),
    ...(Item.sent === true && { sent: true }),
    ...(Item.labelledAt !== undefined && { labelledAt: Item.labelledAt }),
  };
}

/** The ID of the thread's newest message, of those that arrived by the time if one is given, or undefined if it has none. */
export async function newestMessage(table: Table, mailbox: string, thread: string, by?: string): Promise<string | undefined> {
  const messages = `${threadPrefix(thread)}message#`;
  const { Items = [] } = await documents(table).send(
    new QueryCommand({
      TableName: table.name,
      KeyConditionExpression: `${pk} = :mailbox AND ${sk} BETWEEN :first AND :last`,
      // A message's sort key follows the prefix with when it arrived, then "#", which sorts before "~".
      ExpressionAttributeValues: { ":mailbox": partition(mailbox), ":first": messages, ":last": `${messages}${by ?? "~"}~` },
      ScanIndexForward: false,
      Limit: 1,
      ConsistentRead: true,
    }),
  );
  return Items[0]?.id as string | undefined;
}

/** The thread of the first of the messages that the mailbox has, if it has any. */
async function threadAnswered(table: Table, mailbox: string, messageIds: string[]): Promise<StoredSummary | undefined> {
  const found = await Promise.all(
    messageIds
      .slice(0, answersLookedUp)
      .map(async (messageId) => (await documents(table).send(new GetCommand({ TableName: table.name, Key: messageIdKey(mailbox, messageId), ConsistentRead: true }))).Item),
  );
  const thread = found.find((item) => item !== undefined)?.thread as string | undefined;
  return thread === undefined ? undefined : threadSummary(table, mailbox, thread);
}

/** A page of the threads with the label, as threadsListed gives it, with those in Spam and Trash if `withHidden`. */
export const threadsWithLabel = (table: Table, mailbox: string, label: string, page: { limit: number; after?: Cursor; withHidden?: boolean }) =>
  threadsListed(table, mailbox, `label#${label}`, page);

/** A page of Sent, the threads with a message sent from the mailbox, as threadsListed gives it. */
export const sentThreads = (table: Table, mailbox: string, page: { limit: number; after?: Cursor }) => threadsListed(table, mailbox, "sent", page);

/** A page of All mail, as threadsListed gives it. */
export const allMail = (table: Table, mailbox: string, page: { limit: number; after?: Cursor }) => threadsListed(table, mailbox, "all", page);

/** A page of Remind me, the threads set aside, soonest back first, as threadsListed gives it. */
export const threadsSetAside = (table: Table, mailbox: string, page: { limit: number; after?: Cursor }) => threadsListed(table, mailbox, reminders, page);

/**
 * The labels whose threads the listing leaves out: Spam's and Trash's leave out none, the
 * Screener's those in Spam and Trash, and every other listing those too and those that wait.
 */
const leftOutBy = (listing: Listing): string[] => (listing === `label#${spam}` || listing === `label#${trash}` ? [] : listing === `label#${screener}` ? [spam, trash] : [spam, trash, screener]);

/**
 * A page of the threads in the listing, newest first, or Remind me's soonest back first, at most `limit` of them, after the page that
 * gave `after` as its next, leaving out those the listing leaves out unless `withHidden`. The page
 * has a next if more threads follow.
 */
async function threadsListed(
  table: Table,
  mailbox: string,
  listing: Listing,
  { limit, after, withHidden = false }: { limit: number; after?: Cursor; withHidden?: boolean },
): Promise<ThreadList> {
  const partition = listingKey(mailbox, listing, "", "")[pk];
  const leftOut = withHidden ? [] : leftOutBy(listing);
  const shown = (item: ThreadSummary) => !leftOut.some((label) => item.labels.includes(label));
  const items: Record<string, unknown>[] = [];
  let start = after === undefined ? undefined : { [pk]: partition, [sk]: after.position };
  // One more than the page, to tell whether another page follows. Threads left out don't count.
  do {
    const read = await documents(table).send(
      new QueryCommand({
        TableName: table.name,
        KeyConditionExpression: `${pk} = :listing`,
        ExpressionAttributeValues: { ":listing": partition },
        ScanIndexForward: listing === reminders,
        Limit: limit + 1 - items.length,
        ExclusiveStartKey: start,
      }),
    );
    items.push(...(read.Items ?? []).filter((item) => shown(item as ThreadSummary)));
    start = read.LastEvaluatedKey as typeof start;
  } while (items.length <= limit && start !== undefined);
  const page = items.slice(0, limit);
  const last = page.at(-1);
  return {
    threads: page.map((item) => summaryOf(item as ThreadSummary)),
    ...(items.length > limit && last !== undefined && { next: cursorAt(last[sk] as string) }),
  };
}

/** How many of the label's threads are unread, leaving out those its listing leaves out. */
export async function unreadWithLabel(table: Table, mailbox: string, label: string): Promise<number> {
  const listing = `label#${label}` as const;
  const partition = listingKey(mailbox, listing, "", "")[pk];
  const leftOut = leftOutBy(listing);
  let count = 0;
  let start: Record<string, unknown> | undefined;
  do {
    const read = await documents(table).send(
      new QueryCommand({
        TableName: table.name,
        KeyConditionExpression: `${pk} = :listing`,
        FilterExpression: ["unread = :unread", ...leftOut.map((_, index) => `NOT contains(labels, :left${index})`)].join(" AND "),
        ExpressionAttributeValues: { ":listing": partition, ":unread": true, ...Object.fromEntries(leftOut.map((label, index) => [`:left${index}`, label])) },
        Select: "COUNT",
        ExclusiveStartKey: start,
      }),
    );
    count += read.Count ?? 0;
    start = read.LastEvaluatedKey;
  } while (start !== undefined);
  return count;
}

/** Where a page of threads starts: after the thread at the position in its listing. */
export interface Cursor {
  position: string;
}

/** The cursor a page gave as its next, or undefined if no page gives that. */
export function cursorOf(next: string): Cursor | undefined {
  const position = Buffer.from(next, "base64url").toString();
  return labelPosition.test(position) ? { position } : undefined;
}

/** Gives a link to a message's attachment, for the images of its own parts its HTML shows. */
export type AttachmentLinks = (message: string, attachment: number) => Promise<string>;

/** The thread with its messages, oldest first, each read from its raw message with its HTML served, or undefined if the mailbox has no such thread. */
export async function readThread(table: Table, mailBucket: MailBucket, mailbox: string, id: string, linkTo: AttachmentLinks): Promise<Thread | undefined> {
  const items = [];
  let start: Record<string, unknown> | undefined;
  do {
    const page = await documents(table).send(
      new QueryCommand({
        TableName: table.name,
        KeyConditionExpression: `${pk} = :mailbox AND begins_with(${sk}, :thread)`,
        ExpressionAttributeValues: { ":mailbox": partition(mailbox), ":thread": threadPrefix(id) },
        ExclusiveStartKey: start,
      }),
    );
    items.push(...(page.Items ?? []));
    start = page.LastEvaluatedKey;
  } while (start !== undefined);
  const thread = items.find((item) => item[sk] === threadKey(mailbox, id)[sk]);
  if (thread === undefined || thread.erasing === true) return undefined;
  const stored = items.filter((item) => item !== thread);
  const messages = await Promise.all(stored.map(async (item) => (await readMessage(mailBucket, item as StoredMessage, linkTo)).message));
  const { reminder, back } = summaryOf(thread as ThreadSummary);
  return { id, subject: thread.subject, labels: thread.labels, unread: thread.unread ?? false, ...(reminder !== undefined && { reminder }), ...(back !== undefined && { back }), messages };
}

/**
 * The message with the ID in the mailbox, read from its raw message, with its thread and the
 * Reply-To and References it gives, or undefined if the mailbox has no such message. Its HTML is
 * served only with `linkTo`, for those who show it.
 */
export async function findMessage(
  table: Table,
  mailBucket: MailBucket,
  mailbox: string,
  id: string,
  linkTo?: AttachmentLinks,
): Promise<{ message: Message; thread: string; replyTo: components["schemas"]["EmailAddress"][]; references: string[]; parts: Part[] } | undefined> {
  const stored = await storedMessage(table, mailbox, id);
  if (stored === undefined) return undefined;
  const { message, parsed } = await readMessage(mailBucket, stored, linkTo);
  return { message, thread: stored.thread, replyTo: parsed.replyTo, references: parsed.references, parts: parsed.parts };
}

/** The message with the ID in the mailbox as stored, with its thread, or undefined if the mailbox has no such message. */
export async function storedMessage(table: Table, mailbox: string, id: string): Promise<(StoredMessage & { thread: string }) | undefined> {
  const db = documents(table);
  const { Item: ref } = await db.send(new GetCommand({ TableName: table.name, Key: messageRefKey(mailbox, id), ConsistentRead: true }));
  if (ref === undefined) return undefined;
  const { Item } = await db.send(new GetCommand({ TableName: table.name, Key: messageKey(mailbox, ref.thread as string, ref.receivedAt as string, id), ConsistentRead: true }));
  return Item as (StoredMessage & { thread: string }) | undefined;
}

/**
 * The mailbox's changes after the position, oldest first, without spam arrivals unless `withSpam`.
 * The page ends at the last change read. A run of spam is read past until a change is listed or
 * the feed ends, so a page that lists nothing means the caller has caught up.
 */
export async function mailboxChanges(table: Table, mailbox: string, after: number, withSpam: boolean): Promise<MailboxChangePage> {
  let position = after;
  for (;;) {
    const read = (await changesAfter(table, mailboxFeed(mailbox), position)).map(inContractOrder) as MailboxChange[];
    position = read.at(-1)?.position ?? position;
    const changes = read.filter((change) => withSpam || !(change.type === "messageReceived" && change.spam === true));
    if (changes.length > 0 || read.length < changesPerPage) return { changes, position };
  }
}

// DynamoDB keeps no attribute order, so the settings in a change to an agent's are listed in the order the contract lists them.
// Settings agents no longer have, from when they owned mailboxes and could be admins (ADR-0030), are left out.
function inContractOrder(change: Record<string, unknown>): Record<string, unknown> {
  if (change.type !== "agentSettingsChanged") return change;
  const ordered = (settings: Record<string, unknown>) => Object.fromEntries(Object.keys(defaultAgentSettings).filter((name) => name in settings).map((name) => [name, settings[name]]));
  return { ...change, before: ordered(change.before as Record<string, unknown>), after: ordered(change.after as Record<string, unknown>) };
}

/**
 * The message with its body and attachments from the raw message, in the order the contract lists
 * its fields, and the raw message parsed. With `linkTo`, its HTML is served too, its images of its
 * own parts leading to the links `linkTo` gives.
 */
async function readMessage(mailBucket: MailBucket, stored: StoredMessage, linkTo?: AttachmentLinks): Promise<{ message: Message; parsed: ParsedMail }> {
  const raw = await mailBucket.get(stored.rawKey);
  if (raw === undefined) throw new Error(`The raw message ${stored.rawKey} is missing from the mail bucket.`);
  const parsed = await parseMail(raw);
  const { text, attachments } = parsed;
  const html = parsed.html === undefined || linkTo === undefined ? undefined : await servedHtml(parsed.html, parsed.parts, (attachment) => linkTo(stored.id, attachment));
  const { id, messageId, from, to, cc, bcc, recipient, plusTag, group, subject, date, receivedAt, sentBy, sentAs, fromAgent, logo, approval, feedback } = stored;
  const message = {
    id,
    messageId,
    from: addressOf(from),
    to: to.map(addressOf),
    cc: cc.map(addressOf),
    ...(bcc !== undefined && bcc.length > 0 && { bcc: bcc.map(addressOf) }),
    recipient,
    plusTag,
    ...(group !== undefined && { group }),
    subject,
    date,
    receivedAt,
    ...(sentBy !== undefined && { sentBy }),
    ...(sentAs !== undefined && { sentAs: { group: sentAs.group, by: sentAs.by, name: sentAs.name } }),
    ...(fromAgent && { fromAgent }),
    ...(logo !== undefined && { logo }),
    ...(approval !== undefined && { approval }),
    ...(feedback !== undefined && { feedback }),
    text,
    ...html,
    attachments,
  };
  return { message, parsed };
}

/**
 * The write that adds what SES reported to the message sent from the mailbox, and the thread it
 * is in, or undefined if the message is no longer there, as when it was erased.
 */
export async function feedbackOnMessage(table: Table, mailbox: string, message: string, feedback: SendFeedback): Promise<{ thread: string; item: TransactItem } | undefined> {
  const { Item: ref } = await documents(table).send(new GetCommand({ TableName: table.name, Key: messageRefKey(mailbox, message), ConsistentRead: true }));
  if (ref === undefined) return undefined;
  const { thread, receivedAt } = ref as { thread: string; receivedAt: string };
  return {
    thread,
    item: {
      Update: {
        TableName: table.name,
        Key: messageKey(mailbox, thread, receivedAt, message),
        UpdateExpression: "SET feedback = list_append(if_not_exists(feedback, :none), :feedback)",
        ConditionExpression: `attribute_exists(${pk})`,
        ExpressionAttributeValues: { ":none": [], ":feedback": [feedback] },
      },
    },
  };
}

/** The HTML served, with a link to each of the message's parts its `cid:` URLs refer to. */
async function servedHtml(html: string, parts: Part[], linkTo: (attachment: number) => Promise<string>): Promise<ServedHtml> {
  const links = new Map<string, string>();
  for (const contentId of contentIdsIn(html)) {
    const attachment = parts.findIndex((part) => part.contentId === `<${contentId}>`);
    if (attachment !== -1) links.set(contentId, await linkTo(attachment));
  }
  return serveHtml(html, (contentId) => links.get(contentId));
}

// Threads stored before snippets and read state existed have neither, and are read.
export const summaryOf = ({ id, subject, from, fromAgent, logo, snippet, labels, unread, latestAt, messages, groups, reminder, back }: ThreadSummary): ThreadSummary => ({
  id,
  subject,
  from: addressOf(from),
  ...(fromAgent && { fromAgent }),
  ...(logo !== undefined && { logo }),
  snippet: snippet ?? "",
  labels,
  unread: unread ?? false,
  latestAt,
  messages,
  ...(groups !== undefined && { groups }),
  ...(reminder !== undefined && { reminder }),
  ...(back !== undefined && { back }),
});

/** The start of the text on one line, without quoted lines, URLs or tokens, cut after snippetLength characters. */
function snippetOf(text: string): string {
  const line = readableLine(text);
  return line.length <= snippetLength ? line : `${line.slice(0, snippetLength).trimEnd()}…`;
}

const addressOf = ({ name, address }: components["schemas"]["EmailAddress"]) => (name === undefined ? { address } : { name, address });

/** Whether the mailbox has sent mail to the address, in any case. */
export async function hasSentTo(table: Table, mailbox: string, address: string): Promise<boolean> {
  const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: sentToKey(mailbox, address), ConsistentRead: true }));
  return Item !== undefined;
}

/** Every thread that waits in the Screener, newest first, those in Spam and Trash too. */
export const waitingThreads = (table: Table, mailbox: string) => threadsLabelled(table, mailbox, screener);

/** Every thread with the label, newest first, those in Spam and Trash and waiting in the Screener too. */
export const threadsLabelled = (table: Table, mailbox: string, label: string) => everyThreadIn(table, mailbox, `label#${label}`);

/** Every thread from the address, or from everyone at exactly the domain, newest first, those in Spam and Trash and waiting in the Screener too. */
export const threadsFrom = (table: Table, mailbox: string, sender: { address: string } | { domain: string }) => everyThreadIn(table, mailbox, fromListing(sender));

/** Every thread in the listing, newest first, those it leaves out of a page too. */
async function everyThreadIn(table: Table, mailbox: string, listing: Listing): Promise<ThreadSummary[]> {
  const threads: ThreadSummary[] = [];
  let start: Record<string, unknown> | undefined;
  do {
    const page = await documents(table).send(
      new QueryCommand({
        TableName: table.name,
        KeyConditionExpression: `${pk} = :listing`,
        ExpressionAttributeValues: { ":listing": listingKey(mailbox, listing, "", "")[pk] },
        ScanIndexForward: false,
        ConsistentRead: true,
        ExclusiveStartKey: start,
      }),
    );
    threads.push(...(page.Items ?? []).map((item) => summaryOf(item as ThreadSummary)));
    start = page.LastEvaluatedKey;
  } while (start !== undefined);
  return threads;
}

/**
 * Moves each thread from where its sender's mail went to `to`, the label where it goes now: one
 * waiting in the Screener, or with the label `from` unless that is undefined, as for mail that went
 * nowhere. A thread in Spam or Trash only leaves the Screener, and every other label stays. Records
 * a change in the mailbox's change feed attributed to the actor `by` for each, and returns the
 * threads moved as they are now, in the order given. A thread erased meanwhile is left out.
 */
export async function moveDelivered(
  table: Table,
  { mailbox, threads, from, to, by }: { mailbox: string; threads: string[]; from: string | undefined; to: string; by: string },
): Promise<ThreadSummary[]> {
  const waits = (summary: ThreadSummary) => summary.labels.includes(screener);
  const thrown = (summary: ThreadSummary) => summary.labels.includes(spam) || summary.labels.includes(trash);
  const moves = (summary: ThreadSummary | undefined): summary is StoredSummary => summary !== undefined && (waits(summary) || (from !== undefined && summary.labels.includes(from) && !thrown(summary)));
  const found = (await Promise.all(threads.map((thread) => threadSummary(table, mailbox, thread)))).filter(moves);
  const moved = await changeThreads(table, { mailbox, threads: found.map(({ id }) => id), by }, (current) => {
    if (!moves(current)) return undefined;
    const kept = current.labels.filter((label) => label !== screener && (thrown(current) || label !== from));
    const labels = thrown(current) || kept.includes(to) ? kept : [...kept, to];
    const added = labels.filter((label) => !current.labels.includes(label));
    const removed = current.labels.filter((label) => !labels.includes(label));
    return { summary: { ...current, labels }, change: { type: "threadLabelsChanged", thread: current.id, added, removed } };
  });
  return "threads" in moved ? moved.threads : [];
}

/**
 * The addresses the mailbox's mail is from, in lower case, leaving out mail in Spam and mail the
 * mailbox sent, and the addresses it sent mail to, from each of its threads as they are stored.
 */
export async function correspondents(table: Table, mailbox: string): Promise<{ from: Set<string>; sentTo: Set<string> }> {
  const from = new Set<string>();
  const sentTo = new Set<string>();
  // A thread's messages sort before the thread itself, so each thread's senders wait for its labels.
  let senders: string[] = [];
  let start: Record<string, unknown> | undefined;
  do {
    const page = await documents(table).send(
      new QueryCommand({
        TableName: table.name,
        KeyConditionExpression: `${pk} = :mailbox AND begins_with(${sk}, :threads)`,
        ExpressionAttributeValues: { ":mailbox": partition(mailbox), ":threads": "thread#" },
        // Mail stored just before the Screener started turning on counts too.
        ConsistentRead: true,
        ExclusiveStartKey: start,
      }),
    );
    for (const item of page.Items ?? []) {
      if ((item[sk] as string).endsWith("#thread")) {
        if (!(item.labels as string[]).includes(spam)) for (const sender of senders) from.add(sender);
        senders = [];
        continue;
      }
      const message = item as StoredMessage;
      if (message.sentBy === undefined) senders.push(message.from.address.toLowerCase());
      else for (const { address } of [...message.to, ...message.cc, ...(message.bcc ?? [])]) sentTo.add(address.toLowerCase());
    }
    start = page.LastEvaluatedKey;
  } while (start !== undefined);
  return { from, sentTo };
}

/**
 * The mailbox's threads after the one the cursor names, or from the first, each with its summary
 * and its messages, oldest first, until those given hold at least `messages` messages. Leaves out
 * threads being erased. Gives the cursor to read on from, if more threads follow.
 */
export async function threadsWithMessages(
  table: Table,
  mailbox: string,
  { after, messages: wanted }: { after?: string; messages: number },
): Promise<{ threads: { summary: StoredSummary; messages: (StoredMessage & { thread: string })[] }[]; next?: string }> {
  const threads: { summary: StoredSummary; messages: (StoredMessage & { thread: string })[] }[] = [];
  let count = 0;
  // A thread's messages sort before the thread itself, so each thread's messages wait for its summary.
  let messages: (StoredMessage & { thread: string })[] = [];
  let start: Record<string, unknown> | undefined = after === undefined ? undefined : { [pk]: partition(mailbox), [sk]: after };
  let last = after;
  do {
    const page = await documents(table).send(
      new QueryCommand({
        TableName: table.name,
        KeyConditionExpression: `${pk} = :mailbox AND begins_with(${sk}, :threads)`,
        ExpressionAttributeValues: { ":mailbox": partition(mailbox), ":threads": "thread#" },
        ConsistentRead: true,
        ExclusiveStartKey: start,
      }),
    );
    for (const item of page.Items ?? []) {
      if (!(item[sk] as string).endsWith("#thread")) {
        messages.push(item as StoredMessage & { thread: string });
        continue;
      }
      last = item[sk] as string;
      if (item.erasing !== true) {
        threads.push({ summary: { ...summaryOf(item as ThreadSummary), ...(item.sent === true && { sent: true }) }, messages });
        count += messages.length;
      }
      messages = [];
      if (count >= wanted) return { threads, next: last };
    }
    start = page.LastEvaluatedKey;
  } while (start !== undefined);
  return { threads };
}

/** Notes that the mailbox has sent to each address. */
export async function noteSentTo(table: Table, mailbox: string, addresses: Iterable<string>): Promise<void> {
  const all = [...addresses];
  // A few at a time, so a mailbox that sent to many doesn't throttle the table.
  for (let at = 0; at < all.length; at += 25) {
    await Promise.all(all.slice(at, at + 25).map((address) => documents(table).send(new PutCommand({ TableName: table.name, Item: sentToKey(mailbox, address) }))));
  }
}

/** Where the raw copies of the mail the mailbox received from the addresses `from` takes are, newest first. It is given each in lower case. */
export async function receivedFrom(table: Table, mailbox: string, from: (address: string) => boolean): Promise<Pick<StoredMessage, "rawKey" | "receivedAt">[]> {
  const found: Pick<StoredMessage, "rawKey" | "receivedAt">[] = [];
  let start: Record<string, unknown> | undefined;
  do {
    const page = await documents(table).send(
      new QueryCommand({
        TableName: table.name,
        KeyConditionExpression: `${pk} = :mailbox AND begins_with(${sk}, :threads)`,
        // A thread's messages that the mailbox received, not sent.
        FilterExpression: "attribute_exists(rawKey) AND attribute_not_exists(sentBy)",
        ExpressionAttributeValues: { ":mailbox": partition(mailbox), ":threads": "thread#" },
        ExclusiveStartKey: start,
      }),
    );
    for (const message of (page.Items ?? []) as StoredMessage[]) if (from(message.from.address.toLowerCase())) found.push({ rawKey: message.rawKey, receivedAt: message.receivedAt });
    start = page.LastEvaluatedKey;
  } while (start !== undefined);
  return found.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
}

/** Whether any of the mailboxes has the message with the ID SES gave it. */
export async function receivedByAny(table: Table, mailboxes: string[], sesMessageId: string): Promise<boolean> {
  for (let index = 0; index < mailboxes.length; index += 100) {
    let wanted: Record<string, unknown>[] | undefined = mailboxes.slice(index, index + 100).map((mailbox) => receivedKey(mailbox, sesMessageId));
    while (wanted !== undefined && wanted.length > 0) {
      const read: BatchGetCommandOutput = await documents(table).send(new BatchGetCommand({ RequestItems: { [table.name]: { Keys: wanted, ConsistentRead: true } } }));
      if ((read.Responses?.[table.name] ?? []).length > 0) return true;
      wanted = read.UnprocessedKeys?.[table.name]?.Keys;
    }
  }
  return false;
}

/**
 * Lists each of the mailbox's threads by the address and the domain it is from, as threads stored
 * before those listings existed aren't, each on condition that it is still as read. A thread changed
 * meanwhile was listed by that change.
 */
export async function listBySender(table: Table, mailbox: string): Promise<void> {
  // Every thread is in All mail, or else in Spam, Trash or the Screener.
  const seen = new Set<string>();
  for (const listing of ["all", `label#${spam}`, `label#${trash}`, `label#${screener}`] as const) {
    for (const { id } of await everyThreadIn(table, mailbox, listing)) {
      if (seen.has(id)) continue;
      seen.add(id);
      const summary = await threadSummary(table, mailbox, id);
      if (summary === undefined) continue;
      const bySender = listingsOf(summary).filter((each) => each.startsWith("from"));
      await documents(table)
        .send(
          new TransactWriteCommand({
            TransactItems: [
              { ConditionCheck: { TableName: table.name, Key: threadKey(mailbox, id), ...asRead(summary) } },
              ...bySender.map((each) => ({ Put: { TableName: table.name, Item: { ...entryIn(mailbox, each, summary), ...summary } } })),
            ],
          }),
        )
        .catch((error: unknown) => {
          if (!(error instanceof TransactionCanceledException)) throw error;
        });
    }
  }
}
