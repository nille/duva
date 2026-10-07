// The Screener and deliveries: mail from a mailbox's first-time senders waits in the Screener until
// an actor who may organize the mailbox decides where their mail goes, its delivery: the Inbox, the
// Feed, the Paper Trail, a label, or nowhere. Each mailbox has a switch, and a decision per
// screened sender in its own partition. A message is screened in the same transaction that stores
// it, on condition that the switch and the decision on its sender are as read, so a decision or a
// switch made meanwhile is never missed.
import { randomUUID } from "node:crypto";
import { ConditionalCheckFailedException, TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { GetCommand, PutCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { components } from "@duva/openapi";
import type { Table } from "./deployment.ts";
import { domainOf } from "./email-address.ts";
import { recordChanges } from "./feed.ts";
import { type Arrival, correspondents, dropMessage, hasSentTo, inbox, listBySender, moveDelivered, noteSentTo, receiveMessage, screener, type Screening, ScreeningChanged, spam, threadsFrom, type ThreadSummary, trash, waitingThreads } from "./mail.ts";
import { allDomains, allMailboxes, mailboxFeed, mailboxKey, screenerKey } from "./organization.ts";
import { documents, pk, sk, type TransactItem } from "./table.ts";

export type Screener = components["schemas"]["Screener"];
export type ScreenedSender = components["schemas"]["ScreenedSender"];
export type SenderSheet = components["schemas"]["SenderSheet"];
export type Delivery = components["schemas"]["Delivery"];
/** What a mailbox decides on: an address, or a domain for everyone at exactly that domain. In lower case. */
export type Sender = { address: string } | { domain: string };

/**
 * Where the switch is: on, off, or turningOn while switching on sends the mailbox's senders' mail
 * to the Inbox, when mail arrives as with it off and its sender is decided on too. Undefined for a
 * mailbox from before the Screener, which is off until setup switches it.
 */
type State = "on" | "off" | "turningOn" | undefined;

// Each screened address and domain has its decision in the mailbox's partition, in lower case.
const senderPrefix = "screened#";
const keyOf = (sender: Sender) => ("address" in sender ? `address#${sender.address}` : `domain#${sender.domain}`);
const senderKey = (mailbox: string, sender: Sender) => ({ [pk]: mailboxKey(mailbox)[pk]!, [sk]: `${senderPrefix}${keyOf(sender)}` });

async function stateOf(table: Table, mailbox: string): Promise<State> {
  const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: screenerKey(mailbox), ConsistentRead: true }));
  return Item?.state as State;
}

/** The decision on exactly the address or the domain, if the mailbox has one. */
export async function decisionOn(table: Table, mailbox: string, sender: Sender): Promise<ScreenedSender | undefined> {
  const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: senderKey(mailbox, sender), ConsistentRead: true }));
  return Item === undefined ? undefined : senderOf(Item);
}

/** The decision as stored. One from before deliveries let in or blocked, which became the Inbox and nowhere. */
const senderOf = ({ address, domain, delivery, label, decision, decidedAt, actor, unsubscribe }: Record<string, unknown>): ScreenedSender =>
  ({
    ...(address !== undefined && { address }),
    ...(domain !== undefined && { domain }),
    delivery: delivery ?? (decision === "block" ? "nowhere" : inbox),
    ...(label !== undefined && { label }),
    decidedAt,
    ...(actor !== undefined && { actor }),
    ...(unsubscribe !== undefined && { unsubscribe }),
  }) as ScreenedSender;

/**
 * Notes how unsubscribing from the sender went on their decision, with the change, recorded under
 * the actor `by`, on condition that it is still the nowhere decided at `decidedAt`. Returns false if
 * it no longer is, as when the sender was set back to the Inbox meanwhile.
 */
