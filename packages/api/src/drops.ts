// Mail Duva drops on arrival: a virus, or a DMARC failure from a domain whose policy is reject.
// Each drop is one log line in CloudWatch's embedded metric format, so CloudWatch counts it in
// Duva's metric by reason. The line keeps envelope-level facts only, never the subject, the body,
// an attachment or any address's local part.
import type { SESMail, SESReceipt } from "aws-lambda";
import { dropMetric, type dropReasons } from "./infrastructure.ts";

export type DropReason = (typeof dropReasons)[number];

/** Why the message is dropped, or undefined if it isn't. DMARC policies are compared in any case (see docs/aws.md). */
export function dropReason({ virusVerdict, dmarcVerdict, dmarcPolicy }: SESReceipt): DropReason | undefined {
  if (virusVerdict.status === "FAIL") return "virus";
  if (dmarcVerdict.status === "FAIL" && dmarcPolicy?.toLowerCase() === "reject") return "dmarcReject";
  return undefined;
}

/** The log line recording a drop, for the mailboxes the message was for. */
export function dropLogLine(reason: DropReason, { mail, receipt }: { mail: SESMail; receipt: SESReceipt }, mailboxes: string[]): string {
  return JSON.stringify({
    _aws: {
      // When Duva dropped it. CloudWatch takes no metric more than 14 days old, as a replay from the failure queue can be.
      Timestamp: Date.now(),
      CloudWatchMetrics: [{ Namespace: dropMetric.namespace, Dimensions: [[dropMetric.dimension]], Metrics: [{ Name: dropMetric.name, Unit: "Count" }] }],
    },
    [dropMetric.dimension]: reason,
    [dropMetric.name]: 1,
    message: "Dropped a message on arrival.",
    sesMessageId: mail.messageId,
    mailboxes,
    envelopeDomain: domainOf(mail.source),
    fromDomains: (mail.commonHeaders.from ?? []).flatMap((from) => domainOf(from) ?? []),
    dmarcPolicy: receipt.dmarcPolicy?.toLowerCase(),
    verdicts: {
      spf: receipt.spfVerdict.status,
      dkim: receipt.dkimVerdict.status,
      dmarc: receipt.dmarcVerdict.status,
      spam: receipt.spamVerdict.status,
      virus: receipt.virusVerdict.status,
    },
  });
}

/** The domain of an address, as in `Name <local@domain>` or `local@domain`, or undefined if it has none that is a plain domain name. */
function domainOf(address: string): string | undefined {
  const bare = /<([^>]*)>\s*$/.exec(address)?.[1] ?? address;
  const domain = bare.slice(bare.lastIndexOf("@") + 1).trim().toLowerCase();
  return bare.includes("@") && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain) ? domain : undefined;
}
