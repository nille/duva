import { expect, test } from "vitest";
import { type DuvaOptions, startDuva } from "./harness.ts";

const day = 24 * 60 * 60 * 1000;
// The tests that receive several messages and empty Trash take seconds when the full suite loads DynamoDB Local, so they have room.
const budget = { timeout: 45_000 };
/** The time `days` days from now, when the test runs the eraser. */
const inDays = (days: number) => new Date(Date.now() + days * day);

/** A message from Ada to the addresses, with the subject, which starts its own thread unless it answers another. */
const note = (subject: string, { to = "grace@example.com", answers }: { to?: string; answers?: string } = {}) =>
  [
    "From: Ada Lovelace <ada@example.org>",
    `To: ${to}`,
    `Subject: ${subject}`,
    "Date: Sun, 04 Oct 2026 09:00:00 +0200",
    `Message-ID: <${subject.replaceAll(" ", "-")}@example.org>`,
    ...(answers === undefined ? [] : [`In-Reply-To: <${answers.replaceAll(" ", "-")}@example.org>`]),
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    `Hej. ${subject}.`,
  ].join("\r\n");

/**
 * A deployment where the human Grace has a personal mailbox at grace@example.com, which the admin
 * Ada created, and Linus is another human.
 */
async function withPersonalMailbox(options: DuvaOptions = {}) {
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org", "linus@example.org"], ...options });
  const ada = duva.signIn("ada@example.org");
  const grace = duva.signIn("grace@example.org");
  const { data: me } = await grace.GET("/whoami");
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: me!.id, address: "grace@example.com" } });
  const params = { path: { mailbox: mailbox!.id } };
  /** Receives the message, and answers its thread's ID. */
  const receive = async (raw: string, options?: Parameters<typeof duva.receive>[2]) => {
    await duva.receive(raw, { to: ["grace@example.com"] }, options);
    return (await changes()).findLast((change) => change.type === "messageReceived")!.thread;
  };
  const changes = async () =>
    (await grace.GET("/mailboxes/{mailbox}/changes", { params: { ...params, query: { spam: true } } })).data!.changes as { type: string; thread: string }[];
  const label = (threads: string[], change: { add?: string[]; remove?: string[] }) => grace.POST("/mailboxes/{mailbox}/threads/labels", { params, body: { threads, ...change } });
  /** The IDs of the threads with the label, newest first. */
  const listed = async (label: string) => (await grace.GET("/mailboxes/{mailbox}/threads", { params: { ...params, query: { label } } })).data!.threads.map(({ id }) => id);
  const read = (thread: string) => grace.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { ...params.path, thread } } });
  const emptyTrash = () => grace.POST("/mailboxes/{mailbox}/trash/empty", { params });
  return { duva, ada, grace, graceId: me!.id, mailbox: mailbox!, params, receive, changes, label, listed, read, emptyTrash };
}

/** Whether the mail bucket keeps a raw message with the text. */
const keeps = (duva: Awaited<ReturnType<typeof startDuva>>, text: string) => duva.stored().some((raw) => raw.includes(text));

test("a thread that got Trash more than 30 days earlier is erased when the eraser runs", async () => {
  const { duva, receive, label, listed, read } = await withPersonalMailbox();
  const thread = await receive(note("Kvitto"));
  await label([thread], { add: ["trash"] });

  await duva.erase(inDays(31));

  expect(await listed("trash")).toEqual([]);
  expect((await read(thread)).response.status).toBe(404);
});

test("a thread that got Trash less than 30 days earlier is kept", async () => {
  const { duva, receive, label, listed, read } = await withPersonalMailbox();
  const thread = await receive(note("Kvitto"));
  await label([thread], { add: ["trash"] });

  await duva.erase(inDays(29));

  expect(await listed("trash")).toEqual([thread]);
  expect((await read(thread)).data?.messages).toHaveLength(1);
});

