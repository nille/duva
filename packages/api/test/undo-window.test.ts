import { expect, test } from "vitest";
import { type DuvaOptions, startDuva } from "./harness.ts";

const start = Date.parse("2026-10-07T10:00:00Z");
const seconds = (count: number) => count * 1000;

/**
 * A deployment on example.com, at 10:00 on 7 October 2026, where Ada, the first admin, has a
 * personal mailbox at ada@example.com and sponsors the agent Hermes, which she gives send sponsor
 * access there. Grace is another human. The organization's undo window is Duva's default unless given.
 */
async function withAgent(options: DuvaOptions = {}) {
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org"], undoWindow: null, ...options });
  await duva.clock(new Date(start));
  const ada = duva.signIn("ada@example.org");
  const grace = duva.signIn("grace@example.org");
  const { data: me } = await ada.GET("/whoami");
  const { data: created } = await ada.POST("/agents", { body: { name: "Hermes" } });
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: me!.id, address: "ada@example.com" } });
  await ada.PATCH("/agents/{agent}/settings", { params: { path: { agent: created!.agent.id } }, body: { sponsorAccess: "send" } });
  const hermes = duva.withKey(created!.key);
  const params = { path: { mailbox: mailbox!.id } };

  /** Hermes drafts a message to Grace and asks to send it, and returns the draft and the approval it waits for. */
  const ask = async (text = "Monday works.") => {
    const { data: draft } = await hermes.POST("/mailboxes/{mailbox}/drafts", { params, body: { to: ["grace@example.org"], subject: "Meeting", text } });
    const draftParams = { path: { ...params.path, draft: draft!.id } };
    const { data: asked } = await hermes.POST("/mailboxes/{mailbox}/drafts/{draft}/send", { params: draftParams });
    return { draft: draft!, draftParams, approval: asked!.send!.approval! };
  };
  return { duva, ada, adaId: me!.id, grace, hermes, agent: created!.agent, params, ask };
}

test("an admin sets the undo window from 0 to 120 seconds, 30 by default, which is a setup change in the organization's change feed under them", async () => {
  const { ada, adaId, grace } = await withAgent();
  expect((await grace.GET("/organization/settings")).data?.undoWindowSeconds).toBe(30);

  const { response, data } = await ada.PATCH("/organization/settings", { body: { undoWindowSeconds: 120 } });

  expect(response.status).toBe(200);
  expect(data).toMatchObject({ undoWindowSeconds: 120 });
  const { data: changes } = await ada.GET("/organization/changes");
  expect(changes!.changes.at(-1)).toEqual({ position: expect.any(Number), at: expect.any(String), actor: adaId, type: "settingsChanged", settings: { undoWindowSeconds: 120 } });
  expect((await ada.PATCH("/organization/settings", { body: { undoWindowSeconds: 0 } })).data).toMatchObject({ undoWindowSeconds: 0 });
});

test.each([[-1], [121], [1.5], ["30"]])("an undo window of %j gets 400", async (value) => {
  const { ada } = await withAgent();

  const { response, error } = await ada.PATCH("/organization/settings", { body: { undoWindowSeconds: value as number } });

  expect(response.status).toBe(400);
  expect(error?.message).toBe("Give undoWindowSeconds as a whole number of seconds from 0 to 120.");
});

/** Hermes's message to Grace, asked to send. */
async function withAsked(options: DuvaOptions = {}) {
  const setup = await withAgent(options);
  return { ...setup, ...(await setup.ask()) };
}

test("an approved send says until when it can be undone, and SES gets it only once the window is over", async () => {
  const { duva, ada, hermes, draftParams, approval } = await withAsked();

  const { data: approved } = await ada.POST("/approvals/{approval}/send", { params: { path: { approval } } });

  const undoUntil = new Date(Date.parse(approved!.decidedAt!) + seconds(30)).toISOString();
  expect(approved).toMatchObject({ state: "approved", undoUntil });
  expect((await hermes.GET("/mailboxes/{mailbox}/drafts/{draft}", { params: draftParams })).data?.send).toEqual({ approval, state: "approved", undoUntil });
  expect(duva.sent()).toEqual([]);

  await duva.clock(new Date(Date.parse(undoUntil) - seconds(1)));
  expect(duva.sent()).toEqual([]);
  await duva.clock(new Date(Date.parse(undoUntil) + seconds(1)));

  expect(duva.sent()).toHaveLength(1);
  expect((await hermes.GET("/mailboxes/{mailbox}/drafts/{draft}", { params: draftParams })).data?.send?.state).toBe("sent");
});

