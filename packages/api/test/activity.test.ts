import { expect, test } from "vitest";
import type { components } from "@duva/openapi";
import type { Model, ModelEvent } from "../src/agent-loop.ts";
import { type DuvaOptions, startDuva } from "./harness.ts";

type Kind = components["schemas"]["AgentEventKind"];

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
 * human. Adding Hermes and giving it access are its first two events.
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
  const approve = (approval: string) => duva.signIn("ada@example.org").POST("/approvals/{approval}/send", { params: { path: { approval } } });
  const reject = (approval: string) => duva.signIn("ada@example.org").POST("/approvals/{approval}/reject", { params: { path: { approval } }, body: { note: "Not now." } });
  /** A page of the agent's events, as the reader reads it. */
  const events = async (query: { kinds?: Kind[]; failed?: boolean; limit?: number; after?: string } = {}, reader = ada) =>
    reader.GET("/agents/{agent}/events", { params: { path: { agent: agent.id }, query } });
  /** One of the agent's events, as the reader reads it. */
  const event = async (id: string, reader = ada) => reader.GET("/agents/{agent}/events/{event}", { params: { path: { agent: agent.id, event: id } } });
  /** Every page of the agent's events, as the reader reads them. */
  const everyEvent = async (query: { kinds?: Kind[]; failed?: boolean; limit?: number } = {}, reader = ada) => {
    const read = [];
    for (let after: string | undefined, page = 0; page === 0 || after !== undefined; page++) {
      const { data } = await events({ ...query, ...(after !== undefined && { after }) }, reader);
      read.push(...data!.events);
      after = data!.next;
    }
    return read;
  };
  const whoami = async (reader: typeof ada) => (await reader.GET("/whoami")).data!.id;
  return { duva, ada, grace, ken: duva.signIn("ken@example.org"), hermes, agent, adaId: adaId!.id, mailbox: mailbox!, params, receive, organize, ask, approve, reject, events, event, everyEvent, whoami };
}

/** The events' types and lines, as a list says them. */
const said = (events: { type: string; summary: string }[] | undefined) => events?.map(({ type, summary }) => [type, summary]);

test("the sponsor lists their agent's events newest first, across days, each with when, its kind and what happened", async () => {
  const { duva, hermes, adaId, mailbox, organize, events, whoami } = await withAgent();
  await duva.clock(new Date("2026-09-14T10:00:00Z"));
  await organize("Kvitto");
  await duva.clock(new Date("2026-09-15T10:00:00Z"));
  await organize("Faktura");

  const { response, data } = await events();

  expect(response.status).toBe(200);
  const event = { id: expect.any(String), at: expect.any(String), failed: false, needsYou: false };
  // Setting Hermes up happened today, after the days the clock went back to, so it is newest.
  expect(data).toEqual({
    events: [
      { ...event, kind: "pausesAndLimits", type: "agentSettingsChanged", actor: adaId, mailbox: mailbox.id, summary: "You changed Hermes's settings." },
      { ...event, kind: "setup", type: "actorAdded", actor: adaId, summary: "You added the agent Hermes." },
      { ...event, at: expect.stringMatching(/^2026-09-15T10:00/), kind: "organizing", type: "threadRead", actor: await whoami(hermes), mailbox: mailbox.id, summary: "Hermes marked a thread read." },
      { ...event, at: expect.stringMatching(/^2026-09-14T10:00/), kind: "organizing", type: "threadRead", actor: await whoami(hermes), mailbox: mailbox.id, summary: "Hermes marked a thread read." },
    ],
  });
  expect(new Set(data!.events.map(({ id }) => id)).size).toBe(4);
});

test("an event opens into everything recorded on it, with its mailbox and thread", async () => {
  const { duva, hermes, mailbox, organize, events, event, whoami } = await withAgent();
  await duva.clock(new Date("2026-09-15T10:00:00Z"));
  const thread = await organize("Kvitto");
  const listed = (await events()).data!.events.find(({ type }) => type === "threadRead")!;

  const { response, data } = await event(listed.id);

  expect(response.status).toBe(200);
  expect(data).toEqual({ ...listed, mailbox: mailbox.id, thread, change: { position: expect.any(Number), at: listed.at, type: "threadRead", actor: await whoami(hermes), thread } });
});

