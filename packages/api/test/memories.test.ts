// Coo's memories (ADR-0036, #151): what its human tells it and what it learns from mail it reads in
// its own runs, each naming its sources, given to its later runs by meaning, corrected and forgotten
// by its human or by Coo when told, and erased with the threads they were learned from.
import { expect, test } from "vitest";
import type { Model, ModelEvent, ModelMessage } from "../src/agent-loop.ts";
import { type DuvaOptions, startDuva } from "./harness.ts";

type Request = Parameters<Model>[0];

const day = 24 * 60 * 60 * 1000;
const budget = { timeout: 45_000 };

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

const use = (name: string, input: Record<string, unknown> = {}): ModelEvent => ({ toolUse: { toolUseId: `${name}-${Math.random()}`, name, input } });

/** What the last tool the model used answered, and whether it went well. */
const lastResult = (messages: ModelMessage[]) => {
  for (const block of messages.at(-1)!.content.toReversed()) if ("toolResult" in block) return { status: block.toolResult.status, answer: JSON.parse(block.toolResult.content[0]!.text.replace(/^Duva answered \d+: /, "")) as Record<string, any> };
  throw new Error("No tool answered.");
};

/** The text of the words the model was last asked, with what Duva gave beside them. */
const asked = ({ messages }: Request) =>
  messages
    .findLast(({ role, content }) => role === "user" && content.some((block) => "text" in block))!
    .content.flatMap((block) => ("text" in block ? [block.text] : []))
    .join("\n");

const mail = (subject: string, text: string, { to = "linus@example.com", from = "Folktandvården <noreply@folktandvarden.example.se>" } = {}) =>
  `From: ${from}\r\nTo: ${to}\r\nSubject: ${subject}\r\nDate: Sun, 04 Oct 2026 09:00:00 +0200\r\nMessage-ID: <${subject.replaceAll(" ", "-")}@example.se>\r\n\r\n${text}\r\n`;

/**
 * A deployment on example.com where Ada is the first admin and Linus a human with two mailboxes,
 * work at linus@example.com and home at linus.home@example.com, their Screeners off unless asked,
 * Grace another human, everything answered by Claude Sonnet 5.5, so a script runs as written.
 */
async function withLinus(options: DuvaOptions & { screener?: boolean } = {}) {
  const { screener = false, ...rest } = options;
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org", humans: ["linus@example.org", "grace@example.org"], ...rest });
  const ada = duva.signIn("ada@example.org");
  const linus = duva.signIn("linus@example.org");
  const grace = duva.signIn("grace@example.org");
  const { data: linusActor } = await linus.GET("/whoami");
  const { data: graceActor } = await grace.GET("/whoami");
  const { data: work } = await ada.POST("/mailboxes", { body: { owner: linusActor!.id, address: "linus@example.com" } });
  const { data: home } = await ada.POST("/mailboxes", { body: { owner: linusActor!.id, address: "linus.home@example.com" } });
  if (!screener) for (const mailbox of [work!, home!]) await linus.PATCH("/mailboxes/{mailbox}/screener", { params: { path: { mailbox: mailbox.id } }, body: { on: false } });
  await ada.PATCH("/organization/settings", { body: { mailboxAgentModel: "anthropic.claude-sonnet-5-5" } });
  /** Receives the message in the mailbox, and gives its thread's ID. */
  const receive = async (raw: string, { mailbox = work!, ...given }: { mailbox?: typeof work; verdicts?: Record<string, string> } = {}) => {
    await duva.receive(raw, { to: [mailbox!.addresses[0]!] }, given.verdicts === undefined ? undefined : ({ verdicts: given.verdicts } as never));
    const { data } = await linus.GET("/mailboxes/{mailbox}/changes", { params: { path: { mailbox: mailbox!.id }, query: { spam: true } } });
    return (data!.changes as { type: string; thread: string }[]).findLast(({ type }) => type === "messageReceived")!.thread;
  };
  const memories = async (client = linus) => (await client.GET("/memories")).data!.memories;
  return { duva, ada, linus, grace, linusId: linusActor!.id, graceId: graceActor!.id, work: work!, home: home!, receive, memories };
}

