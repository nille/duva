import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { expect, test } from "vitest";
import { operations } from "@duva/openapi";
import type { Model } from "../src/agent-loop.ts";
import { type DuvaOptions, startDuva } from "./harness.ts";
import { managedLoginReached, signInSteps } from "./mcp-sign-in.ts";

/**
 * A deployment on example.com where Ada is the first admin and Linus a human with the mailbox
 * linus@example.com, its Screener off, and a message from Grace in it. Grace is another human.
 */
async function withMailbox(options: DuvaOptions = {}) {
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org", humans: ["linus@example.org", "grace@example.org"], ...options });
  const ada = duva.signIn("ada@example.org");
  const linus = duva.signIn("linus@example.org");
  const { data: linusActor } = await linus.GET("/whoami");
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: linusActor!.id, address: "linus@example.com" } });
  const params = { path: { mailbox: mailbox!.id } };
  await linus.PATCH("/mailboxes/{mailbox}/screener", { params, body: { on: false } });
  await duva.receive(
    "From: Grace Hopper <grace@example.org>\r\nTo: linus@example.com\r\nSubject: The report\r\nDate: Sat, 03 Oct 2026 10:00:00 +0000\r\nMessage-ID: <report-1@example.org>\r\n\r\nHere is the quarterly report.\r\n",
    { to: ["linus@example.com"] },
  );
  const agent = (await linus.GET("/mailboxes/{mailbox}/agent", { params })).data!.agent;
  return { duva, ada, linus, mailbox: mailbox!, params, agent };
}

/** What the tool answered, as text, and whether it was an error. */
async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const { content, isError } = (await client.callTool({ name, arguments: args })) as { content: { type: string; text: string }[]; isError?: boolean };
  return { text: content.map(({ text }) => text).join(""), isError: isError ?? false };
}

/** What the tool answered, as JSON. */
const json = async (client: Client, name: string, args: Record<string, unknown> = {}) => JSON.parse((await call(client, name, args)).text) as any;

test("an MCP client signs in with the human's Duva account through the deployment's user pool, registering itself, and lists Duva's tools", async () => {
  const { duva } = await withMailbox();

  const { client, registered } = await duva.mcp("linus@example.org", { clientName: "Claude Code" });

  expect(client.getServerVersion()).toMatchObject({ name: "duva" });
  expect(registered).toMatchObject({ client_id: expect.any(String), token_endpoint_auth_method: "none", redirect_uris: ["http://localhost:33418/callback"] });
  const { tools } = await client.listTools();
  expect(tools.map(({ name }) => name)).toEqual(expect.arrayContaining(["listMailboxes", "askAgent", "giveAgentTask", "readConversation", "searchMailbox", "getThread", "labelThreads", "createDraft", "sendDraft"]));
  // An operation's tool is generated from the contract: its options, and the mailbox to work in.
  const getThread = tools.find(({ name }) => name === "getThread")!;
  const operation = operations.find(({ operationId }) => operationId === "getThread")!;
  expect(Object.keys(getThread.inputSchema.properties!).sort()).toEqual(["mailbox", ...operation.options.filter(({ name }) => name !== "mailbox").map(({ name }) => name)].sort());
  expect(getThread.inputSchema.required).toEqual(["thread"]);
  expect(getThread.annotations).toMatchObject({ readOnlyHint: true });
  for (const { name } of tools.filter(({ name }) => !["listMailboxes", "askAgent", "giveAgentTask", "readConversation"].includes(name))) {
    expect(operations.map(({ operationId }) => operationId)).toContain(name);
  }
});

