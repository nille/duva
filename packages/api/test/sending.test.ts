import PostalMime from "postal-mime";
import { expect, test } from "vitest";
import { type DuvaOptions, startDuva } from "./harness.ts";

/**
 * A deployment on example.com where ada, the first admin, has a personal mailbox at ada@example.com,
 * without a Screener, and sponsors the agent Hermes, which she gives send sponsor access there.
 * Grace is another human.
 */
async function withMailbox(options: DuvaOptions = {}) {
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org"], ...options });
  const ada = duva.signIn("ada@example.org");
  const { data: sponsor } = await ada.GET("/whoami");
  const { data: created } = await ada.POST("/agents", { body: { name: "Hermes" } });
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: sponsor!.id, address: "ada@example.com" } });
  const params = { path: { mailbox: mailbox!.id } };
  // Mail from first-time senders would wait in the Screener, which these tests leave out.
  await ada.PATCH("/mailboxes/{mailbox}/screener", { params, body: { on: false } });
  await ada.PATCH("/agents/{agent}/settings", { params: { path: { agent: created!.agent.id } }, body: { sponsorAccess: "send" } });
  const hermes = duva.withKey(created!.key);

  /** Drafts the body and asks to send it, and returns the draft and the approval it waits for. */
  const ask = async (body: { answers?: string; to?: string[]; subject?: string; text: string }) => {
    const { data: draft } = await hermes.POST("/mailboxes/{mailbox}/drafts", { params, body });
    const draftParams = { path: { ...params.path, draft: draft!.id } };
    const { data: asked } = await hermes.POST("/mailboxes/{mailbox}/drafts/{draft}/send", { params: draftParams });
    return { draft: draft!, draftParams, approval: asked!.send!.approval! };
  };
  return { duva, ada, hermes, agent: created!.agent, sponsor: sponsor!, mailbox: mailbox!, params, ask };
}

/** Grace's message to Ada, which answers an earlier one, received and read as the agent reads it. */
async function withReplyAsked(options: DuvaOptions = {}) {
  const setup = await withMailbox(options);
  const { duva, hermes, params, ask } = setup;
  await duva.receive(
    "From: Grace Hopper <grace@example.org>\r\nTo: ada+meetings@example.com\r\nSubject: Meeting\r\n" +
      "Date: Sat, 03 Oct 2026 10:00:00 +0000\r\nMessage-ID: <meet-2@example.org>\r\nReferences: <meet-0@example.org> <meet-1@example.org>\r\n" +
      "In-Reply-To: <meet-1@example.org>\r\n\r\nCan we meet on Monday?\r\n",
    { to: ["ada+meetings@example.com"] },
  );
  const { data: list } = await hermes.GET("/mailboxes/{mailbox}/threads", { params });
  const thread = list!.threads[0]!.id;
  const { data: read } = await hermes.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { ...params.path, thread } } });
  const original = read!.messages[0]!;
  return { ...setup, thread, original, ...(await ask({ answers: original.id, text: "Monday works." })) };
}

const parse = (raw: string) => PostalMime.parse(raw);
const header = async (raw: string, name: string) => (await parse(raw)).headers.find((field) => field.key === name.toLowerCase())?.value;

test("the sponsor sends the reply as is, and it goes out as a reply in the thread, from the address the original was sent to", async () => {
  const { duva, ada, approval } = await withReplyAsked();

  const { response, data } = await ada.POST("/approvals/{approval}/send", { params: { path: { approval } } });

  expect(response.status).toBe(202);
  expect(data).toMatchObject({ id: approval, state: "approved", decidedAt: expect.any(String) });
  expect(data).not.toHaveProperty("edits");
  const [raw, ...more] = duva.sent();
  expect(more).toEqual([]);
  const mail = await parse(raw!);
  expect(mail.from).toEqual({ name: "", address: "ada+meetings@example.com" });
  expect(mail.to).toEqual([{ name: "Grace Hopper", address: "grace@example.org" }]);
  expect(mail.subject).toBe("Re: Meeting");
  // SES gives the message its own Message-ID in place of Duva's.
  expect(mail.messageId).toMatch(/^<[\w-]+@eu-north-1\.amazonses\.com>$/);
  expect(mail.inReplyTo).toBe("<meet-2@example.org>");
  expect(mail.references).toBe("<meet-0@example.org> <meet-1@example.org> <meet-2@example.org>");
});