const dentist = mail("Påminnelse om din tid", "Du har en tid hos tandläkare Maria Ek tisdagen den 20 oktober 2026 kl. 08.30.");

test("Coo keeps what its human tells it, which the human sees as theirs, with when it was kept", async () => {
  const { model } = scripted(() => [use("keepMemory", { text: "Linus's partner is Sam, who is vegetarian." })], () => [{ text: "I'll remember that." }]);
  const { duva, memories } = await withLinus({ model });

  const { events } = await duva.askAgent("linus@example.org", { words: "Remember that my partner is Sam, and Sam is vegetarian." });

  expect(events!.at(-1)).toMatchObject({ type: "done", turn: { actions: [{ operation: "keepMemory", ok: true }] } });
  expect(events!.at(-1)).not.toHaveProperty("turn.firstMemory");
  expect(await memories()).toEqual([{ id: expect.any(String), text: "Linus's partner is Sam, who is vegetarian.", kept: expect.any(String), source: "told" }]);
});

test("Coo keeps what mail it reads teaches it, naming the thread, and says so once, the first time", budget, async () => {
  const keep = (thread: string, text: string) => () => [use("keepMemory", { text, threads: [thread] })];
  let thread = "";
  const { model } = scripted(
    () => keep(thread, "Linus sees the dentist Maria Ek on 20 October 2026 at 08.30.")(),
    () => [{ text: "Your dentist is on the 20th." }],
    () => keep(thread, "Linus's dentist is Maria Ek.")(),
    () => [{ text: "Noted." }],
  );
  const { duva, work, receive, memories } = await withLinus({ model });
  thread = await receive(dentist);

  const first = await duva.askAgent("linus@example.org", { mailbox: work.id, words: "When is my dentist?" });
  const second = await duva.askAgent("linus@example.org", { mailbox: work.id, words: "Who is my dentist?" });

  expect(first.events!.at(-1)).toMatchObject({ type: "done", turn: { firstMemory: true, actions: [{ operation: "keepMemory", ok: true, threads: [thread] }] } });
  expect(second.events!.at(-1)).not.toHaveProperty("turn.firstMemory");
  expect((await memories()).map(({ source, threads }) => ({ source, threads }))).toEqual([
    { source: "mail", threads: [{ mailbox: work.id, thread, subject: "Påminnelse om din tid" }] },
    { source: "mail", threads: [{ mailbox: work.id, thread, subject: "Påminnelse om din tid" }] },
  ]);
});

test("a label task's run keeps what the mail teaches, naming its thread, and Ask Coo's next bubble says so", budget, async () => {
  const { model, requests } = scripted(
    (request) => [use("keepMemory", { text: "Linus sees the dentist on 20 October 2026.", threads: [/the thread with the ID ([0-9a-f-]{36})/.exec(asked(request))?.[1] ?? "none"] })],
    () => [{ text: "Kept the appointment." }],
    () => [{ text: "Hello." }],
  );
  const { duva, linus, work, receive, memories } = await withLinus({ model });
  const params = { path: { mailbox: work.id } };
  const { data: label } = await linus.POST("/mailboxes/{mailbox}/labels", { params, body: { name: "Tider" } });
  await linus.PUT("/mailboxes/{mailbox}/labels/{label}/prompt", { params: { path: { ...params.path, label: label!.id } }, body: { prompt: "Remember my appointments." } });
  const thread = await receive(dentist);

  await linus.POST("/mailboxes/{mailbox}/threads/labels", { params, body: { threads: [thread], add: [label!.id], remove: [] } });
  await duva.releaseTasks();
  const { events } = await duva.askAgent("linus@example.org", { words: "Hi" });

  expect(requests[0]!.system).toContain("naming the threads you learned it from, since in a task your owner told you nothing");
  expect(await memories()).toEqual([expect.objectContaining({ source: "mail", threads: [{ mailbox: work.id, thread, subject: "Påminnelse om din tid" }] })]);
  expect(events!.at(-1)).toMatchObject({ type: "done", turn: { firstMemory: true } });
});

