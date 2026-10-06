// The Screener: mail from a mailbox's first-time senders waits there until an actor who may
// organize the mailbox lets the sender in or blocks them. Each mailbox has a switch, and a decision per
// screened sender in its own partition. A message is screened in the same transaction that stores
// it, on condition that the switch and the decision on its sender are as read, so a decision or a switch
// made meanwhile is never missed.
import { ConditionalCheckFailedException, TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { GetCommand, PutCommand, QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import type { components } from "@duva/openapi";
import type { Table } from "./deployment.ts";
import { recordChanges } from "./feed.ts";
import { type Arrival, correspondents, hasSentTo, inbox, noteSentTo, receiveMessage, releaseWaiting, screener, type Screening, ScreeningChanged, spam, trash, waitingThreads } from "./mail.ts";
import { allMailboxes, findActor, findMailbox, mailboxFeed, mailboxKey, organizationDomain, screenerKey } from "./organization.ts";
import { documents, pk, sk, type TransactItem } from "./table.ts";

export type Screener = components["schemas"]["Screener"];
export type ScreenedSender = components["schemas"]["ScreenedSender"];
type Decision = ScreenedSender["decision"];

/**
 * Where the switch is: on, off, or turningOn while switching on lets in the mailbox's senders, when
 * mail arrives as with it off and its sender is let in too. Undefined for a mailbox from before
 * the Screener, which is off until setup switches it.
 */
type State = "on" | "off" | "turningOn" | undefined;

// Each screened address has its decision in the mailbox's partition, in lower case.
const senderPrefix = "screened#address#";
const senderKey = (mailbox: string, address: string) => ({ [pk]: mailboxKey(mailbox)[pk]!, [sk]: `${senderPrefix}${address}` });

async function stateOf(table: Table, mailbox: string): Promise<State> {
  const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: screenerKey(mailbox), ConsistentRead: true }));
  return Item?.state as State;
}

async function decisionOn(table: Table, mailbox: string, address: string): Promise<ScreenedSender | undefined> {
  const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: senderKey(mailbox, address), ConsistentRead: true }));
  return Item === undefined ? undefined : senderOf(Item);
}

const senderOf = ({ address, decision, decidedAt, actor }: Record<string, unknown>): ScreenedSender =>
  ({ address, decision, decidedAt, ...(actor !== undefined && { actor }) }) as ScreenedSender;

/** The condition that the item's attribute is as read, or that the item is missing if it was. */
const asRead = (attribute: string, value: string | undefined) =>
  value === undefined
    ? { ConditionExpression: `attribute_not_exists(${pk})` }
    : { ConditionExpression: "#attribute = :value", ExpressionAttributeNames: { "#attribute": attribute }, ExpressionAttributeValues: { ":value": value } };

const unchanged = (table: Table, Key: Record<string, string>, attribute: string, value: string | undefined): TransactItem => ({
  ConditionCheck: { TableName: table.name, Key, ...asRead(attribute, value) },
});

/**
 * Where a message from the address goes if it starts a thread. A block sends it to Trash and a
 * let-in to the Inbox, whether the Screener is on or not. With it on, a first-time sender's waits:
 * one the mailbox hasn't let in or sent to, and not on the organization's domain with a DMARC pass.
 * The domain's policy may let a forged From through, so the From alone doesn't count. While it is
 * turning on, the sender is let in.
 */
async function screeningOf(table: Table, mailbox: string, address: string, dmarcPassed: boolean): Promise<Screening> {
  const [state, decided] = await Promise.all([stateOf(table, mailbox), decisionOn(table, mailbox, address)]);
  const items = [unchanged(table, screenerKey(mailbox), "state", state)];
  if (decided !== undefined) return { label: decided.decision === "block" ? trash : inbox, items: [...items, unchanged(table, senderKey(mailbox, address), "decision", decided.decision)] };
  const undecided = unchanged(table, senderKey(mailbox, address), "decision", undefined);
  if (state === "turningOn") return { label: inbox, items: [...items, letInItem(table, mailbox, address, new Date().toISOString(), undefined)] };
  if (state !== "on") return { label: inbox, items: [...items, undecided] };
  const ownDomain = dmarcPassed && address.slice(address.lastIndexOf("@") + 1) === (await organizationDomain(table)).toLowerCase();
  const firstTime = !ownDomain && !(await hasSentTo(table, mailbox, address));
  return { label: firstTime ? screener : inbox, items: [...items, undecided] };
}

