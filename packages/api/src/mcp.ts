// Duva's MCP endpoint (ADR-0028): a remote MCP server over Streamable HTTP, stateless, which an MCP
// client such as Claude Code signs in to with the human's Duva account, through OAuth with the
// deployment's user pool. Its tools reach the human's own mailbox agents: asking one, or giving it a
// task, and calling Duva's operations in its mailbox as that agent, so all a tool does is what the
// agent may do there, attributed to it, and its sends wait for the human's approval as the agent's do.
//
// MCP clients register with Duva, not Cognito, and all sign in through the user pool's one MCP app
// client, by way of Duva's own authorize, callback and token endpoints, which pass each step on to
// managed login. A user pool takes at most 20 managed login styles, one per app client (docs/aws.md).
import { createHash, randomBytes } from "node:crypto";
import { DeleteCommand, GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { agentOperations, agentTools, callOperation, operationNamed } from "./agent-loop.ts";
import { sponsorAccessIn } from "./access.ts";
import { actorNamed } from "./alerting.ts";
import { actionsRead, type ConversationTurn, type PreparedTurn, prepareTurn, turnsOf } from "./conversation.ts";
import type { Table } from "./deployment.ts";
import { authorizationServerPath, mcpAuthorizePath, mcpCallbackPath, mcpPath, mcpRegistrationPath, mcpTokenPath, protectedResourcePaths, timeToLiveAttribute } from "./infrastructure.ts";
import { mailboxAgentOf } from "./mailbox-agents.ts";
import { type Agent, agentSettings, findHumanBySignIn, type Human, type Mailbox, ownedMailboxes } from "./organization.ts";
import { endRunToken, issueRunToken } from "./run-tokens.ts";
import { documents, isNew, pk, sk } from "./table.ts";

/** The MCP versions the endpoint speaks, newest first. */
export const mcpVersions = ["2025-11-25", "2025-06-18", "2025-03-26"];

/** The scopes MCP clients sign in with, which the user pool's MCP app client is given. */
export const mcpScopes = ["openid", "email"];

/** How long a sign-in through Duva's authorize endpoint may take, and its code wait to be exchanged, in milliseconds. */
const signInLifetime = 10 * 60_000;

/**
 * How long a registration and a session's refresh token are kept unused, in milliseconds: past the
 * 30 days a refresh token from managed login works. Each sign-in and renewal keeps them that long again.
 */
const keptUnused = 60 * 24 * 60 * 60_000;
const keptUntil = () => Math.ceil((Date.now() + keptUnused) / 1000);

/** Verifies an access token from the user pool, and returns its sub and the app client it was issued to. Throws if the token isn't one. */
export type VerifyAnyAccessToken = (token: string) => Promise<{ sub: string; clientId: string }>;

export interface McpDeployment {
  version: string;
  region: string;
  table: Table;
  /** Where managed login is, which MCP clients sign in at through Duva's endpoints. */
  signInUrl: string;
  /** The user pool's app client every MCP client signs in through, whose only callback is Duva's. */
  appClient: string;
  verifyAccessToken: VerifyAnyAccessToken;
  /** Starts running a turn prepared for a mailbox agent, without waiting for it, or undefined where AgentCore isn't. */
  turns: { start(prepared: PreparedTurn): Promise<void> } | undefined;
  /** Reaches Duva's API and managed login. */
  fetch?: (request: Request) => Promise<Response>;
  /** How long askAgent waits for the agent's answer, in milliseconds, within API Gateway's 30 seconds. */
  askWait: number;
}

/** A tool as MCP lists it. */
interface Tool {
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

const mailboxInput = { type: "string", description: "The mailbox to work in, by its address or ID. Leave it out if you have one mailbox." };

/** The tools of Duva's own, which reach the mailbox agent itself. */
const ownTools: Tool[] = [
  {
    name: "listMailboxes",
    title: "List your mailboxes",
    description: "Your mailboxes, each with its addresses and what your mailbox agent may do there: read, organize, draft or send, and whether its sends wait for your approval. The other tools work in one of them.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: "askAgent",
    title: "Ask your mailbox agent",
    description:
      "Asks your mailbox agent, Duva's own agent for the mailbox, which reads and works in it itself, and gives its answer and what it did. It waits up to about 20 seconds; if the agent takes longer, read its answer later with readConversation. This is the same conversation as Ask Coo in Duva.",
    inputSchema: { type: "object", properties: { mailbox: mailboxInput, words: { type: "string", description: "What to ask, as you would ask a person." } }, required: ["words"] },
  },
  {
    name: "giveAgentTask",
    title: "Give your mailbox agent a task",
    description: "Hands your mailbox agent something to do, without waiting for it. Its answer and what it did land in the conversation, in Ask Coo in Duva and in readConversation.",
    inputSchema: { type: "object", properties: { mailbox: mailboxInput, words: { type: "string", description: "What the agent should do." } }, required: ["words"] },
  },
  {
    name: "readConversation",
    title: "Read the conversation with your mailbox agent",
    description: "The last turns of your conversation with your mailbox agent, oldest first: what you asked, and what it answered and did, with the outcome of each run.",
    inputSchema: { type: "object", properties: { mailbox: mailboxInput } },
    annotations: { readOnlyHint: true },
  },
];

/**
 * The tools that are Duva's operations, those the mailbox agent itself has (agent-loop.ts), each
 * with the mailbox to work in. They are generated from the OpenAPI contract, so none can do what the
 * API can't, and each is called as the mailbox agent, so none can do what it may not.
 */
const operationTools: Tool[] = agentTools.map(({ name, description, inputSchema }) => {
  const { method, summary } = operationNamed(name);
  const schema = inputSchema.json as { properties: Record<string, unknown>; required: string[] };
  return {
    name,
    title: summary,
    description,
    inputSchema: { ...schema, properties: { mailbox: mailboxInput, ...schema.properties } },
    annotations: { readOnlyHint: method === "get", destructiveHint: method === "delete" },
  };
});

export const mcpTools: Tool[] = [...ownTools, ...operationTools];

const instructions =
  "Duva is the human's email. These tools work in their own mailboxes through their mailbox agent: askAgent and giveAgentTask hand the agent itself a request, and the other tools act as the agent, within what the human lets it do in that mailbox. Everything is attributed to the agent, and its sends wait for the human's approval in Duva when they asked for that.";

const mcpClientKey = (id: string) => ({ [pk]: `mcp-client#${id}`, [sk]: "mcp-client" });
// A sign-in under way, by the state Duva gave managed login, and a code it gave back, by its hash.
const signInKey = (state: string) => ({ [pk]: `mcp-sign-in#${state}`, [sk]: "mcp-sign-in" });
const hashed = (secret: string) => createHash("sha256").update(secret).digest("base64url");
const codeKey = (code: string) => ({ [pk]: `mcp-code#${hashed(code)}`, [sk]: "mcp-code" });
// Which client a refresh token managed login gave was given to, by its hash, so only that client renews with it.
const refreshKey = (token: string) => ({ [pk]: `mcp-refresh#${hashed(token)}`, [sk]: "mcp-refresh" });

/** A mailbox of the human's, with its mailbox agent. */
interface AgentMailbox {
  mailbox: Mailbox;
  agent: Agent;
}

/** A page of Duva's own in the sign-in, which no other site may frame. */
const page = (status: number, title: string, body = "") =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Duva</title><style>body{font:16px/1.5 ui-monospace,monospace;max-width:34rem;margin:4rem auto;padding:0 1rem}button{font:inherit;padding:.4rem 1rem;margin-right:.5rem}</style></head><body><h1>${escaped(title)}</h1>${body}</body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'", "cache-control": "no-store" } },
  );

const escaped = (text: string) => text.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);

