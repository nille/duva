import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { startDuva } from "./harness.ts";

/** A fixture in test/mail, as the sender's server sends it. */
const mail = (name: string) => readFile(new URL(`mail/${name}.eml`, import.meta.url));

type Duva = Awaited<ReturnType<typeof startDuva>>;

/**
 * Has Ada, the first admin, create a mailbox at the address for the human signed in with `email`,
 * who switches its Screener off, so mail from first-time senders lands in the Inbox.
 */
async function mailboxFor(duva: Duva, email: string, address: string) {
  const owner = duva.signIn(email);
  const { data: me } = await owner.GET("/whoami");
  const { data: mailbox } = await duva.signIn("ada@example.org").POST("/mailboxes", { body: { owner: me!.id, address } });
  await owner.PATCH("/mailboxes/{mailbox}/screener", { params: { path: { mailbox: mailbox!.id } }, body: { on: false } });
  return mailbox!;
}

/** The position of switching the Screener off, the first change in a mailbox's feed from mailboxFor(). */
const switchedOff = 1;

/**
 * A deployment on example.com where ada, the first admin, has a mailbox at hermes@example.com, with
 * the Screener off. Grace is another human. `sinceSwitch` reads the change feed past the switch.
 */
async function withMailbox() {
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org"] });
  const ada = duva.signIn("ada@example.org");
  const mailbox = await mailboxFor(duva, "ada@example.org", "hermes@example.com");
  const params = { path: { mailbox: mailbox.id } };
  const sinceSwitch = { ...params, query: { after: switchedOff } };
  return { duva, ada, mailbox, params, sinceSwitch };
}

test("creating the first address creates Duva's receipt rule: its recipients, scanning, then S3 and the inbound Lambda", async () => {
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org" });
  const ada = duva.signIn("ada@example.org");
  const { data: me } = await ada.GET("/whoami");
  expect(duva.receiptRules()).toEqual([]);

  await ada.POST("/mailboxes", { body: { owner: me!.id, address: "hermes@example.com" } });

  const [rule, ...others] = duva.receiptRules();
  expect(others).toEqual([]);
  expect(rule).toMatchObject({ Enabled: true, ScanEnabled: true, Recipients: ["hermes@example.com"] });
  expect(rule?.Actions).toEqual([
    { S3Action: { BucketName: "duva-mail", ObjectKeyPrefix: expect.any(String) } },
    { LambdaAction: { FunctionArn: expect.stringContaining(":function:"), InvocationType: "Event" } },
  ]);
});

test("mail to each later address is accepted, with no redeploy", async () => {
  const { duva, ada } = await withMailbox();
  const { data: grace } = await duva.signIn("grace@example.org").GET("/whoami");

  await ada.POST("/mailboxes", { body: { owner: grace!.id, address: "grace@example.com" } });

  const { refused } = await duva.receive(await mail("plain"), { to: ["hermes@example.com", "grace@example.com", "nobody@example.com"] });
  expect(refused).toEqual(["nobody@example.com"]);
});

test("mail to addresses created at the same time is accepted for each", async () => {
  const names = ["ada", "grace", "babbage", "lovelace"];
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org", humans: names.slice(1).map((name) => `${name}@example.org`) });
  const ada = duva.signIn("ada@example.org");
  const humans = await Promise.all(names.map(async (name) => (await duva.signIn(`${name}@example.org`).GET("/whoami")).data!));

  await Promise.all(humans.map((human, index) => ada.POST("/mailboxes", { body: { owner: human.id, address: `${names[index]}@example.com` } })));

  const { refused } = await duva.receive(await mail("plain"), { to: names.map((name) => `${name}@example.com`) });
  expect(refused).toEqual([]);
});

test("mail to an address that doesn't exist is refused during delivery", async () => {
  const { duva, ada, params } = await withMailbox();

  const { refused } = await duva.receive(await mail("plain"), { to: ["nobody@example.com"] });

  expect(refused).toEqual(["nobody@example.com"]);
  expect((await ada.GET("/mailboxes/{mailbox}/threads", { params })).data).toEqual({ threads: [] });
});

test("of a message's recipients, only those that don't exist are refused", async () => {
  const { duva, ada, params } = await withMailbox();

  const { refused } = await duva.receive(await mail("plain"), { to: ["nobody@example.com", "hermes@example.com"] });

  expect(refused).toEqual(["nobody@example.com"]);
  expect((await ada.GET("/mailboxes/{mailbox}/threads", { params })).data?.threads).toHaveLength(1);
});

