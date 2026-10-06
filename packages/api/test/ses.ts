import { randomUUID } from "node:crypto";
import type { ReceiptRule } from "@aws-sdk/client-ses";
import type { SESEvent, SESReceiptStatus, SNSEvent } from "aws-lambda";
import PostalMime from "postal-mime";
import type { Dns, RecordType } from "../src/dns-records.ts";
import type { EmailIdentities } from "../src/identities.ts";
import type { MailBucket } from "../src/mail-bucket.ts";
import { BounceRefused, type Bounces } from "../src/group-mail.ts";
import type { ReceiptRules } from "../src/receiving.ts";
import { type Outbound, Refused } from "../src/sending.ts";
import type { SuppressionList, SuppressionReason } from "../src/suppression.ts";

/** The envelope SES receives a message with. */
export interface Envelope {
  /** The envelope sender, MAIL FROM. */
  from: string;
  /** The envelope recipients, RCPT TO. */
  to: string[];
}

/**
 * SES's verdicts on a message. While the rule scans, each is PASS unless given. SES names the
 * sender's DMARC policy only with a DMARC FAIL. `dkim` gives the result for each DKIM signature, by
 * its domain.
 */
export interface Verdicts {
  spam?: SESReceiptStatus["status"];
  virus?: SESReceiptStatus["status"];
  spf?: SESReceiptStatus["status"];
  dmarc?: SESReceiptStatus["status"];
  dmarcPolicy?: "none" | "quarantine" | "reject";
  dkim?: Record<string, SESReceiptStatus["status"]>;
}

/** How SES receives a message: how often Lambda runs its event, and what SES judged it to be. */
export interface ReceiveOptions {
  invocations?: number;
  verdicts?: Verdicts;
  /** When SES received the message, which is now unless given. */
  at?: Date;
}

/** A bounce SES sent for a message it received: to its envelope sender, from SES's own MAILER-DAEMON, for the recipients. */
export interface Bounce {
  /** The ID SES gave the message bounced. */
  messageId: string;
  to: string;
  /** The bounce's From, SES's MAILER-DAEMON in its region, whatever BounceSender was given. */
  from: string;
  recipients: string[];
  explanation: string;
}

/** SES's limits on a rule set: rules in it, and recipients in each rule. */
const maxRules = 200;
const maxRecipients = 500;

/**
 * Stands in for SES receiving in one region: an active rule set, which Duva manages through
 * ReceiptRules, and the mail servers that apply it. Like SES, it checks when a rule is created that
 * it can write to the rule's bucket and invoke its Lambda, which here means the harness has them.
 * It bounces a message it received back to its envelope sender, from its own MAILER-DAEMON, given a
 * BounceSender on a domain SES has verified.
 */
