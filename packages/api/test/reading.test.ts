import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { startDuva } from "./harness.ts";

/** A fixture in test/mail, as the sender's server sends it. */
const mail = (name: string) => readFile(new URL(`mail/${name}.eml`, import.meta.url));

/** A message from Ada to Grace that starts its own thread, with the subject and text. */
const note = (subject: string, text = "Hej Grace.") =>
  [
    "From: Ada Lovelace <ada@example.org>",
    "To: Grace <grace@example.com>",
    `Subject: ${subject}`,
    "Date: Sun, 04 Oct 2026 09:00:00 +0200",
    `Message-ID: <${subject.replaceAll(" ", "-")}@example.org>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    text,
  ].join("\r\n");

/** A deployment where the human Grace has a personal mailbox at grace@example.com, which the admin Ada created. */
async function withPersonalMailbox() {
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org"] });
  const ada = duva.signIn("ada@example.org");
  const grace = duva.signIn("grace@example.org");
  const { data: me } = await grace.GET("/whoami");
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: me!.id, address: "grace@example.com" } });
  const params = { path: { mailbox: mailbox!.id } };
  // Mail from first-time senders would wait in the Screener, which these tests leave out.
  await grace.PATCH("/mailboxes/{mailbox}/screener", { params, body: { on: false } });
  const receive = async (raw: string | Uint8Array) => {
    await duva.receive(raw, { to: ["grace@example.com"] });
  };
  const inbox = async () => (await grace.GET("/mailboxes/{mailbox}/threads", { params })).data!.threads;
  return { duva, ada, grace, graceId: me!.id, mailbox: mailbox!, params, receive, inbox };
}

test("new mail lists its thread unread, with a snippet of its text on one line", async () => {
  const { receive, inbox } = await withPersonalMailbox();

  await receive(await mail("plain"));

  expect(await inbox()).toEqual([
    {
      id: expect.any(String),
      subject: "Compiler notes",
      from: { name: "Grace Hopper", address: "grace@example.org" },
      snippet: "Hej Hermes, Här är mina anteckningar om kompilatorn. Grace",
      labels: ["inbox"],
      unread: true,
      latestAt: expect.any(String),
      messages: 1,
    },
  ]);
});

test("a snippet leaves out quoted lines and stops after 200 characters", async () => {
  const { receive, inbox } = await withPersonalMailbox();
  const long = "Ett två tre fyra fem sex sju åtta nio tio. ".repeat(6);

  await receive(note("Long", `On Sunday Ada wrote:\n> Ett gammalt citat.\n> Och ett till.\n${long}`));

  expect((await inbox())[0]?.snippet).toBe(
    "On Sunday Ada wrote: Ett två tre fyra fem sex sju åtta nio tio. Ett två tre fyra fem sex sju åtta nio tio. " +
      "Ett två tre fyra fem sex sju åtta nio tio. Ett två tre fyra fem sex sju åtta nio tio. Ett två…",
  );
});

test("a snippet leaves out URLs and long tokens, and shows the words around them", async () => {
  const { receive, inbox } = await withPersonalMailbox();
  const text = [
    "Veckans nyheter från föreningen.",
    "Läs mer: https://news.example/v/8f3a?utm_medium=email_action&utm_source=cio",
    "Anmäl dig <https://news.example/signup?id=42> senast fredag",
    "[https://news.example/track/abc] Vi ses (program på https://news.example/p).",
    "utm_campaign=autumn_2026&utm_content=header_link",
    "dGhpcyBpcyBhIHRyYWNraW5nIHRva2VuMTIz",
  ].join("\n");

  await receive(note("Nyheter", text));

  expect((await inbox())[0]?.snippet).toBe("Veckans nyheter från föreningen. Läs mer: Anmäl dig senast fredag Vi ses (program på).");
});

test("a snippet keeps ordinary text, long Swedish words, addresses and order numbers included", async () => {
  const { receive, inbox } = await withPersonalMailbox();
  const text = "Om realisationsvinstbeskattningen2026: skriv till anna.svensson2026@foretaget.example, ange #INV-2026-000123456789012345. Hälsningar, Åsa-Märta.";

  await receive(note("Skatt", text));

  expect((await inbox())[0]?.snippet).toBe(text);
});

test("a thread's snippet comes from its newest message", async () => {
  const { receive, inbox } = await withPersonalMailbox();
  await receive(await mail("plain"));

  await receive(await mail("reply"));

  expect((await inbox()).map(({ snippet, from }) => ({ snippet, from }))).toEqual([
    { snippet: "Tack, Grace. Jag läser dem i kväll. Ada", from: { name: "Grace Hopper", address: "grace@example.org" } },
  ]);
});

test("marking a thread read changes it for the mailbox, in its listing and when it's read", async () => {
  const { grace, params, receive, inbox } = await withPersonalMailbox();
  await receive(await mail("plain"));
  const [thread] = await inbox();

  const { data, response } = await grace.POST("/mailboxes/{mailbox}/threads/read", { params, body: { threads: [thread!.id] } });

  expect(response.status).toBe(200);
  expect(data).toEqual({ threads: [{ ...thread, unread: false }] });
  expect(await inbox()).toEqual([{ ...thread, unread: false }]);
  const { data: read } = await grace.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { ...params.path, thread: thread!.id } } });
  expect(read).toMatchObject({ id: thread!.id, unread: false });
});

test("reading a thread leaves it unread until it's marked read", async () => {
  const { grace, params, receive, inbox } = await withPersonalMailbox();
  await receive(await mail("plain"));
  const [thread] = await inbox();

  const { data } = await grace.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { ...params.path, thread: thread!.id } } });

  expect(data?.unread).toBe(true);
  expect((await inbox())[0]?.unread).toBe(true);
});

test("a thread that was read is unread again when new mail joins it", async () => {
  const { grace, params, receive, inbox } = await withPersonalMailbox();
  await receive(await mail("plain"));
  const [thread] = await inbox();
  await grace.POST("/mailboxes/{mailbox}/threads/read", { params, body: { threads: [thread!.id] } });

  await receive(await mail("reply"));

  expect(await inbox()).toMatchObject([{ id: thread!.id, messages: 2, unread: true }]);
});

test("a thread marked unread stands out again, and marking it read again changes it back", async () => {
  const { grace, params, receive, inbox } = await withPersonalMailbox();
  await receive(await mail("plain"));
  const [thread] = await inbox();
  const threads = [thread!.id];
  await grace.POST("/mailboxes/{mailbox}/threads/read", { params, body: { threads } });

  const { data } = await grace.POST("/mailboxes/{mailbox}/threads/unread", { params, body: { threads } });

  expect(data).toEqual({ threads: [{ ...thread, unread: true }] });
  expect((await inbox())[0]?.unread).toBe(true);
  await grace.POST("/mailboxes/{mailbox}/threads/read", { params, body: { threads } });
  expect((await inbox())[0]?.unread).toBe(false);
});

test("several threads are marked in one request", async () => {
  const { grace, params, receive, inbox } = await withPersonalMailbox();
  await receive(note("First"));
  await receive(note("Second"));
  await receive(note("Third"));
  const [third, second, first] = await inbox();

  const { data } = await grace.POST("/mailboxes/{mailbox}/threads/read", { params, body: { threads: [first!.id, third!.id] } });

  expect(data?.threads.map(({ subject, unread }) => ({ subject, unread }))).toEqual([
    { subject: "First", unread: false },
    { subject: "Third", unread: false },
  ]);
  expect((await inbox()).map(({ id, unread }) => ({ id, unread }))).toEqual([
    { id: third!.id, unread: false },
    { id: second!.id, unread: true },
    { id: first!.id, unread: false },
  ]);
});

test("each change of read state is in the mailbox's change feed under the human, and marking a thread as it already is records nothing", async () => {
  const { grace, graceId, params, receive, inbox } = await withPersonalMailbox();
  await receive(await mail("plain"));
  const [thread] = await inbox();
  const threads = [thread!.id];
  const { data: before } = await grace.GET("/mailboxes/{mailbox}/changes", { params });

  await grace.POST("/mailboxes/{mailbox}/threads/read", { params, body: { threads } });
  await grace.POST("/mailboxes/{mailbox}/threads/read", { params, body: { threads } });
  await grace.POST("/mailboxes/{mailbox}/threads/unread", { params, body: { threads } });
  await grace.POST("/mailboxes/{mailbox}/threads/unread", { params, body: { threads } });

  const { data } = await grace.GET("/mailboxes/{mailbox}/changes", { params: { ...params, query: { after: before!.position } } });
  expect(data?.changes).toEqual([
    { position: before!.position + 1, at: expect.any(String), actor: graceId, type: "threadRead", thread: thread!.id },
    { position: before!.position + 2, at: expect.any(String), actor: graceId, type: "threadUnread", thread: thread!.id },
  ]);
});

test("the sponsor marks threads in their agent's mailbox, under their own name", async () => {
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org" });
  const ada = duva.signIn("ada@example.org");
  const { data: me } = await ada.GET("/whoami");
  const { data: created } = await ada.POST("/agents", { body: { name: "Hermes" } });
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: created!.agent.id, address: "hermes@example.com" } });
  const params = { path: { mailbox: mailbox!.id } };
  await duva.receive(await mail("plain"), { to: ["hermes@example.com"] });
  const hermes = duva.withKey(created!.key);
  const { data: list } = await hermes.GET("/mailboxes/{mailbox}/threads", { params });

  await ada.POST("/mailboxes/{mailbox}/threads/read", { params, body: { threads: [list!.threads[0]!.id] } });

  expect((await hermes.GET("/mailboxes/{mailbox}/threads", { params })).data?.threads[0]?.unread).toBe(false);
  const { data: changes } = await hermes.GET("/mailboxes/{mailbox}/changes", { params });
  expect(changes?.changes.at(-1)).toMatchObject({ type: "threadRead", actor: me!.id });
});

test("marking a thread the mailbox doesn't have answers 404 and marks none of the others", async () => {
  const { grace, params, receive, inbox } = await withPersonalMailbox();
  await receive(await mail("plain"));
  const [thread] = await inbox();

  const { error, response } = await grace.POST("/mailboxes/{mailbox}/threads/read", { params, body: { threads: [thread!.id, "nope"] } });

  expect(response.status).toBe(404);
  expect(error?.message).toContain('"nope"');
  expect((await inbox())[0]?.unread).toBe(true);
});

test("marking no threads, or something that isn't a list of them, answers 400", async () => {
  const { grace, params } = await withPersonalMailbox();

  for (const body of [{ threads: [] }, { threads: "x" }, {}, { threads: [1] }]) {
    const { response } = await grace.POST("/mailboxes/{mailbox}/threads/read", { params, body: body as unknown as { threads: string[] } });
    expect(response.status).toBe(400);
  }
});

test("only those who can read the mailbox can mark its threads, so not even the admin who created it", async () => {
  const { ada, params, receive, inbox } = await withPersonalMailbox();
  await receive(await mail("plain"));
  const [thread] = await inbox();

  for (const path of ["/mailboxes/{mailbox}/threads/read", "/mailboxes/{mailbox}/threads/unread"] as const) {
    const { response } = await ada.POST(path, { params, body: { threads: [thread!.id] } });
    expect(response.status).toBe(403);
  }
  expect((await inbox())[0]?.unread).toBe(true);
});

test("the Inbox is listed a page at a time, newest first, until a page has no next", async () => {
  const { grace, params, receive } = await withPersonalMailbox();
  for (const subject of ["One", "Two", "Three", "Four", "Five"]) await receive(note(subject));
  const page = async (after?: string) => (await grace.GET("/mailboxes/{mailbox}/threads", { params: { ...params, query: { limit: 2, after } } })).data!;

  const first = await page();
  const second = await page(first.next);
  const third = await page(second.next);

  expect([first, second, third].map(({ threads, next }) => ({ subjects: threads.map(({ subject }) => subject), next: next !== undefined }))).toEqual([
    { subjects: ["Five", "Four"], next: true },
    { subjects: ["Three", "Two"], next: true },
    { subjects: ["One"], next: false },
  ]);
});

test("a page that ends the listing exactly has no next", async () => {
  const { grace, params, receive } = await withPersonalMailbox();
  for (const subject of ["One", "Two"]) await receive(note(subject));

  const { data } = await grace.GET("/mailboxes/{mailbox}/threads", { params: { ...params, query: { limit: 2 } } });

  expect(data?.threads).toHaveLength(2);
  expect(data?.next).toBeUndefined();
});

test("listing threads refuses a limit outside 1 to 100, and an after that no page gave", async () => {
  const { grace, params } = await withPersonalMailbox();

  for (const query of [{ limit: 0 }, { limit: 101 }, { limit: "two" }, { after: "nope" }]) {
    const { response, error } = await grace.GET("/mailboxes/{mailbox}/threads", { params: { ...params, query: query as { limit?: number } } });
    expect(response.status).toBe(400);
    expect(error?.message).toBeTruthy();
  }
});