test("mail to the mailbox's address lands in its Inbox as a new thread", async () => {
  const { duva, ada, params } = await withMailbox();

  const { refused } = await duva.receive(await mail("plain"), { to: ["hermes@example.com"] });

  expect(refused).toEqual([]);
  const { data } = await ada.GET("/mailboxes/{mailbox}/threads", { params });
  expect(data).toEqual({
    threads: [
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
    ],
  });
});

test("the owner reads a message: sender, recipients, subject, date and plain-text body", async () => {
  const { duva, ada, params } = await withMailbox();
  await duva.receive(await mail("plain"), { to: ["hermes@example.com"] });
  const { data: list } = await ada.GET("/mailboxes/{mailbox}/threads", { params });
  const thread = list!.threads[0]!;

  const { data } = await ada.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { ...params.path, thread: thread.id } } });

  expect(data).toEqual({
    id: thread.id,
    subject: "Compiler notes",
    labels: ["inbox"],
    unread: true,
    messages: [
      {
        id: expect.any(String),
        messageId: "<notes-1@example.org>",
        from: { name: "Grace Hopper", address: "grace@example.org" },
        to: [{ name: "Hermes", address: "hermes@example.com" }],
        cc: [{ address: "ada@example.org" }],
        recipient: "hermes@example.com",
        subject: "Compiler notes",
        date: "2026-10-02T07:30:00.000Z",
        receivedAt: thread.latestAt,
        text: "Hej Hermes,\n\nHär är mina anteckningar om kompilatorn.\n\nGrace",
        attachments: [],
      },
    ],
  });
});

/** Receives the fixture for Ada's mailbox, and lists and reads the one thread and message it becomes. */
async function receiveAndRead(name: string, to = "hermes@example.com") {
  const { duva, ada, params } = await withMailbox();
  await duva.receive(await mail(name), { to: [to] });
  const { data: list } = await ada.GET("/mailboxes/{mailbox}/threads", { params });
  const thread = list!.threads[0]!;
  const { data } = await ada.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { ...params.path, thread: thread.id } } });
  return { thread, message: data!.messages[0]! };
}

test("mail with only HTML is turned into text", async () => {
  const { message } = await receiveAndRead("html-only");

  expect(message.text).toBe("Weekly update\n\nThe build is green.\n\n * Parser done\n * Tests pass");
});

test("mail with only HTML gets a snippet of its visible text, without its head, styles or scripts", async () => {
  const { thread, message } = await receiveAndRead("html-document");

  expect(thread.snippet).toBe("Matchdag mot Bergsjö Avspark klockan 15.00 på Lindvallen. Ta med fikakorg!");
  expect(message.text).toBe("Matchdag mot Bergsjö\n\nAvspark klockan 15.00 på Lindvallen. Ta med fikakorg!");
});

test("a text part that holds an HTML document is turned into text, for the snippet and the message", async () => {
  const { thread, message } = await receiveAndRead("html-as-text");

  expect(thread.snippet).toBe("Matchdag mot Bergsjö Avspark klockan 15.00 på Lindvallen. Ta med fikakorg!");
  expect(message.text).toBe("Matchdag mot Bergsjö\n\nAvspark klockan 15.00 på Lindvallen. Ta med fikakorg!");
});

test("a message's attachments are listed by name, type and size", async () => {
  const { message } = await receiveAndRead("attachment");

  expect(message.text).toBe("The report and its data are attached.");
  expect(message.attachments).toEqual([
    { name: "report.pdf", type: "application/pdf", size: 11 },
    { type: "text/csv", size: 8 },
  ]);
});

test("mail to the address with a plus tag arrives, and the message shows the plus tag", async () => {
  const { message } = await receiveAndRead("plus-tagged", "hermes+news@example.com");

  expect(message).toMatchObject({ recipient: "hermes+news@example.com", plusTag: "news", subject: "October news" });
});

test("a plus tag is matched without regard to case, and kept as it was sent", async () => {
  const { message } = await receiveAndRead("plus-tagged", "Hermes+News@Example.com");

  expect(message).toMatchObject({ recipient: "hermes+News@example.com", plusTag: "News" });
});