export function sesReceiving({ verified, region, buckets, functions }: { verified: (domain: string) => Promise<boolean>; region: string; buckets: Map<string, MailBucket>; functions: Map<string, (event: SESEvent) => Promise<void>> }) {
  const rules: ReceiptRule[] = [];
  // The envelope sender of each message SES accepted, by the ID it gave it, and the bounces it sent.
  const senders = new Map<string, string>();
  const bounced: Bounce[] = [];

  const check = (rule: ReceiptRule) => {
    if ((rule.Recipients ?? []).length > maxRecipients) throw new Error(`Rule ${rule.Name} has more than ${maxRecipients} recipients.`);
    for (const { S3Action, LambdaAction } of rule.Actions ?? []) {
      if (S3Action && !buckets.has(S3Action.BucketName!)) throw new Error(`Could not write to bucket: ${S3Action.BucketName}`);
      if (LambdaAction && !functions.has(LambdaAction.FunctionArn!)) throw new Error(`Could not invoke Lambda function: ${LambdaAction.FunctionArn}`);
    }
  };

  const ruleSet: ReceiptRules = {
    async list() {
      return structuredClone(rules);
    },
    async create(rule, after) {
      if (rules.some(({ Name }) => Name === rule.Name)) return false;
      if (rules.length === maxRules) throw new Error(`The rule set has ${maxRules} rules.`);
      const index = after === undefined ? 0 : rules.findIndex(({ Name }) => Name === after) + 1;
      if (index === 0 && after !== undefined) return false;
      check(rule);
      rules.splice(index, 0, structuredClone(rule));
      return true;
    },
    async update(rule) {
      const index = rules.findIndex(({ Name }) => Name === rule.Name);
      if (index < 0) return;
      check(rule);
      rules[index] = structuredClone(rule);
    },
    async delete(name) {
      const index = rules.findIndex(({ Name }) => Name === name);
      if (index >= 0) rules.splice(index, 1);
    },
  };

  const bounces: Bounces = {
    async send({ messageId, bounceSender, recipients, explanation }) {
      const to = senders.get(messageId);
      if (to === undefined) throw new BounceRefused(`Message ${messageId} was not received by Amazon SES.`);
      if (!(await verified(bounceSender.split("@")[1]?.toLowerCase() ?? ""))) throw new BounceRefused(`Email address is not verified: ${bounceSender}`);
      if (recipients.length === 0) throw new BounceRefused("Specify at least one BouncedRecipientInfo.");
      bounced.push({ messageId, to, from: `MAILER-DAEMON@${region}.amazonses.com`, recipients: [...recipients], explanation });
    },
  };

  return {
    rules: ruleSet,
    bounces,
    /** The bounces SES sent for messages it received, oldest first. */
    bounced: () => structuredClone(bounced),
    /** The rules in the rule set, in order, as SES describes them. */
    describeRules: () => structuredClone(rules),
    /**
     * Receives the raw message over SMTP. SES refuses each recipient no enabled rule matches,
     * during delivery. For the others, it applies each matching rule's actions in order, in the
     * rules' order, with the receipt naming the recipients the rule matched. A
     * Lambda action invokes the function `invocations` times, as Lambda's retries of an
     * asynchronous invocation can, and here waits for it. The receipt carries the verdicts. Returns
     * the ID SES gave the message, if it accepted any recipient.
     */
    async receive(
      raw: string | Uint8Array,
      envelope: Envelope,
      { invocations = 1, verdicts = {}, at = new Date() }: ReceiveOptions = {},
    ): Promise<{ refused: string[]; messageId?: string }> {
      const matching = (recipient: string) => rules.filter((rule) => rule.Enabled && matches(rule, recipient));
      const refused = envelope.to.filter((recipient) => matching(recipient).length === 0);
      const accepted = envelope.to.filter((recipient) => matching(recipient).length > 0);
      if (accepted.length === 0) return { refused };

      const bytes = typeof raw === "string" ? new TextEncoder().encode(raw) : raw;
      const messageId = randomUUID().replaceAll("-", "");
      senders.set(messageId, envelope.from);
      const timestamp = at.toISOString();
      const parsed = await PostalMime.parse(bytes);
      // Each rule acts on the recipients it matches, all with the one message ID.
      for (const rule of rules.filter((each) => each.Enabled)) {
        const recipients = accepted.filter((recipient) => matching(recipient).includes(rule));
        if (recipients.length === 0) continue;
        const verdict = (given: SESReceiptStatus["status"] | undefined): SESReceiptStatus => ({ status: rule.ScanEnabled ? (given ?? "PASS") : "DISABLED" });
        const stored = rule.ScanEnabled ? withVerdicts(bytes, parsed, envelope, verdicts) : bytes;
        for (const { S3Action, LambdaAction } of rule.Actions ?? []) {
          if (S3Action) await buckets.get(S3Action.BucketName!)!.put(`${S3Action.ObjectKeyPrefix ?? ""}${messageId}`, stored);
          if (LambdaAction) {
            const event: SESEvent = {
              Records: [
                {
                  eventSource: "aws:ses",
                  eventVersion: "1.0",
                  ses: {
                    mail: {
                      timestamp,
                      source: envelope.from,
                      messageId,
                      destination: envelope.to,
                      headersTruncated: false,
                      headers: parsed.headers.map(({ originalKey, value }) => ({ name: originalKey, value })),
                      commonHeaders: {
                        returnPath: envelope.from,
                        // As written, display name included.
                        from: parsed.headers.filter(({ key }) => key === "from").map(({ value }) => value),
                        date: parsed.date ?? "",
                        to: parsed.to?.map(({ address }) => String(address)),
                        messageId: parsed.messageId ?? "",
                        subject: parsed.subject,
                      },
                    },
                    receipt: {
                      timestamp,
                      processingTimeMillis: 1,
                      recipients,
                      spamVerdict: verdict(verdicts.spam),
                      virusVerdict: verdict(verdicts.virus),
                      spfVerdict: verdict(verdicts.spf),
                      dkimVerdict: verdict(undefined),
                      dmarcVerdict: verdict(verdicts.dmarc),
                      ...(rule.ScanEnabled && verdicts.dmarc === "FAIL" ? { dmarcPolicy: verdicts.dmarcPolicy } : {}),
                      action: { type: "Lambda", functionArn: LambdaAction.FunctionArn!, invocationType: LambdaAction.InvocationType ?? "Event" },
                    },
                  },
                },
              ],
            };
            const invoke = functions.get(LambdaAction.FunctionArn!)!;
            for (let invocation = 0; invocation < invocations; invocation++) await invoke(structuredClone(event));
          }
        }
      }
      return { refused, messageId };
    },
  };
}

