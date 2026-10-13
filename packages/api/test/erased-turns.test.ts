// Ask Coo's turns go with the threads they read (ADR-0036, #172): each turn names every thread or
// message a tool call of its run took or returned, and those its text names by ID, and erasing one
// of them erases those turns from the conversation, with the human's turns they answered and the
// requests mailed to Coo they answered, in the same work as the thread's other erasure. Each erased
// turn leaves only a mark of where it was, and no later run reads anything of it.
import { expect, test } from "vitest";
import type { Model, ModelEvent } from "../src/agent-loop.ts";
import { type DuvaOptions, startDuva } from "./harness.ts";

type Request = Parameters<Model>[0];

const day = 24 * 60 * 60 * 1000;
const budget = { timeout: 45_000 };
const sonnet = "anthropic.claude-sonnet-5-5";
const nova = "amazon.nova-2-lite-v1:0";

/**
 * A stand-in for Claude that takes one step of the script per model call, each from what it was
 * asked, and records every request. Past the script's end it answers "Done.".
 */
function scripted(...steps: ((request: Request) => ModelEvent[] | Promise<ModelEvent[]>)[]) {
  const requests: Request[] = [];
  let step = 0;
  const model: Model = async function* (request) {
    requests.push(structuredClone(request));
    const events = (await steps[step++]?.(request)) ?? [{ text: "Done." }];
    for (const event of events) yield event;
    yield { usage: { inputTokens: 1000, outputTokens: 100 } };
  };
  return { model, requests };
}

const use = (name: string, input: Record<string, unknown> = {}): ModelEvent => ({ toolUse: { toolUseId: `${name}-${Math.random()}`, name, input } });

const mail = (subject: string, text: string, from: string) =>
  `From: ${from}\r\nTo: linus@example.com\r\nSubject: ${subject}\r\nDate: Sun, 11 Oct 2026 09:00:00 +0200\r\nMessage-ID: <${subject.replaceAll(" ", "-")}@example.pt>\r\n\r\n${text}\r\n`;

const lisbon = mail("Your stay in Lisbon", "Casa Azulejo has you for three nights from 2 November 2026, in room 12.", "Casa Azulejo <bookings@casa-azulejo.example.pt>");
const porto = mail("Your stay in Porto", "Hotel Ribeira has you on 6 November 2026.", "Hotel Ribeira <bookings@ribeira.example.pt>");

/** A turn as erased with the mail its run read: when it was and whose, and nothing else. */
const erased = (from: "human" | "agent") => ({ id: expect.any(String), at: expect.any(String), from, text: "", actions: [], erased: true });

/**
 * A deployment on example.com where Ada is the first admin and Linus a human with the mailbox
 * linus@example.com, its Screener off, holding his Lisbon and Porto bookings, and Grace another
 * human, everything answered by Claude Sonnet 5.5, so a script runs as written.
 */
async function withBookings(options: DuvaOptions = {}) {
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org", humans: ["linus@example.org", "grace@example.org"], ...options });
  const ada = duva.signIn("ada@example.org");
  const linus = duva.signIn("linus@example.org");
  const { data: linusActor } = await linus.GET("/whoami");
  const { data: graceActor } = await duva.signIn("grace@example.org").GET("/whoami");
  const { data: work } = await ada.POST("/mailboxes", { body: { owner: linusActor!.id, address: "linus@example.com" } });
  const params = { path: { mailbox: work!.id } };
  await linus.PATCH("/mailboxes/{mailbox}/screener", { params, body: { on: false } });
  await ada.PATCH("/organization/settings", { body: { mailboxAgentModel: sonnet, mailboxAgentHarderModel: sonnet } });
  const receive = async (raw: string) => {
    await duva.receive(raw, { to: ["linus@example.com"] });
    const { data } = await linus.GET("/mailboxes/{mailbox}/changes", { params });
    return (data!.changes as { type: string; thread: string }[]).findLast(({ type }) => type === "messageReceived")!.thread;
  };
  const threads = { lisbon: await receive(lisbon), porto: await receive(porto) };
  const ask = (words: string, email = "linus@example.org") => duva.askAgent(email, { mailbox: work!.id, words });
  const turns = async (client = linus) => (await client.GET("/mailbox-agent")).data!.turns;
  /** Each turn as its words, or as erased. */
  const said = async (client = linus) => (await turns(client)).map(({ from, text, erased: gone }) => (gone === true ? `${from} erased` : `${from}: ${text}`));
  const trash = (thread: string) => linus.POST("/mailboxes/{mailbox}/threads/labels", { params, body: { threads: [thread], add: ["trash"], remove: [] } });
  const emptyTrash = () => linus.POST("/mailboxes/{mailbox}/trash/empty", { params });
  return { duva, ada, linus, linusId: linusActor!.id, graceId: graceActor!.id, work: work!, params, threads, ask, turns, said, trash, emptyTrash };
}