export async function noteUnsubscribe(
  table: Table,
  { mailbox, sender, decidedAt, unsubscribe, change, by }: { mailbox: string; sender: Sender; decidedAt: string; unsubscribe: NonNullable<ScreenedSender["unsubscribe"]>; change: Record<string, unknown>; by: string | undefined },
): Promise<boolean> {
  try {
    await recordChanges(table, mailboxFeed(mailbox), {
      by,
      changes: [{ type: "unsubscribeAttempted", ...change }],
      items: [
        {
          Update: {
            TableName: table.name,
            Key: senderKey(mailbox, sender),
            UpdateExpression: "SET unsubscribe = :unsubscribe",
            ConditionExpression: "decidedAt = :decidedAt AND (delivery = :nowhere OR decision = :block)",
            ExpressionAttributeValues: { ":unsubscribe": unsubscribe, ":decidedAt": decidedAt, ":nowhere": "nowhere", ":block": "block" },
          },
        },
      ],
    });
    return true;
  } catch (error) {
    if (failedAt(error, 2)) return false;
    throw error;
  }
}

/**
 * Leases unsubscribing from the sender to one run of the mailbox agent until the time, if it is
 * still the nowhere decided at `decidedAt` and no other run holds an unexpired lease, so two
 * messages dropped close together never have it mail the unsubscribe address twice. Returns a
 * function that ends the lease, or undefined if it isn't taken.
 */
export async function leaseUnsubscribing(table: Table, { mailbox, sender, decidedAt }: { mailbox: string; sender: Sender; decidedAt: string }, until: Date): Promise<(() => Promise<void>) | undefined> {
  const lease = randomUUID();
  try {
    await documents(table).send(
      new UpdateCommand({
        TableName: table.name,
        Key: senderKey(mailbox, sender),
        UpdateExpression: "SET unsubscribeLease = :lease",
        ConditionExpression: "decidedAt = :decidedAt AND (attribute_not_exists(unsubscribeLease) OR unsubscribeLease.#until < :now)",
        ExpressionAttributeNames: { "#until": "until" },
        ExpressionAttributeValues: { ":lease": { id: lease, until: until.toISOString() }, ":decidedAt": decidedAt, ":now": new Date().toISOString() },
      }),
    );
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) return undefined;
    throw error;
  }
  return async () => {
    await documents(table)
      .send(
        new UpdateCommand({
          TableName: table.name,
          Key: senderKey(mailbox, sender),
          UpdateExpression: "REMOVE unsubscribeLease",
          ConditionExpression: "unsubscribeLease.id = :lease",
          ExpressionAttributeValues: { ":lease": lease },
        }),
      )
      .catch((error: unknown) => {
        // The decision was made again meanwhile, without the lease.
        if (!(error instanceof ConditionalCheckFailedException)) throw error;
      });
  };
}

/** The label the delivery files mail under, or undefined for nowhere. Mail from a sender without one goes to the Inbox. */
const placeOf = (decided: ScreenedSender | undefined): string | undefined =>
  decided === undefined ? inbox : decided.delivery === "label" ? decided.label : decided.delivery === "nowhere" ? undefined : decided.delivery;

/** The condition that the item's attribute is as read, or that the item is missing if it was. */
const asRead = (attribute: string, value: string | undefined) =>
  value === undefined
    ? { ConditionExpression: `attribute_not_exists(${pk})` }
    : { ConditionExpression: "#attribute = :value", ExpressionAttributeNames: { "#attribute": attribute }, ExpressionAttributeValues: { ":value": value } };

const unchanged = (table: Table, Key: Record<string, string>, attribute: string, value: string | undefined): TransactItem => ({
  ConditionCheck: { TableName: table.name, Key, ...asRead(attribute, value) },
});

/** Where a message goes as its sender's decision says, or that it is dropped, for nowhere. */
type Verdict = Screening | { drop: true; items: TransactItem[] };

/** Where the decision sends mail, wherever it starts or joins a thread. */
function delivered(decided: ScreenedSender, items: TransactItem[]): Verdict {
  const place = placeOf(decided);
  if (place === undefined) return { drop: true, items };
  return { label: place, joined: place, ...(place !== inbox && { delivered: decided.delivery }), items };
}

/**
 * Where a message from the address goes. Its delivery decides, whether the Screener is on or not,
 * and the address's decision beats its domain's. Without one, a thread it starts goes to the
 * Inbox, unless the Screener is on and the sender is first-time: one the mailbox hasn't decided on
 * or sent to, and not on the organization's domain with a DMARC pass. The domain's policy may let a
 * forged From through, so the From alone doesn't count. While it is turning on, the sender gets the Inbox.
 */
