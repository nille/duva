// Keeping each mailbox's search index current (ADR-0007). The mailbox's change feed says what
// changed, and the indexer, its index's one writer, catches up from where it left off: it reads
// each changed thread and new message as they are now, so a change it handles twice changes
// nothing. The table's stream hands the feeder each new change, and the feeder gives the indexer's
// FIFO queue a task for its mailbox, with the mailbox as the message group, so each mailbox has
// one writer at a time. A mailbox whose index is missing, or from an older version of it, is
// backfilled from its stored mail, a step at a time, each step a task of its own. The eraser's
// daily run gives each mailbox a task to compact its index, so erased text leaves its files.
import { randomUUID } from "node:crypto";
import { SendMessageBatchCommand, type SQSClient } from "@aws-sdk/client-sqs";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBStreamEvent, SQSEvent } from "aws-lambda";
import type { Table } from "./deployment.ts";
import { changesAfter, changesPerPage, lastPosition } from "./feed.ts";
import type { MailBucket } from "./mail-bucket.ts";
import { type StoredMessage, type StoredSummary, storedMessage, threadsWithMessages, threadSummary } from "./mail.ts";
import { parseMail, searchableText } from "./mime.ts";
import { allMailboxes, mailboxFeed, mailboxKey } from "./organization.ts";
import type { IndexedMessage, IndexWriter, SearchEngine } from "./search-engine.ts";
import { documents, pk, sk } from "./table.ts";

/**
 * The version of what the index holds. A deploy that changes it rebuilds every mailbox's index:
 * its indexer drops the old one and backfills a new one. Version 2 embeds each message (#62).
 */
export const indexVersion = 2;

/**
 * What the indexer's queue carries: a mailbox to bring up to date, the step of its backfill to
 * take, if any, and whether to compact its index afterwards, if messages have left it.
 */
export interface IndexTask {
  mailbox: string;
  backfill?: number;
  compact?: true;
}

/** A task as the queue takes it, with the ID that deduplicates it, as the queue does within five minutes. */
export interface QueuedTask {
  task: IndexTask;
  id: string;
}

/** The indexer's FIFO queue. */
export interface IndexQueue {
  send(tasks: QueuedTask[]): Promise<void>;
}

/** The index's state in a mailbox, which only its indexer writes. */
interface IndexState {
  version: number;
  /** The position in the mailbox's change feed the index has caught up to. */
  position: number;
  /** How many commits since the index's last maintenance. */
  writes: number;
  /** The backfill, until it is done: the step to take next, and the thread it reads on from. */
  backfill?: { step: number; after?: string };
  /** When messages first left the index since it was last compacted, so that files may still hold their text. */
  removedSince?: string;
  /** When the index was last compacted, or made. An index from before compaction has none, and may hold removed text. */
  compactedAt?: string;
}

const stateKey = (mailbox: string) => ({ [pk]: mailboxKey(mailbox)[pk]!, [sk]: "search-index" });

/** How many commits the indexer makes before it maintains the index, so unindexed writes don't slow searches (#18). */
const maintainedAfter = 20;

/** How many of a backfill's messages one step indexes, at least. */
const backfillStep = 100;

/** How many of the feed's changes one task catches up on at most, before it hands the rest to a task of its own. */
const changesAtOnce = 10 * changesPerPage;

/** How much of a message's text the index holds. */
const indexedTextLength = 100_000;

/** How many raw messages the indexer reads at once. */
const readsAtOnce = 8;

async function stateOf(table: Table, mailbox: string): Promise<IndexState | undefined> {
  const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: stateKey(mailbox), ConsistentRead: true }));
  return Item as IndexState | undefined;
}

/**
 * The threads whose labels, read state or messages changed after the mailbox's index last caught
 * up, which the index may not show yet, from as far of the feed as one catch-up reads.
 */