test("what the agent did in its sponsor's mailbox is in its events, each draft with its thread, but not what the sponsor did there", async () => {
  const { duva, ada, params, receive, organize, ask, approve, everyEvent, event } = await withAgent();
  await duva.clock(new Date("2026-09-15T10:00:00Z"));
  const ownWork = await receive("Faktura");
  await ada.POST("/mailboxes/{mailbox}/threads/read", { params, body: { threads: [ownWork] } });
  await ada.POST("/mailboxes/{mailbox}/drafts", { params, body: { to: ["linus@example.org"], text: "Ada's own." } });
  await organize("Kvitto");
  await approve((await ask("linus@example.org")).approval);
  const sent = (await ada.GET("/mailboxes/{mailbox}/sent", { params })).data!.threads[0]!.id;

  const listed = (await everyEvent()).slice(2);

  expect(said(listed)).toEqual([
    ["messageSent", "Duva sent Hermes's message to linus@example.org."],
    ["approvalDecided", "You approved Hermes's send."],
    ["approvalAsked", "Hermes asked for approval to send."],
    ["draftWritten", "Hermes started a draft."],
    ["threadRead", "Hermes marked a thread read."],
  ]);
  expect((await event(listed[3]!.id)).data?.thread).toBe(sent);
});

test("a draft not sent yet that replies in a thread has that thread", async () => {
  const { duva, hermes, params, receive, events, event } = await withAgent();
  await duva.clock(new Date("2026-09-15T10:00:00Z"));
  const thread = await receive("Kvitto");
  const message = (await hermes.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { ...params.path, thread } } })).data!.messages[0]!.id;
  await hermes.POST("/mailboxes/{mailbox}/drafts", { params, body: { answers: message, text: "Tack." } });

  const written = (await events()).data!.events.find(({ type }) => type === "draftWritten")!;

  expect((await event(written.id)).data).toMatchObject({ type: "draftWritten", thread });
});

test("the agent's pauses are in its events once, with its key rotations and changes to its settings, from the organization's feed and its sponsor's mailboxes", async () => {
  const { duva, ada, grace, agent, mailbox, everyEvent, event, whoami } = await withAgent();
  const agentParams = { params: { path: { agent: agent.id } } };
  // Ada has a second mailbox, whose feed records the change to the settings too.
  const { data: second } = await grace.POST("/mailboxes", { body: { owner: await whoami(ada), address: "ada.lovelace@example.com" } });
  await duva.clock(new Date("2026-09-15T10:00:00Z"));
  await grace.POST("/agents/{agent}/pause", agentParams);
  await ada.POST("/agents/{agent}/unpause", agentParams);
  await ada.POST("/agents/{agent}/key", agentParams);
  await ada.PATCH("/agents/{agent}/settings", { ...agentParams, body: { sendsPerHour: 20 } });

  const listed = (await everyEvent()).filter(({ type }) => type !== "alert").slice(2, 6);

  expect(said(listed)).toEqual([
    ["agentSettingsChanged", "You changed Hermes's settings."],
    ["agentKeyRotated", "You rotated Hermes's key."],
    ["agentUnpaused", "You unpaused Hermes."],
    ["agentPaused", "grace@example.org paused Hermes."],
  ]);
  expect((await event(listed[0]!.id)).data).toMatchObject({ mailbox: expect.toBeOneOf([mailbox.id, second!.id]), change: { before: { sendsPerHour: 100 }, after: { sendsPerHour: 20 } } });
  expect((await event(listed[3]!.id)).data).toMatchObject({ change: { actor: await whoami(grace), agent: agent.id } });
  expect((await event(listed[3]!.id)).data).not.toHaveProperty("mailbox");
});

