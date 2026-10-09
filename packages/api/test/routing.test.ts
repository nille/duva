import { expect, test } from "vitest";
import type { Decider, Model, ModelEvent, ModelMessage } from "../src/agent-loop.ts";
import { type DuvaOptions, startDuva } from "./harness.ts";

type Request = Parameters<Model>[0];
const nova = "amazon.nova-2-lite-v1:0";
const sonnet = "anthropic.claude-sonnet-5-5";

/**
 * A stand-in for the models that takes the next step of the script for the model asked, each from
 * what it was asked, and records every request. Past its script a model answers "Done.".
 */
function scripted(steps: Partial<Record<typeof nova | typeof sonnet, ((request: Request) => ModelEvent[])[]>>) {
  const requests: Request[] = [];
  const taken = { [nova]: 0, [sonnet]: 0 } as Record<string, number>;
  const model: Model = async function* (request) {
    requests.push(structuredClone(request));
    const script = steps[request.model as typeof nova] ?? [];
    const events = script[taken[request.model]!++]?.(request) ?? [{ text: "Done." }];
    for (const event of events) yield event;
    yield { usage: { inputTokens: 1000, outputTokens: 100 } };
  };
  return { model, requests };
}

const use = (name: string, input: Record<string, unknown> = {}): ModelEvent => ({ toolUse: { toolUseId: `${name}-${Math.random()}`, name, input } });

const lastResult = (messages: ModelMessage[]) => {
  for (const block of messages.at(-1)!.content.toReversed()) if ("toolResult" in block) return JSON.parse(block.toolResult.content[0]!.text) as Record<string, any>;
  throw new Error("No tool answered.");
};

const deciding = (route: "simple" | "complex", confidence: number): Decider => async () => ({ route, confidence, inputTokens: 500, outputTokens: 20 });

/**
 * A deployment on example.com where Ada is the first admin and Linus a human with the mailbox
 * linus@example.com, its Screener off, and a report from Grace. The mailbox agents answer and do
 * tasks with Nova 2 Lite, with Sonnet 5.5 for the harder work, and the decider on, unless `defaults`.
 */
async function withMailbox({ defaults = false, ...options }: DuvaOptions & { defaults?: boolean } = {}) {
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org", humans: ["linus@example.org"], ...options });
  const ada = duva.signIn("ada@example.org");
  if (!defaults) await ada.PATCH("/organization/settings", { body: { mailboxAgentModel: nova, mailboxAgentTaskModel: nova, mailboxAgentDecider: true } });
  const linus = duva.signIn("linus@example.org");
  const { data: linusActor } = await linus.GET("/whoami");
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: linusActor!.id, address: "linus@example.com" } });
  const params = { path: { mailbox: mailbox!.id } };
  await linus.PATCH("/mailboxes/{mailbox}/screener", { params, body: { on: false } });
  await duva.receive(
    "From: Grace Hopper <grace@example.org>\r\nTo: linus@example.com\r\nSubject: The report\r\nDate: Sat, 03 Oct 2026 10:00:00 +0000\r\nMessage-ID: <report-1@example.org>\r\n\r\nHere is the quarterly report.\r\n",
    { to: ["linus@example.com"] },
  );
  const ask = (words: string) => duva.askAgent("linus@example.org", { mailbox: mailbox!.id, words });
  const harder = () => duva.askAgent("linus@example.org", { mailbox: mailbox!.id, harder: true });
  const agent = (await linus.GET("/mailbox-agent")).data!.agent;
  const handovers = async () =>
    (await linus.GET("/mailboxes/{mailbox}/changes", { params })).data!.changes.filter((change) => change.type === "agentHandedOver");
  return { duva, ada, linus, params, ask, harder, agent, handovers };
}

const done = (events: { type: string }[] | undefined) => events!.at(-1) as { type: "done"; turn: Record<string, any> };
const said = (events: { type: string; text?: string }[] | undefined) => events!.flatMap((event) => (event.type === "text" ? [event.text] : [])).join("");

test("by default, Claude Haiku 4.5 answers with no decider asked, and hands over to Claude Sonnet 5.5 on evidence, as when it comes to writing", async () => {
  const haiku = "anthropic.claude-haiku-4-5-20251001-v1:0";
  let decided = 0;
  const requests: Request[] = [];
  const model: Model = async function* (request) {
    requests.push(structuredClone(request));
    yield request.model === haiku ? use("createDraft", { to: ["grace@example.org"], text: "Hi" }) : { text: "Sonnet takes it." };
    yield { usage: { inputTokens: 1000, outputTokens: 100 } };
  };
  const { ask } = await withMailbox({ defaults: true, model, decider: async () => (decided++, { route: "simple", confidence: 1, inputTokens: 1, outputTokens: 1 }) });

  const { events } = await ask("Write to Grace.");

  expect(decided).toBe(0);
  expect(requests.map(({ model: asked }) => asked)).toEqual([haiku, sonnet]);
  expect(done(events).turn).toMatchObject({ model: sonnet, handover: { reason: "writing", from: haiku, to: sonnet } });
  expect(done(events).turn.decision).toBeUndefined();
});

