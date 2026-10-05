import { expect, test } from "vitest";
import { startDuva } from "./harness.ts";

/**
 * A deployment on example.com where ada, the first admin, sponsors the agent Hermes, which owns a
 * mailbox at hermes@example.com. Grace is another human.
 */
async function withMailbox() {
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org"] });
  const ada = duva.signIn("ada@example.org");
  const { data: created } = await ada.POST("/agents", { body: { name: "Hermes" } });
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: created!.agent.id, address: "hermes@example.com" } });
  const hermes = duva.withKey(created!.key);
  const params = { path: { mailbox: mailbox!.id } };

  /** Receives the message for the mailbox, and returns its thread and message as the agent reads them. */
  const receive = async (raw: string, to = "hermes@example.com") => {
    await duva.receive(raw, { to: [to] });
    const { data: list } = await hermes.GET("/mailboxes/{mailbox}/threads", { params });
    const { data: thread } = await hermes.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { ...params.path, thread: list!.threads[0]!.id } } });
    return { thread: thread!, message: thread!.messages[0]! };
  };
  return { duva, ada, hermes, agent: created!.agent, key: created!.key, mailbox: mailbox!, params, receive };
}

/** A message from Grace, with the headers given, as her mail server sends it. */
const fromGrace = (headers: string, text = "Can we meet on Monday?") =>
  `From: Grace Hopper <grace@example.org>\r\n${headers}Date: Sat, 03 Oct 2026 10:00:00 +0000\r\nMessage-ID: <meet-1@example.org>\r\n\r\n${text}\r\n`;

test("the agent drafts a reply, from the address the original was sent to, plus tag kept, to its From, with Re: before the subject", async () => {
  const { hermes, agent, params, receive } = await withMailbox();
  const { thread, message } = await receive(fromGrace("To: hermes+meetings@example.com\r\nSubject: Meeting\r\n"), "hermes+meetings@example.com");

  const { response, data } = await hermes.POST("/mailboxes/{mailbox}/drafts", { params, body: { answers: message.id, text: "Monday works." } });

  expect(response.status).toBe(201);
  expect(data).toEqual({
    id: expect.any(String),
    answers: message.id,
    thread: thread.id,
    from: "hermes+meetings@example.com",
    to: [{ name: "Grace Hopper", address: "grace@example.org" }],
    cc: [],
    bcc: [],
    subject: "Re: Meeting",
    text: "Monday works.",
    updatedAt: expect.any(String),
    updatedBy: agent.id,
  });
});

test("a reply goes to the original's Reply-To when it has one, and its subject keeps a single Re:", async () => {
  const { hermes, params, receive } = await withMailbox();
  const { message } = await receive(fromGrace("To: hermes@example.com\r\nReply-To: Team <team@example.org>, lead@example.org\r\nSubject: RE: Re:Meeting\r\n"));

  const { data } = await hermes.POST("/mailboxes/{mailbox}/drafts", { params, body: { answers: message.id, text: "Monday works." } });

  expect(data).toMatchObject({
    from: "hermes@example.com",
    to: [{ name: "Team", address: "team@example.org" }, { address: "lead@example.org" }],
    subject: "Re: Meeting",
  });
});

test("the agent drafts a new message, which goes from the mailbox's default address", async () => {
  const { hermes, agent, params } = await withMailbox();

  const { response, data } = await hermes.POST("/mailboxes/{mailbox}/drafts", {
    params,
    body: { to: ["grace@example.org"], subject: "Hello", text: "Hej Grace." },
  });

  expect(response.status).toBe(201);
  expect(data).toEqual({
    id: expect.any(String),
    from: "hermes@example.com",
    to: [{ address: "grace@example.org" }],
    cc: [],
    bcc: [],
    subject: "Hello",
    text: "Hej Grace.",
    updatedAt: expect.any(String),
    updatedBy: agent.id,
  });
});

