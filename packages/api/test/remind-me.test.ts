import { expect, test } from "vitest";
import { startDuva } from "./harness.ts";

/** A message from Ada to Grace that starts its own thread, with the subject, or answers the message with `answers`'s subject. */
const note = (subject: string, { answers }: { answers?: string } = {}) =>
  [
    "From: Ada Lovelace <ada@example.org>",
    "To: Grace <grace@example.com>",
    `Subject: ${answers === undefined ? subject : `Re: ${answers}`}`,
    "Date: Wed, 07 Oct 2026 09:00:00 +0200",
    `Message-ID: <${subject.replaceAll(" ", "-")}@example.org>`,
    ...(answers === undefined ? [] : [`In-Reply-To: <${answers.replaceAll(" ", "-")}@example.org>`]),
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Hej Grace.",
  ].join("\r\n");

// Wednesday 7 October 2026, 12:20 in Stockholm, which is two hours ahead of UTC until 25 October.
const wednesday = new Date("2026-10-07T10:20:00Z");
// Tests move the clock days ahead, and sessions last as long.
const tokensLast = 30 * 24 * 3600;
// The clock goes on from there while a test sets up, so a thread is set aside within the minute.
const setAt = expect.stringMatching(/^2026-10-07T10:20:\d\d\.000Z$/);

/** A deployment where the human Grace has a personal mailbox at grace@example.com, its Screener off, on Wednesday at 12:20 in Stockholm. */
async function withMailbox() {
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org"], accessTokenLifetime: tokensLast });
  await duva.clock(wednesday);
  const ada = duva.signIn("ada@example.org");
  const grace = duva.signIn("grace@example.org");
  const { data: me } = await grace.GET("/whoami");
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: me!.id, address: "grace@example.com" } });
  const params = { path: { mailbox: mailbox!.id } };
  await grace.PATCH("/mailboxes/{mailbox}/screener", { params, body: { on: false } });
  /** Receives the message, and answers its thread's ID. */
  const receive = async (raw: string) => {
    await duva.receive(raw, { to: ["grace@example.com"] });
    const { data } = await grace.GET("/mailboxes/{mailbox}/changes", { params });
    return (data!.changes.findLast((change) => change.type === "messageReceived") as { thread: string }).thread;
  };
  const remind = (threads: string[], when: { at?: string; preset?: "laterToday" | "tomorrowMorning" | "nextWeek"; timeZone?: string }) =>
    grace.POST("/mailboxes/{mailbox}/threads/remind", { params, body: { threads, ...when } });
  const inbox = async () => (await grace.GET("/mailboxes/{mailbox}/threads", { params })).data!.threads;
  const reminders = async () => (await grace.GET("/mailboxes/{mailbox}/reminders", { params })).data!.threads;
  const changes = async () => (await grace.GET("/mailboxes/{mailbox}/changes", { params })).data!.changes;
  return { duva, grace, graceId: me!.id, params, receive, remind, inbox, reminders, changes };
}

test("a thread set aside leaves the Inbox and waits in Remind me with its time, then comes back to the top of the Inbox, unread, marked Back", async () => {
  const { duva, grace, params, receive, remind, inbox, reminders } = await withMailbox();
  const older = await receive(note("Kvitto"));
  const newer = await receive(note("Lunch"));
  await grace.POST("/mailboxes/{mailbox}/threads/read", { params, body: { threads: [older] } });

  const { response, data } = await remind([older], { at: "2026-10-08T08:00:00+02:00" });

  expect(response.status).toBe(200);
  const reminder = { at: "2026-10-08T06:00:00.000Z", setAt };
  expect(data!.threads).toMatchObject([{ id: older, labels: [], reminder }]);
  expect((await inbox()).map(({ id }) => id)).toEqual([newer]);
  expect(await reminders()).toMatchObject([{ id: older, reminder }]);

  await duva.clock(new Date("2026-10-08T05:59:00Z"));
  expect((await inbox()).map(({ id }) => id)).toEqual([newer]);

  await duva.clock(new Date("2026-10-08T06:30:00Z"));

  const listed = await inbox();
  expect(listed.map(({ id }) => id)).toEqual([older, newer]);
  expect(listed[0]).toMatchObject({ labels: ["inbox"], unread: true, back: { at: "2026-10-08T06:00:00.000Z", setAsideAt: setAt } });
  expect(listed[0]!.reminder).toBeUndefined();
  expect(await reminders()).toEqual([]);
  const { data: thread } = await grace.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { ...params.path, thread: older } } });
  expect(thread).toMatchObject({ labels: ["inbox"], unread: true, back: { setAsideAt: setAt } });
});