test("spam is erased 30 days after it arrived", async () => {
  const { duva, receive, listed, read } = await withPersonalMailbox();
  const kept = await receive(note("Kvitto"));
  const thread = await receive(note("Vinst"), { verdicts: { spam: "FAIL" } });

  await duva.erase(inDays(29));
  expect(await listed("spam")).toEqual([thread]);

  await duva.erase(inDays(31));
  expect(await listed("spam")).toEqual([]);
  expect((await read(thread)).response.status).toBe(404);
  expect(await listed("inbox")).toEqual([kept]);
});

test("a thread marked as spam is erased 30 days after it got the label", async () => {
  const { duva, receive, label, listed } = await withPersonalMailbox();
  const thread = await receive(note("Kvitto"));
  await label([thread], { add: ["spam"] });

  await duva.erase(inDays(31));

  expect(await listed("spam")).toEqual([]);
});

test("restoring a thread from Trash, or marking it not spam, before 30 days have passed keeps it", async () => {
  const { duva, receive, label, listed } = await withPersonalMailbox();
  const restored = await receive(note("Kvitto"));
  const notSpam = await receive(note("Faktura"), { verdicts: { spam: "FAIL" } });
  await label([restored], { add: ["trash"] });
  await label([restored], { remove: ["trash"] });
  await label([notSpam], { remove: ["spam"] });

  await duva.erase(inDays(31));

  expect(await listed("inbox")).toEqual([notSpam, restored]);
});

test("a thread in Spam and Trash is erased 30 days after the first of them", async () => {
  const { duva, receive, label, listed } = await withPersonalMailbox();
  const thread = await receive(note("Vinst"), { verdicts: { spam: "FAIL" } });
  await label([thread], { add: ["trash"] });
  await label([thread], { remove: ["trash"] });
  await label([thread], { add: ["trash"] });

  await duva.erase(inDays(31));

  expect(await listed("trash")).toEqual([]);
  expect(await listed("spam")).toEqual([]);
});

test("the eraser's change names no actor and keeps none of the thread's content", async () => {
  const { duva, receive, label, changes } = await withPersonalMailbox();
  const thread = await receive(note("Kvitto"));
  await label([thread], { add: ["trash"] });

  await duva.erase(inDays(31));

  expect((await changes()).at(-1)).toEqual({ position: 3, at: expect.any(String), type: "threadErased", thread });
});

test("the owner empties Trash: every thread in it is erased at once, and the rest are kept", budget, async () => {
  const { graceId, receive, label, listed, read, changes, emptyTrash } = await withPersonalMailbox();
  const kept = await receive(note("Kvitto"));
  const archived = await receive(note("Faktura"));
  const spam = await receive(note("Vinst"), { verdicts: { spam: "FAIL" } });
  const [first, second] = [await receive(note("Möte")), await receive(note("Lunch"))];
  await label([archived], { remove: ["inbox"] });
  await label([first, second], { add: ["trash"] });

  const { data, response } = await emptyTrash();

  expect(response.status).toBe(202);
  expect(data).toEqual({ emptiedAt: expect.any(String) });
  expect(await listed("trash")).toEqual([]);
  expect((await read(first)).response.status).toBe(404);
  expect((await read(second)).response.status).toBe(404);
  expect(await listed("inbox")).toEqual([kept]);
  expect(await listed("spam")).toEqual([spam]);
  expect((await read(archived)).data?.messages).toHaveLength(1);
  const erased = (await changes()).filter(({ type }) => type === "threadErased");
  expect(erased).toEqual(
    expect.arrayContaining([
      { position: expect.any(Number), at: expect.any(String), actor: graceId, type: "threadErased", thread: first },
      { position: expect.any(Number), at: expect.any(String), actor: graceId, type: "threadErased", thread: second },
    ]),
  );
  expect(erased).toHaveLength(2);
});

test("emptying an empty Trash erases nothing", async () => {
  const { receive, changes, emptyTrash } = await withPersonalMailbox();
  await receive(note("Kvitto"));

  const { response } = await emptyTrash();

  expect(response.status).toBe(202);
  expect((await changes()).map(({ type }) => type)).toEqual(["messageReceived"]);
});