test("each run is given what Coo remembers, from all its human's mailboxes, in any of them, with each memory's source", budget, async () => {
  let thread = "";
  const { model, requests } = scripted(
    () => [use("keepMemory", { text: "Linus sees the dentist on 20 October 2026.", threads: [thread] })],
    () => [{ text: "Kept." }],
    () => [{ text: "On the 20th." }],
  );
  const { duva, linus, work, home, receive } = await withLinus({ model });
  thread = await receive(dentist, { mailbox: home });
  await duva.askAgent("linus@example.org", { mailbox: home.id, words: "Remember my dentist." });
  await linus.POST("/memories", { body: { text: "Linus prefers mornings." } });

  await duva.askAgent("linus@example.org", { mailbox: work.id, words: "When can I see the dentist?" });

  const given = asked(requests[2]!);
  expect(given).toContain("When can I see the dentist?");
  expect(given).toContain('source="mail: Påminnelse om din tid">Linus sees the dentist on 20 October 2026.</entry>');
  expect(given).toContain('source="told">Linus prefers mornings.</entry>');
  expect(requests[2]!.tools.map(({ name }) => name)).toEqual(expect.arrayContaining(["listMemories", "keepMemory", "correctMemory", "forgetMemory"]));
  expect(requests[2]!.tools.map(({ name }) => name)).not.toContain("forgetMemories");
});

test("a run with nothing remembered is given no memories", async () => {
  const { model, requests } = scripted(() => [{ text: "Hello." }]);
  const { duva } = await withLinus({ model });

  await duva.askAgent("linus@example.org", { words: "Hi" });

  expect(asked(requests[0]!)).toBe("Hi");
});

test("Coo finds memories by meaning, the most alike first", async () => {
  const { linus } = await withLinus();
  for (const text of ["Linus's dentist is Maria Ek at Folktandvården.", "Linus's partner is Sam, who is vegetarian.", "Linus flies to Lisbon on 22 October 2026."]) await linus.POST("/memories", { body: { text } });

  const { data } = await linus.GET("/memories", { params: { query: { query: "Who do I live with?", limit: 1 } } });

  expect(data!.memories.map(({ text }) => text)).toEqual(["Linus's partner is Sam, who is vegetarian."]);
});

test("Coo learns nothing from mail in the Screener or Spam", async () => {
  let threads: string[] = [];
  const { model, requests } = scripted(
    () => [use("keepMemory", { text: "A fact from the Screener.", threads: [threads[0]] })],
    () => [use("keepMemory", { text: "A fact from Spam.", threads: [threads[1]] })],
    () => [{ text: "Nothing kept." }],
  );
  const { duva, linus, work, receive, memories } = await withLinus({ model, screener: true });
  await linus.PATCH("/mailboxes/{mailbox}/screener", { params: { path: { mailbox: work.id } }, body: { on: true } });
  threads = [await receive(dentist), await receive(mail("Vinst", "Du har vunnit!", { from: "Lotto <win@lotto.example.net>" }), { verdicts: { spam: "FAIL" } })];

  await duva.askAgent("linus@example.org", { mailbox: work.id, words: "Remember what's new." });

  expect(lastResult(requests[1]!.messages)).toEqual({ status: "error", answer: { message: "Coo doesn't learn from mail in the Screener or Spam. Keep nothing from that thread." } });
  expect(lastResult(requests[2]!.messages)).toEqual({ status: "error", answer: { message: "Coo doesn't learn from mail in the Screener or Spam. Keep nothing from that thread." } });
  expect(await memories()).toEqual([]);
});

