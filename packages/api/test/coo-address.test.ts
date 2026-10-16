// Coo's address (ADR-0040, #163): mail from its human's allowed senders asks their Coo, proven by
// DMARC, or by Duva's own Message-ID from the organization's addresses, or by a code Coo mails the
// sender. Coo answers the From address by mail, in the request's thread, with what it did, and
// follows up what waited for its human. Requests are turns of Ask Coo and events of Coo's activity,
// and nothing is filed in any mailbox.
import PostalMime from "postal-mime";
import { expect, test } from "vitest";
import type { Model, ModelEvent, ModelMessage } from "../src/agent-loop.ts";
import { type DuvaOptions, startDuva } from "./harness.ts";

type Request = Parameters<Model>[0];

/** A stand-in for Claude that takes one step of the script per model call, and records every request. Past the script's end it answers "Done.". */
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

const lastResult = (messages: ModelMessage[]) => {
  for (const block of messages.at(-1)!.content.toReversed()) if ("toolResult" in block) return JSON.parse(block.toolResult.content[0]!.text) as Record<string, any>;
  throw new Error("No tool answered.");
};

/** Everything the model was given as the human's words, in every request. */
const wordsGiven = (requests: Request[]) => requests.flatMap(({ messages }) => messages.flatMap(({ content }) => content.flatMap((block) => ("text" in block ? [block.text] : []))));

/**
 * A deployment on example.com where Ada is the first admin and Linus, who signs in as
 * linus@example.org, has a mailbox at linus@example.com, its Screener off, so his Coo is at
 * linus-coo@example.com, everything answered by Claude Sonnet 5.5, so a script runs as written.
 */
async function withCoo(options: DuvaOptions = {}) {
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org", humans: ["linus@example.org"], ...options });
  const ada = duva.signIn("ada@example.org");
  const linus = duva.signIn("linus@example.org");
  const { data: linusActor } = await linus.GET("/whoami");
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: linusActor!.id, address: "linus@example.com" } });
  await linus.PATCH("/mailboxes/{mailbox}/screener", { params: { path: { mailbox: mailbox!.id } }, body: { on: false } });
  await ada.PATCH("/organization/settings", { body: { mailboxAgentModel: "anthropic.claude-sonnet-5-5", mailboxAgentHarderModel: "anthropic.claude-sonnet-5-5" } });
  const coo = (await linus.GET("/agents")).data!.agents[0]!;
  const events = async () => (await linus.GET("/agents/{agent}/events", { params: { path: { agent: coo.id }, query: { kinds: ["conversations"] } } })).data!.events;
  const turns = async () => (await linus.GET("/mailbox-agent")).data!.turns;
  return { duva, ada, linus, linusId: linusActor!.id, mailbox: mailbox!, coo, events, turns };
}

/** A request mailed to Coo, from the sender, with the Message-ID given, and any more header fields. */
const request = ({ from = "linus@example.org", to = "linus-coo@example.com", subject = "Question", text = "What's new?", id = "request-1", headers = [] as string[] } = {}) =>
  [`From: ${from}`, `To: ${to}`, `Subject: ${subject}`, "Date: Sun, 11 Oct 2026 10:00:00 +0000", `Message-ID: <${id}@example.org>`, ...headers, "", text, ""].join("\r\n");

/** The messages SES accepted for sending, parsed. */
const sentMail = async (duva: { sent(): string[] }) => Promise.all(duva.sent().map((raw) => PostalMime.parse(raw)));

/** The six-digit code in the mail. */
const codeIn = (text: string | undefined) => /\b(\d{6})\b/.exec(text ?? "")![1]!;

const failingDmarc = { verdicts: { dmarc: "FAIL" as const, dmarcPolicy: "none" as const } };

test("each human's Coo gets an address with their first mailbox, listed in the receipt rules, plus tags included, and -coo2 where -coo is taken", async () => {
  const { duva, ada, linus, linusId } = await withCoo({ humans: ["linus@example.org", "grace@example.org"] });
  const grace = duva.signIn("grace@example.org");
  const { data: graceActor } = await grace.GET("/whoami");
  const { data: other } = await ada.POST("/mailboxes", { body: { owner: linusId, address: "grace-coo@example.com" } });

  await ada.POST("/mailboxes", { body: { owner: graceActor!.id, address: "grace@example.com" } });

  expect((await linus.GET("/mailbox-agent/address")).data).toEqual({ address: "linus-coo@example.com", ownAddresses: ["linus@example.org", "grace-coo@example.com", "linus@example.com"], allowedSenders: [] });
  expect((await grace.GET("/mailbox-agent/address")).data).toMatchObject({ address: "grace-coo2@example.com" });
  const { data: addresses } = await ada.GET("/addresses");
  expect(addresses!.addresses).toEqual(expect.arrayContaining([{ address: "linus-coo@example.com", coo: linusId }, { address: "grace-coo2@example.com", coo: graceActor!.id }, { address: "grace-coo@example.com", mailbox: other!.id }]));
  const { refused } = await duva.receive(request({ to: "linus-coo+anything@example.com" }), { to: ["linus-coo+anything@example.com", "linus-coo@example.com"] });
  expect(refused).toEqual([]);
});

