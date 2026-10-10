// One mailbox agent per human, working in all their personal mailboxes (ADR-0033, #143), seen
// through a human who owns two: Ask Coo from one of them or from All mailboxes, one conversation,
// label prompts in each, one activity, and the setup that merges the mailbox agents from before.
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
 * A deployment on example.com where Ada is the first admin and Linus a human with two mailboxes,
 * work at linus@example.com and home at linus.home@example.com, their Screeners off, everything
 * answered by Claude Sonnet 5.5, so a script runs as written.
 */
async function withTwoMailboxes(options: DuvaOptions = {}) {
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org", humans: ["linus@example.org"], ...options });
  const ada = duva.signIn("ada@example.org");
  const linus = duva.signIn("linus@example.org");
  const { data: linusActor } = await linus.GET("/whoami");
  const { data: work } = await ada.POST("/mailboxes", { body: { owner: linusActor!.id, address: "linus@example.com" } });
  const { data: home } = await ada.POST("/mailboxes", { body: { owner: linusActor!.id, address: "linus.home@example.com" } });
  for (const mailbox of [work!, home!]) await linus.PATCH("/mailboxes/{mailbox}/screener", { params: { path: { mailbox: mailbox.id } }, body: { on: false } });
  await ada.PATCH("/organization/settings", { body: { mailboxAgentModel: "anthropic.claude-sonnet-5-5" } });
  const changes = async (mailbox: string) => (await linus.GET("/mailboxes/{mailbox}/changes", { params: { path: { mailbox } } })).data!.changes;
  return { duva, ada, linus, linusId: linusActor!.id, work: work!, home: home!, changes };
}

const mail = (to: string, subject: string, id: string) =>
  `From: Grace Hopper <grace@example.org>\r\nTo: ${to}\r\nSubject: ${subject}\r\nDate: Sat, 03 Oct 2026 10:00:00 +0000\r\nMessage-ID: <${id}@example.org>\r\n\r\nHello.\r\n`;

test("a human with two mailboxes has one mailbox agent, working in both", async () => {
  const { linus, linusId } = await withTwoMailboxes();

  const { data: agents } = await linus.GET("/agents");

  expect(agents!.agents).toEqual([expect.objectContaining({ name: "Coo", sponsor: linusId, mailboxAgent: true })]);
  const { data: settings } = await linus.GET("/agents/{agent}/settings", { params: { path: { agent: agents!.agents[0]!.id } } });
  expect(settings).toMatchObject({ sponsorAccess: "send", sponsorMailboxes: null });
});

test("asked from one mailbox, Coo works there unless told another, naming the mailbox of each thing it does", async () => {
  const { model, requests } = scripted(
    () => [use("listThreads"), use("listThreads", { mailbox: "linus.home@example.com" })],
    () => [{ text: "One at work, one at home." }],
  );
  const { duva, work, home } = await withTwoMailboxes({ model });
  await duva.receive(mail("linus@example.com", "Budget", "work-1"), { to: ["linus@example.com"] });
  await duva.receive(mail("linus.home@example.com", "Dinner", "home-1"), { to: ["linus.home@example.com"] });

  const { events } = await duva.askAgent("linus@example.org", { mailbox: work.id, words: "What's new?" });

  expect(requests[0]!.system).toContain("You work in their mailboxes linus.home@example.com, linus@example.com");
  expect(requests[0]!.system).toContain("Your owner asks from their mailbox linus@example.com, so work there unless they say otherwise.");
  const listThreads = requests[0]!.tools.find(({ name }) => name === "listThreads")!.inputSchema.json as { properties: Record<string, { description: string }>; required: string[] };
  expect(listThreads.properties.mailbox!.description).toBe("The address of the mailbox to work in: linus.home@example.com, linus@example.com. Leave it out for linus@example.com.");
  expect(listThreads.required).not.toContain("mailbox");
  const subjects = requests[1]!.messages.at(-1)!.content.map((block) => ("toolResult" in block ? JSON.parse(block.toolResult.content[0]!.text).threads.map(({ subject }: { subject: string }) => subject) : []));
  expect(subjects).toEqual([["Budget"], ["Dinner"]]);
  const done = events!.at(-1)!;
  expect(done).toMatchObject({ type: "done", turn: { mailbox: work.id, actions: [{ operation: "listThreads", mailbox: work.id }, { operation: "listThreads", mailbox: home.id }] } });
});

