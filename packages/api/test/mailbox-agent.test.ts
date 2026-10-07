import PostalMime from "postal-mime";
import { expect, test } from "vitest";
import type { Model, ModelEvent, ModelMessage } from "../src/agent-loop.ts";
import { type DuvaOptions, startDuva } from "./harness.ts";

type Request = Parameters<Model>[0];

/**
 * A stand-in for Claude that takes one step of the script per model call, each from what it was
 * asked, and records every request. Past the script's end it answers "Done.".
 */
function scripted(...steps: ((request: Request) => ModelEvent[])[]) {
  const requests: Request[] = [];
  let step = 0;
  const model: Model = async function* (request) {
    requests.push(structuredClone(request));
    const events = steps[step++]?.(request) ?? [{ text: "Done." }];
    for (const event of events) yield event;
    yield { usage: { inputTokens: 1000, outputTokens: 100 } };
  };
  return { model, requests };
}

/** A step that uses the tool. */
const use = (name: string, input: Record<string, unknown> = {}): ModelEvent => ({ toolUse: { toolUseId: `${name}-${Math.random()}`, name, input } });

/** What the last tool the model used answered, as JSON. */
const lastResult = (messages: ModelMessage[]) => {
  for (const block of messages.at(-1)!.content.toReversed()) if ("toolResult" in block) return JSON.parse(block.toolResult.content[0]!.text) as Record<string, any>;
  throw new Error("No tool answered.");
};

/**
 * A deployment on example.com where Ada is the first admin and Linus a human with the mailbox
 * linus@example.com, its Screener off. Grace is another human, with grace@example.com.
 */
async function withMailbox(options: DuvaOptions = {}) {
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org", humans: ["linus@example.org", "grace@example.org"], ...options });
  const ada = duva.signIn("ada@example.org");
  const linus = duva.signIn("linus@example.org");
  const grace = duva.signIn("grace@example.org");
  const { data: linusActor } = await linus.GET("/whoami");
  const { data: graceActor } = await grace.GET("/whoami");
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: linusActor!.id, address: "linus@example.com" } });
  const params = { path: { mailbox: mailbox!.id } };
  await linus.PATCH("/mailboxes/{mailbox}/screener", { params, body: { on: false } });
  const ask = (words: string, email = "linus@example.org", mailboxId = mailbox!.id) => duva.askAgent(email, { mailbox: mailboxId, words });
  const agent = async () => (await linus.GET("/mailboxes/{mailbox}/agent", { params })).data!.agent;
  return { duva, ada, linus, grace, linusId: linusActor!.id, graceId: graceActor!.id, mailbox: mailbox!, params, ask, agent };
}

const fromGrace = (subject: string, text: string, id = "report-1") =>
  `From: Grace Hopper <grace@example.org>\r\nTo: linus@example.com\r\nSubject: ${subject}\r\nDate: Sat, 03 Oct 2026 10:00:00 +0000\r\nMessage-ID: <${id}@example.org>\r\n\r\n${text}\r\n`;

test("a human's new mailbox gets a mailbox agent its owner sponsors, which may read, organize, draft and ask to send there", async () => {
  const { linus, mailbox, params, linusId } = await withMailbox();

  const { response, data } = await linus.GET("/mailboxes/{mailbox}/agent", { params });

  expect(response.status).toBe(200);
  expect(data).toEqual({ agent: { id: expect.any(String), kind: "agent", name: "Coo", sponsor: linusId, mailbox: mailbox.id }, turns: [] });
  expect((await linus.GET("/agents")).data!.agents).toEqual([{ ...data!.agent, sendsLeftThisHour: 100 }]);
  const { data: settings } = await linus.GET("/agents/{agent}/settings", { params: { path: { agent: data!.agent.id } } });
  expect(settings).toMatchObject({ sponsorAccess: "send", sponsorMailboxes: [mailbox.id], approvalAsSponsor: true, disclosureLineAsSponsor: true });
});

test("mailboxes from before mailbox agents get theirs at the setup after the deploy that brings them", async () => {
  const { duva, linus, params } = await withMailbox({ beforeMailboxAgents: true });
  expect((await linus.GET("/mailboxes/{mailbox}/agent", { params })).response.status).toBe(404);

  await duva.setUp({ admin: "ada@example.org" });
  await duva.setUp({ admin: "ada@example.org" });

  expect((await linus.GET("/mailboxes/{mailbox}/agent", { params })).response.status).toBe(200);
  expect((await linus.GET("/agents")).data!.agents).toHaveLength(1);
});

test("mailbox agents from before Coo are named Coo at the setup after the deploy that names them", async () => {
  const { duva, agent } = await withMailbox({ beforeCoo: true });
  expect((await agent()).name).toBe("Mailbox agent");

  await duva.setUp({ admin: "ada@example.org" });

  expect((await agent()).name).toBe("Coo");
});