test("each message becomes a new thread, and the Inbox lists the newest first", async () => {
  const { duva, ada, params } = await withMailbox();
  await duva.receive(await mail("plain"), { to: ["hermes@example.com"] });
  await duva.receive(await mail("plus-tagged"), { to: ["hermes+news@example.com"] });
  await duva.receive(await mail("attachment"), { to: ["hermes@example.com"] });

  const { data } = await ada.GET("/mailboxes/{mailbox}/threads", { params });

  expect(data?.threads.map(({ subject }) => subject)).toEqual(["The report", "October news", "Compiler notes"]);
});

test("a message processed twice shows up once", async () => {
  const { duva, ada, params, sinceSwitch } = await withMailbox();

  await duva.receive(await mail("plain"), { to: ["hermes@example.com"] }, { invocations: 2 });

  expect((await ada.GET("/mailboxes/{mailbox}/threads", { params })).data?.threads).toHaveLength(1);
  expect((await ada.GET("/mailboxes/{mailbox}/changes", { params: sinceSwitch })).data?.changes).toHaveLength(1);
});

test("messages arriving at the same time each get their own place in the mailbox's change feed", async () => {
  const { duva, ada, params, sinceSwitch } = await withMailbox();

  await Promise.all(["plain", "html-only", "attachment", "plus-tagged"].map(async (name) => duva.receive(await mail(name), { to: ["hermes+x@example.com"] })));

  const { data } = await ada.GET("/mailboxes/{mailbox}/changes", { params: sinceSwitch });
  expect(data?.changes.map(({ position }) => position)).toEqual([2, 3, 4, 5]);
  expect((await ada.GET("/mailboxes/{mailbox}/threads", { params })).data?.threads).toHaveLength(4);
});

test("one message to two mailboxes lands in each", async () => {
  const { duva, ada, params } = await withMailbox();
  const graceMailbox = await mailboxFor(duva, "grace@example.org", "grace@example.com");

  await duva.receive(await mail("plain"), { to: ["hermes@example.com", "grace@example.com"] });

  expect((await ada.GET("/mailboxes/{mailbox}/threads", { params })).data?.threads).toHaveLength(1);
  const graceThreads = await duva.signIn("grace@example.org").GET("/mailboxes/{mailbox}/threads", { params: { path: { mailbox: graceMailbox.id } } });
  expect(graceThreads.data?.threads).toHaveLength(1);
});

test("the owner catches up on the mailbox's change feed and sees each arrival once, naming no actor", async () => {
  const { duva, ada, params, sinceSwitch } = await withMailbox();
  await duva.receive(await mail("plain"), { to: ["hermes@example.com"] });

  const { data: first } = await ada.GET("/mailboxes/{mailbox}/changes", { params: sinceSwitch });
  await duva.receive(await mail("attachment"), { to: ["hermes@example.com"] });
  const { data: next } = await ada.GET("/mailboxes/{mailbox}/changes", { params: { ...params, query: { after: first!.position } } });
  const { data: none } = await ada.GET("/mailboxes/{mailbox}/changes", { params: { ...params, query: { after: next!.position } } });

  const { data: list } = await ada.GET("/mailboxes/{mailbox}/threads", { params });
  const [report, notes] = list!.threads;
  const messageIn = async (thread: string) =>
    (await ada.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { ...params.path, thread } } })).data!.messages[0]!.id;
  expect(first).toEqual({
    changes: [{ position: 2, at: expect.any(String), type: "messageReceived", thread: notes!.id, message: await messageIn(notes!.id) }],
    position: 2,
  });
  expect(next).toEqual({
    changes: [{ position: 3, at: expect.any(String), type: "messageReceived", thread: report!.id, message: await messageIn(report!.id) }],
    position: 3,
  });
  expect(none).toEqual({ changes: [], position: 3 });
});

