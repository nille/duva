// Duva's receipt rules, which tell SES which addresses to accept mail for and what to do with it.
// The organization's addresses are the source of truth, and the rules follow them at run time.
import {
  AlreadyExistsException,
  CreateReceiptRuleCommand,
  DeleteReceiptRuleCommand,
  DescribeReceiptRuleSetCommand,
  type ReceiptRule,
  RuleDoesNotExistException,
  type SESClient,
  UpdateReceiptRuleCommand,
} from "@aws-sdk/client-ses";
import type { Table } from "./deployment.ts";
import { inboundPrefix, receiptRuleName, receiptRuleNumber, recipientsPerRule } from "./infrastructure.ts";
import { allDomains, catchAllTarget, receivingAddresses } from "./organization.ts";
import type { SuppressionList } from "./suppression.ts";

/** Duva's receipt rule set in SES, or a stand-in in tests. */
export interface ReceiptRules {
  /** The rules in the rule set, in order, as SES holds them. */
  list(): Promise<ReceiptRule[]>;
  /** Creates the rule after the one named, or first without one. Returns false if one with its name already exists. */
  create(rule: ReceiptRule, after: string | undefined): Promise<boolean>;
  /** Replaces the rule with the same name, if there is one. */
  update(rule: ReceiptRule): Promise<void>;
  /** Deletes the rule with the name, if there is one. */
  delete(name: string): Promise<void>;
}

/** Where received mail goes. */
export interface Receiving {
  rules: ReceiptRules;
  /** The mail bucket's name. SES stores each message there before Duva sees it. */
  bucket: string;
  /** The ARN of the inbound Lambda, which SES invokes for each message. */
  inboundFunction: string;
  /** SES's suppression list, which an address the rules start listing is taken off. */
  suppressionList: SuppressionList;
}

/** How many receipt rules SES takes in one rule set (docs/aws.md). */
export const rulesPerSet = 200;

/**
 * How many addresses the organization can receive mail for, those alias domains mirror included,
 * as many as its rule set can list. A domain with a catch-all takes one of them.
 */
export const maxAddresses = recipientsPerRule * rulesPerSet;

/**
 * What Duva's receipt rules list: every address SES receives mail for, and each domain with a
 * catch-all, with its alias domains, since SES takes mail for every address on a listed domain.
 */
export async function ruleRecipients(table: Table): Promise<string[]> {
  const [addresses, domains] = await Promise.all([receivingAddresses(table), allDomains(table)]);
  // One whose mailbox or group is gone would take mail no one gets.
  const withCatchAll = new Set<string>();
  for (const { domain, catchAll } of domains) if ((await catchAllTarget(table, catchAll)) !== undefined) withCatchAll.add(domain);
  const catchAllDomains = domains.filter(({ domain, aliasOf }) => withCatchAll.has(aliasOf ?? domain)).map(({ domain }) => domain);
  return [...addresses.map(({ address }) => address), ...catchAllDomains];
}

/**
 * The recipients among those given that are the organization's: those Duva's receipt rules take
 * mail for, as an address, its plus-tagged addresses, or one on a domain with a catch-all.
 */
export async function localRecipients(table: Table, recipients: string[]): Promise<string[]> {
  const listed = new Set(await ruleRecipients(table));
  return recipients.filter((recipient) => rulesTake(listed, recipient));
}

/** Whether rules listing the recipients take mail for the address, as SES matches them. */
export function rulesTake(listed: Set<string>, address: string): boolean {
  const lower = address.toLowerCase();
  return listed.has(lower) || listed.has(lower.replace(/\+[^@]*@/, "@")) || listed.has(lower.slice(lower.lastIndexOf("@") + 1));
}

/** The name of Duva's nth rule for addresses, counting from 1. The first keeps the name it had when there was one. */
const ruleName = (number: number) => (number === 1 ? receiptRuleName : `${receiptRuleName}-${number}`);

/**
 * A receipt rule for the recipients. SES refuses mail to any other address during delivery,
 * so Duva never has to bounce it. Scanning is on explicitly, since the docs disagree about its
 * default. SES stores the message first, then invokes the inbound Lambda without waiting for it.
 */