test("the sponsor undoes an approved send during the window, so it waits for their approval again as the agent asked it, and nothing goes", async () => {
  const { duva, ada, adaId, hermes, draftParams, params, approval } = await withAsked();
  await ada.POST("/approvals/{approval}/send", { params: { path: { approval } }, body: { text: "Tuesday works." } });

  const { response, data } = await ada.POST("/approvals/{approval}/undo", { params: { path: { approval } } });

  expect(response.status).toBe(200);
  expect(data).toMatchObject({ id: approval, state: "pending", draft: { text: "Monday works." } });
  expect(data).not.toHaveProperty("decidedAt");
  expect(data).not.toHaveProperty("edits");
  expect((await ada.GET("/approvals")).data?.approvals.map(({ id }) => id)).toEqual([approval]);
  const { data: draft } = await hermes.GET("/mailboxes/{mailbox}/drafts/{draft}", { params: draftParams });
  expect(draft).toMatchObject({ text: "Monday works.", send: { approval, state: "waiting" } });
  const { data: changes } = await hermes.GET("/mailboxes/{mailbox}/changes", { params });
  expect(changes!.changes.at(-1)).toEqual({ position: expect.any(Number), at: expect.any(String), actor: adaId, type: "approvalUndone", draft: draftParams.path.draft, approval });
  await duva.clock(new Date(start + seconds(120)));
  expect(duva.sent()).toEqual([]);
});

test("an approval undone and approved again waits a new window, and goes out once", async () => {
  const { duva, ada, approval } = await withAsked();
  await ada.POST("/approvals/{approval}/send", { params: { path: { approval } } });
  await ada.POST("/approvals/{approval}/undo", { params: { path: { approval } } });
  await duva.clock(new Date(start + seconds(20)));

  const { data: again } = await ada.POST("/approvals/{approval}/send", { params: { path: { approval } } });

  // The first window ends at 10:00:30, and the second at 10:00:50.
  await duva.clock(new Date(start + seconds(40)));
  expect(duva.sent()).toEqual([]);
  await duva.clock(new Date(Date.parse(again!.undoUntil!) + seconds(1)));
  expect(duva.sent()).toHaveLength(1);
  await duva.clock(new Date(start + seconds(300)));
  expect(duva.sent()).toHaveLength(1);
});

test("undoing once the window is over gets 409, and the send goes", async () => {
  const { duva, ada, approval } = await withAsked();
  await ada.POST("/approvals/{approval}/send", { params: { path: { approval } } });
  await duva.clock(new Date(start + seconds(31)));

  const { response, error } = await ada.POST("/approvals/{approval}/undo", { params: { path: { approval } } });

  expect(response.status).toBe(409);
  expect(error?.message).toMatch(/undo window is over/);
  expect(duva.sent()).toHaveLength(1);
});

test("undoing an approval that waits gets 409", async () => {
  const { ada, approval } = await withAsked();

  const { response } = await ada.POST("/approvals/{approval}/undo", { params: { path: { approval } } });

  expect(response.status).toBe(409);
});

test("only the approver undoes, never the agent or another human", async () => {
  const { duva, ada, grace, hermes, approval } = await withAsked();
  await ada.POST("/approvals/{approval}/send", { params: { path: { approval } } });

  const byAgent = await hermes.POST("/approvals/{approval}/undo", { params: { path: { approval } } });
  const byGrace = await grace.POST("/approvals/{approval}/undo", { params: { path: { approval } } });

  expect([byAgent.response.status, byGrace.response.status]).toEqual([403, 403]);
  await duva.clock(new Date(start + seconds(31)));
  expect(duva.sent()).toHaveLength(1);
});

test("with a window of 0, an approved send goes at once and can't be undone", async () => {
  const { duva, ada, hermes, draftParams, approval } = await withAsked({ undoWindow: 0 });

  const { data } = await ada.POST("/approvals/{approval}/send", { params: { path: { approval } } });

  expect(data).not.toHaveProperty("undoUntil");
  expect(duva.sent()).toHaveLength(1);
  expect((await hermes.GET("/mailboxes/{mailbox}/drafts/{draft}", { params: draftParams })).data?.send).not.toHaveProperty("undoUntil");
  expect((await ada.POST("/approvals/{approval}/undo", { params: { path: { approval } } })).response.status).toBe(409);
});

test("a send held after its window while the agent is paused still counts as approved: it can't be undone, and goes once the agent is unpaused", async () => {
  const { duva, ada, agent, draftParams, approval } = await withAsked();
  await ada.POST("/approvals/{approval}/send", { params: { path: { approval } } });
  await ada.POST("/agents/{agent}/pause", { params: { path: { agent: agent.id } } });
  await duva.clock(new Date(start + seconds(60)));

  expect(duva.sent()).toEqual([]);
  expect((await ada.GET("/mailboxes/{mailbox}/drafts/{draft}", { params: draftParams })).data?.send?.state).toBe("approved");
  expect((await ada.POST("/approvals/{approval}/undo", { params: { path: { approval } } })).response.status).toBe(409);
  await ada.POST("/agents/{agent}/unpause", { params: { path: { agent: agent.id } } });
  expect(duva.sent()).toHaveLength(1);
});

test("a human's own send never waits for the undo window", async () => {
  const { duva, ada, params } = await withAgent();
  const { data: draft } = await ada.POST("/mailboxes/{mailbox}/drafts", { params, body: { to: ["grace@example.org"], subject: "Lunch", text: "Noon?" } });

  await ada.POST("/mailboxes/{mailbox}/drafts/{draft}/send", { params: { path: { ...params.path, draft: draft!.id } } });

  expect(duva.sent()).toHaveLength(1);
});