test("a sent reply gives its thread the snippet, as the recipients read it, and leaves the thread's read state as it was", async () => {
  const { ada, hermes, params, thread, approval } = await withReplyAsked();
  await hermes.POST("/mailboxes/{mailbox}/threads/read", { params, body: { threads: [thread] } });

  await ada.POST("/approvals/{approval}/send", { params: { path: { approval } } });

  const { data } = await hermes.GET("/mailboxes/{mailbox}/threads", { params });
  expect(data?.threads).toMatchObject([{ id: thread, messages: 2, snippet: "Monday works. Sent by Hermes for ada@example.org", unread: false }]);
});

test("a reply to a message with In-Reply-To but no References continues from its In-Reply-To", async () => {
  const { duva, ada, hermes, params, ask } = await withMailbox();
  await duva.receive(
    "From: grace@example.org\r\nTo: ada@example.com\r\nSubject: Meeting\r\nMessage-ID: <meet-2@example.org>\r\nIn-Reply-To: <meet-1@example.org>\r\n\r\nMonday?\r\n",
    { to: ["ada@example.com"] },
  );
  const { data: changes } = await hermes.GET("/mailboxes/{mailbox}/changes", { params });
  const { approval } = await ask({ answers: (changes!.changes.find(({ type }) => type === "messageReceived") as { message: string }).message, text: "Monday works." });

  await ada.POST("/approvals/{approval}/send", { params: { path: { approval } } });

  expect((await parse(duva.sent()[0]!)).references).toBe("<meet-1@example.org> <meet-2@example.org>");
});

test("every message the agent sends carries the disclosure header and a visible line naming the agent and whom it acts for", async () => {
  const { duva, ada, approval } = await withReplyAsked();

  await ada.POST("/approvals/{approval}/send", { params: { path: { approval } } });

  const [raw] = duva.sent();
  expect(await header(raw!, "Duva-Agent")).toBe("Hermes for ada@example.org");
  expect((await parse(raw!)).text).toBe("Monday works.\n\nSent by Hermes for ada@example.org\n");
});

test("the sponsor edits the draft and sends their version, which still carries the disclosure", async () => {
  const { duva, ada, hermes, draftParams, approval } = await withReplyAsked();

  const { response, data } = await ada.POST("/approvals/{approval}/send", {
    params: { path: { approval } },
    body: { to: ["grace@example.org", "ada@example.org"], subject: "Re: Meeting on Tuesday", text: "Tuesday works better." },
  });

  expect(response.status).toBe(202);
  expect(data).toMatchObject({
    state: "approved",
    draft: { text: "Monday works." },
    edits: { to: [{ address: "grace@example.org" }, { address: "ada@example.org" }], subject: "Re: Meeting on Tuesday", text: "Tuesday works better." },
  });
  const mail = await parse(duva.sent()[0]!);
  expect(mail.to?.map(({ address }) => address)).toEqual(["grace@example.org", "ada@example.org"]);
  expect(mail.subject).toBe("Re: Meeting on Tuesday");
  expect(mail.text).toBe("Tuesday works better.\n\nSent by Hermes for ada@example.org\n");
  expect(await header(duva.sent()[0]!, "Duva-Agent")).toBe("Hermes for ada@example.org");
  const { data: draft } = await hermes.GET("/mailboxes/{mailbox}/drafts/{draft}", { params: draftParams });
  expect(draft).toMatchObject({ subject: "Re: Meeting on Tuesday", text: "Tuesday works better." });
});

test("the agent sees its send as sent, with the Message-ID SES gave it, which the recipient sees", async () => {
  const { duva, ada, hermes, thread, draftParams, approval } = await withReplyAsked();

  await ada.POST("/approvals/{approval}/send", { params: { path: { approval } } });

  const { data } = await hermes.GET("/mailboxes/{mailbox}/drafts/{draft}", { params: draftParams });
  const { messageId } = await parse(duva.sent()[0]!);
  expect(data?.send).toEqual({ approval, state: "sent", thread, message: expect.any(String), messageId });
});

