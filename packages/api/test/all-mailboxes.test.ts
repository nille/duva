import { expect, test } from "vitest";
import type { DuvaClient } from "@duva/client";
import { startDuva } from "./harness.ts";

/** A message from Ada to the addresses, with the subject, that starts its own thread. */
const note = (subject: string, to: string, extra: string[] = []) =>
  [
    "From: Ada Lovelace <ada@example.org>",
    `To: ${to}`,
    `Subject: ${subject}`,
    "Date: Sun, 04 Oct 2026 09:00:00 +0200",
    `Message-ID: <${subject.replace(/\W+/g, "-")}@example.org>`,
    ...extra,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    `About ${subject}.`,
  ].join("\r\n");

/**
 * A deployment on example.com where the human Grace signs in as grace@example.com and owns two
 * mailboxes: home, at grace.home@example.com, created first, and work, at grace@example.com and
 * support@example.com. Both have their Screener off. Linus is another human, who sponsors nothing.
 */
async function withTwoMailboxes() {
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.com", "linus@example.org"] });
  const ada = duva.signIn("ada@example.org");
  const grace = duva.signIn("grace@example.com");
  const { data: me } = await grace.GET("/whoami");
  const { data: home } = await ada.POST("/mailboxes", { body: { owner: me!.id, address: "grace.home@example.com" } });
  const { data: work } = await ada.POST("/mailboxes", { body: { owner: me!.id, address: "grace@example.com" } });
  await ada.POST("/addresses", { body: { address: "support@example.com", mailbox: work!.id } });
  for (const mailbox of [home!, work!]) await grace.PATCH("/mailboxes/{mailbox}/screener", { params: { path: { mailbox: mailbox.id } }, body: { on: false } });
  /** Receives the message for the addresses, at the time, and answers the IDs of the threads it made, by mailbox. */
  const receive = async (subject: string, to: string[], at: string, extra?: string[]) => {
    await duva.receive(note(subject, to.join(", "), extra), { to }, { at: new Date(at) });
    const threads = await Promise.all(
      [home!, work!].map(async (mailbox) => {
        const { data } = await grace.GET("/mailboxes/{mailbox}/all-mail", { params: { path: { mailbox: mailbox.id } } });
        return [mailbox.id, data!.threads.find((thread) => thread.subject === subject)?.id] as const;
      }),
    );
    return Object.fromEntries(threads.filter(([, thread]) => thread !== undefined)) as Record<string, string>;
  };
  /** The threads of the All mailboxes view as subject, mailbox and recipient, in order. */
  const listed = async (path: "/all-mailboxes/threads" | "/all-mailboxes/all-mail" | "/all-mailboxes/sent" | "/all-mailboxes/reminders", query: { label?: string } = {}, client: DuvaClient = grace) => {
    const { data, error } = await client.GET(path, { params: { query } });
    if (data === undefined) throw new Error(JSON.stringify(error));
    return data.threads.map(({ subject, mailbox, recipient }) => ({ subject, mailbox, recipient }));
  };
  return { duva, ada, grace, graceId: me!.id, linus: duva.signIn("linus@example.org"), home: home!, work: work!, receive, listed };
}

test("All mailboxes lists the Inboxes of a human's mailboxes merged newest first, each thread naming its mailbox and the address it came to", async () => {
  const { home, work, receive, listed } = await withTwoMailboxes();
  await receive("Oldest", ["grace@example.com"], "2026-10-01T08:00:00Z");
  await receive("Middle", ["grace.home@example.com"], "2026-10-02T08:00:00Z");
  await receive("Newest", ["support+tickets@example.com"], "2026-10-03T08:00:00Z");

  expect(await listed("/all-mailboxes/threads")).toEqual([
    { subject: "Newest", mailbox: work.id, recipient: "support+tickets@example.com" },
    { subject: "Middle", mailbox: home.id, recipient: "grace.home@example.com" },
    { subject: "Oldest", mailbox: work.id, recipient: "grace@example.com" },
  ]);
  expect(await listed("/all-mailboxes/all-mail")).toEqual(await listed("/all-mailboxes/threads"));
});

