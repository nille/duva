import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { startDuva } from "./harness.ts";

/** A fixture in test/mail, as the sender's server sends it. */
const mail = (name: string) => readFile(new URL(`mail/${name}.eml`, import.meta.url));

/**
 * A deployment on example.com where ada, the first admin, sponsors the agent Hermes, which owns a
 * mailbox at hermes@example.com.
 */
async function withMailbox() {
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org"] });
  const ada = duva.signIn("ada@example.org");
  const { data: created } = await ada.POST("/agents", { body: { name: "Hermes" } });
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: created!.agent.id, address: "hermes@example.com" } });
  const hermes = duva.withKey(created!.key);
  const params = { path: { mailbox: mailbox!.id } };
  return { duva, ada, hermes, mailbox: mailbox!, params };
}

test("creating the first address creates Duva's receipt rule: its recipients, scanning, then S3 and the inbound Lambda", async () => {
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org" });
  const ada = duva.signIn("ada@example.org");
  const { data } = await ada.POST("/agents", { body: { name: "Hermes" } });
  expect(duva.receiptRules()).toEqual([]);

  await ada.POST("/mailboxes", { body: { owner: data!.agent.id, address: "hermes@example.com" } });

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
  const { data: iris } = await ada.POST("/agents", { body: { name: "Iris" } });

  await ada.POST("/mailboxes", { body: { owner: iris!.agent.id, address: "iris@example.com" } });

  const { refused } = await duva.receive(await mail("plain"), { to: ["hermes@example.com", "iris@example.com", "nobody@example.com"] });
  expect(refused).toEqual(["nobody@example.com"]);
});

test("mail to addresses created at the same time is accepted for each", async () => {
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org" });
  const ada = duva.signIn("ada@example.org");
  const names = ["hermes", "iris", "babbage", "lovelace"];
  const agents = await Promise.all(names.map(async (name) => (await ada.POST("/agents", { body: { name } })).data!.agent));

  await Promise.all(agents.map((agent, index) => ada.POST("/mailboxes", { body: { owner: agent.id, address: `${names[index]}@example.com` } })));

  const { refused } = await duva.receive(await mail("plain"), { to: names.map((name) => `${name}@example.com`) });
  expect(refused).toEqual([]);
});

test("mail to an address that doesn't exist is refused during delivery", async () => {
  const { duva, hermes, params } = await withMailbox();

  const { refused } = await duva.receive(await mail("plain"), { to: ["nobody@example.com"] });

  expect(refused).toEqual(["nobody@example.com"]);
  expect((await hermes.GET("/mailboxes/{mailbox}/threads", { params })).data).toEqual({ threads: [] });
});

test("of a message's recipients, only those that don't exist are refused", async () => {
  const { duva, hermes, params } = await withMailbox();

  const { refused } = await duva.receive(await mail("plain"), { to: ["nobody@example.com", "hermes@example.com"] });

  expect(refused).toEqual(["nobody@example.com"]);
  expect((await hermes.GET("/mailboxes/{mailbox}/threads", { params })).data?.threads).toHaveLength(1);
});

test("mail to the agent's address lands in its Inbox as a new thread", async () => {
  const { duva, hermes, params } = await withMailbox();

  const { refused } = await duva.receive(await mail("plain"), { to: ["hermes@example.com"] });

  expect(refused).toEqual([]);
  const { data } = await hermes.GET("/mailboxes/{mailbox}/threads", { params });
  expect(data).toEqual({
    threads: [
      {
        id: expect.any(String),
        subject: "Compiler notes",
        from: { name: "Grace Hopper", address: "grace@example.org" },
        labels: ["inbox"],
        latestAt: expect.any(String),
        messages: 1,
      },
    ],
  });
});

test("the agent reads a message: sender, recipients, subject, date and plain-text body", async () => {
  const { duva, hermes, params } = await withMailbox();
  await duva.receive(await mail("plain"), { to: ["hermes@example.com"] });
  const { data: list } = await hermes.GET("/mailboxes/{mailbox}/threads", { params });
  const thread = list!.threads[0]!;

  const { data } = await hermes.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { ...params.path, thread: thread.id } } });

  expect(data).toEqual({
    id: thread.id,
    subject: "Compiler notes",
    labels: ["inbox"],
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

/** Receives the fixture for the agent, and reads the one message it becomes. */
async function receiveAndRead(name: string, to = "hermes@example.com") {
  const { duva, hermes, params } = await withMailbox();
  await duva.receive(await mail(name), { to: [to] });
  const { data: list } = await hermes.GET("/mailboxes/{mailbox}/threads", { params });
  const { data } = await hermes.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { ...params.path, thread: list!.threads[0]!.id } } });
  return data!.messages[0]!;
}