test("the sent message joins the thread, and a reply to it joins the thread too", async () => {
  const { duva, ada, hermes, agent, sponsor, params, thread, original, draftParams, approval } = await withReplyAsked();
  await ada.POST("/approvals/{approval}/send", { params: { path: { approval } } });
  const { messageId } = await parse(duva.sent()[0]!);

  await duva.receive(
    `From: Grace Hopper <grace@example.org>\r\nTo: ada@example.com\r\nSubject: Re: Meeting\r\nMessage-ID: <meet-3@example.org>\r\nIn-Reply-To: ${messageId}\r\n\r\nSee you then.\r\n`,
    { to: ["ada@example.com"] },
  );

  const { data: read } = await hermes.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { ...params.path, thread } } });
  const { data: draft } = await hermes.GET("/mailboxes/{mailbox}/drafts/{draft}", { params: draftParams });
  expect(read?.messages.map(({ id }) => id)).toEqual([original.id, draft!.send!.message, expect.any(String)]);
  expect(read?.messages[1]).toEqual({
    id: draft!.send!.message,
    messageId,
    from: { address: "ada+meetings@example.com" },
    to: [{ name: "Grace Hopper", address: "grace@example.org" }],
    cc: [],
    recipient: "ada+meetings@example.com",
    subject: "Re: Meeting",
    date: expect.any(String),
    receivedAt: expect.any(String),
    sentBy: agent.id,
    fromAgent: true,
    approval: { id: approval, approver: sponsor.id, approvedAt: expect.any(String) },
    text: "Monday works.\n\nSent by Hermes for ada@example.org",
    attachments: [],
  });
  expect(read?.messages[2]?.text).toBe("See you then.");
});

test("a sent message names who approved it and when", async () => {
  const { ada, hermes, sponsor, params, thread, approval } = await withReplyAsked();
  const { data: decided } = await ada.POST("/approvals/{approval}/send", { params: { path: { approval } } });

  const { data: read } = await hermes.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { ...params.path, thread } } });

  expect(read?.messages[0]).not.toHaveProperty("approval");
  expect(read?.messages[1]?.approval).toEqual({ id: approval, approver: sponsor.id, approvedAt: decided!.decidedAt });
});

test("a message the sponsor edited before sending names what they changed", async () => {
  const { ada, params, thread, approval } = await withReplyAsked();
  await ada.POST("/approvals/{approval}/send", { params: { path: { approval } }, body: { subject: "Re: Meeting on Tuesday", text: "Tuesday works better." } });

  const { data: read } = await ada.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { ...params.path, thread } } });

  expect(read?.messages[1]?.approval?.edits).toEqual({ subject: "Re: Meeting on Tuesday", text: "Tuesday works better." });
  expect(read?.messages[1]?.text).toBe("Tuesday works better.\n\nSent by Hermes for ada@example.org");
});

test("a new message goes out from the default address without threading headers, and starts its own thread", async () => {
  const { duva, ada, hermes, params, ask } = await withMailbox();
  const { draftParams, approval } = await ask({ to: ["grace@example.org"], subject: "Hello", text: "Hej Grace." });

  await ada.POST("/approvals/{approval}/send", { params: { path: { approval } } });

  const mail = await parse(duva.sent()[0]!);
  expect(mail.from).toEqual({ name: "", address: "ada@example.com" });
  expect([mail.inReplyTo, mail.references]).toEqual([undefined, undefined]);
  const { data: draft } = await hermes.GET("/mailboxes/{mailbox}/drafts/{draft}", { params: draftParams });
  const { data: thread } = await hermes.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { ...params.path, thread: draft!.send!.thread! } } });
  expect(thread).toMatchObject({ subject: "Hello", labels: [], messages: [{ id: draft!.send!.message, text: "Hej Grace.\n\nSent by Hermes for ada@example.org" }] });
});