test("the mailbox's change feed refuses a position that isn't one", async () => {
  const { ada, params } = await withMailbox();

  const { response, error } = await ada.GET("/mailboxes/{mailbox}/changes", {
    params: { ...params, query: { after: "first" as unknown as number } },
  });

  expect(response.status).toBe(400);
  expect(error?.message).toMatch(/isn't a position/);
});

test("the mailbox's change feed refuses a spam value that isn't true or false", async () => {
  const { ada, params } = await withMailbox();

  const { response, error } = await ada.GET("/mailboxes/{mailbox}/changes", {
    params: { ...params, query: { spam: "yes" as unknown as boolean } },
  });

  expect(response.status).toBe(400);
  expect(error?.message).toMatch(/isn't true or false/);
});

test("an agent with read sponsor access catches up on, lists and reads its sponsor's mailbox as the sponsor does", async () => {
  const { duva, ada, params } = await withMailbox();
  const { data: created } = await ada.POST("/agents", { body: { name: "Hermes" } });
  await ada.PATCH("/agents/{agent}/settings", { params: { path: { agent: created!.agent.id } }, body: { sponsorAccess: "read" } });
  const hermes = duva.withKey(created!.key);
  await duva.receive(await mail("plain"), { to: ["hermes@example.com"] });

  const changes = await hermes.GET("/mailboxes/{mailbox}/changes", { params });
  const threads = await hermes.GET("/mailboxes/{mailbox}/threads", { params });
  const thread = { params: { path: { ...params.path, thread: threads.data!.threads[0]!.id } } };
  const read = await ada.GET("/mailboxes/{mailbox}/threads/{thread}", thread);

  expect(changes.data).toEqual((await ada.GET("/mailboxes/{mailbox}/changes", { params })).data);
  expect(threads.data).toEqual((await ada.GET("/mailboxes/{mailbox}/threads", { params })).data);
  expect(read.data).toEqual((await ada.GET("/mailboxes/{mailbox}/threads/{thread}", thread)).data);
});

test("no other human or agent can reach the mailbox, not even the owner's own agent without sponsor access", async () => {
  const { duva, ada, params } = await withMailbox();
  await duva.receive(await mail("plain"), { to: ["hermes@example.com"] });
  const thread = (await ada.GET("/mailboxes/{mailbox}/threads", { params })).data!.threads[0]!.id;
  // Grace is a human who isn't the owner. Iris is Grace's agent, and Babbage is Ada's, given no sponsor access.
  const grace = duva.signIn("grace@example.org");
  const { data: iris } = await grace.POST("/agents", { body: { name: "Iris" } });
  const { data: babbage } = await ada.POST("/agents", { body: { name: "Babbage" } });

  for (const outsider of [grace, duva.withKey(iris!.key), duva.withKey(babbage!.key)]) {
    const changes = await outsider.GET("/mailboxes/{mailbox}/changes", { params });
    const threads = await outsider.GET("/mailboxes/{mailbox}/threads", { params });
    const read = await outsider.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { ...params.path, thread } } });
    expect([changes, threads, read].map(({ response }) => response.status)).toEqual([403, 403, 403]);
  }
});

test("an admin can't reach another human's mailbox, not even one the admin created", async () => {
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org"] });
  const mailbox = await mailboxFor(duva, "grace@example.org", "grace@example.com");
  await duva.receive(await mail("plain"), { to: ["grace@example.com"] });

  const { response, error } = await duva.signIn("ada@example.org").GET("/mailboxes/{mailbox}/threads", { params: { path: { mailbox: mailbox.id } } });

  expect(response.status).toBe(403);
  expect(error?.message).toMatch(/owner/);
});

test("reading a mailbox or thread that doesn't exist answers 404", async () => {
  const { ada, params } = await withMailbox();

  const mailbox = await ada.GET("/mailboxes/{mailbox}/threads", { params: { path: { mailbox: "nowhere" } } });
  const thread = await ada.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { ...params.path, thread: "nothing" } } });

  expect([mailbox.response.status, thread.response.status]).toEqual([404, 404]);
});

/** The mailbox's Inbox, and each of its threads as the owner reads it, in the Inbox's order. */
async function inboxOf(owner: Awaited<ReturnType<typeof withMailbox>>["ada"], mailbox: string) {
  const { data } = await owner.GET("/mailboxes/{mailbox}/threads", { params: { path: { mailbox } } });
  const threads = await Promise.all(
    data!.threads.map(async ({ id }) => (await owner.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { mailbox, thread: id } } })).data!),
  );
  return { summaries: data!.threads, threads };
}

test("a reply whose In-Reply-To names a message in the mailbox joins that message's thread", async () => {
  const { duva, ada, mailbox } = await withMailbox();
  await duva.receive(await mail("plain"), { to: ["hermes@example.com"] });

  await duva.receive(await mail("reply"), { to: ["hermes@example.com"] });

  const { summaries, threads } = await inboxOf(ada, mailbox.id);
  expect(summaries).toEqual([
    {
      id: expect.any(String),
      subject: "Compiler notes",
      from: { name: "Grace Hopper", address: "grace@example.org" },
      snippet: "Tack, Grace. Jag läser dem i kväll. Ada",
      labels: ["inbox"],
      unread: true,
      latestAt: threads[0]!.messages[1]!.receivedAt,
      messages: 2,
    },
  ]);
  expect(threads[0]!.messages.map(({ messageId, subject }) => ({ messageId, subject }))).toEqual([
    { messageId: "<notes-1@example.org>", subject: "Compiler notes" },
    { messageId: "<notes-2@example.org>", subject: "Re: Compiler notes" },
  ]);
});