test("asked from All mailboxes, Coo works on all of them through the All mailboxes operations, and in one of them when a tool takes a mailbox", async () => {
  const { model, requests } = scripted(
    () => [use("listAllMailboxesThreads")],
    (request) => [use("getAllMailboxesThread", { thread: lastResult(request.messages).threads[0].id })],
    (request) => [
      use("setSenderDelivery", { sender: "grace@example.org", delivery: "feed" }),
      use("setSenderDelivery", { mailbox: "nobody@example.com", sender: "grace@example.org", delivery: "feed" }),
      use("setSenderDelivery", { mailbox: lastResult(request.messages).mailbox, sender: "grace@example.org", delivery: "feed" }),
      use("listAgents"),
    ],
    () => [{ text: "Grace's mail at home goes to the Feed." }],
  );
  const { duva, linus, work, home, changes } = await withTwoMailboxes({ model });
  await duva.receive(mail("linus.home@example.com", "Dinner", "home-1"), { to: ["linus.home@example.com"] });

  const { events } = await duva.askAgent("linus@example.org", { words: "Send Grace's mail at home to the Feed." });

  expect(requests[0]!.system).toContain("Your owner asks from All mailboxes, so work across all of them.");
  const tools = requests[0]!.tools.map(({ name }) => name);
  expect(tools).toEqual(expect.arrayContaining(["listAllMailboxesThreads", "searchAllMailboxes", "getAllMailboxesThread", "createAllMailboxesDraft", "setSenderDelivery", "listAgents"]));
  expect(tools).not.toContain("listThreads");
  expect((requests[0]!.tools.find(({ name }) => name === "setSenderDelivery")!.inputSchema.json as { required: string[] }).required).toContain("mailbox");
  expect(requests[0]!.tools.find(({ name }) => name === "listAgents")!.inputSchema.json).not.toHaveProperty("properties.mailbox");
  expect(events![0]).toMatchObject({ type: "turn", turn: { from: "human", text: "Send Grace's mail at home to the Feed." } });
  expect(events![0]).not.toHaveProperty("turn.mailbox");
  const actions = events!.flatMap((event) => (event.type === "action" ? [event.action] : []));
  expect(actions.map(({ operation, ok, mailbox, message }) => [operation, ok, mailbox, message])).toEqual([
    ["listAllMailboxesThreads", true, undefined, undefined],
    // A thread on All mailboxes names its mailbox.
    ["getAllMailboxesThread", true, home.id, undefined],
    ["setSenderDelivery", false, undefined, "Say which mailbox to work in, by its address."],
    ["setSenderDelivery", false, undefined, "nobody@example.com isn't a mailbox you work in."],
    ["setSenderDelivery", true, home.id, undefined],
    // Listing the agents is in no mailbox.
    ["listAgents", true, undefined, undefined],
  ]);
  const coo = (await linus.GET("/mailbox-agent")).data!.agent;
  expect((await changes(home.id)).filter(({ type }) => type === "senderDeliverySet")).toEqual([expect.objectContaining({ actor: coo.id, delivery: "feed" })]);
  expect((await changes(work.id)).some(({ type }) => type === "senderDeliverySet")).toBe(false);
  // The first mailbox by address records the turn.
  expect((await changes(home.id)).at(-1)).toMatchObject({ type: "conversationTurn", actor: coo.id, allMailboxes: true });
  expect((await changes(work.id)).some(({ type }) => type === "conversationTurn")).toBe(false);
});

test("a human has one conversation with Coo wherever they ask from, which it reads back", async () => {
  const { model, requests } = scripted(
    () => [{ text: "Hi from work." }],
    () => [{ text: "Hi from home." }],
    () => [{ text: "You said hello twice." }],
  );
  const { duva, linus, work, home } = await withTwoMailboxes({ model });

  await duva.askAgent("linus@example.org", { mailbox: work.id, words: "Hello." });
  await duva.askAgent("linus@example.org", { mailbox: home.id, words: "Hello again." });
  await duva.askAgent("linus@example.org", { words: "What did I say?" });

  const { data } = await linus.GET("/mailbox-agent");
  expect(data!.turns.map(({ from, mailbox, text }) => [from, mailbox, text])).toEqual([
    ["human", work.id, "Hello."],
    ["agent", work.id, "Hi from work."],
    ["human", home.id, "Hello again."],
    ["agent", home.id, "Hi from home."],
    ["human", undefined, "What did I say?"],
    ["agent", undefined, "You said hello twice."],
  ]);
  expect(requests[2]!.messages.map(({ content }) => content[0])).toEqual([{ text: "Hello." }, { text: "Hi from work." }, { text: "Hello again." }, { text: "Hi from home." }, { text: "What did I say?" }]);
  await linus.DELETE("/mailbox-agent/conversation");
  expect((await linus.GET("/mailbox-agent")).data!.turns).toEqual([]);
});