test("setup gives a Coo its address when its human had a mailbox before Coo had one", async () => {
  const { duva, linus } = await withCoo({ beforeCooAddress: true });
  expect((await linus.GET("/mailbox-agent/address")).data).not.toHaveProperty("address");
  expect((await duva.receive(request(), { to: ["linus-coo@example.com"] })).refused).toEqual(["linus-coo@example.com"]);

  await duva.setUp({ admin: "ada@example.org" });

  expect((await linus.GET("/mailbox-agent/address")).data).toMatchObject({ address: "linus-coo@example.com" });
  expect((await duva.receive(request(), { to: ["linus-coo@example.com"] })).refused).toEqual([]);
});

test("an admin changes a Coo's address, and it goes with its human, with the requests mailed to it", async () => {
  const { model } = scripted(() => [{ text: "Noted." }]);
  const { duva, ada, linus, linusId, mailbox } = await withCoo({ model });
  await duva.receive(request({ subject: "Before I go" }), { to: ["linus-coo@example.com"] });
  expect(duva.stored().some((raw) => raw.includes("Subject: Before I go"))).toBe(true);

  const { data: changed } = await ada.PUT("/humans/{human}/coo-address", { params: { path: { human: linusId } }, body: { address: "assistant@example.com" } });
  const { error: taken } = await ada.PUT("/humans/{human}/coo-address", { params: { path: { human: linusId } }, body: { address: "linus@example.com" } });
  const { error: byLinus } = await linus.PUT("/humans/{human}/coo-address", { params: { path: { human: linusId } }, body: { address: "other@example.com" } });
  const { error: removed } = await ada.DELETE("/addresses/{address}", { params: { path: { address: "assistant@example.com" } } });

  expect(changed).toEqual({ address: "assistant@example.com", coo: linusId });
  expect(taken).toMatchObject({ message: "linus@example.com is taken. Give another address." });
  expect(byLinus).toMatchObject({ message: "Only admins can change a Coo's address. Ask an admin to." });
  expect(removed).toMatchObject({ message: expect.stringContaining("is a Coo's address") });
  expect((await duva.receive(request({ to: "linus-coo@example.com" }), { to: ["linus-coo@example.com", "assistant@example.com"] })).refused).toEqual(["linus-coo@example.com"]);

  await ada.POST("/humans/{human}/remove", { params: { path: { human: linusId } }, body: { delete: [mailbox.id] } });

  const { data: addresses } = await ada.GET("/addresses");
  expect(addresses!.addresses.map(({ address }) => address)).not.toContain("assistant@example.com");
  expect((await duva.receive(request({ to: "assistant@example.com" }), { to: ["assistant@example.com"] })).refused).toEqual(["assistant@example.com"]);
  expect(duva.stored().some((raw) => raw.includes("Subject: Before I go"))).toBe(false);
});

test("an allowed sender whose DMARC passes asks Coo by mail, and gets its answer from Coo's address, in the request's thread, as a turn of Ask Coo, filed in no mailbox", async () => {
  const { model, requests } = scripted(() => [{ text: "Nothing new since Friday." }]);
  const { duva, linus, mailbox, events, turns } = await withCoo({ model });

  await duva.receive(request({ headers: ["References: <earlier@example.org>"] }), { to: ["linus-coo@example.com"] });

  const [answer] = await sentMail(duva);
  expect(answer).toMatchObject({ from: { name: "Coo", address: "linus-coo@example.com" }, to: [{ address: "linus@example.org" }], subject: "Re: Question", inReplyTo: "<request-1@example.org>" });
  expect(answer!.references).toBe("<earlier@example.org> <request-1@example.org>");
  expect(answer!.text).toContain("Nothing new since Friday.");
  expect(answer!.text).toContain("Sent by Coo for linus@example.org");
  expect(answer!.headers).toContainEqual({ key: "duva-agent", originalKey: "Duva-Agent", value: "Coo for linus@example.org" });
  expect(wordsGiven(requests).join("\n")).toContain("linus@example.org mailed this to your address. Your answer is mailed back to linus@example.org, with what you did.\n\nSubject: Question\n\nWhat's new?");
  expect(await turns()).toMatchObject([
    { from: "human", byMail: "linus@example.org", text: "Subject: Question\n\nWhat's new?" },
    { from: "agent", byMail: "linus@example.org", text: "Nothing new since Friday.", outcome: "answered" },
  ]);
  const { data: threads } = await linus.GET("/mailboxes/{mailbox}/all-mail", { params: { path: { mailbox: mailbox.id } } });
  expect(threads!.threads).toEqual([]);
  expect((await events()).map(({ type, summary }) => [type, summary])).toEqual([
    ["mailToCoo", "Coo mailed linus@example.org its answer, with what it did."],
    ["conversationTurn", "linus@example.org mailed Coo something."],
  ]);
});