async function screeningOf(table: Table, mailbox: string, address: string, dmarcPassed: boolean): Promise<Verdict> {
  const domain = domainOf(address);
  const [state, byAddress, byDomain] = await Promise.all([stateOf(table, mailbox), decisionOn(table, mailbox, { address }), decisionOn(table, mailbox, { domain })]);
  const items = [unchanged(table, screenerKey(mailbox), "state", state)];
  // A decision is made again with a new time, so its time tells whether it changed.
  if (byAddress !== undefined) return delivered(byAddress, [...items, unchanged(table, senderKey(mailbox, { address }), "decidedAt", byAddress.decidedAt)]);
  items.push(unchanged(table, senderKey(mailbox, { domain }), "decidedAt", byDomain?.decidedAt));
  const toInbox = { label: inbox, joined: inbox };
  if (state === "turningOn" && byDomain === undefined) return { ...toInbox, items: [...items, inboxItem(table, mailbox, address, new Date().toISOString(), undefined)] };
  items.push(unchanged(table, senderKey(mailbox, { address }), "decidedAt", undefined));
  if (byDomain !== undefined) return delivered(byDomain, items);
  if (state !== "on" || !(await firstTime(table, mailbox, address, dmarcPassed))) return { ...toInbox, items };
  return { label: screener, joined: inbox, screened: "waiting", items };
}

/** Whether the address is a first-time sender's for the mailbox, as far as the mail it has sent and the organization's domains tell. */
async function firstTime(table: Table, mailbox: string, address: string, dmarcPassed: boolean): Promise<boolean> {
  const ownDomain = dmarcPassed && (await allDomains(table)).some((each) => each.domain === domainOf(address).toLowerCase());
  return !ownDomain && !(await hasSentTo(table, mailbox, address));
}

/** The write that sends the address's mail to the Inbox, unless the mailbox has decided on it already. */
const inboxItem = (table: Table, mailbox: string, address: string, at: string, by: string | undefined): TransactItem => ({
  Update: {
    TableName: table.name,
    Key: senderKey(mailbox, { address }),
    UpdateExpression: `SET address = if_not_exists(address, :address), delivery = if_not_exists(delivery, :inbox), decidedAt = if_not_exists(decidedAt, :at)${by === undefined ? "" : ", actor = if_not_exists(actor, :by)"}`,
    ExpressionAttributeValues: { ":address": address, ":inbox": inbox, ":at": at, ...(by !== undefined && { ":by": by }) },
  },
});

/**
 * Receives the message as receiveMessage does, screened by its mailbox's Screener unless it is a
 * group member's copy, since the group's send policy is its gate (ADR-0019), and screened again if
 * what the Screener decided from changed before it was stored. Spam goes to Spam, unless its
 * sender's mail goes nowhere. `dmarcPassed` says whether SES's DMARC verdict on it was PASS.
 * Says whether the mailbox stored it, dropped it, or had done either already.
 */
export async function receiveScreened(table: Table, { dmarcPassed, ...arrival }: Omit<Arrival, "screening"> & { dmarcPassed: boolean }): Promise<"stored" | "dropped" | "had"> {
  if (arrival.group !== undefined) return (await receiveMessage(table, arrival)) ? "stored" : "had";
  const address = (arrival.parsed.from?.address ?? arrival.sender).toLowerCase();
  for (let attempt = 1; ; attempt++) {
    try {
      const verdict = await screeningOf(table, arrival.mailbox, address, dmarcPassed);
      if ("drop" in verdict) return (await dropMessage(table, { mailbox: arrival.mailbox, sesMessageId: arrival.sesMessageId, address, checks: verdict.items })) ? "dropped" : "had";
      return (await receiveMessage(table, { ...arrival, screening: verdict })) ? "stored" : "had";
    } catch (error) {
      if (!(error instanceof ScreeningChanged) || attempt === 10) throw error;
    }
  }
}

