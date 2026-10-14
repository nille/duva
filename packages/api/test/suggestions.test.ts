// Suggestions (#156): the rest of the sentence a human is writing, from the draft so far, its
// subject and recipients, the message it answers, what Coo remembers and the style note, which a
// later ask supersedes, which count toward the spend cap, and which only humans get, in their own
// mailboxes. And the style note, written after every tenth message a human sends, naming the
// threads of those messages, so it goes with them.
import { expect, test } from "vitest";
import type { Suggester } from "../src/suggestions.ts";
import { type DuvaOptions, startDuva } from "./harness.ts";

type Asked = Parameters<Suggester>[0];

/** A stand-in for Qwen3 32B that answers each request as `answer` says, and records them. */
function scripted(answer: (request: Asked) => string | Promise<string> = () => "") {
  const requests: Asked[] = [];
  const suggester: Suggester = async (request) => {
    requests.push(request);
    return { text: await answer(request), inputTokens: 400, outputTokens: 10 };
  };
  return { suggester, requests };
}

const erik = [
  "From: Erik Berg <erik@example.org>",
  "To: linus@example.com",
  "Subject: Dinner on Friday",
  "Date: Thu, 08 Oct 2026 18:00:00 +0200",
  "Message-ID: <dinner@example.org>",
  "",
  "Hi Linus, would you and Sam like to come over for dinner on Friday at 7?",
  "",
].join("\r\n");

/**
 * A deployment on example.com where Ada is the first admin and Linus a human with his mailbox at
 * linus@example.com, its Screener off, and Grace another human with hers at grace@example.com.
 */
async function withLinus(options: DuvaOptions = {}) {
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org", humans: ["linus@example.org", "grace@example.org"], ...options });
  const ada = duva.signIn("ada@example.org");
  const linus = duva.signIn("linus@example.org");
  const grace = duva.signIn("grace@example.org");
  const { data: linusActor } = await linus.GET("/whoami");
  const { data: graceActor } = await grace.GET("/whoami");
  const { data: work } = await ada.POST("/mailboxes", { body: { owner: linusActor!.id, address: "linus@example.com" } });
  const { data: graces } = await ada.POST("/mailboxes", { body: { owner: graceActor!.id, address: "grace@example.com" } });
  const params = { path: { mailbox: work!.id } };
  await linus.PATCH("/mailboxes/{mailbox}/screener", { params, body: { on: false } });
  /** Asks for a suggestion for Linus's draft. */
  const suggest = (body: { text: string; subject?: string; to?: string[]; cc?: string[]; answers?: string }, client = linus, mailbox = work!.id) =>
    client.POST("/mailboxes/{mailbox}/suggestions", { params: { path: { mailbox } }, body });
  /** Linus writes a new message to the address and sends it. */
  const send = async (to: string, subject: string, text: string) => {
    const { data: draft } = await linus.POST("/mailboxes/{mailbox}/drafts", { params, body: { to: [to], subject, text } });
    await linus.POST("/mailboxes/{mailbox}/drafts/{draft}/send", { params: { path: { ...params.path, draft: draft!.id } } });
  };
  const memories = async () => (await linus.GET("/memories")).data!.memories;
  return { duva, ada, linus, grace, work: work!, graces: graces!, params, suggest, send, memories };
}

test("a suggestion is the rest of the sentence, from the draft, its subject and recipients, the message it answers, and what Coo remembers", async () => {
  const { suggester, requests } = scripted(() => "Sam and I would love to come on Friday. See you then!");
  const { duva, linus, params, suggest } = await withLinus({ suggester });
  await duva.receive(erik, { to: ["linus@example.com"] });
  const { data: list } = await linus.GET("/mailboxes/{mailbox}/threads", { params });
  const { data: thread } = await linus.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { ...params.path, thread: list!.threads[0]!.id } } });
  await linus.POST("/memories", { body: { text: "Linus's partner is Sam." } });
  await linus.POST("/memories", { body: { text: "Linus prefers evenings." } });

  const { data } = await suggest({ text: "Hi Erik,\n\nThanks! Sam and I would love to", subject: "Re: Dinner on Friday", to: ["erik@example.org"], answers: thread!.messages[0]!.id });

  expect(data).toEqual({ suggestion: " come on Friday." });
  expect(requests).toHaveLength(1);
  expect(requests[0]!.model).toBe("qwen.qwen3-32b-v1:0");
  const { prompt } = requests[0]!;
  for (const part of ["From: linus@example.org", "To: erik@example.org", "Subject: Re: Dinner on Friday", "Hi Linus, would you and Sam like to come over for dinner on Friday at 7?", "- Linus's partner is Sam.", "- Linus prefers evenings.", "Hi Erik,\n\nThanks! Sam and I would love to\n</draft>", "The sentence they are writing, so far: Sam and I would love to"]) {
    expect(prompt).toContain(part);
  }
  expect(requests[0]!.system).toContain("finishing the sentence they are writing");
});

