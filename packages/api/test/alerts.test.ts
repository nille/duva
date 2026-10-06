import PostalMime from "postal-mime";
import { expect, test } from "vitest";
import type { DuvaClient } from "@duva/client";
import { type DuvaOptions, startDuva } from "./harness.ts";

const minutes = (count: number) => count * 60 * 1000;
const hours = (count: number) => minutes(count * 60);

/**
 * A deployment on example.com where ada sponsors the agent Hermes, which owns a mailbox at
 * hermes@example.com and sends from it without approval. Ada has a mailbox at ada@example.com,
 * unless `sponsorMailbox` is off. Grace is the first admin, and Ken another human. Sessions
 * outlast the hours these tests let pass.
 */
async function withAgent({ sponsorMailbox = true, ...options }: DuvaOptions & { sponsorMailbox?: boolean } = {}) {
  const duva = await startDuva({ domain: "example.com", admin: "grace@example.org", humans: ["ada@example.org", "ken@example.org"], accessTokenLifetime: 7 * 24 * 60 * 60, ...options });
  const ada = duva.signIn("ada@example.org");
  const grace = duva.signIn("grace@example.org");
  const ids = { ada: (await ada.GET("/whoami")).data!.id, grace: (await grace.GET("/whoami")).data!.id };
  const { data: created } = await ada.POST("/agents", { body: { name: "Hermes" } });
  const agent = created!.agent;
  const { data: mailbox } = await grace.POST("/mailboxes", { body: { owner: agent.id, address: "hermes@example.com" } });
  if (sponsorMailbox) await grace.POST("/mailboxes", { body: { owner: ids.ada, address: "ada@example.com" } });
  const hermes = duva.withKey(created!.key);
  const settings = { params: { path: { agent: agent.id } } };
  await ada.PATCH("/agents/{agent}/settings", { ...settings, body: { approvalForOwnMailbox: false } });
  const params = { path: { mailbox: mailbox!.id } };

  /** Hermes drafts a message to the recipients and sends it, and gets back the draft as it is then, and the ID SES gave it if SES sent it. */
  const send = async (to: string[] | string, by: DuvaClient = hermes, from = params) => {
    const { data: draft } = await by.POST("/mailboxes/{mailbox}/drafts", { params: from, body: { to: [to].flat(), subject: "Hello", text: "Hej." } });
    await by.POST("/mailboxes/{mailbox}/drafts/{draft}/send", { params: { path: { ...from.path, draft: draft!.id } } });
    const { data: sent } = await by.GET("/mailboxes/{mailbox}/drafts/{draft}", { params: { path: { ...from.path, draft: draft!.id } } });
    const messageId = /^<(.+)@eu-north-1\.amazonses\.com>$/.exec(sent!.send!.messageId ?? "")?.[1];
    return { draft: sent!, messageId };
  };
  const alerts = async (by: DuvaClient = ada, query: { agent?: string; limit?: number; after?: string } = {}) => (await by.GET("/alerts", { params: { query } })).data!;
  /** The messages SES sent from the given count on, parsed. */
  const mailed = (from: number) => Promise.all(duva.sent().slice(from).map((raw) => PostalMime.parse(raw)));
  const start = Date.now();
  return { duva, ada, grace, ken: duva.signIn("ken@example.org"), hermes, agent, ids, params, settings, send, alerts, mailed, start };
}

test("an agent's hard bounce is an alert to its sponsor, with the agent, when, what and the message, unseen", async () => {
  const { duva, ada, agent, params, send, alerts } = await withAgent();
  const { draft, messageId } = await send("nobody@example.net");
  const at = new Date();

  await duva.sendingEvent(messageId!, { type: "Bounce", bounceType: "Permanent", bounceSubType: "NoEmail" }, { at });

  expect(await alerts()).toEqual({
    alerts: [
      {
        id: expect.any(String),
        kind: "bounced",
        agent: agent.id,
        agentName: "Hermes",
        at: expect.any(String),
        what: "Mail from Hermes to nobody@example.net hard-bounced, so the address takes no mail.",
        urgent: false,
        seen: false,
        mailbox: params.path.mailbox,
        thread: draft.send!.thread,
        message: draft.send!.message,
        draft: draft.id,
      },
    ],
    unseen: 1,
  });
  const { data: none } = await ada.GET("/alerts", { params: { query: { agent: "someone-else" } } });
  expect(none).toEqual({ alerts: [], unseen: 0 });
});