test("a conversation turn the decider finds simple is the everyday model's, and one it finds complex, or isn't sure of, the harder model's", async () => {
  for (const [route, confidence, model, handedOver] of [
    ["simple", 0.9, nova, false],
    ["complex", 0.9, sonnet, true],
    ["simple", 0.6, sonnet, true],
  ] as const) {
    const decider = deciding(route, confidence);
    const { model: stand, requests } = scripted({ [nova]: [() => [use("listThreads")], () => [{ text: "Nova here." }]], [sonnet]: [() => [{ text: "Sonnet here." }]] });
    const { ask, handovers } = await withMailbox({ model: stand, decider });

    const { events } = await ask("Anything from Grace?");

    expect(requests.map(({ model: asked }) => asked)).toEqual(model === nova ? [nova, nova] : [sonnet]);
    expect(done(events).turn).toMatchObject({ model, decision: { route, confidence } });
    expect((await handovers()).length).toBe(handedOver ? 1 : 0);
    if (handedOver) expect(done(events).turn.handover).toEqual({ reason: "decided", from: nova, to: sonnet });
    else expect(done(events).turn.handover).toBeUndefined();
  }
});

test("the everyday model hands the turn to the harder model when it comes to writing mail that may be sent, which takes that step again itself", async () => {
  const { model, requests } = scripted({
    [nova]: [() => [use("listThreads")], (request) => [{ text: "I'll write it. " }, use("createDraft", { answers: lastResult(request.messages).threads[0].latestMessage ?? "x", text: "Nova's words" })]],
    [sonnet]: [(request) => [use("getThread", { thread: lastResult(request.messages).threads[0].id })], (request) => [use("createDraft", { answers: lastResult(request.messages).messages[0].id, text: "Thanks, Grace." })], () => [{ text: "I drafted a reply." }]],
  });
  const { linus, params, ask, agent, handovers } = await withMailbox({ model });

  const { events } = await ask("Reply to Grace that I'll read it.");

  expect(requests.map(({ model: asked }) => asked)).toEqual([nova, nova, sonnet, sonnet, sonnet]);
  // The harder model is told why, and gets the work so far without the step set aside.
  expect(requests[2]!.system).toContain("since it came to writing mail that may be sent");
  expect(JSON.stringify(requests[2]!.messages)).not.toContain("Nova's words");
  expect(requests[2]!.tools.map(({ name }) => name)).not.toContain("ask_for_help");
  expect(requests[0]!.tools.map(({ name }) => name)).toContain("ask_for_help");
  expect(said(events)).toBe("I drafted a reply.");
  expect(events!.filter((event) => event.type === "handedOver")).toEqual([{ type: "handedOver", handover: { reason: "writing", from: nova, to: sonnet } }]);
  expect(done(events).turn).toMatchObject({ model: sonnet, handover: { reason: "writing" } });
  const { data: drafts } = await linus.GET("/mailboxes/{mailbox}/drafts", { params });
  expect(drafts!.drafts.map(({ text }) => text)).toEqual(["Thanks, Grace."]);
  expect(await handovers()).toEqual([expect.objectContaining({ type: "agentHandedOver", actor: agent.id, agent: agent.id, handover: { reason: "writing", from: nova, to: sonnet } })]);
});

test("the everyday model hands over after Duva refuses its calls twice, after its step budget of 6, or when it asks for help, saying why", async () => {
  const refused = () => [use("getThread", { thread: "no-such-thread" })];
  const listing = () => [use("listLabels")];
  for (const [script, reason, novaSteps, why] of [
    [[refused, refused], "failedCalls", 2, undefined],
    [[listing, listing, listing, listing, listing, listing], "stepBudget", 6, undefined],
    [[() => [{ text: "Hmm." }, use("ask_for_help", { why: "Which report?" })]], "askedForHelp", 1, "Which report?"],
  ] as const) {
    const { model, requests } = scripted({ [nova]: [...script], [sonnet]: [() => [{ text: "Sonnet answers." }]] });
    const { ask } = await withMailbox({ model });

    const { events } = await ask("Is there a report?");

    expect(requests.map(({ model: asked }) => asked)).toEqual([...Array(novaSteps).fill(nova), sonnet]);
    expect(done(events).turn.handover).toEqual({ reason, from: nova, to: sonnet, ...(why && { why }) });
    expect(said(events)).toBe("Sonnet answers.");
  }
});

