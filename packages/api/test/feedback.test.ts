import { expect, test } from "vitest";
import type { DuvaClient } from "@duva/client";
import { type DuvaOptions, startDuva } from "./harness.ts";

/**
 * A deployment on example.com where ada has the mailboxes ada@example.com and ada.news@example.com
 * and sponsors the agent Hermes, which she gives send sponsor access to both, to send as her
 * without approval. Grace is the first admin, and has a mailbox at grace@example.com.
 */
async function withAgent(options: DuvaOptions = {}) {
  const duva = await startDuva({ domain: "example.com", admin: "grace@example.org", humans: ["ada@example.org"], ...options });
  const ada = duva.signIn("ada@example.org");
  const grace = duva.signIn("grace@example.org");
  const { data: created } = await ada.POST("/agents", { body: { name: "Hermes" } });
  const agent = created!.agent;
  const sponsor = (await ada.GET("/whoami")).data!.id;
  const { data: own } = await grace.POST("/mailboxes", { body: { owner: sponsor, address: "ada@example.com" } });
  const { data: news } = await grace.POST("/mailboxes", { body: { owner: sponsor, address: "ada.news@example.com" } });
  const { data: graces } = await grace.POST("/mailboxes", { body: { owner: (await grace.GET("/whoami")).data!.id, address: "grace@example.com" } });
  const hermes = duva.withKey(created!.key);
  await ada.PATCH("/agents/{agent}/settings", { params: { path: { agent: agent.id } }, body: { sponsorAccess: "send", approvalAsSponsor: false } });

  /**
   * The actor drafts a message to the recipients from the mailbox and sends it, and gets back the
   * draft, sent, and the ID SES gave the message.
   */
  const send = async (by: DuvaClient, mailbox: string, to: string[], from?: string) => {
    const params = { path: { mailbox } };
    const { data: draft } = await by.POST("/mailboxes/{mailbox}/drafts", { params, body: { to, subject: "Hello", text: "Hej.", ...(from !== undefined && { from }) } });
    await by.POST("/mailboxes/{mailbox}/drafts/{draft}/send", { params: { path: { mailbox, draft: draft!.id } } });
    const { data: sent } = await by.GET("/mailboxes/{mailbox}/drafts/{draft}", { params: { path: { mailbox, draft: draft!.id } } });
    const messageId = /^<(.+)@eu-north-1\.amazonses\.com>$/.exec(sent!.send!.messageId!)![1]!;
    return { draft: sent!, messageId };
  };
  const paused = async () => (await ada.GET("/agents")).data?.agents.find(({ id }) => id === agent.id)?.paused;
  return { duva, ada, grace, hermes, agent, own: own!.id, news: news!.id, graces: graces!.id, send, paused };
}

test("a hard bounce is recorded on the sent message, its send, and in the mailbox's change feed, under no actor", async () => {
  const { duva, ada, hermes, own, send } = await withAgent();
  const params = { path: { mailbox: own } };
  const { data: before } = await ada.GET("/mailboxes/{mailbox}/changes", { params });
  const { draft, messageId } = await send(hermes, own, ["nobody@example.net", "ken@example.net"]);
  const at = new Date();

  await duva.sendingEvent(messageId, { type: "Bounce", bounceType: "Permanent", bounceSubType: "NoEmail", recipients: ["nobody@example.net"] }, { at });

  const bounced = { kind: "hardBounce", at: at.toISOString(), recipients: ["nobody@example.net"], reason: "NoEmail" };
  const { data: sent } = await ada.GET("/mailboxes/{mailbox}/drafts/{draft}", { params: { path: { mailbox: own, draft: draft.id } } });
  expect(sent?.send).toMatchObject({ state: "sent", feedback: [bounced] });
  const { data: thread } = await ada.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { mailbox: own, thread: draft.send!.thread! } } });
  expect(thread?.messages).toMatchObject([{ id: draft.send!.message, feedback: [bounced] }]);
  const { data: feed } = await ada.GET("/mailboxes/{mailbox}/changes", { params: { ...params, query: { after: before!.position } } });
  expect(feed?.changes.at(-1)).toEqual({
    position: expect.any(Number),
    at: expect.any(String),
    type: "feedbackReceived",
    draft: draft.id,
    thread: draft.send!.thread,
    message: draft.send!.message,
    feedback: bounced,
  });
});