test("a hard bounce isn't urgent until it makes 3 within an hour, then mailed to the sponsor's default address from Duva, with no disclosure, once an hour", async () => {
  const { duva, send, alerts, mailed, start } = await withAgent();
  const bounce = async (minute: number) => {
    const { messageId } = await send(`gone-${minute}@example.net`);
    const before = duva.sent().length;
    await duva.sendingEvent(messageId!, { type: "Bounce", bounceType: "Permanent" }, { at: new Date(start + minutes(minute)) });
    return mailed(before);
  };

  expect(await bounce(0)).toEqual([]);
  expect(await bounce(20)).toEqual([]);
  const [mail, ...more] = await bounce(50);

  expect(more).toEqual([]);
  expect(mail?.from).toEqual({ name: "Duva", address: "no-reply@example.com" });
  expect(mail?.to).toEqual([{ name: "", address: "ada@example.com" }]);
  expect(mail?.subject).toBe("Mail from Hermes bounced");
  expect(mail?.text).toContain("Mail from Hermes to gone-50@example.net hard-bounced, so the address takes no mail.");
  expect(mail?.text).not.toContain("Sent by");
  expect(mail?.headers.map(({ key }) => key)).not.toContain("duva-agent");
  expect(mail?.headers).toContainEqual(expect.objectContaining({ key: "auto-submitted", value: "auto-generated" }));
  expect(duva.sentTo().at(-1)).toEqual(["ada@example.com"]);
  expect(await bounce(55)).toEqual([]);
  expect((await alerts()).alerts.map(({ urgent }) => urgent)).toEqual([true, true, false, false]);
});

test("a complaint is an urgent alert, and the pause it leads to another, both mailed to the sponsor", async () => {
  const { duva, send, alerts, mailed } = await withAgent();
  const { messageId } = await send("ken@example.net");
  const before = duva.sent().length;

  await duva.sendingEvent(messageId!, { type: "Complaint", complaintFeedbackType: "abuse" });

  const { alerts: listed, unseen } = await alerts();
  expect(unseen).toBe(2);
  expect(listed).toMatchObject([
    {
      kind: "autoPaused",
      urgent: true,
      what: "Duva paused Hermes after a complaint about its mail, so it can't hurt the domain. Its approved sends are held, and unpausing sends them, so look at them first.",
    },
    { kind: "complained", urgent: true, what: "ken@example.net complained about mail from Hermes." },
  ]);
  expect((await mailed(before)).map(({ subject }) => subject)).toEqual(["A complaint about mail from Hermes", "Hermes was paused by Duva"]);
});

test("five hard bounces within an hour pause the agent, with an urgent alert saying why, and the sponsor gets one mail about the bounces before it", async () => {
  const { duva, send, alerts, mailed, start } = await withAgent();
  for (const minute of [0, 10, 20, 30, 40]) {
    const { messageId } = await send(`gone-${minute}@example.net`);
    await duva.sendingEvent(messageId!, { type: "Bounce", bounceType: "Permanent" }, { at: new Date(start + minutes(minute)) });
  }

  const [paused] = (await alerts()).alerts;
  expect(paused).toMatchObject({ kind: "autoPaused", urgent: true, what: expect.stringMatching(/^Duva paused Hermes after 5 hard bounces of its mail within an hour, /) });
  const subjects = (await mailed(0)).filter(({ to }) => to?.[0]?.address === "ada@example.com").map(({ subject }) => subject);
  expect(subjects).toEqual(["Mail from Hermes bounced", "Hermes was paused by Duva"]);
});

test("a hard bounce of the organization's own addresses raises no alert, and the alert of one with others names only theirs", async () => {
  const { duva, send, alerts } = await withAgent();
  const { messageId: local } = await send("ada@example.com");
  const { messageId: mixed } = await send(["ada@example.com", "gone@example.net"]);

  await duva.sendingEvent(local!, { type: "Bounce", bounceType: "Permanent" });
  await duva.sendingEvent(mixed!, { type: "Bounce", bounceType: "Permanent" });

  expect((await alerts()).alerts).toMatchObject([{ kind: "bounced", what: "Mail from Hermes to gone@example.net hard-bounced, so the address takes no mail." }]);
});

test("an event SNS delivers twice raises one alert", async () => {
  const { duva, send, alerts } = await withAgent();
  const { messageId } = await send("ken@example.net");
  const before = duva.sent().length;

  await duva.sendingEvent(messageId!, { type: "Complaint" }, { deliveries: 2 });
  await duva.sendingEvent(messageId!, { type: "Complaint" }, { again: true });

  expect((await alerts()).alerts.map(({ kind }) => kind)).toEqual(["autoPaused", "complained"]);
  expect(duva.sent()).toHaveLength(before + 2);
});