test("names and subjects outside ASCII go out as encoded words", async () => {
  const { duva, ada, ask } = await withMailbox();
  const { approval } = await ask({ to: ["grace@example.org"], subject: "Möte på måndag, om du har tid för en längre pratstund om allt som hänt", text: "Hej Grace, ses vi på måndag?" });

  await ada.POST("/approvals/{approval}/send", { params: { path: { approval } } });

  const raw = duva.sent()[0]!;
  expect(raw).toMatch(/^[\x00-\x7f]*$/);
  // SES writes the Message-ID line, longer than that, itself.
  expect(raw.split("\r\n").filter((line) => !line.startsWith("Message-ID: ")).every((line) => line.length <= 78)).toBe(true);
  const mail = await parse(raw);
  expect(mail.subject).toBe("Möte på måndag, om du har tid för en längre pratstund om allt som hänt");
  // A base64 body keeps the CRLF line breaks of text's canonical form.
  expect(mail.text?.replaceAll("\r\n", "\n")).toBe("Hej Grace, ses vi på måndag?\n\nSent by Hermes for ada@example.org");
});

test("a send SES refuses is marked failed with SES's reason, which the agent and the sponsor see", async () => {
  const { duva, ada, hermes, ask } = await withMailbox({ sandbox: true });
  const { draftParams, approval } = await ask({ to: ["grace@example.org"], subject: "Hello", text: "Hej Grace." });

  await ada.POST("/approvals/{approval}/send", { params: { path: { approval } } });

  const byAgent = await hermes.GET("/mailboxes/{mailbox}/drafts/{draft}", { params: draftParams });
  const bySponsor = await ada.GET("/mailboxes/{mailbox}/drafts/{draft}", { params: draftParams });
  const failed = { approval, state: "failed", reason: "Email address is not verified. The following identities failed the check in region EU-NORTH-1: grace@example.org" };
  expect(byAgent.data?.send).toEqual(failed);
  expect(bySponsor.data?.send).toEqual(failed);
  expect(duva.sent()).toEqual([]);
});

test("in the SES sandbox, mail to an address on the domain still goes out", async () => {
  const { duva, ada, hermes, ask } = await withMailbox({ sandbox: true });
  const { draftParams, approval } = await ask({ to: ["iris@example.com"], subject: "Hello", text: "Hej Iris." });

  await ada.POST("/approvals/{approval}/send", { params: { path: { approval } } });

  expect(duva.sent()).toHaveLength(1);
  expect((await hermes.GET("/mailboxes/{mailbox}/drafts/{draft}", { params: draftParams })).data?.send?.state).toBe("sent");
});

test("the agent revises a failed send and asks again", async () => {
  const { ada, hermes, ask } = await withMailbox({ sandbox: true });
  const { draftParams, approval } = await ask({ to: ["grace@example.org"], subject: "Hello", text: "Hej Grace." });
  await ada.POST("/approvals/{approval}/send", { params: { path: { approval } } });

  await hermes.PATCH("/mailboxes/{mailbox}/drafts/{draft}", { params: draftParams, body: { to: ["iris@example.com"] } });
  const again = await hermes.POST("/mailboxes/{mailbox}/drafts/{draft}/send", { params: draftParams });

  expect(again.response.status).toBe(202);
  expect(again.data?.send).toEqual({ approval: expect.not.stringMatching(approval), state: "waiting" });
});

test("a retried stream record never sends the message twice", async () => {
  const { duva, ada, hermes, draftParams, approval } = await withReplyAsked({ senderInvocations: 3 });

  await ada.POST("/approvals/{approval}/send", { params: { path: { approval } } });

  expect(duva.sent()).toHaveLength(1);
  expect((await hermes.GET("/mailboxes/{mailbox}/drafts/{draft}", { params: draftParams })).data?.send?.state).toBe("sent");
});

test("when SES's answer is lost, the send is marked for a human to check and never sent again", async () => {
  const { duva, ada, hermes, draftParams, approval } = await withReplyAsked({ sesAnswersLost: true, senderInvocations: 2 });

  await ada.POST("/approvals/{approval}/send", { params: { path: { approval } } });

  expect(duva.sent()).toHaveLength(1);
  expect((await hermes.GET("/mailboxes/{mailbox}/drafts/{draft}", { params: draftParams })).data?.send).toEqual({ approval, state: "unclear" });
});