test("a reply joins its thread through References alone, even when the message it answers never arrived", async () => {
  const { duva, ada, mailbox } = await withMailbox();
  await duva.receive(await mail("plain"), { to: ["hermes@example.com"] });

  // It answers notes-2, Ada's reply, which the mailbox never got, and also names notes-1 in References.
  await duva.receive(await mail("references-only"), { to: ["hermes@example.com"] });

  const { threads } = await inboxOf(ada, mailbox.id);
  expect(threads.map(({ messages }) => messages.map(({ messageId }) => messageId))).toEqual([["<notes-1@example.org>", "<notes-3@example.org>"]]);
});

test("a message that answers nothing in the mailbox starts a new thread, even with an existing thread's subject", async () => {
  const { duva, ada, mailbox } = await withMailbox();
  await duva.receive(await mail("plain"), { to: ["hermes@example.com"] });

  await duva.receive(await mail("same-subject"), { to: ["hermes@example.com"] });

  const { summaries } = await inboxOf(ada, mailbox.id);
  expect(summaries.map(({ subject, messages }) => ({ subject, messages }))).toEqual([
    { subject: "Compiler notes", messages: 1 },
    { subject: "Compiler notes", messages: 1 },
  ]);
});

test("a reply to a message in another mailbox starts a new thread", async () => {
  const { duva, ada, mailbox } = await withMailbox();
  await mailboxFor(duva, "grace@example.org", "grace@example.com");
  await duva.receive(await mail("plain"), { to: ["grace@example.com"] });

  await duva.receive(await mail("reply"), { to: ["hermes@example.com"] });

  const { summaries } = await inboxOf(ada, mailbox.id);
  expect(summaries.map(({ subject, messages }) => ({ subject, messages }))).toEqual([{ subject: "Re: Compiler notes", messages: 1 }]);
});

test("a reply that arrives before the message it answers starts its own thread, and the two stay apart", async () => {
  const { duva, ada, mailbox } = await withMailbox();
  await duva.receive(await mail("reply"), { to: ["hermes@example.com"] });

  await duva.receive(await mail("plain"), { to: ["hermes@example.com"] });

  const { threads } = await inboxOf(ada, mailbox.id);
  expect(threads.map(({ messages }) => messages.map(({ messageId }) => messageId))).toEqual([["<notes-1@example.org>"], ["<notes-2@example.org>"]]);
});

test("a thread with a new reply moves to the top of the Inbox", async () => {
  const { duva, ada, mailbox } = await withMailbox();
  await duva.receive(await mail("plain"), { to: ["hermes@example.com"] });
  await duva.receive(await mail("attachment"), { to: ["hermes@example.com"] });

  await duva.receive(await mail("reply"), { to: ["hermes@example.com"] });

  const { summaries } = await inboxOf(ada, mailbox.id);
  expect(summaries.map(({ subject, messages }) => ({ subject, messages }))).toEqual([
    { subject: "Compiler notes", messages: 2 },
    { subject: "The report", messages: 1 },
  ]);
});

test("the change feed records a reply's arrival in the thread it joined", async () => {
  const { duva, ada, mailbox, params, sinceSwitch } = await withMailbox();
  await duva.receive(await mail("plain"), { to: ["hermes@example.com"] });

  await duva.receive(await mail("reply"), { to: ["hermes@example.com"] });

  const { threads } = await inboxOf(ada, mailbox.id);
  const [first, reply] = threads[0]!.messages;
  const { data } = await ada.GET("/mailboxes/{mailbox}/changes", { params: sinceSwitch });
  expect(data?.changes).toMatchObject([
    { type: "messageReceived", thread: threads[0]!.id, message: first!.id },
    { type: "messageReceived", thread: threads[0]!.id, message: reply!.id },
  ]);
});

test("a reply processed twice joins its thread once", async () => {
  const { duva, ada, mailbox } = await withMailbox();
  await duva.receive(await mail("plain"), { to: ["hermes@example.com"] });

  await duva.receive(await mail("reply"), { to: ["hermes@example.com"] }, { invocations: 2 });

  const { summaries, threads } = await inboxOf(ada, mailbox.id);
  expect(summaries.map(({ messages }) => messages)).toEqual([2]);
  expect(threads[0]!.messages).toHaveLength(2);
});

