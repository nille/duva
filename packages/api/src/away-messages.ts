// Away messages (#155): the reply Duva sends for a human while they're away, from a first day to a
// last day in their time zone, or from when they switch it on until they switch it off. One switch
// covers all their mailboxes, and each mailbox has its own text. The setting is the human's, in
// their partition, so it goes with them, and a mailbox handed over answers with its new owner's.
// The inbound handler hands each message stored in an Inbox here. A reply goes once per sender per
// time away, which a claim in the mailbox's partition holds before SES is asked, and only to people,
// as RFC 3834 asks: never to automatic mail, lists or bounce addresses. It goes through SES from the
// address the mail came to, as the human, with no approval and no disclosure, since the text is
// their own, and counts toward no agent's send limits. Sent is left as it was: the message answered
// notes it, in the same transaction as its change. EventBridge Scheduler switches it off once the
// last day ends, as it brings back threads set aside, so a later time zone never revives it. Coo
// helps write the text, which only the human saves, and never writes the replies.
import { randomUUID } from "node:crypto";
import { ConditionalCheckFailedException, TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import type { SchedulerClient } from "@aws-sdk/client-scheduler";
import { DeleteCommand, GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { clockValue, type components, fromClockValue } from "@duva/openapi";
import { jsonBody, type OperationHandler, refusal } from "./api.ts";
import type { Table } from "./deployment.ts";
import { domainOf } from "./email-address.ts";
import { recordChanges } from "./feed.ts";
import { scheduleOnce, type ScheduleGroup } from "./limits.ts";
import { awayMessageNoted, inbox, type StoredSummary } from "./mail.ts";
import { buildMail, headerFields, type ParsedMail } from "./mime.ts";
import { duva, findMailbox, type Human, mailboxesInOrder, mailboxFeed, mailboxKey, ownedMailboxes } from "./organization.ts";
import { timeZoneOf } from "./preferences.ts";
import { type Outbound, Refused } from "./sending.ts";
import { timeToLiveAttribute } from "./infrastructure.ts";
import { documents, isNew, pk, sk } from "./table.ts";

type AwayMessage = components["schemas"]["AwayMessage"];

/** The away message as stored. `period` names the time away, which switching it on begins anew. */
interface Stored {
  on: boolean;
  firstDay?: string;
  lastDay?: string;
  subject?: string;
  texts: Record<string, string>;
  period?: string;
  revision: number;
}

const awayKey = (human: string) => ({ [pk]: `actor#${human}`, [sk]: "away" });
// A sender's claim on the time away's reply, in lower case, which a second arrival from them finds.
const repliedKey = (mailbox: string, period: string, address: string) => ({ [pk]: mailboxKey(mailbox)[pk]!, [sk]: `away-replied#${period}#${address}` });

async function storedAway(table: Table, human: string): Promise<Stored> {
  const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: awayKey(human), ConsistentRead: true }));
  return (Item as Stored | undefined) ?? { on: false, texts: {}, revision: 0 };
}

/** The day after the day, as YYYY-MM-DD. */
const dayAfter = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** When the time away's days begin and end, on the time zone's clock, or undefined without days. */
const daysOf = ({ firstDay, lastDay }: Pick<Stored, "firstDay" | "lastDay">, timeZone: string) =>
  firstDay === undefined || lastDay === undefined ? undefined : { start: fromClockValue(`${firstDay}T00:00`, timeZone)!, end: fromClockValue(`${dayAfter(lastDay)}T00:00`, timeZone)! };

/** Whether the switch is on, and the last day, if it has days, hasn't ended. */
const switchedOn = (stored: Stored, timeZone: string, now: Date) => stored.on && !(now >= (daysOf(stored, timeZone)?.end ?? Infinity));

/** Whether the human is away at the time: switched on, and without days or on one of them. */
const awayAt = (stored: Stored, timeZone: string, now: Date) => switchedOn(stored, timeZone, now) && now >= (daysOf(stored, timeZone)?.start ?? -Infinity);

async function awayMessageOf(table: Table, human: Human, stored: Stored): Promise<AwayMessage> {
  const [owned, timeZone] = await Promise.all([ownedMailboxes(table, human.id), timeZoneOf(table, human.id)]);
  const mailboxes = mailboxesInOrder(owned, human.email);
  const now = new Date();
  const zone = timeZone ?? "UTC";
  return {
    on: switchedOn(stored, zone, now),
    away: awayAt(stored, zone, now),
    ...(stored.firstDay !== undefined && { firstDay: stored.firstDay, lastDay: stored.lastDay }),
    ...(stored.subject !== undefined && { subject: stored.subject }),
    mailboxes: mailboxes.map(({ id, defaultAddress, addresses }) => ({
      mailbox: id,
      address: defaultAddress ?? addresses[0] ?? "",
      ...(stored.texts[id] !== undefined && { text: stored.texts[id] }),
    })),
  };
}