test("a mailbox handed over gets a mailbox agent its new owner sponsors", async () => {
  const { ada, grace, graceId, linusId, mailbox, params } = await withMailbox();

  await ada.POST("/humans/{human}/remove", { params: { path: { human: linusId } }, body: { handOver: [mailbox.id], handTo: graceId, delete: [] } });

  const { data } = await grace.GET("/mailboxes/{mailbox}/agent", { params });
  expect(data!.agent.sponsor).toBe(graceId);
  expect((await grace.GET("/agents")).data!.agents).toEqual([expect.objectContaining({ id: data!.agent.id, mailbox: mailbox.id })]);
});

test("a mailbox agent works only in its mailbox, has no key, owns no mailbox, and goes only with its mailbox", async () => {
  const { linus, ada, agent } = await withMailbox();
  const path = { params: { path: { agent: (await agent()).id } } };
  const { data: other } = await ada.POST("/mailboxes", { body: { owner: (await linus.GET("/whoami")).data!.id, address: "linus.other@example.com" } });

  const moved = await linus.PATCH("/agents/{agent}/settings", { ...path, body: { sponsorMailboxes: [other!.id] } });
  const all = await linus.PATCH("/agents/{agent}/settings", { ...path, body: { sponsorMailboxes: null } });
  const rotated = await linus.POST("/agents/{agent}/key", path);
  const removed = await linus.DELETE("/agents/{agent}", path);

  expect(moved.response.status).toBe(400);
  expect(all.response.status).toBe(400);
  expect(rotated.response.status).toBe(409);
  expect((rotated.error as { message: string }).message).toMatch(/no key/);
  expect(removed.response.status).toBe(409);
  const owned = await ada.POST("/mailboxes", { body: { owner: (await agent()).id, address: "agent@example.com" } });
  expect(owned.response.status).toBe(400);
  expect((owned.error as { message: string }).message).toBe("Agents own no mailboxes. Give the ID of a human, and have them give the agent sponsor access to theirs.");
  expect((await linus.PATCH("/agents/{agent}/settings", { ...path, body: { sponsorAccess: "read" } })).response.status).toBe(200);
});

test("the mailbox agent answers from what its tools read in the mailbox, streaming what it says and does, as the agent", async () => {
  const { model, requests } = scripted(
    () => [{ text: "Let me look. " }, use("searchMailbox", { q: "report" })],
    (request) => [{ text: `You have ${lastResult(request.messages).results.length} thread about the report.` }],
  );
  const { duva, mailbox, ask } = await withMailbox({ model });
  await duva.receive(fromGrace("The report", "Here is the quarterly report."), { to: ["linus@example.com"] });

  const { status, events } = await ask("Is there anything about the report?");

  expect(status).toBe(200);
  expect(events!.map((event) => event.type)).toEqual(["turn", "text", "action", "text", "done"]);
  expect(events![0]).toEqual({ type: "turn", turn: { id: expect.any(String), at: expect.any(String), from: "human", text: "Is there anything about the report?", actions: [] } });
  expect(events![2]).toEqual({ type: "action", action: { operation: "searchMailbox", what: expect.stringMatching(/^Search/), ok: true } });
  expect(events!.at(-1)).toEqual({
    type: "done",
    turn: { id: expect.any(String), at: expect.any(String), from: "agent", text: "Let me look. You have 1 thread about the report.", actions: [expect.objectContaining({ operation: "searchMailbox" })], outcome: "answered" },
  });
  // The model's tools are Duva's operations, in the agent's own mailbox.
  expect(requests[0]!.tools.map(({ name }) => name)).toContain("getThread");
  expect(requests[0]!.tools.find(({ name }) => name === "getThread")!.inputSchema.json).toEqual(expect.objectContaining({ required: ["thread"] }));
  expect(requests[0]!.system).toContain("linus@example.org's mailbox linus@example.com");
  void mailbox;
});

test("what the mailbox agent does is attributed to it in the mailbox's change feed", async () => {
  const { model } = scripted(
    () => [use("listThreads")],
    (request) => [use("markThreadsRead", { threads: [lastResult(request.messages).threads[0].id] })],
  );
  const { duva, linus, params, ask, agent } = await withMailbox({ model });
  await duva.receive(fromGrace("The report", "Here it is."), { to: ["linus@example.com"] });

  const { events } = await ask("Mark the report read.");

  const { data: threads } = await linus.GET("/mailboxes/{mailbox}/threads", { params });
  expect(events!.find((event) => event.type === "action" && event.action.operation === "markThreadsRead")).toEqual({
    type: "action",
    action: { operation: "markThreadsRead", what: expect.any(String), ok: true, threads: [threads!.threads[0]!.id] },
  });
  const { data: changes } = await linus.GET("/mailboxes/{mailbox}/changes", { params });
  expect(changes!.changes.at(-1)).toMatchObject({ type: "threadRead", actor: (await agent()).id });
});