test("replies arriving at the same time all join the thread", async () => {
  const { duva, ada, mailbox } = await withMailbox();
  await duva.receive(await mail("plain"), { to: ["hermes@example.com"] });

  await Promise.all(["reply", "references-only", "reply", "references-only"].map(async (name) => duva.receive(await mail(name), { to: ["hermes@example.com"] })));

  const { summaries, threads } = await inboxOf(ada, mailbox.id);
  expect(summaries.map(({ messages }) => messages)).toEqual([5]);
  expect(threads[0]!.messages).toHaveLength(5);
});

/** What the owner can see of the mailbox: its Inbox, its Spam and its change feed past the Screener switch, spam arrivals included. */
async function everythingIn(owner: Awaited<ReturnType<typeof withMailbox>>["ada"], mailbox: string) {
  const params = { path: { mailbox } };
  const inbox = (await owner.GET("/mailboxes/{mailbox}/threads", { params })).data!.threads;
  const spam = (await owner.GET("/mailboxes/{mailbox}/threads", { params: { ...params, query: { label: "spam" } } })).data!.threads;
  const changes = (await owner.GET("/mailboxes/{mailbox}/changes", { params: { ...params, query: { after: switchedOff, spam: true } } })).data!.changes;
  return { inbox, spam, changes };
}

test("mail carrying a virus is accepted, then dropped, and nothing of it reaches the mailbox or its change feed", async () => {
  const { duva, ada, mailbox } = await withMailbox();

  const { refused } = await duva.receive(await mail("plain"), { to: ["hermes@example.com"] }, { verdicts: { virus: "FAIL" } });

  expect(refused).toEqual([]);
  expect(await everythingIn(ada, mailbox.id)).toEqual({ inbox: [], spam: [], changes: [] });
});

test("mail that fails DMARC from a domain whose policy is reject is dropped", async () => {
  const { duva, ada, mailbox } = await withMailbox();

  const { refused } = await duva.receive(await mail("plain"), { to: ["hermes@example.com"] }, { verdicts: { dmarc: "FAIL", dmarcPolicy: "reject" } });

  expect(refused).toEqual([]);
  expect(await everythingIn(ada, mailbox.id)).toEqual({ inbox: [], spam: [], changes: [] });
});

test("Duva never bounces dropped mail: its only actions store the message and hand it to the inbound Lambda", async () => {
  const { duva } = await withMailbox();

  await duva.receive(await mail("plain"), { to: ["hermes@example.com"] }, { verdicts: { virus: "FAIL", dmarc: "FAIL", dmarcPolicy: "reject" } });

  expect(duva.receiptRules().flatMap(({ Actions = [] }) => Actions.flatMap((action) => Object.keys(action)))).toEqual(["S3Action", "LambdaAction"]);
});

test("dropped mail processed twice is still dropped, and the second time doesn't fail", async () => {
  const { duva, ada, mailbox } = await withMailbox();

  await duva.receive(await mail("plain"), { to: ["hermes@example.com"] }, { invocations: 2, verdicts: { virus: "FAIL" } });
  await duva.receive(await mail("attachment"), { to: ["hermes@example.com"] });

  const { inbox, changes } = await everythingIn(ada, mailbox.id);
  expect(inbox.map(({ subject }) => subject)).toEqual(["The report"]);
  expect(changes.map(({ position }) => position)).toEqual([2]);
});

/** The drops the inbound Lambda logged, as CloudWatch reads them. */
const drops = (duva: Awaited<ReturnType<typeof startDuva>>) =>
  duva.inboundLog().map((line) => JSON.parse(line) as Record<string, unknown>).filter((entry) => "Reason" in entry);

test.each([
  ["virus", { virus: "FAIL" }],
  ["dmarcReject", { dmarc: "FAIL", dmarcPolicy: "reject" }],
] as const)("a dropped message is counted in Duva's metric by its reason, %s", async (reason, verdicts) => {
  const { duva } = await withMailbox();

  await duva.receive(await mail("plain"), { to: ["hermes@example.com"] }, { verdicts });

  expect(drops(duva)).toEqual([
    expect.objectContaining({
      _aws: { Timestamp: expect.any(Number), CloudWatchMetrics: [{ Namespace: "Duva", Dimensions: [["Reason"]], Metrics: [{ Name: "DroppedMessages", Unit: "Count" }] }] },
      Reason: reason,
      DroppedMessages: 1,
    }),
  ]);
});

