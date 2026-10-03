// Duva's receipt rule, which tells SES which addresses to accept mail for and what to do with it.
// The organization's addresses are the source of truth, and the rule follows them at run time.
import {
  AlreadyExistsException,
  CreateReceiptRuleCommand,
  DescribeReceiptRuleCommand,
  type ReceiptRule,
  RuleDoesNotExistException,
  type SESClient,
  UpdateReceiptRuleCommand,
} from "@aws-sdk/client-ses";
import type { Table } from "./deployment.ts";
import { inboundPrefix, receiptRuleName } from "./infrastructure.ts";
import { allAddresses } from "./organization.ts";

/** Duva's receipt rule set in SES, or a stand-in in tests. */
export interface ReceiptRules {
  /** The rule with the name, as SES holds it, or undefined if there is none. */
  describe(name: string): Promise<ReceiptRule | undefined>;
  /** Creates the rule. Returns false if one with its name already exists. */
  create(rule: ReceiptRule): Promise<boolean>;
  /** Replaces the rule with the same name. */
  update(rule: ReceiptRule): Promise<void>;
}

/** Where received mail goes. */
export interface Receiving {
  rules: ReceiptRules;
  /** The mail bucket's name. SES stores each message there before Duva sees it. */
  bucket: string;
  /** The ARN of the inbound Lambda, which SES invokes for each message. */
  inboundFunction: string;
}

/**
 * Duva's receipt rule for the recipients. SES refuses mail to any other address during delivery,
 * so Duva never has to bounce it. Scanning is on explicitly, since the docs disagree about its
 * default. SES stores the message first, then invokes the inbound Lambda without waiting for it.
 */
export const receiptRule = ({ bucket, inboundFunction }: Receiving, recipients: string[]): ReceiptRule => ({
  Name: receiptRuleName,
  Enabled: true,
  ScanEnabled: true,
  TlsPolicy: "Optional",
  Recipients: recipients,
  Actions: [
    { S3Action: { BucketName: bucket, ObjectKeyPrefix: inboundPrefix } },
    { LambdaAction: { FunctionArn: inboundFunction, InvocationType: "Event" } },
  ],
});

/**
 * Makes the receipt rule list every address, creating it with the first one. SES can't update a
 * rule conditionally, so two changes at the same time may each write what they read. Each writes
 * every address there is, then checks, until the rule lists them all.
 */
export async function syncRecipients(table: Table, receiving: Receiving): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    const addresses = (await allAddresses(table)).sort();
    // A rule without recipients would accept mail to every address on the domain.
    if (addresses.length === 0) return;
    const rule = await receiving.rules.describe(receiptRuleName);
    const listed = [...(rule?.Recipients ?? [])].sort();
    if (rule !== undefined && listed.join() === addresses.join()) return;
    if (attempt === 10) throw new Error("SES's receipt rule kept changing while Duva updated it, so mail to the newest addresses may be refused. Creating another address updates it again.");
    if (rule === undefined) await receiving.rules.create(receiptRule(receiving, addresses));
    else await receiving.rules.update(receiptRule(receiving, addresses));
  }
}

/** The rule set in SES. */
export function sesReceiptRules(ses: SESClient, ruleSet: string): ReceiptRules {
  return {
    async describe(name) {
      try {
        return (await ses.send(new DescribeReceiptRuleCommand({ RuleSetName: ruleSet, RuleName: name }))).Rule;
      } catch (error) {
        if (error instanceof RuleDoesNotExistException) return undefined;
        throw error;
      }
    },
    async create(rule) {
      try {
        await ses.send(new CreateReceiptRuleCommand({ RuleSetName: ruleSet, Rule: rule }));
        return true;
      } catch (error) {
        if (error instanceof AlreadyExistsException) return false;
        throw error;
      }
    },
    async update(rule) {
      await ses.send(new UpdateReceiptRuleCommand({ RuleSetName: ruleSet, Rule: rule }));
    },
  };
}
