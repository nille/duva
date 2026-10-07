// Claude on Bedrock as the mailbox agent's model, through ConverseStream in the model region the
// organization chose, with its inference profile (ADR-0027, docs/aws.md).
import { BedrockRuntimeClient, ConverseStreamCommand, type Message, type Tool } from "@aws-sdk/client-bedrock-runtime";
import type { Model } from "./agent-loop.ts";

// Clients by region, so a runtime's sessions share their connections.
const clients = new Map<string, BedrockRuntimeClient>();

/** The model with the inference profile's ID, called in the region. */
export function bedrockModel({ region, modelId }: { region: string; modelId: string }): Model {
  const client = clients.get(region) ?? new BedrockRuntimeClient({ region });
  clients.set(region, client);
  return async function* ({ system, messages, tools }) {
    const { stream } = await client.send(
      new ConverseStreamCommand({
        modelId,
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