/**
 * The message as SES stores it when its rule scans: headed by its verdicts, and an
 * Authentication-Results with a result for each DKIM signature, which names it by its domain.
 */
function withVerdicts(raw: Uint8Array, parsed: Awaited<ReturnType<typeof PostalMime.parse>>, envelope: Envelope, verdicts: Verdicts): Uint8Array {
  const result = (status: SESReceiptStatus["status"] = "PASS") => ({ PASS: "pass", FAIL: "fail", GRAY: "neutral", PROCESSING_FAILED: "temperror", DISABLED: "none" })[status];
  const signers = parsed.headers.filter(({ key }) => key === "dkim-signature").map(({ value }) => /(?:^|;)\s*d\s*=\s*([^;\s]+)/.exec(value)?.[1]?.toLowerCase() ?? "");
  const fromDomain = parsed.from?.address?.split("@")[1] ?? "";
  const header = [
    `X-SES-Spam-Verdict: ${verdicts.spam ?? "PASS"}`,
    `X-SES-Virus-Verdict: ${verdicts.virus ?? "PASS"}`,
    "Authentication-Results: amazonses.com;",
    ` spf=pass smtp.mailfrom=${envelope.from};`,
    ...(signers.length === 0 ? [" dkim=none;"] : signers.map((domain) => ` dkim=${result(verdicts.dkim?.[domain])} header.i=@${domain};`)),
    ` dmarc=${result(verdicts.dmarc)} header.from=${fromDomain};`,
    "",
  ].join("\r\n");
  const head = new TextEncoder().encode(header);
  const stored = new Uint8Array(head.length + raw.length);
  stored.set(head);
  stored.set(raw, head.length);
  return stored;
}

/**
 * Whether the rule takes mail for the recipient. A rule without recipients takes every address on
 * the account's verified domains. A listed address also takes its plus-tagged addresses, and a
 * listed domain every address on it.
 */
function matches(rule: ReceiptRule, recipient: string): boolean {
  if (rule.Recipients === undefined || rule.Recipients.length === 0) return true;
  const address = recipient.toLowerCase();
  const [local = "", domain = ""] = address.split("@");
  const untagged = `${local.split("+")[0]}@${domain}`;
  return rule.Recipients.some((listed) => {
    const wanted = listed.toLowerCase();
    return wanted.includes("@") ? wanted === address || wanted === untagged : wanted === domain;
  });
}