test("what Coo writes before a tool call and after it stays apart as paragraphs, in its reply and the turn", async () => {
  const { model } = scripted(
    () => [{ text: "I'll look at your agents." }, use("listAgents")],
    () => [{ text: "Nothing new since Friday." }],
  );
  const { duva, turns } = await withCoo({ model });

  await duva.receive(request(), { to: ["linus-coo@example.com"] });

  const [answer] = await sentMail(duva);
  expect(answer!.text).toContain("I'll look at your agents.\n\nNothing new since Friday.");
  expect((await turns()).at(-1)).toMatchObject({ from: "agent", text: "I'll look at your agents.\n\nNothing new since Friday." });
});

test("mail from a sender who isn't allowed is dropped, and noted in Coo's activity without what it says", async () => {
  const { model, requests } = scripted(() => [{ text: "Hello." }]);
  const { duva, ada, coo, events, turns } = await withCoo({ model });

  await duva.receive(request({ from: "grace@example.org", subject: "Secret plans" }), { to: ["linus-coo@example.com"] });

  expect(duva.sent()).toEqual([]);
  expect(requests).toEqual([]);
  expect(await turns()).toEqual([]);
  expect(duva.stored().some((raw) => raw.includes("Secret plans"))).toBe(false);
  expect((await events()).map(({ summary }) => summary)).toEqual(["grace@example.org mailed Coo's address, but may not ask it, so the mail was dropped."]);
  const { data: asAdmin } = await ada.GET("/agents/{agent}/events/{event}", { params: { path: { agent: coo.id, event: (await events())[0]!.id } } });
  expect(asAdmin!.change).not.toHaveProperty("from");
});

test("a listed sender whose DMARC fails gets a code, and the reply that brings it back within the hour runs the request, while another code doesn't", async () => {
  const { model } = scripted(() => [{ text: "Your flight leaves at nine." }]);
  const { duva, linus, events, turns } = await withCoo({ model });
  const { data: listed } = await linus.PATCH("/mailbox-agent/address", { body: { allowedSenders: ["Assistant@Example.net"] } });
  expect(listed).toMatchObject({ allowedSenders: ["assistant@example.net"] });
  const at = new Date("2026-10-11T10:00:00Z");

  await duva.receive(request({ from: "assistant@example.net", subject: "Flight", text: "When does Linus fly?" }), { to: ["linus-coo@example.com"] }, { ...failingDmarc, at });

  const [codeMail] = await sentMail(duva);
  expect(codeMail).toMatchObject({ from: { address: "linus-coo@example.com" }, to: [{ address: "assistant@example.net" }], subject: "Re: Flight", inReplyTo: "<request-1@example.org>" });
  expect(await turns()).toEqual([]);
  const code = codeIn(codeMail!.text);
  const wrong = String((Number(code) + 1) % 1_000_000).padStart(6, "0");
  const reply = (id: string, text: string) => request({ from: "assistant@example.net", subject: "Re: Flight", text, id, headers: [`In-Reply-To: ${codeMail!.messageId}`] });

  await duva.receive(reply("reply-1", `Here it is: ${wrong}`), { to: ["linus-coo@example.com"] }, { ...failingDmarc, at: new Date(at.getTime() + 5 * 60_000) });
  expect(duva.sent()).toHaveLength(1);
  expect(await turns()).toEqual([]);

  await duva.receive(reply("reply-2", `Here it is: ${code}`), { to: ["linus-coo@example.com"] }, { ...failingDmarc, at: new Date(at.getTime() + 10 * 60_000) });

  const [, answer] = await sentMail(duva);
  expect(answer).toMatchObject({ to: [{ address: "assistant@example.net" }], subject: "Re: Flight", inReplyTo: codeMail!.messageId });
  expect(answer!.text).toContain("Your flight leaves at nine.");
  expect(await turns()).toMatchObject([{ from: "human", byMail: "assistant@example.net", text: "Subject: Flight\n\nWhen does Linus fly?" }, { from: "agent" }]);
  expect((await events()).map(({ summary }) => summary)).toEqual([
    "Coo mailed assistant@example.net its answer, with what it did.",
    "assistant@example.net mailed Coo something.",
    "assistant@example.net brought Coo's code back, so it took their request.",
    "assistant@example.net replied with another code than Coo mailed them, so their request still waits.",
    "Coo mailed assistant@example.net a code, to confirm a request was theirs.",
  ]);

  // Codes are single-use.
  await duva.receive(reply("reply-3", `Again: ${code}`), { to: ["linus-coo@example.com"] }, { ...failingDmarc, at: new Date(at.getTime() + 15 * 60_000) });
  expect((await turns()).length).toBe(2);
});

