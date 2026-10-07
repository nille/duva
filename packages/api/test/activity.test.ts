import { expect, test } from "vitest";
import { type DuvaOptions, startDuva } from "./harness.ts";

/** A message from Linus to the address, with the subject, which starts its own thread. */
const note = (to: string, subject: string) =>
  [
    "From: Linus <linus@example.org>",
    `To: ${to}`,
    `Subject: ${subject}`,
    "Date: Mon, 05 Oct 2026 09:00:00 +0200",
    `Message-ID: <${subject.replaceAll(" ", "-")}@example.org>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Hej.",
  ].join("\r\n");

/**
 * A deployment on example.com where Ada sponsors the agent Hermes, which has send sponsor access
 * to her mailbox at ada@example.com, its Screener off. Grace is the first admin, and Ken another
 * human.
 */
async function withAgent(options: DuvaOptions = {}) {
  const duva = await startDuva({ domain: "example.com", admin: "grace@example.org", humans: ["ada@example.org", "ken@example.org"], ...options });
  const ada = duva.signIn("ada@example.org");
  const grace = duva.signIn("grace@example.org");
  const { data: created } = await ada.POST("/agents", { body: { name: "Hermes" } });
  const agent = created!.agent;
  const { data: adaId } = await ada.GET("/whoami");
  const { data: mailbox } = await grace.POST("/mailboxes", { body: { owner: adaId!.id, address: "ada@example.com" } });
  const params = { path: { mailbox: mailbox!.id } };
  await ada.PATCH("/mailboxes/{mailbox}/screener", { params, body: { on: false } });
  await ada.PATCH("/agents/{agent}/settings", { params: { path: { agent: agent.id } }, body: { sponsorAccess: "send" } });
  const hermes = duva.withKey(created!.key);

  /** Receives a message in Ada's mailbox, and answers its thread's ID. */
  const receive = async (subject: string) => {
    await duva.receive(note("ada@example.com", subject), { to: ["ada@example.com"] });
    const { data } = await ada.GET("/mailboxes/{mailbox}/changes", { params });
    return (data!.changes.findLast((change) => change.type === "messageReceived") as { thread: string }).thread;
  };
  /** Receives a message in Ada's mailbox, which Hermes marks read, and answers its thread's ID. */
  const organize = async (subject: string) => {
    const thread = await receive(subject);
    await hermes.POST("/mailboxes/{mailbox}/threads/read", { params, body: { threads: [thread] } });
    return thread;
  };
  /** Hermes drafts a message to the recipient in Ada's mailbox and asks to send it, and answers the draft and the approval it waits for. */
  const ask = async (to: string) => {
    const { data: draft } = await hermes.POST("/mailboxes/{mailbox}/drafts", { params, body: { to: [to], subject: "Hello", text: "Hej." } });
    const { data: asked } = await hermes.POST("/mailboxes/{mailbox}/drafts/{draft}/send", { params: { path: { ...params.path, draft: draft!.id } } });
    return { draft: draft!.id, approval: asked!.send!.approval! };
  };
  const approve = (approval: string) => ada.POST("/approvals/{approval}/send", { params: { path: { approval } } });
  const reject = (approval: string) => ada.POST("/approvals/{approval}/reject", { params: { path: { approval } }, body: { note: "Not now." } });
  /** The agent's daily summaries, as the reader reads them. */
  const summaries = async (query: { from?: string; to?: string; timeZone?: string } = {}, reader = ada) =>
    reader.GET("/agents/{agent}/activity", { params: { path: { agent: agent.id }, query } });
  /** One day of the agent's timeline, as the reader reads it. */
  const timeline = async (day: string, query: { timeZone?: string; limit?: number; after?: string } = {}, reader = ada) =>
    reader.GET("/agents/{agent}/activity/{day}", { params: { path: { agent: agent.id, day }, query } });
  return { duva, ada, grace, ken: duva.signIn("ken@example.org"), hermes, agent, adaId: adaId!.id, mailbox: mailbox!, params, receive, organize, ask, approve, reject, summaries, timeline };
}

/** A day of a summary with nothing in it. */
const quiet = (day: string) => ({ day, sent: 0, approved: 0, rejected: 0, organized: 0, screened: 0, alerts: 0 });

test("the sponsor reads their agent's daily summaries, newest first, each day's work counted on the day it was done in their time zone", async () => {
  const { duva, organize, summaries } = await withAgent();
  // 01:30 on 6 October in Stockholm, still 5 October in UTC.
  await duva.clock(new Date("2026-10-05T23:30:00Z"));
  await organize("Kvitto");
  await organize("Faktura");

  const { response, data } = await summaries({ from: "2026-10-04", to: "2026-10-06", timeZone: "Europe/Stockholm" });

  expect(response.status).toBe(200);
  expect(data).toEqual({ timeZone: "Europe/Stockholm", days: [{ ...quiet("2026-10-06"), organized: 2 }, quiet("2026-10-05"), quiet("2026-10-04")] });
  expect((await summaries({ from: "2026-10-04", to: "2026-10-06" })).data).toEqual({
    timeZone: "UTC",
    days: [quiet("2026-10-06"), { ...quiet("2026-10-05"), organized: 2 }, quiet("2026-10-04")],
  });
});

test("a day's summary counts the agent's sends that went out, and those its sponsor approved and rejected", async () => {
  const { duva, ask, approve, reject, summaries } = await withAgent();
  await duva.clock(new Date("2026-10-06T10:00:00Z"));
  await approve((await ask("linus@example.org")).approval);
  await approve((await ask("grace@example.org")).approval);
  await reject((await ask("ken@example.org")).approval);

  const { data } = await summaries({ from: "2026-10-06", to: "2026-10-06" });

  expect(data?.days).toEqual([{ ...quiet("2026-10-06"), sent: 2, approved: 2, rejected: 1 }]);
});

test("a day's summary counts what the agent organized and screened itself, and leaves out what its sponsor did in their mailbox", async () => {
  const { duva, ada, hermes, params, receive, summaries } = await withAgent();
  await duva.clock(new Date("2026-10-06T10:00:00Z"));
  const thread = await receive("Kvitto");
  await hermes.POST("/mailboxes/{mailbox}/threads/read", { params, body: { threads: [thread] } });
  await hermes.POST("/mailboxes/{mailbox}/threads/labels", { params, body: { threads: [thread], remove: ["inbox"] } });
  await hermes.POST("/mailboxes/{mailbox}/labels", { params, body: { name: "Kvitton" } });
  await hermes.PUT("/mailboxes/{mailbox}/senders/{sender}", { params: { path: { ...params.path, sender: "mallory@example.net" } }, body: { delivery: "paperTrail" } });
  await hermes.PUT("/mailboxes/{mailbox}/senders/{sender}", { params: { path: { ...params.path, sender: "eve@example.net" } }, body: { delivery: "feed" } });
  await ada.POST("/mailboxes/{mailbox}/threads/unread", { params, body: { threads: [thread] } });
  await ada.PUT("/mailboxes/{mailbox}/senders/{sender}", { params: { path: { ...params.path, sender: "linus@example.org" } }, body: { delivery: "inbox" } });

  const { data } = await summaries({ from: "2026-10-06", to: "2026-10-06" });

  expect(data?.days).toEqual([{ ...quiet("2026-10-06"), organized: 3, screened: 2 }]);
});

test("a day's summary counts the alerts about the agent its sponsor got, on the day in the reader's time zone, and none about their other agents", async () => {
  const { duva, ada, grace, hermes, agent, summaries } = await withAgent();
  const { data: other } = await ada.POST("/agents", { body: { name: "Iris" } });
  // 01:30 on 6 October in Stockholm, still 5 October in UTC.
  await duva.clock(new Date("2026-10-05T23:30:00Z"));
  await grace.POST("/agents/{agent}/pause", { params: { path: { agent: agent.id } } });
  await hermes.GET("/whoami");
  await grace.POST("/agents/{agent}/pause", { params: { path: { agent: other!.agent.id } } });

  const { data } = await summaries({ from: "2026-10-05", to: "2026-10-06", timeZone: "Europe/Stockholm" });

  expect(data?.days).toEqual([{ ...quiet("2026-10-06"), alerts: 2 }, quiet("2026-10-05")]);
  expect((await summaries({ from: "2026-10-05", to: "2026-10-06", timeZone: "UTC" })).data?.days).toEqual([quiet("2026-10-06"), { ...quiet("2026-10-05"), alerts: 2 }]);
});

test("the sponsor's days are in their time zone preference, and a call's time zone beats it", async () => {
  const { duva, ada, organize, summaries } = await withAgent();
  await duva.clock(new Date("2026-10-05T23:30:00Z"));
  await organize("Kvitto");
  await ada.PATCH("/preferences", { body: { timeZone: "Europe/Stockholm" } });

  const { data } = await summaries({ from: "2026-10-05", to: "2026-10-06" });

  expect(data).toEqual({ timeZone: "Europe/Stockholm", days: [{ ...quiet("2026-10-06"), organized: 1 }, quiet("2026-10-05")] });
  expect((await summaries({ from: "2026-10-05", to: "2026-10-06", timeZone: "America/New_York" })).data).toEqual({
    timeZone: "America/New_York",
    days: [quiet("2026-10-06"), { ...quiet("2026-10-05"), organized: 1 }],
  });
});

test("without from and to, the summaries cover the last 30 days, today first", async () => {
  const { duva, organize, summaries } = await withAgent();
  await duva.clock(new Date("2026-09-07T12:00:00Z"));
  await organize("Too old");
  await duva.clock(new Date("2026-09-08T12:00:00Z"));
  await organize("Oldest");
  await duva.clock(new Date("2026-10-07T12:00:00Z"));
  await organize("Newest");

  // A session signed in today would have expired by then.
  const { data } = await summaries({}, duva.signIn("ada@example.org"));

  expect(data?.days).toHaveLength(30);
  expect(data?.days[0]).toEqual({ ...quiet("2026-10-07"), organized: 1 });
  expect(data?.days[29]).toEqual({ ...quiet("2026-09-08"), organized: 1 });
});

test("activity reaches back to the agent's start, so a day long ago is still counted", async () => {
  const { duva, organize, summaries } = await withAgent();
  await duva.clock(new Date("2024-01-15T12:00:00Z"));
  await organize("Gammalt");
  await duva.clock(new Date("2026-10-06T12:00:00Z"));

  const { data } = await summaries({ from: "2024-01-15", to: "2024-01-15" });

  expect(data?.days).toEqual([{ ...quiet("2024-01-15"), organized: 1 }]);
});

test("an admin reads an agent's summaries, and another human or the agent itself gets 403", async () => {
  const { duva, grace, ken, hermes, organize, summaries, timeline } = await withAgent();
  await duva.clock(new Date("2026-10-06T10:00:00Z"));
  await organize("Kvitto");

  expect((await summaries({ from: "2026-10-06", to: "2026-10-06" }, grace)).data?.days).toEqual([{ ...quiet("2026-10-06"), organized: 1 }]);
  for (const reader of [ken, hermes]) {
    for (const read of [summaries({}, reader), timeline("2026-10-06", {}, reader)]) {
      const { response, error } = await read;
      expect(response.status).toBe(403);
      expect(error?.message).toBe("Only the agent's sponsor and admins can read its activity. Ask its sponsor.");
    }
  }
});

test("reading the activity of an agent there is none of gets 404", async () => {
  const { ada } = await withAgent();

  const { response, error } = await ada.GET("/agents/{agent}/activity", { params: { path: { agent: "nobody" } } });

  expect(response.status).toBe(404);
  expect(error?.message).toBe('There is no agent "nobody". List the agents you sponsor to find its ID.');
});

test.each([
  ["a from that isn't a day", { from: "2026-02-30" }, '"2026-02-30" isn\'t a day. Give from as YYYY-MM-DD.'],
  ["a to that isn't a day", { to: "6 Oct" }, '"6 Oct" isn\'t a day. Give to as YYYY-MM-DD.'],
  ["a from after to", { from: "2026-10-07", to: "2026-10-06" }, "The first day, from, is after the last, to. Give them the other way round."],
  ["more than a year of days", { from: "2025-01-01", to: "2026-01-03" }, "Ask for at most 367 days at once."],
  ["a time zone that isn't one", { timeZone: "Mars/Olympus" }, '"Mars/Olympus" isn\'t a time zone. Give timeZone as an IANA name, such as Europe/Stockholm.'],
])("reading summaries with %s gets 400", async (_, query, message) => {
  const { summaries } = await withAgent();

  const { response, error } = await summaries(query);

  expect(response.status).toBe(400);
  expect(error?.message).toBe(message);
});

// Setting up the agent is in its activity, today, so the timelines are read for days before it.
/** The entries' change types, with the mailbox and thread of each, as a timeline lists them. */
const outline = (entries: { mailbox?: string; thread?: string; change: { type: string } }[] | undefined) =>
  entries?.map(({ mailbox, thread, change }) => ({ type: change.type, ...(mailbox !== undefined && { mailbox }), ...(thread !== undefined && { thread }) }));

test("a day's timeline lists what the agent did in its sponsor's mailbox newest first, each with its mailbox and thread", async () => {
  const { duva, hermes, mailbox, params, receive, ask, approve, timeline } = await withAgent();
  await duva.clock(new Date("2026-09-15T10:00:00Z"));
  const received = await receive("Kvitto");
  await hermes.POST("/mailboxes/{mailbox}/threads/labels", { params, body: { threads: [received], remove: ["inbox"] } });
  await approve((await ask("linus@example.org")).approval);
  const sent = (await hermes.GET("/mailboxes/{mailbox}/sent", { params })).data!.threads[0]!.id;

  const { response, data } = await timeline("2026-09-15");

  expect(response.status).toBe(200);
  expect(data?.day).toBe("2026-09-15");
  expect(data?.timeZone).toBe("UTC");
  expect(data).not.toHaveProperty("next");
  expect(outline(data?.entries)).toEqual([
    { type: "messageSent", mailbox: mailbox.id, thread: sent },
    { type: "approvalDecided", mailbox: mailbox.id, thread: sent },
    { type: "approvalAsked", mailbox: mailbox.id, thread: sent },
    { type: "draftWritten", mailbox: mailbox.id, thread: sent },
    { type: "threadLabelsChanged", mailbox: mailbox.id, thread: received },
  ]);
  expect(data?.entries[4]?.change).toMatchObject({ type: "threadLabelsChanged", actor: (await hermes.GET("/whoami")).data!.id, added: [], removed: ["inbox"] });
});

test("a draft not sent yet that replies in a thread has that thread in the timeline", async () => {
  const { duva, hermes, params, receive, timeline } = await withAgent();
  await duva.clock(new Date("2026-09-15T10:00:00Z"));
  const thread = await receive("Kvitto");
  const message = (await hermes.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { ...params.path, thread } } })).data!.messages[0]!.id;
  await hermes.POST("/mailboxes/{mailbox}/drafts", { params, body: { answers: message, text: "Tack." } });

  const { data } = await timeline("2026-09-15");

  expect(outline(data?.entries)?.[0]).toMatchObject({ type: "draftWritten", thread });
});

test("a day's timeline is in the reader's time zone", async () => {
  const { duva, organize, timeline } = await withAgent();
  await duva.clock(new Date("2026-09-14T23:30:00Z"));
  await organize("Kvitto");

  expect((await timeline("2026-09-15", { timeZone: "Europe/Stockholm" })).data?.entries.map(({ change }) => change.type)).toEqual(["threadRead"]);
  expect((await timeline("2026-09-15")).data?.entries).toEqual([]);
  expect((await timeline("2026-09-14")).data?.entries.map(({ change }) => change.type)).toEqual(["threadRead"]);
});

test("the timeline has what the agent did in its sponsor's mailbox, and its sends there, but not what the sponsor did there", async () => {
  const { duva, ada, hermes, mailbox: adasMailbox, params: adasParams, receive, ask, approve, timeline } = await withAgent();
  await duva.clock(new Date("2026-09-15T10:00:00Z"));
  const organized = await receive("Kvitto");
  const ownWork = await receive("Faktura");
  await hermes.POST("/mailboxes/{mailbox}/threads/read", { params: adasParams, body: { threads: [organized] } });
  await ada.POST("/mailboxes/{mailbox}/threads/read", { params: adasParams, body: { threads: [ownWork] } });
  await ada.POST("/mailboxes/{mailbox}/drafts", { params: adasParams, body: { to: ["linus@example.org"], text: "Ada's own." } });
  await approve((await ask("linus@example.org")).approval);
  const sent = (await ada.GET("/mailboxes/{mailbox}/sent", { params: adasParams })).data!.threads[0]!.id;

  const { data } = await timeline("2026-09-15");

  expect(outline(data?.entries)).toEqual([
    { type: "messageSent", mailbox: adasMailbox.id, thread: sent },
    { type: "approvalDecided", mailbox: adasMailbox.id, thread: sent },
    { type: "approvalAsked", mailbox: adasMailbox.id, thread: sent },
    { type: "draftWritten", mailbox: adasMailbox.id, thread: sent },
    { type: "threadRead", mailbox: adasMailbox.id, thread: organized },
  ]);
});

test("the timeline has the agent's pauses once, its key rotations and changes to its settings, from the organization's feed and its sponsor's mailbox", async () => {
  const { duva, ada, grace, agent, mailbox: adasMailbox, timeline } = await withAgent();
  const agentParams = { params: { path: { agent: agent.id } } };
  // Ada has a second mailbox, whose feed records the change to the settings too.
  const { data: second } = await grace.POST("/mailboxes", { body: { owner: (await ada.GET("/whoami")).data!.id, address: "ada.lovelace@example.com" } });
  await duva.clock(new Date("2026-09-15T10:00:00Z"));
  await grace.POST("/agents/{agent}/pause", agentParams);
  await ada.POST("/agents/{agent}/unpause", agentParams);
  await ada.POST("/agents/{agent}/key", agentParams);
  await ada.PATCH("/agents/{agent}/settings", { ...agentParams, body: { sendsPerHour: 20 } });

  const { data } = await timeline("2026-09-15");

  expect(outline(data?.entries)).toEqual([
    { type: "agentSettingsChanged", mailbox: expect.toBeOneOf([adasMailbox.id, second!.id]) },
    { type: "agentKeyRotated" },
    { type: "agentUnpaused" },
    { type: "agentPaused" },
  ]);
  expect(data?.entries[0]?.change).toMatchObject({ before: { sendsPerHour: 100 }, after: { sendsPerHour: 20 } });
  expect(data?.entries[3]?.change).toMatchObject({ actor: (await grace.GET("/whoami")).data!.id, agent: agent.id });
});

test("an admin who isn't the sponsor reads the timeline without what the mail says", async () => {
  const { duva, grace, hermes, params, receive, ask, reject, timeline } = await withAgent();
  await duva.clock(new Date("2026-09-15T10:00:00Z"));
  await receive("Kvitto");
  await hermes.POST("/mailboxes/{mailbox}/labels", { params, body: { name: "Kvitton" } });
  await hermes.PUT("/mailboxes/{mailbox}/senders/{sender}", { params: { path: { ...params.path, sender: "mallory@example.net" } }, body: { delivery: "paperTrail" } });
  await reject((await ask("linus@example.org")).approval);

  const sponsors = (await timeline("2026-09-15")).data!.entries.map(({ change }) => change);
  const admins = (await timeline("2026-09-15", {}, grace)).data!.entries.map(({ change }) => change);

  expect(sponsors.find(({ type }) => type === "approvalDecided")).toMatchObject({ decision: "rejected", note: "Not now." });
  expect(sponsors.find(({ type }) => type === "labelCreated")).toMatchObject({ name: "Kvitton" });
  expect(sponsors.find(({ type }) => type === "senderDeliverySet")).toMatchObject({ address: "mallory@example.net" });
  expect(admins.map(({ type }) => type)).toEqual(sponsors.map(({ type }) => type));
  const decided = admins.find(({ type }) => type === "approvalDecided");
  expect(decided).toMatchObject({ decision: "rejected" });
  expect(decided).not.toHaveProperty("note");
  expect(admins.find(({ type }) => type === "labelCreated")).not.toHaveProperty("name");
  expect(admins.find(({ type }) => type === "senderDeliverySet")).toEqual(expect.not.objectContaining({ address: expect.anything() }));
});

test("an admin who isn't the sponsor reads no approver's edits, no bounced recipients and no reason SES gave for refusing a send", async () => {
  // In the sandbox, SES refuses mail to anyone not on the domain, and names them in its reason.
  const { duva, grace, hermes, params, ask, timeline } = await withAgent({ sandbox: true });
  await duva.clock(new Date("2026-09-15T10:00:00Z"));
  const refused = await ask("linus@example.org");
  await duva.signIn("ada@example.org").POST("/approvals/{approval}/send", { params: { path: { approval: refused.approval } }, body: { text: "Hej då." } });
  const bounced = await ask("nobody@example.com");
  await duva.signIn("ada@example.org").POST("/approvals/{approval}/send", { params: { path: { approval: bounced.approval } } });
  const { data: sent } = await hermes.GET("/mailboxes/{mailbox}/drafts/{draft}", { params: { path: { ...params.path, draft: bounced.draft } } });
  const messageId = /^<(.+)@[^@]+>$/.exec(sent!.send!.messageId!)![1]!;
  await duva.sendingEvent(messageId, { type: "Bounce", bounceType: "Permanent", bounceSubType: "NoEmail", recipients: ["nobody@example.com"] });

  const sponsors = (await timeline("2026-09-15")).data!.entries.map(({ change }) => change);
  const admins = (await timeline("2026-09-15", {}, grace)).data!.entries.map(({ change }) => change);

  const find = (changes: typeof sponsors, type: string) => changes.find((change) => change.type === type && (type !== "approvalDecided" || ("approval" in change && change.approval === refused.approval)));
  expect(find(sponsors, "approvalDecided")).toMatchObject({ edits: { text: "Hej då." } });
  expect(find(sponsors, "sendFailed")).toMatchObject({ reason: expect.stringContaining("linus@example.org") });
  expect(find(sponsors, "feedbackReceived")).toMatchObject({ feedback: { kind: "hardBounce", recipients: ["nobody@example.com"], reason: "NoEmail" } });
  expect(find(admins, "approvalDecided")).not.toHaveProperty("edits");
  expect(find(admins, "sendFailed")).not.toHaveProperty("reason");
  expect(find(admins, "feedbackReceived")).toMatchObject({ feedback: { kind: "hardBounce", at: expect.any(String), reason: "NoEmail" } });
  expect((find(admins, "feedbackReceived") as { feedback: object }).feedback).not.toHaveProperty("recipients");
});

test.each([5, 20, 100])("a change to the agent's settings in two of its sponsor's mailboxes is in the timeline once, read %i at a time", async (limit) => {
  const { duva, ada, grace, agent, timeline } = await withAgent();
  const agentParams = { params: { path: { agent: agent.id } } };
  await grace.POST("/mailboxes", { body: { owner: (await ada.GET("/whoami")).data!.id, address: "ada.lovelace@example.com" } });
  await duva.clock(new Date("2026-09-15T10:00:00Z"));
  for (const sendsPerHour of [10, 20, 30, 40, 50, 60]) await ada.PATCH("/agents/{agent}/settings", { ...agentParams, body: { sendsPerHour } });

  const read = [];
  for (let after: string | undefined, page = 0; page === 0 || after !== undefined; page++) {
    const { data } = await timeline("2026-09-15", { limit, ...(after !== undefined && { after }) });
    read.push(...data!.entries);
    after = data!.next;
  }

  expect(read.map(({ change }) => change.type === "agentSettingsChanged" && change.after.sendsPerHour)).toEqual([60, 50, 40, 30, 20, 10]);
});

test("a long timeline is read a page at a time, newest first, without repeats", async () => {
  const { duva, organize, timeline } = await withAgent();
  await duva.clock(new Date("2026-09-15T10:00:00Z"));
  const threads = [];
  for (const subject of ["Ett", "Två", "Tre", "Fyra", "Fem"]) threads.push(await organize(subject));

  const first = (await timeline("2026-09-15", { limit: 2 })).data!;
  const second = (await timeline("2026-09-15", { limit: 2, after: first.next })).data!;
  const third = (await timeline("2026-09-15", { limit: 2, after: second.next })).data!;

  expect([first, second, third].map(({ entries }) => entries.map(({ thread }) => thread))).toEqual([threads.slice(3).reverse(), threads.slice(1, 3).reverse(), [threads[0]]]);
  expect(third).not.toHaveProperty("next");
});

test.each([
  ["a day that isn't one", "2026-13-01", {}, '"2026-13-01" isn\'t a day. Give the day as YYYY-MM-DD.'],
  ["a limit Duva doesn't take", "2026-09-15", { limit: 0 }, '"0" isn\'t a limit Duva takes. Give limit as a whole number from 1 to 100.'],
  ["an after no page gave", "2026-09-15", { after: "somewhere" }, '"somewhere" isn\'t where a page starts. Give after as the next of the page before, or leave it out for the first page.'],
])("reading a timeline with %s gets 400", async (_, day, query, message) => {
  const { timeline } = await withAgent();

  const { response, error } = await timeline(day, query);

  expect(response.status).toBe(400);
  expect(error?.message).toBe(message);
});