test("a page of All mailboxes goes on in each mailbox where the page before it left off, until no mailbox has more", async () => {
  const { grace, receive } = await withTwoMailboxes();
  const days = ["01", "02", "03", "04", "05"];
  for (const [index, day] of days.entries()) await receive(`Day ${day}`, [index % 2 === 0 ? "grace@example.com" : "grace.home@example.com"], `2026-10-${day}T08:00:00Z`);

  const subjects: string[][] = [];
  let after: string | undefined;
  do {
    const { data } = await grace.GET("/all-mailboxes/threads", { params: { query: { limit: 2, ...(after !== undefined && { after }) } } });
    subjects.push(data!.threads.map(({ subject }) => subject));
    after = data!.next;
  } while (after !== undefined);

  expect(subjects).toEqual([["Day 05", "Day 04"], ["Day 03", "Day 02"], ["Day 01"]]);
});

test("a page of All mailboxes that ends with every mailbox's last thread has no next", async () => {
  const { grace, receive } = await withTwoMailboxes();
  await receive("Work", ["grace@example.com"], "2026-10-01T08:00:00Z");
  await receive("Home", ["grace.home@example.com"], "2026-10-02T08:00:00Z");

  const { data } = await grace.GET("/all-mailboxes/threads", { params: { query: { limit: 2 } } });

  expect(data!.threads.map(({ subject }) => subject)).toEqual(["Home", "Work"]);
  expect(data!.next).toBeUndefined();
});

test("a message delivered to two of a human's mailboxes is two threads in All mailboxes, and reading or archiving one leaves the other as it is", async () => {
  const { grace, home, work, receive, listed } = await withTwoMailboxes();
  const copies = await receive("Both", ["grace@example.com", "grace.home@example.com"], "2026-10-01T08:00:00Z");

  expect(await listed("/all-mailboxes/threads")).toEqual(
    expect.arrayContaining([
      { subject: "Both", mailbox: work.id, recipient: "grace@example.com" },
      { subject: "Both", mailbox: home.id, recipient: "grace.home@example.com" },
    ]),
  );
  await grace.POST("/all-mailboxes/threads/unread", { body: { threads: [copies[work.id]!, copies[home.id]!] } });

  const { data: read } = await grace.POST("/all-mailboxes/threads/read", { body: { threads: [copies[work.id]!] } });

  expect(read!.threads).toMatchObject([{ id: copies[work.id], mailbox: work.id, unread: false }]);
  const unread = async () => Object.fromEntries((await grace.GET("/all-mailboxes/threads")).data!.threads.map(({ mailbox, unread }) => [mailbox, unread]));
  expect(await unread()).toEqual({ [work.id]: false, [home.id]: true });

  const { data: archived } = await grace.POST("/all-mailboxes/threads/labels", { body: { threads: [copies[home.id]!], remove: ["inbox"] } });

  expect(archived!.threads).toMatchObject([{ id: copies[home.id], mailbox: home.id, labels: [] }]);
  expect(await listed("/all-mailboxes/threads")).toEqual([{ subject: "Both", mailbox: work.id, recipient: "grace@example.com" }]);
  expect((await grace.GET("/mailboxes/{mailbox}/threads", { params: { path: { mailbox: home.id } } })).data!.threads).toEqual([]);
});

test("acting on threads in All mailboxes changes each in its own mailbox's change feed, naming the actor", async () => {
  const { grace, graceId, home, work, receive } = await withTwoMailboxes();
  const copies = await receive("Both", ["grace@example.com", "grace.home@example.com"], "2026-10-01T08:00:00Z");
  const { data: before } = await grace.GET("/all-mailboxes/changes");

  await grace.POST("/all-mailboxes/threads/read", { body: { threads: [copies[home.id]!] } });

  const { data: after } = await grace.GET("/all-mailboxes/changes", { params: { query: { after: before!.position } } });
  expect(Object.fromEntries(after!.mailboxes.map(({ mailbox, changes }) => [mailbox, changes]))).toEqual({
    [home.id]: [{ position: expect.any(Number), at: expect.any(String), actor: graceId, type: "threadRead", thread: copies[home.id] }],
    [work.id]: [],
  });
});

