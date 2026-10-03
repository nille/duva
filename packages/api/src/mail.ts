// The mail in a mailbox: its threads, their messages and labels, and the mailbox's change feed.
// Everything is in the mailbox's own partitions. A message's body stays in the raw message in the
// mail bucket, and is read from there.
import { randomUUID } from "node:crypto";
import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { components } from "@duva/openapi";
import type { Table } from "./deployment.ts";
import { changesAfter, changesPerPage, type Feed, recordChanges } from "./feed.ts";
import type { MailBucket } from "./mail-bucket.ts";
import { type ParsedMail, parseMail } from "./mime.ts";
import { mailboxKey } from "./organization.ts";
import { documents, isNew, pk, sk } from "./table.ts";

export type ThreadSummary = components["schemas"]["ThreadSummary"];
export type Thread = components["schemas"]["Thread"];
export type Message = components["schemas"]["Message"];
export type MailboxChange = components["schemas"]["MailboxChange"];
export type MailboxChangePage = components["schemas"]["MailboxChangePage"];

/** The label new mail gets. */
export const inbox = "inbox";
/** The label mail SES judged to be spam gets instead. */
export const spam = "spam";

/** How many threads one listing gives at most. */
const threadsPerPage = 100;

const partition = (mailbox: string) => mailboxKey(mailbox)[pk]!;
// A thread's messages sort before the thread itself, oldest first, and nothing else starts with its prefix.
const threadPrefix = (thread: string) => `thread#${thread}#`;
const threadKey = (mailbox: string, thread: string) => ({ [pk]: partition(mailbox), [sk]: `${threadPrefix(thread)}thread` });
const messageKey = (mailbox: string, thread: string, receivedAt: string, message: string) => ({
  [pk]: partition(mailbox),
  [sk]: `${threadPrefix(thread)}message#${receivedAt}#${message}`,
});
// Each label lists its threads newest first, each with its summary.
const labelKey = (mailbox: string, label: string, latestAt: string, thread: string) => ({
  [pk]: `${partition(mailbox)}#label#${label}`,
  [sk]: `${latestAt}#${thread}`,
});
// Each Message-ID points at its message, so a reply can find the thread it belongs in.
const messageIdKey = (mailbox: string, messageId: string) => ({ [pk]: partition(mailbox), [sk]: `message-id#${messageId}` });
// Each message in Duva points at its thread and its place there, so a reply can find what it answers.
const messageRefKey = (mailbox: string, message: string) => ({ [pk]: partition(mailbox), [sk]: `message#${message}` });
// Each SES message is stored once per mailbox, however often SES's event is processed.
const receivedKey = (mailbox: string, sesMessageId: string) => ({ [pk]: partition(mailbox), [sk]: `received#${sesMessageId}` });

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

/** How many of the messages a reply names are looked up, newest first, to find its thread. */
const answersLookedUp = 100;

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

  const message = randomUUID();
  const from = parsed.from ?? { address: sender };
  const stored = {
    id: message,
    messageId: parsed.messageId,
    from,
    to: parsed.to,
    cc: parsed.cc,
    recipient,
    plusTag,
    subject: parsed.subject,
    date: parsed.date ?? receivedAt,
    receivedAt,
    rawKey,
  };
  // recordChanges gives the items' cancellation reasons after the counter's and the one change's.
  const [receivedReason, threadReason] = [2, 3];
  const put = (Item: Record<string, unknown>, condition = {}) => ({ Put: { TableName: table.name, Item, ...condition } });
  for (let attempt = 1; ; attempt++) {
    const joined = arrival.spam ? undefined : await threadAnswered(table, mailbox, parsed.answers);
    const thread = joined?.id ?? randomUUID();
    const summary: ThreadSummary =
      joined === undefined
        ? { id: thread, subject: parsed.subject, from, labels: [label], latestAt: receivedAt, messages: 1 }
        : {
            ...joined,
            labels: joined.labels.includes(label) ? joined.labels : [...joined.labels, label],
            latestAt: receivedAt > joined.latestAt ? receivedAt : joined.latestAt,
            messages: joined.messages + 1,
          };
    // A thread is written only if it is as it was read, so replies arriving together each count.
    const asRead =
      joined === undefined
        ? isNew
        : { ConditionExpression: "messages = :messages AND labels = :labels", ExpressionAttributeValues: { ":messages": joined.messages, ":labels": joined.labels } };
    // The labels' entries move to the thread's new place. A delete and a put of the same item can't
    // share a transaction, so a thread that keeps its place has its entries overwritten instead.
    const moved = joined !== undefined && joined.latestAt !== summary.latestAt ? joined.labels : [];
    try {
      await recordChanges(table, mailboxFeed(mailbox), {
        by: undefined,
        changes: [{ type: "messageReceived", thread, message, ...(arrival.spam ? { spam: true } : {}) }],
        items: [
          put(receivedKey(mailbox, sesMessageId), isNew),
          put({ ...threadKey(mailbox, thread), ...summary }, asRead),
          put({ ...messageKey(mailbox, thread, receivedAt, message), ...stored, thread }),
          ...moved.map((label) => ({ Delete: { TableName: table.name, Key: labelKey(mailbox, label, joined!.latestAt, thread) } })),
          ...summary.labels.map((label) => put({ ...labelKey(mailbox, label, summary.latestAt, thread), ...summary })),
          ...(parsed.messageId === undefined || arrival.spam ? [] : [put({ ...messageIdKey(mailbox, parsed.messageId), thread, message })]),
          put({ ...messageRefKey(mailbox, message), thread, receivedAt }),
        ],
      });
      return true;
    } catch (error) {
      const reasons = error instanceof TransactionCanceledException ? (error.CancellationReasons ?? []) : [];
      // Another processing of the same event stored it first.
      if (reasons[receivedReason]?.Code === "ConditionalCheckFailed") return false;
      // Another message changed the thread since it was read, so it is read again.
      if (reasons[threadReason]?.Code !== "ConditionalCheckFailed" || attempt === 10) throw error;
    }
  }
}

