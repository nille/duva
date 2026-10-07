// The mailbox agents' AgentCore Runtime as the Lambdas that start runs reach it (ADR-0027): each run
// is a session of its own, whose answer is a line of JSON for each event, and which is stopped once
// the run ends, so it bills nothing after.
import { BedrockAgentCoreClient, InvokeAgentRuntimeCommand, StopRuntimeSessionCommand } from "@aws-sdk/client-bedrock-agentcore";
import type { RunEvent } from "./agent-loop.ts";
import type { AgentRuntime } from "./agent-runs.ts";

/** The runtime with the ARN, or undefined where the stack left it out, giving its ARN as empty. */
export function agentCoreRuntime(runtimeArn: string): AgentRuntime | undefined {
  if (runtimeArn === "") return undefined;
  const agentCore = new BedrockAgentCoreClient({});
  return async function* (payload, session) {
    try {
      const { response } = await agentCore.send(
        new InvokeAgentRuntimeCommand({ agentRuntimeArn: runtimeArn, runtimeSessionId: session, contentType: "application/json", accept: "application/x-ndjson", payload: new TextEncoder().encode(JSON.stringify(payload)) }),
      );
      let pending = "";
      for await (const chunk of (response ?? []) as AsyncIterable<Uint8Array>) {
        pending += new TextDecoder().decode(chunk, { stream: true });
        const lines = pending.split("\n");
        pending = lines.pop() ?? "";
        for (const line of lines) if (line.trim() !== "") yield JSON.parse(line) as RunEvent;
      }
      if (pending.trim() !== "") yield JSON.parse(pending) as RunEvent;
    } finally {
      await agentCore.send(new StopRuntimeSessionCommand({ agentRuntimeArn: runtimeArn, runtimeSessionId: session })).catch((error: unknown) => console.error(error));
    }
  };
}