test("an answer from the everyday model that names a thread nothing gave it, or that it gave without looking anything up, is set aside unread, and the harder model answers", async () => {
  for (const script of [[() => [use("listThreads")], () => [{ text: "See thread 0b8e2f2a-1111-4c4c-9d9d-123456789abc." }]], [() => [{ text: "You have no mail from Grace." }]]]) {
    const { model } = scripted({ [nova]: script, [sonnet]: [() => [{ text: "Grace sent the report." }]] });
    const { ask } = await withMailbox({ model });

    const { events } = await ask("Anything from Grace?");

    expect(said(events)).toBe("Grace sent the report.");
    expect(done(events).turn).toMatchObject({ text: "Grace sent the report.", model: sonnet, handover: { reason: "answerCheck" } });
  }
});

/** An alert Duva mailed days ago, when it paused the agent, which is running again since. */
const pausedAlert = (name: string) =>
  `From: Duva <no-reply@example.com>\r\nTo: linus@example.com\r\nSubject: ${name} was paused by Duva\r\nDate: Sat, 03 Oct 2026 09:00:00 +0000\r\nMessage-ID: <alert-1@example.com>\r\n\r\nDuva paused ${name}, since a recipient complained about its mail.\r\n\r\nAll alerts about your agents are in Duva, under Alerts.\r\n`;

test("an everyday model's answer that an agent is paused, taken from an old alert while Duva has it running, is set aside unread, and the harder model answers, told what Duva has", async () => {
  for (const claim of ["Real run 45 was paused by Duva, so a reply may be held.", "Real run 45 är pausad."]) {
    const { model, requests } = scripted({ [nova]: [() => [use("searchMailbox", { q: "paused" })], () => [{ text: claim }]], [sonnet]: [() => [use("listAgents")], () => [{ text: "Real run 45 is running." }]] });
    const { duva, linus, ask } = await withMailbox({ model });
    await linus.POST("/agents", { body: { name: "Real run 45" } });
    await duva.receive(pausedAlert("Real run 45"), { to: ["linus@example.com"] });

    const { events } = await ask("Is Real run 45 paused?");

    expect(said(events)).toBe("Real run 45 is running.");
    expect(done(events).turn).toMatchObject({ text: "Real run 45 is running.", model: sonnet, handover: { reason: "answerCheck", from: nova, to: sonnet } });
    expect(requests.find(({ model: asked }) => asked === sonnet)!.system).toContain("since its answer didn't hold up: Duva has Real run 45 running, not paused.");
  }
});

test("an everyday model's answer that says rightly whether an agent is paused, or only wonders whether it is, holds up", async () => {
  for (const answer of [
    "Real run 45 is paused, and Hermes isn't.",
    "Hermes was paused on the 3rd, and runs again since.",
    "Hermes is not currently paused. Real run 45 är pausad.",
    "I can't tell whether Hermes is paused. Is Hermes paused (do you think?)",
  ]) {
    const { model } = scripted({ [nova]: [() => [use("listAgents")], () => [{ text: answer }]] });
    const { linus, ask } = await withMailbox({ model });
    const { data } = await linus.POST("/agents", { body: { name: "Real run 45" } });
    await linus.POST("/agents", { body: { name: "Hermes" } });
    await linus.POST("/agents/{agent}/pause", { params: { path: { agent: data!.agent.id } } });

    const { events } = await ask("Are my agents paused?");

    expect(done(events).turn).toMatchObject({ text: answer, model: nova });
    expect(done(events).turn.handover).toBeUndefined();
  }
});

test("the harder model's answer that an agent is paused while Duva has it running, which its owner read as it streamed, is corrected after it", async () => {
  const { model, requests } = scripted({ [sonnet]: [() => [{ text: "Real run 45 is paused." }], () => [{ text: " Sorry, Real run 45 is running." }]] });
  const { duva, linus, ask } = await withMailbox({ model, decider: deciding("complex", 0.9) });
  await linus.POST("/agents", { body: { name: "Real run 45" } });
  await duva.receive(pausedAlert("Real run 45"), { to: ["linus@example.com"] });

  const { events } = await ask("Is Real run 45 paused?");

  expect(said(events)).toBe("Real run 45 is paused. Sorry, Real run 45 is running.");
  expect(requests).toHaveLength(2);
  expect(requests[1]!.messages.at(-1)!.content).toEqual([{ text: "This is Duva, not your owner. Your answer got wrong what Duva has now: Real run 45 running, not paused. Correct it to your owner, briefly." }]);
  expect(done(events).turn).toMatchObject({ model: sonnet, outcome: "answered" });
});