test("the endpoint answers a call without a session with 401, naming where to find how to sign in, and Duva as the server that registers MCP clients and signs them in", async () => {
  const { duva } = await withMailbox();
  const { url, close } = await duva.listen();

  const refused = await fetch(`${url}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
  const resource = await (await fetch(`${url}/.well-known/oauth-protected-resource/mcp`)).json();
  const server = await (await fetch(`${url}/.well-known/oauth-authorization-server`)).json();
  const forged = await fetch(`${url}/mcp`, { method: "POST", headers: { authorization: "Bearer forged", "content-type": "application/json" }, body: "{}" });
  const opened = await fetch(`${url}/mcp`);
  await close();

  expect(refused.status).toBe(401);
  expect(refused.headers.get("www-authenticate")).toBe(`Bearer resource_metadata="${url}/.well-known/oauth-protected-resource/mcp"`);
  expect(resource).toEqual({ resource: `${url}/mcp`, resource_name: "Duva", authorization_servers: [url], scopes_supported: ["openid", "email"], bearer_methods_supported: ["header"] });
  expect(server).toMatchObject({
    issuer: url,
    authorization_endpoint: `${url}/mcp/authorize`,
    token_endpoint: `${url}/mcp/token`,
    registration_endpoint: `${url}/mcp/register`,
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
  });
  expect(forged.status).toBe(401);
  expect(forged.headers.get("www-authenticate")).toMatch(/error="invalid_token"/);
  expect(opened.status).toBe(405);
});

test("registration takes only redirect URIs Cognito does, and a client that asks for a secret is registered without one", async () => {
  const { duva } = await withMailbox();
  const register = (body: object) => duva.listen().then(async ({ url, close }) => {
    const answer = await fetch(`${url}/mcp/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    await close();
    return { status: answer.status, body: (await answer.json()) as Record<string, unknown> };
  });

  const plain = await register({ redirect_uris: ["http://example.org/callback"], token_endpoint_auth_method: "none" });
  const fragment = await register({ redirect_uris: ["https://example.org/callback#here"], token_endpoint_auth_method: "none" });
  const implicit = await register({ redirect_uris: ["https://example.org/callback"], response_types: ["token"] });
  const desktop = await register({ client_name: "Claude", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] });

  expect(plain).toMatchObject({ status: 400, body: { error: "invalid_redirect_uri" } });
  expect(fragment).toMatchObject({ status: 400, body: { error: "invalid_redirect_uri" } });
  expect(implicit).toMatchObject({ status: 400, body: { error: "invalid_client_metadata" } });
  // RFC 7591's default is a client with a secret, which Duva may answer otherwise.
  expect(desktop).toMatchObject({ status: 201, body: { client_name: "Claude", token_endpoint_auth_method: "none", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] } });
  expect(desktop.body.client_secret).toBeUndefined();
  const { client } = await duva.mcp("linus@example.org", { tokenEndpointAuthMethod: "client_secret_post" });
  expect((await client.listTools()).tools.length).toBeGreaterThan(4);
});