test.each([5, 20, 100])("a change to the agent's settings in two of its sponsor's mailboxes is one event, read %i at a time", async (limit) => {
  const { duva, ada, grace, agent, everyEvent, whoami } = await withAgent();
  const agentParams = { params: { path: { agent: agent.id } } };
  await grace.POST("/mailboxes", { body: { owner: await whoami(ada), address: "ada.lovelace@example.com" } });
  await duva.clock(new Date("2026-09-15T10:00:00Z"));
  for (const sendsPerHour of [10, 20, 30, 40, 50, 60]) await ada.PATCH("/agents/{agent}/settings", { ...agentParams, body: { sendsPerHour } });

  const read = await everyEvent({ limit });

  expect(read.map(({ type }) => type)).toEqual(["agentSettingsChanged", "actorAdded", ...Array(6).fill("agentSettingsChanged")]);
});

test("a long list is read a page at a time, newest first, without repeats", async () => {
  const { duva, organize, events } = await withAgent();
  await duva.clock(new Date("2026-09-15T10:00:00Z"));
  for (const subject of ["Ett", "Två", "Tre"]) await organize(subject);

  const first = (await events({ limit: 2 })).data!;
  const second = (await events({ limit: 2, after: first.next })).data!;
  const third = (await events({ limit: 2, after: second.next })).data!;

  expect([first, second, third].map(({ events }) => events.map(({ type }) => type))).toEqual([["agentSettingsChanged", "actorAdded"], ["threadRead", "threadRead"], ["threadRead"]]);
  expect(third).not.toHaveProperty("next");
});

test("a list of one kind is read a page at a time too, each page holding only that kind", async () => {
  const { duva, event, organize, events } = await withAgent();
  await duva.clock(new Date("2026-09-15T10:00:00Z"));
  const threads = [];
  for (const subject of ["Ett", "Två", "Tre", "Fyra", "Fem"]) threads.push(await organize(subject));

  const pages = [];
  for (let after: string | undefined, page = 0; page === 0 || after !== undefined; page++) {
    const { data } = await events({ kinds: ["organizing"], limit: 2, ...(after !== undefined && { after }) });
    pages.push(data!.events);
    after = data!.next;
  }

  expect(pages.map((page) => page.length)).toEqual([2, 2, 1]);
  const read = await Promise.all(pages.flat().map(async ({ id }) => (await event(id)).data!.thread));
  expect(read).toEqual(threads.toReversed());
});

/**
 * Hermes organizes, screens, drafts and sends with approval, is paused by Grace, which alerts Ada,
 * then unpaused and its key rotated by Ada, on a day before it was set up, as the clock goes back.
 */
async function withEveryKind() {
  const setUp = await withAgent();
  const { duva, ada, grace, hermes, agent, params, organize, ask, approve } = setUp;
  await duva.clock(new Date("2026-09-15T10:00:00Z"));
  await organize("Kvitto");
  await hermes.PUT("/mailboxes/{mailbox}/senders/{sender}", { params: { path: { ...params.path, sender: "mallory@example.net" } }, body: { delivery: "paperTrail" } });
  await approve((await ask("linus@example.org")).approval);
  await grace.POST("/agents/{agent}/pause", { params: { path: { agent: agent.id } } });
  await ada.POST("/agents/{agent}/unpause", { params: { path: { agent: agent.id } } });
  await ada.POST("/agents/{agent}/key", { params: { path: { agent: agent.id } } });
  return setUp;
}

test.each<[Kind[], string[]]>([
  [["organizing"], ["threadRead"]],
  [["screening"], ["senderDeliverySet"]],
  [["draftsAndSends"], ["messageSent", "draftWritten"]],
  [["approvals"], ["approvalDecided", "approvalAsked"]],
  [["pausesAndLimits"], ["agentSettingsChanged", "agentUnpaused", "agentPaused"]],
  [["alerts"], ["alert"]],
  [["setup"], ["actorAdded", "agentKeyRotated"]],
  [["conversations"], []],
  [["organizing", "screening"], ["senderDeliverySet", "threadRead"]],
])("the events of the kinds %j are listed alone", async (kinds, types) => {
  const { events } = await withEveryKind();

  const { data } = await events({ kinds });

  expect(data!.events.map(({ type }) => type)).toEqual(types);
  expect(data!.events.every(({ kind }) => kinds.includes(kind))).toBe(true);
});

