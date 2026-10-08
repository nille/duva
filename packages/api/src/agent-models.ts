// The models the mailbox agents think with, where Bedrock runs them, and what they cost (ADR-0027).
import type { components } from "@duva/openapi";

export type MailboxAgentModel = components["schemas"]["MailboxAgentModel"];
export type MailboxAgentProfile = components["schemas"]["MailboxAgentProfile"];
export type MailboxAgentRegion = components["schemas"]["MailboxAgentRegion"];

/**
 * The models an admin can choose, each with its price in US dollars per million input and output
 * tokens through the eu and us profiles, or called in a region itself, the global profile costing
 * 10% less, the profiles that run it, and the regions where it runs without one. Prices are
 * eu-north-1's (docs/research/agentcore.md, docs/research/coo-models.md).
 */
export const mailboxAgentModels: Record<MailboxAgentModel, { name: string; input: number; output: number; profiles: MailboxAgentProfile[]; inRegion: MailboxAgentRegion[] }> = {
  "anthropic.claude-sonnet-5-5": { name: "Claude Sonnet 5.5", input: 2.2, output: 11, profiles: ["eu", "us", "global"], inRegion: [] },
  "anthropic.claude-haiku-4-5-20251001-v1:0": { name: "Claude Haiku 4.5", input: 1.1, output: 5.5, profiles: ["eu", "us", "global"], inRegion: [] },
  "anthropic.claude-opus-5-5": { name: "Claude Opus 5.5", input: 4.4, output: 22, profiles: ["eu", "us", "global"], inRegion: [] },
  "amazon.nova-2-lite-v1:0": { name: "Amazon Nova 2 Lite", input: 0.363, output: 2.992, profiles: ["eu", "us", "global"], inRegion: [] },
  "amazon.nova-pro-v1:0": { name: "Amazon Nova Pro", input: 0.87, output: 3.48, profiles: ["eu", "us", "none"], inRegion: ["us-east-1"] },
  "amazon.nova-lite-v1:0": { name: "Amazon Nova Lite", input: 0.065, output: 0.26, profiles: ["eu", "us", "none"], inRegion: ["eu-north-1", "us-east-1", "us-east-2", "us-west-2"] },
};

/** The model the mailbox agents answer and do tasks with until an admin chooses another, as Nicklas chose from #132's measurements. */
export const defaultMailboxAgentModel: MailboxAgentModel = "anthropic.claude-haiku-4-5-20251001-v1:0";

/** The model for the harder work until an admin chooses another (#132). */
export const defaultHarderModel: MailboxAgentModel = "anthropic.claude-sonnet-5-5";

export const mailboxAgentProfiles: MailboxAgentProfile[] = ["eu", "us", "global", "none"];

export const mailboxAgentRegions: MailboxAgentRegion[] = ["eu-central-1", "eu-west-1", "eu-west-3", "eu-north-1", "us-east-1", "us-east-2", "us-west-2"];

/**
 * Why Bedrock in the region doesn't run the model through the profile, if it doesn't: eu runs only
 * from the EU's regions, us from the US's, global from any, and none only where the model runs on
 * demand. A model runs only through the profiles it has.
 */
export function wontRun(model: MailboxAgentModel, profile: MailboxAgentProfile, region: string): string | undefined {
  const { name, profiles, inRegion } = mailboxAgentModels[model];
  if (!profiles.includes(profile)) {
    const through = profiles.filter((each) => each !== "none");
    const named = `${through.slice(0, -1).join(", ")} or ${through.at(-1)}`;
    return `${name} runs only through the ${named} profile${profiles.includes("none") ? ", or with none" : ""}. Give mailboxAgentProfile as one of those.`;
  }
  if (profile === "none" && !(inRegion as string[]).includes(region)) {
    return `${name} runs without a profile only in ${inRegion.join(", ")}, and not in ${region}. Give mailboxAgentRegion as one of them, or mailboxAgentProfile as a profile.`;
  }
  if (profile === "eu" || profile === "us") {
    if (!region.startsWith(`${profile}-`)) return `The ${profile} profile runs only from ${profile === "eu" ? "an EU" : "a US"} region, and ${region} isn't one. Give mailboxAgentRegion as one, or mailboxAgentProfile as ${profiles.includes("global") ? "global" : "another"}.`;
  }
  return undefined;
}

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

/** The ID Converse takes for the model through the profile: the profile's, or without one, the model's own. */
export const inferenceProfileId = (model: MailboxAgentModel, profile: MailboxAgentProfile) => (profile === "none" ? model : `${profile}.${model}`);

/**
 * The model that decides whether the everyday model can take a conversation turn (#132), with its
 * price in eu-north-1, through the eu profile in the EU and the us profile elsewhere.
 */
export const deciderModel = "amazon.nova-micro-v1:0";
const deciderPrice = { input: 0.038, output: 0.152 };

/** The decider's profile for the mailbox agents' region: eu in the EU, us elsewhere, as Nova Micro has no other. */
export const deciderProfile = (region: string): MailboxAgentProfile => (region.startsWith("eu-") ? "eu" : "us");

/** What a model call's tokens cost, in US dollars. */
export function costOf({ inputTokens, outputTokens }: { inputTokens: number; outputTokens: number }, model: MailboxAgentModel | typeof deciderModel, profile: MailboxAgentProfile): number {
  const price = model === deciderModel ? deciderPrice : mailboxAgentModels[model];
  const discount = profile === "global" ? 1 / 1.1 : 1;
  return ((inputTokens * price.input + outputTokens * price.output) * discount) / 1_000_000;
}