test("a sign-in first asks the human to allow the app, naming it and where it sends them, and goes back only to a redirect URI the app registered", async () => {
  const { duva } = await withMailbox();
  const { url, close } = await duva.listen();
  const { register, authorize, consent, decide, signIn } = await signInSteps(url);
  const mine = await register();

  const elsewhere = await authorize(mine.client_id, "http://localhost:9999/callback");
  const unknown = await authorize("0".repeat(32));
  const asking = await authorize(mine.client_id);
  const page = await asking.clone().text();
  const denied = await decide(await consent(await authorize(mine.client_id)), "deny");
  const allowed = await decide(await consent(asking), "allow");
  const toLogin = allowed.headers.get("location")!;
  const back = new URL((await signIn(toLogin)).headers.get("location")!);
  // A sign-in the human never allowed gets nowhere, even through managed login.
  const unasked = await fetch(`${url}/mcp/callback?code=x&state=${new URL(toLogin).searchParams.get("state")}`);
  await close();

  expect([elsewhere.status, unknown.status]).toEqual([400, 400]);
  expect(asking.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  expect(page).toContain("Claude Code asks to work in your mail");
  expect(page).toContain("<strong>localhost:1234</strong>");
  expect(new URL(denied.headers.get("location")!).searchParams.get("error")).toBe("access_denied");
  expect(new URL(toLogin).searchParams.get("client_id")).toBe("duva-test-mcp-client");
  expect(new URL(toLogin).searchParams.get("redirect_uri")).toBe(`${url}/mcp/callback`);
  expect(`${back.origin}${back.pathname}`).toBe("http://localhost:1234/callback");
  expect(back.searchParams.get("state")).toBe("mine");
  expect(back.searchParams.get("code")).toEqual(expect.any(String));
  expect(unasked.status).toBe(400);
});

test("a registered client's sign-in reaches managed login for the MCP app client once the human allows it, as the deployment check sees it, and an unknown client's reaches nothing", async () => {
  const { duva } = await withMailbox();
  const { url, close } = await duva.listen();

  const problem = await managedLoginReached(url, url, "duva-test-mcp-client");
  await close();

  expect(problem).toBeUndefined();
});

test("a sign-in's code goes only to the app it was given for, once, and a try by another app uses it up", async () => {
  const { duva } = await withMailbox();
  const { url, close } = await duva.listen();
  const { register, authorize, consent, decide, signIn, exchange } = await signInSteps(url);
  const [mine, theirs] = [await register(), await register()];
  const code = async () => new URL((await signIn((await decide(await consent(await authorize(mine.client_id)), "allow")).headers.get("location")!)).headers.get("location")!).searchParams.get("code")!;

  const first = await code();
  const exchanged = await exchange(mine.client_id, first);
  const again = await exchange(mine.client_id, first);
  const second = await code();
  const stolen = await exchange(theirs.client_id, second);
  const after = await exchange(mine.client_id, second);
  await close();

  expect(exchanged.status).toBe(200);
  expect(await exchanged.json()).toMatchObject({ access_token: expect.any(String), refresh_token: expect.any(String) });
  expect([again.status, stolen.status, after.status]).toEqual([400, 400, 400]);
});

test("an MCP client renews its session through the MCP endpoint, and no other registered client can renew it", async () => {
  const { duva } = await withMailbox();
  const { tokens, registered, client } = await duva.mcp("linus@example.org");
  const { url, close } = await duva.listen();
  const { register } = await signInSteps(url);
  const other = await register();
  const renew = (clientId: string) => fetch(`${url}/mcp/token`, { method: "POST", body: new URLSearchParams({ grant_type: "refresh_token", client_id: clientId, refresh_token: tokens.refresh_token! }) });

  const foreign = await renew(other.client_id);
  const renewed = await renew(registered.client_id);
  const unknown = await renew("f".repeat(32));
  await close();

  expect(foreign.status).toBe(400);
  expect(renewed.status).toBe(200);
  expect(await renewed.json()).toMatchObject({ access_token: expect.any(String), token_type: "Bearer" });
  expect(unknown.status).toBe(401);
  expect((await client.listTools()).tools.length).toBeGreaterThan(4);
});

test("the endpoint takes one JSON-RPC message a request, and refuses anything else", async () => {
  const { duva } = await withMailbox();
  const { tokens } = await duva.mcp("linus@example.org");
  const { url, close } = await duva.listen();
  const post = (body: string) => fetch(`${url}/mcp`, { method: "POST", headers: { authorization: `Bearer ${tokens.access_token}`, "content-type": "application/json" }, body });

  const answers = await Promise.all(["null", "[]", '[{"jsonrpc":"2.0","id":1,"method":"ping"}]', "{not json"].map(post));
  const ping = await post('{"jsonrpc":"2.0","id":7,"method":"ping"}');
  const notified = await post('{"jsonrpc":"2.0","method":"notifications/initialized"}');
  await close();

  expect(answers.map(({ status }) => status)).toEqual([400, 400, 400, 400]);
  expect(await ping.json()).toEqual({ jsonrpc: "2.0", id: 7, result: {} });
  expect(notified.status).toBe(202);
});

test("an MCP client's session opens only the MCP endpoint, so it can't approve the sends it asks for, and the web app's opens only the API", async () => {
  const { duva } = await withMailbox();
  const { tokens } = await duva.mcp("linus@example.org");
  const { url, close } = await duva.listen();

  const api = await fetch(`${url}/approvals`, { headers: { authorization: `Bearer ${tokens.access_token}` } });
  const mcp = await fetch(`${url}/mcp`, {
    method: "POST",
    headers: { authorization: `Bearer ${duva.accessToken("linus@example.org")}`, "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  await close();

  expect(api.status).toBe(401);
  expect(mcp.status).toBe(401);
});

test("the tools work in the human's mailbox as its mailbox agent, so what they do is attributed to it", async () => {
  const { duva, linus, mailbox, params, agent } = await withMailbox();
  const { client } = await duva.mcp("linus@example.org");

  const mailboxes = await json(client, "listMailboxes");
  const found = await json(client, "searchMailbox", { q: "report" });
  const threads = await json(client, "listThreads", { mailbox: "linus@example.com" });
  const marked = await call(client, "markThreadsRead", { threads: [threads.threads[0].id] });

  expect(mailboxes).toEqual([{ id: mailbox.id, address: "linus@example.com", addresses: ["linus@example.com"], agentAccess: "send", sendsWaitForApproval: true }]);
  expect(found.results).toHaveLength(1);
  expect(marked.isError).toBe(false);
  const { data: changes } = await linus.GET("/mailboxes/{mailbox}/changes", { params });
  expect(changes!.changes.at(-1)).toMatchObject({ type: "threadRead", actor: agent.id });
});

test("the tools can do only what the human lets the mailbox agent do, and say Duva's refusal", async () => {
  const { duva, linus, agent } = await withMailbox();
  await linus.PATCH("/agents/{agent}/settings", { params: { path: { agent: agent.id } }, body: { sponsorAccess: "read" } });
  const { client } = await duva.mcp("linus@example.org");

  const listed = await call(client, "listThreads");
  const drafted = await call(client, "createDraft", { to: ["grace@example.org"], text: "Hello" });

  expect(listed.isError).toBe(false);
  expect(drafted).toEqual({ isError: true, text: expect.stringContaining("Your sponsor access is read, which doesn't let you write or change drafts") });
  expect((await json(client, "listMailboxes"))[0].agentAccess).toBe("read");
});

test("a send through MCP waits for the human's approval, as the mailbox agent's sends do", async () => {
  const { duva, linus, agent } = await withMailbox();
  const { client } = await duva.mcp("linus@example.org");

  const draft = await json(client, "createDraft", { to: ["grace@example.org"], subject: "Thanks", text: "Thanks for the report." });
  const sent = await call(client, "sendDraft", { draft: draft.id });

  expect(sent.isError).toBe(false);
  expect(duva.sent()).toEqual([]);
  const { data } = await linus.GET("/approvals");
  expect(data!.approvals).toEqual([expect.objectContaining({ agent: agent.id, state: "pending", draft: expect.objectContaining({ id: draft.id }) })]);
});

test("a paused mailbox agent's tools are refused", async () => {
  const { duva, linus, agent } = await withMailbox();
  await linus.POST("/agents/{agent}/pause", { params: { path: { agent: agent.id } } });
  const { client } = await duva.mcp("linus@example.org");

  expect(await call(client, "listThreads")).toEqual({ isError: true, text: "Your mailbox agent is paused by linus@example.org. Unpause it in Settings, under Your agents, to use Duva's tools." });
});

test("asking the mailbox agent over MCP gives its answer, in the same conversation as Ask Coo", async () => {
  const model: Model = async function* ({ messages }) {
    if (messages.length === 1) yield { toolUse: { toolUseId: "1", name: "searchMailbox", input: { q: "report" } } };
    else yield { text: "Grace sent you the quarterly report." };
    yield { usage: { inputTokens: 1000, outputTokens: 100 } };
  };
  const { duva, linus, params } = await withMailbox({ model });
  const { client } = await duva.mcp("linus@example.org");

  const answer = await call(client, "askAgent", { words: "Anything from Grace?" });

  expect(answer).toEqual({ isError: false, text: "Grace sent you the quarterly report.\n\n(It used searchMailbox.)" });
  const { data } = await linus.GET("/mailboxes/{mailbox}/agent", { params });
  expect(data!.turns.map(({ from, text }) => [from, text])).toEqual([
    ["human", "Anything from Grace?"],
    ["agent", "Grace sent you the quarterly report."],
  ]);
});

test("an answer that takes longer than the call waits is read later, and a task is handed over without waiting", async () => {
  const model: Model = async function* () {
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    yield { text: "Done, slowly." };
    yield { usage: { inputTokens: 1000, outputTokens: 100 } };
  };
  const { duva, linus, params } = await withMailbox({ model });
  const { client } = await duva.mcp("linus@example.org");

  const asked = await call(client, "askAgent", { words: "Take your time." });
  const tasked = await call(client, "giveAgentTask", { words: "Label the report Work." });

  expect(asked.text).toBe("Your mailbox agent is still working on it. Its answer will be in Ask Coo in Duva, and readConversation reads it.");
  expect(tasked.text).toBe("Your mailbox agent is on it. Its answer will be in Ask Coo in Duva, and readConversation reads it.");
  const { data } = await linus.GET("/mailboxes/{mailbox}/agent", { params });
  expect(data!.turns.filter(({ from }) => from === "agent").map(({ text, outcome }) => [text, outcome])).toEqual([
    ["Done, slowly.", "answered"],
    ["Done, slowly.", "answered"],
  ]);
  expect((await json(client, "readConversation")).map(({ from }: { from: string }) => from)).toEqual(["human", "human", "agent", "agent"]);
});

test("each human works only in their own mailboxes", async () => {
  const { duva, mailbox } = await withMailbox();
  const { client } = await duva.mcp("grace@example.org");

  expect(await json(client, "listMailboxes")).toEqual([]);
  expect(await call(client, "listThreads", { mailbox: "linus@example.com" })).toEqual({ isError: true, text: "linus@example.com isn't one of your mailboxes. listMailboxes lists them." });
  expect((await call(client, "askAgent", { mailbox: mailbox.id, words: "Hello?" })).isError).toBe(true);
});

test("a human removed from the organization can't use the MCP endpoint any more", async () => {
  const { duva, ada } = await withMailbox();
  const { tokens } = await duva.mcp("grace@example.org");
  const grace = (await duva.signIn("grace@example.org").GET("/whoami")).data!;
  const { url, close } = await duva.listen();

  await ada.POST("/humans/{human}/remove", { params: { path: { human: grace.id } }, body: { handOver: [], delete: [] } });

  const answer = await fetch(`${url}/mcp`, { method: "POST", headers: { authorization: `Bearer ${tokens.access_token}`, "content-type": "application/json" }, body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' });
  await close();
  expect(answer.status).toBe(401);
});