test("a reply drafted from a copy in All mailboxes lives in that copy's mailbox and goes from the address it came to", async () => {
  const { grace, home, work, receive } = await withTwoMailboxes();
  const copies = await receive("Both", ["grace@example.com", "grace.home@example.com"], "2026-10-01T08:00:00Z");
  const { data: thread } = await grace.GET("/all-mailboxes/threads/{thread}", { params: { path: { thread: copies[home.id]! } } });

  const { response, data: draft } = await grace.POST("/all-mailboxes/drafts", { body: { answers: thread!.messages[0]!.id, text: "Thanks." } });

  expect(response.status).toBe(201);
  expect(draft).toMatchObject({ mailbox: home.id, from: "grace.home@example.com", thread: copies[home.id], subject: "Re: Both" });
  expect((await grace.GET("/mailboxes/{mailbox}/drafts", { params: { path: { mailbox: home.id } } })).data!.drafts.map(({ id }) => id)).toEqual([draft!.id]);
  expect((await grace.GET("/mailboxes/{mailbox}/drafts", { params: { path: { mailbox: work.id } } })).data!.drafts).toEqual([]);
  expect((await grace.GET("/all-mailboxes/drafts")).data!.drafts).toEqual([{ ...draft }]);
  expect(thread).toMatchObject({ mailbox: home.id, recipient: "grace.home@example.com", subject: "Both" });
});

test("a draft's operations in All mailboxes act on it in its own mailbox", async () => {
  const { grace, home } = await withTwoMailboxes();
  const { data: draft } = await grace.POST("/all-mailboxes/drafts", { body: { from: "grace.home@example.com", subject: "Plans" } });
  const path = { draft: draft!.id };

  const { data: edited } = await grace.PATCH("/all-mailboxes/drafts/{draft}", { params: { path }, body: { text: "Saturday?" } });

  expect(edited).toMatchObject({ id: draft!.id, mailbox: home.id, text: "Saturday?" });
  expect((await grace.GET("/all-mailboxes/drafts/{draft}", { params: { path } })).data).toEqual(edited);
  expect((await grace.DELETE("/all-mailboxes/drafts/{draft}", { params: { path } })).data).toEqual(edited);
  const { response, error } = await grace.GET("/all-mailboxes/drafts/{draft}", { params: { path } });
  expect(response.status).toBe(404);
  expect(error).toEqual({ message: `None of the mailboxes you can read has a draft ${JSON.stringify(draft!.id)}. List All mailboxes' drafts to find one.` });
});

test("labels of one name in several mailboxes are one label in All mailboxes, with each mailbox's own and the sum of their unread threads", async () => {
  const { grace, home, work, receive } = await withTwoMailboxes();
  const { data: workReceipts } = await grace.POST("/mailboxes/{mailbox}/labels", { params: { path: { mailbox: work.id } }, body: { name: "Receipts" } });
  const { data: homeReceipts } = await grace.POST("/mailboxes/{mailbox}/labels", { params: { path: { mailbox: home.id } }, body: { name: "Receipts" } });
  const { data: travel } = await grace.POST("/mailboxes/{mailbox}/labels", { params: { path: { mailbox: home.id } }, body: { name: "Travel" } });
  const { [work.id]: fromWork } = await receive("Hosting", ["grace@example.com"], "2026-10-01T08:00:00Z");
  const { [home.id]: fromHome } = await receive("Pharmacy", ["grace.home@example.com"], "2026-10-02T08:00:00Z");
  await grace.POST("/mailboxes/{mailbox}/threads/labels", { params: { path: { mailbox: work.id } }, body: { threads: [fromWork!], add: [workReceipts!.id] } });
  await grace.POST("/mailboxes/{mailbox}/threads/labels", { params: { path: { mailbox: home.id } }, body: { threads: [fromHome!], add: [homeReceipts!.id] } });
  await grace.POST("/all-mailboxes/threads/unread", { body: { threads: [fromWork!, fromHome!] } });

  const { data } = await grace.GET("/all-mailboxes/labels");

  expect(data!.labels.map(({ id }) => id)).toEqual(["inbox", "feed", "paperTrail", "spam", "trash", "Receipts", "Travel"]);
  expect(data!.labels.find(({ id }) => id === "inbox")).toMatchObject({ name: "Inbox", builtIn: true, unread: 2 });
  expect(data!.labels.find(({ id }) => id === "Receipts")).toEqual({
    id: "Receipts",
    name: "Receipts",
    builtIn: false,
    unread: 2,
    mailboxes: expect.arrayContaining([
      { mailbox: work.id, label: workReceipts!.id, unread: 1 },
      { mailbox: home.id, label: homeReceipts!.id, unread: 1 },
    ]),
  });
  expect(data!.labels.find(({ id }) => id === "Travel")).toEqual({ id: "Travel", name: "Travel", builtIn: false, unread: 0, mailboxes: [{ mailbox: home.id, label: travel!.id, unread: 0 }] });
  const subjects = async (label: string) => (await grace.GET("/all-mailboxes/threads", { params: { query: { label } } })).data!.threads.map(({ subject }) => subject);
  expect(await subjects("receipts")).toEqual(["Pharmacy", "Hosting"]);
  expect(await subjects("Travel")).toEqual([]);
  expect(await subjects("Paper Trail")).toEqual([]);
});