test.each([
  ["laterToday", "2026-10-07T14:00:00.000Z"],
  ["tomorrowMorning", "2026-10-08T06:00:00.000Z"],
  ["nextWeek", "2026-10-12T06:00:00.000Z"],
] as const)("a reminder set for %s is counted in the human's time zone", async (preset, at) => {
  const { grace, receive, remind } = await withMailbox();
  await grace.PATCH("/preferences", { body: { timeZone: "Europe/Stockholm" } });
  const thread = await receive(note("Kvitto"));

  const { data } = await remind([thread], { preset });

  expect(data!.threads[0]!.reminder?.at).toBe(at);
});

test("a preset is counted in the time zone given, or in UTC for a human who chose none", async () => {
  const { receive, remind } = await withMailbox();
  const thread = await receive(note("Kvitto"));

  expect((await remind([thread], { preset: "tomorrowMorning" })).data!.threads[0]!.reminder?.at).toBe("2026-10-08T08:00:00.000Z");
  expect((await remind([thread], { preset: "tomorrowMorning", timeZone: "America/New_York" })).data!.threads[0]!.reminder?.at).toBe("2026-10-08T12:00:00.000Z");
});

test("later today crosses into tomorrow late in the evening", async () => {
  const { duva, receive, remind } = await withMailbox();
  await duva.clock(new Date("2026-10-07T22:10:00Z"));
  const thread = await receive(note("Kvitto"));

  const { data } = await remind([thread], { preset: "laterToday" });

  expect(data!.threads[0]!.reminder?.at).toBe("2026-10-08T02:00:00.000Z");
});

test("an agent's preset is counted in its sponsor's time zone, in the sponsor's mailbox", async () => {
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org", humans: ["linus@example.org"] });
  await duva.clock(wednesday);
  const ada = duva.signIn("ada@example.org");
  const linus = duva.signIn("linus@example.org");
  const { data: me } = await linus.GET("/whoami");
  await linus.PATCH("/preferences", { body: { timeZone: "Europe/Stockholm" } });
  const { data: created } = await linus.POST("/agents", { body: { name: "Hermes" } });
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: me!.id, address: "linus@example.com" } });
  await linus.PATCH("/agents/{agent}/settings", { params: { path: { agent: created!.agent.id } }, body: { sponsorAccess: "full" } });
  const params = { path: { mailbox: mailbox!.id } };
  await linus.PATCH("/mailboxes/{mailbox}/screener", { params, body: { on: false } });
  await duva.receive(note("Kvitto").replace("grace@example.com", "linus@example.com"), { to: ["linus@example.com"] });
  const hermes = duva.withKey(created!.key);
  const thread = (await hermes.GET("/mailboxes/{mailbox}/threads", { params })).data!.threads[0]!.id;

  const { data } = await hermes.POST("/mailboxes/{mailbox}/threads/remind", { params, body: { threads: [thread], preset: "tomorrowMorning" } });

  expect(data!.threads[0]!.reminder?.at).toBe("2026-10-08T06:00:00.000Z");
});

test("changing a thread's time keeps when it was set aside, and only the new time brings it back", async () => {
  const { duva, receive, remind, inbox, reminders } = await withMailbox();
  const thread = await receive(note("Kvitto"));
  await remind([thread], { at: "2026-10-08T06:00:00Z" });
  await duva.clock(new Date("2026-10-07T11:00:00Z"));

  const { data } = await remind([thread], { at: "2026-10-09T06:00:00Z" });

  expect(data!.threads[0]!.reminder).toEqual({ at: "2026-10-09T06:00:00.000Z", setAt });
  await duva.clock(new Date("2026-10-08T12:00:00Z"));
  expect(await inbox()).toEqual([]);
  expect((await reminders()).map(({ id }) => id)).toEqual([thread]);
  await duva.clock(new Date("2026-10-09T06:00:00Z"));
  expect((await inbox()).map(({ id }) => id)).toEqual([thread]);
});

