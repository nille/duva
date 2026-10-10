// Web Search on AgentCore as the mailbox agents' runtime reaches it (ADR-0037): a JSON-RPC call
// of MCP's tools/call to the stack's AgentCore Gateway, in the search region, signed with SigV4 for
// bedrock-agentcore there, as the runtime's role may invoke it. The gateway is stateless, so a call
// needs no initialize before it (docs/aws.md).
import { BedrockAgentCoreClient } from "@aws-sdk/client-bedrock-agentcore";
import { SignatureV4 } from "@smithy/signature-v4";
import { Sha256 } from "./agentcore-browser.ts";
import { resultsAsked, type WebResult, type WebSearch } from "./web-search.ts";

/** The Web Search target's tool, as the gateway names it for the stack's target, web-search. */
export const webSearchToolName = "web-search___WebSearch";

/** Web Search through the gateway at the MCP URL, or undefined where the stack left it out, giving its URL as empty. */
export function agentCoreWebSearch(gatewayUrl: string): WebSearch | undefined {
  if (gatewayUrl === "") return undefined;
  const url = new URL(gatewayUrl);
  // <gateway>.gateway.bedrock-agentcore.<region>.amazonaws.com
  const region = url.hostname.split(".").at(-3)!;
  const signer = new SignatureV4({ service: "bedrock-agentcore", region, credentials: new BedrockAgentCoreClient({ region }).config.credentials, sha256: Sha256 });
  return async (query) => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: webSearchToolName, arguments: { query, maxResults: resultsAsked } } });
    const headers = { host: url.host, "content-type": "application/json", accept: "application/json, text/event-stream" };
    const signed = await signer.sign({ method: "POST", protocol: "https:", hostname: url.hostname, path: url.pathname, headers, body });
    const response = await fetch(url, { method: "POST", headers: signed.headers, body, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`Web Search answered ${response.status}: ${(await response.text()).slice(0, 500)}`);
    const answer = (await response.json()) as { result?: { isError?: boolean; content?: { type: string; text?: string }[] }; error?: { message?: string } };
    if (answer.result === undefined || answer.result.isError) throw new Error(`Web Search failed: ${JSON.stringify(answer).slice(0, 500)}`);
    const text = answer.result.content?.find(({ type }) => type === "text")?.text ?? "{}";
    return ((JSON.parse(text) as { results?: WebResult[] }).results ?? []).filter((result) => typeof result.text === "string");
  };
}