/** The write that lets the address in, unless the mailbox has decided on it already. */
const letInItem = (table: Table, mailbox: string, address: string, at: string, by: string | undefined): TransactItem => ({
  Update: {
    TableName: table.name,
    Key: senderKey(mailbox, address),
    UpdateExpression: `SET address = if_not_exists(address, :address), decision = if_not_exists(decision, :letIn), decidedAt = if_not_exists(decidedAt, :at)${by === undefined ? "" : ", actor = if_not_exists(actor, :by)"}`,
    ExpressionAttributeValues: { ":address": address, ":letIn": "letIn", ":at": at, ...(by !== undefined && { ":by": by }) },
  },
});

/**
 * Receives the message as receiveMessage does, screened by its mailbox's Screener unless it is
 * spam, and screened again if what the Screener decided from changed before it was stored.
 * `dmarcPassed` says whether SES's DMARC verdict on it was PASS.
 */
export async function receiveScreened(table: Table, { dmarcPassed, ...arrival }: Omit<Arrival, "screening"> & { dmarcPassed: boolean }): Promise<boolean> {
  if (arrival.spam) return receiveMessage(table, arrival);
  const address = (arrival.parsed.from?.address ?? arrival.sender).toLowerCase();
  for (let attempt = 1; ; attempt++) {
    try {
      return await receiveMessage(table, { ...arrival, screening: await screeningOf(table, arrival.mailbox, address, dmarcPassed) });
    } catch (error) {
      if (!(error instanceof ScreeningChanged) || attempt === 10) throw error;
    }
  }
}

/** The mailbox's Screener: whether it is on, its waiting senders newest first, and how many addresses it let in and blocked. */
export async function screenerOf(table: Table, mailbox: string): Promise<Screener> {
  const [state, waiting, decided] = await Promise.all([stateOf(table, mailbox), waitingThreads(table, mailbox), decisions(table, mailbox)]);
  const senders = new Map<string, Screener["senders"][number]>();
  for (const thread of waiting.filter(({ labels }) => !labels.includes(spam) && !labels.includes(trash))) {
    const key = thread.from.address.toLowerCase();
    const sender = senders.get(key);
    if (sender === undefined) senders.set(key, { address: thread.from.address, ...(thread.from.name !== undefined && { name: thread.from.name }), latestAt: thread.latestAt, threads: [thread] });
    else sender.threads.push(thread);
  }
  return {
    on: state === "on",
    senders: [...senders.values()],
    letIn: decided.filter(({ decision }) => decision === "letIn").length,
    blocked: decided.filter(({ decision }) => decision === "block").length,
  };
}

async function decisions(table: Table, mailbox: string): Promise<ScreenedSender[]> {
  const decided: ScreenedSender[] = [];
  let start: Record<string, unknown> | undefined;
  do {
    const page = await documents(table).send(
      new QueryCommand({
        TableName: table.name,
        KeyConditionExpression: `${pk} = :mailbox AND begins_with(${sk}, :sender)`,
        ExpressionAttributeValues: { ":mailbox": mailboxKey(mailbox)[pk], ":sender": senderPrefix },
        ConsistentRead: true,
        ExclusiveStartKey: start,
      }),
    );
    decided.push(...(page.Items ?? []).map(senderOf));
    start = page.LastEvaluatedKey;
  } while (start !== undefined);
  return decided;
}

/**
 * Lets the address in, or blocks it, on behalf of the actor `by`, replacing any decision on it,
 * and moves its waiting threads to the Inbox, or to Trash. Records the decision in the mailbox's
 * change feed, and each thread moved. Returns the decision and the threads moved, newest first.
 */
export async function decide(
  table: Table,
  { mailbox, address, decision, by }: { mailbox: string; address: string; decision: Decision; by: string },
): Promise<{ sender: ScreenedSender; threads: components["schemas"]["ThreadSummary"][] }> {
  const sender: ScreenedSender = { address: address.toLowerCase(), decision, decidedAt: new Date().toISOString(), actor: by };
  await recordChanges(table, mailboxFeed(mailbox), {
    by,
    changes: [{ type: "senderScreened", address: sender.address, decision }],
    items: [{ Put: { TableName: table.name, Item: { ...senderKey(mailbox, sender.address), ...sender } } }],
  });
  const theirs = (await waitingThreads(table, mailbox)).filter(({ from }) => from.address.toLowerCase() === sender.address);
  const threads = await releaseWaiting(table, { mailbox, threads: theirs.map(({ id }) => id), to: decision === "letIn" ? inbox : trash, by });
  return { sender, threads };
}

/**
 * Switches the mailbox's Screener on or off, on behalf of the actor `by`. Switching off moves every waiting thread to the Inbox. Switching on lets in every address
 * the mailbox's mail is from, except mail in Spam, and notes every address it sent to, so no
 * sender it already has waits. Each switch that changes it is in the mailbox's change feed.
 */