test("Remind me lists the thread that comes back soonest first", async () => {
  const { receive, remind, reminders } = await withMailbox();
  const first = await receive(note("Kvitto"));
  const second = await receive(note("Lunch"));
  const third = await receive(note("Faktura"));

  await remind([first], { at: "2026-10-09T06:00:00Z" });
  await remind([second], { at: "2026-10-08T06:00:00Z" });
  await remind([third], { at: "2026-10-12T06:00:00Z" });

  expect((await reminders()).map(({ id }) => id)).toEqual([second, first, third]);
});

test("cancelling a reminder puts the thread back in the Inbox at its own place, as it was, without a Back mark", async () => {
  const { duva, grace, params, receive, remind, inbox, reminders } = await withMailbox();
  const older = await receive(note("Kvitto"));
  const newer = await receive(note("Lunch"));
  await grace.POST("/mailboxes/{mailbox}/threads/read", { params, body: { threads: [older] } });
  await remind([older], { at: "2026-10-08T06:00:00Z" });

  const { response, data } = await grace.POST("/mailboxes/{mailbox}/threads/remind/cancel", { params, body: { threads: [older, newer] } });

  expect(response.status).toBe(200);
  expect(data!.threads).toMatchObject([{ id: older, labels: ["inbox"], unread: false }, { id: newer, labels: ["inbox"] }]);
  expect(data!.threads[0]!.reminder).toBeUndefined();
  expect(data!.threads[0]!.back).toBeUndefined();
  expect((await inbox()).map(({ id }) => id)).toEqual([newer, older]);
  expect(await reminders()).toEqual([]);
  await duva.clock(new Date("2026-10-08T07:00:00Z"));
  expect((await inbox())[1]).toMatchObject({ id: older, unread: false });
  expect((await inbox())[1]!.back).toBeUndefined();
});

test("new mail in the thread brings it back early, and its time then passes without bringing it back again", async () => {
  const { duva, grace, params, receive, remind, inbox, reminders } = await withMailbox();
  const thread = await receive(note("Kvitto"));
  await remind([thread], { at: "2026-10-08T06:00:00Z" });
  await duva.clock(new Date("2026-10-07T15:00:00Z"));

  expect(await receive(note("Kvitto again", { answers: "Kvitto" }))).toBe(thread);

  expect(await inbox()).toMatchObject([{ id: thread, labels: ["inbox"], unread: true, back: { at: "2026-10-07T15:00:00.000Z", setAsideAt: setAt } }]);
  expect(await reminders()).toEqual([]);
  await grace.POST("/mailboxes/{mailbox}/threads/labels", { params, body: { threads: [thread], remove: ["inbox"] } });
  await duva.clock(new Date("2026-10-08T07:00:00Z"));
  expect(await inbox()).toEqual([]);
});

test("archiving a thread that came back takes away its Back mark", async () => {
  const { duva, grace, params, receive, remind } = await withMailbox();
  const thread = await receive(note("Kvitto"));
  await remind([thread], { at: "2026-10-08T06:00:00Z" });
  await duva.clock(new Date("2026-10-08T06:00:00Z"));

  const { data } = await grace.POST("/mailboxes/{mailbox}/threads/labels", { params, body: { threads: [thread], remove: ["inbox"] } });

  expect(data!.threads[0]!.back).toBeUndefined();
});

test("moving a thread set aside to Trash ends its reminder, so it stays in Trash", async () => {
  const { duva, grace, params, receive, remind, inbox, reminders } = await withMailbox();
  const thread = await receive(note("Kvitto"));
  await remind([thread], { at: "2026-10-08T06:00:00Z" });

  const { data } = await grace.POST("/mailboxes/{mailbox}/threads/labels", { params, body: { threads: [thread], add: ["trash"] } });

  expect(data!.threads[0]!.reminder).toBeUndefined();
  expect(await reminders()).toEqual([]);
  await duva.clock(new Date("2026-10-08T07:00:00Z"));
  expect(await inbox()).toEqual([]);
  expect((await grace.GET("/mailboxes/{mailbox}/threads", { params: { ...params, query: { label: "trash" } } })).data!.threads.map(({ id }) => id)).toEqual([thread]);
});

