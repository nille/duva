// Erasing threads for good: the eraser runs once a day and erases each thread that has had Spam or
// Trash for the retention period, and emptying Trash hands it the threads in Trash. A thread leaves
// every listing in one transaction with its threadErased change, which keeps none of its content.
// Its messages, their pointers, the drafts it sent and their raw messages go after that, recorded
// as work to finish, so a run that stops partway finishes on the next one. The approval records of
// the agents' sends in it go too if the organization's setting says so when the thread is erased,
// so turning the setting on doesn't reach back. A thread's messages leave search at once, and the
// daily run has the indexer compact each mailbox's index, so their text leaves its files within a
// day (ADR-0007). A deleted mailbox is erased the same way, thread by thread, and then everything
// else it holds but its change feed, and its index is dropped (ADR-0020).
import { BatchGetCommand, type BatchGetCommandOutput, DeleteCommand, GetCommand, PutCommand, QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { InvokeCommand, type LambdaClient } from "@aws-sdk/client-lambda";
import type { ScheduledEvent } from "aws-lambda";
import type { Table } from "./deployment.ts";
import { recordChanges } from "./feed.ts";
import { inboundPrefix } from "./infrastructure.ts";
import type { MailBucket } from "./mail-bucket.ts";
import { asRead, type Cursor, cursorOf, type ErasedLabel, keys, listingsOf, type StoredSummary, threadsPerPage, threadSummary, threadsWithLabel, trash } from "./mail.ts";
import { eraseApprovals } from "./drafting.ts";
import { compactIndexes, type IndexQueue } from "./indexing.ts";
import { allMailboxes, mailboxFeed, mailboxKey, type OrganizationSettings, organizationSettings, settingsUnchanged } from "./organization.ts";
import { documents, pk, sk, type TransactItem } from "./table.ts";

// Each thread being erased is listed until its messages are gone, and each of their raw messages,
// once per mailbox that erased it, until it is gone or another mailbox still has it.
const erasingKey = (mailbox: string, thread: string) => ({ [pk]: "erasure#threads", [sk]: `${mailbox}#${thread}` });
const rawErasureKey = (mailbox: string, rawKey: string) => ({ [pk]: "erasure#raw", [sk]: `${mailbox}#${rawKey}` });
// Each Trash emptied is listed until its threads are erased, so a run that fails is finished by the next.
const emptiedKey = ({ mailbox, before }: TrashEmptied) => ({ [pk]: "erasure#emptied", [sk]: `${mailbox}#${before}` });
// Each mailbox deleted is listed until its mail is erased, likewise.
const deletedKey = (mailbox: string) => ({ [pk]: "erasure#mailboxes", [sk]: mailbox });

/** What the eraser is handed to do besides its daily run: the Trash the actor `by` emptied at `before`. */
export interface TrashEmptied {
  mailbox: string;
  before: string;
  by: string;
}

/** What the eraser is handed when a mailbox is deleted, by the actor `by`: all its mail. */
export interface MailboxDeleted {
  mailbox: string;
  by: string;
}

/** Hands the eraser work without waiting for it. */
export interface Eraser {
  emptyTrash(emptied: TrashEmptied): Promise<void>;
  eraseMailbox(deleted: MailboxDeleted): Promise<void>;
}

/**
 * Erases each thread that got Spam or Trash more than the organization's retention period before
 * `now`, naming no actor, and finishes earlier erasures. Each thread is checked against the period
 * as it is when the thread is erased, so one an admin lengthens during the run keeps the rest.
 */
export async function eraseExpired(table: Table, mailBucket: MailBucket, indexQueue: IndexQueue, now: Date): Promise<void> {
  const { settings } = await organizationSettings(table);
  for await (const { mailbox, thread, label, labelledAt } of labelledBefore(table, settings.retentionDays, now)) {
    const due = (summary: StoredSummary, current: OrganizationSettings) => summary.labelledAt?.[label] === labelledAt && labelledAt < cutoffOf(current.retentionDays, now);
    await eraseThread(table, { mailbox, thread, by: undefined, due });
  }
  await finishErasures(table, mailBucket, indexQueue);
}

/** How many threads, across mailboxes, got Spam or Trash more than `retentionDays` before `now`: those the eraser would erase then under that period. */
export async function threadsPastRetention(table: Table, retentionDays: number, now: Date): Promise<number> {
  // A thread in both Spam and Trash is listed once for each.
  const threads = new Set<string>();
  for await (const { mailbox, thread } of labelledBefore(table, retentionDays, now)) threads.add(`${mailbox}#${thread}`);
  return threads.size;
}

/** The time a thread must have got Spam or Trash before to be past `retentionDays` at `now`. */
const cutoffOf = (retentionDays: number, now: Date) => new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000).toISOString();

