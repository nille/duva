// Mail to a group: who may send to it, which mailboxes and external addresses its members come to,
// and the copies re-sent from the group to external members (ADR-0003). Mail from a sender the
// group doesn't allow is bounced through SES, which accepted it before Duva could judge it. Each
// re-send and bounce is claimed in the table first, so a repeat of SES's event never repeats it.
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { MessageRejected, SendBounceCommand, type SESClient } from "@aws-sdk/client-ses";
import { DeleteCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import type { components } from "@duva/openapi";
import type { SESReceiptStatus } from "aws-lambda";
import type { Table } from "./deployment.ts";
import { timeToLiveAttribute } from "./infrastructure.ts";
import { domainOf } from "./email-address.ts";
import { type ParsedMail, resentMail } from "./mime.ts";
import { addressTarget, findMailbox, type Group } from "./organization.ts";
import { type Outbound, Refused } from "./sending.ts";
import { pk, sk, documents, isNew } from "./table.ts";

type EmailAddress = components["schemas"]["EmailAddress"];

/** SES's bounces of mail it received, or a stand-in in tests. */
export interface Bounces {
  /**
   * Has SES bounce the message it received with the ID back to its sender, from the address `from`,
   * for the recipients, each refused with the explanation. Throws BounceRefused if SES refused to,
   * as past its 24 hours.
   */
  send(bounce: { messageId: string; from: string; recipients: string[]; explanation: string }): Promise<void>;
}

/** SES refused to bounce the message, and would refuse again. */
export class BounceRefused extends Error {}

/** SES's SendBounce. */
export function sesBounces(ses: SESClient): Bounces {
  return {
    async send({ messageId, from, recipients, explanation }) {
      try {
        await ses.send(
          new SendBounceCommand({
            OriginalMessageId: messageId,
            BounceSender: from,
            Explanation: explanation,
            // 5.7.1: delivery not authorized, as RFC 3463 has it.
            BouncedRecipientInfoList: recipients.map((recipient) => ({ Recipient: recipient, RecipientDsnFields: { Action: "failed", Status: "5.7.1", DiagnosticCode: `smtp; 550 5.7.1 ${explanation}` } })),
          }),
        );
      } catch (error) {
        if (error instanceof MessageRejected) throw new BounceRefused(error.message);
        throw error;
      }
    },
  };
}

/**
 * Where a group's mail goes: its members' mailboxes, by ID, and its external members. With every
 * address its members send from, its nested groups' members' too, each mailbox's every address.
 */
export interface Expanded {
  mailboxes: Set<string>;
  external: Set<string>;
  sendersAllowed: Set<string>;
}

/**
 * The group's members, its nested groups' expanded, each group once however often it is a member.
 * A member on none of the organization's domains is external.
 */
export async function expand(table: Table, group: Group, domains: Set<string>): Promise<Expanded> {
  const expanded: Expanded = { mailboxes: new Set(), external: new Set(), sendersAllowed: new Set() };
  const seen = new Set([group.address]);
  const pending = [group];
  for (let each = pending.pop(); each !== undefined; each = pending.pop()) {
    for (const member of each.members) {
      expanded.sendersAllowed.add(member);
      if (!domains.has(domainOf(member))) {
        expanded.external.add(member);
        continue;
      }
      const target = await addressTarget(table, member);
      if (target === undefined) continue;
      if ("mailbox" in target) {
        expanded.mailboxes.add(target.mailbox);
        for (const address of (await findMailbox(table, target.mailbox))?.addresses ?? []) expanded.sendersAllowed.add(address);
      } else if (!seen.has(target.group.address)) {
        seen.add(target.group.address);
        pending.push(target.group);
      }
    }
  }
  return expanded;
}

/** Who sent a message, as its From says, and SES's DMARC verdict on that From. */
export interface Sender {
  from: string;
  dmarc: SESReceiptStatus["status"];
}

/**
 * Whether the message is the group's own, coming back to it, as a copy re-sent to an external
 * member that forwards to the group does: from the group's address, with a DMARC pass.
 */
export const isOwnMail = (group: Group, { from, dmarc }: Sender) => from === group.address && dmarc === "PASS";

/**
 * Why the group refuses mail from the sender, or undefined if it takes it. A From on one of the
 * organization's domains counts only with a DMARC pass, as the Screener has it, and any other only
 * if DMARC didn't fail, since many domains publish no DMARC policy.
 */
export function refusalOf(group: Group, expanded: Expanded, { from, dmarc }: Sender, domains: Set<string>): string | undefined {
  const own = domains.has(domainOf(from));
  const counts = own ? dmarc === "PASS" : dmarc !== "FAIL";
  if (group.sendPolicy === "organization" && !(own && counts)) return `${group.address} takes mail only from the organization.`;
  if (group.sendPolicy === "members" && !(expanded.sendersAllowed.has(from) && counts)) return `${group.address} takes mail only from its members.`;
  return undefined;
}

/** How long a claim on a re-send or a bounce is kept: longer than SES's event can be replayed from the failure queue. */
const claimDays = 15;

/**
 * Claims the step for the message SES received, so it's done once. Returns undefined if it was
 * claimed before, and otherwise a release that undoes the claim if the step then fails. A run that
 * stops between the claim and the step, as on a timeout, leaves it undone.
 */
async function claim(table: Table, sesMessageId: string, step: string): Promise<(() => Promise<void>) | undefined> {
  const Key = { [pk]: `received#${sesMessageId}`, [sk]: step };
  try {
    await documents(table).send(new PutCommand({ TableName: table.name, Item: { ...Key, [timeToLiveAttribute]: Math.floor(Date.now() / 1000) + claimDays * 86400 }, ...isNew }));
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) return undefined;
    throw error;
  }
  return async () => void (await documents(table).send(new DeleteCommand({ TableName: table.name, Key })));
}