export async function changedSinceIndexed(table: Table, mailbox: string): Promise<string[]> {
  const state = await stateOf(table, mailbox);
  if (state === undefined) return [];
  const threads = new Set<string>();
  let position = state.position;
  for (let read = 0; read < changesAtOnce; read += changesPerPage) {
    const changes = await changesAfter(table, mailboxFeed(mailbox), position);
    for (const change of changes) if (typeof change.thread === "string") threads.add(change.thread);
    if (changes.length < changesPerPage) break;
    position = changes.at(-1)!.position as number;
  }
  return [...threads];
}

/** The feeder's handler: each mailbox whose change feed has new changes gets a task, which the last change's position deduplicates. */
export function createFeeder(queue: IndexQueue) {
  return async (event: DynamoDBStreamEvent): Promise<void> => {
    const last = new Map<string, number>();
    for (const record of event.Records) {
      const partition = record.dynamodb?.Keys?.[pk]?.S ?? "";
      const mailbox = partition.slice(feedPartition.start.length, -feedPartition.end.length);
      const position = Number(record.dynamodb?.NewImage?.position?.N ?? 0);
      last.set(mailbox, Math.max(last.get(mailbox) ?? 0, position));
    }
    await queue.send([...last].map(([mailbox, position]) => ({ task: { mailbox }, id: `${mailbox}#${position}` })));
  };
}

// What a mailbox's feed partition has before and after the mailbox's ID.
const [start = "", end = ""] = mailboxFeed("\0").partition.split("\0");
const feedPartition = { start, end };

/** What the indexer works with. */
export interface IndexerParts {
  table: Table;
  mailBucket: MailBucket;
  engine: SearchEngine;
  queue: IndexQueue;
  /** How many messages one step of a backfill indexes, at least. */
  backfillMessages?: number;
}

/**
 * The indexer's handler: brings each mailbox in the batch up to date, once however many of its
 * tasks the batch holds, taking the step of its backfill a task names. A failure fails the batch,
 * which the queue hands it again, and doing it again changes nothing.
 */
export function createIndexer(parts: IndexerParts) {
  return async (event: SQSEvent): Promise<void> => {
    const tasks = new Map<string, IndexTask[]>();
    for (const { body } of event.Records) {
      const task = JSON.parse(body) as IndexTask;
      tasks.set(task.mailbox, [...(tasks.get(task.mailbox) ?? []), task]);
    }
    for (const [mailbox, mailboxTasks] of tasks) await bringUpToDate(parts, mailbox, mailboxTasks);
  };
}

async function bringUpToDate({ table, mailBucket, engine, queue, backfillMessages = backfillStep }: IndexerParts, mailbox: string, tasks: IndexTask[]) {
  let state = await stateOf(table, mailbox);
  let step: number | undefined;
  if (state === undefined || state.version !== indexVersion) {
    // The backfill indexes what is stored now, so the feed's changes count from here on.
    if (state !== undefined) await engine.drop(mailbox);
    state = { version: indexVersion, position: await lastPosition(table, mailboxFeed(mailbox)), writes: 0, backfill: { step: 0 }, compactedAt: new Date().toISOString() };
    await documents(table).send(new PutCommand({ TableName: table.name, Item: { ...stateKey(mailbox), ...state } }));
    step = 0;
  } else if (state.backfill !== undefined && (state.backfill.step === 0 || tasks.some((task) => task.backfill === state!.backfill!.step))) {
    // Step 0 is taken when the backfill starts, with no task of its own, so any task takes it again if that failed.
    step = state.backfill.step;
  }
  const writer = await engine.writer(mailbox);

  if (step !== undefined) {
    const { threads, next } = await threadsWithMessages(table, mailbox, { after: state.backfill?.after, messages: backfillMessages });
    await writer.put(await indexed(mailBucket, threads.flatMap(({ summary, messages }) => messages.map((message) => ({ message, summary })))));
    state.writes++;
    // The next step goes to the queue before the state says so, so a failure between the two takes this step again.
    if (next !== undefined) await queue.send([{ task: { mailbox, backfill: step + 1 }, id: `${mailbox}#backfill#${step + 1}` }]);
    state.backfill = next === undefined ? undefined : { step: step + 1, after: next };
  }

  let read = 0;
  for (; read < changesAtOnce; read += changesPerPage) {
    const changes = await changesAfter(table, mailboxFeed(mailbox), state.position);
    if (changes.length === 0) break;
    const { commits, removed } = await apply({ table, mailBucket }, writer, mailbox, changes);
    state.writes += commits;
    if (removed) state.removedSince ??= new Date().toISOString();
    state.position = changes.at(-1)!.position as number;
    if (changes.length < changesPerPage) break;
  }
  // Compaction waits for the end of a long catch-up, so it covers what is erased there too.
  const compact = tasks.some((task) => task.compact === true);
  const continues = read >= changesAtOnce;
  if (continues) await queue.send([{ task: { mailbox, ...(compact && { compact }) }, id: `${mailbox}#continue#${state.position}` }]);

  if (compact && !continues && (state.removedSince !== undefined || state.compactedAt === undefined)) {
    await writer.compact();
    state.removedSince = undefined;
    state.compactedAt = new Date().toISOString();
    state.writes = 0;
  } else if (state.writes >= maintainedAfter) {
    await writer.maintain();
    state.writes = 0;
  }
  await documents(table).send(new PutCommand({ TableName: table.name, Item: { ...stateKey(mailbox), ...state } }));
}

