// The mail in a mailbox: its threads, their messages and labels, and the mailbox's change feed.
// Everything is in the mailbox's own partitions. A message's body stays in the raw message in the
// mail bucket, and is read from there.
import { randomUUID } from "node:crypto";
import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { GetCommand, QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import type { components } from "@duva/openapi";
import type { Table } from "./deployment.ts";
import { changesAfter, changesPerPage, type Feed, recordChanges } from "./feed.ts";
import type { MailBucket } from "./mail-bucket.ts";
import { type ParsedMail, parseMail } from "./mime.ts";
import { allMailboxes, mailboxKey } from "./organization.ts";
import { documents, isNew, pk, sk, type TransactItem } from "./table.ts";

export type ThreadSummary = components["schemas"]["ThreadSummary"];
export type ThreadList = components["schemas"]["ThreadList"];
export type Thread = components["schemas"]["Thread"];
export type Message = components["schemas"]["Message"];
export type MailboxChange = components["schemas"]["MailboxChange"];
export type MailboxChangePage = components["schemas"]["MailboxChangePage"];
export type { StoredMessage };

/** The label new mail gets. */
export const inbox = "inbox";
/** The label mail SES judged to be spam gets instead. */
export const spam = "spam";
/** The label deleted threads get. */
export const trash = "trash";

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
// Each listing lists its threads newest first, each with its summary: each label, Sent and All mail.
const listingKey = (mailbox: string, listing: Listing, latestAt: string, thread: string) => ({
  [pk]: `${partition(mailbox)}#${listing}`,
  [sk]: `${latestAt}#${thread}`,
});
// A page of a listing's threads ends at an entry, whose sort key is the next page's cursor.
const labelPosition = /^\d{4}-\d\d-\d\dT[\d:.]+Z#[\w-]+$/;
const cursorAt = (position: string) => Buffer.from(position).toString("base64url");
// Each Message-ID points at its message, so a reply can find the thread it belongs in.
const messageIdKey = (mailbox: string, messageId: string) => ({ [pk]: partition(mailbox), [sk]: `message-id#${messageId}` });
// Each message in Duva points at its thread and its place there, so a reply can find what it answers.
const messageRefKey = (mailbox: string, message: string) => ({ [pk]: partition(mailbox), [sk]: `message#${message}` });
// Each SES message is stored once per mailbox, however often SES's event is processed.
const receivedKey = (mailbox: string, sesMessageId: string) => ({ [pk]: partition(mailbox), [sk]: `received#${sesMessageId}` });
// Each thread in Spam or Trash is listed, across mailboxes, by when it got the label, so the eraser finds those past the retention period.
const labelledKey = (labelledAt: string, mailbox: string, thread: string, label: ErasedLabel) => ({ [pk]: "erasure#labelled", [sk]: `${labelledAt}#${mailbox}#${thread}#${label}` });

/** What erasure.ts needs of how a mailbox's mail is stored. */
export const keys = { partition, threadPrefix, threadKey, messageIdKey, messageRefKey, receivedKey, labelledKey, listingKey };

export const mailboxFeed = (mailbox: string): Feed => ({
  counter: mailboxKey(mailbox),
  partition: `${partition(mailbox)}#changes`,
  missing: `The mailbox ${mailbox} is missing.`,
});

/** A message SES received for one of the mailbox's addresses. */
export interface Arrival {
  mailbox: string;
  /** The ID SES gave the message, which is the same each time its event is processed. */
  sesMessageId: string;
  /** Where the raw message is in the mail bucket. */
  rawKey: string;
  /** The mailbox's address SES delivered it to, with its plus tag. */
  recipient: string;
  plusTag?: string;
  /** The envelope sender, for mail without a From. */
  sender: string;
  receivedAt: string;
  parsed: ParsedMail;
  /** Whether SES judged the message to be spam. */
  spam: boolean;
}

/** The labels whose threads are erased once they have had them for the retention period. */
export type ErasedLabel = typeof spam | typeof trash;
const erasedLabels: ErasedLabel[] = [spam, trash];

/**
 * A thread's summary as stored, with whether the mailbox sent in it, and when it got Spam and
 * Trash if it has them. Threads stored before Sent existed don't say, and those that got Spam or
 * Trash before erasure existed have no time for it.
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
  subject: string;
  date: string;
  receivedAt: string;
  sentBy?: string;
  /** The approval an agent's message went out with. */
  approval?: components["schemas"]["SentApproval"];
  /** Where the raw message is in the mail bucket. */
  rawKey: string;
}

