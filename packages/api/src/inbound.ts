// The inbound handler, which SES invokes, without waiting, for each message it accepts. By then SES
// has stored the raw message in the mail bucket. A failure makes Lambda retry the event, then
// leaves it in the failure queue for replay, so processing is idempotent per SES message ID.
// Only FAIL verdicts act. GRAY and PROCESSING_FAILED count as passes. Mail Duva sent from its
// system address, such as an urgent alert, is never spam, whatever SES's verdict. Mail to a group
// goes to its members, as group-mail.ts has it. Mail to an address the organization doesn't have
// goes to its domain's catch-all, which SES takes it for, as if to the catch-all's mailbox or group.
// Mail that passed DMARC carries its sender's logo, if their domain publishes one Duva shows
// (ADR-0023), except mail from an agent, which keeps the agent's mark, and spam.
import type { SESEvent } from "aws-lambda";
import type { Table } from "./deployment.ts";
import { dropLogLine, dropReason } from "./drops.ts";
import { domainOf } from "./email-address.ts";
import { inboundPrefix } from "./infrastructure.ts";
import type { MailBucket } from "./mail-bucket.ts";
import { parseMail } from "./mime.ts";
import { bounceOnce, type Bounces, type Expanded, expand, type GroupRefusal, isOwnMail, refusalOf, resendToExternalMembers, type Sender, sentByMember } from "./group-mail.ts";
import { addressTarget, allDomains, type CatchAll, catchAllTarget, type Group } from "./organization.ts";
import { type Outbound, sentBySystem } from "./sending.ts";
import { receiveScreened } from "./screening.ts";
import { senderLogo, type SenderLogos } from "./sender-logos.ts";

/**
 * What the inbound handler needs: the table, the mail bucket, its log, which takes one line at a
 * time, SES's sending, for groups' external members, its bounces, for mail a group refuses, and
 * what looking up senders' logos needs.
 */