test("a reply the mailbox agent drafts and asks to send waits for its owner's approval, and goes out from their address with the disclosure", async () => {
  const { model } = scripted(
    () => [use("listThreads")],
    (request) => [use("getThread", { thread: lastResult(request.messages).threads[0].id })],
    (request) => [use("createDraft", { answers: lastResult(request.messages).messages[0].id, text: "Thanks, I'll read it." })],
    (request) => [use("sendDraft", { draft: lastResult(request.messages).id })],
    () => [{ text: "I drafted a reply. It waits for your approval." }],
  );
  const { duva, linus, ask, agent } = await withMailbox({ model });
  await duva.receive(fromGrace("The report", "Here is the quarterly report."), { to: ["linus@example.com"] });

  const { events } = await ask("Thank Grace for the report.");

  const done = events!.at(-1)!;
  expect(done.type === "done" && done.turn.actions.map(({ operation, ok }) => [operation, ok])).toEqual([
    ["listThreads", true],
    ["getThread", true],
    ["createDraft", true],
    ["sendDraft", true],
  ]);
  const draft = done.type === "done" ? done.turn.actions[2]!.draft : undefined;
  expect(duva.sent()).toEqual([]);
  const { data } = await linus.GET("/approvals");
  expect(data!.approvals).toEqual([expect.objectContaining({ agent: (await agent()).id, state: "pending", draft: expect.objectContaining({ id: draft }) })]);

  await linus.POST("/approvals/{approval}/send", { params: { path: { approval: data!.approvals[0]!.id } } });

  const mail = await PostalMime.parse(duva.sent()[0]!);
  expect(mail.from).toEqual({ name: "", address: "linus@example.com" });
  expect(mail.text).toBe("Thanks, I'll read it.\n\nSent by Coo for linus@example.org\n");
});

test("the mailbox agent can do only what its sponsor access lets it, and says Duva's refusal", async () => {
  const { model, requests } = scripted(() => [use("createDraft", { to: ["grace@example.org"], text: "Hello" })], () => [{ text: "I can't write drafts." }]);
  const { linus, ask, agent } = await withMailbox({ model });
  await linus.PATCH("/agents/{agent}/settings", { params: { path: { agent: (await agent()).id } }, body: { sponsorAccess: "read" } });

  const { events } = await ask("Write to Grace.");

  expect(events!.find((event) => event.type === "action")).toEqual({
    type: "action",
    action: { operation: "createDraft", what: expect.any(String), ok: false, message: "Your sponsor access is read, which doesn't let you write or change drafts in your sponsor's mailbox. Ask your sponsor for draft access." },
  });
  expect(requests[0]!.system).toContain("not change it");
});

test("a mailbox agent with no access, or paused, isn't asked", async () => {
  const { linus, ask, agent } = await withMailbox();
  const path = { params: { path: { agent: (await agent()).id } } };

  await linus.PATCH("/agents/{agent}/settings", { ...path, body: { sponsorAccess: "none" } });
  const none = await ask("Hello?");
  await linus.PATCH("/agents/{agent}/settings", { ...path, body: { sponsorAccess: "send" } });
  await linus.POST("/agents/{agent}/pause", path);
  const paused = await ask("Hello?");

  expect(none).toEqual({ status: 409, body: { message: "Your mailbox agent has no access to this mailbox. Give it some in Settings, under Your agents." } });
  expect(paused).toEqual({ status: 409, body: { message: "Your mailbox agent is paused by linus@example.org. Unpause it in Settings to ask it." } });
});

test("a mailbox agent paused during its run is refused what it does next", async () => {
  let pauseIt = async () => {};
  const { model } = scripted(() => [use("listThreads")], () => [use("listLabels")]);
  const { linus, ask, agent } = await withMailbox({
    model: async function* (request) {
      // Its sponsor pauses it before its second step.
      if (request.messages.length > 1) await pauseIt();
      yield* model(request);
    },
  });
  const path = { params: { path: { agent: (await agent()).id } } };
  pauseIt = async () => void (await linus.POST("/agents/{agent}/pause", path));

  const { events } = await ask("List my labels.");

  expect(events!.flatMap((event) => (event.type === "action" ? [[event.action.operation, event.action.ok, event.action.message]] : []))).toEqual([
    ["listThreads", true, undefined],
    ["listLabels", false, "This agent is paused by linus@example.org. Ask its sponsor to unpause it."],
  ]);
});