/** Each listing of a thread, across mailboxes, that got Spam or Trash more than `retentionDays` before `now`, oldest first. */
async function* labelledBefore(table: Table, retentionDays: number, now: Date) {
  const cutoff = cutoffOf(retentionDays, now);
  const { [pk]: partition } = keys.labelledKey("", "", "", trash);
  let start: Record<string, unknown> | undefined;
  do {
    const page = await documents(table).send(
      new QueryCommand({
        TableName: table.name,
        KeyConditionExpression: `${pk} = :labelled AND ${sk} < :cutoff`,
        ExpressionAttributeValues: { ":labelled": partition, ":cutoff": cutoff },
        ExclusiveStartKey: start,
      }),
    );
    for (const item of page.Items ?? []) yield item as { mailbox: string; thread: string; label: ErasedLabel; labelledAt: string };
    start = page.LastEvaluatedKey;
  } while (start !== undefined);
}

/** Records that the actor emptied the Trash, before the eraser is handed it, so the eraser's daily run finishes it if the run handed it fails. */
export async function recordEmptying(table: Table, emptied: TrashEmptied): Promise<void> {
  await documents(table).send(new PutCommand({ TableName: table.name, Item: { ...emptiedKey(emptied), ...emptied } }));
}

/** Erases each thread that was in the mailbox's Trash at `before`, naming the actor `by`, and finishes earlier erasures. */
export async function emptyTrash(table: Table, mailBucket: MailBucket, indexQueue: IndexQueue, emptied: TrashEmptied): Promise<void> {
  await eraseTrash(table, emptied);
  await finishErasures(table, mailBucket, indexQueue);
}

/**
 * The write that lists the deleted mailbox for the eraser, in the transaction that deletes it, so
 * the eraser's daily run erases it if the run it is handed fails.
 */
export const mailboxErasure = (table: Table, deleted: MailboxDeleted): TransactItem => ({ Put: { TableName: table.name, Item: { ...deletedKey(deleted.mailbox), ...deleted } } });

/**
 * Erases all the deleted mailbox's mail, as emptying Trash does, naming the actor `by`: each
 * thread, then each draft left, with its approval records if the organization's setting says so,
 * then everything else of the mailbox but its change feed. Then the indexer drops its index, and
 * the eraser forgets the mailbox. Run again, it finishes what an earlier run left.
 */
async function eraseMailbox(table: Table, indexQueue: IndexQueue, { mailbox, by }: MailboxDeleted): Promise<void> {
  const items = await allItems(table, {
    KeyConditionExpression: `${pk} = :mailbox`,
    ProjectionExpression: `${sk}, erasing`,
    ExpressionAttributeValues: { ":mailbox": keys.partition(mailbox) },
  });
  for (const item of items) {
    const thread = keys.threadOf(item[sk] as string);
    if (thread !== undefined && item.erasing !== true) await eraseThread(table, { mailbox, thread, by, due: () => true });
  }
  // A thread whose erasure stopped partway has its messages erased before the rest of the mailbox goes.
  for (const item of await allItems(table, {
    KeyConditionExpression: `${pk} = :threads AND begins_with(${sk}, :mailbox)`,
    ExpressionAttributeValues: { ":threads": erasingKey("", "")[pk], ":mailbox": `${mailbox}#` },
  })) {
    await eraseMessages(table, mailbox, item.thread as string, item.erasesApprovals === true);
  }
  const { settings } = await organizationSettings(table);
  const left = await allItems(table, { KeyConditionExpression: `${pk} = :mailbox`, ExpressionAttributeValues: { ":mailbox": keys.partition(mailbox) } });
  if (settings.erasureErasesApprovals) for (const draft of left.filter((item) => (item[sk] as string).startsWith("draft#"))) await eraseApprovals(table, mailbox, draft);
  // The mailbox's own item stays, marked deleted, as its change feed's counter.
  const rest = left.filter((item) => item[sk] !== mailboxKey(mailbox)[sk]);
  for (let index = 0; index < rest.length; index += 100) {
    const chunk = rest.slice(index, index + 100);
    await documents(table).send(new TransactWriteCommand({ TransactItems: chunk.map((item) => ({ Delete: { TableName: table.name, Key: { [pk]: item[pk], [sk]: item[sk] } } })) }));
  }
  await indexQueue.send([{ task: { mailbox }, id: `${mailbox}#deleted` }]);
  await documents(table).send(new DeleteCommand({ TableName: table.name, Key: deletedKey(mailbox) }));
}