/** A group recipient that refused the message, and why. */
export interface GroupRefusal {
  recipient: string;
  group: string;
  explanation: string;
}

/**
 * Bounces the message SES received, once, for each group recipient that refused it, from the
 * mailer-daemon of the domain the message was sent to, whose identity SES has. If SES refuses to bounce it, that is logged, and it isn't tried again.
 */
export async function bounceOnce(
  { table, bounces, log }: { table: Table; bounces: Bounces; log: (line: string) => void },
  { sesMessageId, refused }: { sesMessageId: string; refused: GroupRefusal[] },
) {
  const claimed: (GroupRefusal & { release: () => Promise<void> })[] = [];
  for (const each of refused) {
    const release = await claim(table, sesMessageId, `bounced#${each.group}`);
    if (release !== undefined) claimed.push({ ...each, release });
  }
  if (claimed.length === 0) return;
  try {
    await bounces.send({ messageId: sesMessageId, from: `mailer-daemon@${domainOf(claimed[0]!.recipient)}`, recipients: claimed.map(({ recipient }) => recipient), explanation: claimed.map(({ explanation }) => explanation).join(" ") });
  } catch (error) {
    if (error instanceof BounceRefused) {
      log(JSON.stringify({ message: "SES refused to bounce mail a group refused.", sesMessageId, groups: claimed.map(({ group }) => group) }));
      return;
    }
    for (const { release } of claimed) await release();
    throw error;
  }
}

/** SES sends to at most this many recipients in one call. */
const recipientsPerSend = 50;

/** The display name a copy re-sent from the group shows: the sender's, via the group (ADR-0003). */
const viaName = (from: EmailAddress, group: string) => `${from.name || from.address} via ${group.slice(0, group.lastIndexOf("@"))}`;

/**
 * Where external members' replies go: the group, or the original sender. A sender who gave a
 * Reply-To asked for replies there, so that is the sender's address for them.
 */
const replyToFor = (group: Group, parsed: ParsedMail, sender: string): EmailAddress[] =>
  group.replyTo === "group" ? [{ address: group.address }] : parsed.replyTo.length > 0 ? parsed.replyTo : [parsed.from ?? { address: sender }];

/**
 * Re-sends the message to each group's external members, from the group (ADR-0003), each external
 * address once, from the first group that reaches it. Each call of at most recipientsPerSend is
 * claimed first, so a repeat of SES's event re-sends none twice. If SES refuses a call, as in its
 * sandbox, that is logged, and it isn't tried again.
 */
export async function resendToExternalMembers(
  { table, outbound, log }: { table: Table; outbound: Outbound; log: (line: string) => void },
  { sesMessageId, raw, parsed, envelopeSender, groups }: { sesMessageId: string; raw: Uint8Array; parsed: ParsedMail; envelopeSender: string; groups: { group: Group; expanded: Expanded }[] },
) {
  const resentTo = new Set<string>();
  for (const { group, expanded } of groups) {
    const external = [...expanded.external].filter((address) => !resentTo.has(address));
    for (const address of external) resentTo.add(address);
    if (external.length === 0) continue;
    const copy = resentMail(raw, { from: { name: viaName(parsed.from ?? { address: envelopeSender }, group.address), address: group.address }, replyTo: replyToFor(group, parsed, envelopeSender) });
    for (let at = 0; at < external.length; at += recipientsPerSend) {
      const release = await claim(table, sesMessageId, `resent#${group.address}#${at / recipientsPerSend}`);
      if (release === undefined) continue;
      const recipients = external.slice(at, at + recipientsPerSend);
      try {
        await outbound.send(copy, { to: recipients, cc: [], bcc: [] });
      } catch (error) {
        if (!(error instanceof Refused)) {
          await release();
          throw error;
        }
        log(JSON.stringify({ message: "SES refused to re-send a group's mail to its external members.", sesMessageId, group: group.address, members: recipients.length }));
      }
    }
  }
}