/** An OAuth error, as the registration and token endpoints answer one. */
const oauthError = (error: string, description: string, status = 400) => Response.json({ error, error_description: description }, { status });

type JsonRpcMessage = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

/** Something a tool refuses, with what to do instead, which the client reads as the tool's error. */
class Refused extends Error {}

/** The MCP endpoint, its OAuth documents and its registration endpoint, each request a Request on the API's own domain. */
export function createMcp(deployment: McpDeployment) {
  const { version, region, table, appClient, verifyAccessToken, turns, fetch: call = fetch, askWait } = deployment;
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const apiUrl = url.origin;
    const resource = `${apiUrl}${mcpPath}`;
    const resourceMetadata = `${apiUrl}${protectedResourcePaths[1]}`;
    if (protectedResourcePaths.includes(url.pathname)) {
      return Response.json({ resource, resource_name: "Duva", authorization_servers: [apiUrl], scopes_supported: mcpScopes, bearer_methods_supported: ["header"] });
    }
    // Cognito's own document names no registration endpoint and no PKCE method (docs/aws.md), and
    // MCP clients sign in through Duva's endpoints, so Duva's API is the authorization server.
    if (url.pathname === authorizationServerPath) {
      return Response.json({
        issuer: apiUrl,
        authorization_endpoint: `${apiUrl}${mcpAuthorizePath}`,
        token_endpoint: `${apiUrl}${mcpTokenPath}`,
        registration_endpoint: `${apiUrl}${mcpRegistrationPath}`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
        scopes_supported: mcpScopes,
      });
    }
    if (url.pathname === mcpRegistrationPath && request.method === "POST") return register(await request.text());
    if (url.pathname === mcpAuthorizePath && request.method === "GET") return authorize(url.searchParams);
    if (url.pathname === mcpAuthorizePath && request.method === "POST") return consented(new URLSearchParams(await request.text()), apiUrl);
    if (url.pathname === mcpCallbackPath && request.method === "GET") return signedIn(url.searchParams);
    if (url.pathname === mcpTokenPath && request.method === "POST") return exchange(new URLSearchParams(await request.text()), apiUrl);
    if (url.pathname !== mcpPath) return Response.json({ message: "Not Found" }, { status: 404 });
    // The endpoint keeps no session, so it has no stream to open and none to end.
    if (request.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } });

    const token = /^Bearer (.+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
    const human = token === undefined ? undefined : await humanOf(token);
    if (human === undefined) {
      const error = token === undefined ? "" : `, error="invalid_token", error_description="Sign in to Duva again."`;
      return Response.json({ message: "Sign in to Duva first." }, { status: 401, headers: { "www-authenticate": `Bearer resource_metadata="${resourceMetadata}"${error}` } });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(await request.text());
    } catch {
      return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "The request isn't JSON." } }, { status: 400 });
    }
    // MCP since 2025-06-18 sends one message a request, never a batch.
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Send one JSON-RPC message, as an object." } }, { status: 400 });
    }
    const answered = await answer(parsed as JsonRpcMessage, human, apiUrl);
    // Notifications and responses get no answer.
    return answered === undefined ? new Response(null, { status: 202 }) : Response.json(answered);
  };

  /** The human the access token is theirs, if it was issued to MCP clients and they are still in the organization. */
  async function humanOf(token: string): Promise<Human | undefined> {
    const claims = await verifyAccessToken(token).catch(() => undefined);
    return claims?.clientId === appClient ? findHumanBySignIn(table, claims.sub) : undefined;
  }

  async function answer({ id, method, params }: JsonRpcMessage, human: Human, apiUrl: string) {
    if (method === undefined || id === undefined || id === null) return undefined;
    const result = (value: unknown) => ({ jsonrpc: "2.0", id, result: value });
    const error = (code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });
    switch (method) {
      case "initialize": {
        const asked = params?.protocolVersion;
        return result({
          protocolVersion: typeof asked === "string" && mcpVersions.includes(asked) ? asked : mcpVersions[0],
          capabilities: { tools: {} },
          serverInfo: { name: "duva", title: "Duva", version },
          instructions,
        });
      }
      case "ping":
        return result({});
      case "tools/list":
        return result({ tools: mcpTools });
      case "tools/call": {
        const name = typeof params?.name === "string" ? params.name : "";
        if (!mcpTools.some((tool) => tool.name === name)) return error(-32602, `Duva has no tool ${JSON.stringify(name)}. List the tools to see them.`);
        const input = typeof params?.arguments === "object" && params.arguments !== null ? (params.arguments as Record<string, unknown>) : {};
        try {
          return result({ content: [{ type: "text", text: await useTool(human, apiUrl, name, input) }], isError: false });
        } catch (refused) {
          if (!(refused instanceof Refused)) throw refused;
          return result({ content: [{ type: "text", text: refused.message }], isError: true });
        }
      }
      default:
        return error(-32601, `Duva's MCP endpoint has no method ${method}.`);
    }
  }

  async function useTool(human: Human, apiUrl: string, name: string, input: Record<string, unknown>): Promise<string> {
    const mailboxes = await mailboxesWithAgents(human);
    if (name === "listMailboxes") {
      return JSON.stringify(
        await Promise.all(
          mailboxes.map(async ({ mailbox, agent }) => {
            const { settings } = await agentSettings(table, agent.id);
            return { id: mailbox.id, address: mailbox.defaultAddress ?? mailbox.addresses[0], addresses: mailbox.addresses, agentAccess: sponsorAccessIn(settings, mailbox.id), sendsWaitForApproval: settings.approvalAsSponsor };
          }),
        ),
      );
    }
    const { mailbox: asked, ...rest } = input;
    const { mailbox, agent } = mailboxAsked(mailboxes, asked);
    if (name === "readConversation") return JSON.stringify(await turnsOf(table, human.id, mailbox.id, 20));
    if (name === "askAgent" || name === "giveAgentTask") {
      const prepared = await prepareTurn({ table, region, apiUrl, available: turns !== undefined }, human, { mailbox: mailbox.id, words: rest.words });
      if ("statusCode" in prepared) throw new Refused(prepared.body.message);
      await turns!.start(prepared);
      const later = "Its answer will be in Ask Coo in Duva, and readConversation reads it.";
      if (name === "giveAgentTask") return `Your mailbox agent is on it. ${later}`;
      const answered = await agentAnswer(human, mailbox, prepared.turn);
      return answered === undefined ? `Your mailbox agent is still working on it. ${later}` : answerAsRead(answered);
    }
    if (!agentOperations.includes(name as (typeof agentOperations)[number])) throw new Refused(`Duva has no tool ${name}.`);
    // A paused agent's calls would each alert its sponsor, who is the one calling.
    if (agent.paused !== undefined) throw new Refused(`Your mailbox agent is paused by ${await actorNamed(table, agent.paused.by)}. Unpause it in Settings, under Your agents, to use Duva's tools.`);
    // Each call is one the mailbox agent makes, with a token of its own that ends with the call.
    const token = await issueRunToken(table, agent.id);
    try {
      const { action, result } = await callOperation({ apiUrl, token, mailbox: mailbox.id }, name, rest, call);
      if (!action.ok) throw new Refused(result);
      return result;
    } finally {
      await endRunToken(table, token);
    }
  }

  /** The human's own mailboxes that have a mailbox agent, each with it. */
  async function mailboxesWithAgents(human: Human): Promise<AgentMailbox[]> {
    const all = await Promise.all((await ownedMailboxes(table, human.id)).map(async (mailbox) => ({ mailbox, agent: await mailboxAgentOf(table, mailbox.id) })));
    return all.filter((each): each is AgentMailbox => each.agent !== undefined);
  }

  /** The agent's turn that answers the human's, once the run has written it, waiting no longer than askWait. */
  async function agentAnswer(human: Human, mailbox: Mailbox, asked: ConversationTurn): Promise<ConversationTurn | undefined> {
    const until = Date.now() + askWait;
    for (;;) {
      const turns = await turnsOf(table, human.id, mailbox.id, 20);
      const at = turns.findIndex(({ id }) => id === asked.id);
      const answered = at === -1 ? undefined : turns.slice(at + 1).find(({ from }) => from === "agent");
      if (answered !== undefined || Date.now() >= until) return answered;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  /** Registers an MCP client, as RFC 7591 has it. It keeps no secret, since it signs in with PKCE. */
  async function register(body: string): Promise<Response> {
    const refused = oauthError;
    let asked: Record<string, unknown>;
    try {
      asked = JSON.parse(body) as Record<string, unknown>;
    } catch {
      return refused("invalid_client_metadata", "The registration isn't JSON.");
    }
    const redirectUris = asked.redirect_uris;
    if (!Array.isArray(redirectUris) || redirectUris.length === 0 || redirectUris.length > 10 || !redirectUris.every((uri) => typeof uri === "string" && redirectable(uri))) {
      return refused("invalid_redirect_uri", "Give 1 to 10 redirect URIs, each https, or http to localhost, 127.0.0.1 or [::1], without a fragment.");
    }
    const grants = asked.grant_types ?? ["authorization_code"];
    if (!Array.isArray(grants) || !grants.every((grant) => grant === "authorization_code" || grant === "refresh_token")) {
      return refused("invalid_client_metadata", "Duva signs MCP clients in only with the authorization_code grant, and its refresh_token grant.");
    }
    const responses = asked.response_types ?? ["code"];
    if (!Array.isArray(responses) || !responses.every((type) => type === "code")) return refused("invalid_client_metadata", "Duva takes only the code response type.");
    const scopes = typeof asked.scope === "string" ? asked.scope.split(" ").filter(Boolean) : [];
    if (!scopes.every((scope) => mcpScopes.includes(scope))) return refused("invalid_client_metadata", `Duva's MCP clients may ask only for ${mcpScopes.join(" and ")}.`);
    const name = typeof asked.client_name === "string" ? asked.client_name.slice(0, 200) : undefined;
    const clientId = randomBytes(16).toString("hex");
    const issuedAt = Math.floor(Date.now() / 1000);
    await documents(table).send(new PutCommand({ TableName: table.name, Item: { ...mcpClientKey(clientId), ...(name !== undefined && { name }), redirectUris, at: new Date().toISOString(), [timeToLiveAttribute]: keptUntil() }, ...isNew }));
    // Whatever the client asked for, it authenticates with no secret, as RFC 7591 lets Duva answer.
    return Response.json(
      {
        client_id: clientId,
        client_id_issued_at: issuedAt,
        ...(name !== undefined && { client_name: name }),
        redirect_uris: redirectUris,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        scope: mcpScopes.join(" "),
      },
      { status: 201 },
    );
  }

  /** The registered MCP client's name and redirect URIs, or undefined if Duva registered no such client. */
  async function registered(client: string | null): Promise<{ name?: string; redirectUris: string[] } | undefined> {
    if (client === null || !/^[0-9a-f]{32}$/.test(client)) return undefined;
    const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: mcpClientKey(client), ConsistentRead: true }));
    return Item === undefined ? undefined : { name: Item.name as string | undefined, redirectUris: Item.redirectUris as string[] };
  }

  /**
   * Starts a sign-in for a registered MCP client: keeps where to send the human after, and asks them
   * first whether the app may work in their mail, naming it and where it sends them. Managed login
   * may let a human with a session through without a page of its own, so without this a link to sign
   * in to someone else's app would give it their mail unasked.
   */
  async function authorize(query: URLSearchParams): Promise<Response> {
    const redirectUri = query.get("redirect_uri") ?? "";
    const client = await registered(query.get("client_id"));
    // An unknown client or redirect gets a page, never a redirect, as OAuth asks.
    if (client === undefined) return page(400, "Duva doesn't know this app. Add it again.");
    if (!client.redirectUris.includes(redirectUri)) return page(400, "This app asked to be sent somewhere it didn't register. Add it again.");
    if (query.get("response_type") !== "code") return backWithError(redirectUri, query.get("state"), "unsupported_response_type", "Duva takes only the code response type.");
    const challenge = query.get("code_challenge");
    if (challenge === null || query.get("code_challenge_method") !== "S256") return backWithError(redirectUri, query.get("state"), "invalid_request", "Sign in with PKCE, with an S256 code challenge.");
    const state = randomBytes(32).toString("base64url");
    const expires = Date.now() + signInLifetime;
    await documents(table).send(
      new PutCommand({
        TableName: table.name,
        Item: { ...signInKey(state), client: query.get("client_id"), redirectUri, challenge, ...(query.has("state") && { state: query.get("state") }), until: expires, [timeToLiveAttribute]: Math.ceil(expires / 1000) },
      }),
    );
    const name = client.name ?? "An app";
    return page(
      200,
      `${name} asks to work in your mail`,
      `<p>It works through your mailbox agent: it can ask it things and hand it tasks, and do in your mailbox what you let the agent do. Its sends wait for your approval if the agent's do.</p><p>After you sign in, Duva sends you back to <strong>${escaped(new URL(redirectUri).host)}</strong>. Allow it only if you are adding ${escaped(name)} yourself.</p><form method="post"><input type="hidden" name="consent" value="${state}"><button name="decision" value="allow">Allow and sign in</button><button name="decision" value="deny">Don't allow</button></form>`,
    );
  }

  /** The human's answer on the page above: on to managed login for the MCP app client, back to Duva's callback, or back to the app refused. */
  async function consented(form: URLSearchParams, apiUrl: string): Promise<Response> {
    const state = form.get("consent") ?? "";
    const { Item: started } = await documents(table).send(new GetCommand({ TableName: table.name, Key: signInKey(state), ConsistentRead: true }));
    if (started === undefined || (started.until as number) <= Date.now()) return page(400, "This sign-in is over. Start it again from your app.");
    if (form.get("decision") !== "allow") {
      await documents(table).send(new DeleteCommand({ TableName: table.name, Key: signInKey(state) }));
      return backWithError(started.redirectUri as string, (started.state as string | undefined) ?? null, "access_denied", "You didn't allow it.");
    }
    await documents(table).send(new PutCommand({ TableName: table.name, Item: { ...started, consented: true } }));
    const to = new URL(`${deployment.signInUrl}/oauth2/authorize`);
    const asked = { client_id: appClient, response_type: "code", redirect_uri: `${apiUrl}${mcpCallbackPath}`, code_challenge: started.challenge as string, code_challenge_method: "S256", scope: mcpScopes.join(" "), state };
    for (const [name, value] of Object.entries(asked)) to.searchParams.set(name, value);
    return new Response(null, { status: 303, headers: { location: to.href } });
  }

  /** Managed login sends the human back here, and Duva sends them on to the MCP client, with the code and its own state, once. */
  async function signedIn(query: URLSearchParams): Promise<Response> {
    const { Attributes: started } = await documents(table).send(new DeleteCommand({ TableName: table.name, Key: signInKey(query.get("state") ?? ""), ReturnValues: "ALL_OLD" }));
    if (started === undefined || started.consented !== true || (started.until as number) <= Date.now()) return page(400, "This sign-in is over. Start it again from your app.");
    const to = new URL(started.redirectUri as string);
    const code = query.get("code");
    if (code !== null) {
      to.searchParams.set("code", code);
      const expires = Date.now() + signInLifetime;
      await documents(table).send(
        new PutCommand({ TableName: table.name, Item: { ...codeKey(code), client: started.client, redirectUri: started.redirectUri, until: expires, [timeToLiveAttribute]: Math.ceil(expires / 1000) } }),
      );
    } else {
      to.searchParams.set("error", query.get("error") ?? "access_denied");
      if (query.has("error_description")) to.searchParams.set("error_description", query.get("error_description")!);
    }
    if (typeof started.state === "string") to.searchParams.set("state", started.state);
    return new Response(null, { status: 302, headers: { location: to.href } });
  }

  /**
   * Exchanges a code, or renews a session, for a registered MCP client, at managed login's token
   * endpoint as the MCP app client. A code goes only to the client it was given for, with the redirect
   * URI it was given to, and the client's PKCE verifier proves it is the one that started the sign-in.
   */
  async function exchange(form: URLSearchParams, apiUrl: string): Promise<Response> {
    const refused = oauthError;
    const client = form.get("client_id");
    if ((await registered(client)) === undefined) return refused("invalid_client", "Duva doesn't know this app. Add it again.", 401);
    const passed = new URLSearchParams({ client_id: appClient });
    const grant = form.get("grant_type");
    if (grant === "authorization_code") {
      const code = form.get("code") ?? "";
      // A code tried by the wrong client, or to the wrong place, is used up, as one that leaked should be.
      const { Attributes: given } = await documents(table).send(new DeleteCommand({ TableName: table.name, Key: codeKey(code), ReturnValues: "ALL_OLD" }));
      if (given === undefined || (given.until as number) <= Date.now() || given.client !== client || given.redirectUri !== form.get("redirect_uri")) {
        return refused("invalid_grant", "The code isn't one Duva gave this app, or it has expired. Sign in again.");
      }
      for (const [name, value] of Object.entries({ grant_type: grant, code, redirect_uri: `${apiUrl}${mcpCallbackPath}`, code_verifier: form.get("code_verifier") ?? "" })) passed.set(name, value);
    } else if (grant === "refresh_token") {
      const refreshToken = form.get("refresh_token") ?? "";
      const { Item: given } = await documents(table).send(new GetCommand({ TableName: table.name, Key: refreshKey(refreshToken), ConsistentRead: true }));
      if (given?.client !== client) return refused("invalid_grant", "This session isn't this app's. Sign in again.");
      for (const [name, value] of Object.entries({ grant_type: grant, refresh_token: refreshToken })) passed.set(name, value);
    } else return refused("unsupported_grant_type", "Duva takes the authorization_code and refresh_token grants.");
    const answer = await call(new Request(`${deployment.signInUrl}/oauth2/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: passed }));
    const text = await answer.text();
    // Each refresh token managed login gives is the client's own. Managed login's tokens are kept nowhere else.
    const refreshToken = answer.ok ? ((JSON.parse(text) as { refresh_token?: unknown }).refresh_token) : undefined;
    if (typeof refreshToken === "string") await documents(table).send(new PutCommand({ TableName: table.name, Item: { ...refreshKey(refreshToken), client, [timeToLiveAttribute]: keptUntil() } }));
    if (answer.ok) {
      await documents(table).send(
        new UpdateCommand({ TableName: table.name, Key: mcpClientKey(client!), UpdateExpression: "SET #expires = :until", ExpressionAttributeNames: { "#expires": timeToLiveAttribute }, ExpressionAttributeValues: { ":until": keptUntil() } }),
      );
      if (grant === "refresh_token") {
        await documents(table).send(
          new UpdateCommand({ TableName: table.name, Key: refreshKey(form.get("refresh_token")!), UpdateExpression: "SET #expires = :until", ExpressionAttributeNames: { "#expires": timeToLiveAttribute }, ExpressionAttributeValues: { ":until": keptUntil() } }),
        );
      }
    }
    return new Response(text, { status: answer.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  }
}

/** The mailbox the tool asks for, by ID or address, among the human's, or their one if it asks for none. */
function mailboxAsked(mailboxes: AgentMailbox[], asked: unknown): AgentMailbox {
  if (asked === undefined || asked === null || asked === "") {
    if (mailboxes.length === 1) return mailboxes[0]!;
    if (mailboxes.length === 0) throw new Refused("You have no mailbox with a mailbox agent. Ask an admin to create a mailbox for you.");
    throw new Refused(`You have ${mailboxes.length} mailboxes. Say which, by its address: ${mailboxes.map(({ mailbox }) => mailbox.defaultAddress ?? mailbox.addresses[0]).join(", ")}.`);
  }
  const wanted = String(asked).toLowerCase();
  const found = mailboxes.find(({ mailbox }) => mailbox.id === asked || mailbox.addresses.some((address) => address.toLowerCase() === wanted));
  if (found === undefined) throw new Refused(`${String(asked)} isn't one of your mailboxes. listMailboxes lists them.`);
  return found;
}

/** The agent's answer, with what it did and how its run ended, as the MCP client reads it. */
function answerAsRead({ text, actions, outcome }: ConversationTurn): string {
  const ended = { answered: "", failed: "\n\nIts run failed before it finished.", capReached: "\n\nIt stopped at the organization's spend cap for mailbox agents." }[outcome ?? "answered"];
  return `${text}${actions.length > 0 ? `\n\n(${actionsRead(actions, "It")})` : ""}${ended}`;
}

/** Sends the human back to the client with an OAuth error, and the client's state. */
function backWithError(redirectUri: string, state: string | null, error: string, description: string): Response {
  const to = new URL(redirectUri);
  to.searchParams.set("error", error);
  to.searchParams.set("error_description", description);
  if (state !== null) to.searchParams.set("state", state);
  return new Response(null, { status: 302, headers: { location: to.href } });
}

/** Whether Cognito takes the URI as a callback: https, or http only to the machine itself, and no fragment (docs/aws.md). */
function redirectable(uri: string): boolean {
  try {
    const url = new URL(uri);
    if (url.hash !== "" || uri.includes("#")) return false;
    return url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
  } catch {
    return false;
  }
}
