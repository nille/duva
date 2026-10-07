import { expect, test } from "vitest";
import { type DuvaOptions, startDuva } from "./harness.ts";

const start = Date.parse("2026-10-07T10:00:00Z");
const seconds = (count: number) => count * 1000;

/**
 * A deployment on example.com, at 10:00 on 7 October 2026, where Ada, the first admin, sponsors
 * the agent Hermes and gives it send sponsor access to her personal mailbox at ada@example.com. Grace is another human.
 * Approved sends go at once unless the options give an undo window.
 */
async function withAgent(options: DuvaOptions = {}) {
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org"], ...options });
  await duva.clock(new Date(start));
  const ada = duva.signIn("ada@example.org");
  const grace = duva.signIn("grace@example.org");
  const { data: created } = await ada.POST("/agents", { body: { name: "Hermes" } });
  const agent = created!.agent;
  const { data: me } = await ada.GET("/whoami");
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: me!.id, address: "ada@example.com" } });
  await ada.PATCH("/agents/{agent}/settings", { params: { path: { agent: agent.id } }, body: { sponsorAccess: "send" } });
  const hermes = duva.withKey(created!.key);
  const params = { path: { mailbox: mailbox!.id } };

  /** Hermes drafts a message to the recipient and asks to send it, and returns the draft and the approval it waits for. */
  const ask = async (subject: string, to = "grace@example.org") => {
    const { data: draft } = await hermes.POST("/mailboxes/{mailbox}/drafts", { params, body: { to: [to], cc: ["linus@example.net"], subject, text: "Monday works." } });
    const draftParams = { path: { ...params.path, draft: draft!.id } };
    const { data: asked } = await hermes.POST("/mailboxes/{mailbox}/drafts/{draft}/send", { params: draftParams });
    return { draft: draft!, draftParams, approval: asked!.send!.approval! };
  };
  /** Moves the clock on by the seconds. */
  let now = start;
  const later = async (by: number) => {
    now += seconds(by);
    await duva.clock(new Date(now));
  };
  const log = async (by = ada, query?: { limit?: number; after?: string }) => (await by.GET("/approvals/log", { params: { query } })).data!;
  return { duva, ada, adaId: me!.id, grace, hermes, agent, mailbox: mailbox!, params, ask, later, log };
}

test("the sponsor's log lists every decision on their agents' sends, newest first, with who decided, when, and how it went", async () => {
  const { ada, adaId, hermes, agent, mailbox, ask, later, log } = await withAgent();
  const sent = await ask("Meeting");
  await ada.POST("/approvals/{approval}/send", { params: { path: { approval: sent.approval } } });
  await later(60);
  const rejected = await ask("Lunch");
  await ada.POST("/approvals/{approval}/reject", { params: { path: { approval: rejected.approval } }, body: { note: "Not this week." } });

  const { entries, next } = await log();

  const { data: draft } = await hermes.GET("/mailboxes/{mailbox}/drafts/{draft}", { params: sent.draftParams });
  const decided = { agent: agent.id, agentName: "Hermes", decidedBy: adaId, decidedAt: expect.any(String) };
  expect(entries).toEqual([
    {
      approval: rejected.approval,
      ...decided,
      outcome: "rejected",
      reversal: "sendAfterAll",
      note: "Not this week.",
      mailbox: mailbox.id,
      draft: rejected.draft.id,
      subject: "Lunch",
      to: [{ address: "grace@example.org" }],
      cc: [{ address: "linus@example.net" }],
    },
    {
      approval: sent.approval,
      ...decided,
      outcome: "sent",
      reversal: "correction",
      mailbox: mailbox.id,
      draft: sent.draft.id,
      thread: draft!.send!.thread,
      message: draft!.send!.message,
      subject: "Meeting",
      to: [{ address: "grace@example.org" }],
      cc: [{ address: "linus@example.net" }],
    },
  ]);
  expect(entries.map(({ decidedAt }) => decidedAt)).toEqual([...entries.map(({ decidedAt }) => decidedAt)].sort().reverse());
  expect(next).toBeUndefined();
});

test("an entry says what the sponsor sent when they edited it", async () => {
  const { ada, ask, log } = await withAgent();
  const { approval } = await ask("Meeting");

  await ada.POST("/approvals/{approval}/send", { params: { path: { approval } }, body: { to: ["linus@example.net"], subject: "Our meeting" } });

  expect((await log()).entries[0]).toMatchObject({ subject: "Our meeting", to: [{ address: "linus@example.net" }], cc: [{ address: "linus@example.net" }] });
});

test("a send in its undo window is approved and can be undone, and an undone one leaves the log until it is decided again", async () => {
  const { ada, ask, log } = await withAgent({ undoWindow: 30 });
  const { approval } = await ask("Meeting");
  const { data: approved } = await ada.POST("/approvals/{approval}/send", { params: { path: { approval } } });

  expect((await log()).entries).toMatchObject([{ approval, outcome: "approved", reversal: "undo", undoUntil: approved!.undoUntil }]);
  await ada.POST("/approvals/{approval}/undo", { params: { path: { approval } } });
  expect((await log()).entries).toEqual([]);
});