/** The mailbox's Screener: whether it is on, its waiting senders newest first, and how many addresses and domains it decided on. */
export async function screenerOf(table: Table, mailbox: string): Promise<Screener> {
  const [state, waiting, decisions] = await Promise.all([stateOf(table, mailbox), waitingThreads(table, mailbox), decisionsOf(table, mailbox)]);
  const senders = new Map<string, Screener["senders"][number]>();
  for (const thread of waiting.filter(({ labels }) => !labels.includes(spam) && !labels.includes(trash))) {
    const key = thread.from.address.toLowerCase();
    const sender = senders.get(key);
    if (sender === undefined) senders.set(key, { address: thread.from.address, ...(thread.from.name !== undefined && { name: thread.from.name }), latestAt: thread.latestAt, threads: [thread] });
    else sender.threads.push(thread);
  }
  return { on: state === "on", senders: [...senders.values()], decided: decisions.size };
}

/** The addresses and domains the mailbox decided on, newest decision first. */
export async function screenedSenders(table: Table, mailbox: string): Promise<ScreenedSender[]> {
  return [...(await decisionsOf(table, mailbox)).values()].sort((a, b) => b.decidedAt.localeCompare(a.decidedAt));
}

/**
 * The sender's sheet in the mailbox: how many threads it has from them, their name as their newest
 * gives it, and where their new mail goes now, with the decision that sends it there. Undecided, an
 * address waits if it is first-time and the Screener is on, and a domain's first-time senders do.
 */
export async function senderSheet(table: Table, mailbox: string, sender: Sender): Promise<SenderSheet> {
  const [threads, decisions, state] = await Promise.all([threadsFrom(table, mailbox, sender), decisionsOf(table, mailbox), stateOf(table, mailbox)]);
  const decided = "address" in sender ? decisionFor(decisions, sender.address) : decisions.get(keyOf(sender));
  const name = "address" in sender ? threads.find(({ from }) => from.address.toLowerCase() === sender.address)?.from.name : undefined;
  const waits = state === "on" && ("domain" in sender || (await firstTime(table, mailbox, sender.address, true)));
  return {
    ...sender,
    ...(name !== undefined && { name }),
    threads: threads.length,
    ...(decided === undefined ? { goesTo: waits ? "screener" : "inbox" } : { goesTo: decided.delivery, ...(decided.label !== undefined && { label: decided.label }), decided }),
  };
}

/** The mailbox's decisions, each by the address or domain it is on. */
type Decisions = Map<string, ScreenedSender>;

/** The decision that covers the address: its own, or else its domain's. */
const decisionFor = (decisions: Decisions, address: string) => decisions.get(keyOf({ address })) ?? decisions.get(keyOf({ domain: domainOf(address) }));

/** The decision that covers the address in the mailbox, its own or else its domain's, if it has one. */
export async function deliveryFor(table: Table, mailbox: string, address: string): Promise<ScreenedSender | undefined> {
  return (await decisionOn(table, mailbox, { address })) ?? (await decisionOn(table, mailbox, { domain: domainOf(address) }));
}

/** The mailbox's decisions as stored, by the address or domain each is on. */
async function storedDecisions(table: Table, mailbox: string): Promise<Map<string, Record<string, unknown>>> {
  const decisions = new Map<string, Record<string, unknown>>();
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
    for (const item of page.Items ?? []) decisions.set((item[sk] as string).slice(senderPrefix.length), item);
    start = page.LastEvaluatedKey;
  } while (start !== undefined);
  return decisions;
}

async function decisionsOf(table: Table, mailbox: string): Promise<Decisions> {
  return new Map([...(await storedDecisions(table, mailbox))].map(([key, item]) => [key, senderOf(item)]));
}

/**
 * Decides where the address's or domain's mail goes, on behalf of the actor `by`, replacing any
 * decision on it, and moves the threads it covers as moveCovered() does. `label` is the label a
 * label delivery files under. Records the decision in the mailbox's change feed, with `also` in the
 * same transaction, and each thread moved. Returns the decision, the threads moved, newest first,
 * and for nowhere how many threads are left to erase.
 */