/**
 * Linus's bookings, and a conversation where he said hi, asked about Porto, which Coo read, and
 * asked about Lisbon, which Coo read and kept a memory of. The script goes on with `more`.
 */
async function askedAboutLisbon(options: DuvaOptions = {}, ...more: ((request: Request) => ModelEvent[] | Promise<ModelEvent[]>)[]) {
  let threads = { lisbon: "", porto: "" };
  const { model, requests } = scripted(
    () => [{ text: "Hello." }],
    () => [use("getThread", { thread: threads.porto })],
    () => [{ text: "On 6 November, at Hotel Ribeira." }],
    () => [use("getThread", { thread: threads.lisbon })],
    () => [use("keepMemory", { text: "Linus stays at Casa Azulejo in Lisbon from 2 November 2026.", threads: [threads.lisbon] })],
    () => [{ text: "At Casa Azulejo, in room 12, from 2 November." }],
    ...more,
  );
  const bookings = await withBookings({ ...options, model });
  threads = bookings.threads;
  await bookings.ask("Hi");
  await bookings.ask("When am I in Porto?");
  await bookings.ask("Where am I staying in Lisbon?");
  /** Asks about Lisbon again, and gives all the run was asked, as JSON. */
  const askedAgain = async () => {
    await bookings.ask("Where am I staying in Lisbon?");
    return JSON.stringify(requests.at(-1));
  };
  return { ...bookings, requests, askedAgain };
}

const kept = ["human: Hi", "agent: Hello.", "human: When am I in Porto?", "agent: On 6 November, at Hotel Ribeira."];

/** Whether a run was asked nothing of the Lisbon booking's thread, while it was asked the Porto turns. */
const forgotten = (asked: string) => asked.includes("Hotel Ribeira") && !asked.includes("Azulejo") && !asked.includes("room 12");

test("erasing a thread after it had Trash for the retention period erases the turns that read it, and the human's turns they answered", budget, async () => {
  const { duva, threads, said, trash, askedAgain } = await askedAboutLisbon();
  await trash(threads.lisbon);

  await duva.erase(new Date(Date.now() + 29 * day));
  const before = await said();
  await duva.erase(new Date(Date.now() + 31 * day));

  expect(before).toEqual([...kept, "human: Where am I staying in Lisbon?", "agent: At Casa Azulejo, in room 12, from 2 November."]);
  expect(await said()).toEqual([...kept, "human erased", "agent erased"]);
  expect(forgotten(await askedAgain())).toBe(true);
});

test("erasing a thread after it had Spam for the retention period erases the turns that read it", budget, async () => {
  const { duva, linus, params, threads, said, askedAgain } = await askedAboutLisbon();
  await linus.POST("/mailboxes/{mailbox}/threads/labels", { params, body: { threads: [threads.lisbon], add: ["spam"], remove: [] } });

  await duva.erase(new Date(Date.now() + 31 * day));

  expect(await said()).toEqual([...kept, "human erased", "agent erased"]);
  expect(forgotten(await askedAgain())).toBe(true);
});