test("a code brought back more than an hour late runs nothing, and the eraser drops the request that waited, never verified", async () => {
  const { model, requests } = scripted(() => [{ text: "Hello." }]);
  const { duva, linus, events, turns } = await withCoo({ model });
  await linus.PATCH("/mailbox-agent/address", { body: { allowedSenders: ["assistant@example.net"] } });
  const at = new Date("2026-10-11T10:00:00Z");
  await duva.receive(request({ from: "assistant@example.net", subject: "Late one" }), { to: ["linus-coo@example.com"] }, { ...failingDmarc, at });
  const [codeMail] = await sentMail(duva);

  await duva.receive(
    request({ from: "assistant@example.net", subject: "Re: Late one", text: codeIn(codeMail!.text), id: "reply-1", headers: [`In-Reply-To: ${codeMail!.messageId}`] }),
    { to: ["linus-coo@example.com"] },
    { ...failingDmarc, at: new Date(at.getTime() + 61 * 60_000) },
  );
  await duva.erase(new Date(at.getTime() + 2 * 60 * 60_000));

  expect(requests).toEqual([]);
  expect(await turns()).toEqual([]);
  expect(duva.sent()).toHaveLength(1);
  expect(duva.stored().some((raw) => raw.includes("Late one"))).toBe(false);
  expect((await events()).map(({ summary, failed }) => [summary, failed])).toEqual([
    ["No code came back from assistant@example.net within the hour, so Coo dropped their request.", true],
    ["assistant@example.net brought Coo's code back more than an hour after it was mailed, so their request wasn't taken.", true],
    ["Coo mailed assistant@example.net a code, to confirm a request was theirs.", false],
  ]);
});

test("from the organization's own address, a request Duva sent is taken at once, and one without Duva's Message-ID waits for a code", async () => {
  const { model } = scripted(
    () => [{ text: "First answer." }],
    () => [{ text: "Second answer." }],
  );
  const { duva, linus, mailbox, turns } = await withCoo({ model });
  const params = { path: { mailbox: mailbox.id } };
  const { data: draft } = await linus.POST("/mailboxes/{mailbox}/drafts", { params, body: { to: ["linus-coo@example.com"], subject: "From my mailbox", text: "Anything urgent?" } });
  await linus.POST("/mailboxes/{mailbox}/drafts/{draft}/send", { params: { path: { ...params.path, draft: draft!.id } } });
  const [own] = duva.sent();
  const forged = own!.replace(/^Message-ID: <[^@]+@/m, "Message-ID: <forged@").replace(/^Subject: .*$/m, "Subject: Forged");

  await duva.receive(own!, { to: ["linus-coo@example.com"] });
  await duva.receive(forged, { to: ["linus-coo@example.com"] });

  const [, answer, codeMail] = await sentMail(duva);
  expect(answer).toMatchObject({ to: [{ address: "linus@example.com" }], subject: "Re: From my mailbox" });
  expect(answer!.text).toContain("First answer.");
  expect(codeMail).toMatchObject({ to: [{ address: "linus@example.com" }], subject: "Re: Forged" });
  expect(codeMail!.text).toMatch(/\b\d{6}\b/);
  expect((await turns()).map(({ text }) => text)).toEqual(["Subject: From my mailbox\n\nAnything urgent?", "First answer."]);
});

test("Coo answers the From address, never a forged Reply-To", async () => {
  const { model } = scripted(() => [{ text: "Here's the summary." }]);
  const { duva } = await withCoo({ model });

  await duva.receive(request({ headers: ["Reply-To: mallory@example.net"] }), { to: ["linus-coo@example.com"] });

  expect(duva.sentTo()).toEqual([["linus@example.org"]]);
  const [answer] = await sentMail(duva);
  expect(answer!.to).toEqual([{ address: "linus@example.org", name: "" }]);
  expect(answer!.replyTo).toBeUndefined();
});