test("mail with only HTML is turned into text", async () => {
  const message = await receiveAndRead("html-only");

  expect(message.text).toBe("Weekly update\n\nThe build is green.\n\n * Parser done\n * Tests pass");
});

test("a message's attachments are listed by name, type and size", async () => {
  const message = await receiveAndRead("attachment");

  expect(message.text).toBe("The report and its data are attached.");
  expect(message.attachments).toEqual([
    { name: "report.pdf", type: "application/pdf", size: 11 },
    { type: "text/csv", size: 8 },
  ]);
});

test("mail to the address with a plus tag arrives, and the message shows the plus tag", async () => {
  const message = await receiveAndRead("plus-tagged", "hermes+news@example.com");

  expect(message).toMatchObject({ recipient: "hermes+news@example.com", plusTag: "news", subject: "October news" });
});

test("a plus tag is matched without regard to case, and kept as it was sent", async () => {
  const message = await receiveAndRead("plus-tagged", "Hermes+News@Example.com");

  expect(message).toMatchObject({ recipient: "hermes+News@example.com", plusTag: "News" });
});

test("each message becomes a new thread, and the Inbox lists the newest first", async () => {
  const { duva, hermes, params } = await withMailbox();
  await duva.receive(await mail("plain"), { to: ["hermes@example.com"] });
  await duva.receive(await mail("plus-tagged"), { to: ["hermes+news@example.com"] });
  await duva.receive(await mail("attachment"), { to: ["hermes@example.com"] });

  const { data } = await hermes.GET("/mailboxes/{mailbox}/threads", { params });

  expect(data?.threads.map(({ subject }) => subject)).toEqual(["The report", "October news", "Compiler notes"]);
});

test("a message processed twice shows up once", async () => {
  const { duva, hermes, params } = await withMailbox();

  await duva.receive(await mail("plain"), { to: ["hermes@example.com"] }, { invocations: 2 });

  expect((await hermes.GET("/mailboxes/{mailbox}/threads", { params })).data?.threads).toHaveLength(1);
  expect((await hermes.GET("/mailboxes/{mailbox}/changes", { params })).data?.changes).toHaveLength(1);
});

test("messages arriving at the same time each get their own place in the mailbox's change feed", async () => {
  const { duva, hermes, params } = await withMailbox();

  await Promise.all(["plain", "html-only", "attachment", "plus-tagged"].map(async (name) => duva.receive(await mail(name), { to: ["hermes+x@example.com"] })));

  const { data } = await hermes.GET("/mailboxes/{mailbox}/changes", { params });
  expect(data?.changes.map(({ position }) => position)).toEqual([1, 2, 3, 4]);
  expect((await hermes.GET("/mailboxes/{mailbox}/threads", { params })).data?.threads).toHaveLength(4);
});

test("one message to two mailboxes lands in each", async () => {
  const { duva, ada, hermes, params } = await withMailbox();
  const { data: iris } = await ada.POST("/agents", { body: { name: "Iris" } });
  const { data: irisMailbox } = await ada.POST("/mailboxes", { body: { owner: iris!.agent.id, address: "iris@example.com" } });

  await duva.receive(await mail("plain"), { to: ["hermes@example.com", "iris@example.com"] });

  expect((await hermes.GET("/mailboxes/{mailbox}/threads", { params })).data?.threads).toHaveLength(1);
  const irisThreads = await duva.withKey(iris!.key).GET("/mailboxes/{mailbox}/threads", { params: { path: { mailbox: irisMailbox!.id } } });
  expect(irisThreads.data?.threads).toHaveLength(1);
});

test("the agent catches up on its mailbox's change feed and sees each arrival once, naming no actor", async () => {
  const { duva, hermes, params } = await withMailbox();
  await duva.receive(await mail("plain"), { to: ["hermes@example.com"] });

  const { data: first } = await hermes.GET("/mailboxes/{mailbox}/changes", { params });
  await duva.receive(await mail("attachment"), { to: ["hermes@example.com"] });
  const { data: next } = await hermes.GET("/mailboxes/{mailbox}/changes", { params: { ...params, query: { after: first!.position } } });
  const { data: none } = await hermes.GET("/mailboxes/{mailbox}/changes", { params: { ...params, query: { after: next!.position } } });

  const { data: list } = await hermes.GET("/mailboxes/{mailbox}/threads", { params });
  const [report, notes] = list!.threads;
  const messageIn = async (thread: string) =>
    (await hermes.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { ...params.path, thread } } })).data!.messages[0]!.id;
  expect(first).toEqual({
    changes: [{ position: 1, at: expect.any(String), type: "messageReceived", thread: notes!.id, message: await messageIn(notes!.id) }],
    position: 1,
  });
  expect(next).toEqual({
    changes: [{ position: 2, at: expect.any(String), type: "messageReceived", thread: report!.id, message: await messageIn(report!.id) }],
    position: 2,
  });
  expect(none).toEqual({ changes: [], position: 2 });
});

