// The mailbox agents' AgentCore Runtime (ADR-0027): an HTTP server on port 8080, as AgentCore's
// contract asks, with GET /ping and POST /invocations. Each invocation is one run of a mailbox
// agent, whose events it streams back as lines of JSON while the run goes.
import { createServer, type Server } from "node:http";
import { type Decider, type Model, type RunPayload, runAgent } from "./agent-loop.ts";
import { agentCoreBrowser } from "./agentcore-browser.ts";
import { bedrockDecider, bedrockModel } from "./bedrock-model.ts";
import type { Browser } from "./browser.ts";
import { environmentVariables } from "./infrastructure.ts";

/**
 * The runtime's server, asking the models and the decider in the region and through the profile
 * the payload names, and unsubscribing in the browser, AgentCore Browser's that the stack names unless given.
 */
export function createRuntimeServer(
  modelFor: (payload: RunPayload) => Model = ({ model }) => bedrockModel({ region: model.region, profile: model.profile }),
  browser: Browser | undefined = agentCoreBrowser(process.env[environmentVariables.unsubscribeBrowser] ?? ""),
  deciderFor: (payload: RunPayload) => Decider = ({ model }) => bedrockDecider({ region: model.region }),
): Server {
  // AgentCore reads a busy runtime as one to keep running.
  let running = 0;
  return createServer(async (incoming, outgoing) => {
    if (incoming.method === "GET" && incoming.url === "/ping") {
      outgoing.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ status: running > 0 ? "HealthyBusy" : "Healthy", time_of_last_update: Math.floor(Date.now() / 1000) }));
      return;
    }
    if (incoming.method !== "POST" || incoming.url !== "/invocations") return void outgoing.writeHead(404).end();
    const chunks: Buffer[] = [];
    for await (const chunk of incoming) chunks.push(chunk);
    running++;
    outgoing.writeHead(200, { "content-type": "application/x-ndjson" });
    try {
      const payload = JSON.parse(Buffer.concat(chunks).toString()) as RunPayload;
      for await (const event of runAgent(payload, { model: modelFor(payload), decider: deciderFor(payload), browser })) outgoing.write(`${JSON.stringify(event)}\n`);
    } catch (error) {
      console.error(error);
      outgoing.write(`${JSON.stringify({ type: "end", outcome: "failed" })}\n`);
    } finally {
      running--;
      outgoing.end();
    }
  });
}