test("emptying Trash erases the turns that read its threads, which keep nothing but when they were and whose", budget, async () => {
  const { threads, turns, said, trash, emptyTrash, askedAgain } = await askedAboutLisbon();
  await trash(threads.lisbon);

  await emptyTrash();

  expect(await said()).toEqual([...kept, "human erased", "agent erased"]);
  expect((await turns()).slice(-2)).toEqual([erased("human"), erased("agent")]);
  expect(forgotten(await askedAgain())).toBe(true);
});

test("sending a sender's mail nowhere erases the turns that read their threads", budget, async () => {
  const { linus, params, said, askedAgain } = await askedAboutLisbon();

  await linus.PUT("/mailboxes/{mailbox}/senders/{sender}", { params: { path: { ...params.path, sender: "bookings@casa-azulejo.example.pt" } }, body: { delivery: "nowhere" } });

  expect(await said()).toEqual([...kept, "human erased", "agent erased"]);
  expect(forgotten(await askedAgain())).toBe(true);
});

test("once a thread is erased, the next run reads none of its words, neither from the turns that read it nor from what Coo learned from it", budget, async () => {
  const { linus, threads, requests, trash, emptyTrash, askedAgain } = await askedAboutLisbon();
  const before = JSON.stringify(requests.at(-1));
  await trash(threads.lisbon);
  await emptyTrash();

  const next = await askedAgain();

  expect(before).toContain("Azulejo");
  expect(next).toContain("Hotel Ribeira");
  expect(next).not.toContain("Azulejo");
  expect(next).not.toContain("room 12");
  expect((await linus.GET("/memories")).data!.memories).toEqual([]);
});

test("Think harder answers no turn erased with mail its run read", budget, async () => {
  const { duva, work, threads, trash, emptyTrash } = await askedAboutLisbon();
  await trash(threads.lisbon);
  await emptyTrash();

  const { status, body } = await duva.askAgent("linus@example.org", { mailbox: work.id, harder: true });

  expect(status).toBe(409);
  expect(body).toEqual({ message: "There's no answer to think harder about. Ask Coo something first." });
});

test("a turn that read two threads goes when either goes, and the other's erasure later finds it gone", budget, async () => {
  let threads = { lisbon: "", porto: "" };
  const { model } = scripted(
    () => [use("getThread", { thread: threads.lisbon }), use("getThread", { thread: threads.porto })],
    () => [{ text: "Lisbon from 2 November, then Porto on the 6th." }],
    () => [use("getThread", { thread: threads.porto })],
    () => [{ text: "Hotel Ribeira." }],
  );
  const bookings = await withBookings({ model });
  threads = bookings.threads;
  const { ask, said, trash, emptyTrash } = bookings;
  await ask("What's my trip?");
  await ask("Where in Porto?");

  await trash(threads.lisbon);
  await emptyTrash();
  const afterLisbon = await said();
  await trash(threads.porto);
  await emptyTrash();

  expect(afterLisbon).toEqual(["human erased", "agent erased", "human: Where in Porto?", "agent: Hotel Ribeira."]);
  expect(await said()).toEqual(["human erased", "agent erased", "human erased", "agent erased"]);
});

test("a turn goes with a thread its run only listed", budget, async () => {
  const { model } = scripted(() => [use("listThreads")], () => [{ text: "Two bookings came." }]);
  const { threads, ask, said, trash, emptyTrash } = await withBookings({ model });
  await ask("What came?");

  await trash(threads.lisbon);
  await emptyTrash();

  expect(await said()).toEqual(["human erased", "agent erased"]);
});