test("soft bounces raise no alert, and a reject is a failed send", async () => {
  const { duva, send, alerts } = await withAgent();
  const { draft, messageId } = await send("ken@example.net");

  await duva.sendingEvent(messageId!, { type: "Bounce", bounceType: "Transient", bounceSubType: "MailboxFull" });
  await duva.sendingEvent(messageId!, { type: "Reject", reason: "Bad content" });

  expect((await alerts()).alerts).toMatchObject([{ kind: "sendFailed", urgent: false, what: "SES rejected Hermes's message to ken@example.net: Bad content", message: draft.send!.message }]);
});

test("a human's bounces and complaints raise no alert", async () => {
  const { duva, ada, send, alerts } = await withAgent();
  const mine = { path: { mailbox: (await ada.GET("/mailboxes")).data!.mailboxes.find(({ defaultAddress }) => defaultAddress === "ada@example.com")!.id } };
  const { messageId } = await send("ken@example.net", ada, mine);

  await duva.sendingEvent(messageId!, { type: "Complaint" });

  expect(await alerts()).toEqual({ alerts: [], unseen: 0 });
});

test("an agent's send that SES refuses is a failed send, linking to the draft", async () => {
  const { send, alerts, params } = await withAgent({ sandbox: true });
  const { draft } = await send("ken@example.net");

  expect((await alerts()).alerts).toMatchObject([
    { kind: "sendFailed", urgent: false, what: expect.stringMatching(/^Hermes's message "Hello" to ken@example\.net failed: Email address is not verified\./), mailbox: params.path.mailbox, draft: draft.id },
  ]);
});

test("an agent's send that stops before SES answers is an alert that it's unclear", async () => {
  const { send, alerts } = await withAgent({ sesAnswersLost: true });
  await send("ken@example.net");

  expect((await alerts()).alerts).toMatchObject([{ kind: "sendFailed", what: `Sending Hermes's message "Hello" to ken@example.net stopped before SES answered, so it's unclear whether it went out. Duva won't send it again.` }]);
});

test("reaching the hourly limit is one alert for the window, and again once a new window fills", async () => {
  const { duva, ada, settings, send, alerts, params, start } = await withAgent();
  await ada.PATCH("/agents/{agent}/settings", { ...settings, body: { sendsPerHour: 1 } });
  await send("first@example.net");

  const { draft } = await send("second@example.net");
  await send("third@example.net");

  expect((await alerts()).alerts).toMatchObject([
    {
      kind: "limitReached",
      urgent: false,
      what: expect.stringMatching(/^Hermes reached its limit of 1 send an hour, so its sends wait\. They go out by themselves from \d\d:\d\d UTC on \d{4}-\d\d-\d\d, or when you send them now\.$/),
      mailbox: params.path.mailbox,
      draft: draft.id,
    },
  ]);
  await duva.clock(new Date(start + hours(2) + minutes(1)));
  await send("fourth@example.net");
  expect((await alerts()).alerts.map(({ kind }) => kind)).toEqual(["limitReached", "limitReached"]);
});

test("reaching the daily limit of new recipients is an alert naming it", async () => {
  const { ada, settings, send, alerts } = await withAgent();
  await ada.PATCH("/agents/{agent}/settings", { ...settings, body: { newRecipientsPerDay: 1 } });
  await send("first@example.net");

  await send("second@example.net");

  expect((await alerts()).alerts).toMatchObject([{ kind: "limitReached", what: expect.stringMatching(/^Hermes reached its limit of 1 new recipient a day, so its sends wait\./) }]);
});

test("a message to more new recipients than the whole daily limit is an alert that it waits for the sponsor", async () => {
  const { ada, settings, send, alerts } = await withAgent();
  await ada.PATCH("/agents/{agent}/settings", { ...settings, body: { newRecipientsPerDay: 1 } });

  await send(["first@example.net", "second@example.net"]);

  expect((await alerts()).alerts).toMatchObject([
    { kind: "limitReached", what: `Hermes's message "Hello" has more new recipients than its limit of 1 a day, so it waits until you send it now.` },
  ]);
});

test("an admin's pause is an urgent alert naming them, mailed to the sponsor, and the sponsor's own pause raises none", async () => {
  const { duva, ada, grace, ids, settings, alerts, mailed } = await withAgent();
  await ada.POST("/agents/{agent}/pause", settings);
  await ada.POST("/agents/{agent}/unpause", settings);
  expect((await alerts()).alerts).toEqual([]);
  const before = duva.sent().length;

  await grace.POST("/agents/{agent}/pause", settings);
  await grace.POST("/agents/{agent}/pause", settings);

  expect((await alerts()).alerts).toMatchObject([
    { kind: "pausedBy", urgent: true, by: ids.grace, what: "grace@example.org paused Hermes. Its approved sends are held, and unpausing sends them." },
  ]);
  expect((await mailed(before)).map(({ subject }) => subject)).toEqual(["Hermes was paused by grace@example.org"]);
});

/** The subjects of the threads with the label in Ada's mailbox at ada@example.com. */
async function subjectsIn(ada: DuvaClient, label: "inbox" | "spam") {
  const mailbox = (await ada.GET("/mailboxes")).data!.mailboxes.find(({ defaultAddress }) => defaultAddress === "ada@example.com")!.id;
  const { data } = await ada.GET("/mailboxes/{mailbox}/threads", { params: { path: { mailbox }, query: { label } } });
  return data!.threads.map(({ subject }) => subject);
}

test("an alert mailed to the sponsor lands in their Inbox even when SES judges it spam", async () => {
  const { duva, ada, grace, settings } = await withAgent();
  const before = duva.sent().length;
  await grace.POST("/agents/{agent}/pause", settings);
  const [alert] = duva.sent().slice(before);

  await duva.receive(alert!, { to: ["ada@example.com"] }, { verdicts: { spam: "FAIL" } });

  expect(await subjectsIn(ada, "inbox")).toEqual(["Hermes was paused by grace@example.org"]);
  expect(await subjectsIn(ada, "spam")).toEqual([]);
});

test("mail from Duva's system address that Duva didn't send, or that fails DMARC, gets SES's spam verdict", async () => {
  const { duva, ada, grace, settings } = await withAgent();
  const before = duva.sent().length;
  await grace.POST("/agents/{agent}/pause", settings);
  const [alert] = duva.sent().slice(before);
  const lookalike = alert!.replace(/^Message-ID: <[^@]+@/m, "Message-ID: <forged@").replace(/^Subject: .*$/m, "Subject: Lookalike");
  const failing = alert!.replace(/^Subject: .*$/m, "Subject: Failing DMARC");

  await duva.receive(lookalike, { to: ["ada@example.com"] }, { verdicts: { spam: "FAIL" } });
  await duva.receive(failing, { to: ["ada@example.com"] }, { verdicts: { spam: "FAIL", dmarc: "FAIL", dmarcPolicy: "none" } });

  expect(await subjectsIn(ada, "spam")).toEqual(["Failing DMARC", "Lookalike"]);
  expect(await subjectsIn(ada, "inbox")).toEqual([]);
});

test("an admin lowering a cap below the agent's limits is an alert with its new limits, not mailed", async () => {
  const { duva, grace, ids, alerts } = await withAgent();
  const before = duva.sent().length;

  await grace.PATCH("/organization/settings", { body: { agentSendsPerHourCap: 20, agentNewRecipientsPerDayCap: 10 } });

  expect((await alerts()).alerts).toMatchObject([
    { kind: "limitsChangedBy", urgent: false, by: ids.grace, what: "grace@example.org lowered the organization's caps, so Hermes's limits are now 20 sends an hour and 10 new recipients a day." },
  ]);
  expect(duva.sent()).toHaveLength(before);
});

test("an admin's removal of an agent is an urgent alert, and the sponsor keeps the alerts about it", async () => {
  const { duva, ada, grace, agent, ids, settings, alerts, mailed } = await withAgent();
  await grace.POST("/agents/{agent}/pause", settings);
  const before = duva.sent().length;

  await grace.DELETE("/agents/{agent}", settings);

  expect((await alerts()).alerts).toMatchObject([
    { kind: "removedBy", urgent: true, by: ids.grace, agent: agent.id, agentName: "Hermes", what: "grace@example.org removed Hermes, with its mailboxes." },
    { kind: "pausedBy", agent: agent.id },
  ]);
  expect((await mailed(before)).map(({ subject }) => subject)).toEqual(["Hermes was removed by grace@example.org"]);
  expect((await ada.GET("/alerts", { params: { query: { agent: agent.id } } })).data?.unseen).toBe(2);
});

test("the sponsor's removal of their own agent raises no alert, and keeps those about it", async () => {
  const { duva, ada, settings, send, alerts } = await withAgent();
  const { messageId } = await send("nobody@example.net");
  await duva.sendingEvent(messageId!, { type: "Bounce", bounceType: "Permanent" });

  await ada.DELETE("/agents/{agent}", settings);

  expect((await alerts()).alerts.map(({ kind }) => kind)).toEqual(["bounced"]);
});

test("a paused agent's key used is one alert per pause", async () => {
  const { ada, hermes, settings, alerts } = await withAgent();
  await ada.POST("/agents/{agent}/pause", settings);

  await hermes.GET("/whoami");
  await hermes.GET("/alerts");

  expect((await alerts()).alerts).toMatchObject([{ kind: "keyUsedWhilePaused", urgent: false, what: "Hermes's key was used while it is paused, and Duva refused it." }]);
  await ada.POST("/agents/{agent}/unpause", settings);
  await ada.POST("/agents/{agent}/pause", settings);
  await hermes.GET("/whoami");
  expect((await alerts()).alerts.map(({ kind }) => kind)).toEqual(["keyUsedWhilePaused", "keyUsedWhilePaused"]);
});

test("a sponsor without a mailbox gets urgent alerts listed, and none mailed", async () => {
  const { duva, grace, settings, alerts } = await withAgent({ sponsorMailbox: false });
  const before = duva.sent().length;

  await grace.POST("/agents/{agent}/pause", settings);

  expect((await alerts()).alerts).toMatchObject([{ kind: "pausedBy", urgent: true }]);
  expect(duva.sent()).toHaveLength(before);
});

test("the sponsor marks alerts seen, which lowers the unseen count once", async () => {
  const { ada, grace, settings, alerts } = await withAgent();
  await grace.POST("/agents/{agent}/pause", settings);
  await grace.POST("/agents/{agent}/unpause", settings);
  await grace.POST("/agents/{agent}/pause", settings);
  const [newest, oldest] = (await alerts()).alerts;

  const { data } = await ada.POST("/alerts/seen", { body: { alerts: [oldest!.id] } });
  await ada.POST("/alerts/seen", { body: { alerts: [oldest!.id, "no-such-alert"] } });

  expect(data).toEqual({ unseen: 1 });
  expect(await alerts()).toMatchObject({ alerts: [{ id: newest!.id, seen: false }, { id: oldest!.id, seen: true }], unseen: 1 });
});

test("only the sponsor marks their alerts seen", async () => {
  const { ken, hermes, grace, settings, alerts } = await withAgent();
  await grace.POST("/agents/{agent}/pause", settings);
  await grace.POST("/agents/{agent}/unpause", settings);
  const [alert] = (await alerts()).alerts;

  const { data } = await ken.POST("/alerts/seen", { body: { alerts: [alert!.id] } });
  const { response } = await hermes.POST("/alerts/seen", { body: { alerts: [alert!.id] } });

  expect(data).toEqual({ unseen: 0 });
  expect(response.status).toBe(403);
  expect((await alerts()).unseen).toBe(1);
  expect((await alerts(ken)).alerts).toEqual([]);
});

test("an agent lists the alerts about itself, as its sponsor sees them", async () => {
  const { ada, grace, hermes, agent, ids, alerts } = await withAgent();
  const { data: other } = await ada.POST("/agents", { body: { name: "Iris" } });
  await grace.POST("/agents/{agent}/pause", { params: { path: { agent: other!.agent.id } } });
  await grace.PATCH("/organization/settings", { body: { agentSendsPerHourCap: 20 } });

  const listed = await alerts(hermes);

  expect(listed).toMatchObject({ alerts: [{ kind: "limitsChangedBy", agent: agent.id, by: ids.grace }], unseen: 1 });
  expect((await alerts(ada)).unseen).toBe(3);
  expect((await alerts(ada, { agent: other!.agent.id })).alerts).toMatchObject([
    { kind: "limitsChangedBy", agentName: "Iris" },
    { kind: "pausedBy", agentName: "Iris" },
  ]);
});

test("alerts list a page at a time, newest first", async () => {
  const { grace, settings, alerts } = await withAgent();
  for (let round = 0; round < 3; round++) {
    await grace.POST("/agents/{agent}/pause", settings);
    await grace.POST("/agents/{agent}/unpause", settings);
  }
  const all = (await alerts()).alerts.map(({ id }) => id);

  const first = await alerts(undefined, { limit: 2 });
  const second = await alerts(undefined, { limit: 2, after: first.next });

  expect(all).toHaveLength(3);
  expect([...first.alerts, ...second.alerts].map(({ id }) => id)).toEqual(all);
  expect(second.next).toBeUndefined();
  expect(first.unseen).toBe(3);
});
