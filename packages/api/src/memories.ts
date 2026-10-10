// What Coo remembers of its human (ADR-0036, #151): what they tell it, and what it learns from mail
// it reads in its own runs, each memory naming its sources. The memories sit in the human's
// partition, so they go with the human, each with its Titan embedding, so Coo finds them by meaning
// as mail search does. Each thread a memory was learned from has a pointer to it in its mailbox's
// partition, which erasing the thread looks up, as it looks up the thread's messages, and erases the
// memory in the same transaction. Handing a mailbox over erases what was learned from its threads.
import { randomUUID } from "node:crypto";
import { ConditionalCheckFailedException, TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { GetCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { components } from "@duva/openapi";
import { sponsorAccessIn } from "./access.ts";
import { jsonBody, type OperationHandler, refusal } from "./api.ts";
import type { Table } from "./deployment.ts";
import { allItems } from "./erasure.ts";
import { keys, screener, spam, threadSummary } from "./mail.ts";
import { actorKey, type Actor, agentSettings, mailboxKey, ownedMailboxes } from "./organization.ts";
import { learnsFromMail } from "./preferences.ts";
import { documents, isNew, pk, sk, type TransactItem } from "./table.ts";

type Memory = components["schemas"]["Memory"];

/** The most memories a human has, so a run's search reads them all within its budget. */
const memoriesKept = 500;
// The most threads one memory names.
const sourcesKept = 5;
const longestMemory = 500;

const memoryPrefix = "memory#";
const memoryKey = (human: string, memory: string) => ({ [pk]: actorKey(human)[pk]!, [sk]: `${memoryPrefix}${memory}` });
// Each thread a memory was learned from points at it, in the thread's mailbox, by the thread first.
const sourcesPrefix = "memory-from#";
const sourcePrefix = (thread: string) => `${sourcesPrefix}${thread}#`;
const sourceKey = (mailbox: string, thread: string, memory: string) => ({ [pk]: mailboxKey(mailbox)[pk]!, [sk]: `${sourcePrefix(thread)}${memory}` });
// Whether the human's Coo has kept a memory from mail, and whether its bubble said so (#151).
const noteKey = (human: string) => ({ [pk]: actorKey(human)[pk]!, [sk]: "memory-note" });

interface StoredMemory {
  id: string;
  human: string;
  text: string;
  kept: string;
  corrected?: string;
  threads?: components["schemas"]["MemorySource"][];
  vector: Uint8Array;
}

const memoryOf = ({ id, text, kept, corrected, threads }: StoredMemory): Memory => ({
  id,
  text,
  kept,
  ...(corrected !== undefined && { corrected }),
  source: threads === undefined ? "told" : "mail",
  ...(threads !== undefined && { threads }),
});

const vectorOf = (stored: Uint8Array) => {
  const bytes = Uint8Array.from(stored);
  return new Float32Array(bytes.buffer, 0, bytes.byteLength / 4);
};
const bytesOf = (vector: Float32Array) => new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength);

/** The human whose memories the actor reaches: a human's own, and Coo's its human's. Undefined for any other agent. */
const humanOf = (actor: Actor | undefined): string | undefined => (actor?.kind === "human" ? actor.id : actor?.kind === "agent" && actor.mailboxAgent === true ? actor.sponsor : undefined);
const othersRefused = () => refusal(403, "Only humans and their own Coo have memories. Your sponsor can tell their Coo what to remember in Ask Coo.");

/** A memory as erasure needs it: whose it is, and the pointers of the threads it was learned from. */
type Forgotten = Pick<StoredMemory, "human" | "id" | "threads">;

/** A pointer whose memory went already, which goes by itself. */
const pointerAlone = ({ human, memory, mailbox, thread }: Record<string, unknown>): Forgotten => ({ human: human as string, id: memory as string, threads: [{ mailbox: mailbox as string, thread: thread as string, subject: "" }] });

async function storedMemories(table: Table, human: string): Promise<StoredMemory[]> {
  return (await allItems(table, {
    KeyConditionExpression: `${pk} = :human AND begins_with(${sk}, :memory)`,
    ExpressionAttributeValues: { ":human": actorKey(human)[pk], ":memory": memoryPrefix },
  })) as unknown as StoredMemory[];
}

async function storedMemory(table: Table, human: string, memory: string): Promise<StoredMemory | undefined> {
  const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: memoryKey(human, memory), ConsistentRead: true }));
  return Item as StoredMemory | undefined;
}