test("Coo reads a request's forwarded mail and its attachments", async () => {
  const { model, requests } = scripted(() => [{ text: "The invoice is 42 kr." }]);
  const { duva } = await withCoo({ model });
  const raw = [
    "From: linus@example.org",
    "To: linus-coo@example.com",
    "Subject: Fwd: Invoice",
    "Message-ID: <forward-1@example.org>",
    "MIME-Version: 1.0",
    'Content-Type: multipart/mixed; boundary="part"',
    "",
    "--part",
    "Content-Type: text/plain",
    "",
    "How much is this?",
    "--part",
    "Content-Type: message/rfc822",
    'Content-Disposition: attachment; filename="invoice.eml"',
    "",
    "From: billing@example.net",
    "Subject: Your invoice",
    "",
    "You owe 42 kr by Friday.",
    "--part",
    'Content-Type: text/csv; name="lines.csv"',
    'Content-Disposition: attachment; filename="lines.csv"',
    "",
    "item,amount",
    "coffee,42",
    "--part--",
    "",
  ].join("\r\n");

  await duva.receive(raw, { to: ["linus-coo@example.com"] });

  const words = wordsGiven(requests).join("\n");
  expect(words).toContain("How much is this?");
  expect(words).toContain("A forwarded mail, invoice.eml:\nFrom: billing@example.net\nSubject: Your invoice\n\nYou owe 42 kr by Friday.");
  expect(words).toContain("The attachment lines.csv (text/csv):\nitem,amount\ncoffee,42");
});

/** A script in which Coo drafts a mail to Grace and asks to send it, then says so. */
const draftsAndAsksToSend = () =>
  scripted(
    () => [use("createAllMailboxesDraft", { to: ["grace@example.org"], subject: "Lunch", text: "Lunch at noon?" })],
    (request) => [use("sendAllMailboxesDraft", { draft: lastResult(request.messages).id })],
    () => [{ text: "I wrote to Grace." }],
  );

test("Coo's reply says what it did, and a later reply in the thread says how a send that waited for approval was decided", async () => {
  const { model } = draftsAndAsksToSend();
  const { duva, linus, coo, events } = await withCoo({ model });

  await duva.receive(request({ subject: "Lunch with Grace", text: "Ask Grace to lunch." }), { to: ["linus-coo@example.com"] });

  const [answer] = await sentMail(duva);
  expect(answer!.text).toContain("I wrote to Grace.\n\nWhat I did:\n- Done: Draft a reply, a forward or a new message in All mailboxes, in the mailbox it goes from.\n- Ask for a draft in All mailboxes to be sent, from its own mailbox: it waits for your approval. I'll write again once it's decided.");

  const { data: approvals } = await linus.GET("/approvals");
  await linus.POST("/approvals/{approval}/send", { params: { path: { approval: approvals!.approvals[0]!.id } } });

  const fromCoo = (await sentMail(duva)).filter(({ from }) => from?.address === "linus-coo@example.com");
  expect(fromCoo).toHaveLength(2);
  expect(fromCoo[1]).toMatchObject({ to: [{ address: "linus@example.org" }], subject: "Re: Lunch with Grace" });
  expect(fromCoo[1]!.text).toContain('The mail "Lunch" to grace@example.org was sent.');
  expect(fromCoo[1]!.references).toContain("<request-1@example.org>");
  const [followedUp] = await events();
  expect(followedUp).toMatchObject({ type: "mailToCoo", summary: "Coo mailed linus@example.org that the send it waited on was sent." });
  const { data: detail } = await linus.GET("/agents/{agent}/events/{event}", { params: { path: { agent: coo.id, event: followedUp!.id } } });
  expect(detail!.change).toMatchObject({ event: "followedUp", outcome: "sent", results: ["The mail I wrote was sent."] });
});