/** What EventBridge Scheduler hands the sender when a time away's last day ends. */
export interface AwayEndEvent {
  awayEnds: { human: string; period: string; lastDay: string };
}

/** Has the sender switch an away message off when its last day ends. EventBridge Scheduler's, or a stand-in in tests. */
export interface AwayEnds {
  endAt(end: AwayEndEvent["awayEnds"], at: Date): Promise<void>;
}

/** One-time schedules in the sender's schedule group, one per time away and last day, named by the time away. */
export function eventBridgeAwayEnds(scheduler: SchedulerClient, schedule: ScheduleGroup): AwayEnds {
  return {
    endAt: (end, at) => scheduleOnce(scheduler, schedule, { name: (second) => `away-${end.period}-${second}`.slice(0, 64), at, input: { awayEnds: end } satisfies AwayEndEvent }),
  };
}

/** Switches the away message off, unless it was switched on again since, which began another time away, or its last day changed. */
export async function endAway(table: Table, { human, period, lastDay }: AwayEndEvent["awayEnds"]): Promise<void> {
  await documents(table)
    .send(
      new UpdateCommand({
        TableName: table.name,
        Key: awayKey(human),
        UpdateExpression: "SET #on = :off, revision = revision + :one",
        ConditionExpression: "period = :period AND lastDay = :lastDay AND #on = :on",
        ExpressionAttributeNames: { "#on": "on" },
        ExpressionAttributeValues: { ":off": false, ":on": true, ":period": period, ":lastDay": lastDay, ":one": 1 },
      }),
    )
    .catch((error: unknown) => {
      if (!(error instanceof ConditionalCheckFailedException)) throw error;
    });
}

const agentsRefused = () => refusal(403, "Only humans have an away message. Ask your sponsor to set theirs.");

export const getAwayMessage: OperationHandler = async (_event, deployment, actor) => {
  if (actor?.kind !== "human") return agentsRefused();
  return { statusCode: 200, body: await awayMessageOf(deployment.table, actor, await storedAway(deployment.table, actor.id)) };
};

const fields = ["on", "firstDay", "lastDay", "subject", "mailbox", "text"];
const isDay = (value: unknown) => typeof value === "string" && /^\d{4}-\d\d-\d\d$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);