test("only the mailbox's owner can empty its Trash: an admin and another human get 403", async () => {
  const { duva, ada, params, receive, label, listed } = await withPersonalMailbox();
  const thread = await receive(note("Kvitto"));
  await label([thread], { add: ["trash"] });
  const linus = duva.signIn("linus@example.org");

  const byAdmin = await ada.POST("/mailboxes/{mailbox}/trash/empty", { params });
  const byOther = await linus.POST("/mailboxes/{mailbox}/trash/empty", { params });

  expect(byAdmin.response.status).toBe(403);
  expect(byOther.response.status).toBe(403);
  expect(await listed("trash")).toEqual([thread]);
});

test("emptying the Trash of a mailbox that doesn't exist gets 404", async () => {
  const { grace } = await withPersonalMailbox();

  const { response } = await grace.POST("/mailboxes/{mailbox}/trash/empty", { params: { path: { mailbox: "nope" } } });

  expect(response.status).toBe(404);
});

test("an agent's sponsor empties its Trash, under their own name", async () => {
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org" });
  const ada = duva.signIn("ada@example.org");
  const { data: me } = await ada.GET("/whoami");
  const { data: created } = await ada.POST("/agents", { body: { name: "Hermes" } });
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: created!.agent.id, address: "hermes@example.com" } });
  const params = { path: { mailbox: mailbox!.id } };
  await duva.receive(note("Kvitto", { to: "hermes@example.com" }), { to: ["hermes@example.com"] });
  const { data: inbox } = await ada.GET("/mailboxes/{mailbox}/threads", { params });
  const thread = inbox!.threads[0]!.id;
  await ada.POST("/mailboxes/{mailbox}/threads/labels", { params, body: { threads: [thread], add: ["trash"] } });

  const { response } = await ada.POST("/mailboxes/{mailbox}/trash/empty", { params });

  expect(response.status).toBe(202);
  const { data: changes } = await ada.GET("/mailboxes/{mailbox}/changes", { params });
  expect(changes!.changes.at(-1)).toMatchObject({ type: "threadErased", thread, actor: me!.id });
});

test("erased mail can't be found: a reply to it starts a new thread in the Inbox", async () => {
  const { receive, label, listed, read, emptyTrash } = await withPersonalMailbox();
  const thread = await receive(note("Kvitto"));
  await label([thread], { add: ["trash"] });
  await emptyTrash();

  const reply = await receive(note("Re Kvitto", { answers: "Kvitto" }));

  expect(reply).not.toBe(thread);
  expect(await listed("inbox")).toEqual([reply]);
  expect((await read(reply)).data?.messages.map(({ subject }) => subject)).toEqual(["Re Kvitto"]);
});

test("erased mail leaves every listing and its labels' counts", async () => {
  const { grace, params, receive, label, emptyTrash } = await withPersonalMailbox();
  const { data: own } = await grace.POST("/mailboxes/{mailbox}/labels", { params, body: { name: "Kvitton" } });
  const thread = await receive(note("Kvitto"));
  await label([thread], { add: [own!.id] });
  await label([thread], { add: ["trash"] });
  await emptyTrash();

  const { data: labelled } = await grace.GET("/mailboxes/{mailbox}/threads", { params: { ...params, query: { label: own!.id } } });
  const { data: allMail } = await grace.GET("/mailboxes/{mailbox}/all-mail", { params });
  const { data: labels } = await grace.GET("/mailboxes/{mailbox}/labels", { params });
  expect(labelled!.threads).toEqual([]);
  expect(allMail!.threads).toEqual([]);
  expect(labels!.labels.map(({ unread }) => unread)).toEqual([0, 0, 0, 0]);
});