export async function decide(
  table: Table,
  { mailbox, sender, delivery, label, by, also = [] }: { mailbox: string; sender: Sender; delivery: Delivery; label?: string; by: string; also?: TransactItem[] },
): Promise<{ sender: ScreenedSender; threads: ThreadSummary[]; erasing?: number }> {
  for (let attempt = 1; ; attempt++) {
    const before = await decisionsOf(table, mailbox);
    const decided: ScreenedSender = { ...sender, delivery, ...(label !== undefined && { label }), decidedAt: new Date().toISOString(), actor: by };
    try {
      await recordChanges(table, mailboxFeed(mailbox), {
        by,
        changes: [{ type: "senderDeliverySet", ...sender, delivery, ...(label !== undefined && { label }) }],
        items: [{ Put: { TableName: table.name, Item: { ...senderKey(mailbox, sender), ...decided }, ...asRead("decidedAt", before.get(keyOf(sender))?.decidedAt) } }, ...also],
      });
    } catch (error) {
      // It was decided or removed meanwhile, so the threads to move are worked out again.
      if (!failedAt(error, 2) || attempt === 10) throw error;
      continue;
    }
    const after = new Map(before).set(keyOf(sender), decided);
    const { threads, erasing } = await moveCovered(table, { mailbox, sender, before, after, by });
    return { sender: decided, threads, ...(delivery === "nowhere" && { erasing }) };
  }
}

/**
 * Removes the mailbox's decision on the address or domain, on behalf of the actor `by`, so the
 * senders it covered are first-time again, and moves the threads it covered as moveCovered() does.
 * Records the removal in the mailbox's change feed, and each thread moved. Returns the decision
 * removed and the threads moved, newest first, or undefined if the mailbox has none on it.
 */
export async function removeDecision(
  table: Table,
  { mailbox, sender, by }: { mailbox: string; sender: Sender; by: string },
): Promise<{ sender: ScreenedSender; threads: ThreadSummary[] } | undefined> {
  for (let attempt = 1; ; attempt++) {
    const before = await decisionsOf(table, mailbox);
    const removed = before.get(keyOf(sender));
    if (removed === undefined) return undefined;
    try {
      await recordChanges(table, mailboxFeed(mailbox), {
        by,
        changes: [{ type: "senderDeliveryRemoved", ...sender, delivery: removed.delivery, ...(removed.label !== undefined && { label: removed.label }) }],
        items: [{ Delete: { TableName: table.name, Key: senderKey(mailbox, sender), ...asRead("decidedAt", removed.decidedAt) } }],
      });
    } catch (error) {
      // It was decided again or removed meanwhile, so it is read again.
      if (!failedAt(error, 2) || attempt === 10) throw error;
      continue;
    }
    const after = new Map(before);
    after.delete(keyOf(sender));
    return { sender: removed, threads: (await moveCovered(table, { mailbox, sender, before, after, by })).threads };
  }
}

/**
 * Has every sender whose mail the mailbox files under the label send it to the Inbox instead, on
 * behalf of the actor `by`, as when the label is deleted.
 */
export async function forgetLabel(table: Table, { mailbox, label, by }: { mailbox: string; label: string; by: string }): Promise<void> {
  for (const decided of (await decisionsOf(table, mailbox)).values()) {
    if (decided.delivery !== "label" || decided.label !== label) continue;
    await decide(table, { mailbox, sender: decided.address !== undefined ? { address: decided.address } : { domain: decided.domain! }, delivery: inbox, by });
  }
}

/**
 * Moves the threads from senders the address or domain covers as their decision changed from
 * `before` to `after`: from where their mail went, or the Screener, to where it goes now, as
 * moveDelivered() does. Threads whose mail goes nowhere now are left for the eraser, and counted.
 * Returns the threads moved, newest first.
 */
async function moveCovered(
  table: Table,
  { mailbox, sender, before, after, by }: { mailbox: string; sender: Sender; before: Decisions; after: Decisions; by: string },
): Promise<{ threads: ThreadSummary[]; erasing: number }> {
  const moves = new Map<string, { from: string | undefined; to: string; threads: string[] }>();
  let erasing = 0;
  for (const thread of await threadsFrom(table, mailbox, sender)) {
    const address = thread.from.address.toLowerCase();
    const [from, to] = [placeOf(decisionFor(before, address)), placeOf(decisionFor(after, address))];
    if (to === undefined) {
      erasing++;
      continue;
    }
    if (from === to && !thread.labels.includes(screener)) continue;
    const key = `${from}>${to}`;
    const move = moves.get(key) ?? { from, to, threads: [] };
    moves.set(key, move);
    move.threads.push(thread.id);
  }
  const moved = [];
  for (const { from, to, threads } of moves.values()) moved.push(...(await moveDelivered(table, { mailbox, threads, from, to, by })));
  return { threads: moved.sort((a, b) => b.latestAt.localeCompare(a.latestAt)), erasing };
}