test("a soft bounce, a complaint and a reject are recorded on the message in the order they came", async () => {
  const { duva, grace, graces, send } = await withAgent();
  const { draft, messageId } = await send(grace, graces, ["ken@example.net"]);
  const at = (minute: number) => new Date(Date.UTC(2026, 9, 6, 12, minute));

  await duva.sendingEvent(messageId, { type: "Bounce", bounceType: "Transient", bounceSubType: "MailboxFull" }, { at: at(1) });
  await duva.sendingEvent(messageId, { type: "Complaint", complaintFeedbackType: "abuse" }, { at: at(2) });
  await duva.sendingEvent(messageId, { type: "Reject", reason: "Bad content" }, { at: at(3) });

  const { data: thread } = await grace.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { mailbox: graces, thread: draft.send!.thread! } } });
  expect(thread?.messages[0]?.feedback).toEqual([
    { kind: "softBounce", at: at(1).toISOString(), recipients: ["ken@example.net"], reason: "MailboxFull" },
    { kind: "complaint", at: at(2).toISOString(), recipients: ["ken@example.net"], reason: "abuse" },
    { kind: "reject", at: at(3).toISOString(), recipients: ["ken@example.net"], reason: "Bad content" },
  ]);
});

test("a complaint about an agent's mail pauses the agent, recorded under Duva in the organization's change feed, saying why", async () => {
  const { duva, ada, grace, hermes, agent, own, send, paused } = await withAgent();
  const params = { path: { mailbox: own } };
  const { messageId } = await send(hermes, own, ["ken@example.net"]);
  const { data: before } = await ada.GET("/mailboxes/{mailbox}/changes", { params });
  const { data: organizationBefore } = await grace.GET("/organization/changes");

  await duva.sendingEvent(messageId, { type: "Complaint" });

  expect(await paused()).toEqual({ by: "duva", at: expect.any(String), reason: "A recipient complained about its mail." });
  const { response, error } = await hermes.GET("/whoami");
  expect(response.status).toBe(403);
  expect(error?.message).toMatch(/^This agent is paused by Duva\./);
  const { data: feed } = await ada.GET("/mailboxes/{mailbox}/changes", { params: { ...params, query: { after: before!.position } } });
  expect(feed?.changes).toMatchObject([{ type: "feedbackReceived" }]);
  const { data: organizationFeed } = await grace.GET("/organization/changes", { params: { query: { after: organizationBefore!.position } } });
  expect(organizationFeed?.changes).toMatchObject([{ type: "agentPaused", actor: "duva", agent: agent.id }]);
});

test("five hard bounces within an hour, across its sponsor's mailboxes, pause it, and four don't", async () => {
  const { duva, hermes, own, news, send, paused } = await withAgent();
  const start = Date.UTC(2026, 9, 6, 12, 0);
  const bounce = async (mailbox: string, minute: number) => {
    const { messageId } = await send(hermes, mailbox, [`gone-${minute}@example.net`]);
    await duva.sendingEvent(messageId, { type: "Bounce", bounceType: "Permanent" }, { at: new Date(start + minute * 60_000) });
  };

  for (const [mailbox, minute] of [[own, 0], [news, 10], [own, 20], [news, 30]] as const) await bounce(mailbox, minute);
  expect(await paused()).toBeUndefined();

  await bounce(own, 59);
  expect(await paused()).toEqual({ by: "duva", at: expect.any(String), reason: "Its mail hard-bounced 5 times within an hour." });
});

test("five hard bounces within an hour pause the agent whatever order SNS delivers them in", async () => {
  const { duva, hermes, own, send, paused } = await withAgent();
  const start = Date.UTC(2026, 9, 6, 12, 0);

  for (const minute of [50, 40, 30, 20, 10]) {
    const { messageId } = await send(hermes, own, [`gone-${minute}@example.net`]);
    await duva.sendingEvent(messageId, { type: "Bounce", bounceType: "Permanent" }, { at: new Date(start + minute * 60_000) });
  }

  expect(await paused()).toEqual({ by: "duva", at: expect.any(String), reason: "Its mail hard-bounced 5 times within an hour." });
});

test("a complaint SNS delivers again after the sponsor unpaused the agent doesn't pause it again", async () => {
  const { duva, ada, hermes, agent, own, send, paused } = await withAgent();
  const { messageId } = await send(hermes, own, ["ken@example.net"]);
  await duva.sendingEvent(messageId, { type: "Complaint" });
  await ada.POST("/agents/{agent}/unpause", { params: { path: { agent: agent.id } } });

  await duva.sendingEvent(messageId, { type: "Complaint" }, { again: true });

  expect(await paused()).toBeUndefined();
});