/**
 * Applies the changes to the index: each changed thread as it is now, its new messages added, its
 * labels and read state given to its messages, or its messages removed if it has been erased.
 * Returns how many commits it made, and whether it removed messages.
 */
async function apply(
  { table, mailBucket }: { table: Table; mailBucket: MailBucket },
  writer: IndexWriter,
  mailbox: string,
  changes: Record<string, unknown>[],
): Promise<{ commits: number; removed: boolean }> {
  const threads = [...new Set(changes.flatMap((change) => (typeof change.thread === "string" ? [change.thread] : [])))];
  if (threads.length === 0) return { commits: 0, removed: false };
  const summaries = new Map(await Promise.all(threads.map(async (thread) => [thread, await threadSummary(table, mailbox, thread)] as const)));
  const added = changes.filter((change) => change.type === "messageReceived" || change.type === "messageSent").map((change) => change.message as string);
  const stored = (await Promise.all(added.map((message) => storedMessage(table, mailbox, message)))).flatMap((message) => {
    const summary = message === undefined ? undefined : summaries.get(message.thread);
    return message === undefined || summary === undefined ? [] : [{ message, summary }];
  });
  const erased = threads.filter((thread) => summaries.get(thread) === undefined);
  const kept = threads.flatMap((thread) => {
    const summary = summaries.get(thread);
    return summary === undefined ? [] : [{ id: thread, labels: summary.labels, unread: summary.unread }];
  });
  let commits = 0;
  if (stored.length > 0) {
    await writer.put(await indexed(mailBucket, stored));
    commits++;
  }
  // A new message can bring its thread back to the Inbox, unread, so its earlier messages change too.
  if (kept.length > 0) {
    await writer.relabel(kept);
    commits++;
  }
  if (erased.length > 0) {
    await writer.removeThreads(erased);
    commits++;
  }
  return { commits, removed: erased.length > 0 };
}

/** The messages as the index has them, each with its thread's labels and read state, and what its raw message says. */
async function indexed(mailBucket: MailBucket, messages: { message: StoredMessage & { thread: string }; summary: StoredSummary }[]): Promise<IndexedMessage[]> {
  const out: IndexedMessage[] = [];
  for (let at = 0; at < messages.length; at += readsAtOnce) {
    out.push(
      ...(await Promise.all(
        messages.slice(at, at + readsAtOnce).map(async ({ message, summary }) => {
          const raw = await mailBucket.get(message.rawKey);
          const parsed = raw === undefined ? undefined : await parseMail(raw);
          const attachments = parsed?.attachments ?? [];
          return {
            id: message.id,
            thread: message.thread,
            from: message.from,
            recipients: [...message.to, ...message.cc, ...(message.bcc ?? [])],
            subject: message.subject,
            receivedAt: new Date(message.receivedAt),
            labels: summary.labels,
            unread: summary.unread,
            attachments: attachments.flatMap(({ name }) => (name === undefined ? [] : [name])),
            hasAttachment: attachments.length > 0,
            text: parsed === undefined ? "" : searchableText(parsed).slice(0, indexedTextLength),
          };
        }),
      )),
    );
  }
  return out;
}