export const receiptRule = ({ bucket, inboundFunction }: Receiving, name: string, recipients: string[]): ReceiptRule => ({
  Name: name,
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
 * Makes Duva's receipt rules list every address, and each domain with a catch-all, once, each rule at most recipientsPerRule of them.
 * An address stays in the rule that lists it, so mail to it is never refused while rules change. A
 * new one goes in the first rule with room, or a new rule after the others, and an emptied rule is
 * deleted, since a rule without recipients would accept mail to every address on the domain. SES
 * can't update a rule conditionally, so two changes at the same time may each write what they read.
 * Each writes what it read, then checks, until the rules list every address. Then each address
 * the recipients it placed take mail for is taken off SES's suppression list, where mail to it
 * before the organization had it may have put it.
 */
export async function syncRecipients(table: Table, receiving: Receiving): Promise<void> {
  const placedNow = new Set<string>();
  for (let attempt = 1; ; attempt++) {
    const addresses = new Set(await ruleRecipients(table));
    const rules = (await receiving.rules.list()).filter(({ Name }) => receiptRuleNumber(Name) !== undefined);
    const placed = new Set<string>();
    const kept = rules.map((rule) => {
      const recipients = (rule.Recipients ?? []).filter((address) => addresses.has(address) && !placed.has(address));
      for (const address of recipients) placed.add(address);
      return { rule, recipients };
    });
    const missing = [...addresses].filter((address) => !placed.has(address)).sort();
    for (const recipient of missing) placedNow.add(recipient);
    for (const { recipients } of kept) recipients.push(...missing.splice(0, recipientsPerRule - recipients.length));
    const created: ReceiptRule[] = [];
    const taken = new Set(rules.map(({ Name }) => receiptRuleNumber(Name)));
    for (let number = 1; missing.length > 0; number++) {
      if (number > rulesPerSet) throw new Error(`Duva's receipt rules can list ${maxAddresses} addresses, and the organization has more, so mail to some is refused. Remove addresses.`);
      if (!taken.has(number)) created.push(receiptRule(receiving, ruleName(number), missing.splice(0, recipientsPerRule)));
    }
    const changed = kept.filter(({ rule, recipients }) => (rule.Recipients ?? []).join() !== recipients.join());
    if (changed.length === 0 && created.length === 0) {
      if (placedNow.size === 0) return;
      // The list is short, where the addresses an alias domain mirrors may be many.
      const listedNow = new Set([...placedNow].filter((recipient) => addresses.has(recipient)));
      const suppressed = (await receiving.suppressionList.list()).filter((address) => rulesTake(listedNow, address));
      for (const address of suppressed) await receiving.suppressionList.remove(address);
      return;
    }
    if (attempt === 10)
      throw new Error("SES's receipt rules kept changing while Duva updated them, so mail to the newest addresses may be refused. Adding another address updates them again.");
    for (const { rule, recipients } of changed) {
      if (recipients.length === 0) await receiving.rules.delete(rule.Name!);
      else await receiving.rules.update(receiptRule(receiving, rule.Name!, recipients));
    }
    let after = kept.findLast(({ recipients }) => recipients.length > 0)?.rule.Name;
    for (const rule of created) {
      await receiving.rules.create(rule, after);
      after = rule.Name;
    }
  }
}

/** The rule set in SES. */
export function sesReceiptRules(ses: SESClient, ruleSet: string): ReceiptRules {
  return {
    async list() {
      return (await ses.send(new DescribeReceiptRuleSetCommand({ RuleSetName: ruleSet }))).Rules ?? [];
    },
    async create(rule, after) {
      try {
        await ses.send(new CreateReceiptRuleCommand({ RuleSetName: ruleSet, Rule: rule, ...(after !== undefined && { After: after }) }));
        return true;
      } catch (error) {
        if (error instanceof AlreadyExistsException) return false;
        // The rule it was to follow was deleted meanwhile, so the next check places it again.
        if (error instanceof RuleDoesNotExistException) return false;
        throw error;
      }
    },
    async update(rule) {
      // A rule deleted meanwhile is created again by the next check.
      await ses.send(new UpdateReceiptRuleCommand({ RuleSetName: ruleSet, Rule: rule })).catch(unlessMissing);
    },
    async delete(name) {
      await ses.send(new DeleteReceiptRuleCommand({ RuleSetName: ruleSet, RuleName: name })).catch(unlessMissing);
    },
  };
}

const unlessMissing = (error: unknown) => {
  if (!(error instanceof RuleDoesNotExistException)) throw error;
};