test("an approved draft can't change or be asked to send again", async () => {
  const { ada, hermes, draftParams, approval } = await withReplyAsked();
  await ada.POST("/approvals/{approval}/send", { params: { path: { approval } } });

  const change = await hermes.PATCH("/mailboxes/{mailbox}/drafts/{draft}", { params: draftParams, body: { text: "Tuesday instead." } });
  const ask = await hermes.POST("/mailboxes/{mailbox}/drafts/{draft}/send", { params: draftParams });

  expect([change.response.status, ask.response.status]).toEqual([409, 409]);
  expect(change.error?.message).toMatch(/was sent/);
});

test("of a send and a rejection at the same time, exactly one wins, and the message goes out at most once", async () => {
  const { duva, ada, hermes, draftParams, approval } = await withReplyAsked();

  const decisions = await Promise.all([
    ada.POST("/approvals/{approval}/send", { params: { path: { approval } } }),
    ada.POST("/approvals/{approval}/reject", { params: { path: { approval } }, body: { note: "Say Tuesday." } }),
    ada.POST("/approvals/{approval}/send", { params: { path: { approval } } }),
  ]);

  const won = decisions.filter(({ response }) => response.status < 300);
  expect(won).toHaveLength(1);
  expect(decisions.filter(({ response }) => response.status === 409)).toHaveLength(2);
  const { data: draft } = await hermes.GET("/mailboxes/{mailbox}/drafts/{draft}", { params: draftParams });
  expect(duva.sent()).toHaveLength(draft?.send?.state === "sent" ? 1 : 0);
  expect(draft?.send?.state).toBe(won[0]!.response.status === 202 ? "sent" : "rejected");
});

test("an agent can't send its own approval, and nor can anyone but the sponsor", async () => {
  const { duva, hermes, approval } = await withReplyAsked();

  const own = await hermes.POST("/approvals/{approval}/send", { params: { path: { approval } } });
  const byOther = await duva.signIn("grace@example.org").POST("/approvals/{approval}/send", { params: { path: { approval } } });

  expect([own.response.status, byOther.response.status]).toEqual([403, 403]);
  expect(duva.sent()).toEqual([]);
});

test("a send with a recipient that isn't an address is refused", async () => {
  const { ada, approval } = await withReplyAsked();

  const { response, error } = await ada.POST("/approvals/{approval}/send", { params: { path: { approval } }, body: { to: ["grace"] } });

  expect(response.status).toBe(400);
  expect(error?.message).toMatch(/"grace" isn't an email address/);
});

test("the change feed records the decision with the edit under the sponsor, and the send under the agent", async () => {
  const { ada, hermes, agent, sponsor, params, thread, draft, approval } = await withReplyAsked();
  await ada.POST("/approvals/{approval}/send", { params: { path: { approval } }, body: { text: "Tuesday works better." } });

  const { data } = await hermes.GET("/mailboxes/{mailbox}/changes", { params });

  const { data: sent } = await hermes.GET("/mailboxes/{mailbox}/drafts/{draft}", { params: { path: { ...params.path, draft: draft.id } } });
  expect(data?.changes.slice(-2).map(({ position, at, ...change }) => change)).toEqual([
    { actor: sponsor.id, type: "approvalDecided", draft: draft.id, approval, decision: "approved", edits: { text: "Tuesday works better." } },
    { actor: agent.id, type: "messageSent", draft: draft.id, thread, message: sent!.send!.message },
  ]);
});

test("a failed send is in the change feed under the agent, with SES's reason", async () => {
  const { ada, hermes, agent, params, ask } = await withMailbox({ sandbox: true });
  const { draft, approval } = await ask({ to: ["grace@example.org"], subject: "Hello", text: "Hej." });
  await ada.POST("/approvals/{approval}/send", { params: { path: { approval } } });

  const { data } = await hermes.GET("/mailboxes/{mailbox}/changes", { params });

  expect(data?.changes.at(-1)).toMatchObject({ actor: agent.id, type: "sendFailed", draft: draft.id, approval, reason: expect.stringMatching(/not verified/) });
});

/** Grace's own mailbox at grace@example.com, without a Screener, with what lies in it: its threads in All mail, and each one's messages. */
async function withRecipientsMailbox() {
  const setup = await withMailbox();
  const { duva, ada } = setup;
  const grace = duva.signIn("grace@example.org");
  const { data: graceActor } = await grace.GET("/whoami");
  const { data: own } = await ada.POST("/mailboxes", { body: { owner: graceActor!.id, address: "grace@example.com" } });
  const graceParams = { path: { mailbox: own!.id } };
  await grace.PATCH("/mailboxes/{mailbox}/screener", { params: graceParams, body: { on: false } });
  const inGraces = async () => {
    const { data } = await grace.GET("/mailboxes/{mailbox}/all-mail", { params: graceParams });
    const threads = data!.threads;
    const read = await Promise.all(threads.map(({ id }) => grace.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { ...graceParams.path, thread: id } } })));
    return { threads, messages: read.flatMap(({ data }) => data!.messages) };
  };
  return { ...setup, grace, graceParams, inGraces };
}

