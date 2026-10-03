// The inbound handler, which SES invokes, without waiting, for each message it accepts. By then SES
// has stored the raw message in the mail bucket. A failure makes Lambda retry the event, then
// leaves it in the failure queue for replay, so processing is idempotent per SES message ID.
import type { SESEvent } from "aws-lambda";
import type { Table } from "./deployment.ts";
import { inboundPrefix } from "./infrastructure.ts";
import type { MailBucket } from "./mail-bucket.ts";
import { receiveMessage } from "./mail.ts";
import { parseMail } from "./mime.ts";
import { mailboxAt } from "./organization.ts";

export function createInbound({ table, mailBucket }: { table: Table; mailBucket: MailBucket }) {
  return async (event: SESEvent): Promise<void> => {
    for (const { ses } of event.Records) {
      const rawKey = `${inboundPrefix}${ses.mail.messageId}`;
      const raw = await mailBucket.get(rawKey);
      if (raw === undefined) throw new Error(`SES stored no message at ${rawKey}.`);
      const parsed = await parseMail(raw);
      // The recipients are those the rule took. Each mailbox gets one copy, for the first of its addresses.
      const delivered = new Map<string, { recipient: string; plusTag?: string }>();
      for (const given of ses.receipt.recipients) {
        const { address, recipient, plusTag } = untagged(given);
        const mailbox = await mailboxAt(table, address);
        if (mailbox !== undefined && !delivered.has(mailbox)) delivered.set(mailbox, { recipient, plusTag });
      }
      for (const [mailbox, to] of delivered) {
        await receiveMessage(table, { mailbox, sesMessageId: ses.mail.messageId, rawKey, ...to, sender: ses.mail.source, receivedAt: ses.mail.timestamp, parsed });
      }
    }
  };
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