test.each([
  ["to something that isn't an address", { to: ["grace"], subject: "Hello", text: "Hej." }, /"grace" isn't an email address/],
  ["with a Cc that isn't an address", { to: ["grace@example.org"], cc: ["ada"], subject: "Hello", text: "Hej." }, /"ada" isn't an email address/],
  ["with a subject of two lines", { to: ["grace@example.org"], subject: "Hello\r\nBcc: x@example.net", text: "Hej." }, /one line/],
])("a draft %s is refused", async (_, body, message) => {
  const { hermes, params } = await withMailbox();

  const { response, error } = await hermes.POST("/mailboxes/{mailbox}/drafts", { params, body: body as never });

  expect(response.status).toBe(400);
  expect(error?.message).toMatch(message);
});

test("an agent's draft without a recipient in To can't be asked to send", async () => {
  const { ada, hermes, params } = await withMailbox();
  const { data: draft } = await hermes.POST("/mailboxes/{mailbox}/drafts", { params, body: { subject: "Hello", text: "Hej." } });

  const { response, error } = await hermes.POST("/mailboxes/{mailbox}/drafts/{draft}/send", { params: { path: { ...params.path, draft: draft!.id } } });

  expect(response.status).toBe(400);
  expect(error?.message).toMatch(/recipient in To/);
  expect((await ada.GET("/approvals")).data).toEqual({ approvals: [] });
});

test("a reply to a message the mailbox doesn't have is refused", async () => {
  const { hermes, params } = await withMailbox();

  const { response } = await hermes.POST("/mailboxes/{mailbox}/drafts", { params, body: { answers: "nothing", text: "Hej." } });

  expect(response.status).toBe(404);
});

test("only the mailbox's owner drafts in it, not its sponsor or another agent", async () => {
  const { duva, ada, params } = await withMailbox();
  const { data: iris } = await ada.POST("/agents", { body: { name: "Iris" } });
  const body = { to: ["grace@example.org"], subject: "Hello", text: "Hej." };

  const bySponsor = await ada.POST("/mailboxes/{mailbox}/drafts", { params, body });
  const byAgent = await duva.withKey(iris!.key).POST("/mailboxes/{mailbox}/drafts", { params, body });

  expect([bySponsor.response.status, byAgent.response.status]).toEqual([403, 403]);
});

test("writing a draft is in the mailbox's change feed, naming the agent", async () => {
  const { hermes, agent, params } = await withMailbox();

  const { data: draft } = await hermes.POST("/mailboxes/{mailbox}/drafts", { params, body: { to: ["grace@example.org"], subject: "Hello", text: "Hej." } });

  const { data } = await hermes.GET("/mailboxes/{mailbox}/changes", { params });
  expect(data?.changes).toEqual([{ position: 1, at: expect.any(String), actor: agent.id, type: "draftWritten", draft: draft!.id }]);
});

/** The agent's reply to a message from Grace, drafted and asked to send. */
async function withAskedReply() {
  const setup = await withMailbox();
  const { hermes, params, receive } = setup;
  const { message } = await receive(fromGrace("To: hermes@example.com\r\nSubject: Meeting\r\n"));
  const { data: draft } = await hermes.POST("/mailboxes/{mailbox}/drafts", { params, body: { answers: message.id, text: "Monday works." } });
  const draftParams = { path: { ...params.path, draft: draft!.id } };
  const asked = await hermes.POST("/mailboxes/{mailbox}/drafts/{draft}/send", { params: draftParams });
  return { ...setup, original: message, draft: draft!, draftParams, asked, approval: asked.data!.send!.approval! };
}

test("asking to send a draft waits for the sponsor's approval, showing the draft beside the message it answers", async () => {
  const { ada, agent, mailbox, original, draft, asked } = await withAskedReply();

  const { data } = await ada.GET("/approvals");

  expect(asked.response.status).toBe(202);
  expect(asked.data).toEqual({ ...draft, send: { approval: expect.any(String), state: "waiting" } });
  const { data: sponsor } = await ada.GET("/whoami");
  expect(data).toEqual({
    approvals: [
      {
        id: asked.data!.send!.approval,
        state: "pending",
        mailbox: mailbox.id,
        agent: agent.id,
        approver: sponsor!.id,
        draft: { id: draft.id, answers: original.id, thread: draft.thread, from: "hermes@example.com", to: draft.to, cc: [], bcc: [], subject: "Re: Meeting", text: "Monday works." },
        original,
        askedAt: expect.any(String),
      },
    ],
  });
});

test("the agent sees its send waiting", async () => {
  const { hermes, draftParams, params, approval } = await withAskedReply();

  const { data: one } = await hermes.GET("/mailboxes/{mailbox}/drafts/{draft}", { params: draftParams });
  const { data: all } = await hermes.GET("/mailboxes/{mailbox}/drafts", { params });

  expect(one?.send).toEqual({ approval, state: "waiting" });
  expect(all).toEqual({ drafts: [one] });
});

test("a draft waits for one approval at a time", async () => {
  const { hermes, draftParams } = await withAskedReply();

  const { response, error } = await hermes.POST("/mailboxes/{mailbox}/drafts/{draft}/send", { params: draftParams });

  expect(response.status).toBe(409);
  expect(error?.message).toMatch(/already waits/);
});

test("the sponsor lists the pending approvals of every agent they sponsor, newest first, and nobody else sees them", async () => {
  const { duva, ada, hermes, params } = await withMailbox();
  const { data: iris } = await ada.POST("/agents", { body: { name: "Iris" } });
  const { data: irisMailbox } = await ada.POST("/mailboxes", { body: { owner: iris!.agent.id, address: "iris@example.com" } });
  const asIris = duva.withKey(iris!.key);
  const irisParams = { path: { mailbox: irisMailbox!.id } };
  const body = { to: ["grace@example.org"], subject: "Hello", text: "Hej." };
  const { data: first } = await hermes.POST("/mailboxes/{mailbox}/drafts", { params, body });
  await hermes.POST("/mailboxes/{mailbox}/drafts/{draft}/send", { params: { path: { ...params.path, draft: first!.id } } });
  const { data: second } = await asIris.POST("/mailboxes/{mailbox}/drafts", { params: irisParams, body });
  await asIris.POST("/mailboxes/{mailbox}/drafts/{draft}/send", { params: { path: { ...irisParams.path, draft: second!.id } } });

  const { data } = await ada.GET("/approvals");
  const byGrace = await duva.signIn("grace@example.org").GET("/approvals");
  const byAgent = await hermes.GET("/approvals");

  expect(data?.approvals.map(({ draft }) => draft.id)).toEqual([second!.id, first!.id]);
  expect(data?.approvals[0]).not.toHaveProperty("original");
  expect(byGrace.data).toEqual({ approvals: [] });
  expect(byAgent.data).toEqual({ approvals: [] });
});

test("asking to send is in the mailbox's change feed, naming the agent", async () => {
  const { hermes, agent, params, draft, approval } = await withAskedReply();

  const { data } = await hermes.GET("/mailboxes/{mailbox}/changes", { params });

  expect(data?.changes.slice(-1)).toEqual([{ position: 3, at: expect.any(String), actor: agent.id, type: "approvalAsked", draft: draft.id, approval }]);
});

test("the agent edits a draft", async () => {
  const { hermes, params } = await withMailbox();
  const { data: draft } = await hermes.POST("/mailboxes/{mailbox}/drafts", { params, body: { to: ["grace@example.org"], subject: "Hello", text: "Hej." } });

  const { response, data } = await hermes.PATCH("/mailboxes/{mailbox}/drafts/{draft}", {
    params: { path: { ...params.path, draft: draft!.id } },
    body: { to: ["grace@example.org", "ada@example.org"], text: "Hej Grace och Ada." },
  });

  expect(response.status).toBe(200);
  expect(data).toEqual({ ...draft, to: [{ address: "grace@example.org" }, { address: "ada@example.org" }], text: "Hej Grace och Ada.", updatedAt: expect.any(String) });
});

test("changing a draft that waits for approval withdraws the request, so the sponsor never approves text they didn't see", async () => {
  const { ada, hermes, draftParams, approval } = await withAskedReply();

  const { data } = await hermes.PATCH("/mailboxes/{mailbox}/drafts/{draft}", { params: draftParams, body: { text: "Tuesday works better." } });

  expect(data?.send).toEqual({ approval, state: "withdrawn" });
  expect((await ada.GET("/approvals")).data).toEqual({ approvals: [] });
  const decision = await ada.POST("/approvals/{approval}/reject", { params: { path: { approval } }, body: { note: "Too late." } });
  expect(decision.response.status).toBe(409);
  expect(decision.error?.message).toMatch(/withdrawn/);
});

test("the sponsor rejects with a note, the draft comes back to the agent with it, and the agent revises and asks again", async () => {
  const { ada, hermes, draftParams, approval } = await withAskedReply();

  const rejected = await ada.POST("/approvals/{approval}/reject", { params: { path: { approval } }, body: { note: "Say Tuesday, not Monday." } });
  const { data: returned } = await hermes.GET("/mailboxes/{mailbox}/drafts/{draft}", { params: draftParams });
  await hermes.PATCH("/mailboxes/{mailbox}/drafts/{draft}", { params: draftParams, body: { text: "Tuesday works." } });
  const { data: revised } = await hermes.GET("/mailboxes/{mailbox}/drafts/{draft}", { params: draftParams });
  const again = await hermes.POST("/mailboxes/{mailbox}/drafts/{draft}/send", { params: draftParams });

  expect(rejected.response.status).toBe(200);
  expect(rejected.data).toMatchObject({ id: approval, state: "rejected", note: "Say Tuesday, not Monday.", decidedAt: expect.any(String) });
  expect(returned?.send).toEqual({ approval, state: "rejected", note: "Say Tuesday, not Monday." });
  expect(revised?.send).toEqual({ approval, state: "rejected", note: "Say Tuesday, not Monday." });
  expect(again.data?.send).toEqual({ approval: expect.not.stringMatching(approval), state: "waiting" });
  const { data: pending } = await ada.GET("/approvals");
  expect(pending?.approvals.map(({ id, draft }) => ({ id, text: draft.text }))).toEqual([{ id: again.data!.send!.approval!, text: "Tuesday works." }]);
});

test("a rejection needs a note", async () => {
  const { ada, approval } = await withAskedReply();

  const { response, error } = await ada.POST("/approvals/{approval}/reject", { params: { path: { approval } }, body: { note: " " } });

  expect(response.status).toBe(400);
  expect(error?.message).toMatch(/note/);
});

test("of two decisions on one approval at the same time, exactly one wins and the other is refused", async () => {
  const { ada, hermes, draftParams, approval } = await withAskedReply();

  const decisions = await Promise.all(
    ["First tab.", "Second tab."].map((note) => ada.POST("/approvals/{approval}/reject", { params: { path: { approval } }, body: { note } })),
  );

  const statuses = decisions.map(({ response }) => response.status).sort();
  expect(statuses).toEqual([200, 409]);
  const winner = decisions.find(({ response }) => response.status === 200)!.data!.note;
  expect((await hermes.GET("/mailboxes/{mailbox}/drafts/{draft}", { params: draftParams })).data?.send?.note).toBe(winner);
  expect(decisions.find(({ response }) => response.status === 409)!.error?.message).toMatch(/already rejected/);
});

test("an agent can't decide approvals, its own included", async () => {
  const { duva, hermes, approval } = await withAskedReply();

  const own = await hermes.POST("/approvals/{approval}/reject", { params: { path: { approval } }, body: { note: "No." } });
  const byOther = await duva.signIn("grace@example.org").POST("/approvals/{approval}/reject", { params: { path: { approval } }, body: { note: "No." } });

  expect(own.response.status).toBe(403);
  expect(own.error?.message).toMatch(/Agents can't decide approvals/);
  expect(byOther.response.status).toBe(403);
});

test("deciding an approval that doesn't exist answers 404", async () => {
  const { ada } = await withMailbox();

  const { response } = await ada.POST("/approvals/{approval}/reject", { params: { path: { approval: "nothing" } }, body: { note: "No." } });

  expect(response.status).toBe(404);
});

test("the mailbox's change feed records each step, naming its actor", async () => {
  const { ada, hermes, agent, params, draft, draftParams, approval } = await withAskedReply();
  const { data: sponsor } = await ada.GET("/whoami");
  await ada.POST("/approvals/{approval}/reject", { params: { path: { approval } }, body: { note: "Say Tuesday." } });
  await hermes.PATCH("/mailboxes/{mailbox}/drafts/{draft}", { params: draftParams, body: { text: "Tuesday works." } });
  const { data: again } = await hermes.POST("/mailboxes/{mailbox}/drafts/{draft}/send", { params: draftParams });
  await hermes.PATCH("/mailboxes/{mailbox}/drafts/{draft}", { params: draftParams, body: { text: "Tuesday at ten works." } });

  const { data } = await ada.GET("/mailboxes/{mailbox}/changes", { params });

  const second = again!.send!.approval!;
  expect(data?.changes.map(({ position, at, ...change }) => change)).toEqual([
    { type: "messageReceived", thread: draft.thread, message: draft.answers },
    { actor: agent.id, type: "draftWritten", draft: draft.id },
    { actor: agent.id, type: "approvalAsked", draft: draft.id, approval },
    { actor: sponsor!.id, type: "approvalDecided", draft: draft.id, approval, decision: "rejected", note: "Say Tuesday." },
    { actor: agent.id, type: "draftChanged", draft: draft.id },
    { actor: agent.id, type: "approvalAsked", draft: draft.id, approval: second },
    { actor: agent.id, type: "draftChanged", draft: draft.id },
    { actor: agent.id, type: "approvalWithdrawn", draft: draft.id, approval: second },
  ]);
});

test("only the mailbox's owner edits or asks to send its drafts, and its sponsor reads them", async () => {
  const { ada, draftParams, params } = await withAskedReply();

  const edit = await ada.PATCH("/mailboxes/{mailbox}/drafts/{draft}", { params: draftParams, body: { text: "Mine now." } });
  const ask = await ada.POST("/mailboxes/{mailbox}/drafts/{draft}/send", { params: draftParams });
  const read = await ada.GET("/mailboxes/{mailbox}/drafts", { params });

  expect([edit.response.status, ask.response.status, read.response.status]).toEqual([403, 403, 200]);
  expect(read.data?.drafts).toHaveLength(1);
});

test("a change and a decision at the same time leave the draft either withdrawn or rejected, as the decision says", async () => {
  const { ada, hermes, draftParams, approval } = await withAskedReply();

  const [decision, change] = await Promise.all([
    ada.POST("/approvals/{approval}/reject", { params: { path: { approval } }, body: { note: "Say Tuesday." } }),
    hermes.PATCH("/mailboxes/{mailbox}/drafts/{draft}", { params: draftParams, body: { text: "Tuesday works." } }),
  ]);

  expect(change.response.status).toBe(200);
  const { data: draft } = await hermes.GET("/mailboxes/{mailbox}/drafts/{draft}", { params: draftParams });
  expect(draft?.text).toBe("Tuesday works.");
  expect(draft?.send?.state).toBe(decision.response.status === 200 ? "rejected" : "withdrawn");
  expect((await ada.GET("/approvals")).data).toEqual({ approvals: [] });
});