export function createInbound({
  table,
  mailBucket,
  log,
  outbound,
  bounces,
  logos,
}: {
  table: Table;
  mailBucket: MailBucket;
  log: (line: string) => void;
  outbound: Outbound;
  bounces: Bounces;
  logos: SenderLogos;
}) {
  return async (event: SESEvent): Promise<void> => {
    for (const { ses } of event.Records) {
      const rawKey = `${inboundPrefix}${ses.mail.messageId}`;
      const organizationDomains = await allDomains(table);
      const domains = new Set(organizationDomains.map(({ domain }) => domain));
      // An alias domain's catch-all is its standalone domain's.
      const catchAlls = new Map<string, CatchAll | undefined>(organizationDomains.map(({ domain, aliasOf, catchAll }) => [domain, aliasOf === undefined ? catchAll : organizationDomains.find((each) => each.domain === aliasOf)?.catchAll]));
      // The recipients are those the rule took. Each mailbox gets one copy: for the first of its own
      // addresses, or else as a member of the first group that reaches it, or else as a catch-all.
      const direct = new Map<string, Recipient>();
      const caught = new Map<string, Recipient>();
      const groups: (Recipient & { group: Group; expanded: Expanded })[] = [];
      const take = async (recipient: Recipient, target: Awaited<ReturnType<typeof catchAllTarget>>, mailboxes: Map<string, Recipient>) => {
        if (target === undefined) return;
        if ("mailbox" in target) {
          if (!mailboxes.has(target.mailbox)) mailboxes.set(target.mailbox, recipient);
        } else if (!groups.some(({ group }) => group.address === target.group.address)) {
          groups.push({ ...recipient, group: target.group, expanded: await expand(table, target.group, domains) });
        }
      };
      const unknown: (Recipient & { address: string })[] = [];
      for (const given of ses.receipt.recipients) {
        const { address, ...recipient } = untagged(given);
        const target = await addressTarget(table, address);
        if (target === undefined) unknown.push({ address, ...recipient });
        else await take(recipient, target, direct);
      }
      // A catch-all takes the mail as if it were sent to its mailbox or group, after the addresses the organization has.
      for (const { address, ...recipient } of unknown) await take(recipient, await catchAllTarget(table, catchAlls.get(domainOf(address))), caught);
      // SES has already accepted the message, so dropping it sends no bounce, and leaves no trace in
      // the mailbox. A repeat of the event finds nothing left to erase, so it isn't counted again.
      const reason = dropReason(ses.receipt);
      if (reason !== undefined) {
        const mailboxes = new Set([...direct.keys(), ...groups.flatMap(({ expanded }) => [...expanded.mailboxes]), ...caught.keys()]);
        if (await mailBucket.erase(rawKey)) log(dropLogLine(reason, ses, [...mailboxes]));
        continue;
      }
      const dmarcPassed = ses.receipt.dmarcVerdict.status === "PASS";
      const raw = await mailBucket.get(rawKey);
      if (raw === undefined) throw new Error(`SES stored no message at ${rawKey}.`);
      const parsed = await parseMail(raw);
      const sender: Sender = { from: (parsed.from?.address ?? ses.mail.source).toLowerCase(), dmarc: ses.receipt.dmarcVerdict.status };
      const spam = ses.receipt.spamVerdict.status === "FAIL" && !(await sentBySystem(table, { ...sender, messageId: parsed.messageId }, domains));
      const delivered = new Map<string, Recipient & { group?: string }>(direct);
      const refused: GroupRefusal[] = [];
      const taken: typeof groups = [];
      // A member that mails its group gets no copy of its own mail.
      const sentBy = { ...sender, envelopeSender: ses.mail.source.toLowerCase(), spf: ses.receipt.spfVerdict.status, messageId: parsed.messageId };
      for (const each of groups) {
        // The group's own copy coming back has already reached its members.
        if (isOwnMail(each.group, sender)) continue;
        const explanation = refusalOf(each.group, each.expanded, sender, domains);
        if (explanation !== undefined) {
          refused.push({ recipient: each.recipient, group: each.group.address, explanation });
          continue;
        }
        taken.push(each);
        for (const mailbox of each.expanded.mailboxes) {
          if (delivered.has(mailbox) || (await sentByMember(table, mailbox, sentBy))) continue;
          delivered.set(mailbox, { recipient: each.recipient, plusTag: each.plusTag, group: each.group.address });
        }
      }
      for (const [mailbox, to] of caught) if (!delivered.has(mailbox)) delivered.set(mailbox, to);
      // Only Duva sends from the organization's domains with a DMARC pass, so there the header is its own.
      const fromAgent = parsed.disclosure !== undefined && dmarcPassed && domains.has(domainOf(sender.from));
      // DMARC passes only for the From's domain.
      const logo =
        dmarcPassed && !spam && !fromAgent && parsed.from !== undefined && delivered.size > 0
          ? await senderLogo(table, logos, { domain: domainOf(sender.from), selector: parsed.bimiSelector })
          : undefined;
      for (const [mailbox, to] of delivered) {
        await receiveScreened(table, { mailbox, sesMessageId: ses.mail.messageId, rawKey, ...to, sender: ses.mail.source, receivedAt: ses.mail.timestamp, parsed, spam, dmarcPassed, fromAgent, logo });
      }
      // Spam goes to no one outside, and a bounce of it would most likely reach someone it forged.
      if (spam) continue;
      await resendToExternalMembers({ table, outbound, log }, { sesMessageId: ses.mail.messageId, raw, parsed, envelopeSender: ses.mail.source, groups: taken });
      if (refused.length > 0) await bounceOnce({ table, bounces, log }, { sesMessageId: ses.mail.messageId, refused });
    }
  };
}

/** The address SES delivered a message to, with its plus tag, and the tag. */
interface Recipient {
  recipient: string;
  plusTag?: string;
}


/**
 * The address a recipient reaches, without its plus tag. Addresses are in lower case, and the
 * recipient keeps its plus tag as the sender wrote it.
 */
function untagged(given: string): { address: string; recipient: string; plusTag?: string } {
  const at = given.lastIndexOf("@");
  const domain = given.slice(at + 1).toLowerCase();
  const [local = "", ...tag] = given.slice(0, at).split("+");
  const plusTag = tag.length === 0 ? undefined : tag.join("+");
  const address = `${local.toLowerCase()}@${domain}`;
  return { address, recipient: plusTag === undefined ? address : `${local.toLowerCase()}+${plusTag}@${domain}`, plusTag };
}
