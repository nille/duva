import { expect, test } from "vitest";
import type { DuvaClient } from "@duva/client";
import { type DuvaOptions, startDuva } from "./harness.ts";

interface Written {
  from?: string;
  to?: string;
  cc?: string;
  subject: string;
  text?: string;
  html?: string;
  attachment?: string;
  answers?: string;
  id?: string;
}

/** A made-up message as the sender's server sends it, with a text part, an HTML part or both, and an attachment if named. */
function message({ from = "Ada Lovelace <ada@example.org>", to = "Grace <grace@example.com>", cc, subject, text, html, attachment, answers, id }: Written): string {
  const messageId = id ?? `<${subject.replace(/\W+/g, "-")}-${Math.random().toString(36).slice(2)}@example.org>`;
  const body = (type: string, content: string) => [`Content-Type: ${type}; charset=utf-8`, "Content-Transfer-Encoding: 8bit", "", content];
  const parts = [...(text === undefined ? [] : [body("text/plain", text)]), ...(html === undefined ? [] : [body("text/html", html)])];
  if (attachment !== undefined) {
    parts.push([`Content-Type: application/pdf; name="${attachment}"`, `Content-Disposition: attachment; filename="${attachment}"`, "Content-Transfer-Encoding: base64", "", "SGVsbG8sIFBERiE="]);
  }
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    ...(cc === undefined ? [] : [`Cc: ${cc}`]),
    `Subject: ${subject}`,
    "Date: Sun, 04 Oct 2026 09:00:00 +0200",
    `Message-ID: ${messageId}`,
    ...(answers === undefined ? [] : [`In-Reply-To: ${answers}`]),
    "MIME-Version: 1.0",
  ];
  if (parts.length === 1) return [...headers, ...parts[0]!].join("\r\n");
  return [...headers, 'Content-Type: multipart/mixed; boundary="part"', "", ...parts.flatMap((part) => ["--part", ...part]), "--part--"].join("\r\n");
}

/** A deployment where the human Grace has a mailbox at grace@example.com, without its Screener, and the admin Ada and the human Linus have none. */
async function withMailbox(options: DuvaOptions = {}) {
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org", "linus@example.org"], ...options });
  const ada = duva.signIn("ada@example.org");
  const grace = duva.signIn("grace@example.org");
  const { data: me } = await grace.GET("/whoami");
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: me!.id, address: "grace@example.com" } });
  const params = { path: { mailbox: mailbox!.id } };
  await grace.PATCH("/mailboxes/{mailbox}/screener", { params, body: { on: false } });
  const receive = async (written: Written, at?: Date) => {
    await duva.receive(message(written), { to: ["grace@example.com"] }, { at });
    const { data } = await grace.GET("/mailboxes/{mailbox}/all-mail", { params });
    return data!.threads.find((thread) => thread.subject === written.subject)!;
  };
  /** The subjects of the threads the search finds, in order. */
  const subjects = async (q: string, query: { sort?: "relevance" | "newest"; limit?: number } = {}, client: DuvaClient = grace) => {
    const { data, error } = await client.GET("/mailboxes/{mailbox}/search", { params: { ...params, query: { q, ...query } } });
    if (data === undefined) throw new Error(JSON.stringify(error));
    return data.results.map(({ thread }) => thread.subject);
  };
  const search = (q: string, client: DuvaClient = grace) => client.GET("/mailboxes/{mailbox}/search", { params: { ...params, query: { q } } });
  const label = (threads: string[], change: { add?: string[]; remove?: string[] }) => grace.POST("/mailboxes/{mailbox}/threads/labels", { params, body: { threads, ...change } });
  return { duva, ada, grace, linus: duva.signIn("linus@example.org"), mailbox: mailbox!, params, receive, subjects, search, label };
}

