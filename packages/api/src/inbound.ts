// The inbound handler, which SES invokes, without waiting, for each message it accepts. By then SES
// has stored the raw message in the mail bucket. A failure makes Lambda retry the event, then
// leaves it in the failure queue for replay, so processing is idempotent per SES message ID.
// Only FAIL verdicts act. GRAY and PROCESSING_FAILED count as passes. Mail to a group goes to its
// members, as group-mail.ts has it.
import type { SESEvent } from "aws-lambda";
import type { Table } from "./deployment.ts";
import { dropLogLine, dropReason } from "./drops.ts";
import { inboundPrefix } from "./infrastructure.ts";
import type { MailBucket } from "./mail-bucket.ts";
import { parseMail } from "./mime.ts";
import { bounceOnce, type Bounces, type Expanded, expand, type GroupRefusal, isOwnMail, refusalOf, resendToExternalMembers, type Sender } from "./group-mail.ts";
import { addressTarget, allDomains, type Group } from "./organization.ts";
import type { Outbound } from "./sending.ts";
import { receiveScreened } from "./screening.ts";

/**
 * What the inbound handler needs: the table, the mail bucket, its log, which takes one line at a
 * time, SES's sending, for groups' external members, and its bounces, for mail a group refuses.
 */
export function createInbound({ table, mailBucket, log, outbound, bounces }: { table: Table; mailBucket: MailBucket; log: (line: string) => void; outbound: Outbound; bounces: Bounces }) {
  return async (event: SESEvent): Promise<void> => {
    for (const { ses } of event.Records) {
      const rawKey = `${inboundPrefix}${ses.mail.messageId}`;
      const domains = new Set((await allDomains(table)).map(({ domain }) => domain));
      // The recipients are those the rule took. Each mailbox gets one copy: for the first of its own
      // addresses, or else as a member of the first group that reaches it.
      const direct = new Map<string, Recipient>();
      const groups: (Recipient & { group: Group; expanded: Expanded })[] = [];
      for (const given of ses.receipt.recipients) {
        const { address, ...recipient } = untagged(given);
        const target = await addressTarget(table, address);
        if (target === undefined) continue;
        if ("mailbox" in target) {
          if (!direct.has(target.mailbox)) direct.set(target.mailbox, recipient);
        } else if (!groups.some(({ group }) => group.address === target.group.address)) {
          groups.push({ ...recipient, group: target.group, expanded: await expand(table, target.group, domains) });
        }
      }
      // SES has already accepted the message, so dropping it sends no bounce, and leaves no trace in
      // the mailbox. A repeat of the event finds nothing left to erase, so it isn't counted again.
      const reason = dropReason(ses.receipt);
      if (reason !== undefined) {
        const mailboxes = new Set([...direct.keys(), ...groups.flatMap(({ expanded }) => [...expanded.mailboxes])]);
        if (await mailBucket.erase(rawKey)) log(dropLogLine(reason, ses, [...mailboxes]));
        continue;
      }
      const spam = ses.receipt.spamVerdict.status === "FAIL";
      const dmarcPassed = ses.receipt.dmarcVerdict.status === "PASS";
      const raw = await mailBucket.get(rawKey);
      if (raw === undefined) throw new Error(`SES stored no message at ${rawKey}.`);
      const parsed = await parseMail(raw);
      const sender: Sender = { from: (parsed.from?.address ?? ses.mail.source).toLowerCase(), dmarc: ses.receipt.dmarcVerdict.status };
      const delivered = new Map<string, Recipient & { group?: string }>(direct);
      const refused: GroupRefusal[] = [];
      const taken: typeof groups = [];
      for (const each of groups) {
        // The group's own copy coming back has already reached its members.
        if (isOwnMail(each.group, sender)) continue;
        const explanation = refusalOf(each.group, each.expanded, sender, domains);
        if (explanation !== undefined) {
          refused.push({ recipient: each.recipient, group: each.group.address, explanation });
          continue;
        }
        taken.push(each);
        for (const mailbox of each.expanded.mailboxes) if (!delivered.has(mailbox)) delivered.set(mailbox, { recipient: each.recipient, plusTag: each.plusTag, group: each.group.address });
      }
      for (const [mailbox, to] of delivered) {
        await receiveScreened(table, { mailbox, sesMessageId: ses.mail.messageId, rawKey, ...to, sender: ses.mail.source, receivedAt: ses.mail.timestamp, parsed, spam, dmarcPassed });
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
