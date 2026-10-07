// Mail to a group: who may send to it, which mailboxes and external addresses its members come to,
// the copies re-sent from the group to external members (ADR-0003), and the copies of what a member
// sends as the group that the other local members get (ADR-0019). Mail from a sender the
// group doesn't allow is bounced through SES, which accepted it before Duva could judge it. Each
// re-send and bounce is claimed in the table first, so a repeat of SES's event never repeats it.
import { randomUUID } from "node:crypto";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { MessageRejected, SendBounceCommand, type SESClient } from "@aws-sdk/client-ses";
import { DeleteCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import type { components } from "@duva/openapi";
import type { SESReceiptStatus } from "aws-lambda";
import type { Table } from "./deployment.ts";
import { sentPrefix, timeToLiveAttribute } from "./infrastructure.ts";
import { domainOf } from "./email-address.ts";
import type { MailBucket } from "./mail-bucket.ts";
import { type ParsedMail, parseMail, resentMail } from "./mime.ts";
import { sentFromMailbox, storedMessage, storeGroupCopy } from "./mail.ts";
import { addressTarget, aliasDomains, allDomains, allGroups, findActor, findMailbox, type Group, isAddressOf, type Mailbox, ownedMailboxes } from "./organization.ts";
import { type Outbound, Refused } from "./sending.ts";
import { pk, sk, documents, isNew } from "./table.ts";

type EmailAddress = components["schemas"]["EmailAddress"];

/** SES's bounces of mail it received, or a stand-in in tests. */
export interface Bounces {
  /**
   * Has SES bounce the message it received with the ID back to its sender, for the recipients, each
   * refused with the explanation and the enhanced status code, 5.7.1 unless given. SES sends the
   * bounce from its own MAILER-DAEMON, and `bounceSender`, which must be on a verified identity,
   * appears nowhere in it (docs/aws.md). Throws BounceRefused if SES refused to, as past its 24 hours.
   */
  send(bounce: { messageId: string; bounceSender: string; recipients: string[]; explanation: string; status?: "5.7.1" | "5.1.1" }): Promise<void>;
}

/** SES refused to bounce the message, and would refuse again. */
export class BounceRefused extends Error {}

/** SES's SendBounce. */
export function sesBounces(ses: SESClient): Bounces {
  return {
    async send({ messageId, bounceSender, recipients, explanation, status = "5.7.1" }) {
      try {
        await ses.send(
          new SendBounceCommand({
            OriginalMessageId: messageId,
            BounceSender: bounceSender,
            Explanation: explanation,
            // As RFC 3463 has them, 5.7.1: delivery not authorized, and 5.1.1: bad destination mailbox address.
            BouncedRecipientInfoList: recipients.map((recipient) => ({ Recipient: recipient, RecipientDsnFields: { Action: "failed", Status: status, DiagnosticCode: `smtp; 550 ${status} ${explanation}` } })),
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

/** The organization's domains, as expand() takes them. */
const organizationDomains = async (table: Table) => new Set((await allDomains(table)).map(({ domain }) => domain));

/**
 * The groups whose mail reaches one of the owner's mailboxes, nested groups included, which the
 * owner can send as (ADR-0019), by address in alphabetical order.
 */
export async function groupsSentAsBy(table: Table, owner: string): Promise<string[]> {
  const owned = new Set((await ownedMailboxes(table, owner)).map(({ id }) => id));
  if (owned.size === 0) return [];
  const domains = await organizationDomains(table);
  const groups: string[] = [];
  for (const group of await allGroups(table)) {
    const { mailboxes } = await expand(table, group, domains);
    if ([...mailboxes].some((mailbox) => owned.has(mailbox))) groups.push(group.address);
  }
  return groups;
}

/**
 * Whether the mailbox can send from the address: as one of its own, as a group its owner is a
 * member of, not as a group its owner isn't a member of, or not at all.
 */
export async function fromStanding(table: Table, mailbox: Mailbox, from: string): Promise<"own" | "group" | "notMember" | "none"> {
  if (isAddressOf(mailbox, from, await aliasDomains(table))) return "own";
  const target = await addressTarget(table, from.toLowerCase());
  if (target === undefined || !("group" in target)) return "none";
  return (await groupsSentAsBy(table, mailbox.owner)).includes(target.group.address) ? "group" : "notMember";
}

/**
 * Whether the mailbox sent the message to the group, so it gets no copy of its own mail: its From
 * is one of the mailbox's addresses with a DMARC pass, or its envelope sender is with an SPF pass,
 * since DMARC vouches only for the From, or Duva sent it from the mailbox, as its Message-ID there shows.
 */
export async function sentByMember(
  table: Table,
  mailbox: string,
  { from, dmarc, envelopeSender, spf, messageId }: Sender & { envelopeSender: string; spf: SESReceiptStatus["status"]; messageId?: string },
): Promise<boolean> {
  const found = await findMailbox(table, mailbox);
  const aliases = await aliasDomains(table);
  if (found !== undefined && ((dmarc === "PASS" && isAddressOf(found, from, aliases)) || (spf === "PASS" && isAddressOf(found, envelopeSender, aliases)))) return true;
  return messageId !== undefined && (await sentFromMailbox(table, mailbox, messageId));
}

/**
 * If the message sent from the mailbox went out as a group, gives each other local mailbox the
 * group reaches a copy, with a raw message of its own, so erasing one copy leaves the others. The
 * sender's own mailboxes get none, nor do those the message went to directly, which SES delivers
 * it to. A copy names who sent it and leaves out the Bcc recipients. External members get none.
 * Each mailbox gets it once, so a retry finishes what an earlier run left.
 */
export async function copyToOtherMembers({ table, mailBucket }: { table: Table; mailBucket: MailBucket }, mailbox: string, message: string): Promise<void> {
  const sent = await storedMessage(table, mailbox, message);
  if (sent?.sentBy === undefined) return;
  const target = await addressTarget(table, sent.from.address);
  if (target === undefined || !("group" in target)) return;
  const { mailboxes } = await expand(table, target.group, await organizationDomains(table));
  const aliases = await aliasDomains(table);
  const owner = (await findMailbox(table, mailbox))?.owner;
  const own = owner === undefined ? [] : await ownedMailboxes(table, owner);
  const recipients = [...sent.to, ...sent.cc, ...(sent.bcc ?? [])];
  for (const member of mailboxes) {
    const found = await findMailbox(table, member);
    if (member === mailbox || own.some(({ id }) => id === member) || (found !== undefined && recipients.some(({ address }) => isAddressOf(found, address, aliases)))) mailboxes.delete(member);
  }
  if (mailboxes.size === 0) return;
  const raw = await mailBucket.get(sent.rawKey);
  if (raw === undefined) return;
  const parsed = await parseMail(raw);
  const actor = await findActor(table, sent.sentBy);
  const sentAs = { group: target.group.address, by: sent.sentBy, name: actor?.kind === "agent" ? actor.name : (actor?.email ?? sent.sentBy) };
  const { messageId, from, to, cc, recipient, subject, date, receivedAt } = sent;
  for (const member of mailboxes) {
    const rawKey = `${sentPrefix}${message}-${member}`;
    await mailBucket.put(rawKey, raw);
    const copy = { id: randomUUID(), messageId, from, to, cc, recipient, subject, date, receivedAt, rawKey, sentAs, ...(sent.fromAgent && { fromAgent: true as const }) };
    await storeGroupCopy(table, { mailbox: member, sent: message, message: copy, text: parsed.text, answers: parsed.answers });
  }
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
export async function claim(table: Table, sesMessageId: string, step: string): Promise<(() => Promise<void>) | undefined> {
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
 * Bounces the message SES received, once, for each group recipient that refused it, with the
 * mailer-daemon of the domain the message was sent to, whose identity SES has, as BounceSender. If SES refuses to bounce it, that is logged, and it isn't tried again.
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
    await bounces.send({ messageId: sesMessageId, bounceSender: `mailer-daemon@${domainOf(claimed[0]!.recipient)}`, recipients: claimed.map(({ recipient }) => recipient), explanation: claimed.map(({ explanation }) => explanation).join(" ") });
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