test("erasing a thread erases its raw messages, received and sent, and the drafts it sent", async () => {
  const { duva, grace, params, receive, label, read, emptyTrash } = await withPersonalMailbox();
  const thread = await receive(note("Kvitto"));
  const { data: received } = await read(thread);
  const { data: draft } = await grace.POST("/mailboxes/{mailbox}/drafts", { params, body: { answers: received!.messages[0]!.id, text: "Thanks for the receipt." } });
  await grace.POST("/mailboxes/{mailbox}/drafts/{draft}/send", { params: { path: { ...params.path, draft: draft!.id } } });
  expect((await read(thread)).data?.messages).toHaveLength(2);
  expect(keeps(duva, "Hej. Kvitto.")).toBe(true);
  expect(keeps(duva, "Thanks for the receipt.")).toBe(true);

  await label([thread], { add: ["trash"] });
  await emptyTrash();

  expect(keeps(duva, "Hej. Kvitto.")).toBe(false);
  expect(keeps(duva, "Thanks for the receipt.")).toBe(false);
  const { data: drafts } = await grace.GET("/mailboxes/{mailbox}/drafts", { params });
  expect(drafts!.drafts).toEqual([]);
});

test("mail delivered to two mailboxes keeps its raw message until both have erased it", budget, async () => {
  const { duva, ada, grace, params, label, read, emptyTrash } = await withPersonalMailbox();
  const linus = duva.signIn("linus@example.org");
  const { data: linusId } = await linus.GET("/whoami");
  const { data: other } = await ada.POST("/mailboxes", { body: { owner: linusId!.id, address: "linus@example.com" } });
  const linusParams = { path: { mailbox: other!.id } };
  await duva.receive(note("Möte", { to: "grace@example.com, linus@example.com" }), { to: ["grace@example.com", "linus@example.com"] });
  const graceThread = (await grace.GET("/mailboxes/{mailbox}/threads", { params })).data!.threads[0]!.id;
  const linusThread = (await linus.GET("/mailboxes/{mailbox}/threads", { params: linusParams })).data!.threads[0]!.id;

  await label([graceThread], { add: ["trash"] });
  await emptyTrash();

  expect((await read(graceThread)).response.status).toBe(404);
  const { data: linusReads } = await linus.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { ...linusParams.path, thread: linusThread } } });
  expect(linusReads!.messages.map(({ text }) => text)).toEqual(["Hej. Möte."]);
  expect(keeps(duva, "Hej. Möte.")).toBe(true);

  await linus.POST("/mailboxes/{mailbox}/threads/labels", { params: linusParams, body: { threads: [linusThread], add: ["trash"] } });
  await linus.POST("/mailboxes/{mailbox}/trash/empty", { params: linusParams });

  expect(keeps(duva, "Hej. Möte.")).toBe(false);
});

test("erasing again erases nothing more, and the change feed records each erasure once", async () => {
  const { duva, receive, label, changes, emptyTrash } = await withPersonalMailbox();
  const thread = await receive(note("Kvitto"));
  await label([thread], { add: ["trash"] });

  await emptyTrash();
  await emptyTrash();
  await duva.erase(inDays(31));

  expect((await changes()).filter(({ type }) => type === "threadErased")).toHaveLength(1);
});

test("an erasure that stops partway finishes on the next run", async () => {
  const { duva, receive, label, listed, read, changes } = await withPersonalMailbox();
  const thread = await receive(note("Kvitto"));
  await label([thread], { add: ["trash"] });

  await expect(duva.erase(inDays(31), { s3DeletesFail: true })).rejects.toThrow();
  await duva.erase(inDays(32));

  expect(await listed("trash")).toEqual([]);
  expect((await read(thread)).response.status).toBe(404);
  expect(keeps(duva, "Hej. Kvitto.")).toBe(false);
  expect((await changes()).filter(({ type }) => type === "threadErased")).toHaveLength(1);
});

test("mail that joins a thread in Trash is erased with it", async () => {
  const { duva, receive, label, listed, read } = await withPersonalMailbox();
  const thread = await receive(note("Kvitto"));
  await label([thread], { add: ["trash"] });
  await receive(note("Re Kvitto", { answers: "Kvitto" }));
  expect((await read(thread)).data?.messages).toHaveLength(2);

  await duva.erase(inDays(31));

  expect(await listed("trash")).toEqual([]);
  expect(keeps(duva, "Hej. Re Kvitto.")).toBe(false);
});