test("setting aside, coming back and cancelling are recorded in the change feed", async () => {
  const { duva, grace, graceId, params, receive, remind, changes } = await withMailbox();
  const thread = await receive(note("Kvitto"));
  const other = await receive(note("Lunch"));
  const start = (await changes()).length;

  await remind([thread, other], { at: "2026-10-08T06:00:00Z" });
  await grace.POST("/mailboxes/{mailbox}/threads/remind/cancel", { params, body: { threads: [other] } });
  await duva.clock(new Date("2026-10-08T06:00:00Z"));

  expect((await changes()).slice(start)).toMatchObject([
    { type: "reminderSet", actor: graceId, thread, until: "2026-10-08T06:00:00.000Z" },
    { type: "threadLabelsChanged", actor: graceId, thread, added: [], removed: ["inbox"] },
    { type: "reminderSet", actor: graceId, thread: other },
    { type: "threadLabelsChanged", actor: graceId, thread: other, removed: ["inbox"] },
    { type: "reminderCancelled", actor: graceId, thread: other },
    { type: "threadLabelsChanged", actor: graceId, thread: other, added: ["inbox"], removed: [] },
    { type: "threadBack", thread, setAsideAt: setAt, at: expect.stringMatching(/^2026-10-08T06:00:00\./) },
  ]);
  expect((await changes()).at(-1)).not.toHaveProperty("actor");
});

test.each([
  ["neither a time nor a preset", {}, "Give at, the time the threads come back, or preset: laterToday, tomorrowMorning or nextWeek."],
  ["both a time and a preset", { at: "2026-10-08T06:00:00Z", preset: "nextWeek" }, "Give at, the time the threads come back, or preset: laterToday, tomorrowMorning or nextWeek."],
  ["a time that isn't one", { at: "tomorrow" }, `"tomorrow" isn't a time. Give at as an ISO 8601 date and time with its offset, such as 2026-10-08T08:00:00+02:00.`],
  ["a time without an offset", { at: "2026-10-08T08:00:00" }, `"2026-10-08T08:00:00" isn't a time. Give at as an ISO 8601 date and time with its offset, such as 2026-10-08T08:00:00+02:00.`],
  ["a time less than a minute away", { at: "2026-10-07T10:20:30Z" }, "That time is less than a minute from now. Give a later one."],
  ["a preset that isn't one", { preset: "someday" }, `"someday" isn't a preset. Give preset as laterToday, tomorrowMorning or nextWeek.`],
  ["a time zone that isn't one", { preset: "nextWeek", timeZone: "Mars/Olympus" }, `"Mars/Olympus" isn't a time zone. Give timeZone as an IANA name, such as Europe/Stockholm.`],
])("setting a thread aside with %s is refused", async (_, when, message) => {
  const { receive, remind, reminders } = await withMailbox();
  const thread = await receive(note("Kvitto"));

  const { response, error } = await remind([thread], when as Parameters<typeof remind>[1]);

  expect(response.status).toBe(400);
  expect(error).toEqual({ message });
  expect(await reminders()).toEqual([]);
});

test("a thread in Trash can't be set aside, and nor can the others asked with it", async () => {
  const { grace, params, receive, remind, reminders } = await withMailbox();
  const trashed = await receive(note("Kvitto"));
  const other = await receive(note("Lunch"));
  await grace.POST("/mailboxes/{mailbox}/threads/labels", { params, body: { threads: [trashed], add: ["trash"] } });

  const { response, error } = await remind([other, trashed], { at: "2026-10-08T06:00:00Z" });

  expect(response.status).toBe(409);
  expect(error).toEqual({ message: `The thread "${trashed}" is in Spam or Trash, or waits in the Screener, so it can't be set aside, and no thread was. Move it to the Inbox first.` });
  expect(await reminders()).toEqual([]);
});

test("setting aside a thread the mailbox doesn't have is refused", async () => {
  const { remind } = await withMailbox();

  const { response, error } = await remind(["nope"], { at: "2026-10-08T06:00:00Z" });

  expect(response.status).toBe(404);
  expect(error).toEqual({ message: `The mailbox has no thread "nope", so no thread was changed. List its threads to find their IDs.` });
});