export async function switchScreener(table: Table, { mailbox, on, by }: { mailbox: string; on: boolean; by: string }): Promise<void> {
  if (on) await switchOn(table, mailbox, by);
  else await switchOff(table, mailbox, by);
}

/** The write that switches the mailbox's Screener, on condition that it is still as read. */
const stateWrite = (table: Table, mailbox: string, state: State, was: State) => ({ TableName: table.name, Item: { ...screenerKey(mailbox), state }, ...asRead("state", was) });

/** Whether the write failed on the item's condition, at the index among the transaction's reasons. */
const failedAt = (error: unknown, index: number) => error instanceof TransactionCanceledException && error.CancellationReasons?.[index]?.Code === "ConditionalCheckFailed";

async function switchOff(table: Table, mailbox: string, by: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    const state = await stateOf(table, mailbox);
    if (state === "off") break;
    try {
      // Only switching off a Screener that was on is a change. One still turning on was never on.
      if (state === "on") {
        await recordChanges(table, mailboxFeed(mailbox), { by, changes: [{ type: "screenerSwitched", on: false }], items: [{ Put: stateWrite(table, mailbox, "off", state) }] });
      } else {
        await documents(table).send(new PutCommand(stateWrite(table, mailbox, "off", state)));
      }
      break;
    } catch (error) {
      // It was switched meanwhile, so it is read again. The item comes after the counter and the change.
      const raced = failedAt(error, 2) || error instanceof ConditionalCheckFailedException;
      if (!raced || attempt === 10) throw error;
    }
  }
  // Each switch off releases what waits, so switching off again finishes one that stopped partway.
  const waiting = await waitingThreads(table, mailbox);
  for (let at = 0; at < waiting.length; at += 100) {
    await releaseWaiting(table, { mailbox, threads: waiting.slice(at, at + 100).map(({ id }) => id), to: inbox, by });
  }
}

async function switchOn(table: Table, mailbox: string, by: string | undefined): Promise<void> {
  const state = await stateOf(table, mailbox);
  if (state === "on") return;
  if (state !== "turningOn") {
    try {
      await documents(table).send(new PutCommand(stateWrite(table, mailbox, "turningOn", state)));
    } catch (error) {
      // It was switched meanwhile, so the switch that got there first stands.
      if (error instanceof ConditionalCheckFailedException) return;
      throw error;
    }
  }
  // From here, mail that arrives lets its sender in too, so no sender is missed while the walk runs.
  const { from, sentTo } = await correspondents(table, mailbox);
  await noteSentTo(table, mailbox, sentTo);
  const at = new Date().toISOString();
  let letIn = 0;
  const addresses = [...from];
  // A few at a time, each batch on condition that the Screener is still turning on, so switching it
  // off meanwhile lets no one else in.
  for (let index = 0; index < addresses.length; index += 25) {
    const batch = addresses.slice(index, index + 25);
    const undecided = (await Promise.all(batch.map((address) => decisionOn(table, mailbox, address)))).filter((decision) => decision === undefined).length;
    try {
      await documents(table).send(
        new TransactWriteCommand({
          TransactItems: [unchanged(table, screenerKey(mailbox), "state", "turningOn"), ...batch.map((address) => letInItem(table, mailbox, address, at, by))],
        }),
      );
    } catch (error) {
      if (failedAt(error, 0)) return;
      throw error;
    }
    letIn += undecided;
  }
  try {
    await recordChanges(table, mailboxFeed(mailbox), { by, changes: [{ type: "screenerSwitched", on: true, letIn }], items: [{ Put: stateWrite(table, mailbox, "on", "turningOn") }] });
  } catch (error) {
    // It was switched off meanwhile, which stands.
    if (!failedAt(error, 2)) throw error;
  }
}

/**
 * Gives each mailbox from before the Screener its switch: on for a human's, letting in its senders
 * as switching on does, and off for an agent's. Finishes switching on any mailbox where that
 * stopped partway. Mailboxes that have a switch keep it as it is.
 */
export async function setUpScreeners(table: Table): Promise<void> {
  for (const mailbox of await allMailboxes(table)) {
    const state = await stateOf(table, mailbox);
    if (state === "turningOn") await switchOn(table, mailbox, undefined);
    if (state !== undefined) continue;
    const owner = await findActor(table, (await findMailbox(table, mailbox))?.owner ?? "");
    if (owner?.kind === "human") {
      await switchOn(table, mailbox, undefined);
      continue;
    }
    await documents(table)
      .send(new PutCommand(stateWrite(table, mailbox, "off", undefined)))
      .catch((error: unknown) => {
        if (!(error instanceof ConditionalCheckFailedException)) throw error;
      });
  }
}