test("labeling a thread by name in All mailboxes uses its own mailbox's label of that name, created there if it has none", async () => {
  const { grace, home, work, receive } = await withTwoMailboxes();
  const { data: travel } = await grace.POST("/mailboxes/{mailbox}/labels", { params: { path: { mailbox: home.id } }, body: { name: "Travel" } });
  const { [work.id]: fromWork } = await receive("Conference", ["grace@example.com"], "2026-10-01T08:00:00Z");
  const { [home.id]: fromHome } = await receive("Ferry", ["grace.home@example.com"], "2026-10-02T08:00:00Z");

  const { response, data } = await grace.POST("/all-mailboxes/threads/labels", { body: { threads: [fromWork!, fromHome!], add: ["travel"] } });

  expect(response.status).toBe(200);
  const workLabels = (await grace.GET("/mailboxes/{mailbox}/labels", { params: { path: { mailbox: work.id } } })).data!.labels;
  const workTravel = workLabels.find(({ name }) => name === "travel");
  expect(workTravel).toMatchObject({ builtIn: false });
  expect(data!.threads).toMatchObject([
    { id: fromWork, mailbox: work.id, labels: ["inbox", workTravel!.id] },
    { id: fromHome, mailbox: home.id, labels: ["inbox", travel!.id] },
  ]);
  expect((await grace.GET("/mailboxes/{mailbox}/labels", { params: { path: { mailbox: home.id } } })).data!.labels.filter(({ builtIn }) => !builtIn)).toEqual([
    { id: travel!.id, name: "Travel", builtIn: false, unread: 1 },
  ]);

  const { data: removed } = await grace.POST("/all-mailboxes/threads/labels", { body: { threads: [fromWork!, fromHome!], remove: ["Travel", "Receipts"] } });

  expect(removed!.threads).toMatchObject([{ labels: ["inbox"] }, { labels: ["inbox"] }]);

  const { data: byId } = await grace.POST("/all-mailboxes/threads/labels", { body: { threads: [fromWork!, fromHome!], add: [travel!.id] } });

  expect(byId!.threads).toMatchObject([{ id: fromWork, labels: ["inbox"] }, { id: fromHome, labels: ["inbox", travel!.id] }]);
  expect((await grace.GET("/mailboxes/{mailbox}/labels", { params: { path: { mailbox: work.id } } })).data!.labels.filter(({ builtIn }) => !builtIn).map(({ name }) => name)).toEqual(["travel"]);
});

test("each view's unread count in All mailboxes is the sum of its mailboxes' counts", async () => {
  const { grace, home, work, receive } = await withTwoMailboxes();
  const first = await receive("One", ["grace@example.com"], "2026-10-01T08:00:00Z");
  const second = await receive("Two", ["grace@example.com", "grace.home@example.com"], "2026-10-02T08:00:00Z");
  await grace.POST("/all-mailboxes/threads/unread", { body: { threads: [first[work.id]!, second[work.id]!, second[home.id]!] } });

  const { data } = await grace.GET("/all-mailboxes");

  expect(data!.unread).toBe(3);
  expect(Object.fromEntries(data!.mailboxes.map(({ id, unread }) => [id, unread]))).toEqual({ [work.id]: 2, [home.id]: 1 });
  expect(data!.mailboxes.find(({ id }) => id === work.id)).toMatchObject({ addresses: ["grace@example.com", "support@example.com"], defaultAddress: "grace@example.com", groups: [] });
});