/** Erases each thread that was in the mailbox's Trash at `before`, naming the actor `by`, and then forgets that it was emptied. */
async function eraseTrash(table: Table, emptied: TrashEmptied): Promise<void> {
  const { mailbox, before, by } = emptied;
  let after: Cursor | undefined;
  do {
    const page = await threadsWithLabel(table, mailbox, trash, { limit: threadsPerPage, after, withHidden: true });
    for (const { id } of page.threads) {
      // Threads that got Trash before erasure existed have no time for it, and were in Trash then.
      await eraseThread(table, { mailbox, thread: id, by, due: (summary) => summary.labels.includes(trash) && (summary.labelledAt?.trash ?? "") <= before });
    }
    after = page.next === undefined ? undefined : cursorOf(page.next);
  } while (after !== undefined);
  await documents(table).send(new DeleteCommand({ TableName: table.name, Key: emptiedKey(emptied) }));
}

/**
 * Takes the thread out of every listing, in one transaction with its threadErased change, attributed
 * to the actor `by` or to none, if it is still `due` as it and the settings are read, and then erases its messages. The
 * thread is kept as an empty item until then, which reads as no thread at all.
 */
async function eraseThread(table: Table, { mailbox, thread, by, due }: { mailbox: string; thread: string; by: string | undefined; due: (summary: StoredSummary, settings: OrganizationSettings) => boolean }) {
  // recordChanges gives the items' cancellation reasons after the counter's and the one change's.
  const threadReason = 2;
  let erasesApprovals: boolean;
  for (let attempt = 1; ; attempt++) {
    const summary = await threadSummary(table, mailbox, thread);
    const settings = await organizationSettings(table);
    if (summary === undefined || !due(summary, settings.settings)) return;
    erasesApprovals = settings.settings.erasureErasesApprovals;
    const items: TransactItem[] = [
      { Put: { TableName: table.name, Item: { ...keys.threadKey(mailbox, thread), erasing: true }, ...asTimed(summary) } },
      ...listingsOf(summary).map((listing) => ({ Delete: { TableName: table.name, Key: keys.entryIn(mailbox, listing, summary) } })),
      ...Object.entries(summary.labelledAt ?? {}).map(([label, at]) => ({
        Delete: { TableName: table.name, Key: keys.labelledKey(at, mailbox, thread, label as ErasedLabel) },
      })),
      { Put: { TableName: table.name, Item: { ...erasingKey(mailbox, thread), mailbox, thread, erasesApprovals } } },
      // An admin who changes the settings meanwhile changes them before or after this erasure, never during it.
      settingsUnchanged(table, settings),
    ];
    try {
      await recordChanges(table, mailboxFeed(mailbox), {
        by,
        changes: [{ type: "threadErased", thread }],
        items,
      });
      break;
    } catch (error) {
      // Mail joined the thread, it was changed, or the settings were, since they were read, so they are read again.
      const reasons = error instanceof TransactionCanceledException ? (error.CancellationReasons ?? []) : [];
      // The settings' check is the last item.
      const settingsReason = threadReason + items.length - 1;
      const changed = [threadReason, settingsReason].some((reason) => reasons[reason]?.Code === "ConditionalCheckFailed");
      if (!changed || attempt === 10) throw error;
    }
  }
  await eraseMessages(table, mailbox, thread, erasesApprovals);
}

/** The condition that the thread is as it was read, with the same times for Spam and Trash, so one restored and labelled again meanwhile isn't erased. */
function asTimed(summary: StoredSummary) {
  const read = asRead(summary);
  return summary.labelledAt === undefined
    ? { ...read, ConditionExpression: `${read.ConditionExpression} AND attribute_not_exists(labelledAt)` }
    : { ...read, ConditionExpression: `${read.ConditionExpression} AND labelledAt = :labelledAt`, ExpressionAttributeValues: { ...read.ExpressionAttributeValues, ":labelledAt": summary.labelledAt } };
}