export const changeAwayMessage: OperationHandler = async (event, deployment, actor) => {
  if (actor?.kind !== "human") return agentsRefused();
  const { table } = deployment;
  const body = jsonBody(event) ?? {};
  const unknown = Object.keys(body).find((name) => !fields.includes(name));
  if (unknown !== undefined) return refusal(400, `An away message has no ${JSON.stringify(unknown)}. Give on, firstDay and lastDay, subject, or mailbox and text.`);
  if (Object.keys(body).length === 0) return refusal(400, "Give what to change: on, firstDay and lastDay, subject, or mailbox and text.");
  if (body.on !== undefined && typeof body.on !== "boolean") return refusal(400, "Give on as true or false.");
  if ((body.firstDay === undefined) !== (body.lastDay === undefined) || (body.firstDay === null) !== (body.lastDay === null)) {
    return refusal(400, "Give firstDay and lastDay together, as days, or both as null to be away until you switch it off.");
  }
  const timeZone = (await timeZoneOf(table, actor.id)) ?? "UTC";
  if (body.firstDay !== undefined && body.firstDay !== null) {
    for (const name of ["firstDay", "lastDay"]) if (!isDay(body[name])) return refusal(400, `${JSON.stringify(body[name])} isn't a day. Give ${name} as YYYY-MM-DD, such as 2026-11-18.`);
    if ((body.lastDay as string) < (body.firstDay as string)) return refusal(400, "The last day is before the first. Give a lastDay from firstDay on.");
    if ((body.lastDay as string) < clockValue(new Date(), timeZone).slice(0, 10)) return refusal(400, `The last day has passed in your time zone, ${timeZone}. Give a lastDay from today on.`);
  }
  if (body.subject !== undefined && body.subject !== null && (typeof body.subject !== "string" || body.subject.trim() === "" || body.subject.length > 200)) {
    return refusal(400, "Give subject as text of up to 200 characters, or null for the default.");
  }
  if ((body.mailbox === undefined) !== (body.text === undefined)) return refusal(400, "Give mailbox and text together, to change that mailbox's text.");
  if (body.text !== undefined && body.text !== null && (typeof body.text !== "string" || body.text.trim() === "" || body.text.length > 5000)) {
    return refusal(400, "Give text as up to 5,000 characters, or null to remove it.");
  }
  const mailboxes = await ownedMailboxes(table, actor.id);
  if (body.mailbox !== undefined && !mailboxes.some(({ id }) => id === body.mailbox)) {
    return refusal(400, `${JSON.stringify(body.mailbox)} isn't one of your mailboxes. Give mailbox as the ID of one of yours, which listing your mailboxes gives.`);
  }
  for (let attempt = 1; ; attempt++) {
    const was = await storedAway(table, actor.id);
    const is: Stored = { ...was, texts: { ...was.texts }, revision: was.revision + 1 };
    // Texts of mailboxes no longer theirs are left out, since they reply from none.
    for (const id of Object.keys(is.texts)) if (!mailboxes.some((mailbox) => mailbox.id === id)) delete is.texts[id];
    if (body.mailbox !== undefined) {
      if (body.text === null) delete is.texts[body.mailbox as string];
      else is.texts[body.mailbox as string] = (body.text as string).replace(/\r\n?/g, "\n").trim();
    }
    if (body.subject !== undefined) {
      if (body.subject === null) delete is.subject;
      else is.subject = (body.subject as string).trim();
    }
    if (body.firstDay === null) {
      delete is.firstDay;
      delete is.lastDay;
    } else if (body.firstDay !== undefined) {
      is.firstDay = body.firstDay as string;
      is.lastDay = body.lastDay as string;
    }
    // One that ended is off, whatever the item says, so switching it on again begins anew.
    const wasOn = switchedOn(was, timeZone, new Date());
    if (body.on !== undefined) is.on = body.on as boolean;
    else is.on = wasOn;
    if (is.on && Object.keys(is.texts).length === 0) return refusal(400, "Give a text for at least one of your mailboxes first, with mailbox and text, then switch it on.");
    // Changing the days while away goes on with the same time away, so no one gets it twice.
    const begins = is.on && !wasOn;
    if (begins) is.period = randomUUID();
    // Scheduled first, so it is never on with days and nothing to end it. A schedule for the same
    // time away and end is the same one, and one whose change didn't hold finds it otherwise, and does nothing.
    const days = daysOf(is, timeZone);
    if (is.on && days !== undefined) await deployment.awayEnds.endAt({ human: actor.id, period: is.period!, lastDay: is.lastDay! }, days.end);
    try {
      await documents(table).send(
        new PutCommand({
          TableName: table.name,
          Item: { ...awayKey(actor.id), ...is },
          ...(was.revision === 0 ? isNew : { ConditionExpression: "revision = :revision", ExpressionAttributeValues: { ":revision": was.revision } }),
        }),
      );
    } catch (error) {
      // Changed meanwhile, so it is read again.
      if (!(error instanceof ConditionalCheckFailedException) || attempt === 10) throw error;
      continue;
    }
    return { statusCode: 200, body: await awayMessageOf(table, actor, is) };
  }
}

// Local parts of addresses no one reads, or that bounces and lists send from (RFC 3834, section 2).
const unattended = /^(?:no[-_.]?reply|do[-_.]?not[-_.]?reply|mailer[-_.]?daemon|postmaster|bounces?|owner-.+|.+-(?:request|bounces?|owner))(?:[-+._].*)?$/i;

/** Whether the header fields mark the mail automatic or a list's (RFC 3834, section 2, and RFC 2369). */
function automatic(raw: Uint8Array): boolean {
  return headerFields(raw).some(({ name, value, decoded }) => {
    const field = name.toLowerCase();
    const text = (decoded ?? value).trim().toLowerCase();
    return (field === "auto-submitted" && text !== "no" && !text.startsWith("no;")) || (field === "precedence" && /^(bulk|list|junk)\b/.test(text)) || field === "list-id" || field === "list-unsubscribe";
  });
}

/** A message the mailbox stored, as the inbound handler hands it on. */
export interface AwayArrival {
  mailbox: string;
  /** The thread it is in, as stored with it. */
  thread: Pick<StoredSummary, "id" | "labels">;
  message: string;
  /** The mailbox's address it came to, with its plus tag. */
  recipient: string;
  plusTag?: string;
  group?: string;
  envelopeSender: string;
  spam: boolean;
  fromAgent: boolean;
  raw: Uint8Array;
  parsed: ParsedMail;
}

