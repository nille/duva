// The mailbox agent's models on Bedrock, through ConverseStream, each called from the region and
// through the inference profile that suit the deployment's region (ADR-0035, docs/aws.md), and the
// decider, Nova Micro, which answers through a tool it must use (#132).
import { BedrockRuntimeClient, ConverseCommand, ConverseStreamCommand, type Message, type Tool } from "@aws-sdk/client-bedrock-runtime";
import type { Decider, Model } from "./agent-loop.ts";
import { callOf, deciderModel, deciderProfile, inferenceProfileId, modelRegion } from "./agent-models.ts";

// Clients by region, so a runtime's sessions share their connections.
const clients = new Map<string, BedrockRuntimeClient>();

const clientIn = (region: string) => {
  const client = clients.get(region) ?? new BedrockRuntimeClient({ region });
  clients.set(region, client);
  return client;
};

/** The models, each called as a deployment in the region calls it. */
export function bedrockModel({ region }: { region: string }): Model {
  return async function* ({ model, system, messages, tools }) {
    const call = callOf(model, region);
    const { stream } = await clientIn(call.region).send(
      new ConverseStreamCommand({
        modelId: inferenceProfileId(model, call.profile),
        system: [{ text: system }],
        messages: messages as Message[],
        toolConfig: { tools: tools.map((tool) => ({ toolSpec: { ...tool, inputSchema: { json: tool.inputSchema.json as never } } }) satisfies Tool) },
        inferenceConfig: { maxTokens: 4096 },
      }),
    );
    // A tool's input streams as JSON in pieces, complete at its block's stop.
    const uses = new Map<number, { toolUseId: string; name: string; input: string }>();
    for await (const event of stream ?? []) {
      if (event.contentBlockStart?.start?.toolUse !== undefined) {
        const { toolUseId = "", name = "" } = event.contentBlockStart.start.toolUse;
        uses.set(event.contentBlockStart.contentBlockIndex ?? 0, { toolUseId, name, input: "" });
      } else if (event.contentBlockDelta !== undefined) {
        const { delta, contentBlockIndex = 0 } = event.contentBlockDelta;
        if (delta?.text !== undefined) yield { text: delta.text };
        else if (delta?.toolUse?.input !== undefined) uses.get(contentBlockIndex)!.input += delta.toolUse.input;
      } else if (event.contentBlockStop !== undefined) {
        const use = uses.get(event.contentBlockStop.contentBlockIndex ?? 0);
        if (use === undefined) continue;
        uses.delete(event.contentBlockStop.contentBlockIndex ?? 0);
        yield { toolUse: { toolUseId: use.toolUseId, name: use.name, input: use.input === "" ? {} : (JSON.parse(use.input) as Record<string, unknown>) } };
      } else if (event.metadata?.usage !== undefined) {
        yield { usage: { inputTokens: event.metadata.usage.inputTokens ?? 0, outputTokens: event.metadata.usage.outputTokens ?? 0 } };
      }
    }
  };
}

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