test("the mailbox's change feed refuses a position that isn't one", async () => {
  const { hermes, params } = await withMailbox();

  const { response, error } = await hermes.GET("/mailboxes/{mailbox}/changes", {
    params: { ...params, query: { after: "first" as unknown as number } },
  });

  expect(response.status).toBe(400);
  expect(error?.message).toMatch(/isn't a position/);
});

test("the sponsor catches up on, lists and reads the agent's mailbox the same way", async () => {
  const { duva, ada, hermes, params } = await withMailbox();
  await duva.receive(await mail("plain"), { to: ["hermes@example.com"] });

  const changes = await ada.GET("/mailboxes/{mailbox}/changes", { params });
  const threads = await ada.GET("/mailboxes/{mailbox}/threads", { params });
  const thread = { params: { path: { ...params.path, thread: threads.data!.threads[0]!.id } } };
  const read = await ada.GET("/mailboxes/{mailbox}/threads/{thread}", thread);

  expect(changes.data).toEqual((await hermes.GET("/mailboxes/{mailbox}/changes", { params })).data);
  expect(threads.data).toEqual((await hermes.GET("/mailboxes/{mailbox}/threads", { params })).data);
  expect(read.data).toEqual((await hermes.GET("/mailboxes/{mailbox}/threads/{thread}", thread)).data);
});

test("no other human or agent can reach the mailbox, not even another agent with the same sponsor", async () => {
  const { duva, hermes, params } = await withMailbox();
  await duva.receive(await mail("plain"), { to: ["hermes@example.com"] });
  const thread = (await hermes.GET("/mailboxes/{mailbox}/threads", { params })).data!.threads[0]!.id;
  // Grace is a human who isn't the sponsor. Iris is Grace's agent, and Babbage is another of Ada's.
  const grace = duva.signIn("grace@example.org");
  const { data: iris } = await grace.POST("/agents", { body: { name: "Iris" } });
  const { data: babbage } = await duva.signIn("ada@example.org").POST("/agents", { body: { name: "Babbage" } });

  for (const outsider of [grace, duva.withKey(iris!.key), duva.withKey(babbage!.key)]) {
    const changes = await outsider.GET("/mailboxes/{mailbox}/changes", { params });
    const threads = await outsider.GET("/mailboxes/{mailbox}/threads", { params });
    const read = await outsider.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { ...params.path, thread } } });
    expect([changes, threads, read].map(({ response }) => response.status)).toEqual([403, 403, 403]);
  }
});

test("an admin who sponsors none of the mailbox's agents can't reach it", async () => {
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org"] });
  const grace = duva.signIn("grace@example.org");
  const { data: iris } = await grace.POST("/agents", { body: { name: "Iris" } });
  const ada = duva.signIn("ada@example.org");
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: iris!.agent.id, address: "iris@example.com" } });
  await duva.receive(await mail("plain"), { to: ["iris@example.com"] });

  const { response, error } = await ada.GET("/mailboxes/{mailbox}/threads", { params: { path: { mailbox: mailbox!.id } } });

  expect(response.status).toBe(403);
  expect(error?.message).toMatch(/owner/);
});

test("reading a mailbox or thread that doesn't exist answers 404", async () => {
  const { hermes, params } = await withMailbox();

  const mailbox = await hermes.GET("/mailboxes/{mailbox}/threads", { params: { path: { mailbox: "nowhere" } } });
  const thread = await hermes.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { ...params.path, thread: "nothing" } } });

  expect([mailbox.response.status, thread.response.status]).toEqual([404, 404]);
});

/** The mailbox's Inbox, and each of its threads as the agent reads it, in the Inbox's order. */
async function inboxOf(hermes: Awaited<ReturnType<typeof withMailbox>>["hermes"], mailbox: string) {
  const { data } = await hermes.GET("/mailboxes/{mailbox}/threads", { params: { path: { mailbox } } });
  const threads = await Promise.all(
    data!.threads.map(async ({ id }) => (await hermes.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { mailbox, thread: id } } })).data!),
  );
  return { summaries: data!.threads, threads };
}

