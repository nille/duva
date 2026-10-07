// Unsubscribing from mail that goes nowhere (ADR-0031, superseding ADR-0016): by RFC 8058 one-click
// first, at once, from the sender's newest mail that SES didn't judge to be spam, and from each
// message dropped later. If one-click doesn't unsubscribe, the mailbox's mailbox agent goes on by
// itself (unsubscribe-runs.ts). How it went is noted on the sender's decision, which their sheet
// shows, until one method works: then later mail is only dropped. Once the agent bounces, it
// bounces each later message. What the message offers is read from its raw copy here, while Duva
// still has it, and handed on.
import type { Table } from "./deployment.ts";
import { recordChanges } from "./feed.ts";
import type { MailBucket } from "./mail-bucket.ts";
import { receivedFrom } from "./mail.ts";
import { mailboxFeed } from "./organization.ts";
import { deliveryFor, noteUnsubscribe, type ScreenedSender, type Sender, screenedSenders } from "./screening.ts";
import type { TaskRunner } from "./tasks.ts";
import { type Offer, offerOf } from "./unsubscribe-offers.ts";
import { bouncing } from "./unsubscribe-runs.ts";
import type { Unsubscribe, Unsubscriber } from "./unsubscriber.ts";

/** How many of the sender's newest messages are read for one SES didn't judge to be spam. */
const messagesRead = 10;

/** What the mailbox agent is handed to go on unsubscribing with: the decision it is for, as read, and what the message offers. */
export interface UnsubscribeJob {
  mailbox: string;
  sender: Sender;
  decidedAt: string;
  offer: Offer;
}

/** Whether a method worked, so later mail is only dropped. */
const worked = (unsubscribe: ScreenedSender["unsubscribe"]) => unsubscribe?.outcome === "unsubscribed" || unsubscribe?.outcome === "requested";

/**
 * Unsubscribes the mailbox from the sender's mail by one-click, if their newest mail that SES
 * didn't judge to be spam offers it, on behalf of the actor `by`, who sent their mail nowhere. For
 * a domain, that is the newest mail from an address on exactly that domain, except those with a
 * delivery of their own, since their own decision beats the domain's. Records the outcome in the
 * mailbox's change feed and on the decision, hands the mailbox agent the rest if it didn't
 * unsubscribe, and returns it.
 */
export async function unsubscribeFrom(
  { table, mailBucket, unsubscriber, tasks }: { table: Table; mailBucket: MailBucket; unsubscriber: Unsubscriber; tasks: TaskRunner },
  { mailbox, sender, decided, by }: { mailbox: string; sender: Sender; decided: ScreenedSender; by: string },
): Promise<Unsubscribe> {
  const from = "address" in sender ? (address: string) => address === sender.address : await onDomain(table, mailbox, sender.domain);
  const newest = await newestOffer(mailBucket, await receivedFrom(table, mailbox, from));
  const outcome = "offer" in newest ? await oneClick(unsubscriber, newest.offer) : newest;
  const job = "offer" in newest ? { mailbox, sender, decidedAt: decided.decidedAt, offer: newest.offer } : undefined;
  await noted(table, { mailbox, sender, decidedAt: decided.decidedAt, outcome, by, change: sender }, job, tasks);
  return outcome;
}

/**
 * Unsubscribes the mailbox from the mail of the address, whose message it dropped, unless a method
 * worked already: by the one-click the raw message offers, naming no actor, as arriving mail names
 * none, and then by the mailbox agent, or, once it bounces, by the agent's bounce alone. Records
 * the outcome. The caller leaves out spam. An unsubscriber that can't be invoked fails it as
 * unreachable, so the drop goes on to erase the message.
 */
export async function unsubscribeDropped(
  { table, unsubscriber, tasks }: { table: Table; unsubscriber: Unsubscriber; tasks: TaskRunner },
  { mailbox, address, raw, message }: { mailbox: string; address: string; raw: Uint8Array; message: { sesMessageId: string; receivedAt: string; recipient: string; envelopeSender: string } },
): Promise<void> {
  const decided = await deliveryFor(table, mailbox, address);
  if (decided === undefined || decided.delivery !== "nowhere" || worked(decided.unsubscribe)) return;
  const sender: Sender = decided.address !== undefined ? { address: decided.address } : { domain: decided.domain! };
  const offer = await offerOf(raw, message);
  const job = offer === undefined ? undefined : { mailbox, sender, decidedAt: decided.decidedAt, offer };
  if (bouncing(decided)) {
    if (job !== undefined) await tasks.unsubscribe(job);
    return;
  }
  const outcome: Unsubscribe = offer === undefined ? { outcome: "notOffered", reason: "spam" } : await oneClick(unsubscriber, offer).catch(() => ({ outcome: "failed", reason: "unreachable" }) as const);
  await noted(table, { mailbox, sender, decidedAt: decided.decidedAt, outcome, by: undefined, change: { address } }, job, tasks);
}

/**
 * Notes the one-click's outcome in the change feed and on the decision, if it is still the
 * nowhere read, and hands the job to the mailbox agent unless it unsubscribed. A decision gone
 * meanwhile only records the change.
 */
async function noted(
  table: Table,
  { mailbox, sender, decidedAt, outcome, by, change }: { mailbox: string; sender: Sender; decidedAt: string; outcome: Unsubscribe; by: string | undefined; change: Record<string, unknown> },
  job: UnsubscribeJob | undefined,
  tasks: TaskRunner,
): Promise<void> {
  const unsubscribe = { method: "oneClick" as const, ...outcome, at: new Date().toISOString(), ...(by !== undefined && { actor: by }) };
  if (!(await noteUnsubscribe(table, { mailbox, sender, decidedAt, unsubscribe, change: { ...change, ...outcome }, by }))) {
    await recordChanges(table, mailboxFeed(mailbox), { by, changes: [{ type: "unsubscribeAttempted", ...change, ...outcome }], items: [] });
    return;
  }
  if (outcome.outcome !== "unsubscribed" && job !== undefined) await tasks.unsubscribe(job);
}

/** Whether an address is on exactly the domain, and the mailbox hasn't decided on it. */
async function onDomain(table: Table, mailbox: string, domain: string): Promise<(address: string) => boolean> {
  const decided = new Set((await screenedSenders(table, mailbox)).flatMap((each) => (each.address !== undefined ? [each.address] : [])));
  return (address) => address.slice(address.lastIndexOf("@") + 1) === domain && !decided.has(address);
}

/** What the newest of the messages that SES didn't judge to be spam offers, or why there is none. */
async function newestOffer(mailBucket: MailBucket, received: { rawKey: string; receivedAt: string; recipient: string }[]): Promise<{ offer: Offer } | Unsubscribe> {
  let sawSpam = false;
  for (const { rawKey, receivedAt, recipient } of received.slice(0, messagesRead)) {
    const raw = await mailBucket.get(rawKey);
    if (raw === undefined) continue;
    const offer = await offerOf(raw, { sesMessageId: rawKey.slice(rawKey.lastIndexOf("/") + 1), receivedAt, recipient });
    if (offer !== undefined) return { offer };
    sawSpam = true;
  }
  return { outcome: "notOffered", reason: sawSpam ? "spam" : "noMail" };
}

/** Unsubscribes by the one-click the message offers, or says why it offers none. */
async function oneClick(unsubscriber: Unsubscriber, { oneClick: offered }: Offer): Promise<Unsubscribe> {
  if (typeof offered === "string") return { outcome: "notOffered", reason: offered };
  return unsubscriber.post(offered.url);
}
