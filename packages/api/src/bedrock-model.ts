// The mailbox agent's models on Bedrock, through Strands' Bedrock provider, which calls
// ConverseStream, each model from the region and through the inference profile that suit the
// deployment's region (ADR-0035, docs/aws.md), and the decider, Nova Micro, which answers through a
// tool it must use (#132).
import { BedrockRuntimeClient, ConverseCommand, type Tool } from "@aws-sdk/client-bedrock-runtime";
import { BedrockModel } from "@strands-agents/sdk";
import type { Decider, Model } from "./agent-loop.ts";
import { callOf, deciderModel, deciderProfile, inferenceProfileId, modelRegion } from "./agent-models.ts";
import { asModel, type Models } from "./strands.ts";

// Clients and models by region, so a runtime's sessions share their connections.
const clients = new Map<string, BedrockRuntimeClient>();
const models = new Map<string, BedrockModel>();

const clientIn = (region: string) => {
  const client = clients.get(region) ?? new BedrockRuntimeClient({ region });
  clients.set(region, client);
  return client;
};

/**
 * The models, each called as a deployment in the region calls it. Each tool result says whether Duva
 * refused the call, for every model, as Duva's own loop told them before Strands (#148).
 */
export function bedrockModels({ region }: { region: string }): Models {
  return (model) => {
    const call = callOf(model, region);
    const modelId = inferenceProfileId(model, call.profile);
    const key = `${call.region} ${modelId}`;
    const bedrock = models.get(key) ?? new BedrockModel({ region: call.region, modelId, maxTokens: 4096, includeToolResultStatus: true });
    models.set(key, bedrock);
    return bedrock;
  };
}

/** The models, each called as a deployment in the region calls it, as Duva's `Model`, which the evaluation records through. */
export const bedrockModel = (where: { region: string }): Model => asModel(bedrockModels(where));

/** What the decider is told: when a turn is simple enough for the everyday model, and when it is complex. */
const deciding =
  "You route a mailbox owner's request to the agent that works in their mailbox. Choose simple when a small model can do it: a question about their mail, finding something in it, or organizing threads. Choose complex when it needs care: writing or sending mail for them, several steps that depend on each other, or judgement about people. Give your confidence from 0 to 1.";

const route: Tool = {
  toolSpec: {
    name: "route",
    description: "Route the request.",
    inputSchema: { json: { type: "object", properties: { route: { type: "string", enum: ["simple", "complex"] }, confidence: { type: "number" } }, required: ["route", "confidence"] } },
  },
};

/**
 * The decider: Nova Micro, called from the deployment's model region through its eu or us profile, which must use the
 * route tool. An answer it can't give, or a call that fails, is complex, with no confidence, so
 * the harder model takes the turn.
 */
export function bedrockDecider({ region: deployed }: { region: string }): Decider {
  const region = modelRegion(deployed);
  const client = clientIn(region);
  return async (words) => {
    const answer = await client.send(
      new ConverseCommand({
        modelId: `${deciderProfile(region)}.${deciderModel}`,
        system: [{ text: deciding }],
        messages: [{ role: "user", content: [{ text: words.slice(0, 4000) }] }],
        toolConfig: { tools: [route], toolChoice: { tool: { name: "route" } } },
        inferenceConfig: { maxTokens: 50, temperature: 0 },
      }),
    ).catch((error: unknown) => void console.error(error));
    const { output, usage } = answer ?? {};
    const input = output?.message?.content?.find((block) => block.toolUse !== undefined)?.toolUse?.input as { route?: unknown; confidence?: unknown } | undefined;
    const confidence = typeof input?.confidence === "number" ? Math.min(1, Math.max(0, input.confidence)) : 0;
    return { route: input?.route === "simple" ? "simple" : "complex", confidence, inputTokens: usage?.inputTokens ?? 0, outputTokens: usage?.outputTokens ?? 0 };
  };
}