test("a turn goes with a thread its text names by ID, or by the ID of one of its messages", budget, async () => {
  const ids = { thread: "", message: "" };
  const { model } = scripted(() => [{ text: `See thread ${ids.thread}.` }], () => [{ text: `See message ${ids.message}.` }], () => [{ text: "Hello." }]);
  const { linus, params, threads, ask, said, trash, emptyTrash } = await withBookings({ model });
  const { data: read } = await linus.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { ...params.path, thread: threads.porto } } });
  Object.assign(ids, { thread: threads.lisbon, message: read!.messages[0]!.id });
  await ask("Where is Lisbon?");
  await ask("Where is Porto?");
  await ask("Hi");

  await trash(threads.lisbon);
  await emptyTrash();
  const afterLisbon = await said();
  await trash(threads.porto);
  await emptyTrash();

  expect(afterLisbon).toEqual(["human erased", "agent erased", "human: Where is Porto?", `agent: See message ${ids.message}.`, "human: Hi", "agent: Hello."]);
  expect(await said()).toEqual(["human erased", "agent erased", "human erased", "agent erased", "human: Hi", "agent: Hello."]);
});

test("a turn given a memory learned from a thread goes with the thread, as what it says may come from it", budget, async () => {
  const { threads, ask, said, trash, emptyTrash } = await askedAboutLisbon({}, () => [{ text: "At Casa Azulejo, as you told me." }]);
  await ask("Remind me where I stay?");

  await trash(threads.lisbon);
  await emptyTrash();

  expect(await said()).toEqual([...kept, "human erased", "agent erased", "human erased", "agent erased"]);
});

test("a request mailed to Coo whose run read a thread goes with it, with the turn that answered it and the mail it came in", budget, async () => {
  let thread = "";
  const { model } = scripted(() => [use("getThread", { thread })], () => [{ text: "At Casa Azulejo." }]);
  const { duva, threads, said, trash, emptyTrash } = await withBookings({ model });
  thread = threads.lisbon;
  await duva.receive(
    "From: linus@example.org\r\nTo: linus-coo@example.com\r\nSubject: Lisbon hotel?\r\nDate: Sun, 11 Oct 2026 10:00:00 +0000\r\nMessage-ID: <ask-lisbon@example.org>\r\n\r\nWhere am I staying?\r\n",
    { to: ["linus-coo@example.com"] },
  );
  const before = await said();

  await trash(threads.lisbon);
  await emptyTrash();

  expect(before).toEqual([expect.stringMatching(/^human: .*Subject: Lisbon hotel\?/s), "agent: At Casa Azulejo."]);
  expect(await said()).toEqual(["human erased", "agent erased"]);
  expect(duva.stored().some((raw) => raw.includes("Subject: Lisbon hotel?"))).toBe(false);
});

test("a request mailed to Coo whose answer was erased as it was written gets only that said, and goes with it", budget, async () => {
  let bookings: Awaited<ReturnType<typeof withBookings>> | undefined;
  const { model } = scripted(
    () => [use("getThread", { thread: bookings!.threads.lisbon })],
    async () => {
      await bookings!.trash(bookings!.threads.lisbon);
      await bookings!.emptyTrash();
      return [{ text: "At Casa Azulejo." }];
    },
  );
  bookings = await withBookings({ model });
  const { duva, said } = bookings;

  await duva.receive(
    "From: linus@example.org\r\nTo: linus-coo@example.com\r\nSubject: Lisbon hotel?\r\nDate: Sun, 11 Oct 2026 10:00:00 +0000\r\nMessage-ID: <ask-lisbon@example.org>\r\n\r\nWhere am I staying?\r\n",
    { to: ["linus-coo@example.com"] },
  );

  expect(await said()).toEqual(["human erased", "agent erased"]);
  const reply = duva.sent().find((raw) => raw.includes("Subject: Re: Lisbon hotel?"))!;
  expect(reply).toContain("Mail I read for this was erased while I worked on it, so I kept nothing of my answer.");
  expect(reply).not.toContain("Azulejo");
  expect(duva.stored().some((raw) => raw.includes("Subject: Lisbon hotel?"))).toBe(false);
});