test("with learning from mail off, Coo is told so and keeps only what its human tells it", async () => {
  let thread = "";
  const { model, requests } = scripted(
    () => [use("keepMemory", { text: "Linus sees the dentist on 20 October 2026.", threads: [thread] }), use("keepMemory", { text: "Linus prefers mornings." })],
    () => [{ text: "Kept that you prefer mornings." }],
  );
  const { duva, linus, receive, memories } = await withLinus({ model });
  thread = await receive(dentist);

  const { data: preferences } = await linus.PATCH("/preferences", { body: { cooLearnsFromMail: "off" } });
  await duva.askAgent("linus@example.org", { words: "I prefer mornings. When is my dentist?" });
  const byLinus = await linus.POST("/memories", { body: { text: "From the mail.", threads: [thread] } });

  expect(preferences!.cooLearnsFromMail).toBe("off");
  expect(requests[0]!.system).toContain("Your owner switched learning from mail off, so keep nothing you learn from mail.");
  const results = requests[1]!.messages.at(-1)!.content.flatMap((block) => ("toolResult" in block ? [block.toolResult.status] : []));
  expect(results).toEqual(["error", "success"]);
  expect(byLinus.response.status).toBe(409);
  expect(byLinus.error).toEqual({ message: "You switched Coo's learning from mail off. Switch it on in your preferences to keep memories from mail." });
  expect((await memories()).map(({ text, source }) => [text, source])).toEqual([["Linus prefers mornings.", "told"]]);
});

test("a human corrects and forgets memories, and forgets everything", async () => {
  const { linus, memories } = await withLinus();
  const { data: kept } = await linus.POST("/memories", { body: { text: "Linus's partner is Sam." } });
  await linus.POST("/memories", { body: { text: "Linus prefers mornings." } });
  await linus.POST("/memories", { body: { text: "Linus flies to Lisbon." } });

  const { data: corrected } = await linus.PATCH("/memories/{memory}", { params: { path: { memory: kept!.id } }, body: { text: "Linus's partner is Robin." } });
  const listed = await memories();
  const forgot = await linus.DELETE("/memories/{memory}", { params: { path: { memory: listed.find(({ text }) => text === "Linus prefers mornings.")!.id } } });
  const afterOne = await memories();
  const { data: all } = await linus.DELETE("/memories");

  expect(corrected).toEqual({ id: kept!.id, text: "Linus's partner is Robin.", kept: kept!.kept, corrected: expect.any(String), source: "told" });
  expect(forgot.data!.text).toBe("Linus prefers mornings.");
  expect(afterOne.map(({ text }) => text).toSorted()).toEqual(["Linus flies to Lisbon.", "Linus's partner is Robin."]);
  expect(all).toEqual({ forgotten: 2 });
  expect(await memories()).toEqual([]);
});

test("Coo forgets one memory at a time, and only its human forgets everything", async () => {
  const { model, requests } = scripted(() => [use("forgetMemories")], () => [{ text: "I can't." }]);
  const { duva, linus, memories } = await withLinus({ model });
  await linus.POST("/memories", { body: { text: "Linus's partner is Sam." } });

  await duva.askAgent("linus@example.org", { words: "Forget everything." });

  expect(requests[0]!.tools.map(({ name }) => name)).not.toContain("forgetMemories");
  const result = requests[1]!.messages.at(-1)!.content.flatMap((block) => ("toolResult" in block ? [block.toolResult] : []))[0]!;
  expect([result.status, result.content[0]!.text]).toEqual(["error", "There is no tool forgetMemories."]);
  expect((await memories()).map(({ text }) => text)).toEqual(["Linus's partner is Sam."]);
});