test("a search finds threads by their subject, sender, recipients, text and attachment names, and nothing else", async () => {
  const { receive, subjects } = await withMailbox();
  await receive({ subject: "Kayak rental", text: "Pick up the boat at nine." });
  await receive({ subject: "Harbour notes", from: "Fredrika Bremer <fredrika@paddla.example>", text: "Notes from the harbour." });
  await receive({ subject: "Meeting room", to: "Grace <grace@example.com>", cc: "Mary Somerville <mary@stars.example>", text: "Room four is free." });
  await receive({ subject: "Weekend", text: "The kayak club meets on Saturday." });
  await receive({ subject: "Scans", text: "Here they are.", attachment: "lighthouse-plans.pdf" });

  expect(await subjects("kayak")).toEqual(expect.arrayContaining(["Kayak rental", "Weekend"]));
  expect((await subjects("kayak")).length).toBe(2);
  expect(await subjects("fredrika")).toEqual(["Harbour notes"]);
  expect(await subjects("paddla.example")).toEqual(["Harbour notes"]);
  expect(await subjects("somerville")).toEqual(["Meeting room"]);
  expect(await subjects("lighthouse")).toEqual(["Scans"]);
  expect(await subjects("submarine")).toEqual([]);
});

test("a result has the thread, the message that matched, and a snippet of its text with the words highlighted", async () => {
  const { grace, params, receive, search } = await withMailbox();
  const thread = await receive({ subject: "Ferry", text: "The ferry to Gotland leaves at noon. Bring the tickets, the ferry is full." });

  const { data, response } = await search("ferry tickets");

  expect(response.status).toBe(200);
  const { data: read } = await grace.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { ...params.path, thread: thread.id } } });
  const snippet = "The ferry to Gotland leaves at noon. Bring the tickets, the ferry is full.";
  expect(data).toEqual({
    results: [
      {
        thread,
        message: read!.messages[0]!.id,
        snippet,
        highlights: [
          { start: 4, end: 9 },
          { start: 47, end: 54 },
          { start: 60, end: 65 },
        ],
      },
    ],
  });
});

test("a long message's snippet starts near the words, and highlights other forms of them", async () => {
  const { search, receive } = await withMailbox();
  const filler = "Det var en gång en lång text om ingenting särskilt. ".repeat(6);
  await receive({ subject: "Hyra", text: `${filler}Här kommer fakturan för oktober och en faktura till.` });

  const { data } = await search("fakturor");

  const [result] = data!.results;
  expect(result!.snippet.startsWith("…")).toBe(true);
  expect(result!.snippet).toContain("Här kommer fakturan för oktober och en faktura till.");
  expect(result!.highlights.map(({ start, end }) => result!.snippet.slice(start, end))).toEqual(["faktura"]);
});

test("a result's snippet leaves out URLs and tokens, with its highlights on the words shown", async () => {
  const { search, receive } = await withMailbox();
  await receive({
    subject: "Ferry news",
    text: "Book https://ferry.example/b?utm_medium=email_action&utm_source=cio your ferry <https://ferry.example/x> now. a1b2c3d4e5f6g7h8i9j0k1l2m3 The ferry is full.",
  });

  const { data } = await search("ferry");

  const [result] = data!.results;
  expect(result!.snippet).toBe("Book your ferry now. The ferry is full.");
  expect(result!.highlights.map(({ start, end }) => result!.snippet.slice(start, end))).toEqual(["ferry", "ferry"]);
});

test("Swedish and English words find their other forms", async () => {
  const { receive, subjects } = await withMailbox();
  await receive({ subject: "Hyran", text: "Hej! Här är en faktura för hyran i oktober, och den ska betalas senast fredag." });
  await receive({ subject: "Hosting", text: "Your invoice for April is attached, and it is paid by card." });

  expect(await subjects("fakturor")).toEqual(["Hyran"]);
  expect(await subjects("invoices")).toEqual(["Hosting"]);
  expect(await subjects("betala")).toEqual(["Hyran"]);
});

test("mail with only HTML is found by its text, and not by its links' targets", async () => {
  const { receive, subjects } = await withMailbox();
  await receive({ subject: "Newsletter", html: '<p>Our <b>spring</b> collection is here. <a href="https://click.tracker.example/abc">Shop now</a></p><img src="https://pixel.tracker.example/open.gif">' });

  expect(await subjects("spring collection")).toEqual(["Newsletter"]);
  expect(await subjects("tracker")).toEqual([]);
});

test("mail the mailbox sent is found, and drafts aren't", async () => {
  const { grace, params, subjects } = await withMailbox();
  const { data: sent } = await grace.POST("/mailboxes/{mailbox}/drafts", { params, body: { to: ["ada@example.org"], subject: "Lunch", text: "Lunch på fredag vid hamnen?" } });
  await grace.POST("/mailboxes/{mailbox}/drafts/{draft}/send", { params: { path: { ...params.path, draft: sent!.id } } });
  await grace.POST("/mailboxes/{mailbox}/drafts", { params, body: { to: ["ada@example.org"], subject: "Dinner", text: "Middag vid hamnen?" } });

  expect(await subjects("hamnen")).toEqual(["Lunch"]);
  expect(await subjects("to:ada")).toEqual(["Lunch"]);
});