test("a message an agent sent says so in the recipient's own mailbox and in the sponsor's, and its thread says so", async () => {
  const { duva, ada, hermes, params, ask, inGraces } = await withRecipientsMailbox();
  const { approval } = await ask({ to: ["grace@example.com"], subject: "Notes", text: "Here are the notes." });
  await ada.POST("/approvals/{approval}/send", { params: { path: { approval } } });

  await duva.receive(duva.sent()[0]!, { to: ["grace@example.com"] });

  const received = await inGraces();
  expect(received.threads).toMatchObject([{ subject: "Notes", fromAgent: true }]);
  expect(received.messages).toMatchObject([{ from: { address: "ada@example.com" }, fromAgent: true }]);
  const { data: sent } = await hermes.GET("/mailboxes/{mailbox}/sent", { params });
  expect(sent!.threads).toMatchObject([{ subject: "Notes", fromAgent: true }]);
  const { data: thread } = await ada.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { ...params.path, thread: sent!.threads[0]!.id } } });
  expect(thread!.messages).toMatchObject([{ fromAgent: true }]);
});

test("the disclosure header counts only on mail from the organization's own domain with a DMARC pass", async () => {
  const { duva, inGraces } = await withRecipientsMailbox();
  const mail = (from: string, subject: string) => `From: ${from}\r\nTo: grace@example.com\r\nSubject: ${subject}\r\nDuva-Agent: Hermes for ada@example.org\r\n\r\nHello.\r\n`;

  await duva.receive(mail("<ada@example.com>", "Forged"), { to: ["grace@example.com"] }, { verdicts: { dmarc: "FAIL" } });
  await duva.receive(mail("<ada@example.net>", "Elsewhere"), { to: ["grace@example.com"] });
  await duva.receive("From: Linus <linus@example.com>\r\nTo: grace@example.com\r\nSubject: Lunch\r\n\r\nLunch?\r\n", { to: ["grace@example.com"] });
  await duva.receive("From: Linus <linus@example.com>\r\nTo: grace@example.com\r\nSubject: Empty\r\nDuva-Agent: \r\n\r\nHello.\r\n", { to: ["grace@example.com"] });

  const { threads, messages } = await inGraces();
  expect(threads).toHaveLength(4);
  for (const each of [...threads, ...messages]) expect(each).not.toHaveProperty("fromAgent");
});

test("the sponsor's own send from their mailbox doesn't say an agent sent it", async () => {
  const { duva, ada, params, inGraces } = await withRecipientsMailbox();
  const { data: draft } = await ada.POST("/mailboxes/{mailbox}/drafts", { params, body: { to: ["grace@example.com"], subject: "Hi", text: "Hello." } });
  await ada.POST("/mailboxes/{mailbox}/drafts/{draft}/send", { params: { path: { ...params.path, draft: draft!.id } } });

  await duva.receive(duva.sent()[0]!, { to: ["grace@example.com"] });

  const { data: sent } = await ada.GET("/mailboxes/{mailbox}/sent", { params });
  const { threads, messages } = await inGraces();
  expect(threads).toMatchObject([{ subject: "Hi" }]);
  for (const each of [...sent!.threads, ...threads, ...messages]) expect(each).not.toHaveProperty("fromAgent");
});