test("Coo's activity and the change feed keep none of a request's words, nor what its browsing said, what it searched for or why Duva refused it, while its reply says them", async () => {
  // Coo's steps, the browsing run's, and the web search reader's, told apart by the tools each has.
  const steps = [
    () => [use("labelAllMailboxesThreads", { threads: ["Casa Azulejo"], add: ["trips"], remove: [] }), use("bookTable", { at: "Taberna Azul" })],
    () => [use("browse", { url: "https://tables.example.net/book", goal: "Book a table for two near Casa Azulejo on Friday." })],
    () => [use("searchWeb", { query: "restaurants near Casa Azulejo Alfama" })],
    () => [{ text: "I booked Taberna Azul for Friday." }],
  ];
  let step = 0;
  const model: Model = async function* (request) {
    const browsing = request.tools.some(({ name }) => name === "finish");
    const events = browsing ? [use("finish", { done: true, said: "It booked a table for two at Taberna Azul, at eight." })] : request.tools.length === 0 ? [{ text: "Taberna Azul is near." }] : (steps[step++]?.() ?? [{ text: "Done." }]);
    for (const event of events) yield event;
    yield { usage: { inputTokens: 1000, outputTokens: 100 } };
  };
  const { duva, linus, mailbox, coo, events } = await withCoo({ model, webSearch: async () => [{ title: "Taberna Azul", url: "https://taberna.example.pt/", text: "A tavern in Alfama." }] });
  await duva.webServer("tables.example.net", { answer: async () => new Response("<!doctype html><html><head><title>Tables</title></head><body><p>Booked.</p></body></html>", { headers: { "content-type": "text/html" } }) });
  const labelling = "Add labels to threads in All mailboxes, and remove them, each in its own mailbox";
  const forwarded = "---------- Forwarded message ---------\nFrom: Casa Azulejo <bookings@casa-azulejo.example.pt>\nSubject: Your stay in Lisbon\n\nCasa Azulejo has you for three nights from 2 November 2026, in room 12.";

  await duva.receive(request({ subject: "Dinner in Lisbon", text: `Book a table near my hotel for Friday.\n\n${forwarded}` }), { to: ["linus-coo@example.com"] });

  const [answer] = await sentMail(duva);
  expect(answer!.text).toContain(
    `What I did:\n- Not done: ${labelling}. None of the mailboxes you can read has a thread "Casa Azulejo", so no thread was changed. List All mailboxes' threads to find their IDs.\n- Browsed example.net: It booked a table for two at Taberna Azul, at eight.\n- Searched the web for "restaurants near Casa Azulejo Alfama".`,
  );
  const listed = await events();
  const details = await Promise.all(listed.map(async ({ id }) => (await linus.GET("/agents/{agent}/events/{event}", { params: { path: { agent: coo.id, event: id } } })).data!));
  expect(listed.map(({ summary }) => summary)).toEqual(["Coo mailed linus@example.org its answer, with what it did.", "linus@example.org mailed Coo something."]);
  expect(details[0]!.change).toMatchObject({ type: "mailToCoo", event: "answered", results: [`Not done: ${labelling}.`, "Browsed example.net.", "Searched the web."] });
  const { data: feed } = await linus.GET("/mailboxes/{mailbox}/changes", { params: { path: { mailbox: mailbox.id } } });
  const kept = JSON.stringify([listed, details, feed]);
  for (const words of ["Dinner", "Lisbon", "hotel", "Azulejo", "room 12", "Taberna", "table for two", "Alfama", "bookTable"]) expect(kept).not.toContain(words);
});

test("a send that waited and was rejected is followed up once, saying it wasn't sent", async () => {
  const { model } = draftsAndAsksToSend();
  const { duva, linus } = await withCoo({ model });
  await duva.receive(request({ subject: "Lunch with Grace", text: "Ask Grace to lunch." }), { to: ["linus-coo@example.com"] });

  const { data: approvals } = await linus.GET("/approvals");
  await linus.POST("/approvals/{approval}/reject", { params: { path: { approval: approvals!.approvals[0]!.id } }, body: { note: "Not this week." } });

  const fromCoo = (await sentMail(duva)).filter(({ from }) => from?.address === "linus-coo@example.com");
  expect(fromCoo).toHaveLength(2);
  expect(fromCoo[1]!.text).toContain(`You didn't approve the mail "Lunch" to grace@example.org, so it wasn't sent.`);
});

test("starting a new conversation erases the requests mailed to Coo, with their attachments", async () => {
  const { model } = scripted(() => [{ text: "Noted." }]);
  const { duva, linus } = await withCoo({ model });
  await duva.receive(request({ subject: "Keep this private" }), { to: ["linus-coo@example.com"] });
  expect(duva.stored().some((raw) => raw.includes("Keep this private"))).toBe(true);

  await linus.DELETE("/mailbox-agent/conversation");

  expect(duva.stored().some((raw) => raw.includes("Subject: Keep this private"))).toBe(false);
});

test("requests by mail count toward the mailbox agents' spend cap, and with the agents off, Coo's reply says so", async () => {
  const { model } = scripted(() => [{ text: "Here you go." }]);
  const { duva, ada } = await withCoo({ model });

  await duva.receive(request(), { to: ["linus-coo@example.com"] });

  expect((await ada.GET("/organization/mailbox-agent-spend")).data!.spent).toBeGreaterThan(0);
  await ada.PATCH("/organization/settings", { body: { mailboxAgentSpendCap: 0 } });
  await duva.receive(request({ id: "request-2", subject: "Again" }), { to: ["linus-coo@example.com"] });
  const [, refused] = await sentMail(duva);
  expect(refused).toMatchObject({ to: [{ address: "linus@example.org" }], subject: "Re: Again" });
  expect(refused!.text).toContain("An admin turned the mailbox agents off, with a spend cap of $0. Ask one to raise it.");
});

/**
 * A deployment where Linus keeps a card that pays on example.net up to 100.00 SEK, and the shop at
 * shop.example.net checks out the beans in his cart for 149.00 SEK, until a test has the checkout
 * expire, and his Coo's browsing runs fill the card in, then the run that goes back pays, as `goBack` scripts it.
 */