test("a thread erased while the run that read it goes on erases the turn as it is written", budget, async () => {
  let bookings: Awaited<ReturnType<typeof withBookings>> | undefined;
  const { model } = scripted(
    () => [use("getThread", { thread: bookings!.threads.lisbon })],
    async () => {
      await bookings!.trash(bookings!.threads.lisbon);
      await bookings!.emptyTrash();
      return [{ text: "At Casa Azulejo." }];
    },
  );
  bookings = await withBookings({ model });

  const { events } = await bookings.ask("Where am I staying in Lisbon?");

  expect(events!.at(-1)).toEqual({ type: "done", turn: erased("agent") });
  expect(await bookings.said()).toEqual(["human erased", "agent erased"]);
});

test("Coo's activity keeps none of what the mail it read says, and no change keeps what the everyday model said in asking for help", budget, async () => {
  let thread = "";
  const { model } = scripted(
    () => [use("getThread", { thread })],
    () => [use("ask_for_help", { why: "Is Casa Azulejo, room 12, the stay they mean?" })],
    () => [{ text: "At Casa Azulejo, in room 12." }],
  );
  const { ada, linus, params, threads, ask, trash, emptyTrash } = await withBookings({ model });
  thread = threads.lisbon;
  await ada.PATCH("/organization/settings", { body: { mailboxAgentAllowedModels: [sonnet, nova], mailboxAgentModel: nova, mailboxAgentHarderModel: sonnet } });
  const coo = (await linus.GET("/mailbox-agent")).data!.agent;
  const activity = async () => {
    const { data } = await linus.GET("/agents/{agent}/events", { params: { path: { agent: coo.id } } });
    const details = await Promise.all(data!.events.map(async ({ id }) => (await linus.GET("/agents/{agent}/events/{event}", { params: { path: { agent: coo.id, event: id } } })).data));
    return JSON.stringify([data, details]);
  };

  const { events } = await ask("Where am I staying in Lisbon?");
  const before = await activity();
  await trash(threads.lisbon);
  await emptyTrash();

  expect(events!.at(-1)).toMatchObject({ type: "done", turn: { handover: { reason: "askedForHelp", why: "Is Casa Azulejo, room 12, the stay they mean?" } } });
  expect(before).toContain("conversationTurn");
  const { data: feed } = await linus.GET("/mailboxes/{mailbox}/changes", { params });
  expect(feed!.changes.filter(({ type }) => type === "agentHandedOver")).toEqual([expect.objectContaining({ handover: { reason: "askedForHelp", from: nova, to: sonnet } })]);
  for (const words of ["Azulejo", "room 12"]) {
    expect(before).not.toContain(words);
    expect(await activity()).not.toContain(words);
  }
});

test("removing a human hands their mailbox over, and erasing its threads later leaves the new owner's conversation as it was", budget, async () => {
  let thread = "";
  const { model, requests } = scripted(() => [use("getThread", { thread })], () => [{ text: "At Casa Azulejo." }], () => [{ text: "Hello, Grace." }]);
  const { duva, ada, linusId, graceId, work, threads, ask, said } = await withBookings({ model });
  thread = threads.lisbon;
  await ask("Where am I staying in Lisbon?");

  const { response } = await ada.POST("/humans/{human}/remove", { params: { path: { human: linusId } }, body: { handOver: [work.id], delete: [], handTo: graceId } });
  const grace = duva.signIn("grace@example.org");
  await ask("Hi", "grace@example.org");
  await grace.POST("/mailboxes/{mailbox}/threads/labels", { params: { path: { mailbox: work.id } }, body: { threads: [threads.lisbon], add: ["trash"], remove: [] } });
  await grace.POST("/mailboxes/{mailbox}/trash/empty", { params: { path: { mailbox: work.id } } });

  expect(response.status).toBe(200);
  expect(JSON.stringify(requests.at(-1))).not.toContain("Azulejo");
  expect(await said(grace)).toEqual(["human: Hi", "agent: Hello, Grace."]);
});