test("a drop records SES's message ID, the receiving mailbox, the sender's domains, the DMARC policy and SES's verdicts", async () => {
  const { duva, mailbox } = await withMailbox();

  const { messageId } = await duva.receive(await mail("plain"), { from: "bounces@lists.example.net", to: ["hermes@example.com"] }, {
    verdicts: { spam: "GRAY", dmarc: "FAIL", dmarcPolicy: "reject" },
  });

  expect(drops(duva)).toEqual([
    expect.objectContaining({
      sesMessageId: messageId,
      mailboxes: [mailbox.id],
      envelopeDomain: "lists.example.net",
      fromDomains: ["example.org"],
      dmarcPolicy: "reject",
      verdicts: { spf: "PASS", dkim: "PASS", dmarc: "FAIL", spam: "GRAY", virus: "PASS" },
    }),
  ]);
});

test("a drop's record carries nothing of the message: no subject, body or attachment, and no address's local part", async () => {
  const { duva } = await withMailbox();

  await duva.receive(await mail("attachment"), { to: ["hermes@example.com", "Hermes+Reports@example.com"] }, { verdicts: { virus: "FAIL" } });

  const [line, ...others] = duva.inboundLog();
  expect(others).toEqual([]);
  // The fixture's sender, recipients, subject, body and attachments, in any case.
  for (const part of ["grace", "hopper", "hermes", "reports", "the report", "attached", "report.pdf", "SGVsbG8", "YSxiCjEsMgo"]) {
    expect(line!.toLowerCase()).not.toContain(part.toLowerCase());
  }
});

test("dropped mail processed twice is counted once", async () => {
  const { duva } = await withMailbox();

  await duva.receive(await mail("plain"), { to: ["hermes@example.com"] }, { invocations: 2, verdicts: { virus: "FAIL" } });

  expect(drops(duva)).toHaveLength(1);
});

test.each(["quarantine", "none"] as const)("mail that fails DMARC from a domain whose policy is %s lands in the Inbox as usual", async (dmarcPolicy) => {
  const { duva, ada, mailbox } = await withMailbox();

  await duva.receive(await mail("plain"), { to: ["hermes@example.com"] }, { verdicts: { dmarc: "FAIL", dmarcPolicy } });

  const { inbox, spam } = await everythingIn(ada, mailbox.id);
  expect(inbox.map(({ subject, labels }) => ({ subject, labels }))).toEqual([{ subject: "Compiler notes", labels: ["inbox"] }]);
  expect(spam).toEqual([]);
  expect(drops(duva)).toEqual([]);
});

test.each([
  ["spam", "GRAY"],
  ["spam", "PROCESSING_FAILED"],
  ["virus", "GRAY"],
  ["virus", "PROCESSING_FAILED"],
  ["dmarc", "GRAY"],
  ["dmarc", "PROCESSING_FAILED"],
] as const)("a %s verdict of %s counts as a pass, and the mail lands in the Inbox", async (verdict, status) => {
  const { duva, ada, mailbox } = await withMailbox();

  await duva.receive(await mail("plain"), { to: ["hermes@example.com"] }, { verdicts: { [verdict]: status } });

  const { inbox, spam } = await everythingIn(ada, mailbox.id);
  expect(inbox.map(({ subject }) => subject)).toEqual(["Compiler notes"]);
  expect(spam).toEqual([]);
});

test("mail judged to be spam is kept under the Spam label, out of the Inbox, and can still be read", async () => {
  const { duva, ada, mailbox } = await withMailbox();

  await duva.receive(await mail("plain"), { to: ["hermes@example.com"] }, { verdicts: { spam: "FAIL" } });

  const { inbox, spam } = await everythingIn(ada, mailbox.id);
  expect(inbox).toEqual([]);
  expect(spam).toEqual([{ id: expect.any(String), subject: "Compiler notes", from: { name: "Grace Hopper", address: "grace@example.org" }, snippet: expect.stringContaining("Hej Hermes"), labels: ["spam"], unread: true, latestAt: expect.any(String), messages: 1 }]);
  const { data: thread } = await ada.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { mailbox: mailbox.id, thread: spam[0]!.id } } });
  expect(thread).toMatchObject({ labels: ["spam"], messages: [{ messageId: "<notes-1@example.org>", text: expect.stringContaining("Hej Hermes") }] });
});