/**
 * Stores the message in the thread of the first message it answers that the mailbox has, in the
 * order of ParsedMail's answers, or as a new thread, and gives the thread the Inbox label. Spam is
 * kept apart instead: it starts its own thread with the Spam label, and no reply joins that thread.
 * Records its arrival in the mailbox's change feed, naming no actor. Returns false if the mailbox
 * already has it.
 */
export async function receiveMessage(table: Table, arrival: Arrival): Promise<boolean> {
  const { mailbox, sesMessageId, rawKey, recipient, plusTag, sender, receivedAt, parsed } = arrival;
  const label = arrival.spam ? spam : inbox;
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
    subject: parsed.subject,
    date: parsed.date ?? receivedAt,
    receivedAt,
    rawKey,
  };
  return storeMessage(table, {
    mailbox,
    message,
    text: parsed.text,
    thread: async () => (arrival.spam ? undefined : threadAnswered(table, mailbox, parsed.answers)),
    label,
    unread: true,
    findable: !arrival.spam,
    by: undefined,
    change: (thread) => ({ type: "messageReceived", thread, message: message.id, ...(arrival.spam ? { spam: true } : {}) }),
    once: () => ({ Put: { TableName: table.name, Item: receivedKey(mailbox, sesMessageId), ...isNew } }),
  });
}

/**
 * Stores the message the actor `sentBy` sent from the mailbox, which SES accepted, in the thread
 * of the message it answers, whose read state it keeps, or as a new read thread without labels.
 * Either way Sent lists the thread. `once` gives the write that marks
 * the draft sent in the thread, on condition that it is still sending, so the message is stored once. Records the
 * send in the mailbox's change feed, naming the sender. Returns false if `once`'s condition failed.
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
  }: { mailbox: string; message: StoredMessage & { sentBy: string }; text: string; thread: string | undefined; draft: string; once: (thread: string) => TransactItem },
): Promise<boolean> {
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
  });
}

/**
 * Stores the message in the thread `thread` finds, or else in a new one, with the label if given,
 * in one transaction with the write `once` gives for the thread and the change in the mailbox's
 * change feed. If `findable`, its Message-ID points at it, so replies to it join its thread. If
 * `unread` is given, the thread becomes unread or read. If `sent`, Sent lists the thread from then
 * on. If the message is the thread's newest, its text gives the thread's snippet. Returns false if
 * that write's condition failed, since then the message is already stored.
 */