/** How many messages one transaction erases: each takes up to four deletes and the raw message's entry. */
const messagesAtOnce = 20;

/**
 * Deletes the thread's messages, their Message-ID pointers and references, the marks that SES's
 * messages were received, and the drafts it sent, with their approval records if `erasesApprovals`,
 * listing each raw message to erase, and then the thread itself. Run again, it finishes what an
 * earlier run left.
 */
async function eraseMessages(table: Table, mailbox: string, thread: string, erasesApprovals: boolean) {
  const db = documents(table);
  const messages = await allItems(table, {
    KeyConditionExpression: `${pk} = :mailbox AND begins_with(${sk}, :thread)`,
    ExpressionAttributeValues: { ":mailbox": keys.partition(mailbox), ":thread": keys.threadPrefix(thread) },
  });
  const stored = messages.filter((item) => item[sk] !== keys.threadKey(mailbox, thread)[sk]) as { [key: string]: unknown; id: string; messageId?: string; rawKey: string }[];
  for (let index = 0; index < stored.length; index += messagesAtOnce) {
    const chunk = stored.slice(index, index + messagesAtOnce);
    // A Message-ID points at the last message stored with it, which may be another thread's.
    const pointers = await Promise.all(
      chunk.map(async ({ messageId }) => (messageId === undefined ? undefined : (await db.send(new GetCommand({ TableName: table.name, Key: keys.messageIdKey(mailbox, messageId), ConsistentRead: true }))).Item)),
    );
    const items: TransactItem[] = chunk.flatMap((message, at) => [
      { Delete: { TableName: table.name, Key: { [pk]: message[pk], [sk]: message[sk] } } },
      { Delete: { TableName: table.name, Key: keys.messageRefKey(mailbox, message.id) } },
      ...(pointers[at]?.message === message.id ? [{ Delete: { TableName: table.name, Key: keys.messageIdKey(mailbox, message.messageId!) } }] : []),
      ...receivedAs(message.rawKey).map((sesMessageId) => ({ Delete: { TableName: table.name, Key: keys.receivedKey(mailbox, sesMessageId) } })),
      { Put: { TableName: table.name, Item: { ...rawErasureKey(mailbox, message.rawKey), rawKey: message.rawKey } } },
    ]);
    await db.send(new TransactWriteCommand({ TransactItems: items }));
  }
  // A sent draft keeps the text it sent.
  const drafts = await allItems(table, {
    KeyConditionExpression: `${pk} = :mailbox AND begins_with(${sk}, :draft)`,
    FilterExpression: "#send.thread = :thread",
    ExpressionAttributeNames: { "#send": "send" },
    ExpressionAttributeValues: { ":mailbox": keys.partition(mailbox), ":draft": "draft#", ":thread": thread },
  });
  if (erasesApprovals) for (const draft of drafts) await eraseApprovals(table, mailbox, draft);
  for (let index = 0; index < drafts.length; index += 100) {
    const chunk = drafts.slice(index, index + 100);
    await db.send(new TransactWriteCommand({ TransactItems: chunk.map((draft) => ({ Delete: { TableName: table.name, Key: { [pk]: draft[pk], [sk]: draft[sk] } } })) }));
  }
  await db.send(
    new TransactWriteCommand({
      TransactItems: [
        { Delete: { TableName: table.name, Key: keys.threadKey(mailbox, thread) } },
        { Delete: { TableName: table.name, Key: erasingKey(mailbox, thread) } },
      ],
    }),
  );
}

/**
 * Finishes the Trash emptied, the mailboxes deleted and the threads that earlier runs left being
 * erased, and erases each listed raw message, every version of it, unless another mailbox still
 * has it, as one message SES received for two mailboxes is stored once.
 */