test("a client following All mailboxes catches up on every mailbox's change feed in one call", async () => {
  const { grace, home, work, receive } = await withTwoMailboxes();
  const copies = await receive("Both", ["grace@example.com", "grace.home@example.com"], "2026-10-01T08:00:00Z");

  const { data: first } = await grace.GET("/all-mailboxes/changes");

  const arrivals = Object.fromEntries(first!.mailboxes.map(({ mailbox, changes }) => [mailbox, changes.filter((change) => change.type === "messageReceived").map((change) => change.thread)]));
  expect(arrivals).toEqual({ [work.id]: [copies[work.id]], [home.id]: [copies[home.id]] });
  const { data: caughtUp } = await grace.GET("/all-mailboxes/changes", { params: { query: { after: first!.position } } });
  expect(caughtUp!.mailboxes.flatMap(({ changes }) => changes)).toEqual([]);

  const { [home.id]: later } = await receive("Later", ["grace.home@example.com"], "2026-10-02T08:00:00Z");

  const { data: next } = await grace.GET("/all-mailboxes/changes", { params: { query: { after: caughtUp!.position } } });
  expect(next!.mailboxes.find(({ mailbox }) => mailbox === home.id)!.changes).toMatchObject([{ type: "messageReceived", thread: later }]);
  expect(next!.mailboxes.find(({ mailbox }) => mailbox === work.id)!.changes).toEqual([]);
  expect(next!.mailboxes.find(({ mailbox }) => mailbox === home.id)!.position).toBe(
    (await grace.GET("/mailboxes/{mailbox}/changes", { params: { path: { mailbox: home.id } } })).data!.position,
  );
});

test("a search of All mailboxes searches each mailbox's index and merges what they find, each result naming its mailbox", async () => {
  const { grace, home, work, receive } = await withTwoMailboxes();
  await receive("Ferry tickets", ["grace@example.com"], "2026-10-01T08:00:00Z");
  await receive("Ferry times", ["grace.home@example.com"], "2026-10-02T08:00:00Z");
  await receive("Lunch", ["grace.home@example.com"], "2026-10-03T08:00:00Z");

  const { data } = await grace.GET("/all-mailboxes/search", { params: { query: { q: "ferry", sort: "newest" } } });

  expect(data!.results.map(({ thread }) => ({ subject: thread.subject, mailbox: thread.mailbox, recipient: thread.recipient }))).toEqual([
    { subject: "Ferry times", mailbox: home.id, recipient: "grace.home@example.com" },
    { subject: "Ferry tickets", mailbox: work.id, recipient: "grace@example.com" },
  ]);
  expect(data!.next).toBeUndefined();
  const { data: first } = await grace.GET("/all-mailboxes/search", { params: { query: { q: "ferry", sort: "newest", limit: 1 } } });
  expect(first!.results.map(({ thread }) => thread.subject)).toEqual(["Ferry times"]);
  const { data: second } = await grace.GET("/all-mailboxes/search", { params: { query: { q: "ferry", sort: "newest", limit: 1, after: first!.next! } } });
  expect(second!.results.map(({ thread }) => thread.subject)).toEqual(["Ferry tickets"]);
  expect(second!.next).toBeUndefined();
});

test("a search of All mailboxes for a label finds it in each mailbox that has it, and is refused when none has it", async () => {
  const { grace, home, receive } = await withTwoMailboxes();
  const { data: travel } = await grace.POST("/mailboxes/{mailbox}/labels", { params: { path: { mailbox: home.id } }, body: { name: "Travel" } });
  const { [home.id]: ferry } = await receive("Ferry tickets", ["grace.home@example.com"], "2026-10-01T08:00:00Z");
  await receive("Ferry times", ["grace@example.com"], "2026-10-02T08:00:00Z");
  await grace.POST("/mailboxes/{mailbox}/threads/labels", { params: { path: { mailbox: home.id } }, body: { threads: [ferry!], add: [travel!.id] } });

  const { data } = await grace.GET("/all-mailboxes/search", { params: { query: { q: "ferry label:travel" } } });

  expect(data!.results.map(({ thread }) => thread.subject)).toEqual(["Ferry tickets"]);
  const { response, error } = await grace.GET("/all-mailboxes/search", { params: { query: { q: "ferry label:receipts" } } });
  expect(response.status).toBe(400);
  expect(error).toEqual({ message: `None of the mailboxes you can read has a label "receipts". List All mailboxes' labels to see their names.` });
});