/**
 * Switches the mailbox's Screener on or off, on behalf of the actor `by`. Switching off moves every
 * waiting thread to the Inbox. Switching on sends the mail of every address the mailbox's mail is
 * from to the Inbox, except mail in Spam and addresses at a domain it decided on, and notes every
 * address it sent to, so no sender it already has waits. Each switch that changes it is in the
 * mailbox's change feed.
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
    await moveDelivered(table, { mailbox, threads: waiting.slice(at, at + 100).map(({ id }) => id), from: undefined, to: inbox, by });
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
  // A sender at a domain decided on keeps its delivery, which deciding on their address would undo.
  const decisions = await decisionsOf(table, mailbox);
  const addresses = [...from].filter((address) => !decisions.has(keyOf({ domain: domainOf(address) })));
  // A few at a time, each batch on condition that the Screener is still turning on, so switching it
  // off meanwhile lets no one else in.
  for (let index = 0; index < addresses.length; index += 25) {
    const batch = addresses.slice(index, index + 25);
    const undecided = (await Promise.all(batch.map((address) => decisionOn(table, mailbox, { address })))).filter((decision) => decision === undefined).length;
    try {
      await documents(table).send(
        new TransactWriteCommand({
          TransactItems: [unchanged(table, screenerKey(mailbox), "state", "turningOn"), ...batch.map((address) => inboxItem(table, mailbox, address, at, by))],
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
 * Gives each mailbox from before the Screener its switch, on, letting in its senders as switching
 * on does. Finishes switching on any mailbox where that stopped partway. Mailboxes that have a
 * switch keep it as it is.
 */
export async function setUpScreeners(table: Table): Promise<void> {
  for (const mailbox of await allMailboxes(table)) {
    const state = await stateOf(table, mailbox);
    if (state === "turningOn" || state === undefined) await switchOn(table, mailbox, undefined);
  }
}

// Each mailbox whose threads are all listed by whom they are from is marked, so setup lists them once.
const sendersListedKey = (mailbox: string) => ({ [pk]: mailboxKey(mailbox)[pk]!, [sk]: "senders-listed" });

/**
 * Gives each mailbox from before deliveries its decisions as deliveries, a let-in the Inbox and a
 * block nowhere, and lists each of its threads by the address and the domain it is from. A thread
 * changed meanwhile was listed by that change. Run again, it finishes what an earlier run left.
 */
export async function setUpDeliveries(table: Table): Promise<void> {
  const db = documents(table);
  for (const mailbox of await allMailboxes(table)) {
    for (const [key, item] of await storedDecisions(table, mailbox)) {
      if (item.delivery !== undefined) continue;
      await db
        .send(
          new UpdateCommand({
            TableName: table.name,
            Key: { [pk]: mailboxKey(mailbox)[pk]!, [sk]: `${senderPrefix}${key}` },
            UpdateExpression: "SET delivery = :delivery REMOVE decision",
            ConditionExpression: "decidedAt = :decidedAt AND attribute_not_exists(delivery)",
            ExpressionAttributeValues: { ":delivery": senderOf(item).delivery, ":decidedAt": item.decidedAt },
          }),
        )
        .catch((error: unknown) => {
          // It was decided again meanwhile, as a delivery.
          if (!(error instanceof ConditionalCheckFailedException)) throw error;
        });
    }
    const { Item: listed } = await db.send(new GetCommand({ TableName: table.name, Key: sendersListedKey(mailbox), ConsistentRead: true }));
    if (listed !== undefined) continue;
    await listBySender(table, mailbox);
    await db.send(new PutCommand({ TableName: table.name, Item: sendersListedKey(mailbox) }));
  }
}
