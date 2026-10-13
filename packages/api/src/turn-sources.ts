// What each turn of Ask Coo read (ADR-0036, #172): the threads of its human's mailboxes that its
// run's tool calls took or returned, by their own IDs or their messages', those the memories it was
// given were learned from, and those its text names by ID. Each such thread points at the turn, and
// at the human's turn it answered, in the thread's mailbox, by the thread first, as a memory's
// sources do. Erasing the thread looks the pointers up and erases those turns, in its own
// transaction when they fit there. An erased turn keeps only its ID, when it was and whose, so the
// conversation shows where turns were erased, and no run reads them. A request mailed to Coo goes
// with its turn, its raw message too (ADR-0040).
import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { requestErasure } from "./coo-requests.ts";
import type { Table } from "./deployment.ts";
import { keys } from "./mail.ts";
import { turnKey } from "./mailbox-agents.ts";
import { actorKey, mailboxKey } from "./organization.ts";
import { allItems, documents, itemsAt, pk, sk, type TransactItem } from "./table.ts";

/** A thread a turn read, in its mailbox. */
export interface TurnSource {
  mailbox: string;
  thread: string;
}

/** A turn of the conversation, by when it was and its ID, which are its key. */
interface TurnRef {
  id: string;
  at: string;
}

/** Lists a request's raw message for the eraser to erase. */
export type RawErasure = (rawKey: string) => TransactItem;

const pointersPrefix = "turn-from#";
const pointerPrefix = (thread: string) => `${pointersPrefix}${thread}#`;
const pointerKey = (mailbox: string, thread: string, turn: string) => ({ [pk]: mailboxKey(mailbox)[pk]!, [sk]: `${pointerPrefix(thread)}${turn}` });

/** The threads of the mailboxes that the IDs name, each by its own ID or one of its messages'. */
export async function threadsNamed(table: Table, mailboxes: string[], ids: string[]): Promise<TurnSource[]> {
  const unique = [...new Set(ids)];
  const mailboxOf = new Map(mailboxes.map((mailbox) => [mailboxKey(mailbox)[pk]!, mailbox]));
  const wanted = mailboxes.flatMap((mailbox) => unique.flatMap((id) => [keys.threadKey(mailbox, id), keys.messageRefKey(mailbox, id)]));
  const found = new Map<string, TurnSource>();
  for (const item of await itemsAt(table, wanted, [pk, sk, "thread"])) {
    const mailbox = mailboxOf.get(item[pk] as string)!;
    const thread = keys.threadOf(item[sk] as string) ?? item.thread;
    if (typeof thread === "string") found.set(`${mailbox}#${thread}`, { mailbox, thread });
  }
  return [...found.values()];
}

const conditionFailed = (error: unknown) => error instanceof TransactionCanceledException && (error.CancellationReasons ?? []).some(({ Code }) => Code === "ConditionalCheckFailed");

/**
 * Points each thread the human's turn `answer` read at it, and at their turn `asked` it answered,
 * each with a check that its thread is there and not being erased. False if one was erased
 * meanwhile, whose erasure missed the turns, so the caller erases them.
 */
export async function keepTurnSources(table: Table, { human, asked, answer }: { human: string; asked: TurnRef; answer: TurnRef }, sources: TurnSource[]): Promise<boolean> {
  const turns = [turnKey(human, asked.at, asked.id)[sk]!, turnKey(human, answer.at, answer.id)[sk]!];
  // Two writes a thread, in transactions of at most 100.
  for (let start = 0; start < sources.length; start += 50) {
    const items: TransactItem[] = sources.slice(start, start + 50).flatMap(({ mailbox, thread }) => [
      { Put: { TableName: table.name, Item: { ...pointerKey(mailbox, thread, answer.id), human, turns } } },
      { ConditionCheck: { TableName: table.name, Key: keys.threadKey(mailbox, thread), ConditionExpression: `attribute_exists(${pk}) AND attribute_not_exists(erasing)` } },
    ]);
    try {
      await documents(table).send(new TransactWriteCommand({ TransactItems: items }));
    } catch (error) {
      if (conditionFailed(error)) return false;
      throw error;
    }
  }
  return true;
}

/** The turn as erased, with only its key, its ID, when it was and whose, written only while it is there. */
const erasedTurn = (table: Table, { [pk]: partition, [sk]: key, id, at, from }: Record<string, unknown>): TransactItem => ({
  Put: { TableName: table.name, Item: { [pk]: partition, [sk]: key, id, at, from, erased: true }, ConditionExpression: `attribute_exists(${pk})` },
});