test("what the harder model thinks between <thinking> and </thinking> isn't checked, as its owner never reads it", async () => {
  const { model, requests } = scripted({ [sonnet]: [() => [{ text: "<thinking>The alert says Real run 45 is paused.</thinking>Real run 45 is running." }]] });
  const { linus, ask } = await withMailbox({ model, decider: deciding("complex", 0.9) });
  await linus.POST("/agents", { body: { name: "Real run 45" } });

  const { events } = await ask("Is Real run 45 paused?");

  expect(said(events)).toBe("Real run 45 is running.");
  expect(requests).toHaveLength(1);
});

test("a label's task uses the task model, with no decider, and its handover shows on the task and in the agent's events", async () => {
  let decided = 0;
  const { model, requests } = scripted({ [nova]: [() => [use("ask_for_help", { why: "Unclear prompt." })]], [sonnet]: [() => [{ text: "Noted." }]] });
  const { linus, params, agent } = await withMailbox({ model, decider: async () => (decided++, { route: "simple", confidence: 1, inputTokens: 1, outputTokens: 1 }) });
  const { data: label } = await linus.POST("/mailboxes/{mailbox}/labels", { params, body: { name: "Reports" } });
  await linus.PUT("/mailboxes/{mailbox}/labels/{label}/prompt", { params: { path: { ...params.path, label: label!.id } }, body: { prompt: "Note who sent it." } });
  const { data: threads } = await linus.GET("/mailboxes/{mailbox}/threads", { params });
  const thread = threads!.threads[0]!.id;

  await linus.POST("/mailboxes/{mailbox}/threads/labels", { params, body: { threads: [thread], add: [label!.id], remove: [] } });

  expect(decided).toBe(0);
  expect(requests.map(({ model: asked }) => asked)).toEqual([nova, sonnet]);
  const { data: read } = await linus.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { ...params.path, thread } } });
  expect(read!.tasks).toEqual([expect.objectContaining({ state: "done", note: "Noted.", handover: { reason: "askedForHelp", from: nova, to: sonnet, why: "Unclear prompt." } })]);
  const { data: events } = await linus.GET("/agents/{agent}/events", { params: { path: { agent: agent.id }, query: { kinds: ["tasks"] } } });
  expect(events!.events.map(({ type }) => type)).toContain("agentHandedOver");
});

test("Think harder answers the last turn again with the harder model, after what came before it", async () => {
  const { model, requests } = scripted({ [nova]: [() => [use("listThreads")], () => [{ text: "First answer." }]], [sonnet]: [() => [{ text: "A better answer." }]] });
  const { ask, harder, linus, params } = await withMailbox({ model });
  const nothing = await harder();
  await ask("Anything from Grace?");

  const { status, events } = await harder();

  expect(nothing).toEqual({ status: 409, body: { message: "There's no answer to think harder about. Ask Coo something first." } });
  expect(status).toBe(200);
  expect(events![0]).toMatchObject({ type: "turn", turn: { from: "human", text: "Anything from Grace?" } });
  expect(requests.at(-1)!.model).toBe(sonnet);
  // It answers the question again, without the answer it had.
  expect(JSON.stringify(requests.at(-1)!.messages)).not.toContain("First answer.");
  expect(done(events).turn).toMatchObject({ text: "A better answer.", model: sonnet, harder: true });
  const { data } = await linus.GET("/mailbox-agent");
  expect(data!.turns.map(({ from, text }) => [from, text])).toEqual([
    ["human", "Anything from Grace?"],
    ["agent", "First answer."],
    ["agent", "A better answer."],
  ]);
});

test("admins read how the month's turns were routed, each kept with its words' embedding, and no one else does", async () => {
  const { model } = scripted({ [nova]: [() => [use("listThreads")], () => [{ text: "Fine." }], () => [use("ask_for_help", { why: "Unsure." })]], [sonnet]: [() => [{ text: "Sure." }], () => [{ text: "Better." }]] });
  const { ada, linus, ask, harder } = await withMailbox({ model });
  await ask("Anything new?");
  await ask("What should I answer Grace?");
  await harder();

  const { data } = await ada.GET("/organization/mailbox-agent-routing");
  const refused = await linus.GET("/organization/mailbox-agent-routing");

  expect(data).toEqual({
    month: new Date().toISOString().slice(0, 7),
    turns: 2,
    everyday: 1,
    harder: 0,
    decided: 0,
    handedOver: { writing: 0, failedCalls: 0, stepBudget: 0, askedForHelp: 0, answerCheck: 0 },
    thoughtHarder: 1,
    embedded: 2,
  });
  expect(refused.response.status).toBe(403);
});
