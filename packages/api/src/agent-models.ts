// The models the mailbox agents think with, where Bedrock runs them, and what they cost (ADR-0027),
// and how a deployment calls each, which decides where it processes mail (ADR-0035).
import type { components } from "@duva/openapi";
import { measuredModels } from "./measured-models.gen.ts";

export type MailboxAgentModel = components["schemas"]["MailboxAgentModel"];
export type MailboxAgentProfile = components["schemas"]["MailboxAgentProfile"];
export type MailboxAgentRegion = components["schemas"]["MailboxAgentRegion"];

/**
 * The models Duva knows on Bedrock, each with its price in US dollars per million input and output
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

/** The organization's everyday model until an admin chooses another, as Nicklas chose from #132's measurements. */
export const defaultMailboxAgentModel: MailboxAgentModel = "anthropic.claude-haiku-4-5-20251001-v1:0";

/** The organization's harder model until an admin chooses another (#132). */
export const defaultHarderModel: MailboxAgentModel = "anthropic.claude-sonnet-5-5";

/** The models admins can allow: those Coo's evaluation measured, in the order it lists them (ADR-0035). */
export const measuredModelIds = Object.keys(measuredModels) as MailboxAgentModel[];

export const isMeasured = (model: string): model is MailboxAgentModel => model in measuredModels;

/**
 * Where Bedrock processes what a model reads, for a deployment: in the deployment's region, on its
 * continent, in the US, or in any region with capacity.
 */
export type ProcessedIn = components["schemas"]["ProcessedIn"];

/** How Duva calls a model for a deployment: through the profile, from the region, and so where it processes mail. */
export interface ModelCall {
  profile: MailboxAgentProfile;
  region: MailboxAgentRegion;
  processedIn: ProcessedIn;
}

/**
 * The region a deployment calls Bedrock from: eu-central-1 in the EU, since Claude's Marketplace
 * agreement fails when called from eu-north-1 (docs/aws.md), us-west-2 in the US, and eu-central-1
 * elsewhere.
 */
export const modelRegion = (region: string): MailboxAgentRegion => (region.startsWith("us-") ? "us-west-2" : "eu-central-1");

/**
 * How a deployment in the region calls the model, keeping the mail as close as the model allows:
 * in the deployment's region itself where the model runs there without a profile, through the
 * profile of the deployment's continent from its model region, through the global profile, and
 * last, for a model available only in the US, through the us profile from us-west-2 (ADR-0035).
 */
export function callOf(model: MailboxAgentModel, region: string): ModelCall {
  const { profiles, inRegion } = mailboxAgentModels[model];
  if ((inRegion as string[]).includes(region)) return { profile: "none", region: region as MailboxAgentRegion, processedIn: "region" };
  const continent = region.startsWith("eu-") ? "eu" : region.startsWith("us-") ? "us" : undefined;
  if (continent !== undefined && profiles.includes(continent)) return { profile: continent, region: modelRegion(region), processedIn: "continent" };
  if (profiles.includes("global")) return { profile: "global", region: modelRegion(region), processedIn: "anywhere" };
  return { profile: "us", region: "us-west-2", processedIn: "us" };
}

/** The ID Converse takes for the model through the profile: the profile's, or without one, the model's own. */
export const inferenceProfileId = (model: MailboxAgentModel, profile: MailboxAgentProfile) => (profile === "none" ? model : `${profile}.${model}`);

/**
 * The model that decides whether the everyday model can take a conversation turn (#132), with its
 * price in eu-north-1, through the eu profile in the EU and the us profile elsewhere.
 */
export const deciderModel = "amazon.nova-micro-v1:0";
const deciderPrice = { input: 0.038, output: 0.152 };

/** The decider's profile for the region it is called from: eu in the EU, us elsewhere, as Nova Micro has no other. */
export const deciderProfile = (region: string): MailboxAgentProfile => (region.startsWith("eu-") ? "eu" : "us");

/** What a model call's tokens cost, in US dollars, as a deployment in the region calls the model, each at its own price. */
export function costOf({ inputTokens, outputTokens }: { inputTokens: number; outputTokens: number }, model: MailboxAgentModel | typeof deciderModel, region: string): number {
  const price = model === deciderModel ? deciderPrice : mailboxAgentModels[model];
  const discount = model !== deciderModel && callOf(model, region).profile === "global" ? 1 / 1.1 : 1;
  return ((inputTokens * price.input + outputTokens * price.output) * discount) / 1_000_000;
}