async function finishErasures(table: Table, mailBucket: MailBucket, indexQueue: IndexQueue) {
  for (const item of await allItems(table, { KeyConditionExpression: `${pk} = :emptied`, ExpressionAttributeValues: { ":emptied": emptiedKey({ mailbox: "", before: "", by: "" })[pk] } })) {
    await eraseTrash(table, item as unknown as TrashEmptied);
  }
  for (const item of await allItems(table, { KeyConditionExpression: `${pk} = :deleted`, ExpressionAttributeValues: { ":deleted": deletedKey("")[pk] } })) {
    await eraseMailbox(table, indexQueue, item as unknown as MailboxDeleted);
  }
  for (const item of await allItems(table, { KeyConditionExpression: `${pk} = :threads`, ExpressionAttributeValues: { ":threads": erasingKey("", "")[pk] } })) {
    await eraseMessages(table, item.mailbox as string, item.thread as string, item.erasesApprovals === true);
  }
  const raw = await allItems(table, { KeyConditionExpression: `${pk} = :raw`, ExpressionAttributeValues: { ":raw": rawErasureKey("", "")[pk] } });
  if (raw.length === 0) return;
  const mailboxes = await allMailboxes(table);
  for (const item of raw) {
    const rawKey = item.rawKey as string;
    if (!(await receivedElsewhere(table, mailboxes, rawKey))) await mailBucket.erase(rawKey);
    await documents(table).send(new DeleteCommand({ TableName: table.name, Key: { [pk]: item[pk], [sk]: item[sk] } }));
  }
}

/** Whether any of the mailboxes still has the raw message, which only received ones can share. */
async function receivedElsewhere(table: Table, mailboxes: string[], rawKey: string): Promise<boolean> {
  const [sesMessageId] = receivedAs(rawKey);
  if (sesMessageId === undefined) return false;
  for (let index = 0; index < mailboxes.length; index += 100) {
    let wanted: Record<string, unknown>[] | undefined = mailboxes.slice(index, index + 100).map((mailbox) => keys.receivedKey(mailbox, sesMessageId));
    while (wanted !== undefined && wanted.length > 0) {
      const read: BatchGetCommandOutput = await documents(table).send(new BatchGetCommand({ RequestItems: { [table.name]: { Keys: wanted, ConsistentRead: true } } }));
      if ((read.Responses?.[table.name] ?? []).length > 0) return true;
      wanted = read.UnprocessedKeys?.[table.name]?.Keys;
    }
  }
  return false;
}

/** The ID SES gave the message stored at the raw key, if SES received it, or none for a sent one. */
const receivedAs = (rawKey: string): string[] => (rawKey.startsWith(inboundPrefix) ? [rawKey.slice(inboundPrefix.length)] : []);

/** Every item the query finds, all its pages read. */
async function allItems(table: Table, query: Omit<ConstructorParameters<typeof QueryCommand>[0], "TableName">): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  let start: Record<string, unknown> | undefined;
  do {
    const page = await documents(table).send(new QueryCommand({ TableName: table.name, ConsistentRead: true, ...query, ExclusiveStartKey: start }));
    items.push(...(page.Items ?? []));
    start = page.LastEvaluatedKey;
  } while (start !== undefined);
  return items;
}

/** What invokes the eraser: its daily schedule, emptying a Trash, or deleting a mailbox. */
export type EraserEvent = Pick<ScheduledEvent, "time"> | { emptyTrash: TrashEmptied } | { eraseMailbox: MailboxDeleted };

/**
 * The eraser's handler. Either way it finishes what earlier runs left. The daily run then gives
 * the indexer's queue the compaction of every index, also when erasing raw mail failed.
 */
export function createEraser({ table, mailBucket, indexQueue }: { table: Table; mailBucket: MailBucket; indexQueue: IndexQueue }) {
  return async (event: EraserEvent): Promise<void> => {
    if ("emptyTrash" in event) return emptyTrash(table, mailBucket, indexQueue, event.emptyTrash);
    // The deleted mailbox is listed, so finishing what is listed erases it.
    if ("eraseMailbox" in event) return finishErasures(table, mailBucket, indexQueue);
    try {
      await eraseExpired(table, mailBucket, indexQueue, new Date(event.time));
    } finally {
      await compactIndexes(table, indexQueue, new Date(event.time));
    }
  };
}

/** The eraser Lambda, invoked without waiting. Lambda retries a run that failed, which finishes it. */
export function lambdaEraser(lambda: LambdaClient, functionName: string): Eraser {
  const invoke = async (event: EraserEvent) => {
    await lambda.send(new InvokeCommand({ FunctionName: functionName, InvocationType: "Event", Payload: JSON.stringify(event) }));
  };
  return {
    emptyTrash: (emptyTrash) => invoke({ emptyTrash }),
    eraseMailbox: (eraseMailbox) => invoke({ eraseMailbox }),
  };
}