async function storeMessage(
  table: Table,
  { mailbox, message, text, thread: find, label, unread, findable, sent, by, change, once }: {
    mailbox: string;
    message: StoredMessage;
    text: string;
    thread: () => Promise<StoredSummary | undefined>;
    label?: string;
    unread?: boolean;
    findable: boolean;
    sent?: boolean;
    by: string | undefined;
    change: (thread: string) => object;
    once: (thread: string) => TransactItem;
  },
): Promise<boolean> {
  const { id, receivedAt } = message;
  // recordChanges gives the items' cancellation reasons after the counter's and the one change's.
  const [onceReason, threadReason] = [2, 3];
  const put = (Item: Record<string, unknown>, condition = {}) => ({ Put: { TableName: table.name, Item, ...condition } });
  for (let attempt = 1; ; attempt++) {
    const joined = await find();
    const thread = joined?.id ?? randomUUID();
    const newest = joined === undefined || receivedAt > joined.latestAt;
    const summary: StoredSummary =
      joined === undefined
        ? {
            id: thread,
            subject: message.subject,
            from: message.from,
            snippet: snippetOf(text),
            labels: label === undefined ? [] : [label],
            unread: unread ?? false,
            latestAt: receivedAt,
            messages: 1,
            ...(sent && { sent }),
          }
        : {
            ...joined,
            snippet: newest ? snippetOf(text) : joined.snippet,
            // New mail brings a thread back to the Inbox, unless it is in Spam or Trash.
            labels: label === undefined || joined.labels.includes(label) || hidden(joined) ? joined.labels : [...joined.labels, label],
            unread: unread ?? joined.unread,
            latestAt: newest ? receivedAt : joined.latestAt,
            messages: joined.messages + 1,
            ...((sent || joined.sent) && { sent: true }),
          };
    timeErasedLabels(joined, summary);
    try {
      await recordChanges(table, mailboxFeed(mailbox), {
        by,
        changes: [change(thread)],
        items: [
          once(thread),
          put({ ...threadKey(mailbox, thread), ...summary }, joined === undefined ? isNew : asRead(joined)),
          put({ ...messageKey(mailbox, thread, receivedAt, id), ...message, thread }),
          ...listingWrites(table, mailbox, joined, summary),
          ...labelledWrites(table, mailbox, joined, summary),
          ...(message.messageId === undefined || !findable ? [] : [put({ ...messageIdKey(mailbox, message.messageId), thread, message: id })]),
          put({ ...messageRefKey(mailbox, id), thread, receivedAt }),
        ],
      });
      return true;
    } catch (error) {
      const reasons = error instanceof TransactionCanceledException ? (error.CancellationReasons ?? []) : [];
      // Another processing of the same event stored it first.
      if (reasons[onceReason]?.Code === "ConditionalCheckFailed") return false;
      // Another message changed the thread since it was read, so it is read again.
      if (reasons[threadReason]?.Code !== "ConditionalCheckFailed" || attempt === 10) throw error;
    }
  }
}

/**
 * The condition that a thread is as it was read, so changes made together each count. Threads
 * stored before read state existed have none, and are read.
 */