/**
 * Sends the mailbox's owner's away message to the person whose mail it stored, if the owner is away
 * and the mail is a person's that reached the Inbox, unless they got it already this time away.
 * A reply SES didn't send is logged rather than thrown, since an event processed again finds the
 * message stored and sends nothing, so it is left to the sender's next mail. A Lambda that stops
 * between the claim and the send leaves that sender without one this time away, as a reply sent twice would be worse.
 */
export async function sendAwayMessage({ table, outbound, log }: { table: Table; outbound: Outbound; log: (line: string) => void }, arrival: AwayArrival): Promise<void> {
  const { mailbox: id, thread, parsed } = arrival;
  if (arrival.spam || arrival.group !== undefined || arrival.fromAgent || !thread.labels.includes(inbox)) return;
  const to = (parsed.from?.address ?? arrival.envelopeSender).toLowerCase();
  const envelope = arrival.envelopeSender.toLowerCase();
  if (envelope === "" || envelope === "<>" || [to, envelope].some((address) => unattended.test(address.slice(0, address.lastIndexOf("@"))))) return;
  if (automatic(arrival.raw)) return;
  const mailbox = await findMailbox(table, id);
  if (mailbox === undefined) return;
  const human = mailbox.owner;
  // Mail from the human themselves, from any of their mailboxes, isn't answered.
  if ((await ownedMailboxes(table, human)).some(({ addresses }) => addresses.includes(to))) return;
  const [stored, timeZone] = await Promise.all([storedAway(table, human), timeZoneOf(table, human)]);
  const text = stored.texts[id];
  if (text === undefined || stored.period === undefined || !awayAt(stored, timeZone ?? "UTC", new Date())) return;
  const claim = repliedKey(id, stored.period, to);
  // The claim, which keeps the sender's address, goes once the time away ends, or a year on without days.
  const ends = daysOf(stored, timeZone ?? "UTC")?.end ?? new Date(Date.now() + 365 * 86_400_000);
  try {
    await documents(table).send(new PutCommand({ TableName: table.name, Item: { ...claim, to, [timeToLiveAttribute]: Math.ceil(ends.getTime() / 1000) }, ...isNew }));
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) return;
    throw error;
  }
  const from = arrival.plusTag === undefined ? arrival.recipient : arrival.recipient.replace(`+${arrival.plusTag}@`, "@");
  const raw = buildMail({
    // SES replaces it with one of its own (docs/aws.md).
    messageId: `<${randomUUID()}@${domainOf(from)}>`,
    from: { address: from },
    to: [{ address: to }],
    cc: [],
    subject: stored.subject ?? `Away: ${parsed.subject}`,
    date: new Date(),
    ...(parsed.messageId !== undefined && { inReplyTo: parsed.messageId }),
    references: parsed.messageId === undefined ? parsed.references : [...parsed.references.filter((reference) => reference !== parsed.messageId), parsed.messageId],
    headers: [["Auto-Submitted", "auto-replied"]],
    text,
    html: htmlOf(text),
    attachments: [],
  });
  try {
    await outbound.send(raw, { to: [to], cc: [], bcc: [] });
  } catch (error) {
    // SES refused it, and would again, so the claim stands. Otherwise it may not have gone, so the sender's next mail tries again.
    if (!(error instanceof Refused)) await documents(table).send(new DeleteCommand({ TableName: table.name, Key: claim }));
    log(JSON.stringify({ message: "SES didn't send an away message.", mailbox: id, reason: error instanceof Error ? error.message : String(error) }));
    return;
  }
  const note = await awayMessageNoted(table, id, arrival.message, { sentAt: new Date().toISOString(), to });
  if (note === undefined) return;
  try {
    await recordChanges(table, mailboxFeed(id), { by: duva, changes: [{ type: "awayMessageSent", thread: thread.id, message: arrival.message, to }], items: [note] });
  } catch (error) {
    // The message was erased meanwhile.
    if (!(error instanceof TransactionCanceledException)) throw error;
  }
}

/** The text as a simple HTML part: each paragraph in its own, its lines broken as written. */
function htmlOf(text: string): string {
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const paragraphs = escaped.split(/\n{2,}/).map((paragraph) => `<p>${paragraph.split("\n").join("<br>\n")}</p>`);
  return `<!doctype html>\n<html><body>\n${paragraphs.join("\n")}\n</body></html>`;
}