test("a Trash whose emptying failed is erased by the eraser's next daily run, under the name of whoever emptied it", async () => {
  const { duva, graceId, receive, label, listed, changes, emptyTrash } = await withPersonalMailbox({ emptyingLost: true });
  const thread = await receive(note("Kvitto"));
  await label([thread], { add: ["trash"] });
  await emptyTrash();
  expect(await listed("trash")).toEqual([thread]);

  await duva.erase(inDays(1));

  expect(await listed("trash")).toEqual([]);
  expect(keeps(duva, "Hej. Kvitto.")).toBe(false);
  expect((await changes()).at(-1)).toMatchObject({ type: "threadErased", thread, actor: graceId });
});

/**
 * A deployment where the admin Ada sponsors the agent Hermes, which owns hermes@example.com and
 * has a thread from Ada there. `answer` has Hermes reply in it and Ada approve the reply with her
 * edit, and answers the approval. Grace is another human.
 */
async function withAgentSend() {
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org"] });
  const ada = duva.signIn("ada@example.org");
  const { data: me } = await ada.GET("/whoami");
  const { data: created } = await ada.POST("/agents", { body: { name: "Hermes" } });
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: created!.agent.id, address: "hermes@example.com" } });
  const hermes = duva.withKey(created!.key);
  const params = { path: { mailbox: mailbox!.id } };
  /** Receives a message with the subject for Hermes, and answers its thread and message. */
  const receive = async (subject: string) => {
    await duva.receive(note(subject, { to: "hermes@example.com" }), { to: ["hermes@example.com"] });
    const { data: changes } = await ada.GET("/mailboxes/{mailbox}/changes", { params });
    const { thread } = changes!.changes.findLast((change) => change.type === "messageReceived") as { thread: string };
    const { data: read } = await ada.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { ...params.path, thread } } });
    return { thread, message: read!.messages[0]!.id };
  };
  /** Hermes drafts the text in reply to the message and asks to send it, and answers the draft and the approval it waits for. */
  const ask = async (message: string, text: string, draft?: string) => {
    const path = { ...params.path, draft: draft ?? (await hermes.POST("/mailboxes/{mailbox}/drafts", { params, body: { answers: message, text } })).data!.id };
    if (draft !== undefined) await hermes.PATCH("/mailboxes/{mailbox}/drafts/{draft}", { params: { path }, body: { text } });
    const { data: asked } = await hermes.POST("/mailboxes/{mailbox}/drafts/{draft}/send", { params: { path } });
    return { draft: path.draft, approval: asked!.send!.approval! };
  };
  const answer = async (message: string) => {
    const { approval } = await ask(message, "Ja, gärna.");
    await ada.POST("/approvals/{approval}/send", { params: { path: { approval } }, body: { text: "Ja, gärna. Hälsningar, Ada." } });
    return approval;
  };
  /** Ada puts the thread in Trash and empties it, as Hermes's sponsor. */
  const eraseNow = async (thread: string) => {
    await ada.POST("/mailboxes/{mailbox}/threads/labels", { params, body: { threads: [thread], add: ["trash"] } });
    await ada.POST("/mailboxes/{mailbox}/trash/empty", { params });
  };
  const decisions = async () => (await ada.GET("/mailboxes/{mailbox}/changes", { params })).data!.changes.filter((change) => change.type === "approvalDecided");
  /** Whether the approval can still be read: deciding it again is refused as decided, rather than as missing. */
  const kept = async (approval: string) => (await ada.POST("/approvals/{approval}/send", { params: { path: { approval } } })).response.status === 409;
  const erasesApprovals = (on: boolean) => ada.PATCH("/organization/settings", { body: { erasureErasesApprovals: on } });
  return { duva, ada, adaId: me!.id, hermes, params, receive, ask, answer, eraseNow, decisions, kept, erasesApprovals };
}