test("a reply whose In-Reply-To names a message in the mailbox joins that message's thread", async () => {
  const { duva, hermes, mailbox } = await withMailbox();
  await duva.receive(await mail("plain"), { to: ["hermes@example.com"] });

  await duva.receive(await mail("reply"), { to: ["hermes@example.com"] });

  const { summaries, threads } = await inboxOf(hermes, mailbox.id);
  expect(summaries).toEqual([
    {
      id: expect.any(String),
      subject: "Compiler notes",
      from: { name: "Grace Hopper", address: "grace@example.org" },
      labels: ["inbox"],
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
  const { duva, hermes, mailbox } = await withMailbox();
  await duva.receive(await mail("plain"), { to: ["hermes@example.com"] });

  // It answers notes-2, Ada's reply, which the mailbox never got, and also names notes-1 in References.
  await duva.receive(await mail("references-only"), { to: ["hermes@example.com"] });

  const { threads } = await inboxOf(hermes, mailbox.id);
  expect(threads.map(({ messages }) => messages.map(({ messageId }) => messageId))).toEqual([["<notes-1@example.org>", "<notes-3@example.org>"]]);
});

test("a message that answers nothing in the mailbox starts a new thread, even with an existing thread's subject", async () => {
  const { duva, hermes, mailbox } = await withMailbox();
  await duva.receive(await mail("plain"), { to: ["hermes@example.com"] });

  await duva.receive(await mail("same-subject"), { to: ["hermes@example.com"] });

  const { summaries } = await inboxOf(hermes, mailbox.id);
  expect(summaries.map(({ subject, messages }) => ({ subject, messages }))).toEqual([
    { subject: "Compiler notes", messages: 1 },
    { subject: "Compiler notes", messages: 1 },
  ]);
});

test("a reply to a message in another mailbox starts a new thread", async () => {
  const { duva, ada, hermes, mailbox } = await withMailbox();
  const { data: iris } = await ada.POST("/agents", { body: { name: "Iris" } });
  await ada.POST("/mailboxes", { body: { owner: iris!.agent.id, address: "iris@example.com" } });
  await duva.receive(await mail("plain"), { to: ["iris@example.com"] });

  await duva.receive(await mail("reply"), { to: ["hermes@example.com"] });

  const { summaries } = await inboxOf(hermes, mailbox.id);
  expect(summaries.map(({ subject, messages }) => ({ subject, messages }))).toEqual([{ subject: "Re: Compiler notes", messages: 1 }]);
});

test("a reply that arrives before the message it answers starts its own thread, and the two stay apart", async () => {
  const { duva, hermes, mailbox } = await withMailbox();
  await duva.receive(await mail("reply"), { to: ["hermes@example.com"] });

  await duva.receive(await mail("plain"), { to: ["hermes@example.com"] });

  const { threads } = await inboxOf(hermes, mailbox.id);
  expect(threads.map(({ messages }) => messages.map(({ messageId }) => messageId))).toEqual([["<notes-1@example.org>"], ["<notes-2@example.org>"]]);
});

test("a thread with a new reply moves to the top of the Inbox", async () => {
  const { duva, hermes, mailbox } = await withMailbox();
  await duva.receive(await mail("plain"), { to: ["hermes@example.com"] });
  await duva.receive(await mail("attachment"), { to: ["hermes@example.com"] });

  await duva.receive(await mail("reply"), { to: ["hermes@example.com"] });

  const { summaries } = await inboxOf(hermes, mailbox.id);
  expect(summaries.map(({ subject, messages }) => ({ subject, messages }))).toEqual([
    { subject: "Compiler notes", messages: 2 },
    { subject: "The report", messages: 1 },
  ]);
});

test("the change feed records a reply's arrival in the thread it joined", async () => {
  const { duva, hermes, mailbox, params } = await withMailbox();
  await duva.receive(await mail("plain"), { to: ["hermes@example.com"] });

  await duva.receive(await mail("reply"), { to: ["hermes@example.com"] });

  const { threads } = await inboxOf(hermes, mailbox.id);
  const [first, reply] = threads[0]!.messages;
  const { data } = await hermes.GET("/mailboxes/{mailbox}/changes", { params });
  expect(data?.changes.map(({ type, thread, message }) => ({ type, thread, message }))).toEqual([
    { type: "messageReceived", thread: threads[0]!.id, message: first!.id },
    { type: "messageReceived", thread: threads[0]!.id, message: reply!.id },
  ]);
});

test("a reply processed twice joins its thread once", async () => {
  const { duva, hermes, mailbox } = await withMailbox();
  await duva.receive(await mail("plain"), { to: ["hermes@example.com"] });

  await duva.receive(await mail("reply"), { to: ["hermes@example.com"] }, { invocations: 2 });

  const { summaries, threads } = await inboxOf(hermes, mailbox.id);
  expect(summaries.map(({ messages }) => messages)).toEqual([2]);
  expect(threads[0]!.messages).toHaveLength(2);
});

test("replies arriving at the same time all join the thread", async () => {
  const { duva, hermes, mailbox } = await withMailbox();
  await duva.receive(await mail("plain"), { to: ["hermes@example.com"] });

  await Promise.all(["reply", "references-only", "reply", "references-only"].map(async (name) => duva.receive(await mail(name), { to: ["hermes@example.com"] })));

  const { summaries, threads } = await inboxOf(hermes, mailbox.id);
  expect(summaries.map(({ messages }) => messages)).toEqual([5]);
  expect(threads[0]!.messages).toHaveLength(5);
});