test("only a mailbox's owner asks its mailbox agent, signed in", async () => {
  const { grace, ask, params, duva, mailbox } = await withMailbox();

  expect(await ask("Hello?", "grace@example.org")).toEqual({ status: 404, body: { message: "That isn't one of your mailboxes. Ask the agent of one of yours." } });
  expect((await duva.askAgent("linus@example.org", { mailbox: mailbox.id, words: "Hello?" }, { token: "forged" })).status).toBe(401);
  expect((await grace.GET("/mailboxes/{mailbox}/agent", { params })).response.status).toBe(403);
});

test("the conversation keeps its turns, which the agent reads back, until its owner starts a new one", async () => {
  const { model, requests } = scripted(
    () => [{ text: "Hello Linus." }],
    () => [{ text: "You said hello." }],
    () => [{ text: "We haven't talked." }],
  );
  const { linus, params, ask } = await withMailbox({ model });

  await ask("Hello.");
  await ask("What did I say?");
  const { data } = await linus.GET("/mailboxes/{mailbox}/agent", { params });
  const cleared = await linus.DELETE("/mailboxes/{mailbox}/agent/conversation", { params });
  await ask("What did I say?");

  expect(data!.turns.map(({ from, text }) => [from, text])).toEqual([
    ["human", "Hello."],
    ["agent", "Hello Linus."],
    ["human", "What did I say?"],
    ["agent", "You said hello."],
  ]);
  expect(requests[1]!.messages.map(({ role, content }) => [role, content[0]])).toEqual([
    ["user", { text: "Hello." }],
    ["assistant", { text: "Hello Linus." }],
    ["user", { text: "What did I say?" }],
  ]);
  expect(cleared.data!.turns).toEqual([]);
  expect(requests[2]!.messages).toEqual([{ role: "user", content: [{ text: "What did I say?" }] }]);
});

test("a run stops at the organization's spend cap, with an alert to its sponsor, and runs are refused until an admin raises it", async () => {
  // Each model call costs $1.1 at Sonnet 5.5's EU price.
  const expensive: Model = async function* () {
    yield use("listLabels");
    yield { usage: { inputTokens: 250_000, outputTokens: 50_000 } };
  };
  const { ada, linus, ask } = await withMailbox({ model: expensive });
  await ada.PATCH("/organization/settings", { body: { mailboxAgentSpendCap: 2 } });

  const { events } = await ask("Keep going.");
  const refused = await ask("And again.");

  expect(events!.at(-1)).toMatchObject({ type: "done", turn: { outcome: "capReached", actions: [expect.objectContaining({ operation: "listLabels" })] } });
  expect(refused).toEqual({ status: 409, body: { message: "The mailbox agents reached the organization's spend cap of $2 this month. Ask an admin to raise it." } });
  const { data: alerts } = await linus.GET("/alerts");
  expect(alerts!.alerts).toEqual([expect.objectContaining({ kind: "spendCapReached", agentName: "Coo", what: expect.stringContaining("spend cap of $2") })]);
  const { data: spend } = await ada.GET("/organization/mailbox-agent-spend");
  expect(spend).toEqual({ month: new Date().toISOString().slice(0, 7), spent: expect.closeTo(2.2, 5), cap: 2 });
  expect((await linus.GET("/organization/mailbox-agent-spend")).response.status).toBe(403);

  await ada.PATCH("/organization/settings", { body: { mailboxAgentSpendCap: 10 } });
  expect((await ask("Now?")).status).toBe(200);
});

test("admins choose the model, the profile and the region the mailbox agents call it from, by default in the EU through eu-central-1", async () => {
  const { ada } = await withMailbox();
  const { data: before } = await ada.GET("/organization/settings");

  const mismatched = await ada.PATCH("/organization/settings", { body: { mailboxAgentRegion: "us-west-2" } });
  const changed = await ada.PATCH("/organization/settings", { body: { mailboxAgentModel: "anthropic.claude-haiku-4-5-20251001-v1:0", mailboxAgentProfile: "global", mailboxAgentRegion: "us-west-2" } });

  expect(before).toMatchObject({ mailboxAgentModel: "anthropic.claude-sonnet-5-5", mailboxAgentProfile: "eu", mailboxAgentRegion: "eu-central-1", mailboxAgentSpendCap: 20 });
  expect(mismatched.response.status).toBe(400);
  expect((mismatched.error as { message: string }).message).toBe("The eu profile runs only from an EU region, and us-west-2 isn't one. Give mailboxAgentRegion as one, or mailboxAgentProfile as global.");
  expect(changed.data).toMatchObject({ mailboxAgentModel: "anthropic.claude-haiku-4-5-20251001-v1:0", mailboxAgentProfile: "global", mailboxAgentRegion: "us-west-2" });
});

test("a deployment in the US has its mailbox agents call the model in the US, through us-west-2", async () => {
  const { ada } = await withMailbox({ region: "us-east-1" });

  const { data } = await ada.GET("/organization/settings");

  expect(data).toMatchObject({ mailboxAgentProfile: "us", mailboxAgentRegion: "us-west-2" });
});