/** Erases the human's turns at once, as when a thread they read was erased while they were written. */
export async function eraseTurns(table: Table, human: string, turns: TurnRef[]): Promise<void> {
  const found = await itemsAt(table, turns.map(({ at, id }) => turnKey(human, at, id)));
  const items = found.filter((turn) => turn.erased !== true).map((turn) => erasedTurn(table, turn));
  try {
    if (items.length > 0) await documents(table).send(new TransactWriteCommand({ TransactItems: items }));
  } catch (error) {
    // Gone meanwhile, as with Start over.
    if (!conditionFailed(error)) throw error;
  }
}

/**
 * The writes that erase what the pointers name, as stored now, a group for each pointer: each turn
 * still there, a request by mail with its turn if `raw` lists its raw message for erasure, and the
 * pointer itself. A turn two pointers name is erased with the first.
 */
async function erasing(table: Table, pointers: Record<string, unknown>[], raw?: RawErasure): Promise<TransactItem[][]> {
  const keyOf = (human: string, turn: string) => ({ [pk]: actorKey(human)[pk]!, [sk]: turn });
  const named = [...new Map(pointers.flatMap(({ human, turns }) => (turns as string[]).map((turn) => [`${human}|${turn}`, keyOf(human as string, turn)]))).values()];
  const found = new Map((await itemsAt(table, named)).map((turn) => [`${turn[pk]}|${turn[sk]}`, turn]));
  const done = new Set<string>();
  return pointers.map((pointer) => {
    const human = pointer.human as string;
    const items: TransactItem[] = [];
    for (const turn of pointer.turns as string[]) {
      const key = `${actorKey(human)[pk]}|${turn}`;
      const stored = found.get(key);
      if (stored === undefined || stored.erased === true || done.has(key)) continue;
      done.add(key);
      items.push(erasedTurn(table, stored));
      if (raw !== undefined && typeof stored.request === "string") items.push(...requestErasure(table, human, stored.request, raw));
    }
    items.push({ Delete: { TableName: table.name, Key: { [pk]: pointer[pk], [sk]: pointer[sk] } } });
    return items;
  });
}

const pointersFrom = (table: Table, mailbox: string, thread: string) =>
  allItems(table, { KeyConditionExpression: `${pk} = :mailbox AND begins_with(${sk}, :thread)`, ExpressionAttributeValues: { ":mailbox": mailboxKey(mailbox)[pk], ":thread": pointerPrefix(thread) } });

/**
 * The writes that erase every turn that read the thread, with the human's turns they answered and
 * the requests by mail among them, for the transaction that erases it, or none if they wouldn't fit
 * in it beside `others` items, which `eraseTurnsFrom` erases next.
 */
export async function turnsErasedWith(table: Table, mailbox: string, thread: string, others: number, raw: RawErasure): Promise<TransactItem[]> {
  const items = (await erasing(table, await pointersFrom(table, mailbox, thread), raw)).flat();
  return others + items.length <= 100 ? items : [];
}

/** Writes the groups in transactions of whole groups, at most 100 items each. */
async function inTransactions(table: Table, groups: TransactItem[][]): Promise<void> {
  let batch: TransactItem[] = [];
  const send = async () => {
    if (batch.length > 0) await documents(table).send(new TransactWriteCommand({ TransactItems: batch }));
    batch = [];
  };
  for (const items of groups) {
    if (batch.length + items.length > 100) await send();
    batch.push(...items);
  }
  await send();
}

/** Erases the turns the pointers `find` gives name, reading them again if one changed meanwhile, as with Start over. */
async function eraseNamed(table: Table, find: () => Promise<Record<string, unknown>[]>, raw?: RawErasure): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await inTransactions(table, await erasing(table, await find(), raw));
    } catch (error) {
      if (!conditionFailed(error) || attempt === 10) throw error;
    }
  }
}

/** Erases every turn that still read the thread, as those too many for its transaction, or written as it was being erased. */
export const eraseTurnsFrom = (table: Table, mailbox: string, thread: string, raw: RawErasure): Promise<void> => eraseNamed(table, () => pointersFrom(table, mailbox, thread), raw);

/**
 * Erases the human's turns that read the mailbox's threads, as the mailbox goes to another human.
 * The requests mailed to their Coo stay for their removal, which erases them all.
 */
export const forgetMailboxTurns = (table: Table, mailbox: string, human: string): Promise<void> =>
  eraseNamed(table, async () =>
    (
      await allItems(table, { KeyConditionExpression: `${pk} = :mailbox AND begins_with(${sk}, :turns)`, ExpressionAttributeValues: { ":mailbox": mailboxKey(mailbox)[pk], ":turns": pointersPrefix } })
    ).filter((pointer) => pointer.human === human),
  );