test("Coo isn't given what it learned in a mailbox its sponsor no longer gives it access to", budget, async () => {
  let thread = "";
  const { model, requests } = scripted(
    () => [use("listMemories")],
    () => [{ text: "Nothing." }],
  );
  const { duva, linus, home, receive } = await withLinus({ model });
  thread = await receive(dentist, { mailbox: home });
  await linus.POST("/memories", { body: { text: "Linus sees the dentist on 20 October 2026.", threads: [thread] } });
  await linus.POST("/memories", { body: { text: "Linus prefers mornings." } });
  const coo = (await linus.GET("/mailbox-agent")).data!.agent;
  const { data: work } = await linus.GET("/mailboxes");
  const workId = work!.mailboxes.find(({ addresses }) => addresses.includes("linus@example.com"))!.id;
  await linus.PATCH("/agents/{agent}/settings", { params: { path: { agent: coo.id } }, body: { sponsorMailboxes: [workId] } });

  await duva.askAgent("linus@example.org", { mailbox: workId, words: "What do you remember of my dentist?" });

  expect(asked(requests[0]!)).not.toContain("dentist on 20 October");
  expect(lastResult(requests[1]!.messages).answer.memories.map(({ text }: { text: string }) => text)).toEqual(["Linus prefers mornings."]);
  expect((await linus.GET("/memories")).data!.memories).toHaveLength(2);
});

test("in a label task Coo is told a memory names its threads", budget, async () => {
  const { model, requests } = scripted(() => [{ text: "Noted." }]);
  const { duva, linus, work, receive } = await withLinus({ model });
  const params = { path: { mailbox: work.id } };
  const { data: label } = await linus.POST("/mailboxes/{mailbox}/labels", { params, body: { name: "Tider" } });
  await linus.PUT("/mailboxes/{mailbox}/labels/{label}/prompt", { params: { path: { ...params.path, label: label!.id } }, body: { prompt: "Remember my appointments." } });
  const thread = await receive(dentist);

  await linus.POST("/mailboxes/{mailbox}/threads/labels", { params, body: { threads: [thread], add: [label!.id], remove: [] } });
  await duva.releaseTasks();

  expect((requests[0]!.tools.find(({ name }) => name === "keepMemory")!.inputSchema.json as { required: string[] }).required).toEqual(["text", "threads"]);
});