export function asRead({ messages, labels, unread }: ThreadSummary) {
  return {
    ConditionExpression: `messages = :messages AND labels = :labels AND ${unread ? "unread = :unread" : "(unread = :unread OR attribute_not_exists(unread))"}`,
    ExpressionAttributeValues: { ":messages": messages, ":labels": labels, ":unread": unread },
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
 * each take a thread out of the Inbox, removing one puts it back unless it has the other or the
 * Inbox is removed too, and the Inbox takes it out of both. Records a change in the mailbox's change feed attributed to the actor
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

/** The labels after adding and removing those given, with the built-in labels' rules. */
function relabelled(labels: string[], add: string[], remove: string[]): string[] {
  const out = new Set([...remove, ...(add.includes(inbox) ? [spam, trash] : []), ...(add.includes(spam) || add.includes(trash) ? [inbox] : [])]);
  const next = [...labels.filter((label) => !out.has(label)), ...add.filter((label) => !labels.includes(label))];
  const restored = labels.some((label) => (label === spam || label === trash) && !next.includes(label));
  return restored && !remove.includes(inbox) && !next.includes(spam) && !next.includes(trash) && !next.includes(inbox) ? [...next, inbox] : [...new Set(next)];
}

/**
 * Changes each thread as `change` says, in its own transaction with the change in the mailbox's
 * change feed attributed to the actor `by`, and leaves those it answers undefined for as they are.
 * Returns the threads as they are now, in the order given, or the IDs the mailbox has no thread
 * for instead, changing none, if there are any.
 */
async function changeThreads(
  table: Table,
  { mailbox, threads, by }: { mailbox: string; threads: string[]; by: string },
  change: (current: StoredSummary) => { summary: StoredSummary; change: object } | undefined,
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
      timeErasedLabels(current, next.summary);
      try {
        await recordChanges(table, mailboxFeed(mailbox), {
          by,
          changes: [next.change],
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

/** A listing a thread can be in: one of its labels, Sent if the mailbox sent in it, or All mail. */
type Listing = `label#${string}` | "sent" | "all";

/** Whether the thread is in Spam or Trash, which leaves it out of every listing but those. */
const hidden = ({ labels }: ThreadSummary) => labels.includes(spam) || labels.includes(trash);

/** The listings the thread is in: each of its labels, Sent if the mailbox sent in it, and All mail unless it is in Spam or Trash. */
export const listingsOf = (summary: StoredSummary): Listing[] => [
  ...summary.labels.map((label) => `label#${label}` as const),
  ...(summary.sent ? (["sent"] as const) : []),
  ...(hidden(summary) ? [] : (["all"] as const)),
];

/**
 * The writes that move the thread's entries in its listings from how it was to how it is: an entry
 * in each listing it is in, at its place there, and none where it was and isn't. A delete and a put
 * of the same item can't share a transaction, so an entry that keeps its place is overwritten.
 */
function listingWrites(table: Table, mailbox: string, was: StoredSummary | undefined, is: StoredSummary): TransactItem[] {
  const listings = listingsOf(is);
  const left = was === undefined ? [] : listingsOf(was).filter((listing) => was.latestAt !== is.latestAt || !listings.includes(listing));
  return [
    ...left.map((listing) => ({ Delete: { TableName: table.name, Key: listingKey(mailbox, listing, was!.latestAt, is.id) } })),
    ...listings.map((listing) => ({ Put: { TableName: table.name, Item: { ...listingKey(mailbox, listing, is.latestAt, is.id), ...is } } })),
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
  return { ...summaryOf(Item as ThreadSummary), ...(Item.sent === true && { sent: true }), ...(Item.labelledAt !== undefined && { labelledAt: Item.labelledAt }) };
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

/** Whether the listing leaves out threads in Spam and Trash, as every listing but theirs does. */
const leavesOutHidden = (listing: Listing) => listing !== `label#${spam}` && listing !== `label#${trash}`;

/**
 * A page of the threads in the listing, newest first, at most `limit` of them, after the page that
 * gave `after` as its next, leaving out those in Spam or Trash unless the listing is one of those
 * or `withHidden`. The page has a next if more threads follow.
 */
async function threadsListed(
  table: Table,
  mailbox: string,
  listing: Listing,
  { limit, after, withHidden = false }: { limit: number; after?: Cursor; withHidden?: boolean },
): Promise<ThreadList> {
  const partition = listingKey(mailbox, listing, "", "")[pk];
  const shown = withHidden || !leavesOutHidden(listing) ? () => true : (item: ThreadSummary) => !hidden(item);
  const items: Record<string, unknown>[] = [];
  let start = after === undefined ? undefined : { [pk]: partition, [sk]: after.position };
  // One more than the page, to tell whether another page follows. Threads left out don't count.
  do {
    const read = await documents(table).send(
      new QueryCommand({
        TableName: table.name,
        KeyConditionExpression: `${pk} = :listing`,
        ExpressionAttributeValues: { ":listing": partition },
        ScanIndexForward: false,
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

/** How many of the label's threads are unread, leaving out those in Spam or Trash unless the label is one of those. */
export async function unreadWithLabel(table: Table, mailbox: string, label: string): Promise<number> {
  const listing = `label#${label}` as const;
  const partition = listingKey(mailbox, listing, "", "")[pk];
  let count = 0;
  let start: Record<string, unknown> | undefined;
  do {
    const read = await documents(table).send(
      new QueryCommand({
        TableName: table.name,
        KeyConditionExpression: `${pk} = :listing`,
        FilterExpression: leavesOutHidden(listing) ? "unread = :unread AND NOT contains(labels, :spam) AND NOT contains(labels, :trash)" : "unread = :unread",
        ExpressionAttributeValues: { ":listing": partition, ":unread": true, ...(leavesOutHidden(listing) && { ":spam": spam, ":trash": trash }) },
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

/** The thread with its messages, oldest first, each read from its raw message, or undefined if the mailbox has no such thread. */
export async function readThread(table: Table, mailBucket: MailBucket, mailbox: string, id: string): Promise<Thread | undefined> {
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
  const messages = await Promise.all(stored.map(async (item) => (await readMessage(mailBucket, item as StoredMessage)).message));
  return { id, subject: thread.subject, labels: thread.labels, unread: thread.unread ?? false, messages };
}

/**
 * The message with the ID in the mailbox, read from its raw message, with its thread and the
 * Reply-To and References it gives, or undefined if the mailbox has no such message.
 */
export async function findMessage(
  table: Table,
  mailBucket: MailBucket,
  mailbox: string,
  id: string,
): Promise<{ message: Message; thread: string; replyTo: components["schemas"]["EmailAddress"][]; references: string[] } | undefined> {
  const db = documents(table);
  const { Item: ref } = await db.send(new GetCommand({ TableName: table.name, Key: messageRefKey(mailbox, id), ConsistentRead: true }));
  if (ref === undefined) return undefined;
  const thread = ref.thread as string;
  const { Item } = await db.send(new GetCommand({ TableName: table.name, Key: messageKey(mailbox, thread, ref.receivedAt as string, id), ConsistentRead: true }));
  if (Item === undefined) return undefined;
  const { message, parsed } = await readMessage(mailBucket, Item as StoredMessage);
  return { message, thread, replyTo: parsed.replyTo, references: parsed.references };
}

/**
 * The mailbox's changes after the position, oldest first, without spam arrivals unless `withSpam`.
 * The page ends at the last change read. A run of spam is read past until a change is listed or
 * the feed ends, so a page that lists nothing means the caller has caught up.
 */
export async function mailboxChanges(table: Table, mailbox: string, after: number, withSpam: boolean): Promise<MailboxChangePage> {
  let position = after;
  for (;;) {
    const read = (await changesAfter(table, mailboxFeed(mailbox), position)) as MailboxChange[];
    position = read.at(-1)?.position ?? position;
    const changes = read.filter((change) => withSpam || !(change.type === "messageReceived" && change.spam === true));
    if (changes.length > 0 || read.length < changesPerPage) return { changes, position };
  }
}

/**
 * The message with its body and attachments from the raw message, in the order the contract lists
 * its fields, and the raw message parsed.
 */
async function readMessage(mailBucket: MailBucket, stored: StoredMessage): Promise<{ message: Message; parsed: ParsedMail }> {
  const raw = await mailBucket.get(stored.rawKey);
  if (raw === undefined) throw new Error(`The raw message ${stored.rawKey} is missing from the mail bucket.`);
  const parsed = await parseMail(raw);
  const { text, attachments } = parsed;
  const { id, messageId, from, to, cc, bcc, recipient, plusTag, subject, date, receivedAt, sentBy, approval } = stored;
  const message = {
    id,
    messageId,
    from: addressOf(from),
    to: to.map(addressOf),
    cc: cc.map(addressOf),
    ...(bcc !== undefined && bcc.length > 0 && { bcc: bcc.map(addressOf) }),
    recipient,
    plusTag,
    subject,
    date,
    receivedAt,
    ...(sentBy !== undefined && { sentBy }),
    ...(approval !== undefined && { approval }),
    text,
    attachments,
  };
  return { message, parsed };
}

// Threads stored before snippets and read state existed have neither, and are read.
const summaryOf = ({ id, subject, from, snippet, labels, unread, latestAt, messages }: ThreadSummary): ThreadSummary => ({
  id,
  subject,
  from: addressOf(from),
  snippet: snippet ?? "",
  labels,
  unread: unread ?? false,
  latestAt,
  messages,
});

/** The start of the text on one line, without quoted lines, cut after snippetLength characters. */
function snippetOf(text: string): string {
  const line = text
    .split("\n")
    .filter((each) => !each.trimStart().startsWith(">"))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return line.length <= snippetLength ? line : `${line.slice(0, snippetLength).trimEnd()}…`;
}

const addressOf = ({ name, address }: components["schemas"]["EmailAddress"]) => (name === undefined ? { address } : { name, address });
