import PostalMime from "postal-mime";
import { expect, test } from "vitest";
import { type DuvaOptions, startDuva } from "./harness.ts";

/**
 * A deployment on example.com where ada has a personal mailbox at ada@example.com and sponsors the
 * agent Hermes, which she gives send sponsor access there. Grace is the first admin, and Ken
 * another human.
 */
async function withAgent(options: DuvaOptions = {}) {
  const duva = await startDuva({ domain: "example.com", admin: "grace@example.org", humans: ["ada@example.org", "ken@example.org"], ...options });
  const ada = duva.signIn("ada@example.org");
  const grace = duva.signIn("grace@example.org");
  const { data: created } = await ada.POST("/agents", { body: { name: "Hermes" } });
  const { data: mailbox } = await grace.POST("/mailboxes", { body: { owner: (await ada.GET("/whoami")).data!.id, address: "ada@example.com" } });
  const hermes = duva.withKey(created!.key);
  const agent = created!.agent;
  const params = { path: { mailbox: mailbox!.id } };
  const agentParams = { params: { path: { agent: agent.id } } };
  await ada.PATCH("/agents/{agent}/settings", { ...agentParams, body: { sponsorAccess: "send" } });
  const pause = (by = ada) => by.POST("/agents/{agent}/pause", agentParams);
  const unpause = (by = ada) => by.POST("/agents/{agent}/unpause", agentParams);

  /** Drafts a message to the recipient and asks to send it, from the mailbox given, and returns the approval it waits for, if it waits for one. */
  const ask = async (to: string, mailbox = params) => {
    const { data: draft } = await hermes.POST("/mailboxes/{mailbox}/drafts", { params: mailbox, body: { to: [to], subject: "Hello", text: "Hej." } });
    const { data: asked } = await hermes.POST("/mailboxes/{mailbox}/drafts/{draft}/send", { params: { path: { ...mailbox.path, draft: draft!.id } } });
    return asked!.send!.approval!;
  };
  const approve = (approval: string) => ada.POST("/approvals/{approval}/send", { params: { path: { approval } } });
  const ids = async () => ({
    ada: (await ada.GET("/whoami")).data!.id,
    grace: (await grace.GET("/whoami")).data!.id,
  });
  return { duva, ada, grace, ken: duva.signIn("ken@example.org"), hermes, agent, mailbox: mailbox!, params, pause, unpause, ask, approve, ids };
}

/** Who SES sent each message to, in the order it accepted them. */
const recipients = async (sent: string[]) => Promise.all(sent.map(async (raw) => (await PostalMime.parse(raw)).to?.map(({ address }) => address)));

test("the sponsor pauses an agent, and every call with its key is refused, naming who paused it", async () => {
  const { hermes, agent, params, pause, ids } = await withAgent();

  const { response, data } = await pause();

  expect(response.status).toBe(200);
  expect(data).toEqual({ ...agent, paused: { by: (await ids()).ada, at: expect.any(String) } });
  for (const call of [hermes.GET("/whoami"), hermes.GET("/mailboxes/{mailbox}/threads", { params })]) {
    const { response: refused, error } = await call;
    expect(refused.status).toBe(403);
    expect(error?.message).toMatch(/^This agent is paused by ada@example\.org\./);
  }
});

test("the sponsor sees their agent paused in the list of agents they sponsor", async () => {
  const { ada, agent, pause, ids } = await withAgent();
  await pause();

  const { data } = await ada.GET("/agents");

  expect(data?.agents.find(({ id }) => id === agent.id)).toEqual({ ...agent, paused: { by: (await ids()).ada, at: expect.any(String) }, sendsLeftThisHour: 100 });
});

test("unpausing lets the agent's key work again", async () => {
  const { hermes, agent, pause, unpause } = await withAgent();
  await pause();

  const { response, data } = await unpause();

  expect(response.status).toBe(200);
  expect(data).toEqual(agent);
  expect((await hermes.GET("/whoami")).data).toEqual(agent);
});

test("an admin pauses and unpauses an agent they don't sponsor", async () => {
  const { grace, hermes, pause, unpause } = await withAgent();

  expect((await pause(grace)).response.status).toBe(200);
  const { error } = await hermes.GET("/whoami");
  expect(error?.message).toMatch(/^This agent is paused by grace@example\.org\./);
  expect((await unpause(grace)).response.status).toBe(200);
  expect((await hermes.GET("/whoami")).response.status).toBe(200);
});

test("a human who is neither the agent's sponsor nor an admin can't pause or unpause it", async () => {
  const { ken, hermes, pause, unpause } = await withAgent();

  const paused = await pause(ken);
  expect(paused.response.status).toBe(403);
  expect(paused.error?.message).toMatch(/sponsor/);
  expect((await hermes.GET("/whoami")).response.status).toBe(200);

  await pause();
  expect((await unpause(ken)).response.status).toBe(403);
  expect((await hermes.GET("/whoami")).response.status).toBe(403);
});