/** The thread of the first of the messages that the mailbox has, if it has any. */
async function threadAnswered(table: Table, mailbox: string, messageIds: string[]): Promise<ThreadSummary | undefined> {
  const found = await Promise.all(
    messageIds
      .slice(0, answersLookedUp)
      .map(async (messageId) => (await documents(table).send(new GetCommand({ TableName: table.name, Key: messageIdKey(mailbox, messageId), ConsistentRead: true }))).Item),
  );
  const thread = found.find((item) => item !== undefined)?.thread as string | undefined;
  if (thread === undefined) return undefined;
  const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: threadKey(mailbox, thread), ConsistentRead: true }));
  return Item === undefined ? undefined : summaryOf(Item as ThreadSummary);
}

/** The newest threads with the label, newest first. */
export async function threadsWithLabel(table: Table, mailbox: string, label: string): Promise<ThreadSummary[]> {
  const { Items = [] } = await documents(table).send(
    new QueryCommand({
      TableName: table.name,
      KeyConditionExpression: `${pk} = :label`,
      ExpressionAttributeValues: { ":label": labelKey(mailbox, label, "", "")[pk] },
      ScanIndexForward: false,
      Limit: threadsPerPage,
    }),
  );
  return Items.map((item) => summaryOf(item as ThreadSummary));
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
  if (thread === undefined) return undefined;
  const stored = items.filter((item) => item !== thread);
  const messages = await Promise.all(stored.map(async (item) => (await readMessage(mailBucket, item as Message & { rawKey: string })).message));
  return { id, subject: thread.subject, labels: thread.labels, messages };
}

/**
 * The message with the ID in the mailbox, read from its raw message, with its thread and the
 * Reply-To it gives, or undefined if the mailbox has no such message.
 */
export async function findMessage(
  table: Table,
  mailBucket: MailBucket,
  mailbox: string,
  id: string,
): Promise<{ message: Message; thread: string; replyTo: components["schemas"]["EmailAddress"][] } | undefined> {
  const db = documents(table);
  const { Item: ref } = await db.send(new GetCommand({ TableName: table.name, Key: messageRefKey(mailbox, id), ConsistentRead: true }));
  if (ref === undefined) return undefined;
  const thread = ref.thread as string;
  const { Item } = await db.send(new GetCommand({ TableName: table.name, Key: messageKey(mailbox, thread, ref.receivedAt as string, id), ConsistentRead: true }));
  if (Item === undefined) return undefined;
  const { message, parsed } = await readMessage(mailBucket, Item as Message & { rawKey: string });
  return { message, thread, replyTo: parsed.replyTo };
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
async function readMessage(mailBucket: MailBucket, stored: Message & { rawKey: string }): Promise<{ message: Message; parsed: ParsedMail }> {
  const raw = await mailBucket.get(stored.rawKey);
  if (raw === undefined) throw new Error(`The raw message ${stored.rawKey} is missing from the mail bucket.`);
  const parsed = await parseMail(raw);
  const { text, attachments } = parsed;
  const { id, messageId, from, to, cc, recipient, plusTag, subject, date, receivedAt } = stored;
  const message = { id, messageId, from: addressOf(from), to: to.map(addressOf), cc: cc.map(addressOf), recipient, plusTag, subject, date, receivedAt, text, attachments };
  return { message, parsed };
}

const summaryOf = ({ id, subject, from, labels, latestAt, messages }: ThreadSummary): ThreadSummary => ({
  id,
  subject,
  from: addressOf(from),
  labels,
  latestAt,
  messages,
});

const addressOf = ({ name, address }: components["schemas"]["EmailAddress"]) => (name === undefined ? { address } : { name, address });