test("kinds given as one comma-separated list are read as several", async () => {
  const { ada, agent } = await withEveryKind();

  const { data } = await ada.GET("/agents/{agent}/events", { params: { path: { agent: agent.id }, query: { kinds: ["organizing,screening"] as unknown as Kind[] } } });

  expect(data!.events.map(({ type }) => type)).toEqual(["senderDeliverySet", "threadRead"]);
});

test("the failed events are listed alone, across kinds, as a send SES refused and one that bounced", async () => {
  // In the sandbox, SES refuses mail to anyone not on the domain.
  const { duva, hermes, params, ask, approve, organize, events } = await withAgent({ sandbox: true });
  await duva.clock(new Date("2026-09-15T10:00:00Z"));
  await organize("Kvitto");
  await approve((await ask("linus@example.org")).approval);
  const bounced = await ask("nobody@example.com");
  await approve(bounced.approval);
  const { data: sent } = await hermes.GET("/mailboxes/{mailbox}/drafts/{draft}", { params: { path: { ...params.path, draft: bounced.draft } } });
  await duva.sendingEvent(/^<(.+)@[^@]+>$/.exec(sent!.send!.messageId!)![1]!, { type: "Bounce", bounceType: "Permanent", bounceSubType: "NoEmail", recipients: ["nobody@example.com"] });

  const failed = (await events({ failed: true })).data!.events;

  expect(said(failed)).toEqual([
    ["feedbackReceived", "Amazon SES reported that a message bounced for nobody@example.com."],
    ["sendFailed", expect.stringMatching(/^Amazon SES refused to send Hermes's message: .*linus@example\.org/)],
  ]);
  expect(failed.every(({ failed }) => failed)).toBe(true);
  expect((await events({ failed: true, kinds: ["approvals"] })).data!.events).toEqual([]);
  expect((await events({ failed: false })).data!.events.length).toBeGreaterThan(failed.length);
});

test("a send waiting for approval waits for the sponsor until they decide, and an alert until they see it", async () => {
  const { duva, ada, grace, agent, ask, approve, events } = await withAgent();
  await duva.clock(new Date("2026-09-15T10:00:00Z"));
  const asked = await ask("linus@example.org");
  await grace.POST("/agents/{agent}/pause", { params: { path: { agent: agent.id } } });
  const waiting = async (reader = ada) => (await events({}, reader)).data!.events.filter(({ needsYou }) => needsYou).map(({ type }) => type);

  expect(await waiting()).toEqual(["alert", "approvalAsked"]);
  // Waiting is for the sponsor, and an admin who isn't one reads nothing waiting for them.
  expect(await waiting(grace)).toEqual([]);

  const alert = (await ada.GET("/alerts")).data!.alerts[0]!;
  await ada.POST("/alerts/seen", { body: { alerts: [alert.id] } });
  await ada.POST("/agents/{agent}/unpause", { params: { path: { agent: agent.id } } });
  await approve(asked.approval);

  expect(await waiting()).toEqual([]);
});

test("an alert is an event, saying for the sponsor what the alert said, and opening into the alert", async () => {
  const { duva, ada, grace, agent, events, event } = await withAgent();
  await duva.clock(new Date("2026-09-15T10:00:00Z"));
  await grace.POST("/agents/{agent}/pause", { params: { path: { agent: agent.id } } });
  const alert = (await ada.GET("/alerts")).data!.alerts[0]!;

  const listed = (await events({ kinds: ["alerts"] })).data!.events;

  expect(listed).toEqual([{ id: expect.any(String), at: alert.at, kind: "alerts", type: "alert", actor: "duva", summary: alert.what, failed: false, needsYou: true }]);
  expect((await event(listed[0]!.id)).data).toEqual({ ...listed[0], alert });
  // An admin who isn't the sponsor reads whom it went to and what it was about, and not the alert.
  const admins = (await events({ kinds: ["alerts"] }, grace)).data!.events;
  expect(said(admins)).toEqual([["alert", "Duva alerted ada@example.org that it was paused."]]);
  expect((await event(admins[0]!.id, grace)).data).not.toHaveProperty("alert");
});

test("an admin who isn't the sponsor reads the events without what the mail says", async () => {
  const { duva, grace, hermes, params, receive, ask, reject, everyEvent, event } = await withAgent();
  await duva.clock(new Date("2026-09-15T10:00:00Z"));
  await receive("Kvitto");
  await hermes.POST("/mailboxes/{mailbox}/labels", { params, body: { name: "Kvitton" } });
  await hermes.PUT("/mailboxes/{mailbox}/senders/{sender}", { params: { path: { ...params.path, sender: "mallory@example.net" } }, body: { delivery: "paperTrail" } });
  await reject((await ask("linus@example.org")).approval);

  const sponsors = (await everyEvent()).slice(2);
  const admins = (await everyEvent({}, grace)).slice(2);

  expect(said(sponsors)).toEqual([
    ["approvalDecided", "You rejected Hermes's send: “Not now.”"],
    ["approvalAsked", "Hermes asked for approval to send."],
    ["draftWritten", "Hermes started a draft."],
    ["senderDeliverySet", "Hermes sent mail from mallory@example.net to the Paper Trail."],
    ["labelCreated", "Hermes created the label Kvitton."],
  ]);
  expect(said(admins)).toEqual([
    ["approvalDecided", "ada@example.org rejected Hermes's send."],
    ["approvalAsked", "Hermes asked for approval to send."],
    ["draftWritten", "Hermes started a draft."],
    ["senderDeliverySet", "Hermes sent mail from a sender to the Paper Trail."],
    ["labelCreated", "Hermes created a label."],
  ]);
  const decided = (await event(admins[0]!.id, grace)).data!.change!;
  expect(decided).toMatchObject({ decision: "rejected" });
  expect(decided).not.toHaveProperty("note");
  expect((await event(admins[4]!.id, grace)).data!.change).not.toHaveProperty("name");
  expect((await event(admins[3]!.id, grace)).data!.change).toEqual(expect.not.objectContaining({ address: expect.anything() }));
  expect((await event(sponsors[3]!.id)).data!.change).toMatchObject({ address: "mallory@example.net" });
});

test("an admin who isn't the sponsor reads no approver's edits, no bounced recipients and no reason SES gave for refusing a send", async () => {
  // In the sandbox, SES refuses mail to anyone not on the domain, and names them in its reason.
  const { duva, grace, hermes, params, ask, events, event } = await withAgent({ sandbox: true });
  await duva.clock(new Date("2026-09-15T10:00:00Z"));
  const refused = await ask("linus@example.org");
  await duva.signIn("ada@example.org").POST("/approvals/{approval}/send", { params: { path: { approval: refused.approval } }, body: { text: "Hej då." } });
  const bounced = await ask("nobody@example.com");
  await duva.signIn("ada@example.org").POST("/approvals/{approval}/send", { params: { path: { approval: bounced.approval } } });
  const { data: sent } = await hermes.GET("/mailboxes/{mailbox}/drafts/{draft}", { params: { path: { ...params.path, draft: bounced.draft } } });
  await duva.sendingEvent(/^<(.+)@[^@]+>$/.exec(sent!.send!.messageId!)![1]!, { type: "Bounce", bounceType: "Permanent", bounceSubType: "NoEmail", recipients: ["nobody@example.com"] });

  const changes = async (reader: typeof grace | undefined) => {
    const listed = (await events({ kinds: ["approvals", "draftsAndSends"], limit: 100 }, reader)).data!.events;
    return Promise.all(listed.map(async ({ id, summary }) => ({ summary, change: (await event(id, reader)).data!.change! })));
  };
  const sponsors = await changes(undefined);
  const admins = await changes(grace);
  const find = (read: typeof sponsors, type: string) => read.find(({ change }) => change.type === type && (type !== "approvalDecided" || ("approval" in change && change.approval === refused.approval)))!;

  expect(find(sponsors, "approvalDecided")).toMatchObject({ summary: "You approved Hermes's send, changing the text.", change: { edits: { text: "Hej då." } } });
  expect(find(sponsors, "sendFailed").change).toMatchObject({ reason: expect.stringContaining("linus@example.org") });
  expect(find(sponsors, "feedbackReceived").change).toMatchObject({ feedback: { kind: "hardBounce", recipients: ["nobody@example.com"], reason: "NoEmail" } });
  expect(find(admins, "approvalDecided").summary).toBe("ada@example.org approved Hermes's send.");
  expect(find(admins, "approvalDecided").change).not.toHaveProperty("edits");
  expect(find(admins, "sendFailed")).toMatchObject({ summary: "Amazon SES refused to send Hermes's message." });
  expect(find(admins, "sendFailed").change).not.toHaveProperty("reason");
  expect(find(admins, "feedbackReceived").summary).toBe("Amazon SES reported that a message bounced.");
  expect((find(admins, "feedbackReceived").change as { feedback: object }).feedback).toEqual({ kind: "hardBounce", at: expect.any(String), reason: "NoEmail" });
  expect(admins.find(({ change }) => change.type === "messageSent")!.summary).toBe("Duva sent Hermes's message.");
});

test("an admin reads an agent's events, and another human or the agent itself gets 403", async () => {
  const { grace, ken, hermes, events, event } = await withAgent();
  const listed = (await events({}, grace)).data!.events;

  expect(said(listed)).toEqual([
    ["agentSettingsChanged", "ada@example.org changed Hermes's settings."],
    ["actorAdded", "ada@example.org added the agent Hermes."],
  ]);
  for (const reader of [ken, hermes]) {
    for (const read of [events({}, reader), event(listed[0]!.id, reader)]) {
      const { response, error } = await read;
      expect(response.status).toBe(403);
      expect(error?.message).toBe("Only the agent's sponsor and admins can read its activity. Ask its sponsor.");
    }
  }
});

test("reading the events of an agent there is none of gets 404, and so does an event it doesn't have", async () => {
  const { ada, event } = await withAgent();

  const none = await ada.GET("/agents/{agent}/events", { params: { path: { agent: "nobody" } } });
  const missing = await event("organization:999999");

  expect(none.response.status).toBe(404);
  expect(none.error?.message).toBe('There is no agent "nobody". List the agents you sponsor to find its ID.');
  expect(missing.response.status).toBe(404);
  expect(missing.error?.message).toBe('Hermes has no event "organization:999999". List its events to find its ID.');
});

test.each([
  ["a kind there is none of", { kinds: ["mail"] }, '"mail" isn\'t a kind of event. Give kinds from conversations, tasks, draftsAndSends, approvals, organizing, screening, unsubscribes, pausesAndLimits, alerts, setup.'],
  ["a limit Duva doesn't take", { limit: 0 }, '"0" isn\'t a limit Duva takes. Give limit as a whole number from 1 to 100.'],
  ["an after no page gave", { after: "somewhere" }, '"somewhere" isn\'t where a page starts. Give after as the next of the page before, or leave it out for the first page.'],
])("listing events with %s gets 400", async (_, query, message) => {
  const { events } = await withAgent();

  const { response, error } = await events(query as Parameters<typeof events>[0]);

  expect(response.status).toBe(400);
  expect(error?.message).toBe(message);
});

/** A stand-in for the mailbox agent's models that takes one step of the script per model call, each costing 1,000 tokens in and 100 out. */
function scripted(...steps: ((request: Parameters<Model>[0]) => ModelEvent[])[]): Model {
  let step = 0;
  return async function* (request) {
    for (const event of steps[step++]?.(request) ?? [{ text: "Done." }]) yield event;
    yield { usage: { inputTokens: 1000, outputTokens: 100 } };
  };
}

const use = (name: string, input: Record<string, unknown> = {}): ModelEvent => ({ toolUse: { toolUseId: `${name}-${Math.random()}`, name, input } });

const haiku = "anthropic.claude-haiku-4-5-20251001-v1:0";
const sonnet = "anthropic.claude-sonnet-5-5";

test("each turn of Ask Coo is one event under Coo, saying what was asked, and opening into what Coo read, the models, a handover and the cost", async () => {
  const words = "Is the receipt from Linus about the dinner last Friday, and did he say whether the restaurant takes cards or only cash at the door?";
  let thread = "";
  const model = scripted(
    () => [use("getThread", { thread })],
    () => [{ text: "It is about the dinner." }],
    // Answering without looking anything up doesn't hold up, so the harder model answers again (ADR-0032).
    () => [{ text: "Hej!" }],
    () => [{ text: "Hej Ada!" }],
  );
  const { duva, ada, params, receive, adaId } = await withAgent({ model });
  const coo = (await ada.GET("/mailbox-agent")).data!.agent;
  await duva.clock(new Date("2026-09-15T10:00:00Z"));
  thread = await receive("Kvitto");

  await duva.askAgent("ada@example.org", { mailbox: params.path.mailbox, words });
  await duva.askAgent("ada@example.org", { mailbox: params.path.mailbox, words: "Hej!" });

  const { data: feed } = await ada.GET("/mailboxes/{mailbox}/changes", { params });
  const turns = feed!.changes.filter((change) => change.type === "conversationTurn");
  // Haiku 4.5 costs $1.10 and Sonnet 5.5 $2.20 a million tokens in, and $5.50 and $11 a million out, through the eu profile.
  expect(turns).toEqual([
    { position: expect.any(Number), at: expect.any(String), type: "conversationTurn", actor: coo.id, agent: coo.id, human: adaId, asked: `${words.slice(0, 120)}…`, threads: [thread], drafts: [], models: [haiku], outcome: "answered", cost: 0.33 },
    {
      position: expect.any(Number),
      at: expect.any(String),
      type: "conversationTurn",
      actor: coo.id,
      agent: coo.id,
      human: adaId,
      asked: "Hej!",
      threads: [],
      drafts: [],
      models: [haiku, sonnet],
      handover: { reason: "answerCheck", from: haiku, to: sonnet },
      outcome: "answered",
      cost: 0.495,
    },
  ]);
  const read = (query: { kinds: Kind[] }) => ada.GET("/agents/{agent}/events", { params: { path: { agent: coo.id }, query } });
  const { data } = await read({ kinds: ["conversations"] });
  // A turn keeps its handover, so the handover is no event of its own, and a turn that wrote no draft says none.
  expect(said(data!.events)).toEqual([
    ["conversationTurn", "You asked Coo “Hej!”"],
    ["conversationTurn", `You asked Coo “${words.slice(0, 120)}…”`],
  ]);
  expect(data!.events.map(({ kind }) => kind)).toEqual(["conversations", "conversations"]);
  expect((await read({ kinds: ["tasks"] })).data!.events).toEqual([]);
  const opened = await Promise.all(data!.events.map(async ({ id }) => (await ada.GET("/agents/{agent}/events/{event}", { params: { path: { agent: coo.id, event: id } } })).data));
  expect(opened.map((event) => event!.change)).toEqual(turns.toReversed());
  expect(opened.map((event) => event!.mailbox)).toEqual([params.path.mailbox, params.path.mailbox]);
});

test("an admin who isn't the sponsor reads Coo's turns without what was asked or what the model said in asking for help", async () => {
  const model = scripted(
    () => [{ text: "Hmm." }, use("ask_for_help", { why: "Which receipt from Linus?" })],
    () => [use("listThreads")],
    () => [{ text: "There are none." }],
  );
  const { duva, ada, grace, params } = await withAgent({ model });
  const coo = (await ada.GET("/mailbox-agent")).data!.agent;
  await duva.askAgent("ada@example.org", { mailbox: params.path.mailbox, words: "Find Linus's receipt." });

  const { data } = await grace.GET("/agents/{agent}/events", { params: { path: { agent: coo.id }, query: { kinds: ["conversations"] } } });

  expect(said(data!.events)).toEqual([["conversationTurn", "ada@example.org asked Coo something."]]);
  const { data: turn } = await grace.GET("/agents/{agent}/events/{event}", { params: { path: { agent: coo.id, event: data!.events[0]!.id } } });
  expect(turn!.change).not.toHaveProperty("asked");
  expect(turn!.change).toMatchObject({ handover: { reason: "askedForHelp", from: haiku, to: sonnet } });
  expect((turn!.change as { handover: object }).handover).not.toHaveProperty("why");
});

test("a turn that fails says so, and is listed with the failed events", async () => {
  const model: Model = async function* () {
    yield { text: "Hm" };
    throw new Error("Bedrock fell over.");
  };
  const { duva, ada, params } = await withAgent({ model });
  const coo = (await ada.GET("/mailbox-agent")).data!.agent;
  await duva.askAgent("ada@example.org", { mailbox: params.path.mailbox, words: "Hej!" });

  const { data } = await ada.GET("/agents/{agent}/events", { params: { path: { agent: coo.id }, query: { failed: true } } });

  expect(said(data!.events)).toEqual([["conversationTurn", "You asked Coo “Hej!”, and it couldn't answer."]]);
});

test("a turn names only the drafts Coo wrote, not those it read, nor a draft an input it made up names (#135)", async () => {
  let draft = "";
  const model = scripted(
    // Answering without looking anything up doesn't hold up, so the harder model answers again (ADR-0032).
    () => [{ text: "You have 2 unread threads." }],
    () => [use("listThreads", { label: "inbox", draft: "unread" }), use("getDraft", { draft })],
    () => [{ text: "You have 1 unread thread." }],
    // Writing a draft goes to the harder model, which writes it.
    () => [use("createDraft", { to: ["linus@example.org"], text: "Tack." })],
    () => [use("createDraft", { to: ["linus@example.org"], text: "Tack." })],
    () => [{ text: "I wrote a draft to Linus." }],
  );
  const { duva, ada, params, receive } = await withAgent({ model });
  await receive("Kvitto");
  draft = (await ada.POST("/mailboxes/{mailbox}/drafts", { params, body: { to: ["linus@example.org"], text: "Ada's own." } })).data!.id;

  await duva.askAgent("ada@example.org", { mailbox: params.path.mailbox, words: "How many unread threads are in my Inbox?" });
  await duva.askAgent("ada@example.org", { mailbox: params.path.mailbox, words: "Thank Linus." });

  const { data: feed } = await ada.GET("/mailboxes/{mailbox}/changes", { params });
  const written = feed!.changes.filter((change) => change.type === "draftWritten").map((change) => (change as { draft: string }).draft);
  const turns = feed!.changes.filter((change) => change.type === "conversationTurn");
  expect(turns).toMatchObject([
    { asked: "How many unread threads are in my Inbox?", drafts: [], handover: { reason: "answerCheck" } },
    { asked: "Thank Linus.", drafts: [written.at(-1)], handover: { reason: "writing" } },
  ]);
  // So Coo's events say it wrote a draft only where it did.
  const coo = (await ada.GET("/mailbox-agent")).data!.agent;
  const { data } = await ada.GET("/agents/{agent}/events", { params: { path: { agent: coo.id }, query: { kinds: ["conversations"] } } });
  expect(data!.events.map(({ summary }) => summary)).toEqual(["You asked Coo “Thank Linus.”, and it wrote a draft.", "You asked Coo “How many unread threads are in my Inbox?”"]);
});