test("a suggestion finishes a word stopped in the middle, and is nothing where the answer doesn't go on from what was written", async () => {
  const answers = ["Lunch tomorrow sounds great! Thanks.", "Something else entirely."];
  const { suggester } = scripted(() => answers.shift()!);
  const { suggest } = await withLinus({ suggester });

  const { data: word } = await suggest({ text: "Hi Lena,\n\nLunch tomorrow sounds gre" });
  const { data: other } = await suggest({ text: "Hi Lena,\n\nLunch tomorrow sounds gre" });

  expect(word).toEqual({ suggestion: "at!" });
  expect(other).toEqual({});
});

test("where no sentence is begun there is no suggestion, and the model isn't asked", async () => {
  const { suggester, requests } = scripted(() => "Anything.");
  const { suggest } = await withLinus({ suggester });

  const { data: empty } = await suggest({ text: "" });
  const { data: ended } = await suggest({ text: "Hi Erik,\n\nThanks for dinner. " });
  const { data: line } = await suggest({ text: "Hi Erik,\n" });

  expect([empty, ended, line]).toEqual([{}, {}, {}]);
  expect(requests).toEqual([]);
});

test("a later ask supersedes one still being answered, which answers nothing, as when the human types on", async () => {
  let answerFirst = () => {};
  let firstAsked = () => {};
  const first = new Promise<void>((resolve) => (answerFirst = resolve));
  const reached = new Promise<void>((resolve) => (firstAsked = resolve));
  const { suggester } = scripted(async ({ prompt }) => {
    if (prompt.endsWith("so far: See you")) {
      firstAsked();
      await first;
      return "See you on Friday.";
    }
    return "See you soon then.";
  });
  const { suggest } = await withLinus({ suggester });

  const typedOn = suggest({ text: "See you" });
  await reached;
  const latest = await suggest({ text: "See you soon" });
  answerFirst();

  expect((await typedOn).data).toEqual({});
  expect(latest.data).toEqual({ suggestion: " then." });
});

test("a suggestion's cost counts toward the mailbox agents' spend cap, and none is made at the cap", async () => {
  const { suggester, requests } = scripted(() => "See you on Friday.");
  const { ada, suggest } = await withLinus({
    suggester: async (request) => ({ ...(await suggester(request)), inputTokens: 4_000_000, outputTokens: 1_000_000 }),
  });
  await ada.PATCH("/organization/settings", { body: { mailboxAgentSpendCap: 1 } });

  const { data } = await suggest({ text: "See you" });
  const { data: spend } = await ada.GET("/organization/mailbox-agent-spend");
  const { response, error } = await suggest({ text: "See you" });

  expect(data).toEqual({ suggestion: " on Friday." });
  // 4 million input tokens at $0.15 a million, and 1 million output at $0.60.
  expect(spend!.spent).toBeCloseTo(1.2);
  expect(response.status).toBe(409);
  expect(error).toEqual({ message: "The mailbox agents reached the organization's spend cap of $1 this month. Ask an admin to raise it." });
  expect(requests).toHaveLength(1);
});

test("only humans get suggestions, in their own mailboxes", async () => {
  const { suggester, requests } = scripted(() => "See you on Friday.");
  const { duva, linus, grace, graces, suggest } = await withLinus({ suggester });
  const { data: created } = await linus.POST("/agents", { body: { name: "Hermes" } });

  const others = await suggest({ text: "See you" }, grace);
  const agents = await suggest({ text: "See you" }, duva.withKey(created!.key));
  const own = await suggest({ text: "See you" }, grace, graces.id);

  expect(others.response.status).toBe(403);
  expect(others.error).toEqual({ message: "You get suggestions only in your own mailboxes. Write from one of them." });
  expect(agents.response.status).toBe(403);
  expect(agents.error).toEqual({ message: "Only humans get suggestions, as they write in their own mailboxes." });
  expect(own.data).toEqual({ suggestion: " on Friday." });
  expect(requests).toHaveLength(1);
});

