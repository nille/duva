// The models the mailbox agents think with, where Bedrock runs them, and what they cost (ADR-0027),
// and how a deployment calls each, which decides where it processes mail (ADR-0035).
import type { components } from "@duva/openapi";
import { measuredModels } from "./measured-models.gen.ts";

export type MailboxAgentModel = components["schemas"]["MailboxAgentModel"];
export type MailboxAgentProfile = components["schemas"]["MailboxAgentProfile"];
export type MailboxAgentRegion = components["schemas"]["MailboxAgentRegion"];

/** A model's price in US dollars per million tokens read and written, and read from and written to a cache. */
interface Price {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

/**
 * The models Duva knows on Bedrock, each with its price in US dollars per million input and output
 * tokens through the eu and us profiles, or called in a region itself, the global profile costing
 * 10% less, the profiles that run it, and the regions where it runs without one. A model that
 * caches its prompt on its own reports what it read from and wrote to the cache apart, at the cache
 * prices listed here. Duva asks no other model to cache, so it lists no cache prices for them, Claude
 * included, and counts any cached tokens they report at the input price. Prices are eu-north-1's
 * (docs/research/agentcore.md, docs/research/coo-models.md).
 */
export const mailboxAgentModels: Record<MailboxAgentModel, Price & { name: string; profiles: MailboxAgentProfile[]; inRegion: MailboxAgentRegion[] }> = {
  "anthropic.claude-sonnet-5-5": { name: "Claude Sonnet 5.5", input: 2.2, output: 11, profiles: ["eu", "us", "global"], inRegion: [] },
  "anthropic.claude-haiku-4-5-20251001-v1:0": { name: "Claude Haiku 4.5", input: 1.1, output: 5.5, profiles: ["eu", "us", "global"], inRegion: [] },
  "anthropic.claude-opus-5-5": { name: "Claude Opus 5.5", input: 4.4, output: 22, profiles: ["eu", "us", "global"], inRegion: [] },
  "amazon.nova-2-lite-v1:0": { name: "Amazon Nova 2 Lite", input: 0.363, output: 2.992, profiles: ["eu", "us", "global"], inRegion: [] },
  "amazon.nova-pro-v1:0": { name: "Amazon Nova Pro", input: 0.87, output: 3.48, profiles: ["eu", "us", "none"], inRegion: ["us-east-1"] },
  "amazon.nova-lite-v1:0": { name: "Amazon Nova Lite", input: 0.065, output: 0.26, profiles: ["eu", "us", "none"], inRegion: ["eu-north-1", "us-east-1", "us-east-2", "us-west-2"] },
  // Through global and us only, at the us price, global's 10% less (model cards, Price List API, 2026-10-10, #150).
  "openai.gpt-6-luna": { name: "GPT-6 Luna", input: 0.11, output: 0.55, cacheRead: 0.011, cacheWrite: 0.1375, profiles: ["global", "us"], inRegion: [] },
  "openai.gpt-6-sol": { name: "GPT-6 Sol", input: 2.2, output: 11, cacheRead: 0.22, cacheWrite: 2.75, profiles: ["global", "us"], inRegion: [] },
  "xai.grok-4.7": { name: "Grok 4.7", input: 2.2, output: 6.6, cacheRead: 0.55, profiles: ["global", "us"], inRegion: [] },
  "moonshotai.kimi-k3": { name: "Kimi K3", input: 3.3, output: 16.5, cacheRead: 0.33, cacheWrite: 4.125, profiles: ["global", "us"], inRegion: [] },
  // Bedrock publishes no price for GLM-5.3 (2026-10-10), so this is GLM-5's until it does.
  "zai.glm-5.3": { name: "GLM-5.3", input: 1.2, output: 3.84, profiles: ["global", "us"], inRegion: [] },
  // On demand only, in the regions listed, at eu-north-1's price (#150).
  "openai.gpt-oss-120b-1:0": { name: "gpt-oss-120b", input: 0.15, output: 0.6, profiles: ["none"], inRegion: ["eu-north-1", "eu-central-1", "us-west-2"] },
  "qwen.qwen3-235b-a22b-2507-v1:0": { name: "Qwen3 235B A22B", input: 0.22, output: 0.88, profiles: ["none"], inRegion: ["eu-north-1", "eu-central-1", "us-west-2"] },
  "deepseek.v3.2": { name: "DeepSeek V3.2", input: 0.74, output: 2.22, profiles: ["none"], inRegion: ["eu-north-1", "us-west-2"] },
  "zai.glm-5": { name: "GLM-5", input: 1.2, output: 3.84, profiles: ["none"], inRegion: ["eu-north-1", "us-west-2"] },
  "moonshotai.kimi-k2.5": { name: "Kimi K2.5", input: 0.72, output: 3.6, profiles: ["none"], inRegion: ["eu-north-1", "us-west-2"] },
  // MiniMax M2.5 runs in eu-north-1 too, but answered nothing there for over an hour on 2026-10-10 (docs/aws.md).
  "minimax.minimax-m2.5": { name: "MiniMax M2.5", input: 0.36, output: 1.44, profiles: ["none"], inRegion: ["eu-central-1", "us-west-2"] },
};

/** The organization's everyday model until an admin chooses another, as Nicklas chose from #132's measurements. */
export const defaultMailboxAgentModel: MailboxAgentModel = "anthropic.claude-haiku-4-5-20251001-v1:0";

/** The organization's harder model until an admin chooses another (#132). */
export const defaultHarderModel: MailboxAgentModel = "anthropic.claude-sonnet-5-5";

/**
 * The models admins can allow: those Coo's evaluation measured, by the name of the setup that ran
 * each alone (ADR-0035). A recording of Coo's evaluation adds those it measures for the first time.
 */
export const measuredModelIds = Object.keys(measuredModels) as MailboxAgentModel[];

export const isMeasured = (model: string): model is MailboxAgentModel => measuredModelIds.some((measured) => measured === model);

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
 * profile of the deployment's continent from its model region, in its model region itself, through
 * the global profile, and last, for a model available only in the US, through the us profile from
 * us-west-2, or in us-west-2 itself. A model called in the model region itself processes mail on the
 * deployment's continent, as MiniMax M2.5 does in eu-central-1 for one in eu-north-1. A model of
 * neither profile is called in us-west-2 itself, where each Duva lists without a profile runs
 * (ADR-0035).
 */
export function callOf(model: MailboxAgentModel, region: string): ModelCall {
  const { profiles, inRegion } = mailboxAgentModels[model];
  const runsIn = (where: string) => inRegion.some((one) => one === where);
  if (runsIn(region)) return { profile: "none", region: region as MailboxAgentRegion, processedIn: "region" };
  const continent = region.startsWith("eu-") ? "eu" : region.startsWith("us-") ? "us" : undefined;
  if (continent !== undefined && profiles.includes(continent)) return { profile: continent, region: modelRegion(region), processedIn: "continent" };
  if (continent !== undefined && runsIn(modelRegion(region))) return { profile: "none", region: modelRegion(region), processedIn: "continent" };
  if (profiles.includes("global")) return { profile: "global", region: modelRegion(region), processedIn: "anywhere" };
  return { profile: profiles.includes("us") ? "us" : "none", region: "us-west-2", processedIn: "us" };
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

/** The tokens of a model call: what it read and wrote, and what of its prompt it read from or wrote to a cache. */
export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens?: number;
  cacheWriteInputTokens?: number;
}

/** What a model call's tokens cost, in US dollars, as a deployment in the region calls the model, each at its own price. */
export function costOf({ inputTokens, outputTokens, cacheReadInputTokens = 0, cacheWriteInputTokens = 0 }: Usage, model: MailboxAgentModel | typeof deciderModel, region: string): number {
  const price: Price = model === deciderModel ? deciderPrice : mailboxAgentModels[model];
  const discount = model !== deciderModel && callOf(model, region).profile === "global" ? 1 / 1.1 : 1;
  const cached = cacheReadInputTokens * (price.cacheRead ?? price.input) + cacheWriteInputTokens * (price.cacheWrite ?? price.input);
  return ((inputTokens * price.input + outputTokens * price.output + cached) * discount) / 1_000_000;
}