/** The deletes that forget the memory and its pointers. */
const forgetting = (table: Table, { human, id, threads = [] }: Forgotten): TransactItem[] => [
  { Delete: { TableName: table.name, Key: memoryKey(human, id) } },
  ...threads.map(({ mailbox, thread }) => ({ Delete: { TableName: table.name, Key: sourceKey(mailbox, thread, id) } })),
];

/** Writes the items in transactions of whole memories, at most 100 items each. */
async function forgetAll(table: Table, memories: Forgotten[]): Promise<void> {
  let batch: TransactItem[] = [];
  const send = async () => {
    if (batch.length > 0) await documents(table).send(new TransactWriteCommand({ TransactItems: batch }));
    batch = [];
  };
  for (const memory of memories) {
    const items = forgetting(table, memory);
    if (batch.length + items.length > 100) await send();
    batch.push(...items);
  }
  await send();
}

/** The memories learned from the thread, by their pointers there, as they are stored now. Pointers left without a memory come too, by themselves. */
async function learnedFrom(table: Table, mailbox: string, thread: string): Promise<Forgotten[]> {
  const pointers = await allItems(table, {
    KeyConditionExpression: `${pk} = :mailbox AND begins_with(${sk}, :thread)`,
    ExpressionAttributeValues: { ":mailbox": mailboxKey(mailbox)[pk], ":thread": sourcePrefix(thread) },
  });
  return Promise.all(pointers.map(async (pointer) => (await storedMemory(table, pointer.human as string, pointer.memory as string)) ?? pointerAlone(pointer)));
}

/**
 * The deletes that erase every memory learned from the thread, for the transaction that erases it,
 * or none if they wouldn't fit in it beside `others` items, which `forgetLearnedFrom` erases next.
 */
export async function memoriesErasedWith(table: Table, mailbox: string, thread: string, others: number): Promise<TransactItem[]> {
  const items = (await learnedFrom(table, mailbox, thread)).flatMap((memory) => forgetting(table, memory));
  return others + items.length <= 100 ? items : [];
}

/** Erases every memory still learned from the thread, as one kept while it was being erased. */
export async function forgetLearnedFrom(table: Table, mailbox: string, thread: string): Promise<void> {
  await forgetAll(table, await learnedFrom(table, mailbox, thread));
}

/** Erases what the human's Coo learned from the mailbox's threads, as the mailbox goes to another human. */
export async function forgetMailboxMemories(table: Table, mailbox: string, human: string): Promise<void> {
  const pointers = await allItems(table, {
    KeyConditionExpression: `${pk} = :mailbox AND begins_with(${sk}, :memory)`,
    ExpressionAttributeValues: { ":mailbox": mailboxKey(mailbox)[pk], ":memory": sourcesPrefix },
  });
  const theirs = [...new Set(pointers.filter((pointer) => pointer.human === human).map(({ memory }) => memory as string))];
  const memories = await Promise.all(theirs.map((id) => storedMemory(table, human, id)));
  // A pointer whose memory went already goes by itself.
  const orphans = pointers.filter((pointer) => pointer.human === human && !memories.some((memory) => memory?.id === pointer.memory));
  await forgetAll(table, [...memories.filter((memory) => memory !== undefined), ...orphans.map(pointerAlone)]);
}

/**
 * Whether the human's Coo kept its first memory from mail and its bubble hasn't said so yet, which
 * this marks said, so only one turn says it.
 */
export async function firstMemoryNoted(table: Table, human: string): Promise<boolean> {
  const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: noteKey(human), ConsistentRead: true }));
  if (Item?.fromMail === undefined || Item.noted === true) return false;
  try {
    await documents(table).send(new UpdateCommand({ TableName: table.name, Key: noteKey(human), UpdateExpression: "SET noted = :yes", ConditionExpression: "attribute_not_exists(noted)", ExpressionAttributeValues: { ":yes": true } }));
    return true;
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) return false;
    throw error;
  }
}