test("a quoted phrase matches only where its words stand together", async () => {
  const { receive, subjects } = await withMailbox();
  await receive({ subject: "Agenda", text: "We start with the quarterly budget review at ten." });
  await receive({ subject: "Numbers", text: "Please review the budget numbers for the quarterly report." });

  expect((await subjects("quarterly budget review")).sort()).toEqual(["Agenda", "Numbers"]);
  expect(await subjects('"quarterly budget review"')).toEqual(["Agenda"]);
});

test("from: and to: keep the threads whose sender or a recipient has the part of a name or address", async () => {
  const { receive, subjects } = await withMailbox();
  await receive({ subject: "From Ada", text: "Hello there." });
  await receive({ subject: "From Fredrika", from: "Fredrika Bremer <fredrika@paddla.example>", text: "Hello there." });
  await receive({ subject: "To Mary too", cc: "Mary Somerville <mary@stars.example>", text: "Hello there." });

  expect(await subjects("hello from:bremer")).toEqual(["From Fredrika"]);
  expect(await subjects("from:PADDLA")).toEqual(["From Fredrika"]);
  expect(await subjects("hello to:mary@stars")).toEqual(["To Mary too"]);
  expect(await subjects('to:"mary somerville"')).toEqual(["To Mary too"]);
});

test("subject: matches words and phrases in the subject only", async () => {
  const { receive, subjects } = await withMailbox();
  await receive({ subject: "Invoice for May", text: "Amount due: 59 EUR." });
  await receive({ subject: "A question", text: "Did we pay the invoice for May?" });

  expect(await subjects("subject:invoice")).toEqual(["Invoice for May"]);
  expect(await subjects('subject:"invoice for may"')).toEqual(["Invoice for May"]);
  expect((await subjects("invoice")).sort()).toEqual(["A question", "Invoice for May"]);
});

test("label: keeps the threads with a label, by name in any case, built in or the mailbox's own", async () => {
  const { grace, params, receive, subjects, label } = await withMailbox();
  const { data: receipts } = await grace.POST("/mailboxes/{mailbox}/labels", { params, body: { name: "Travel plans" } });
  const train = await receive({ subject: "Train", text: "Your ticket to Gothenburg." });
  const ship = await receive({ subject: "Ship", text: "Your ticket to Helsinki." });
  await label([train.id], { add: [receipts!.id] });
  await label([ship.id], { remove: ["inbox"] });

  expect(await subjects('ticket label:"travel plans"')).toEqual(["Train"]);
  expect(await subjects("label:inbox")).toEqual(["Train"]);
  expect(await subjects('label:"travel plans" label:inbox')).toEqual(["Train"]);
});

test("has:attachment and is:unread keep the threads with an attachment, and the unread", async () => {
  const { grace, params, receive, subjects } = await withMailbox();
  await receive({ subject: "Report", text: "The report is attached.", attachment: "report.pdf" });
  const read = await receive({ subject: "Report notes", text: "Notes on the report." });
  await grace.POST("/mailboxes/{mailbox}/threads/read", { params, body: { threads: [read.id] } });

  expect(await subjects("report has:attachment")).toEqual(["Report"]);
  expect(await subjects("report is:unread")).toEqual(["Report"]);
});

test("after: and before: keep the threads received from a day on, and before a day", async () => {
  const { receive, subjects } = await withMailbox();
  await receive({ subject: "March invoice", text: "Invoice" }, new Date("2026-03-15T12:00:00Z"));
  await receive({ subject: "April invoice", text: "Invoice" }, new Date("2026-04-01T00:00:00Z"));
  await receive({ subject: "May invoice", text: "Invoice" }, new Date("2026-05-10T12:00:00Z"));

  expect(await subjects("invoice after:2026-04-01 before:2026-05-10", { sort: "newest" })).toEqual(["April invoice"]);
  expect(await subjects("after:2026-04-02")).toEqual(["May invoice"]);
});

