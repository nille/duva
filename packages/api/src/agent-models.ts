// The models the mailbox agents think with, where Bedrock runs them, and what they cost (ADR-0027).
import type { components } from "@duva/openapi";

export type MailboxAgentModel = components["schemas"]["MailboxAgentModel"];
export type MailboxAgentProfile = components["schemas"]["MailboxAgentProfile"];
export type MailboxAgentRegion = components["schemas"]["MailboxAgentRegion"];

/**
 * The Claude models an admin can choose, each with its price in US dollars per million input and
 * output tokens through the global profile. The eu and us profiles cost 10% more (docs/research/agentcore.md).
 */
export const mailboxAgentModels: Record<MailboxAgentModel, { name: string; input: number; output: number }> = {
  "anthropic.claude-sonnet-5-5": { name: "Claude Sonnet 5.5", input: 2, output: 10 },
  "anthropic.claude-haiku-4-5-20251001-v1:0": { name: "Claude Haiku 4.5", input: 1, output: 5 },
  "anthropic.claude-opus-5-5": { name: "Claude Opus 5.5", input: 4, output: 20 },
};

/** The model the mailbox agents think with until an admin chooses another. */
export const defaultMailboxAgentModel: MailboxAgentModel = "anthropic.claude-sonnet-5-5";

export const mailboxAgentProfiles: MailboxAgentProfile[] = ["eu", "us", "global"];

export const mailboxAgentRegions: MailboxAgentRegion[] = ["eu-central-1", "eu-west-1", "eu-west-3", "eu-north-1", "us-east-1", "us-east-2", "us-west-2"];

/** Whether Bedrock in the region runs the profile: eu only from the EU's regions, us from the US's, global from any. */
export const profileRunsIn = (profile: MailboxAgentProfile, region: string) => profile === "global" || region.startsWith(`${profile}-`);

/**
 * Where a deployment in the region has its mailbox agents call Bedrock until an admin chooses: from
 * eu-central-1 with the eu profile in the EU, since Claude's Marketplace agreement fails when called
 * from eu-north-1 (docs/aws.md), from us-west-2 with the us profile in the US, and with the global
 * profile from eu-central-1 elsewhere.
 */
export function defaultModelRegion(region: string): { mailboxAgentProfile: MailboxAgentProfile; mailboxAgentRegion: MailboxAgentRegion } {
  if (region.startsWith("us-")) return { mailboxAgentProfile: "us", mailboxAgentRegion: "us-west-2" };
  return { mailboxAgentProfile: region.startsWith("eu-") ? "eu" : "global", mailboxAgentRegion: "eu-central-1" };
}

/** The inference profile's ID for the model, which Converse takes as its model ID. */
export const inferenceProfileId = (model: MailboxAgentModel, profile: MailboxAgentProfile) => `${profile}.${model}`;

/** What a model call's tokens cost, in US dollars. */
export function costOf({ inputTokens, outputTokens }: { inputTokens: number; outputTokens: number }, model: MailboxAgentModel, profile: MailboxAgentProfile): number {
  const price = mailboxAgentModels[model];
  const markup = profile === "global" ? 1 : 1.1;
  return ((inputTokens * price.input + outputTokens * price.output) * markup) / 1_000_000;
}
