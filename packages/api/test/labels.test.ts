import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { startDuva } from "./harness.ts";

/** A fixture in test/mail, as the sender's server sends it. */
const mail = (name: string) => readFile(new URL(`mail/${name}.eml`, import.meta.url));

/** A message from Ada to Grace that starts its own thread, with the subject. */
const note = (subject: string) =>
  [
    "From: Ada Lovelace <ada@example.org>",
    "To: Grace <grace@example.com>",
    `Subject: ${subject}`,
    "Date: Sun, 04 Oct 2026 09:00:00 +0200",
    `Message-ID: <${subject.replaceAll(" ", "-")}@example.org>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Hej Grace.",
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
  /** Receives the message, and answers its thread's ID. */
  const receive = async (raw: string | Uint8Array, options?: Parameters<typeof duva.receive>[2]) => {
    await duva.receive(raw, { to: ["grace@example.com"] }, options);
    const { data } = await grace.GET("/mailboxes/{mailbox}/changes", { params: { ...params, query: { spam: true } } });
    const arrival = data!.changes.findLast((change) => change.type === "messageReceived");
    return (arrival as { thread: string }).thread;
  };
  const label = async (threads: string[], change: { add?: string[]; remove?: string[] }) =>
    grace.POST("/mailboxes/{mailbox}/threads/labels", { params, body: { threads, ...change } });
  /** The IDs of the threads with the label, newest first. */
  const listed = async (label: string) => (await grace.GET("/mailboxes/{mailbox}/threads", { params: { ...params, query: { label } } })).data!.threads.map(({ id }) => id);
  const allMail = async () => (await grace.GET("/mailboxes/{mailbox}/all-mail", { params })).data!.threads.map(({ id }) => id);
  return { duva, ada, grace, graceId: me!.id, mailbox: mailbox!, params, receive, label, listed, allMail };
}

test("archiving a thread removes it from the Inbox and keeps it, and moving it back to the Inbox lists it there again", async () => {
  const { receive, label, listed, allMail } = await withPersonalMailbox();
  const thread = await receive(note("Kvitto"));

  const { data: archived, response } = await label([thread], { remove: ["inbox"] });

  expect(response.status).toBe(200);
  expect(archived?.threads).toMatchObject([{ id: thread, labels: [] }]);
  expect(await listed("inbox")).toEqual([]);
  expect(await allMail()).toEqual([thread]);

  const { data: back } = await label([thread], { add: ["inbox"] });

  expect(back?.threads).toMatchObject([{ id: thread, labels: ["inbox"] }]);
  expect(await listed("inbox")).toEqual([thread]);
});

test("marking a thread as spam moves it from the Inbox to Spam, and not spam moves it back", async () => {
  const { receive, label, listed, allMail } = await withPersonalMailbox();
  const thread = await receive(note("Erbjudande"));

  const { data: marked } = await label([thread], { add: ["spam"] });

  expect(marked?.threads).toMatchObject([{ id: thread, labels: ["spam"] }]);
  expect({ inbox: await listed("inbox"), spam: await listed("spam"), all: await allMail() }).toEqual({ inbox: [], spam: [thread], all: [] });

  const { data: rescued } = await label([thread], { remove: ["spam"] });

  expect(rescued?.threads).toMatchObject([{ id: thread, labels: ["inbox"] }]);
  expect({ inbox: await listed("inbox"), spam: await listed("spam"), all: await allMail() }).toEqual({ inbox: [thread], spam: [], all: [thread] });
});

test("moving a thread to Trash takes it out of the Inbox, and restoring it puts it back", async () => {
  const { receive, label, listed, allMail } = await withPersonalMailbox();
  const thread = await receive(note("Gammalt"));

  const { data: trashed } = await label([thread], { add: ["trash"] });

  expect(trashed?.threads).toMatchObject([{ id: thread, labels: ["trash"] }]);
  expect({ inbox: await listed("inbox"), trash: await listed("trash"), all: await allMail() }).toEqual({ inbox: [], trash: [thread], all: [] });

  const { data: restored } = await label([thread], { remove: ["trash"] });

  expect(restored?.threads).toMatchObject([{ id: thread, labels: ["inbox"] }]);
  expect({ inbox: await listed("inbox"), trash: await listed("trash"), all: await allMail() }).toEqual({ inbox: [thread], trash: [], all: [thread] });
});

test("restoring a thread that is in Spam too leaves it out of the Inbox, and moving it to the Inbox takes it out of both", async () => {
  const { receive, label, listed } = await withPersonalMailbox();
  const thread = await receive(note("Båda"));
  await label([thread], { add: ["spam", "trash"] });

  const { data: restored } = await label([thread], { remove: ["trash"] });

  expect(restored?.threads).toMatchObject([{ labels: ["spam"] }]);
  expect(await listed("inbox")).toEqual([]);

  await label([thread], { add: ["trash"] });
  const { data: moved } = await label([thread], { add: ["inbox"] });

  expect(moved?.threads).toMatchObject([{ labels: ["inbox"] }]);
  expect({ spam: await listed("spam"), trash: await listed("trash"), inbox: await listed("inbox") }).toEqual({ spam: [], trash: [], inbox: [thread] });
});

test("restoring an archived thread that isn't in Trash leaves it archived", async () => {
  const { receive, label, listed } = await withPersonalMailbox();
  const thread = await receive(note("Arkiv"));
  await label([thread], { remove: ["inbox"] });

  const { data } = await label([thread], { remove: ["trash"] });

  expect(data?.threads).toMatchObject([{ labels: [] }]);
  expect(await listed("inbox")).toEqual([]);
});

test("All mail lists every thread but those in Spam and Trash, archived ones too, newest first", async () => {
  const { receive, label, allMail } = await withPersonalMailbox();
  const archived = await receive(note("Ett"));
  const kept = await receive(note("Två"));
  const trashed = await receive(note("Tre"));
  const spam = await receive(note("Fyra"), { verdicts: { spam: "FAIL" } });
  await label([archived], { remove: ["inbox"] });
  await label([trashed], { add: ["trash"] });

  expect(await allMail()).toEqual([kept, archived]);
  expect(spam).toEqual(expect.any(String));
});

test("All mail is listed a page at a time, and a page skips threads in Trash without coming up short", async () => {
  const { grace, params, receive, label } = await withPersonalMailbox();
  const threads = [];
  for (const subject of ["1", "2", "3", "4", "5"]) threads.push(await receive(note(`Nummer ${subject}`)));
  await label([threads[3]!, threads[2]!], { add: ["trash"] });

  const { data: first } = await grace.GET("/mailboxes/{mailbox}/all-mail", { params: { ...params, query: { limit: 2 } } });
  const { data: second } = await grace.GET("/mailboxes/{mailbox}/all-mail", { params: { ...params, query: { limit: 2, after: first!.next } } });

  expect(first?.threads.map(({ id }) => id)).toEqual([threads[4], threads[1]]);
  expect(second?.threads.map(({ id }) => id)).toEqual([threads[0]]);
  expect(second?.next).toBeUndefined();
});

test("new mail in an archived thread brings it back to the Inbox, but not in a thread in Trash or Spam", async () => {
  const { grace, params, receive, label, listed } = await withPersonalMailbox();
  const archived = await receive(await mail("plain"));
  await label([archived], { remove: ["inbox"] });

  await receive(await mail("reply"));

  expect(await listed("inbox")).toEqual([archived]);

  await label([archived], { add: ["trash"] });
  const answering = (await mail("reply")).toString().replace("Message-ID: <", "Message-ID: <again-");
  await receive(answering);

  const { data: trash } = await grace.GET("/mailboxes/{mailbox}/threads", { params: { ...params, query: { label: "trash" } } });
  expect(trash?.threads).toMatchObject([{ id: archived, labels: ["trash"], messages: 3 }]);
  expect(await listed("inbox")).not.toContain(archived);
});

test("labels are added and removed on several threads in one request, each change in the change feed under the human", async () => {
  const { grace, graceId, params, receive, label } = await withPersonalMailbox();
  const first = await receive(note("Ett"));
  const second = await receive(note("Två"));
  await label([second], { remove: ["inbox"] });

  const { data } = await label([first, second], { remove: ["inbox"] });

  expect(data?.threads).toMatchObject([
    { id: first, labels: [] },
    { id: second, labels: [] },
  ]);
  const { data: feed } = await grace.GET("/mailboxes/{mailbox}/changes", { params });
  expect(feed?.changes.filter(({ type }) => type === "threadLabelsChanged")).toEqual([
    { position: expect.any(Number), at: expect.any(String), actor: graceId, type: "threadLabelsChanged", thread: second, added: [], removed: ["inbox"] },
    { position: expect.any(Number), at: expect.any(String), actor: graceId, type: "threadLabelsChanged", thread: first, added: [], removed: ["inbox"] },
  ]);
});

test("a human creates a label, adds it to threads and lists them, and labels list with how many unread threads each has", async () => {
  const { grace, params, receive, label, listed } = await withPersonalMailbox();
  const first = await receive(note("Kvitto ett"));
  const second = await receive(note("Kvitto två"));
  await grace.POST("/mailboxes/{mailbox}/threads/read", { params, body: { threads: [first] } });

  const { data: receipts, response } = await grace.POST("/mailboxes/{mailbox}/labels", { params, body: { name: "Kvitton" } });

  expect(response.status).toBe(201);
  expect(receipts).toEqual({ id: expect.any(String), name: "Kvitton", builtIn: false, unread: 0 });

  const { data: labelled } = await label([first, second], { add: [receipts!.id] });

  expect(labelled?.threads).toMatchObject([{ labels: ["inbox", receipts!.id] }, { labels: ["inbox", receipts!.id] }]);
  expect(await listed(receipts!.id)).toEqual([second, first]);
  const { data: labels } = await grace.GET("/mailboxes/{mailbox}/labels", { params });
  expect(labels?.labels).toEqual([
    { id: "inbox", name: "Inbox", builtIn: true, unread: 1 },
    { id: "feed", name: "Feed", builtIn: true, unread: 0 },
    { id: "paperTrail", name: "Paper Trail", builtIn: true, unread: 0 },
    { id: "spam", name: "Spam", builtIn: true, unread: 0 },
    { id: "trash", name: "Trash", builtIn: true, unread: 0 },
    { id: receipts!.id, name: "Kvitton", builtIn: false, unread: 1 },
  ]);
});

test("a thread in Trash is left out of the human's own labels and their unread counts, and still has them when restored", async () => {
  const { grace, params, receive, label, listed } = await withPersonalMailbox();
  const thread = await receive(note("Resa"));
  const { data: travel } = await grace.POST("/mailboxes/{mailbox}/labels", { params, body: { name: "Resor" } });
  await label([thread], { add: [travel!.id] });

  await label([thread], { add: ["trash"] });

  expect(await listed(travel!.id)).toEqual([]);
  const { data: labels } = await grace.GET("/mailboxes/{mailbox}/labels", { params });
  expect(labels?.labels.map(({ name, unread }) => ({ name, unread }))).toEqual([
    { name: "Inbox", unread: 0 },
    { name: "Feed", unread: 0 },
    { name: "Paper Trail", unread: 0 },
    { name: "Spam", unread: 0 },
    { name: "Trash", unread: 1 },
    { name: "Resor", unread: 0 },
  ]);

  await label([thread], { remove: ["trash"] });

  expect(await listed(travel!.id)).toEqual([thread]);
});

test("the human's own labels are listed by name, whatever its case, after the built-in ones", async () => {
  const { grace, params } = await withPersonalMailbox();
  for (const name of ["Resor", "Familj", "arkiv"]) await grace.POST("/mailboxes/{mailbox}/labels", { params, body: { name } });

  const { data } = await grace.GET("/mailboxes/{mailbox}/labels", { params });

  expect(data?.labels.map(({ name }) => name)).toEqual(["Inbox", "Feed", "Paper Trail", "Spam", "Trash", "arkiv", "Familj", "Resor"]);
});

test("a label's name is unique in the mailbox in any case, and can't be a built-in label's", async () => {
  const { grace, params } = await withPersonalMailbox();
  await grace.POST("/mailboxes/{mailbox}/labels", { params, body: { name: "Kvitton" } });

  const statuses = [];
  for (const name of ["kvitton", "Inbox", "trash", "All mail"]) statuses.push((await grace.POST("/mailboxes/{mailbox}/labels", { params, body: { name } })).response.status);

  expect(statuses).toEqual([409, 409, 409, 409]);
  const { response: empty } = await grace.POST("/mailboxes/{mailbox}/labels", { params, body: { name: "  " } });
  expect(empty.status).toBe(400);
});

test("renaming a label keeps it on its threads, and frees its old name", async () => {
  const { grace, params, receive, label } = await withPersonalMailbox();
  const thread = await receive(note("Kvitto"));
  const { data: created } = await grace.POST("/mailboxes/{mailbox}/labels", { params, body: { name: "Kvitton" } });
  await label([thread], { add: [created!.id] });
  const path = { path: { ...params.path, label: created!.id } };

  const { data: renamed } = await grace.PATCH("/mailboxes/{mailbox}/labels/{label}", { params: path, body: { name: "Ekonomi" } });

  expect(renamed).toEqual({ id: created!.id, name: "Ekonomi", builtIn: false, unread: 1 });
  const { data: labels } = await grace.GET("/mailboxes/{mailbox}/labels", { params });
  expect(labels?.labels.at(-1)).toEqual(renamed);
  expect((await grace.POST("/mailboxes/{mailbox}/labels", { params, body: { name: "Kvitton" } })).response.status).toBe(201);
  expect((await grace.PATCH("/mailboxes/{mailbox}/labels/{label}", { params: path, body: { name: "kvitton" } })).response.status).toBe(409);
  expect((await grace.PATCH("/mailboxes/{mailbox}/labels/{label}", { params: path, body: { name: "EKONOMI" } })).data?.name).toBe("EKONOMI");
});

test("deleting a label removes it from its threads, those in Trash too, and the threads stay", async () => {
  const { grace, params, receive, label, listed } = await withPersonalMailbox();
  const kept = await receive(note("Ett"));
  const trashed = await receive(note("Två"));
  const { data: created } = await grace.POST("/mailboxes/{mailbox}/labels", { params, body: { name: "Kvitton" } });
  await label([kept, trashed], { add: [created!.id] });
  await label([trashed], { add: ["trash"] });

  const { data: deleted, response } = await grace.DELETE("/mailboxes/{mailbox}/labels/{label}", { params: { path: { ...params.path, label: created!.id } } });

  expect(response.status).toBe(200);
  expect(deleted).toMatchObject({ id: created!.id, name: "Kvitton" });
  expect(await listed("inbox")).toEqual([kept]);
  await label([trashed], { remove: ["trash"] });
  const { data: inbox } = await grace.GET("/mailboxes/{mailbox}/threads", { params });
  expect(inbox?.threads.map(({ id, labels }) => ({ id, labels }))).toEqual([
    { id: trashed, labels: ["inbox"] },
    { id: kept, labels: ["inbox"] },
  ]);
  const { data: labels } = await grace.GET("/mailboxes/{mailbox}/labels", { params });
  expect(labels?.labels.map(({ id }) => id)).toEqual(["inbox", "feed", "paperTrail", "spam", "trash"]);
  expect((await grace.POST("/mailboxes/{mailbox}/labels", { params, body: { name: "Kvitton" } })).response.status).toBe(201);
});

test("creating, renaming and deleting a label are each in the change feed under the human", async () => {
  const { grace, graceId, params } = await withPersonalMailbox();
  const { data: created } = await grace.POST("/mailboxes/{mailbox}/labels", { params, body: { name: "Kvitton" } });
  const path = { path: { ...params.path, label: created!.id } };
  await grace.PATCH("/mailboxes/{mailbox}/labels/{label}", { params: path, body: { name: "Ekonomi" } });
  await grace.DELETE("/mailboxes/{mailbox}/labels/{label}", { params: path });

  const { data } = await grace.GET("/mailboxes/{mailbox}/changes", { params: { ...params, query: { after: 1 } } });

  const base = { position: expect.any(Number), at: expect.any(String), actor: graceId };
  expect(data?.changes).toEqual([
    { ...base, type: "labelCreated", label: created!.id, name: "Kvitton" },
    { ...base, type: "labelRenamed", label: created!.id, name: "Ekonomi" },
    { ...base, type: "labelDeleted", label: created!.id },
  ]);
});

test("the built-in labels can't be renamed or deleted", async () => {
  const { grace, params } = await withPersonalMailbox();
  const statuses = [];
  for (const label of ["inbox", "spam", "trash"]) {
    const path = { path: { ...params.path, label } };
    statuses.push((await grace.PATCH("/mailboxes/{mailbox}/labels/{label}", { params: path, body: { name: "Annat" } })).response.status);
    statuses.push((await grace.DELETE("/mailboxes/{mailbox}/labels/{label}", { params: path })).response.status);
  }

  expect(statuses).toEqual([400, 400, 400, 400, 400, 400]);
  expect((await grace.DELETE("/mailboxes/{mailbox}/labels/{label}", { params: { path: { ...params.path, label: "nope" } } })).response.status).toBe(404);
});

test("labelling with a label the mailbox doesn't have, or one both added and removed, answers 400 and changes nothing", async () => {
  const { grace, params, receive, label, listed } = await withPersonalMailbox();
  const thread = await receive(note("Ett"));

  const statuses = [
    (await label([thread], { add: ["nope"] })).response.status,
    (await label([thread], { add: ["trash"], remove: ["trash"] })).response.status,
    (await label([thread], { add: ["inbox", "spam"] })).response.status,
    (await label([thread], {})).response.status,
  ];

  expect(statuses).toEqual([400, 400, 400, 400]);
  expect(await listed("inbox")).toEqual([thread]);
  const { data } = await grace.GET("/mailboxes/{mailbox}/changes", { params: { ...params, query: { after: 1 } } });
  expect(data?.changes.map(({ type }) => type)).toEqual(["messageReceived"]);
});

test("labelling a thread the mailbox doesn't have answers 404 and labels none of the others", async () => {
  const { receive, label, listed } = await withPersonalMailbox();
  const thread = await receive(note("Ett"));

  const { response } = await label([thread, "nope"], { remove: ["inbox"] });

  expect(response.status).toBe(404);
  expect(await listed("inbox")).toEqual([thread]);
});

test("a label change that changes nothing records nothing", async () => {
  const { grace, params, receive, label } = await withPersonalMailbox();
  const thread = await receive(note("Ett"));

  await label([thread], { add: ["inbox"] });

  const { data } = await grace.GET("/mailboxes/{mailbox}/changes", { params: { ...params, query: { after: 1 } } });
  expect(data?.changes.map(({ type }) => type)).toEqual(["messageReceived"]);
});

test("only those who can read the mailbox can label its threads and change its labels, so not even the admin who created it", async () => {
  const { ada, params, receive } = await withPersonalMailbox();
  const thread = await receive(note("Ett"));

  const statuses = [
    (await ada.POST("/mailboxes/{mailbox}/threads/labels", { params, body: { threads: [thread], add: ["trash"] } })).response.status,
    (await ada.GET("/mailboxes/{mailbox}/all-mail", { params })).response.status,
    (await ada.GET("/mailboxes/{mailbox}/labels", { params })).response.status,
    (await ada.POST("/mailboxes/{mailbox}/labels", { params, body: { name: "Mitt" } })).response.status,
  ];

  expect(statuses).toEqual([403, 403, 403, 403]);
});

test("an agent organizes its own mailbox, and its sponsor may too, under their own name", async () => {
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org" });
  const ada = duva.signIn("ada@example.org");
  const { data: me } = await ada.GET("/whoami");
  const { data: created } = await ada.POST("/agents", { body: { name: "Hermes" } });
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: created!.agent.id, address: "hermes@example.com" } });
  const params = { path: { mailbox: mailbox!.id } };
  await duva.receive(await mail("plain"), { to: ["hermes@example.com"] });
  const hermes = duva.withKey(created!.key);
  const [thread] = (await hermes.GET("/mailboxes/{mailbox}/threads", { params })).data!.threads;
  const { data: done } = await hermes.POST("/mailboxes/{mailbox}/labels", { params, body: { name: "Klart" } });

  await hermes.POST("/mailboxes/{mailbox}/threads/labels", { params, body: { threads: [thread!.id], add: [done!.id], remove: ["inbox"] } });
  await ada.POST("/mailboxes/{mailbox}/threads/labels", { params, body: { threads: [thread!.id], add: ["trash"] } });

  expect((await hermes.GET("/mailboxes/{mailbox}/threads", { params: { ...params, query: { label: "trash" } } })).data?.threads).toMatchObject([{ id: thread!.id, labels: [done!.id, "trash"] }]);
  const { data: changes } = await hermes.GET("/mailboxes/{mailbox}/changes", { params });
  expect(changes?.changes.filter(({ type }) => type === "threadLabelsChanged").map((change) => ("actor" in change ? change.actor : undefined))).toEqual([created!.agent.id, me!.id]);
});

test("restoring a thread while removing inbox too puts it back archived, as it was before Trash", async () => {
  const { receive, label, listed, allMail } = await withPersonalMailbox();
  const thread = await receive(note("Arkiv"));
  await label([thread], { remove: ["inbox"] });
  await label([thread], { add: ["trash"] });

  const { data } = await label([thread], { remove: ["trash", "inbox"] });

  expect(data?.threads).toMatchObject([{ labels: [] }]);
  expect({ inbox: await listed("inbox"), all: await allMail() }).toEqual({ inbox: [], all: [thread] });
});

test("mail judged spam on arrival is in Spam alone, and not spam moves it to the Inbox", async () => {
  const { receive, label, listed, allMail } = await withPersonalMailbox();
  const thread = await receive(note("Vinst"), { verdicts: { spam: "FAIL" } });

  expect({ spam: await listed("spam"), inbox: await listed("inbox"), all: await allMail() }).toEqual({ spam: [thread], inbox: [], all: [] });

  await label([thread], { remove: ["spam"] });

  expect({ spam: await listed("spam"), inbox: await listed("inbox"), all: await allMail() }).toEqual({ spam: [], inbox: [thread], all: [thread] });
});

test("a label's threads are listed a page at a time, and a page skips those in Trash without coming up short", async () => {
  const { grace, params, receive, label } = await withPersonalMailbox();
  const threads = [];
  for (const subject of ["1", "2", "3", "4"]) threads.push(await receive(note(`Nummer ${subject}`)));
  const { data: kept } = await grace.POST("/mailboxes/{mailbox}/labels", { params, body: { name: "Sparat" } });
  await label(threads, { add: [kept!.id] });
  await label([threads[2]!], { add: ["trash"] });
  const page = (after?: string) => grace.GET("/mailboxes/{mailbox}/threads", { params: { ...params, query: { label: kept!.id, limit: 2, after } } });

  const { data: first } = await page();
  const { data: second } = await page(first!.next);

  expect(first?.threads.map(({ id }) => id)).toEqual([threads[3], threads[1]]);
  expect(second?.threads.map(({ id }) => id)).toEqual([threads[0]]);
  expect(second?.next).toBeUndefined();
});

test("a thread the human sent in leaves Sent when it moves to Trash, and is back when restored", async () => {
  const { grace, params, label } = await withPersonalMailbox();
  const { data: draft } = await grace.POST("/mailboxes/{mailbox}/drafts", { params, body: { to: ["ada@example.org"], subject: "Lunch", text: "Lunch på fredag?" } });
  const draftParams = { path: { ...params.path, draft: draft!.id } };
  await grace.POST("/mailboxes/{mailbox}/drafts/{draft}/send", { params: draftParams });
  const { data: sent } = await grace.GET("/mailboxes/{mailbox}/drafts/{draft}", { params: draftParams });
  const thread = sent!.send!.thread!;
  const listedInSent = async () => (await grace.GET("/mailboxes/{mailbox}/sent", { params })).data!.threads.map(({ id }) => id);
  expect(await listedInSent()).toEqual([thread]);

  await label([thread], { add: ["trash"] });

  expect(await listedInSent()).toEqual([]);

  await label([thread], { remove: ["trash", "inbox"] });

  expect(await listedInSent()).toEqual([thread]);
});