test("an agent can't pause itself", async () => {
  const { hermes, pause } = await withAgent();

  expect((await pause(hermes)).response.status).toBe(403);
  expect((await hermes.GET("/whoami")).response.status).toBe(200);
});

test("pausing an agent that doesn't exist answers 404", async () => {
  const { ada } = await withAgent();

  const { response } = await ada.POST("/agents/{agent}/pause", { params: { path: { agent: "nobody" } } });

  expect(response.status).toBe(404);
});

test("a paused agent's approvals wait, can't be sent until it is unpaused, and then go out", async () => {
  const { duva, ada, pause, unpause, ask, approve } = await withAgent();
  const approval = await ask("ken@example.org");
  await pause();

  const { data: waiting } = await ada.GET("/approvals");
  expect(waiting?.approvals).toMatchObject([{ id: approval, state: "pending" }]);
  const { response, error } = await approve(approval);
  expect(response.status).toBe(409);
  expect(error?.message).toMatch(/paused/);
  expect(duva.sent()).toEqual([]);

  await unpause();
  expect((await approve(approval)).response.status).toBe(202);
  expect(await recipients(duva.sent())).toEqual([["ken@example.org"]]);
});

test("a send approved before the pause is held until the agent is unpaused, then the held sends go out oldest first", async () => {
  const { duva, pause, unpause, ask, approve } = await withAgent({ sendsHeld: true });
  const first = await ask("first@example.net");
  const second = await ask("second@example.net");
  const third = await ask("third@example.net");
  for (const approval of [second, first, third]) await approve(approval);
  await pause();

  await duva.releaseSends();
  expect(duva.sent()).toEqual([]);

  await unpause();
  await duva.releaseSends();
  expect(await recipients(duva.sent())).toEqual([["second@example.net"], ["first@example.net"], ["third@example.net"]]);
});

test("a paused agent's send that needs no approval is held too", async () => {
  const { duva, ada, agent, pause, unpause, ask } = await withAgent({ sendsHeld: true });
  await ada.PATCH("/agents/{agent}/settings", { params: { path: { agent: agent.id } }, body: { approvalAsSponsor: false } });
  await ask("ken@example.org");
  await pause();

  await duva.releaseSends();
  expect(duva.sent()).toEqual([]);

  await unpause();
  await duva.releaseSends();
  expect(await recipients(duva.sent())).toEqual([["ken@example.org"]]);
});

test("the sponsor's own sends go out while their agent is paused", async () => {
  const { duva, ada, params, pause } = await withAgent();
  await pause();

  const { data: draft } = await ada.POST("/mailboxes/{mailbox}/drafts", { params, body: { to: ["ken@example.org"], subject: "Hello", text: "Hej." } });
  await ada.POST("/mailboxes/{mailbox}/drafts/{draft}/send", { params: { path: { ...params.path, draft: draft!.id } } });

  expect(await recipients(duva.sent())).toEqual([["ken@example.org"]]);
});

test("mail to the sponsor's mailbox keeps arriving while their agent is paused, and the agent reads it once unpaused", async () => {
  const { duva, ada, hermes, params, pause, unpause } = await withAgent();
  // Mail from a first-time sender would wait in the Screener, which this test leaves out.
  await ada.PATCH("/mailboxes/{mailbox}/screener", { params, body: { on: false } });
  await pause();

  await duva.receive("From: Ken <ken@example.org>\r\nTo: ada@example.com\r\nSubject: Still there?\r\nMessage-ID: <still@example.org>\r\n\r\nHej.\r\n", {
    to: ["ada@example.com"],
  });

  expect((await ada.GET("/mailboxes/{mailbox}/threads", { params })).data?.threads).toMatchObject([{ subject: "Still there?" }]);
  await unpause();
  expect((await hermes.GET("/mailboxes/{mailbox}/threads", { params })).data?.threads).toMatchObject([{ subject: "Still there?" }]);
});

test("pausing and unpausing are in the organization's change feed, under who did it, never in the sponsor's mailbox's, and pausing again records nothing", async () => {
  const { ada, grace, agent, params, pause, unpause, ids } = await withAgent();
  const { ada: sponsor, grace: admin } = await ids();
  const { data: mailboxBefore } = await ada.GET("/mailboxes/{mailbox}/changes", { params });
  const { data: organizationBefore } = await grace.GET("/organization/changes");

  await pause();
  await pause(grace);
  await unpause(grace);

  const entry = (actor: string, type: string) => ({ position: expect.any(Number), at: expect.any(String), actor, type, agent: agent.id });
  const expected = [entry(sponsor, "agentPaused"), entry(admin, "agentUnpaused")];
  const { data: mailboxFeed } = await ada.GET("/mailboxes/{mailbox}/changes", { params: { ...params, query: { after: mailboxBefore!.position } } });
  expect(mailboxFeed?.changes).toEqual([]);
  const { data: organizationFeed } = await grace.GET("/organization/changes", { params: { query: { after: organizationBefore!.position } } });
  expect(organizationFeed?.changes).toEqual(expected);
});