test("an agent's All mailboxes is the mailboxes its sponsor access covers, so a thread in another of its sponsor's isn't found", async () => {
  const { duva, grace, home, work, receive, listed } = await withTwoMailboxes();
  const { data: created } = await grace.POST("/agents", { body: { name: "Hermes" } });
  await grace.PATCH("/agents/{agent}/settings", { params: { path: { agent: created!.agent.id } }, body: { sponsorAccess: "organize", sponsorMailboxes: [work.id] } });
  const hermes = duva.withKey(created!.key);
  const { [work.id]: fromWork } = await receive("Work", ["grace@example.com"], "2026-10-01T08:00:00Z");
  const { [home.id]: fromHome } = await receive("Home", ["grace.home@example.com"], "2026-10-02T08:00:00Z");

  expect((await hermes.GET("/all-mailboxes")).data!.mailboxes.map(({ id, sponsorAccess }) => ({ id, sponsorAccess }))).toEqual([{ id: work.id, sponsorAccess: "organize" }]);
  expect(await listed("/all-mailboxes/threads", {}, hermes)).toEqual([{ subject: "Work", mailbox: work.id, recipient: "grace@example.com" }]);
  const { response, error } = await hermes.POST("/all-mailboxes/threads/read", { body: { threads: [fromWork!, fromHome!] } });
  expect(response.status).toBe(404);
  expect(error).toEqual({ message: `None of the mailboxes you can read has a thread ${JSON.stringify(fromHome)}, so no thread was changed. List All mailboxes' threads to find their IDs.` });
  expect((await hermes.POST("/all-mailboxes/threads/read", { body: { threads: [fromWork!] } })).response.status).toBe(200);
});

test("an agent acting in All mailboxes needs its sponsor access in each mailbox the threads are in, and a refusal changes none of them", async () => {
  const { duva, grace, home, work, receive } = await withTwoMailboxes();
  const { data: created } = await grace.POST("/agents", { body: { name: "Hermes" } });
  const agent = { params: { path: { agent: created!.agent.id } } };
  await grace.PATCH("/agents/{agent}/settings", { ...agent, body: { sponsorAccess: "read" } });
  const hermes = duva.withKey(created!.key);
  const { [work.id]: fromWork } = await receive("Work", ["grace@example.com"], "2026-10-01T08:00:00Z");
  const { [home.id]: fromHome } = await receive("Home", ["grace.home@example.com"], "2026-10-02T08:00:00Z");

  const { response, error } = await hermes.POST("/all-mailboxes/threads/labels", { body: { threads: [fromWork!, fromHome!], remove: ["inbox"] } });

  expect(response.status).toBe(403);
  expect(error).toEqual({ message: "Your sponsor access is read, which doesn't let you organize your sponsor's mailbox. Ask your sponsor for organize access." });
  expect((await grace.GET("/all-mailboxes/threads")).data!.threads.map(({ subject }) => subject)).toEqual(["Home", "Work"]);
});