test("a human switches suggestions off for themselves, and an admin for the organization, with the model admins choose", async () => {
  const { suggester, requests } = scripted(() => "See you on Friday.");
  const { ada, linus, grace, graces, suggest } = await withLinus({ suggester });

  const { data: preferences } = await linus.GET("/preferences");
  const { data: settings } = await ada.GET("/organization/settings");
  await linus.PATCH("/preferences", { body: { suggestions: "off" } });
  const off = await suggest({ text: "See you" });
  await ada.PATCH("/organization/settings", { body: { suggestionModel: "anthropic.claude-haiku-4-5-20251001-v1:0" } });
  await suggest({ text: "See you" }, grace, graces.id);
  await ada.PATCH("/organization/settings", { body: { suggestions: false } });
  const organizationOff = await suggest({ text: "See you" }, grace, graces.id);
  const unknown = await ada.PATCH("/organization/settings", { body: { suggestionModel: "amazon.nova-pro-v1:0" as never } });

  expect(preferences!.suggestions).toBe("on");
  expect(settings).toMatchObject({ suggestions: true, suggestionModel: "qwen.qwen3-32b-v1:0" });
  expect(off.response.status).toBe(409);
  expect(off.error).toEqual({ message: "You switched suggestions off. Switch them on in your preferences." });
  expect(requests.map(({ model }) => model)).toEqual(["anthropic.claude-haiku-4-5-20251001-v1:0"]);
  expect(organizationOff.response.status).toBe(409);
  expect(organizationOff.error).toEqual({ message: "An admin switched suggestions off for the organization." });
  expect(unknown.response.status).toBe(400);
});

/** The model ID and region each suggestion model is asked with, in a deployment in the region. */
async function askedIn(region: string) {
  const { suggester, requests } = scripted(() => "See you on Friday.");
  const { ada, suggest } = await withLinus({ suggester, region });
  for (const suggestionModel of ["qwen.qwen3-32b-v1:0", "openai.gpt-oss-20b-1:0", "amazon.nova-micro-v1:0", "anthropic.claude-haiku-4-5-20251001-v1:0"] as const) {
    await ada.PATCH("/organization/settings", { body: { suggestionModel } });
    await suggest({ text: "See you" });
  }
  return requests.map(({ modelId, region: from }) => [modelId, from]);
}

// Where Bedrock offers each, by ListFoundationModels and Converse in each region (docs/aws.md, #181).
test("a deployment in the EU asks each suggestion model in its own region where the model runs there, and otherwise from eu-central-1, there or through the eu profile", async () => {
  const [north, paris, london] = await Promise.all(["eu-north-1", "eu-west-3", "eu-west-2"].map(askedIn));

  expect(north).toEqual([
    ["qwen.qwen3-32b-v1:0", "eu-north-1"],
    ["openai.gpt-oss-20b-1:0", "eu-north-1"],
    ["eu.amazon.nova-micro-v1:0", "eu-central-1"],
    ["eu.anthropic.claude-haiku-4-5-20251001-v1:0", "eu-central-1"],
  ]);
  // Neither Qwen3 32B nor gpt-oss-20b runs in eu-west-3, and Nova Micro runs there only through eu.
  expect(paris).toEqual([
    ["qwen.qwen3-32b-v1:0", "eu-central-1"],
    ["openai.gpt-oss-20b-1:0", "eu-central-1"],
    ["eu.amazon.nova-micro-v1:0", "eu-central-1"],
    ["eu.anthropic.claude-haiku-4-5-20251001-v1:0", "eu-central-1"],
  ]);
  // Nova Micro runs on demand in eu-west-2, which its eu profile leaves out.
  expect(london).toEqual([
    ["qwen.qwen3-32b-v1:0", "eu-west-2"],
    ["openai.gpt-oss-20b-1:0", "eu-west-2"],
    ["amazon.nova-micro-v1:0", "eu-west-2"],
    ["eu.anthropic.claude-haiku-4-5-20251001-v1:0", "eu-central-1"],
  ]);
});

test("a deployment in the US asks each suggestion model in its own region or from us-west-2, and one elsewhere in its own region where the model runs there", async () => {
  const [california, tokyo] = await Promise.all(["us-west-1", "ap-northeast-1"].map(askedIn));

  // Neither Qwen3 32B nor gpt-oss-20b runs in us-west-1, nor Nova Micro's us profile.
  expect(california).toEqual([
    ["qwen.qwen3-32b-v1:0", "us-west-2"],
    ["openai.gpt-oss-20b-1:0", "us-west-2"],
    ["us.amazon.nova-micro-v1:0", "us-west-2"],
    ["us.anthropic.claude-haiku-4-5-20251001-v1:0", "us-west-2"],
  ]);
  // Outside the EU and the US, a model is called as Coo's are: Nova Micro through us, and Claude through global.
  expect(tokyo).toEqual([
    ["qwen.qwen3-32b-v1:0", "ap-northeast-1"],
    ["openai.gpt-oss-20b-1:0", "ap-northeast-1"],
    ["us.amazon.nova-micro-v1:0", "us-west-2"],
    ["global.anthropic.claude-haiku-4-5-20251001-v1:0", "eu-central-1"],
  ]);
});