test("by default an erased thread keeps its approval records, and their decisions in the feed keep the approver's edit", async () => {
  const { receive, answer, eraseNow, decisions, kept } = await withAgentSend();
  const { thread, message } = await receive("Möte");
  const approval = await answer(message);

  await eraseNow(thread);

  expect(await kept(approval)).toBe(true);
  expect(await decisions()).toMatchObject([{ approval, decision: "approved", edits: { text: "Ja, gärna. Hälsningar, Ada." } }]);
});

test("with erasure of approval records on, emptying Trash erases the approval records of the agent's sends in it, and their decisions keep only who decided what", async () => {
  const { adaId, receive, answer, eraseNow, decisions, kept, erasesApprovals } = await withAgentSend();
  const { thread, message } = await receive("Möte");
  const approval = await answer(message);
  await erasesApprovals(true);

  await eraseNow(thread);

  expect(await kept(approval)).toBe(false);
  const [decided] = await decisions();
  expect(decided).toEqual({ position: expect.any(Number), at: expect.any(String), actor: adaId, type: "approvalDecided", draft: expect.any(String), approval, decision: "approved" });
});

test("with erasure of approval records on, the eraser's daily run erases them too", async () => {
  const { duva, ada, params, receive, answer, decisions, kept, erasesApprovals } = await withAgentSend();
  const { thread, message } = await receive("Möte");
  const approval = await answer(message);
  await erasesApprovals(true);
  await ada.POST("/mailboxes/{mailbox}/threads/labels", { params, body: { threads: [thread], add: ["trash"] } });

  await duva.erase(inDays(31));

  expect(await kept(approval)).toBe(false);
  expect((await decisions())[0]).not.toHaveProperty("edits");
});

test("with erasure of approval records on, every approval a sent draft asked for is erased, the rejected one's note too", async () => {
  const { ada, receive, ask, eraseNow, decisions, kept, erasesApprovals } = await withAgentSend();
  const { thread, message } = await receive("Möte");
  const first = await ask(message, "Ja.");
  await ada.POST("/approvals/{approval}/reject", { params: { path: { approval: first.approval } }, body: { note: "Skriv lite mer." } });
  const second = await ask(message, "Ja, gärna.", first.draft);
  await ada.POST("/approvals/{approval}/send", { params: { path: { approval: second.approval } } });
  await erasesApprovals(true);

  await eraseNow(thread);

  expect(await kept(first.approval)).toBe(false);
  expect(await kept(second.approval)).toBe(false);
  const left = await decisions();
  expect(left.map(({ decision }) => decision)).toEqual(["rejected", "approved"]);
  for (const decided of left) expect(Object.keys(decided).sort()).toEqual(["actor", "approval", "at", "decision", "draft", "position", "type"]);
});

test("turning erasure of approval records on doesn't reach back, and turning it off again keeps the next ones", budget, async () => {
  const { receive, answer, eraseNow, decisions, kept, erasesApprovals } = await withAgentSend();
  const before = await receive("Före");
  const keptBefore = await answer(before.message);
  await eraseNow(before.thread);
  await erasesApprovals(true);
  const during = await receive("Under");
  const erased = await answer(during.message);
  await eraseNow(during.thread);
  await erasesApprovals(false);
  const after = await receive("Efter");
  const keptAfter = await answer(after.message);

  await eraseNow(after.thread);

  expect([await kept(keptBefore), await kept(erased), await kept(keptAfter)]).toEqual([true, false, true]);
  expect((await decisions()).map((decided) => decided.edits?.text)).toEqual(["Ja, gärna. Hälsningar, Ada.", undefined, "Ja, gärna. Hälsningar, Ada."]);
});

test("an approval record of a thread still in the mailbox stays, the setting on or not", async () => {
  const { receive, answer, eraseNow, kept, erasesApprovals } = await withAgentSend();
  const erased = await receive("Kvitto");
  const other = await receive("Möte");
  await answer(erased.message);
  const approval = await answer(other.message);
  await erasesApprovals(true);

  await eraseNow(erased.thread);

  expect(await kept(approval)).toBe(true);
});