/** The memory's text as given, or a refusal. */
function textIn(body: Record<string, unknown>) {
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (text === "" || text.length > longestMemory) return refusal(400, `Give text as what to remember, in at most ${longestMemory} characters.`);
  return text;
}

export const listMemories: OperationHandler = async (event, { table, embedder }, actor) => {
  const human = humanOf(actor);
  if (human === undefined) return othersRefused();
  const { query = "", limit } = event.queryStringParameters ?? {};
  const most = limit === undefined ? memoriesKept : Number(limit);
  if (!Number.isInteger(most) || most < 1 || most > memoriesKept) return refusal(400, `Give limit as a whole number from 1 to ${memoriesKept}.`);
  // Coo is given nothing learned in a mailbox its sponsor access no longer covers.
  const settings = actor!.kind === "agent" ? (await agentSettings(table, actor!.id)).settings : undefined;
  const memories = (await storedMemories(table, human)).filter(({ threads }) => settings === undefined || (threads ?? []).every(({ mailbox }) => sponsorAccessIn(settings, mailbox) !== "none"));
  let ordered = memories.toSorted((a, b) => (a.kept < b.kept ? 1 : -1));
  // Titan's vectors are unit vectors, so their dot product is their cosine. No memory, no embedding.
  if (query.trim() !== "" && memories.length > 0) {
    const [asked] = await embedder.embed([query.trim()]);
    const alike = (memory: StoredMemory) => vectorOf(memory.vector).reduce((sum, value, at) => sum + value * asked![at]!, 0);
    const scores = new Map(memories.map((memory) => [memory, alike(memory)]));
    ordered = memories.toSorted((a, b) => scores.get(b)! - scores.get(a)!);
  }
  return { statusCode: 200, body: { memories: ordered.slice(0, most).map(memoryOf) } satisfies components["schemas"]["MemoryList"] };
};

export const keepMemory: OperationHandler = async (event, { table, embedder }, actor) => {
  const human = humanOf(actor);
  if (human === undefined) return othersRefused();
  const body = jsonBody(event) ?? {};
  const text = textIn(body);
  if (typeof text !== "string") return text;
  const given = body.threads ?? [];
  if (!Array.isArray(given) || !given.every((thread) => typeof thread === "string") || given.length > sourcesKept) {
    return refusal(400, `Give threads as a list of at most ${sourcesKept} thread IDs, those it was learned from, or leave it out for what the human said in their own words.`);
  }
  const ids = [...new Set(given as string[])];
  const coo = actor!.kind === "agent";
  if (ids.length > 0 && !(await learnsFromMail(table, human))) {
    return refusal(409, coo ? "Your sponsor switched your learning from mail off, so keep only what they tell you." : "You switched Coo's learning from mail off. Switch it on in your preferences to keep memories from mail.");
  }
  const [mailboxes, memories, settings] = await Promise.all([ownedMailboxes(table, human), storedMemories(table, human), coo ? agentSettings(table, actor!.id) : undefined]);
  if (memories.length >= memoriesKept) return refusal(409, `Coo keeps at most ${memoriesKept} memories. Forget some first.`);
  const threads: components["schemas"]["MemorySource"][] = [];
  for (const thread of ids) {
    const found = (await Promise.all(mailboxes.map(async ({ id }) => ({ mailbox: id, summary: await threadSummary(table, id, thread) })))).find(({ summary }) => summary !== undefined);
    if (found === undefined) return refusal(404, `There is no thread ${JSON.stringify(thread)} in ${coo ? "your sponsor's" : "your"} mailboxes. Give the IDs of the threads it was learned from.`);
    if (settings !== undefined && sponsorAccessIn(settings.settings, found.mailbox) === "none") return refusal(403, "Your sponsor hasn't given you access to that thread's mailbox, so you can't keep what it says. Keep only what you can read.");
    if (found.summary!.labels.includes(screener) || found.summary!.labels.includes(spam)) return refusal(409, "Coo doesn't learn from mail in the Screener or Spam. Keep nothing from that thread.");
    threads.push({ mailbox: found.mailbox, thread, subject: found.summary!.subject });
  }
  const [vector] = await embedder.embed([text]);
  const memory: StoredMemory = { id: randomUUID(), human, text, kept: new Date().toISOString(), ...(threads.length > 0 && { threads }), vector: bytesOf(vector!) };
  try {
    await documents(table).send(
      new TransactWriteCommand({
        TransactItems: [
          { Put: { TableName: table.name, Item: { ...memoryKey(human, memory.id), ...memory }, ...isNew } },
          ...threads.flatMap(({ mailbox, thread }) => [
            { Put: { TableName: table.name, Item: { ...sourceKey(mailbox, thread, memory.id), human, memory: memory.id, mailbox, thread } } },
            // A thread being erased teaches nothing, and one erased meanwhile has its memories erased after it.
            {
              ConditionCheck: {
                TableName: table.name,
                Key: keys.threadKey(mailbox, thread),
                ConditionExpression: `attribute_exists(${pk}) AND attribute_not_exists(erasing)`,
              },
            },
          ]),
          ...(threads.length > 0 ? [{ Update: { TableName: table.name, Key: noteKey(human), UpdateExpression: "SET fromMail = if_not_exists(fromMail, :now)", ExpressionAttributeValues: { ":now": memory.kept } } }] : []),
        ],
      }),
    );
  } catch (error) {
    // Only a thread's check fails a condition, and conflicting writes are Lambda's to retry.
    if (!(error instanceof TransactionCanceledException) || !error.CancellationReasons?.some(({ Code }) => Code === "ConditionalCheckFailed")) throw error;
    return refusal(404, "That thread was erased meanwhile, so there is nothing to keep from it. Keep it naming only the threads that are left.");
  }
  return { statusCode: 201, body: memoryOf(memory) satisfies Memory };
};

