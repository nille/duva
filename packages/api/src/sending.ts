// The sender, which the table's stream invokes for each draft a decision approved. It sends the
// draft through SES as the agent's, with the disclosure, and records the outcome. Sending starts
// from the recorded decision, so a crash between the decision and the send can't lose it, and each
// step is conditional on the last, so a retried record never sends twice.
import { randomUUID } from "node:crypto";
import { SendEmailCommand, SESv2ServiceException, type SESv2Client } from "@aws-sdk/client-sesv2";
import type { DynamoDBStreamEvent } from "aws-lambda";
import type { Table } from "./deployment.ts";
import { draftAt, findApproval, findDraft, markFailed, markSent, markUnclear, type Sending, startSending } from "./drafting.ts";
import { sentPrefix } from "./infrastructure.ts";
import type { MailBucket } from "./mail-bucket.ts";
import { findMessage } from "./mail.ts";
import { buildMail } from "./mime.ts";
import { findActor, organizationDomain } from "./organization.ts";

/** SES's sending, or a stand-in in tests. */
export interface Outbound {
  /**
   * Hands SES the raw message. Throws Refused with SES's reason if SES refused it. Any other error
   * leaves it unclear whether SES accepted it.
   */
  send(raw: Uint8Array): Promise<void>;
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
    async send(raw) {
      for (let attempt = 1; ; attempt++) {
        try {
          await ses.send(new SendEmailCommand({ Content: { Raw: { Data: raw } }, ConfigurationSetName: configurationSet }));
          return;
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
async function send({ table, mailBucket, outbound }: Sender, { mailbox, draft: id }: { mailbox: string; draft: string }) {
  const draft = await findDraft(table, mailbox, id);
  const status = draft?.send;
  if (draft === undefined || status === undefined) return;
  const approval = await findApproval(table, status.approval);
  if (approval === undefined) throw new Error(`The approval ${status.approval} that draft ${id} was sent with is missing.`);
  if (status.state === "sending") {
    await markUnclear(table, { mailbox, draft: id, approval: approval.id, message: status.message!, messageId: status.messageId!, agent: approval.agent });
    return;
  }
  if (status.state !== "approved") return;

  const agent = await findActor(table, approval.agent);
  if (agent?.kind !== "agent") throw new Error(`The agent ${approval.agent} that draft ${id} is sent for is missing.`);
  const sponsor = await findActor(table, agent.sponsor);
  if (sponsor?.kind !== "human") throw new Error(`The sponsor ${agent.sponsor} of agent ${agent.id} is missing.`);
  const original = draft.answers === undefined ? undefined : await findMessage(table, mailBucket, mailbox, draft.answers);

  // Everything is ready before the draft moves to sending, so only SES's answer can leave it unclear.
  const message = randomUUID();
  const sending: Sending = { mailbox, draft: id, approval: approval.id, message, messageId: `<${message}@${await organizationDomain(table)}>`, agent: agent.id };
  const date = new Date();
  const from = { name: agent.name, address: draft.from };
  const disclosure = `${agent.name} for ${sponsor.email}`;
  const parent = original?.message.messageId;
  const raw = buildMail({
    messageId: sending.messageId,
    from,
    to: draft.to,
    subject: draft.subject,
    date,
    inReplyTo: parent,
    references: parent === undefined ? [] : [...(original?.references ?? []).filter((reference) => reference !== parent), parent],
    headers: [[disclosureHeader, disclosure]],
    text: `${draft.text}\n\nSent by ${disclosure}`,
  });
  const rawKey = `${sentPrefix}${message}`;
  await mailBucket.put(rawKey, raw);
  if (!(await startSending(table, sending))) return;

  try {
    await outbound.send(raw);
  } catch (error) {
    if (error instanceof Refused) await markFailed(table, sending, error.message);
    else await markUnclear(table, sending);
    return;
  }
  const sentAt = date.toISOString();
  await markSent(table, sending, {
    thread: draft.thread,
    stored: { from, to: draft.to, cc: [], recipient: draft.from, subject: draft.subject, date: sentAt, receivedAt: sentAt, rawKey },
  });
}