test("Coo works only in the mailboxes its sponsor gives it, asked from one or from All mailboxes", async () => {
  const { model, requests } = scripted(() => [{ text: "At work." }]);
  const { duva, linus, work, home } = await withTwoMailboxes({ model });
  const coo = (await linus.GET("/mailbox-agent")).data!.agent;
  await linus.PATCH("/agents/{agent}/settings", { params: { path: { agent: coo.id } }, body: { sponsorMailboxes: [work.id] } });

  const fromHome = await duva.askAgent("linus@example.org", { mailbox: home.id, words: "Hello?" });
  const fromAll = await duva.askAgent("linus@example.org", { words: "Hello?" });

  expect(fromHome).toEqual({ status: 409, body: { message: "Your mailbox agent has no access to this mailbox. Give it some in Settings, under Your agents." } });
  expect(fromAll.status).toBe(200);
  // In the one mailbox left to it, it is told and given its tools as in one mailbox.
  expect(requests[0]!.system).toContain("linus@example.org's mailbox linus@example.com");
  expect(requests[0]!.tools.find(({ name }) => name === "listThreads")!.inputSchema.json).not.toHaveProperty("properties.mailbox");
});

test("a label's prompt in either mailbox gives the one Coo its task, done in that mailbox alone", async () => {
  const { model, requests } = scripted((request) => [use("getThread", { thread: /thread with the ID ([0-9a-f-]+)/.exec(JSON.stringify(request.messages))![1]! })], () => [{ text: "Noted." }]);
  const { duva, linus, home, changes } = await withTwoMailboxes({ model });
  const params = { path: { mailbox: home.id } };
  const { data: receipts } = await linus.POST("/mailboxes/{mailbox}/labels", { params, body: { name: "Receipts" } });
  await linus.PUT("/mailboxes/{mailbox}/labels/{label}/prompt", { params: { path: { ...params.path, label: receipts!.id } }, body: { prompt: "Note the amount." } });
  await duva.receive(mail("linus.home@example.com", "Receipt", "receipt-1"), { to: ["linus.home@example.com"] });
  const thread = (await changes(home.id)).findLast((change) => change.type === "messageReceived") as { thread: string };

  await linus.POST("/mailboxes/{mailbox}/threads/labels", { params, body: { threads: [thread.thread], add: [receipts!.id], remove: [] } });

  const coo = (await linus.GET("/mailbox-agent")).data!.agent;
  const { data } = await linus.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { ...params.path, thread: thread.thread } } });
  expect(data!.tasks).toEqual([expect.objectContaining({ agent: coo.id, state: "done", note: "Noted." })]);
  expect(requests[0]!.system).toContain("linus@example.org's mailbox linus.home@example.com");
  expect((await changes(home.id)).filter(({ type }) => type === "taskStarted" || type === "taskEnded")).toEqual([expect.objectContaining({ actor: coo.id }), expect.objectContaining({ actor: coo.id })]);
});

test("Coo's activity is one list across the mailboxes, each event naming its mailbox, and a turn from All mailboxes none", async () => {
  const { model } = scripted(
    () => [use("listThreads")],
    () => [{ text: "Nothing." }],
    () => [use("listLabels", { mailbox: "linus.home@example.com" })],
    () => [{ text: "Nothing." }],
    () => [{ text: "Nothing anywhere." }],
  );
  const { duva, linus, work, home } = await withTwoMailboxes({ model });
  const coo = (await linus.GET("/mailbox-agent")).data!.agent;

  await duva.askAgent("linus@example.org", { mailbox: work.id, words: "At work?" });
  await duva.askAgent("linus@example.org", { mailbox: home.id, words: "At home?" });
  await duva.askAgent("linus@example.org", { words: "Anywhere?" });

  const { data } = await linus.GET("/agents/{agent}/events", { params: { path: { agent: coo.id }, query: { kinds: ["conversations"] } } });
  expect(data!.events.map(({ summary, mailbox }) => [summary, mailbox])).toEqual([
    ["You asked Coo “Anywhere?”", undefined],
    ["You asked Coo “At home?”", home.id],
    ["You asked Coo “At work?”", work.id],
  ]);
});