/**
 * Gives the indexer a task for each mailbox whose index is missing, from an older version, or
 * still being backfilled, so setup starts each backfill, and finishes one that stopped partway.
 */
export async function indexMailboxes(table: Table, queue: IndexQueue): Promise<void> {
  const mailboxes = await allMailboxes(table);
  const tasks: QueuedTask[] = [];
  for (const mailbox of mailboxes) {
    const state = await stateOf(table, mailbox);
    if (state?.version === indexVersion && state.backfill === undefined) continue;
    const backfill = state?.version === indexVersion ? state.backfill?.step : undefined;
    // A new ID each time, so a setup run again hands the task again.
    tasks.push({ task: { mailbox, ...(backfill !== undefined && { backfill }) }, id: `${mailbox}#setup#${randomUUID()}` });
  }
  await queue.send(tasks);
}

/**
 * Gives the indexer a task to compact the index of each mailbox that has one, which it does if
 * messages have left it. The eraser's daily run at `at` does this, so a run Lambda retries hands
 * each task once. Each task first catches up, so it covers what the run itself erased.
 */
export async function compactIndexes(table: Table, queue: IndexQueue, at: Date): Promise<void> {
  const indexed = (await indexStates(table)).flatMap(([mailbox, state]) => (state === undefined ? [] : [mailbox]));
  await queue.send(indexed.map((mailbox) => ({ task: { mailbox, compact: true }, id: `${mailbox}#compact#${at.toISOString()}` })));
}

/** When messages first left the index that has waited longest for compaction since, if any index has. */
export async function uncompactedSince(table: Table): Promise<Date | undefined> {
  const times = (await indexStates(table)).flatMap(([, state]) => (state?.removedSince === undefined ? [] : [new Date(state.removedSince).getTime()]));
  return times.length === 0 ? undefined : new Date(Math.min(...times));
}

/** How many of the organization's mailboxes there are, and how many have an index of this version, backfilled. */
export async function indexedMailboxes(table: Table): Promise<{ mailboxes: number; indexed: number }> {
  const states = await indexStates(table);
  return { mailboxes: states.length, indexed: states.filter(([, state]) => state?.version === indexVersion && state.backfill === undefined).length };
}

/** Each of the organization's mailboxes, with its index's state if it has an index. */
async function indexStates(table: Table): Promise<[mailbox: string, state: IndexState | undefined][]> {
  const mailboxes = await allMailboxes(table);
  return Promise.all(mailboxes.map(async (mailbox) => [mailbox, await stateOf(table, mailbox)] as [string, IndexState | undefined]));
}

/** The indexer's queue in SQS, a FIFO queue with each mailbox as a message group. */
export function sqsIndexQueue(sqs: SQSClient, url: string): IndexQueue {
  return {
    async send(tasks) {
      for (let at = 0; at < tasks.length; at += 10) {
        const { Failed = [] } = await sqs.send(
          new SendMessageBatchCommand({
            QueueUrl: url,
            Entries: tasks.slice(at, at + 10).map(({ task, id }, index) => ({
              Id: String(index),
              MessageBody: JSON.stringify(task),
              MessageGroupId: task.mailbox,
              MessageDeduplicationId: id,
            })),
          }),
        );
        if (Failed.length > 0) throw new Error(`SQS refused ${Failed.length} of the indexer's tasks: ${Failed.map(({ Message }) => Message).join("; ")}`);
      }
    },
  };
}