test("told to forget something, Coo forgets it", async () => {
  const { model, requests } = scripted(
    (request) => [use("forgetMemory", { memory: /<entry id="([^"]+)"/.exec(asked(request))![1] })],
    () => [{ text: "Forgotten." }],
  );
  const { duva, linus, memories } = await withLinus({ model });
  await linus.POST("/memories", { body: { text: "Linus's partner is Sam." } });

  await duva.askAgent("linus@example.org", { words: "Forget who my partner is." });

  expect(lastResult(requests[1]!.messages)).toMatchObject({ status: "success", answer: { text: "Linus's partner is Sam." } });
  expect(await memories()).toEqual([]);
});

test("memories are their human's alone: another human sees none of them, and other agents none at all", async () => {
  const { duva, linus, grace, memories } = await withLinus();
  const { data: hermes } = await linus.POST("/agents", { body: { name: "Hermes" } });
  const { data: kept } = await linus.POST("/memories", { body: { text: "Linus's partner is Sam." } });

  const byGrace = await grace.PATCH("/memories/{memory}", { params: { path: { memory: kept!.id } }, body: { text: "Changed." } });
  const byHermes = await duva.withKey(hermes!.key).GET("/memories");

  expect(await memories(grace)).toEqual([]);
  expect(byGrace.response.status).toBe(404);
  expect(byHermes.response.status).toBe(403);
  expect(byHermes.error).toEqual({ message: "Only humans and their own Coo have memories. Your sponsor can tell their Coo what to remember in Ask Coo." });
  expect((await memories()).map(({ text }) => text)).toEqual(["Linus's partner is Sam."]);
});

/** Linus with a memory learned from a thread at work, one learned from it and a thread at home, and one he told, whichever way the thread is then erased. */
async function withMemoryOf(subject: string, options: { from?: string; verdicts?: Record<string, string> } = {}) {
  const linus = await withLinus();
  const thread = await linus.receive(mail(subject, "Hej.", options.from === undefined ? {} : { from: options.from }), { verdicts: options.verdicts });
  const other = await linus.receive(mail("Other", "Hej.", { to: "linus.home@example.com" }), { mailbox: linus.home });
  await linus.linus.POST("/memories", { body: { text: `Learned from ${subject}.`, threads: [thread] } });
  await linus.linus.POST("/memories", { body: { text: `Learned from ${subject} and Other.`, threads: [thread, other] } });
  await linus.linus.POST("/memories", { body: { text: "Linus prefers mornings." } });
  await linus.linus.POST("/memories", { body: { text: "Learned from Other.", threads: [other] } });
  const params = { path: { mailbox: linus.work.id } };
  const kept = async () => (await linus.memories()).map(({ text }) => text).toSorted();
  return { ...linus, thread, other, params, kept };
}

const left = ["Learned from Other.", "Linus prefers mornings."];

test("erasing a thread after it had Trash for the retention period erases what Coo learned from it", budget, async () => {
  const { duva, linus, thread, params, kept } = await withMemoryOf("Kvitto");
  await linus.POST("/mailboxes/{mailbox}/threads/labels", { params, body: { threads: [thread], add: ["trash"], remove: [] } });

  await duva.erase(new Date(Date.now() + 29 * day));
  const before = await kept();
  await duva.erase(new Date(Date.now() + 31 * day));

  expect(before).toHaveLength(4);
  expect(await kept()).toEqual(left);
});

test("erasing a thread after it had Spam for the retention period erases what Coo learned from it", budget, async () => {
  const { duva, linus, thread, params, kept } = await withMemoryOf("Erbjudande");
  await linus.POST("/mailboxes/{mailbox}/threads/labels", { params, body: { threads: [thread], add: ["spam"], remove: [] } });

  await duva.erase(new Date(Date.now() + 31 * day));

  expect(await kept()).toEqual(left);
});

test("emptying Trash erases what Coo learned from its threads", budget, async () => {
  const { linus, thread, params, kept } = await withMemoryOf("Kvitto");
  await linus.POST("/mailboxes/{mailbox}/threads/labels", { params, body: { threads: [thread], add: ["trash"], remove: [] } });

  await linus.POST("/mailboxes/{mailbox}/trash/empty", { params });

  expect(await kept()).toEqual(left);
});

test("sending a sender's mail nowhere erases what Coo learned from their threads", budget, async () => {
  const { linus, params, kept } = await withMemoryOf("Pitch", { from: "Mallory <mallory@example.net>" });

  await linus.PUT("/mailboxes/{mailbox}/senders/{sender}", { params: { path: { ...params.path, sender: "mallory@example.net" } }, body: { delivery: "nowhere" } });

  expect(await kept()).toEqual(left);
});

test("removing a human hands their mailbox over without what their Coo learned from it, and deletes the other with theirs", budget, async () => {
  const { model, requests } = scripted(() => [{ text: "Hello." }]);
  const { duva, ada, grace, linusId, graceId, work, home, receive } = await withLinus({ model });
  const linus = duva.signIn("linus@example.org");
  const thread = await receive(dentist);
  await linus.POST("/memories", { body: { text: "Linus sees the dentist on 20 October 2026.", threads: [thread] } });
  await linus.POST("/memories", { body: { text: "Linus prefers mornings." } });

  const { response } = await ada.POST("/humans/{human}/remove", { params: { path: { human: linusId } }, body: { handOver: [work.id], delete: [home.id], handTo: graceId } });
  await duva.askAgent("grace@example.org", { mailbox: work.id, words: "Hi" });

  expect(response.status).toBe(200);
  expect((await grace.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { mailbox: work.id, thread } } })).response.status).toBe(200);
  expect((await grace.GET("/memories")).data!.memories).toEqual([]);
  expect(asked(requests[0]!)).toBe("Hi");
});