/**
 * What SES reports about a message it sent, after accepting it: a bounce from a recipient's server,
 * a complaint from a recipient, or a reject, when SES doesn't send it after all. A bounce or
 * complaint concerns the recipients given, or all of the message's.
 */
export type SendingEvent =
  | { type: "Bounce"; bounceType: "Permanent" | "Transient" | "Undetermined"; bounceSubType?: string; recipients?: string[] }
  | { type: "Complaint"; complaintFeedbackType?: string; recipients?: string[] }
  | { type: "Reject"; reason?: string };

/**
 * How SES publishes an event: `at` the time, or now, and through SNS, which delivers it `deliveries`
 * times. With `again`, SNS delivers the event last published for the message once more instead, as
 * a late redelivery or a replay from the failure queue does.
 */
export interface PublishOptions {
  at?: Date;
  deliveries?: number;
  again?: boolean;
}

/**
 * Stands in for SES sending in one region, recording each raw message it accepts as its recipients
 * get it, and the recipients it delivers it to: those the call's destination names, Bcc included,
 * which no header shows. Like SES, it gives each message an ID, answers with it, and replaces the message's
 * Message-ID with <ID@region.amazonses.com>. It sends only from a domain SES has verified, and in
 * the sandbox SES refuses a message to anyone not on one, with SES's reason. With `answersLost`,
 * SES accepts each message but its answer never arrives, as when the connection drops. Every send
 * goes through Duva's configuration set, which publishes its bounces, complaints and rejects to
 * an SNS topic that invokes `subscriber`. As the account is set to, SES puts each address that
 * hard-bounces or complains on its suppression list, and accepts a message for an address there
 * but doesn't deliver it to them. SES then publishes a hard bounce for it, which here a test
 * publishes.
 */
