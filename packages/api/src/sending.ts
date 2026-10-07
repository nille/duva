// The sender, which the table's stream invokes for each approved draft: one a decision approved,
// or one asked to send without approval, as a human's from their own mailbox is. It sends an agent's draft through SES
// with the disclosure, and a human's without, and records the outcome. Sending starts
// from the recorded approval, so a crash between it and the send can't lose it, and each step is
// conditional on the last, so a retried record never sends twice. An approved send waits out the
// organization's undo window first, and the sender asks to be handed it again once it is over. A paused agent's sends stay
// approved, held, until unpausing writes them again and the stream hands them over once more. A
// draft sent as a group is copied to each other local member's mailbox once it is sent
// (ADR-0019), also when a retried record finds it sent already. An
// agent's send over its send limits, or behind its others that wait, waits for them, and the
// sender sends what waits, oldest first, when it is handed the agent, at a time it scheduled or
// once the API changed what holds them. An agent's send that fails, and its limits reached, are
// alerts to its sponsor. The sender also mails each urgent alert to its sponsor, from Duva, and
// records that it did, so the inbound handler knows the mail for Duva's own when it arrives. And
// when a thread set aside in Remind me is due, EventBridge Scheduler hands it to the sender, which
// brings it back.
import { randomUUID } from "node:crypto";
import { SendEmailCommand, SESv2ServiceException, type SESv2Client } from "@aws-sdk/client-sesv2";
import type { DynamoDBStreamEvent } from "aws-lambda";
import { GetCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import type { Table } from "./deployment.ts";
import { approvedAt, type Draft, draftAt, undoable, draftToSend, findApproval, keepSent, markFailed, markSent, markUnclear, type Sending, sesMessagePartition, startSending, unsendableFrom, waitForLimit } from "./drafting.ts";
import { alertAt, alertItems, limitRead, mailingSettled, raiseAlert, startMailing } from "./alerting.ts";
import {
  allowedAt,
  counting,
  type Limits,
  limitsOf,
  newRecipients,
  readWindow,
  type ReleaseEvent,
  type Schedules,
  type SendEvent,
  type WaitingSend,
  stopWaiting,
  waitingSends,
  type Window,
  windowUnchanged,
} from "./limits.ts";
import { documents, pk, sk, type TransactItem } from "./table.ts";
import { sentPrefix, systemAddress, timeToLiveAttribute } from "./infrastructure.ts";
import type { MailBucket } from "./mail-bucket.ts";
import { copyToOtherMembers, fromStanding } from "./group-mail.ts";
import { bringBack, findMessage } from "./mail.ts";
import type { RemindEvent } from "./reminders.ts";
import { buildMail, disclosureHeader } from "./mime.ts";
import { sponsorAccessAllows, sponsorAccessIn } from "./access.ts";
import { type Actor, type Agent, agentSettings, agentUnpaused, findActor, findMailbox, organizationDomain, switchesFor } from "./organization.ts";

/** Who SES delivers a message to. Bcc recipients are here only, since no header names them. */
export interface Destination {
  to: string[];
  cc: string[];
  bcc: string[];
}

/** SES's sending, or a stand-in in tests. */
export interface Outbound {
  /**
   * Hands SES the raw message for the destination's recipients and returns the ID SES gave it.
   * Throws Refused with SES's reason if SES refused it. Any other error leaves it unclear whether
   * SES accepted it.
   */
  send(raw: Uint8Array, destination: Destination): Promise<string>;
}

/** How many recipients SES sends one message to, in To, Cc and Bcc together (docs/aws.md). */
const maxRecipients = 50;

/** SES refused the message, so it wasn't sent. */
export class Refused extends Error {}

/**
 * SES's v2 SendEmail with raw MIME, under Duva's configuration set, which tracks no opens or
 * clicks. The client must make one attempt per call, since the SDK would retry a call whose answer
 * was lost after SES accepted it. Only throttling, where SES refused the call, is tried again here.
 */
export function sesOutbound(ses: SESv2Client, configurationSet: string): Outbound {
  return {
    async send(raw, { to, cc, bcc }) {
      for (let attempt = 1; ; attempt++) {
        try {
          const { MessageId } = await ses.send(
            new SendEmailCommand({
              Content: { Raw: { Data: raw } },
              // SES delivers to the destination's recipients, so Bcc recipients need no header.
              Destination: { ToAddresses: to, ...(cc.length > 0 && { CcAddresses: cc }), ...(bcc.length > 0 && { BccAddresses: bcc }) },
              ConfigurationSetName: configurationSet,
            }),
          );
          if (MessageId === undefined) throw new Error("SES accepted the message without giving it an ID.");
          return MessageId;
        } catch (error) {
          if (!(error instanceof SESv2ServiceException) || error.$fault !== "client") throw error;
          if (error.name !== "TooManyRequestsException" || attempt === 3) throw new Refused(error.message);
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
        }
      }
    },
  };
}

/** What the sender sends with. */
interface Sender {
  table: Table;
  mailBucket: MailBucket;
  outbound: Outbound;
  /** The region SES sends from, which names the Message-ID it gives each message. */
  region: string;
  /** Where the sender asks to be handed an agent again, once its limits allow what waits. */
  schedules: Schedules;
}

export function createSender(sender: Sender) {
  return async (event: DynamoDBStreamEvent | ReleaseEvent | RemindEvent | SendEvent): Promise<void> => {
    if ("release" in event) {
      await release(sender, event.release);
      return;
    }
    // A thread set aside in Remind me is due back.
    if ("remind" in event) {
      await bringBack(sender.table, event.remind);
      return;
    }
    if ("send" in event) {
      await send(sender, event.send);
      return;
    }
    for (const record of event.Records) {
      const keys = Object.fromEntries(Object.entries(record.dynamodb?.Keys ?? {}).map(([name, value]) => [name, value.S ?? ""]));
      const at = draftAt(keys);
      if (at !== undefined) await send(sender, at);
      const alert = alertAt(keys);
      if (alert !== undefined) await mailAlert(sender, alert);
    }
  };
}

/**
 * Sends the agent's sends that wait for its limits, the first approved first, as far as the limits
 * allow now, and schedules the next run for when they allow the next. A send with more new
 * recipients than the whole daily limit waits for its sponsor, so the others pass it. Nothing goes
 * while the agent is paused, and its unpausing hands it to the sender again.
 */
async function release(sender: Sender, agent: string): Promise<void> {
  for (const waiting of await waitingSends(sender.table, agent)) {
    const outcome = await send(sender, waiting, { agent, ...waiting });
    if (outcome === "waits" || outcome === "held") return;
  }
}

/**
 * How a send ended: done, whatever came of it, or waiting for the agent's limits, or held while
 * it is paused. A send that waits for its sponsor has more new recipients than the whole daily limit.
 */
type Outcome = "done" | "waits" | "waitsForSponsor" | "held";

/**
 * Sends the draft if it is approved, or, given where it waits, if it waits for its agent's limits
 * and they allow it. One left sending by an earlier run that stopped is marked unclear, never sent
 * again. A write that found another between its read and itself, such as another of the agent's
 * sends counted, is tried again from the read.
 */
async function send(sender: Sender, at: { mailbox: string; draft: string }, waiting?: Waiting): Promise<Outcome> {
  for (let attempt = 1; ; attempt++) {
    const outcome = await sendOnce(sender, at, waiting, attempt > 1);
    if (outcome !== "again") return outcome;
    if (attempt === 10) throw new Error(`Sending draft ${at.draft} found another write in its way 10 times.`);
  }
}

/** One of the agent's sends that wait for its limits. */
type Waiting = WaitingSend & { agent: string };

/** One try at sending the draft. `again` says an earlier try found another write in its way. */
async function sendOnce(
  { table, mailBucket, outbound, region, schedules }: Sender,
  { mailbox, draft: id }: { mailbox: string; draft: string },
  waiting: Waiting | undefined,
  again: boolean,
): Promise<Outcome | "again"> {
  const draft = await draftToSend(table, mailbox, id);
  const status = draft?.send;
  const expected = waiting === undefined ? "approved" : "waitingForLimit";
  if (draft === undefined || status === undefined || (waiting !== undefined && status.state !== expected)) {
    // Sent now, or deleted with its mailbox, it no longer waits.
    if (waiting !== undefined) await documents(table).send(new TransactWriteCommand({ TransactItems: [stopWaiting(table, waiting.agent, waiting)] }));
    return "done";
  }
  const approval = status.approval === undefined ? undefined : await findApproval(table, status.approval);
  if (status.approval !== undefined && approval === undefined) throw new Error(`The approval ${status.approval} that draft ${id} was sent with is missing.`);
  const by = approval?.agent ?? status.by;
  if (by === undefined) throw new Error(`Draft ${id} was asked to send without an approval or a human who sent it.`);
  if (status.state === "sent") {
    if (approval !== undefined) await keepSent(table, approval.id, { thread: status.thread!, message: status.message! });
    await copyToOtherMembers({ table, mailBucket }, mailbox, status.message!);
    return "done";
  }
  if (status.state === "sending") {
    // Found again, it is another run's, which got in this one's way and is sending it now.
    if (!again) await markUnclear(table, { mailbox, draft: id, approval: approval?.id, message: status.message!, by }, unclearAlert(table, await findActor(table, by), mailbox, draft));
    return "done";
  }
  // A run that had it wait, then stopped before sending what waits, left the agent's queue to this one.
  if (waiting === undefined && status.state === "waitingForLimit") {
    await release({ table, mailBucket, outbound, region, schedules }, by);
    return "done";
  }
  if (status.state !== expected) return "done";
  // An approved send waits out its undo window, while its approver can undo it, and is handed over again then.
  if (waiting === undefined && undoable(status)) {
    await schedules.sendAt({ mailbox, draft: id }, new Date(status.undoUntil));
    return "done";
  }

  const actor = await findActor(table, by);
  if (actor === undefined) throw new Error(`The actor ${by} that draft ${id} is sent for is missing.`);
  // A paused agent's sends are held, approved, until unpausing releases them.
  if (actor.kind === "agent" && actor.paused !== undefined) return "held";
  // An agent's mail carries the disclosure header, naming the agent and the human it acts for, and
  // the visible line unless its sponsor switched it off for where it sends from. A human's carries
  // neither. An agent sends as its sponsor from the sponsor's mailbox, under the sponsor's name.
  let disclosure: { naming: string; line: boolean } | undefined;
  let asSponsor = false;
  // Why the draft can't be sent, if it can't, which fails it before anything is stored.
  let unsendable: string | undefined;
  if (actor.kind === "agent") {
    const sponsor = await findActor(table, actor.sponsor);
    if (sponsor?.kind !== "human") throw new Error(`The sponsor ${actor.sponsor} of agent ${actor.id} is missing.`);
    const { settings } = await agentSettings(table, actor.id);
    asSponsor = (await findMailbox(table, mailbox))?.owner !== actor.id;
    disclosure = { naming: `${actor.name} for ${sponsor.email}`, line: switchesFor(settings, asSponsor).disclosureLine };
    // Lowering its access withdraws the agent's pending approvals, and stops what was asked before.
    // An ask that read send access just before the lowering can land after its withdrawals, and stops here too.
    if (asSponsor && !sponsorAccessAllows(sponsorAccessIn(settings, mailbox), "send")) {
      unsendable = "The agent's sponsor access was lowered from send before this went out, so it wasn't sent. Its sponsor can send it.";
    }
  }
  // An admin may have removed the address since the draft was asked to send, or its owner from the group.
  const sendsFrom = await findMailbox(table, mailbox);
  if (sendsFrom !== undefined) unsendable ??= unsendableFrom(await fromStanding(table, sendsFrom, draft.from), draft.from);
  const original = draft.answers === undefined ? undefined : await findMessage(table, mailBucket, mailbox, draft.answers);
  // A forward carries the forwarded message's attachments, taken from it as it is now.
  const forwarded = draft.forwards === undefined ? undefined : await findMessage(table, mailBucket, mailbox, draft.forwards);
  // Without the message it forwards, a forward can't carry its attachments.
  if ((draft.attachments ?? []).length > 0 && forwarded === undefined) {
    unsendable ??= "The message it forwards is no longer in the mailbox, so its attachments can't go with it. Write a new message instead.";
  }
  if (draft.to.length + draft.cc.length + draft.bcc.length > maxRecipients) {
    unsendable ??= `SES sends a message to at most ${maxRecipients} recipients, in To, Cc and Bcc together. Send it as several messages.`;
  }

  // Everything is ready before the draft moves to sending, so only SES's answer can leave it unclear.
  const message = randomUUID();
  const sending: Sending = { mailbox, draft: id, approval: approval?.id, message, by, ...(status.undoUntil !== undefined && { undoUntil: status.undoUntil }) };
  const date = new Date();

  // An agent's send counts against its limits when it goes out, unless it can't go at all. Over
  // them, or behind its others that wait, it waits, unless its sponsor sent it now.
  const counted: TransactItem[] = [];
  if (actor.kind === "agent" && unsendable === undefined) {
    const window = await readWindow(table, actor.id, date);
    const unknown = await newRecipients(table, actor.id, [...draft.to, ...draft.cc, ...draft.bcc].map(({ address }) => address));
    const limits = await limitsOf(table, actor.id);
    const allowed = status.pastLimit ? undefined : allowedAt(window, limits, unknown.length, date);
    if (waiting === undefined && !status.pastLimit && (allowed !== undefined || (await waitingSends(table, actor.id)).length > 0)) {
      if (!(await waitForLimit(table, sending, approvedAt(draft, approval), [windowUnchanged(table, actor.id, window), agentUnpaused(table, actor.id)]))) return "again";
      // Only a send the limits stop, not one behind others that wait, says they are reached. The
      // alert can't join the wait's transaction, whose check that none was raised this window
      // would cancel the wait, so a run that stops in between raises none.
      if (allowed !== undefined) await limitReached(table, { agent: actor, mailbox, draft, window, limits, allowed, now: date });
      await release({ table, mailBucket, outbound, region, schedules }, actor.id);
      return "done";
    }
    if (allowed === "never") return "waitsForSponsor";
    if (allowed !== undefined) {
      await schedules.releaseAt(actor.id, allowed);
      return "waits";
    }
    counted.push(...counting(table, actor.id, window, { message, at: date, fresh: unknown }));
  }
  // Going out or failing, it no longer waits.
  if (waiting !== undefined) counted.push(stopWaiting(table, waiting.agent, waiting));
  const from = actor.kind === "agent" && !asSponsor ? { name: actor.name, address: draft.from } : { address: draft.from };
  const parent = original?.message.messageId;
  const text = disclosure?.line ? `${draft.text}\n\nSent by ${disclosure.naming}` : draft.text;
  const raw = buildMail({
    // SES replaces it with one of its own, which is the one recorded (docs/aws.md).
    messageId: `<${message}@${draft.from.slice(draft.from.lastIndexOf("@") + 1)}>`,
    from,
    to: draft.to,
    cc: draft.cc,
    subject: draft.subject,
    date,
    inReplyTo: parent,
    references: parent === undefined ? [] : [...(original?.references ?? []).filter((reference) => reference !== parent), parent],
    headers: disclosure === undefined ? [] : [[disclosureHeader, disclosure.naming]],
    text,
    attachments: forwarded?.parts ?? [],
  });
  const rawKey = `${sentPrefix}${message}`;
  if (unsendable === undefined) await mailBucket.put(rawKey, raw);
  // A pause since the agent was read holds the send too.
  if (!(await startSending(table, sending, actor.kind === "agent" ? [agentUnpaused(table, actor.id), ...counted] : [], expected))) return "again";
  if (unsendable !== undefined) {
    await markFailed(table, sending, unsendable, failedAlert(table, actor, mailbox, draft, unsendable));
    return "done";
  }

  let sesMessageId: string;
  const addresses = (list: { address: string }[]) => list.map(({ address }) => address);
  try {
    sesMessageId = await outbound.send(raw, { to: addresses(draft.to), cc: addresses(draft.cc), bcc: addresses(draft.bcc) });
  } catch (error) {
    if (error instanceof Refused) await markFailed(table, sending, error.message, failedAlert(table, actor, mailbox, draft, error.message));
    else await markUnclear(table, sending, unclearAlert(table, actor, mailbox, draft));
    return "done";
  }
  const sentAt = date.toISOString();
  const marked = await markSent(table, sending, {
    text,
    thread: draft.thread,
    sesMessageId,
    messageId: `<${sesMessageId}@${region}.amazonses.com>`,
    stored: { from, to: draft.to, cc: draft.cc, bcc: draft.bcc, recipient: draft.from, subject: draft.subject, date: sentAt, receivedAt: sentAt, rawKey, ...(actor.kind === "agent" && { fromAgent: true }) },
    approval,
  });
  if (!marked) return "done";
  // A crash before it's kept fails the record, and the stream hands it over again, which keeps it as sent.
  if (approval !== undefined) {
    const sent = await draftToSend(table, mailbox, id);
    if (sent?.send?.state === "sent") await keepSent(table, approval.id, { thread: sent.send.thread!, message });
  }
  await copyToOtherMembers({ table, mailBucket }, mailbox, message);
  return "done";
}

/** How an agent's draft reads in an alert about its send: its subject and its recipients. */
const messageRead = ({ subject, to, cc, bcc }: Pick<Draft, "subject" | "to" | "cc" | "bcc">) =>
  `message "${subject}" to ${[...to, ...cc, ...bcc].map(({ address }) => address).join(", ")}`;

/** The writes of the alert to an agent's sponsor that its send of the draft failed for the reason, or none for a human's send. */
const failedAlert = (table: Table, actor: Actor, mailbox: string, draft: Draft, reason: string): TransactItem[] =>
  actor.kind !== "agent" ? [] : alertItems(table, { kind: "sendFailed", agent: actor, what: `${actor.name}'s ${messageRead(draft)} failed: ${reason}`, link: { mailbox, draft: draft.id } });

/** The writes of the alert to an agent's sponsor that it is unclear whether its send of the draft went out, or none for a human's send. */
function unclearAlert(table: Table, actor: Actor | undefined, mailbox: string, draft: Draft): TransactItem[] {
  if (actor?.kind !== "agent") return [];
  const what = `Sending ${actor.name}'s ${messageRead(draft)} stopped before SES answered, so it's unclear whether it went out. Duva won't send it again.`;
  return alertItems(table, { kind: "sendFailed", agent: actor, what, link: { mailbox, draft: draft.id } });
}

const hour = 60 * 60 * 1000;
const day = 24 * hour;

/**
 * Raises the alert to the agent's sponsor that its send of the draft waits for its limits: once
 * for each window a limit fills, until the limits allow a send again, or once for a draft with
 * more new recipients than the whole daily limit.
 */
async function limitReached(
  table: Table,
  { agent, mailbox, draft, window, limits, allowed, now }: { agent: Agent; mailbox: string; draft: Draft; window: Window; limits: Limits; allowed: Date | "never"; now: Date },
): Promise<void> {
  const link = { mailbox, draft: draft.id };
  if (allowed === "never") {
    const what = `${agent.name}'s message "${draft.subject}" has more new recipients than its limit of ${limits.newRecipientsPerDay} a day, so it waits until you send it now.`;
    await raiseAlert(table, { kind: "limitReached", agent, what, link }, { source: `limit-never#${mailbox}#${draft.id}` });
    return;
  }
  const limit = window.sends.filter((send) => send.at > now.getTime() - hour).length >= limits.sendsPerHour ? "sendsPerHour" : "newRecipientsPerDay";
  // Times read to the minute, never before the limits allow.
  const from = new Date(Math.ceil(allowed.getTime() / 60_000) * 60_000).toISOString();
  const what = `${agent.name} reached its limit of ${limitRead(limit, limits[limit])}, so its sends wait. They go out by themselves from ${from.slice(11, 16)} UTC on ${from.slice(0, 10)}, or when you send them now.`;
  // What says a limit is reached lasts until it allows a send again, and the table forgets it a day later.
  const reached: TransactItem = {
    Put: {
      TableName: table.name,
      Item: { [pk]: `actor#${agent.id}`, [sk]: `limits#reached#${limit}`, until: allowed.toISOString(), [timeToLiveAttribute]: Math.ceil((allowed.getTime() + day) / 1000) },
      ConditionExpression: `attribute_not_exists(${pk}) OR #until <= :now`,
      ExpressionAttributeNames: { "#until": "until" },
      ExpressionAttributeValues: { ":now": now.toISOString() },
    },
  };
  await raiseAlert(table, { kind: "limitReached", agent, what, link }, { checks: [reached] });
}

/** Mails the urgent alert to its sponsor's default address, from Duva's system address on the organization's first domain, once. */
async function mailAlert({ table, outbound }: Sender, alert: { sponsor: string; id: string }): Promise<void> {
  const mail = await startMailing(table, alert);
  if (mail === undefined) return;
  const domain = await organizationDomain(table);
  // No agent sends it, so it carries no disclosure.
  const raw = buildMail({
    messageId: `<${randomUUID()}@${domain}>`,
    from: { name: "Duva", address: systemAddress(domain) },
    to: [{ address: mail.to }],
    cc: [],
    subject: mail.subject,
    date: new Date(),
    references: [],
    headers: [["Auto-Submitted", "auto-generated"]],
    text: `${mail.what}\n\nAll alerts about your agents are in Duva, under Alerts.`,
    attachments: [],
  });
  let sesMessageId: string;
  try {
    sesMessageId = await outbound.send(raw, { to: [mail.to], cc: [], bcc: [] });
  } catch (error) {
    await mailingSettled(table, alert, error instanceof Refused ? "failed" : "unclear");
    return;
  }
  await mailingSettled(table, alert, "sent", [{ Put: { TableName: table.name, Item: { ...systemMailKey(sesMessageId), [timeToLiveAttribute]: Math.floor(Date.now() / 1000) + systemMailKept } } }]);
}

/** The record that Duva sent the message SES gave the ID from its system address. */
const systemMailKey = (sesMessageId: string) => ({ [pk]: sesMessagePartition(sesMessageId), [sk]: "system-mail" });
// Kept 14 days, as long as the inbound Lambda's failure queue keeps an event for replay.
const systemMailKept = 14 * 24 * 60 * 60;

/**
 * Whether the message is mail Duva sent from its system address: from that address on one of the
 * organization's `domains`, with a DMARC pass, and with the Message-ID SES gave a message Duva
 * recorded sending. A send recorded only after the mail arrived goes unrecognized. A From forged without Duva's send record isn't.
 */
export async function sentBySystem(table: Table, { from, dmarc, messageId }: { from: string; dmarc: string; messageId?: string }, domains: Set<string>): Promise<boolean> {
  if (dmarc !== "PASS" || ![...domains].some((domain) => from === systemAddress(domain))) return false;
  // SES replaces the Message-ID of each message it sends with one made of the ID it gave it.
  const sesMessageId = /^<([^@<>\s]+)@[^<>\s]+\.amazonses\.com>$/.exec(messageId ?? "")?.[1];
  if (sesMessageId === undefined) return false;
  const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: systemMailKey(sesMessageId), ConsistentRead: true }));
  return Item !== undefined;
}
