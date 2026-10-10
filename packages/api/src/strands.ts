// What the mailbox agent's loops share on the Strands Agents SDK (ADR-0035, #148): an agent with
// Duva's defaults, tools of Duva's, and Duva's models as Strands asks them. In a deployment each
// model is Strands' Bedrock provider. In tests it is a stand-in, Duva's `Model`, which the adapter
// here turns into a Strands Model, so a test and coo-answers.json see what the model is asked and
// answers as Converse has them.
import {
  Agent,
  BeforeToolCallEvent,
  InvokeModelStage,
  MaxTokensError,
  Message,
  type MessageData,
  type ModelStreamEvent,
  NullConversationManager,
  type StreamOptions,
  Model as StrandsModel,
  TextBlock,
  Tool,
  type ToolContext,
  ToolResultBlock,
  type ToolSpec as StrandsToolSpec,
} from "@strands-agents/sdk";
import type { ContentBlock, Model, ModelMessage, ToolSpec } from "./agent-loop.ts";
import type { MailboxAgentModel } from "./agent-models.ts";

/** The Strands model for each of the models admins choose. */
export type Models = (model: MailboxAgentModel) => StrandsModel;

/** What runs a tool call: whether it went well, and what the model reads of it. */
type Run = (name: string, input: Record<string, unknown>) => Promise<{ ok: boolean; result: string }>;

/**
 * An agent on the messages so far, oldest first, with the tools, each call of which `run`
 * runs, a tool the model made up too, so Duva refuses it as it refuses its own. It has Duva's
 * defaults: no printer, tool calls one at a time, as the model gave them, no retries of a failed
 * model call, and every message sent each time, as Duva keeps them.
 */
export function strandsAgent({ model, messages, tools, run }: { model: StrandsModel; messages: ModelMessage[]; tools: ToolSpec[]; run: Run }): Agent {
  const agent = new Agent({
    model,
    messages: messages as MessageData[],
    tools: tools.map((spec) => tool(spec, run)),
    printer: false,
    toolExecutor: "sequential",
    retryStrategy: null,
    conversationManager: new NullConversationManager(),
  });
  // A call that reached the token limit answered what it wrote, as Duva's own loop took it, where Strands fails the run.
  agent.addMiddleware(InvokeModelStage, async function* (context, next) {
    try {
      return yield* next(context);
    } catch (error) {
      if (!(error instanceof MaxTokensError)) throw error;
      const message = error.partialMessage;
      return { result: { message, stopReason: message.content.some((block) => block.type === "toolUseBlock") ? "toolUse" : "endTurn" } };
    }
  });
  agent.addHook(BeforeToolCallEvent, (event) => {
    if (event.tool === undefined) event.selectedTool = tool({ name: event.toolUse.name, description: "", inputSchema: { json: {} } }, run);
  });
  return agent;
}

/** Runs the agent on the messages it has, yielding what its hooks and tools said, in order, as they said it. */
export async function* saying<T>(agent: Agent, said: T[]): AsyncGenerator<T> {
  for await (const _ of agent.stream([])) for (let next = said.shift(); next !== undefined; next = said.shift()) yield next;
  for (let next = said.shift(); next !== undefined; next = said.shift()) yield next;
}

/** The tool as Strands has it, with the JSON schema of its input. */
export const strandsSpec = ({ name, description, inputSchema }: ToolSpec): StrandsToolSpec => ({ name, description, inputSchema: inputSchema.json as StrandsToolSpec["inputSchema"] });

/** A tool of Duva's, as Strands runs it. */
function tool(spec: ToolSpec, run: Run): Tool {
  return new (class extends Tool {
    name = spec.name;
    description = spec.description;
    toolSpec = strandsSpec(spec);
    async *stream({ toolUse }: ToolContext) {
      const { ok, result } = await run(toolUse.name, (toolUse.input ?? {}) as Record<string, unknown>);
      return new ToolResultBlock({ toolUseId: toolUse.toolUseId, status: ok ? "success" : "error", content: [new TextBlock(result)] });
    }
  })();
}