test("the MCP endpoint's tools reach the human's one Coo, asking it about all their mailboxes unless they name one", async () => {
  const { model, requests } = scripted(() => [{ text: "All quiet." }], () => [{ text: "Quiet at home." }]);
  const { duva, linus, home } = await withTwoMailboxes({ model });
  const { client: mcp } = await duva.mcp("linus@example.org");

  const anywhere = await mcp.callTool({ name: "askAgent", arguments: { words: "Anything new?" } });
  const atHome = await mcp.callTool({ name: "askAgent", arguments: { mailbox: "linus.home@example.com", words: "Anything at home?" } });
  const read = await mcp.callTool({ name: "readConversation", arguments: {} });
  const listed = await mcp.callTool({ name: "listMailboxes", arguments: {} });

  expect(anywhere.content).toEqual([{ type: "text", text: "All quiet." }]);
  expect(atHome.content).toEqual([{ type: "text", text: "Quiet at home." }]);
  expect(requests[0]!.system).toContain("Your owner asks from All mailboxes");
  expect(requests[1]!.system).toContain("Your owner asks from their mailbox linus.home@example.com");
  const turns = JSON.parse((read.content as { text: string }[])[0]!.text) as { mailbox?: string; text: string }[];
  expect(turns.map(({ mailbox, text }) => [mailbox, text])).toEqual([
    [undefined, "Anything new?"],
    [undefined, "All quiet."],
    [home.id, "Anything at home?"],
    [home.id, "Quiet at home."],
  ]);
  const coo = (await linus.GET("/mailbox-agent")).data!.agent;
  expect(JSON.parse((listed.content as { text: string }[])[0]!.text)).toEqual([
    expect.objectContaining({ address: "linus.home@example.com", agentAccess: "send" }),
    expect.objectContaining({ address: "linus@example.com", agentAccess: "send" }),
  ]);
  expect((await linus.GET("/agents")).data!.agents.map(({ id }) => id)).toEqual([coo.id]);
});