export function sesSending({
  region,
  verified,
  sandbox,
  answersLost,
  subscriber,
}: {
  region: string;
  verified: (domain: string) => Promise<boolean>;
  sandbox: boolean;
  answersLost: boolean;
  subscriber: (event: SNSEvent) => Promise<void>;
}) {
  const accepted: { raw: string; recipients: string[]; delivered: string[]; messageId: string; source: string; timestamp: string }[] = [];
  // The account's suppression list, by address in lower case, with why SES put each there.
  const suppressed = new Map<string, SuppressionReason>();
  const suppress = (addresses: string[], reason: SuppressionReason) => {
    for (const address of addresses) suppressed.set(address.toLowerCase(), reason);
  };
  const suppressionList: SuppressionList = {
    async list() {
      return [...suppressed.keys()];
    },
    async remove(address) {
      suppressed.delete(address.toLowerCase());
    },
  };
  // The notification last published for each message, by the ID SES gave it.
  const published = new Map<string, SNSEvent>();
  const outbound: Outbound = {
    async send(raw, destination) {
      const parsed = await PostalMime.parse(raw);
      const from = parsed.from?.address ?? "";
      const recipients = [...destination.to, ...destination.cc, ...destination.bcc];
      const addresses = [from, ...(sandbox ? recipients : [])];
      const checked = await Promise.all(addresses.map((address) => verified(address.split("@")[1]?.toLowerCase() ?? "")));
      const unverified = addresses.filter((_, index) => !checked[index]);
      if (unverified.length > 0) {
        throw new Refused(`Email address is not verified. The following identities failed the check in region ${region.toUpperCase()}: ${unverified.join(", ")}`);
      }
      const messageId = `0110019${randomUUID().replaceAll("-", "").slice(0, 9)}-${randomUUID()}-000000`;
      const [head = "", ...body] = new TextDecoder().decode(raw).split("\r\n\r\n");
      const fields = head.split(/\r\n(?![ \t])/).filter((field) => !/^message-id:/i.test(field));
      accepted.push({
        raw: [[...fields, `Message-ID: <${messageId}@${region}.amazonses.com>`].join("\r\n"), ...body].join("\r\n\r\n"),
        recipients,
        delivered: recipients.filter((recipient) => !suppressed.has(recipient.toLowerCase())),
        messageId,
        source: from,
        timestamp: new Date().toISOString(),
      });
      if (answersLost) throw new Error("socket hang up");
      return messageId;
    },
  };
  return {
    outbound,
    suppressionList,
    /** The addresses on the account's suppression list, in alphabetical order, with why SES put each there. */
    suppressed: () => [...suppressed].sort(([a], [b]) => a.localeCompare(b)).map(([address, reason]) => ({ address, reason })),
    /** The raw messages SES accepted, as their recipients get them, oldest first. */
    sent: () => accepted.map(({ raw }) => raw),
    /** The recipients SES delivered each message in sent() to, in the same order: none on its suppression list. */
    sentTo: () => accepted.map(({ delivered }) => [...delivered]),
    /**
     * Publishes the event for the message SES sent with the ID, as SES's event publishing writes it
     * to the topic, and has SNS deliver it to the subscriber.
     */
    async publish(messageId: string, event: SendingEvent, { at = new Date(), deliveries = 1, again = false }: PublishOptions = {}) {
      const last = published.get(messageId);
      if (again) {
        if (last === undefined) throw new Error(`SES published no event for the message ${messageId}.`);
        await subscriber(structuredClone(last));
        return;
      }
      const message = accepted.find((each) => each.messageId === messageId);
      if (message === undefined) throw new Error(`SES sent no message with the ID ${messageId}.`);
      const timestamp = at.toISOString();
      const concerned = (given: string[] | undefined) => given ?? message.recipients;
      const feedbackId = `0110019${randomUUID().replaceAll("-", "").slice(0, 9)}-${randomUUID()}-000000`;
      const details =
        event.type === "Bounce"
          ? {
              bounce: {
                bounceType: event.bounceType,
                bounceSubType: event.bounceSubType ?? (event.bounceType === "Undetermined" ? "Undetermined" : "General"),
                bouncedRecipients: concerned(event.recipients).map((emailAddress) =>
                  event.bounceType === "Permanent"
                    ? { emailAddress, action: "failed", status: "5.1.1", diagnosticCode: "smtp; 550 5.1.1 user unknown" }
                    : { emailAddress },
                ),
                timestamp,
                feedbackId,
                reportingMTA: "dsn; mx.example.net",
              },
            }
          : event.type === "Complaint"
            ? {
                complaint: {
                  complainedRecipients: concerned(event.recipients).map((emailAddress) => ({ emailAddress })),
                  timestamp,
                  feedbackId,
                  ...(event.complaintFeedbackType !== undefined && { complaintFeedbackType: event.complaintFeedbackType }),
                },
              }
            : { reject: { reason: event.reason ?? "Bad content" } };
      const sesEvent = {
        eventType: event.type,
        mail: {
          timestamp: event.type === "Reject" ? timestamp : message.timestamp,
          source: message.source,
          sendingAccountId: "123456789012",
          messageId,
          destination: [...message.recipients],
          headersTruncated: false,
          tags: { "ses:configuration-set": ["duva-sending"] },
        },
        ...details,
      };
      const notification: SNSEvent = {
        Records: [
          {
            EventSource: "aws:sns",
            EventVersion: "1.0",
            EventSubscriptionArn: `arn:aws:sns:${region}:123456789012:duva-feedback:${randomUUID()}`,
            Sns: {
              Type: "Notification",
              MessageId: randomUUID(),
              TopicArn: `arn:aws:sns:${region}:123456789012:duva-feedback`,
              Subject: "",
              Message: JSON.stringify(sesEvent),
              Timestamp: new Date().toISOString(),
              SignatureVersion: "1",
              Signature: "",
              SigningCertUrl: "",
              UnsubscribeUrl: "",
              MessageAttributes: {},
            },
          },
        ],
      };
      published.set(messageId, notification);
      if (event.type === "Bounce" && event.bounceType === "Permanent") suppress(concerned(event.recipients), "BOUNCE");
      if (event.type === "Complaint") suppress(concerned(event.recipients), "COMPLAINT");
      for (let delivery = 0; delivery < deliveries; delivery++) await subscriber(structuredClone(notification));
    },
  };
}