const sends = Array.from({ length: 10 }, (_, at) => ({ to: `friend${at}@example.org`, subject: `Plans ${at + 1}`, text: `Hej!\n\nSes vi på lördag? Plan ${at + 1}.\n\nHa det fint, Linus` }));

test("after every tenth message a human sends, the style note is written from those ten and names their threads", async () => {
  const { suggester, requests } = scripted(({ system }) => (system.includes("describe how they write") ? 'In Swedish he greets with "Hej!" and signs off "Ha det fint, Linus". Short and friendly.' : "Ses vi på lördag?"));
  const { send, memories, suggest } = await withLinus({ suggester });

  for (const { to, subject, text } of sends.slice(0, 9)) await send(to, subject, text);
  const before = await memories();
  await send(sends[9]!.to, sends[9]!.subject, sends[9]!.text);
  const after = await memories();
  await suggest({ text: "Hej Erik!\n\nSes vi" });

  expect(before).toEqual([]);
  const styled = requests.filter(({ system }) => system.includes("describe how they write"));
  expect(styled).toHaveLength(1);
  for (const { text } of sends) expect(styled[0]!.prompt).toContain(text);
  expect(after).toEqual([
    {
      id: expect.any(String),
      text: 'Writing style: In Swedish he greets with "Hej!" and signs off "Ha det fint, Linus". Short and friendly.',
      kept: expect.any(String),
      source: "mail",
      threads: sends.map(({ subject }) => ({ mailbox: expect.any(String), thread: expect.any(String), subject })),
    },
  ]);
  expect(requests.at(-1)!.prompt).toContain('How the writer writes:\nWriting style: In Swedish he greets with "Hej!"');
});

test("the style note asks the suggestion model where suggestions ask it, as from eu-central-1 for a deployment in eu-west-3", async () => {
  const { suggester, requests } = scripted(({ system }) => (system.includes("describe how they write") ? "Short and friendly." : ""));
  const { send, memories } = await withLinus({ suggester, region: "eu-west-3" });

  for (const { to, subject, text } of sends) await send(to, subject, text);

  expect((await memories()).map(({ text }) => text)).toEqual(["Writing style: Short and friendly."]);
  expect(requests.map(({ model, modelId, region }) => [model, modelId, region])).toEqual([["qwen.qwen3-32b-v1:0", "qwen.qwen3-32b-v1:0", "eu-central-1"]]);
});

test("the next ten sends replace the style note, and erasing one of its threads erases it", async () => {
  let note = 0;
  const { suggester } = scripted(({ system }) => (system.includes("describe how they write") ? `Note ${++note}.` : ""));
  const { linus, params, send, memories } = await withLinus({ suggester });
  for (const { to, subject, text } of [...sends, ...sends]) await send(to, subject, `${text}\n`);

  const notes = await memories();
  await linus.POST("/mailboxes/{mailbox}/threads/labels", { params, body: { threads: [notes[0]!.threads![0]!.thread], add: ["trash"], remove: [] } });
  await linus.POST("/mailboxes/{mailbox}/trash/empty", { params });

  expect(notes.map(({ text, threads }) => ({ text, threads: threads!.length }))).toEqual([{ text: "Writing style: Note 2.", threads: 10 }]);
  expect(await memories()).toEqual([]);
});

test("while a human has learning from mail off, their sends write no style note", async () => {
  const { suggester, requests } = scripted(() => "Anything.");
  const { linus, send, memories } = await withLinus({ suggester });
  await linus.PATCH("/preferences", { body: { cooLearnsFromMail: "off" } });

  for (const { to, subject, text } of sends) await send(to, subject, text);

  expect(await memories()).toEqual([]);
  expect(requests).toEqual([]);
});

test("at the mailbox agents' spend cap, sends write no style note", async () => {
  const { suggester, requests } = scripted(() => "Anything.");
  const { ada, send, memories } = await withLinus({ suggester });
  await ada.PATCH("/organization/settings", { body: { mailboxAgentSpendCap: 0 } });

  for (const { to, subject, text } of sends) await send(to, subject, text);

  expect(await memories()).toEqual([]);
  expect(requests).toEqual([]);
});

test("a sentence begun with one letter goes on from where the answer repeats it, never from inside another word", async () => {
  const { suggester } = scripted(() => "Hi Anna,\n\nI will be there at noon. See you!");
  const { suggest } = await withLinus({ suggester });

  const { data } = await suggest({ text: "Hi Anna,\n\nI" });

  expect(data).toEqual({ suggestion: " will be there at noon." });
});