test("setup merges each human's mailbox agents from before into one, once, carrying over their conversations, their settings and what they did", async () => {
  const { model } = scripted(
    () => [use("createDraft", { to: ["grace@example.org"], subject: "Dinner", text: "See you." })],
    (request) => [use("sendDraft", { draft: lastResult(request.messages).id })],
    () => [{ text: "I asked to send it." }],
    () => [{ text: "Hi from home." }],
    () => [{ text: "Hi, one Coo now." }],
  );
  const { duva, ada, linus, linusId, work, home, changes } = await withTwoMailboxes({ model, beforeOneCoo: true });
  expect((await linus.GET("/agents")).data!.agents).toHaveLength(2);
  await duva.askAgent("linus@example.org", { mailbox: work.id, words: "Answer Grace." });
  await duva.askAgent("linus@example.org", { mailbox: home.id, words: "Hello." });
  type Turn = { actor: string; position: number };
  const workAsked = (await changes(work.id)).findLast(({ type }) => type === "conversationTurn") as Turn;
  const homeAsked = (await changes(home.id)).findLast(({ type }) => type === "conversationTurn") as Turn;
  expect(workAsked.actor).not.toBe(homeAsked.actor);
  // Linus gave home's Coo less to do than work's.
  await linus.PATCH("/agents/{agent}/settings", { params: { path: { agent: homeAsked.actor } }, body: { sponsorAccess: "organize", sendsPerHour: 20 } });
  expect(await duva.askAgent("linus@example.org", { words: "Hello?" })).toMatchObject({ status: 404 });

  await duva.setUp({ admin: "ada@example.org" });
  await duva.setUp({ admin: "ada@example.org" });

  // The first mailbox's, by address, is the one.
  const { data: agents } = await linus.GET("/agents");
  expect(agents!.agents).toEqual([expect.objectContaining({ id: homeAsked.actor, name: "Coo", mailboxAgent: true })]);
  const coo = agents!.agents[0]!;
  const { data: settings } = await linus.GET("/agents/{agent}/settings", { params: { path: { agent: coo.id } } });
  expect(settings).toMatchObject({ sponsorAccess: "organize", sponsorMailboxes: null, sendsPerHour: 20, approvalAsSponsor: true });
  // Each turn is where it was asked, and what work's Coo did stays its own.
  const { data: conversation } = await linus.GET("/mailbox-agent");
  expect(conversation!.turns.map(({ from, mailbox, text }) => [from, mailbox, text])).toEqual([
    ["human", work.id, "Answer Grace."],
    ["agent", work.id, "I asked to send it."],
    ["human", home.id, "Hello."],
    ["agent", home.id, "Hi from home."],
  ]);
  expect((await changes(work.id)).find(({ position }) => position === workAsked.position)).toMatchObject({ type: "conversationTurn", actor: workAsked.actor });
  const merged = { type: "mailboxAgentsMerged", agent: coo.id, human: linusId, merged: [workAsked.actor], actor: "duva" };
  for (const mailbox of [work, home]) expect((await changes(mailbox.id)).filter(({ type }) => type === "mailboxAgentsMerged")).toEqual([expect.objectContaining(merged)]);
  const { data: organization } = await ada.GET("/organization/changes");
  expect(organization!.changes.filter(({ type }) => type === "mailboxAgentsMerged")).toEqual([expect.objectContaining(merged)]);
  // The one Coo's activity is theirs together, each named Coo.
  const { data: activity } = await linus.GET("/agents/{agent}/events", { params: { path: { agent: coo.id }, query: { kinds: ["conversations", "setup"] } } });
  expect(activity!.events.map(({ summary, mailbox }) => [summary, mailbox])).toEqual([
    ["Duva merged 2 mailbox agents into Coo, which works in all its sponsor's mailboxes.", undefined],
    ["You asked Coo “Hello.”", home.id],
    ["You asked Coo “Answer Grace.”, and it wrote a draft.", work.id],
    ["You added the agent Coo.", undefined],
    ["You added the agent Coo.", undefined],
  ]);
  // The send work's Coo asked for still waits for Linus, and goes out as Coo's.
  const { data: approvals } = await linus.GET("/approvals");
  expect(approvals!.approvals).toEqual([expect.objectContaining({ agent: workAsked.actor, state: "pending" })]);
  await linus.POST("/approvals/{approval}/send", { params: { path: { approval: approvals!.approvals[0]!.id } } });
  expect((await PostalMime.parse(duva.sent()[0]!)).text).toBe("See you.\n\nSent by Coo for linus@example.org\n");
  // From then on, the one Coo answers, from wherever Linus asks.
  const { events } = await duva.askAgent("linus@example.org", { words: "Who are you?" });
  expect(events!.at(-1)).toMatchObject({ type: "done", turn: { text: "Hi, one Coo now." } });
  expect((await changes(home.id)).at(-1)).toMatchObject({ type: "conversationTurn", actor: coo.id, allMailboxes: true });
});

test("unpausing the one Coo unpauses those merged into it, so a send one of them asked for goes out once approved", async () => {
  const { model } = scripted(
    () => [use("createDraft", { to: ["grace@example.org"], subject: "Dinner", text: "See you." })],
    (request) => [use("sendDraft", { draft: lastResult(request.messages).id })],
    () => [{ text: "I asked to send it." }],
  );
  const { duva, linus, work } = await withTwoMailboxes({ model, beforeOneCoo: true });
  await duva.askAgent("linus@example.org", { mailbox: work.id, words: "Answer Grace." });
  for (const { id } of (await linus.GET("/agents")).data!.agents) await linus.POST("/agents/{agent}/pause", { params: { path: { agent: id } } });

  await duva.setUp({ admin: "ada@example.org" });
  const [coo] = (await linus.GET("/agents")).data!.agents;
  expect(coo).toMatchObject({ paused: expect.objectContaining({ by: expect.any(String) }) });
  await linus.POST("/agents/{agent}/unpause", { params: { path: { agent: coo!.id } } });

  const { data: approvals } = await linus.GET("/approvals");
  const sent = await linus.POST("/approvals/{approval}/send", { params: { path: { approval: approvals!.approvals[0]!.id } } });
  expect(sent.response.status).toBe(202);
  expect(duva.sent()).toHaveLength(1);
});