/** DNS, where admins add records at their DNS provider, with no records until they do. */
export function memoryDns(): Dns & { set(type: RecordType, name: string, values: string[]): void } {
  const records = new Map<string, string[]>();
  return {
    async resolve(type, name) {
      return records.get(`${type} ${name.toLowerCase()}`) ?? [];
    },
    set(type, name, values) {
      records.set(`${type} ${name.toLowerCase()}`, values);
    },
  };
}

/** A domain's identity as SES keeps it. */
export interface StoredIdentity {
  domain: string;
  configurationSet?: string;
  mailFromDomain?: string;
  dkimTokens: string[];
}

/**
 * Stands in for SES's domain identities in one region. SES gives each new identity three DKIM
 * tokens, and verifies its DKIM once DNS has their CNAME records and its MAIL FROM domain once DNS
 * has its MX record. Here it checks when asked, where SES checks on its own every so often. The
 * domains in `verified` have identities SES verified already, as deploy's first domain does, and
 * those in `others` have identities someone other than Duva created.
 */
export function sesIdentities({ region, dns, verified, others, configurationSet }: { region: string; dns: Dns; verified: string[]; others: string[]; configurationSet: string }) {
  const identities = new Map<string, StoredIdentity & { alwaysVerified: boolean }>();
  for (const domain of others) identities.set(domain, { domain, dkimTokens: tokens(), alwaysVerified: false });
  for (const domain of verified) {
    identities.set(domain, { domain, configurationSet, mailFromDomain: `mail.${domain}`, dkimTokens: tokens(), alwaysVerified: true });
  }
  const dkimVerified = async ({ domain, dkimTokens, alwaysVerified }: StoredIdentity & { alwaysVerified: boolean }) => {
    if (alwaysVerified) return true;
    const found = await Promise.all(dkimTokens.map((token) => dns.resolve("CNAME", `${token}._domainkey.${domain}`)));
    return found.every((values, index) => values.includes(`${dkimTokens[index]}.dkim.amazonses.com`));
  };
  const mailFromVerified = async ({ mailFromDomain, alwaysVerified }: StoredIdentity & { alwaysVerified: boolean }) =>
    alwaysVerified || (mailFromDomain !== undefined && (await dns.resolve("MX", mailFromDomain)).some((value) => value.endsWith(`feedback-smtp.${region}.amazonses.com`)));
  const service: EmailIdentities = {
    async create(domain) {
      if (!identities.has(domain)) identities.set(domain, { domain, configurationSet, dkimTokens: tokens(), alwaysVerified: false });
      identities.get(domain)!.mailFromDomain = `mail.${domain}`;
    },
    async get(domain) {
      const identity = identities.get(domain);
      if (identity === undefined) return undefined;
      const dkim = await dkimVerified(identity);
      return {
        verified: dkim,
        dkimStatus: dkim ? "SUCCESS" : "PENDING",
        dkimTokens: [...identity.dkimTokens],
        mailFromStatus: identity.mailFromDomain === undefined ? "NOT_STARTED" : (await mailFromVerified(identity)) ? "SUCCESS" : "PENDING",
      };
    },
    async delete(domain) {
      identities.delete(domain);
    },
  };
  return {
    service,
    /** Whether SES has verified the domain's identity. */
    verified: async (domain: string) => (await service.get(domain))?.verified ?? false,
    /** The identities SES has, by domain in alphabetical order. */
    identities: (): StoredIdentity[] =>
      [...identities.values()].sort((a, b) => a.domain.localeCompare(b.domain)).map(({ alwaysVerified: _, dkimTokens, ...identity }) => ({ ...identity, dkimTokens: [...dkimTokens] })),
  };
}

/** Three DKIM tokens, as SES gives a new identity. */
const tokens = () => [1, 2, 3].map(() => randomUUID().replaceAll("-", ""));