export const correctMemory: OperationHandler = async (event, { table, embedder }, actor) => {
  const human = humanOf(actor);
  if (human === undefined) return othersRefused();
  const id = event.pathParameters?.memory ?? "";
  const text = textIn(jsonBody(event) ?? {});
  if (typeof text !== "string") return text;
  const missing = () => refusal(404, `There is no memory ${JSON.stringify(id)}. List the memories to find its ID.`);
  const [vector] = await embedder.embed([text]);
  try {
    const { Attributes } = await documents(table).send(
      new UpdateCommand({
        TableName: table.name,
        Key: memoryKey(human, id),
        UpdateExpression: "SET #text = :text, corrected = :now, vector = :vector",
        ConditionExpression: `attribute_exists(${pk})`,
        ExpressionAttributeNames: { "#text": "text" },
        ExpressionAttributeValues: { ":text": text, ":now": new Date().toISOString(), ":vector": bytesOf(vector!) },
        ReturnValues: "ALL_NEW",
      }),
    );
    return { statusCode: 200, body: memoryOf(Attributes as StoredMemory) satisfies Memory };
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) return missing();
    throw error;
  }
};

export const forgetMemory: OperationHandler = async (event, { table }, actor) => {
  const human = humanOf(actor);
  if (human === undefined) return othersRefused();
  const id = event.pathParameters?.memory ?? "";
  const memory = await storedMemory(table, human, id);
  if (memory === undefined) return refusal(404, `There is no memory ${JSON.stringify(id)}. List the memories to find its ID.`);
  await forgetAll(table, [memory]);
  return { statusCode: 200, body: memoryOf(memory) satisfies Memory };
};

export const forgetMemories: OperationHandler = async (_event, { table }, actor) => {
  const human = humanOf(actor);
  if (human === undefined) return othersRefused();
  if (actor!.kind === "agent") return refusal(403, "Only your sponsor can forget everything you remember. Forget one memory at a time with forgetMemory.");
  const memories = await storedMemories(table, human);
  await forgetAll(table, memories);
  return { statusCode: 200, body: { forgotten: memories.length } satisfies components["schemas"]["MemoriesForgotten"] };
};