async function withCheckout(goBack: ((request: Request) => ModelEvent[])[]) {
  const browsing = (request: Request) => request.tools.some(({ name }) => name === "finish");
  const buys: ((request: Request) => ModelEvent[])[] = [() => [use("browse", { url: "https://shop.example.net/checkout", goal: "Buy the coffee beans in the cart.", secrets: ["Visa"] })], () => [{ text: "I tried to buy the beans." }]];
  const page = [fill(1, "number"), ...goBack];
  let [cooStep, pageStep] = [0, 0];
  const model: Model = async function* (request) {
    const events = browsing(request) ? (page[pageStep++]?.(request) ?? [use("finish", { done: false, said: "It stopped." })]) : request.tools.length === 0 ? [{ text: "Nothing." }] : (buys[cooStep++]?.(request) ?? [{ text: "Done." }]);
    for (const event of events) yield event;
    yield { usage: { inputTokens: 1000, outputTokens: 100 } };
  };
  const coo = await withCoo({ model });
  const html = (body: string) => new Response(`<!doctype html><html><head><title>Example Shop</title></head><body>${body}</body></html>`, { headers: { "content-type": "text/html" } });
  const checkout = { expired: false };
  await coo.duva.webServer("shop.example.net", {
    answer: async ({ url }) =>
      new URL(url).pathname !== "/checkout"
        ? html("<p>Thank you!</p>")
        : checkout.expired
          ? html("<p>This checkout has expired.</p>")
          : html(
              `<p>Coffee beans, 1 kg. Total: 149.00 SEK</p><form method="post" action="/pay"><label for="n">Card number</label><input id="n" name="n" autocomplete="cc-number"><label for="e">Expiry</label><input id="e" name="e" autocomplete="cc-exp"><label for="c">CVC</label><input id="c" name="c" autocomplete="cc-csc"><button>Pay now</button></form>`,
            ),
  });
  await coo.linus.POST("/secrets", { body: { kind: "card", name: "Visa", number: "4242 4242 4242 4242", expiry: "12/29", cvc: "123", cardholder: "Linus Torvalds", currency: "SEK", perPayment: "100.00", perMonth: "150.00", sites: ["example.net"] } as never });
  const fromCoo = async () => (await sentMail(coo.duva)).filter(({ from }) => from?.address === "linus-coo@example.com");
  const approve = async () => {
    const { data: payments } = await coo.linus.GET("/payments");
    await coo.linus.POST("/payments/{payment}/approve", { params: { path: { payment: payments!.payments[0]!.id } } });
  };
  return { ...coo, checkout, fromCoo, approve };
}

const fill = (element: number, part: string) => () => [use("fillSecret", { element, secret: "Visa", part, amount: "149.00", currency: "SEK", for: "Coffee beans, 1 kg" })];
// A request's run, its approval and the run that goes back to pay take longer than most tests.
const budget = { timeout: 45_000 };

test("a payment above its card's limits waits, Coo's reply says so, and once it is approved, later replies say Coo goes back to pay it, then that it paid, with no one asking again", budget, async () => {
  const { duva, linus, coo, events, fromCoo, approve } = await withCheckout([fill(1, "number"), fill(2, "expiry"), fill(3, "cvc"), () => [use("click", { element: 4 })], () => [use("finish", { done: true, said: "It paid for the beans." })]]);

  await duva.receive(request({ subject: "Coffee", text: "Buy the beans in my cart." }), { to: ["linus-coo@example.com"] });
  const [answered] = await events();
  const { data: detail } = await linus.GET("/agents/{agent}/events/{event}", { params: { path: { agent: coo.id, event: answered!.id } } });
  await approve();

  const mails = await fromCoo();
  expect(mails).toHaveLength(3);
  expect(mails[0]!.text).toContain("Browsed example.net: The payment of 149.00 SEK on example.net is above Visa's limits, so it waits for your approval in Approvals.");
  expect(mails[0]!.text).toContain("Paying 149.00 SEK on example.net with Visa, for Coffee beans, 1 kg: it's above the card's limits, so it waits for your approval. I'll write again once it's decided.");
  expect(detail!.change).toMatchObject({ event: "answered", results: ["Browsed example.net.", "Paying 149.00 SEK on example.net with Visa: it's above the card's limits, so it waits for your approval. I'll write again once it's decided."] });
  expect(mails.slice(1).map(({ subject, to }) => ({ subject, to }))).toEqual([
    { subject: "Re: Coffee", to: [{ address: "linus@example.org", name: "" }] },
    { subject: "Re: Coffee", to: [{ address: "linus@example.org", name: "" }] },
  ]);
  expect(mails.slice(1).map(({ text }) => text!.split("\n")[0])).toEqual(
    expect.arrayContaining(["You approved paying 149.00 SEK on example.net. I'm going back to the page to pay it, and I'll write again once I have.", "I paid 149.00 SEK on example.net with Visa, as approved."]),
  );
});

