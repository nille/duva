// The sender, which the table's stream invokes for each approved draft: one a decision approved,
// or one asked to send without approval, as a human's from their own mailbox is. It sends an agent's draft through SES
// with the disclosure, and a human's without, and records the outcome. Sending starts
// from the recorded approval, so a crash between it and the send can't lose it, and each step is
// conditional on the last, so a retried record never sends twice.
import { randomUUID } from "node:crypto";
import { SendEmailCommand, SESv2ServiceException, type SESv2Client } from "@aws-sdk/client-sesv2";
import type { DynamoDBStreamEvent } from "aws-lambda";
import type { Table } from "./deployment.ts";
import { draftAt, draftToSend, findApproval, markFailed, markSent, markUnclear, notFrom, type Sending, startSending } from "./drafting.ts";
import { sentPrefix } from "./infrastructure.ts";
import type { MailBucket } from "./mail-bucket.ts";
import { findMessage } from "./mail.ts";
import { buildMail } from "./mime.ts";
import { sponsorAccessAllows } from "./access.ts";
import { agentSettings, aliasDomains, findActor, findMailbox, isAddressOf, switchesFor } from "./organization.ts";

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

/** SES refused the message, so it wasn't sent. */
export class Refused extends Error {}

/**
 * The header every message an agent sends carries, naming the agent and the human it acts for. Its
 * name is part of Duva's public behavior, documented in docs/disclosure.md.
 */
export const disclosureHeader = "Duva-Agent";

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
}

export function createSender(sender: Sender) {
  return async (event: DynamoDBStreamEvent): Promise<void> => {
    for (const record of event.Records) {
      const keys = Object.fromEntries(Object.entries(record.dynamodb?.Keys ?? {}).map(([name, value]) => [name, value.S ?? ""]));
      const at = draftAt(keys);
      if (at !== undefined) await send(sender, at);
    }
  };
}

/** Sends the draft if it is approved. One left sending by an earlier run that stopped is marked unclear, never sent again. */
async function send({ table, mailBucket, outbound, region }: Sender, { mailbox, draft: id }: { mailbox: string; draft: string }) {
  const draft = await draftToSend(table, mailbox, id);
  const status = draft?.send;
  if (draft === undefined || status === undefined) return;
  const approval = status.approval === undefined ? undefined : await findApproval(table, status.approval);
  if (status.approval !== undefined && approval === undefined) throw new Error(`The approval ${status.approval} that draft ${id} was sent with is missing.`);
  const by = approval?.agent ?? status.by;
  if (by === undefined) throw new Error(`Draft ${id} was asked to send without an approval or a human who sent it.`);
  if (status.state === "sending") {
    await markUnclear(table, { mailbox, draft: id, approval: approval?.id, message: status.message!, by });
    return;
  }
  if (status.state !== "approved") return;

  const actor = await findActor(table, by);
  if (actor === undefined) throw new Error(`The actor ${by} that draft ${id} is sent for is missing.`);
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
    // An ask that read full access just before the lowering can land after its withdrawals, and stops here too.
    if (asSponsor && !sponsorAccessAllows(settings.sponsorAccess, "send")) {
      unsendable = "The agent's sponsor access was lowered from full before this went out, so it wasn't sent. Its sponsor can send it.";
    }
  }
  // An admin may have removed the address since the draft was asked to send.
  const sendsFrom = await findMailbox(table, mailbox);
  if (sendsFrom !== undefined && !isAddressOf(sendsFrom, draft.from, await aliasDomains(table))) unsendable ??= notFrom(draft.from);
  const original = draft.answers === undefined ? undefined : await findMessage(table, mailBucket, mailbox, draft.answers);
  // A forward carries the forwarded message's attachments, taken from it as it is now.
  const forwarded = draft.forwards === undefined ? undefined : await findMessage(table, mailBucket, mailbox, draft.forwards);
  // Without the message it forwards, a forward can't carry its attachments.
  if ((draft.attachments ?? []).length > 0 && forwarded === undefined) {
    unsendable ??= "The message it forwards is no longer in the mailbox, so its attachments can't go with it. Write a new message instead.";
  }

  // Everything is ready before the draft moves to sending, so only SES's answer can leave it unclear.
  const message = randomUUID();
  const sending: Sending = { mailbox, draft: id, approval: approval?.id, message, by };
  const date = new Date();
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
  if (!(await startSending(table, sending))) return;
  if (unsendable !== undefined) {
    await markFailed(table, sending, unsendable);
    return;
  }

  let sesMessageId: string;
  const addresses = (list: { address: string }[]) => list.map(({ address }) => address);
  try {
    sesMessageId = await outbound.send(raw, { to: addresses(draft.to), cc: addresses(draft.cc), bcc: addresses(draft.bcc) });
  } catch (error) {
    if (error instanceof Refused) await markFailed(table, sending, error.message);
    else await markUnclear(table, sending);
    return;
  }
  const sentAt = date.toISOString();
  await markSent(table, sending, {
    text,
    thread: draft.thread,
    messageId: `<${sesMessageId}@${region}.amazonses.com>`,
    stored: { from, to: draft.to, cc: draft.cc, bcc: draft.bcc, recipient: draft.from, subject: draft.subject, date: sentAt, receivedAt: sentAt, rawKey },
    approval,
  });
}