test("Sent, Remind me, the Screener and Drafts work on All mailboxes too, each naming its mailbox", async () => {
  const { duva, grace, home, work, receive, listed } = await withTwoMailboxes();
  await grace.PATCH("/mailboxes/{mailbox}/screener", { params: { path: { mailbox: home.id } }, body: { on: true } });
  const { [work.id]: soon } = await receive("Soon", ["grace@example.com"], "2026-10-01T08:00:00Z");
  await receive("Waiting", ["grace.home@example.com"], "2026-10-02T08:00:00Z");
  const { [work.id]: later } = await receive("Later", ["grace@example.com"], "2026-10-03T08:00:00Z");
  await grace.POST("/all-mailboxes/threads/remind", { body: { threads: [later!], at: "2026-12-02T08:00:00Z" } });
  await grace.POST("/all-mailboxes/threads/remind", { body: { threads: [soon!], at: "2026-12-01T08:00:00Z" } });

  expect(await listed("/all-mailboxes/reminders")).toEqual([
    { subject: "Soon", mailbox: work.id, recipient: "grace@example.com" },
    { subject: "Later", mailbox: work.id, recipient: "grace@example.com" },
  ]);
  const { data: screener } = await grace.GET("/all-mailboxes/screener");
  expect(screener!.mailboxes).toEqual(expect.arrayContaining([{ mailbox: home.id, on: true, decided: 0 }, { mailbox: work.id, on: false, decided: 0 }]));
  expect(screener!.senders).toMatchObject([{ mailbox: home.id, address: "ada@example.org", threads: [{ subject: "Waiting", mailbox: home.id, recipient: "grace.home@example.com" }] }]);

  const { data: draft } = await grace.POST("/all-mailboxes/drafts", { body: { from: "grace.home@example.com", to: ["linus@example.org"], subject: "Dinner", text: "Friday?" } });
  const { response } = await grace.POST("/all-mailboxes/drafts/{draft}/send", { params: { path: { draft: draft!.id } } });
  expect(response.status).toBe(202);

  expect(await listed("/all-mailboxes/sent")).toEqual([{ subject: "Dinner", mailbox: home.id, recipient: "grace.home@example.com" }]);
  expect((await grace.GET("/all-mailboxes/drafts")).data!.drafts).toMatchObject([{ id: draft!.id, mailbox: home.id, send: { state: "sent" } }]);
});

test("a human's preferences open the web app on All mailboxes and start new mail from the mailbox holding their sign-in address, until they choose others", async () => {
  const { grace, home } = await withTwoMailboxes();

  expect((await grace.GET("/preferences")).data).toMatchObject({ opensOn: "all", newMailFrom: "grace@example.com" });

  const { response, data } = await grace.PATCH("/preferences", { body: { opensOn: home.id, newMailFrom: "Grace.Home@example.com" } });

  expect(response.status).toBe(200);
  expect(data).toMatchObject({ opensOn: home.id, newMailFrom: "grace.home@example.com" });
  expect((await grace.GET("/preferences")).data).toMatchObject({ opensOn: home.id, newMailFrom: "grace.home@example.com" });
  expect((await grace.PATCH("/preferences", { body: { newMailFrom: null } })).data).toMatchObject({ newMailFrom: "grace@example.com" });
});

test("a human's preferences name only their own mailboxes and addresses", async () => {
  const { ada, grace, linus } = await withTwoMailboxes();
  const { data: linusActor } = await linus.GET("/whoami");
  const { data: theirs } = await ada.POST("/mailboxes", { body: { owner: linusActor!.id, address: "linus@example.com" } });

  for (const [body, message] of [
    [{ opensOn: theirs!.id }, `${JSON.stringify(theirs!.id)} isn't one of your mailboxes. Give opensOn as all, for All mailboxes, or the ID of one of yours, which listing your mailboxes gives.`],
    [{ newMailFrom: "linus@example.com" }, `"linus@example.com" isn't one of your addresses. Give newMailFrom as an address of one of your mailboxes, which listing your mailboxes gives.`],
  ] as const) {
    const { response, error } = await grace.PATCH("/preferences", { body });
    expect(response.status).toBe(400);
    expect(error).toEqual({ message });
  }
  expect((await linus.GET("/preferences")).data).toMatchObject({ opensOn: "all", newMailFrom: "linus@example.com" });
});

test("new mail written in All mailboxes starts from the address the preference names, in its mailbox, or from the address given, in that one", async () => {
  const { grace, home, work } = await withTwoMailboxes();

  const { data: fromDefault } = await grace.POST("/all-mailboxes/drafts", { body: { subject: "Default" } });
  expect(fromDefault).toMatchObject({ mailbox: work.id, from: "grace@example.com" });

  await grace.PATCH("/preferences", { body: { newMailFrom: "grace.home@example.com" } });
  const { data: fromPreference } = await grace.POST("/all-mailboxes/drafts", { body: { subject: "Preferred" } });
  expect(fromPreference).toMatchObject({ mailbox: home.id, from: "grace.home@example.com" });

  const { data: fromGiven } = await grace.POST("/all-mailboxes/drafts", { body: { subject: "Given", from: "support@example.com" } });
  expect(fromGiven).toMatchObject({ mailbox: work.id, from: "support@example.com" });
});