test("a search that can't be read is refused with what to do", async () => {
  const { search } = await withMailbox();
  for (const [q, says] of [
    ["kayak size:large", "size: isn't a filter. Use from:, to:, subject:, label:, has:attachment, is:unread, before: or after:, or put the words in quotes to search for them as they are."],
    ["has:pictures", "has:pictures isn't a filter. Use has:attachment."],
    ["is:starred", "is:starred isn't a filter. Use is:unread."],
    ["after:2026-13-01", "after:2026-13-01 isn't a date. Give it as YYYY-MM-DD, as in after:2026-09-01."],
    ["from:", "from: needs a value, as in from:ada."],
    ["label:receipts", 'The mailbox has no label "receipts". List its labels to see their names.'],
    ["", "Give words to search for, or a filter such as from:ada."],
  ]) {
    const { response, error } = await search(q!);
    expect({ q, status: response.status, error }).toEqual({ q, status: 400, error: { message: says } });
  }
});

test('a phrase in quotes is searched as words, even with what looks like a filter in it', async () => {
  const { receive, subjects } = await withMailbox();
  await receive({ subject: "Meeting", text: "See the agenda at size: large print." });

  expect(await subjects('"size: large"')).toEqual(["Meeting"]);
});

test("threads in Spam, Trash and the Screener are left out unless the search asks for Spam or Trash", async () => {
  const { duva, grace, params, receive, subjects, label } = await withMailbox();
  await receive({ subject: "Kayak rental", text: "Your kayak is ready." });
  await duva.receive(message({ subject: "Cheap kayaks", text: "Buy a kayak today." }), { to: ["grace@example.com"] }, { verdicts: { spam: "FAIL" } });
  const old = await receive({ subject: "Old kayak photos", text: "The kayak trip." });
  await label([old.id], { add: ["trash"] });
  await grace.PATCH("/mailboxes/{mailbox}/screener", { params, body: { on: true } });
  await receive({ subject: "Kayak club", from: "Club <club@paddlers.example>", text: "Join the kayak club." });

  expect(await subjects("kayak")).toEqual(["Kayak rental"]);
  expect(await subjects("kayak label:spam")).toEqual(["Cheap kayaks"]);
  expect(await subjects("kayak label:trash")).toEqual(["Old kayak photos"]);
});

test("a thread is found once, by its best message, and threads rank best first or newest first", async () => {
  const { grace, params, receive, subjects } = await withMailbox();
  const first = await receive({ subject: "Saturday plans", id: "<trip@example.org>", text: "We could take the boats out on Saturday, a kayak perhaps, if the weather holds and nobody minds the cold." });
  await receive({ subject: "Re: Saturday plans", answers: "<trip@example.org>", text: "Kayak! Kayak, kayak." }, new Date(Date.now() + 1000));
  await receive({ subject: "Weekend", text: "The kayak club meets." }, new Date(Date.now() + 2000));

  const { data } = await grace.GET("/mailboxes/{mailbox}/search", { params: { ...params, query: { q: "kayak" } } });
  const { data: thread } = await grace.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { ...params.path, thread: first.id } } });
  expect(data!.results.map(({ thread, message }) => [thread.subject, message])).toEqual([
    ["Saturday plans", thread!.messages[1]!.id],
    ["Weekend", expect.any(String)],
  ]);
  expect(await subjects("kayak", { sort: "newest" })).toEqual(["Weekend", "Saturday plans"]);
});

test("results come a page at a time, each next leading to the rest", async () => {
  const { grace, params, receive } = await withMailbox();
  for (const day of [1, 2, 3]) await receive({ subject: `Day ${day}`, text: "Ferry times." }, new Date(`2026-09-0${day}T12:00:00Z`));
  const page = async (after?: string) => (await grace.GET("/mailboxes/{mailbox}/search", { params: { ...params, query: { q: "ferry", sort: "newest", limit: 2, after } } })).data!;

  const first = await page();
  const second = await page(first.next);

  expect(first.results.map(({ thread }) => thread.subject)).toEqual(["Day 3", "Day 2"]);
  expect(second.results.map(({ thread }) => thread.subject)).toEqual(["Day 1"]);
  expect(second.next).toBeUndefined();
  const { response } = await grace.GET("/mailboxes/{mailbox}/search", { params: { ...params, query: { q: "ferry", after: "nonsense" } } });
  expect(response.status).toBe(400);
});

