import { randomUUID } from "node:crypto";
import type { ReceiptRule } from "@aws-sdk/client-ses";
import type { SESEvent, SESReceiptStatus } from "aws-lambda";
import PostalMime from "postal-mime";
import type { MailBucket } from "../src/mail-bucket.ts";
import type { ReceiptRules } from "../src/receiving.ts";

/** The envelope SES receives a message with. */
export interface Envelope {
  /** The envelope sender, MAIL FROM. */
  from: string;
  /** The envelope recipients, RCPT TO. */
  to: string[];
}

/**
 * Stands in for SES receiving in one region: an active rule set, which Duva manages through
 * ReceiptRules, and the mail servers that apply it. Like SES, it checks when a rule is created that
 * it can write to the rule's bucket and invoke its Lambda, which here means the harness has them.
 */
export function sesReceiving({ buckets, functions }: { buckets: Map<string, MailBucket>; functions: Map<string, (event: SESEvent) => Promise<void>> }) {
  const rules: ReceiptRule[] = [];

  const check = (rule: ReceiptRule) => {
    for (const { S3Action, LambdaAction } of rule.Actions ?? []) {
      if (S3Action && !buckets.has(S3Action.BucketName!)) throw new Error(`Could not write to bucket: ${S3Action.BucketName}`);
      if (LambdaAction && !functions.has(LambdaAction.FunctionArn!)) throw new Error(`Could not invoke Lambda function: ${LambdaAction.FunctionArn}`);
    }
  };

  const ruleSet: ReceiptRules = {
    async describe(name) {
      return structuredClone(rules.find((rule) => rule.Name === name));
    },
    async create(rule) {
      if (rules.some(({ Name }) => Name === rule.Name)) return false;
      check(rule);
      rules.push(structuredClone(rule));
      return true;
    },
    async update(rule) {
      const index = rules.findIndex(({ Name }) => Name === rule.Name);
      if (index < 0) throw new Error(`Rule does not exist: ${rule.Name}`);
      check(rule);
      rules[index] = structuredClone(rule);
    },
  };

  return {
    rules: ruleSet,
    /** The rules in the rule set, in order, as SES describes them. */
    describeRules: () => structuredClone(rules),
    /**
     * Receives the raw message over SMTP. SES refuses each recipient no enabled rule matches,
     * during delivery. For the others, it applies the first matching rule's actions in order. A
     * Lambda action invokes the function `invocations` times, as Lambda's retries of an
     * asynchronous invocation can, and here waits for it.
     */
    async receive(raw: string | Uint8Array, envelope: Envelope, { invocations = 1 } = {}): Promise<{ refused: string[] }> {
      const matching = (recipient: string) => rules.find((rule) => rule.Enabled && matches(rule, recipient));
      const refused = envelope.to.filter((recipient) => matching(recipient) === undefined);
      const accepted = envelope.to.filter((recipient) => matching(recipient) !== undefined);
      if (accepted.length === 0) return { refused };

      const bytes = typeof raw === "string" ? new TextEncoder().encode(raw) : raw;
      const rule = matching(accepted[0]!)!;
      const recipients = accepted.filter((recipient) => matching(recipient) === rule);
      const messageId = randomUUID().replaceAll("-", "");
      const timestamp = new Date().toISOString();
      const verdict: SESReceiptStatus = { status: rule.ScanEnabled ? "PASS" : "DISABLED" };
      const parsed = await PostalMime.parse(bytes);
      for (const { S3Action, LambdaAction } of rule.Actions ?? []) {
        if (S3Action) await buckets.get(S3Action.BucketName!)!.put(`${S3Action.ObjectKeyPrefix ?? ""}${messageId}`, bytes);
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
                      from: parsed.from ? [String(parsed.from.address)] : undefined,
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
                    spamVerdict: verdict,
                    virusVerdict: verdict,
                    spfVerdict: verdict,
                    dkimVerdict: verdict,
                    dmarcVerdict: verdict,
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
      return { refused };
    },
  };
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