/** The messages as Converse has them, as the stand-in and the answer check read them. */
export const asConverse = (messages: Message[]): ModelMessage[] =>
  messages.map(({ role, content }) => ({
    role,
    content: content.flatMap((block): ContentBlock[] => {
      if (block.type === "textBlock") return [{ text: block.text }];
      if (block.type === "toolUseBlock") return [{ toolUse: { toolUseId: block.toolUseId, name: block.name, input: block.input as Record<string, unknown> } }];
      if (block.type === "toolResultBlock") return [{ toolResult: { toolUseId: block.toolUseId, content: block.content.map((each) => ({ text: "text" in each ? each.text : JSON.stringify(each) })), status: block.status } }];
      return [];
    }),
  }));

/** The stand-in as a Strands model for each of the models, asked as Bedrock would be. */
export const standIn =
  (model: Model): Models =>
  (id) =>
    new StandIn(model, id);

class StandIn extends StrandsModel {
  private readonly ask: Model;
  private readonly id: MailboxAgentModel;

  constructor(ask: Model, id: MailboxAgentModel) {
    super();
    this.ask = ask;
    this.id = id;
  }

  updateConfig() {}

  getConfig() {
    return { modelId: this.id };
  }

  async *stream(messages: Message[], options?: StreamOptions): AsyncIterable<ModelStreamEvent> {
    const system = typeof options?.systemPrompt === "string" ? options.systemPrompt : (options?.systemPrompt ?? []).map((block) => ("text" in block ? block.text : "")).join("");
    const tools = (options?.toolSpecs ?? []).map(({ name, description, inputSchema }) => ({ name, description, inputSchema: { json: (inputSchema ?? {}) as Record<string, unknown> } }));
    yield { type: "modelMessageStartEvent", role: "assistant" };
    let writing = false;
    let used = false;
    for await (const event of this.ask({ model: this.id, system, messages: asConverse(messages), tools })) {
      if ("text" in event) {
        if (!writing) yield { type: "modelContentBlockStartEvent" };
        writing = true;
        yield { type: "modelContentBlockDeltaEvent", delta: { type: "textDelta", text: event.text } };
      } else if ("toolUse" in event) {
        if (writing) yield { type: "modelContentBlockStopEvent" };
        writing = false;
        used = true;
        const { toolUseId, name, input } = event.toolUse;
        yield { type: "modelContentBlockStartEvent", start: { type: "toolUseStart", toolUseId, name } };
        yield { type: "modelContentBlockDeltaEvent", delta: { type: "toolUseInputDelta", input: JSON.stringify(input) } };
        yield { type: "modelContentBlockStopEvent" };
      } else yield { type: "modelMetadataEvent", usage: { ...event.usage, totalTokens: event.usage.inputTokens + event.usage.outputTokens } };
    }
    if (writing) yield { type: "modelContentBlockStopEvent" };
    yield { type: "modelMessageStopEvent", stopReason: used ? "toolUse" : "endTurn" };
  }
}

/** The Strands models as Duva's `Model`, as the evaluation records what Bedrock answers through them. */
export function asModel(models: Models): Model {
  return async function* ({ model, system, messages, tools }) {
    let use: { toolUseId: string; name: string; input: string } | undefined;
    for await (const event of models(model).stream(
      messages.map((message) => Message.fromMessageData(message as MessageData)),
      { systemPrompt: system, toolSpecs: tools.map(strandsSpec) },
    )) {
      if (event.type === "modelContentBlockStartEvent" && event.start?.type === "toolUseStart") use = { toolUseId: event.start.toolUseId, name: event.start.name, input: "" };
      else if (event.type === "modelContentBlockDeltaEvent" && event.delta.type === "textDelta") yield { text: event.delta.text };
      else if (event.type === "modelContentBlockDeltaEvent" && event.delta.type === "toolUseInputDelta" && use !== undefined) use.input += event.delta.input;
      else if (event.type === "modelContentBlockStopEvent" && use !== undefined) {
        yield { toolUse: { toolUseId: use.toolUseId, name: use.name, input: use.input === "" ? {} : (JSON.parse(use.input) as Record<string, unknown>) } };
        use = undefined;
      } else if (event.type === "modelMetadataEvent" && event.usage !== undefined) yield { usage: { inputTokens: event.usage.inputTokens, outputTokens: event.usage.outputTokens } };
    }
  };
}