test("a payment approved after its page expired is followed up with what the run that went back to pay it said", budget, async () => {
  const { duva, linus, coo, events, checkout, fromCoo, approve } = await withCheckout([() => [use("finish", { done: false, said: "The checkout had expired, so it couldn't pay." })]]);
  await duva.receive(request({ subject: "Coffee", text: "Buy the beans in my cart." }), { to: ["linus-coo@example.com"] });
  checkout.expired = true;

  await approve();

  const mails = await fromCoo();
  expect(mails).toHaveLength(3);
  expect(mails.slice(1).map(({ text }) => text!.split("\n")[0])).toEqual(
    expect.arrayContaining(["You approved paying 149.00 SEK on example.net. I'm going back to the page to pay it, and I'll write again once I have.", "I went back to pay 149.00 SEK on example.net, as approved, but couldn't: The checkout had expired, so it couldn't pay."]),
  );
  const followedUp = (await events()).filter(({ summary }) => summary.includes("that it couldn't pay"));
  const { data: detail } = await linus.GET("/agents/{agent}/events/{event}", { params: { path: { agent: coo.id, event: followedUp[0]!.id } } });
  expect(detail!.change).toMatchObject({ event: "followedUp", outcome: "unpaid", results: ["I went back to pay 149.00 SEK on example.net, as approved, but couldn't."] });
});

test("mail that brings numbers but not the code counts as an attempt, so forged mail can't guess its way to the code", async () => {
  const { model, requests } = scripted(() => [{ text: "Hello." }]);
  const { duva, linus, turns } = await withCoo({ model });
  await linus.PATCH("/mailbox-agent/address", { body: { allowedSenders: ["assistant@example.net"] } });
  await duva.receive(request({ from: "assistant@example.net", subject: "Guess" }), { to: ["linus-coo@example.com"] }, failingDmarc);
  const [codeMail] = await sentMail(duva);
  const code = codeIn(codeMail!.text);
  const guesses = Array.from({ length: 15 }, (_, index) => String((Number(code) + 1 + index) % 1_000_000).padStart(6, "0"));

  for (let attempt = 0; attempt < 5; attempt++) {
    await duva.receive(request({ from: "assistant@example.net", subject: "Guessing", text: guesses.slice(attempt * 3, attempt * 3 + 3).join(" "), id: `guess-${attempt}` }), { to: ["linus-coo@example.com"] }, failingDmarc);
  }
  await duva.receive(request({ from: "assistant@example.net", subject: "Re: Guess", text: code, id: "late", headers: [`In-Reply-To: ${codeMail!.messageId}`] }), { to: ["linus-coo@example.com"] }, failingDmarc);

  expect(requests).toEqual([]);
  expect(await turns()).toEqual([]);
});

test("Coo's reply to another allowed sender names its human as the one whose approval a payment waits for", budget, async () => {
  const { duva, linus, fromCoo } = await withCheckout([]);
  await linus.PATCH("/mailbox-agent/address", { body: { allowedSenders: ["assistant@example.net"] } });

  await duva.receive(request({ from: "assistant@example.net", subject: "Coffee", text: "Buy the beans in Linus's cart." }), { to: ["linus-coo@example.com"] });

  const [answer] = await fromCoo();
  expect(answer!.to).toEqual([{ address: "assistant@example.net", name: "" }]);
  expect(answer!.text).toContain("Browsed example.net: The payment of 149.00 SEK on example.net is above Visa's limits, so it waits for linus@example.org's approval in Approvals.");
  expect(answer!.text).toContain("Paying 149.00 SEK on example.net with Visa, for Coffee beans, 1 kg: it's above the card's limits, so it waits for linus@example.org's approval. I'll write again once it's decided.");
});

test("when the run that goes back to pay finds the page asks more than was approved, the follow-up to another allowed sender says the new payment waits for approval, naming no one's", budget, async () => {
  const { duva, linus, fromCoo, approve } = await withCheckout([() => [use("fillSecret", { element: 1, secret: "Visa", part: "number", amount: "159.00", currency: "SEK", for: "Coffee beans, 1 kg" })]]);
  await linus.PATCH("/mailbox-agent/address", { body: { allowedSenders: ["assistant@example.net"] } });
  await duva.receive(request({ from: "assistant@example.net", subject: "Coffee", text: "Buy the beans in Linus's cart." }), { to: ["linus-coo@example.com"] });

  await approve();

  const lines = (await fromCoo()).slice(1).map(({ text }) => text!.split("\n")[0]);
  expect(lines).toContain("I went back to pay 149.00 SEK on example.net, as approved, but couldn't: The payment of 159.00 SEK on example.net is above Visa's limits, so it waits for approval in Approvals.");
});