test("a complaint about mail an agent sent as its sponsor's group is recorded on the send and pauses the agent", async () => {
  const { duva, ada, grace, hermes, own, send, paused } = await withAgent();
  await grace.POST("/groups", { body: { address: "team@example.com", members: ["ada@example.com", "grace@example.com"] } });
  const { draft, messageId } = await send(hermes, own, ["ken@example.net"], "team@example.com");

  await duva.sendingEvent(messageId, { type: "Complaint" });

  const { data: sent } = await ada.GET("/mailboxes/{mailbox}/drafts/{draft}", { params: { path: { mailbox: own, draft: draft.id } } });
  expect(sent?.from).toBe("team@example.com");
  expect(sent?.send?.feedback?.map(({ kind }) => kind)).toEqual(["complaint"]);
  expect(await paused()).toEqual({ by: "duva", at: expect.any(String), reason: "A recipient complained about its mail." });
});

test("hard bounces more than an hour apart don't pause the agent", async () => {
  const { duva, hermes, own, send, paused } = await withAgent();
  const start = Date.UTC(2026, 9, 6, 12, 0);

  for (const minute of [0, 20, 40, 60, 61]) {
    const { messageId } = await send(hermes, own, [`gone-${minute}@example.net`]);
    await duva.sendingEvent(messageId, { type: "Bounce", bounceType: "Permanent" }, { at: new Date(start + minute * 60_000) });
  }

  expect(await paused()).toBeUndefined();
});

test("each recipient of a message that hard-bounces counts as a bounce", async () => {
  const { duva, hermes, own, send, paused } = await withAgent();
  const { messageId } = await send(hermes, own, ["a@example.net", "b@example.net", "c@example.net", "d@example.net", "e@example.net"]);

  await duva.sendingEvent(messageId, { type: "Bounce", bounceType: "Permanent" });

  expect(await paused()).toEqual({ by: "duva", at: expect.any(String), reason: "Its mail hard-bounced 5 times within an hour." });
});

test("soft bounces and rejects are recorded but don't pause the agent", async () => {
  const { duva, ada, hermes, own, send, paused } = await withAgent();
  const sends = [];
  for (let each = 0; each < 5; each++) sends.push(await send(hermes, own, [`full-${each}@example.net`]));

  for (const { messageId } of sends) await duva.sendingEvent(messageId, { type: "Bounce", bounceType: "Transient" });
  for (const { messageId } of sends) await duva.sendingEvent(messageId, { type: "Bounce", bounceType: "Undetermined" });
  for (const { messageId } of sends) await duva.sendingEvent(messageId, { type: "Reject" });

  expect(await paused()).toBeUndefined();
  const { data: draft } = await ada.GET("/mailboxes/{mailbox}/drafts/{draft}", { params: { path: { mailbox: own, draft: sends[0]!.draft.id } } });
  expect(draft?.send?.feedback?.map(({ kind }) => kind)).toEqual(["softBounce", "softBounce", "reject"]);
});

test("an event SNS delivers twice is recorded once and counts once", async () => {
  const { duva, ada, hermes, own, send, paused } = await withAgent();
  const sends = [];
  for (let each = 0; each < 4; each++) sends.push(await send(hermes, own, [`gone-${each}@example.net`]));

  for (const { messageId } of sends) await duva.sendingEvent(messageId, { type: "Bounce", bounceType: "Permanent" }, { deliveries: 2 });

  expect(await paused()).toBeUndefined();
  const { data: draft } = await ada.GET("/mailboxes/{mailbox}/drafts/{draft}", { params: { path: { mailbox: own, draft: sends[0]!.draft.id } } });
  expect(draft?.send?.feedback).toHaveLength(1);
});

test("a human's complaints and hard bounces are recorded, and no human is paused", async () => {
  const { duva, grace, graces, send } = await withAgent();
  const { draft, messageId } = await send(grace, graces, ["a@example.net", "b@example.net", "c@example.net", "d@example.net", "e@example.net"]);

  await duva.sendingEvent(messageId, { type: "Bounce", bounceType: "Permanent" });
  await duva.sendingEvent(messageId, { type: "Complaint", recipients: ["a@example.net"] });

  const { data: sent } = await grace.GET("/mailboxes/{mailbox}/drafts/{draft}", { params: { path: { mailbox: graces, draft: draft.id } } });
  expect(sent?.send?.feedback?.map(({ kind }) => kind)).toEqual(["hardBounce", "complaint"]);

  expect((await grace.GET("/whoami")).response.status).toBe(200);
});

test("an agent's complaint after its sponsor unpaused it pauses it again", async () => {
  const { duva, ada, hermes, agent, own, send, paused } = await withAgent();
  await duva.sendingEvent((await send(hermes, own, ["ken@example.net"])).messageId, { type: "Complaint" });
  await ada.POST("/agents/{agent}/unpause", { params: { path: { agent: agent.id } } });
  expect(await paused()).toBeUndefined();

  await duva.sendingEvent((await send(hermes, own, ["linus@example.net"])).messageId, { type: "Complaint" });

  expect(await paused()).toEqual({ by: "duva", at: expect.any(String), reason: "A recipient complained about its mail." });
});