test("a send held after its undo window is approved, with nothing to take back", async () => {
  const { ada, agent, ask, later, log } = await withAgent({ undoWindow: 30 });
  const { approval } = await ask("Meeting");
  await ada.POST("/approvals/{approval}/send", { params: { path: { approval } } });
  await ada.POST("/agents/{agent}/pause", { params: { path: { agent: agent.id } } });
  await later(31);

  const [entry] = (await log()).entries;

  expect(entry).toMatchObject({ approval, outcome: "approved" });
  expect(entry).not.toHaveProperty("reversal");
  expect(entry).not.toHaveProperty("undoUntil");
});

test("a send SES refused failed, with its reason, and the entry stays once the draft is revised and sent again", async () => {
  const { ada, hermes, ask, log } = await withAgent({ sandbox: true });
  const { draftParams, approval } = await ask("Meeting", "linus@example.net");
  await ada.POST("/approvals/{approval}/send", { params: { path: { approval } } });

  expect((await log()).entries).toMatchObject([{ approval, outcome: "failed", reason: expect.stringMatching(/not verified/) }]);
  await hermes.PATCH("/mailboxes/{mailbox}/drafts/{draft}", { params: draftParams, body: { to: ["ada@example.com"], cc: [] } });
  const { data: again } = await hermes.POST("/mailboxes/{mailbox}/drafts/{draft}/send", { params: draftParams });
  await ada.POST("/approvals/{approval}/send", { params: { path: { approval: again!.send!.approval! } } });
  expect((await log()).entries.map((entry) => [entry.approval, entry.outcome])).toEqual([
    [again!.send!.approval!, "sent"],
    [approval, "failed"],
  ]);
});

test("the log is read in pages, newest first", async () => {
  const { ada, ask, later, log } = await withAgent();
  const approvals: string[] = [];
  for (const subject of ["One", "Two", "Three"]) {
    const { approval } = await ask(subject);
    await ada.POST("/approvals/{approval}/reject", { params: { path: { approval } }, body: { note: "No." } });
    approvals.push(approval);
    await later(1);
  }

  const first = await log(ada, { limit: 2 });
  const second = await log(ada, { limit: 2, after: first.next! });

  expect(first.entries.map(({ approval }) => approval)).toEqual([approvals[2], approvals[1]]);
  expect(second.entries.map(({ approval }) => approval)).toEqual([approvals[0]]);
  expect(second.next).toBeUndefined();
});

test.each([["limit", { limit: 0 }], ["limit", { limit: 101 }], ["after", { after: "nowhere" }]])("a log page with a %s Duva doesn't take gets 400", async (_, query) => {
  const { ada } = await withAgent();

  const { response } = await ada.GET("/approvals/log", { params: { query } });

  expect(response.status).toBe(400);
});

test("each sponsor reads only their own log", async () => {
  const { ada, grace, hermes, ask, log } = await withAgent();
  const { approval } = await ask("Meeting");
  await ada.POST("/approvals/{approval}/send", { params: { path: { approval } } });

  expect((await log(grace)).entries).toEqual([]);
  expect((await log(hermes)).entries).toEqual([]);
});

test("a rejected send is sent after all while its draft is as the agent asked it, which moves its entry to the new decision", async () => {
  const { duva, ada, adaId, hermes, params, ask, log } = await withAgent();
  const { draftParams, approval } = await ask("Meeting");
  await ada.POST("/approvals/{approval}/reject", { params: { path: { approval } }, body: { note: "Not this week." } });

  const { response, data } = await ada.POST("/approvals/{approval}/send", { params: { path: { approval } } });

  expect(response.status).toBe(202);
  expect(data).toMatchObject({ id: approval, state: "approved" });
  expect(data).not.toHaveProperty("note");
  expect(duva.sent()).toHaveLength(1);
  expect((await hermes.GET("/mailboxes/{mailbox}/drafts/{draft}", { params: draftParams })).data?.send?.state).toBe("sent");
  expect((await log()).entries).toMatchObject([{ approval, outcome: "sent" }]);
  const { data: changes } = await hermes.GET("/mailboxes/{mailbox}/changes", { params });
  expect(changes!.changes.filter(({ type }) => type === "approvalDecided")).toMatchObject([
    { actor: adaId, decision: "rejected" },
    { actor: adaId, decision: "approved" },
  ]);
});

test("a rejected send can't be sent after all once the agent changed its draft, and its entry offers nothing to take back", async () => {
  const { duva, ada, hermes, ask, log } = await withAgent();
  const { draftParams, approval } = await ask("Meeting");
  await ada.POST("/approvals/{approval}/reject", { params: { path: { approval } }, body: { note: "Not this week." } });
  await hermes.PATCH("/mailboxes/{mailbox}/drafts/{draft}", { params: draftParams, body: { text: "Tuesday works." } });

  const { response, error } = await ada.POST("/approvals/{approval}/send", { params: { path: { approval } } });

  expect(response.status).toBe(409);
  expect(error?.message).toMatch(/changed the draft/);
  expect(duva.sent()).toEqual([]);
  expect((await log()).entries[0]).not.toHaveProperty("reversal");
});