test("only those who can read the mailbox search it", async () => {
  const { ada, linus, search, receive } = await withMailbox();
  await receive({ subject: "Private", text: "A secret plan." });

  for (const client of [ada, linus]) {
    const { response, error } = await search("secret", client);
    expect({ status: response.status, error }).toEqual({
      status: 403,
      error: { message: "Only the mailbox's owner can read it, its sponsor if an agent owns it, and the agents its owner gives sponsor access." },
    });
  }
});

test("a sponsor searches its agent's mailbox, and an agent its sponsor's with sponsor access", async () => {
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org", humans: ["linus@example.org"] });
  const ada = duva.signIn("ada@example.org");
  const linus = duva.signIn("linus@example.org");
  const { data: linusActor } = await linus.GET("/whoami");
  const { data: created } = await linus.POST("/agents", { body: { name: "Hermes" } });
  const hermes = duva.withKey(created!.key);
  const { data: linusMailbox } = await ada.POST("/mailboxes", { body: { owner: linusActor!.id, address: "linus@example.com" } });
  const { data: hermesMailbox } = await ada.POST("/mailboxes", { body: { owner: created!.agent.id, address: "hermes@example.com" } });
  await linus.PATCH("/mailboxes/{mailbox}/screener", { params: { path: { mailbox: linusMailbox!.id } }, body: { on: false } });
  await duva.receive(message({ to: "linus@example.com", subject: "For Linus", text: "Ferry times." }), { to: ["linus@example.com"] });
  await duva.receive(message({ to: "hermes@example.com", subject: "For Hermes", text: "Ferry times." }), { to: ["hermes@example.com"] });
  const found = async (client: DuvaClient, mailbox: string) => {
    const { data, response } = await client.GET("/mailboxes/{mailbox}/search", { params: { path: { mailbox }, query: { q: "ferry" } } });
    return data?.results.map(({ thread }) => thread.subject) ?? response.status;
  };

  expect(await found(linus, hermesMailbox!.id)).toEqual(["For Hermes"]);
  expect(await found(hermes, linusMailbox!.id)).toBe(403);
  await linus.PATCH("/agents/{agent}/settings", { params: { path: { agent: created!.agent.id } }, body: { sponsorAccess: "read" } });
  expect(await found(hermes, linusMailbox!.id)).toEqual(["For Linus"]);
});

test("new mail is found by the next search", async () => {
  const { receive, subjects } = await withMailbox();
  expect(await subjects("lighthouse")).toEqual([]);

  await receive({ subject: "Lighthouse", text: "The lighthouse is open on Sundays." });

  expect(await subjects("lighthouse")).toEqual(["Lighthouse"]);
});

test("label and read changes count in the next search, though the index hasn't caught up", async () => {
  const { duva, grace, params, receive, subjects, label } = await withMailbox({ indexingHeld: true });
  const { data: travel } = await grace.POST("/mailboxes/{mailbox}/labels", { params, body: { name: "Travel" } });
  await receive({ subject: "Train", text: "Your ticket to Gothenburg." });
  await receive({ subject: "Ship", text: "Your ticket to Helsinki." });
  await duva.releaseIndexing();
  const [train, ship] = (await grace.GET("/mailboxes/{mailbox}/all-mail", { params })).data!.threads.sort((a, b) => a.subject.localeCompare(b.subject)).reverse();

  await label([train!.id], { add: [travel!.id] });
  await label([ship!.id], { add: ["trash"] });
  await grace.POST("/mailboxes/{mailbox}/threads/read", { params, body: { threads: [train!.id] } });

  expect(await subjects("ticket label:travel")).toEqual(["Train"]);
  expect(await subjects("ticket")).toEqual(["Train"]);
  expect(await subjects("ticket label:trash")).toEqual(["Ship"]);
  expect(await subjects("ticket is:unread")).toEqual([]);
  const { data } = await grace.GET("/mailboxes/{mailbox}/search", { params: { ...params, query: { q: "ticket" } } });
  expect(data!.results[0]!.thread).toMatchObject({ labels: ["inbox", travel!.id], unread: false });
});

test("erased mail is found by no search, at once", async () => {
  const { duva, grace, params, receive, subjects, label } = await withMailbox({ indexingHeld: true });
  const thread = await receive({ subject: "Old kayak photos", text: "The kayak trip." });
  await duva.releaseIndexing();
  await label([thread.id], { add: ["trash"] });

  await grace.POST("/mailboxes/{mailbox}/trash/empty", { params });

  expect(await subjects("kayak label:trash")).toEqual([]);
  await duva.releaseIndexing();
  expect(await subjects("kayak label:trash")).toEqual([]);
});