test("catching up on the change feed leaves spam arrivals out, and passes them, unless the caller asks for them", async () => {
  const { duva, ada, mailbox, params, sinceSwitch } = await withMailbox();
  await duva.receive(await mail("plain"), { to: ["hermes@example.com"] }, { verdicts: { spam: "FAIL" } });
  await duva.receive(await mail("attachment"), { to: ["hermes@example.com"] });
  await duva.receive(await mail("html-only"), { to: ["hermes@example.com"] }, { verdicts: { spam: "FAIL" } });

  const { data: withoutSpam } = await ada.GET("/mailboxes/{mailbox}/changes", { params: sinceSwitch });
  const { data: withSpam } = await ada.GET("/mailboxes/{mailbox}/changes", { params: { ...params, query: { after: switchedOff, spam: true } } });

  const { inbox, spam } = await everythingIn(ada, mailbox.id);
  const [html, notes] = spam;
  expect(withoutSpam).toEqual({ changes: [{ position: 3, at: expect.any(String), type: "messageReceived", thread: inbox[0]!.id, message: expect.any(String) }], position: 4 });
  expect(withSpam?.changes).toEqual([
    { position: 2, at: expect.any(String), type: "messageReceived", thread: notes!.id, message: expect.any(String), spam: true },
    { position: 3, at: expect.any(String), type: "messageReceived", thread: inbox[0]!.id, message: expect.any(String) },
    { position: 4, at: expect.any(String), type: "messageReceived", thread: html!.id, message: expect.any(String), spam: true },
  ]);
  expect(withSpam?.position).toBe(4);
});

test("catching up reads past a run of spam longer than a page, so the mail after it isn't missed", async () => {
  const { duva, ada, params, sinceSwitch } = await withMailbox();
  for (let sent = 0; sent < 101; sent++) await duva.receive(await mail("plain"), { to: ["hermes@example.com"] }, { verdicts: { spam: "FAIL" } });
  await duva.receive(await mail("attachment"), { to: ["hermes@example.com"] });

  const { data: page } = await ada.GET("/mailboxes/{mailbox}/changes", { params: sinceSwitch });
  const { data: after } = await ada.GET("/mailboxes/{mailbox}/changes", { params: { ...params, query: { after: page!.position } } });

  expect(page?.changes.map(({ position }) => position)).toEqual([103]);
  expect(page?.position).toBe(103);
  expect(after).toEqual({ changes: [], position: 103 });
}, 60_000);

test("spam that replies to a thread in the Inbox starts its own thread under Spam, and the Inbox thread is unchanged", async () => {
  const { duva, ada, mailbox } = await withMailbox();
  await duva.receive(await mail("plain"), { to: ["hermes@example.com"] });

  await duva.receive(await mail("reply"), { to: ["hermes@example.com"] }, { verdicts: { spam: "FAIL" } });

  const { inbox, spam } = await everythingIn(ada, mailbox.id);
  expect(inbox.map(({ subject, labels, messages }) => ({ subject, labels, messages }))).toEqual([{ subject: "Compiler notes", labels: ["inbox"], messages: 1 }]);
  expect(spam.map(({ subject, labels, messages }) => ({ subject, labels, messages }))).toEqual([{ subject: "Re: Compiler notes", labels: ["spam"], messages: 1 }]);
});

test("a reply to spam starts its own thread in the Inbox, so the spam stays apart", async () => {
  const { duva, ada, mailbox } = await withMailbox();
  await duva.receive(await mail("plain"), { to: ["hermes@example.com"] }, { verdicts: { spam: "FAIL" } });

  await duva.receive(await mail("reply"), { to: ["hermes@example.com"] });

  const { inbox, spam } = await everythingIn(ada, mailbox.id);
  expect(inbox.map(({ subject, labels, messages }) => ({ subject, labels, messages }))).toEqual([{ subject: "Re: Compiler notes", labels: ["inbox"], messages: 1 }]);
  expect(spam.map(({ subject, labels, messages }) => ({ subject, labels, messages }))).toEqual([{ subject: "Compiler notes", labels: ["spam"], messages: 1 }]);
});

test("virus and DMARC verdicts are acted on before spam: spam carrying a virus is dropped", async () => {
  const { duva, ada, mailbox } = await withMailbox();

  await duva.receive(await mail("plain"), { to: ["hermes@example.com"] }, { verdicts: { spam: "FAIL", virus: "FAIL" } });

  expect(await everythingIn(ada, mailbox.id)).toEqual({ inbox: [], spam: [], changes: [] });
});