test("a rejected send can't be sent after all once its draft is deleted", async () => {
  const { ada, hermes, ask } = await withAgent();
  const { draftParams, approval } = await ask("Meeting");
  await ada.POST("/approvals/{approval}/reject", { params: { path: { approval } }, body: { note: "No." } });
  await hermes.DELETE("/mailboxes/{mailbox}/drafts/{draft}", { params: draftParams });

  const { response } = await ada.POST("/approvals/{approval}/send", { params: { path: { approval } } });

  expect(response.status).toBe(409);
});

test("decisions made before the approval log are in it once Duva is set up again", async () => {
  const { duva, ada, ask, later, log } = await withAgent({ beforeApprovalLog: true });
  const { approval } = await ask("Meeting");
  await ada.POST("/approvals/{approval}/send", { params: { path: { approval } } });
  await later(60);
  const rejected = await ask("Lunch");
  await ada.POST("/approvals/{approval}/reject", { params: { path: { approval: rejected.approval } }, body: { note: "No." } });
  expect((await log()).entries).toEqual([]);

  await duva.setUp({ admin: "ada@example.org" });

  expect((await log()).entries).toMatchObject([
    { approval: rejected.approval, outcome: "rejected", agentName: "Hermes" },
    { approval, outcome: "sent", agentName: "Hermes" },
  ]);
  await duva.setUp({ admin: "ada@example.org" });
  expect((await log()).entries).toHaveLength(2);
});

test("erasing a thread whose approval records the organization erases takes its decisions off the log", async () => {
  const { ada, hermes, params, ask, log } = await withAgent();
  await ada.PATCH("/organization/settings", { body: { erasureErasesApprovals: true } });
  const { draftParams, approval } = await ask("Meeting");
  await ada.POST("/approvals/{approval}/send", { params: { path: { approval } } });
  const { data: draft } = await hermes.GET("/mailboxes/{mailbox}/drafts/{draft}", { params: draftParams });

  await hermes.POST("/mailboxes/{mailbox}/threads/labels", { params, body: { threads: [draft!.send!.thread!], add: ["trash"] } });
  await ada.POST("/mailboxes/{mailbox}/trash/empty", { params });

  expect((await log()).entries).toEqual([]);
});

test("erasing a thread whose approval records the organization erases takes the edits and notes of every decision on them out of the feed, those undone or rejected first included", async () => {
  const { ada, hermes, params, ask, log } = await withAgent({ undoWindow: 30 });
  await ada.PATCH("/organization/settings", { body: { erasureErasesApprovals: true, undoWindowSeconds: 0 } });
  const { draftParams, approval } = await ask("Meeting");
  await ada.POST("/approvals/{approval}/reject", { params: { path: { approval } }, body: { note: "Not this week." } });
  await ada.POST("/approvals/{approval}/send", { params: { path: { approval } }, body: { text: "Tuesday works." } });
  const { data: draft } = await hermes.GET("/mailboxes/{mailbox}/drafts/{draft}", { params: draftParams });

  await hermes.POST("/mailboxes/{mailbox}/threads/labels", { params, body: { threads: [draft!.send!.thread!], add: ["trash"] } });
  await ada.POST("/mailboxes/{mailbox}/trash/empty", { params });

  const { data: changes } = await ada.GET("/mailboxes/{mailbox}/changes", { params });
  const decisions = changes!.changes.filter(({ type }) => type === "approvalDecided");
  expect(decisions.map((change) => ("decision" in change ? change.decision : undefined))).toEqual(["rejected", "approved"]);
  for (const decision of decisions) {
    expect(decision).not.toHaveProperty("note");
    expect(decision).not.toHaveProperty("edits");
  }
  expect((await log()).entries).toEqual([]);
});

test("erasing a thread scrubs the edits of an approval undone during its window and approved again", async () => {
  const { ada, hermes, params, ask } = await withAgent({ undoWindow: 30 });
  await ada.PATCH("/organization/settings", { body: { erasureErasesApprovals: true } });
  const { draftParams, approval } = await ask("Meeting");
  await ada.POST("/approvals/{approval}/send", { params: { path: { approval } }, body: { text: "Tuesday works." } });
  await ada.POST("/approvals/{approval}/undo", { params: { path: { approval } } });
  await ada.PATCH("/organization/settings", { body: { undoWindowSeconds: 0 } });
  await ada.POST("/approvals/{approval}/send", { params: { path: { approval } } });
  const { data: draft } = await hermes.GET("/mailboxes/{mailbox}/drafts/{draft}", { params: draftParams });

  await hermes.POST("/mailboxes/{mailbox}/threads/labels", { params, body: { threads: [draft!.send!.thread!], add: ["trash"] } });
  await ada.POST("/mailboxes/{mailbox}/trash/empty", { params });

  const { data: changes } = await ada.GET("/mailboxes/{mailbox}/changes", { params });
  const decisions = changes!.changes.filter(({ type }) => type === "approvalDecided");
  expect(decisions).toHaveLength(2);
  for (const decision of decisions) expect(decision).not.toHaveProperty("edits");
});