test("a Trash emptied leaves the search index's files at the eraser's next daily run, and the mail kept stays found", async () => {
  const { duva, grace, params, receive, subjects, label } = await withMailbox();
  for (const name of ["Lisbon", "Porto", "Faro", "Braga", "Evora"]) await receive({ subject: `Trip to ${name}`, text: `Our itinerary for zqkept${name.toLowerCase()}.` });
  const erased = await receive({ subject: "Old zqerasedsubject photos", text: "The zqerasedwords from the trip." });
  await label([erased.id], { add: ["trash"] });
  await grace.POST("/mailboxes/{mailbox}/trash/empty", { params });

  await duva.erase(new Date());

  const objects = duva.searchObjects();
  expect(objects.filter((object) => object.includes("zqkeptlisbon"))).not.toEqual([]);
  expect(objects.filter((object) => object.includes("zqerased"))).toEqual([]);
  expect((await subjects("itinerary")).sort()).toEqual(["Trip to Braga", "Trip to Evora", "Trip to Faro", "Trip to Lisbon", "Trip to Porto"]);
});

test("mail the eraser's daily run erases leaves the search index's files in the same run", async () => {
  const { duva, receive, subjects, label } = await withMailbox();
  await receive({ subject: "Kayak club", text: "Bring zqkeptpaddles to the jetty." });
  const erased = await receive({ subject: "Kayak sale", text: "Cheap zqerasedkayaks this week." });
  await label([erased.id], { add: ["spam"] });

  await duva.erase(new Date(Date.now() + 31 * 24 * 60 * 60 * 1000));

  const objects = duva.searchObjects();
  expect(objects.filter((object) => object.includes("zqkeptpaddles"))).not.toEqual([]);
  expect(objects.filter((object) => object.includes("zqerased"))).toEqual([]);
  expect(await subjects("kayak label:spam")).toEqual([]);
  expect(await subjects("kayak")).toEqual(["Kayak club"]);
});

test("mail that arrives while indexing waits for the eraser's daily run is found after it", async () => {
  const { duva, grace, params, receive, subjects, label } = await withMailbox({ indexingHeld: true });
  const erased = await receive({ subject: "Old kayak photos", text: "The zqerasedwords from the trip." });
  await duva.releaseIndexing();
  await label([erased.id], { add: ["trash"] });
  await grace.POST("/mailboxes/{mailbox}/trash/empty", { params });
  await duva.erase(new Date());
  await receive({ subject: "New kayak photos", text: "The kayak trip, again." });

  await duva.releaseIndexing();

  expect(await subjects("kayak")).toEqual(["New kayak photos"]);
  expect(duva.searchObjects().filter((object) => object.includes("zqerased"))).toEqual([]);
});

test("the deploy that brings search makes the mail already there searchable", async () => {
  const { duva, receive, subjects } = await withMailbox({ beforeSearch: true });
  for (const name of ["Lisbon", "Porto", "Faro", "Braga", "Evora"]) await receive({ subject: `Trip to ${name}`, text: "Our trip itinerary." });
  expect(await subjects("itinerary")).toEqual([]);

  await duva.setUp({ admin: "ada@example.org" });

  expect((await subjects("itinerary")).sort()).toEqual(["Trip to Braga", "Trip to Evora", "Trip to Faro", "Trip to Lisbon", "Trip to Porto"]);
});

test("a backfill that stops partway finishes on the next setup, and finding each thread once", async () => {
  const { duva, receive, subjects } = await withMailbox({ beforeSearch: true });
  const names = ["Lisbon", "Porto", "Faro", "Braga", "Evora"];
  for (const name of names) await receive({ subject: `Trip to ${name}`, text: "Our trip itinerary." });

  await duva.setUp({ admin: "ada@example.org", backfillLost: true });
  const partly = await subjects("itinerary");
  await duva.setUp({ admin: "ada@example.org" });
  await duva.setUp({ admin: "ada@example.org" });

  expect(partly.length).toBeGreaterThan(0);
  expect(partly.length).toBeLessThan(names.length);
  expect((await subjects("itinerary")).sort()).toEqual(names.map((name) => `Trip to ${name}`).sort());
});
