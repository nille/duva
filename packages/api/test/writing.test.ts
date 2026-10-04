import PostalMime from "postal-mime";
import { expect, test } from "vitest";
import { type DuvaOptions, startDuva } from "./harness.ts";

/**
 * A deployment on example.com where ada, the first admin, added the human Linus and created his
 * personal mailbox at linus@example.com. Grace is another human.
 */
async function withHumansMailbox(options: DuvaOptions = {}) {
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org"], ...options });
  const ada = duva.signIn("ada@example.org");
  const { data: human } = await ada.POST("/humans", { body: { email: "linus@example.org" } });
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: human!.id, address: "linus@example.com" } });
  const linus = duva.signIn("linus@example.org");
  const params = { path: { mailbox: mailbox!.id } };

  /** Writes the draft and asks to send it, and returns the draft as it is once the send is done. */
  const send = async (body: Parameters<typeof draft>[0]) => {
    const written = await draft(body);
    const draftParams = { path: { ...params.path, draft: written.id } };
    const asked = await linus.POST("/mailboxes/{mailbox}/drafts/{draft}/send", { params: draftParams });
    const { data: done } = await linus.GET("/mailboxes/{mailbox}/drafts/{draft}", { params: draftParams });
    return { asked, draft: done!, draftParams };
  };
  const draft = async (body: { answers?: string; replyAll?: boolean; to?: string[]; cc?: string[]; bcc?: string[]; subject?: string; text?: string }) => {
    const { data } = await linus.POST("/mailboxes/{mailbox}/drafts", { params, body });
    return data!;
  };
  /** Hands SES the message for Linus's mailbox, and returns it as Linus reads it. */
  const receive = async (raw: string, to = "linus@example.com") => {
    await duva.receive(raw, { to: [to] });
    const { data: list } = await linus.GET("/mailboxes/{mailbox}/threads", { params });
    const { data: thread } = await linus.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { ...params.path, thread: list!.threads[0]!.id } } });
    return thread!.messages.at(-1)!;
  };
  return { duva, ada, linus, human: human!, mailbox: mailbox!, params, draft, send, receive };
}

/** Grace's message to Linus and Ada, copying Iris, which answers an earlier one. */
const fromGrace = [
  "From: Grace Hopper <grace@example.org>",
  "To: Linus <linus+lists@example.com>, ada@example.org",
  "Cc: Iris <iris@example.net>, LINUS@example.com",
  "Subject: Re: Möte",
  "Date: Sat, 03 Oct 2026 10:00:00 +0000",
  "Message-ID: <meet-2@example.org>",
  "In-Reply-To: <meet-1@example.org>",
  "References: <meet-0@example.org> <meet-1@example.org>",
  "MIME-Version: 1.0",
  "Content-Type: text/plain; charset=utf-8",
  "Content-Transfer-Encoding: 8bit",
  "",
  "Kan vi ses på måndag?",
].join("\r\n");

const parse = (raw: string) => PostalMime.parse(raw);
const addresses = (list: { address?: string }[] | undefined) => (list ?? []).map(({ address }) => address);

test("a human drafts a new message from their mailbox's default address, with To, Cc and Bcc", async () => {
  const { draft } = await withHumansMailbox();

  const written = await draft({ to: ["grace@example.org"], cc: ["ada@example.org"], bcc: ["iris@example.net"], subject: "Lunch", text: "Lunch på fredag?" });

  expect(written).toEqual({
    id: expect.any(String),
    from: "linus@example.com",
    to: [{ address: "grace@example.org" }],
    cc: [{ address: "ada@example.org" }],
    bcc: [{ address: "iris@example.net" }],
    subject: "Lunch",
    text: "Lunch på fredag?",
    updatedAt: expect.any(String),
  });
});

test("a draft is saved before it has recipients, a subject or text, and is listed", async () => {
  const { linus, params, draft } = await withHumansMailbox();

  const empty = await draft({});
  const { data: changed } = await linus.PATCH("/mailboxes/{mailbox}/drafts/{draft}", { params: { path: { ...params.path, draft: empty.id } }, body: { text: "Hej" } });

  expect(empty).toMatchObject({ from: "linus@example.com", to: [], cc: [], bcc: [], subject: "", text: "" });
  expect(changed).toMatchObject({ text: "Hej", to: [] });
  expect((await linus.GET("/mailboxes/{mailbox}/drafts", { params })).data).toEqual({ drafts: [changed] });
});

test("a human's reply goes from the address the original was sent to, plus tag kept, to its From, with a single Re:", async () => {
  const { draft, receive } = await withHumansMailbox();
  const original = await receive(fromGrace, "linus+lists@example.com");

  const reply = await draft({ answers: original.id, text: "Måndag passar." });

  expect(reply).toMatchObject({ from: "linus+lists@example.com", to: [{ name: "Grace Hopper", address: "grace@example.org" }], cc: [], bcc: [], subject: "Re: Möte" });
});

test("a reply to all goes to the sender and every other recipient, except the mailbox's own addresses", async () => {
  const { draft, receive } = await withHumansMailbox();
  const original = await receive(fromGrace, "linus+lists@example.com");

  const reply = await draft({ answers: original.id, replyAll: true, text: "Måndag passar." });

  expect(reply).toMatchObject({
    from: "linus+lists@example.com",
    to: [{ name: "Grace Hopper", address: "grace@example.org" }, { address: "ada@example.org" }],
    cc: [{ name: "Iris", address: "iris@example.net" }],
    bcc: [],
    subject: "Re: Möte",
  });
});

test("a reply to the human's own message goes to its recipients", async () => {
  const { linus, params, send, draft } = await withHumansMailbox();
  const { draft: sent } = await send({ to: ["grace@example.org"], cc: ["ada@example.org"], subject: "Lunch", text: "Lunch på fredag?" });
  const { data: thread } = await linus.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { ...params.path, thread: sent.send!.thread! } } });

  const reply = await draft({ answers: thread!.messages[0]!.id, replyAll: true, text: "Glömde säga: klockan tolv." });

  expect(reply).toMatchObject({ from: "linus@example.com", to: [{ address: "grace@example.org" }], cc: [{ address: "ada@example.org" }], subject: "Re: Lunch" });
});

test("a human's send goes out at once, with no approval, and records the Message-ID SES gave it", async () => {
  const { duva, ada, send } = await withHumansMailbox();

  const { asked, draft } = await send({ to: ["grace@example.org"], subject: "Lunch", text: "Lunch på fredag?" });

  expect(asked.response.status).toBe(202);
  expect(asked.data?.send).toEqual({ state: "approved" });
  expect(draft.send).toEqual({ state: "sent", thread: expect.any(String), message: expect.any(String), messageId: expect.stringMatching(/@eu-north-1\.amazonses\.com>$/) });
  expect((await ada.GET("/approvals")).data).toEqual({ approvals: [] });
  expect(duva.sent().map((raw) => raw.match(/^Message-ID: (.+)$/m)?.[1])).toEqual([draft.send!.messageId]);
});

test("a human's mail carries no disclosure, neither the header nor the line", async () => {
  const { duva, send } = await withHumansMailbox();

  await send({ to: ["grace@example.org"], subject: "Lunch", text: "Lunch på fredag?" });

  const mail = await parse(duva.sent()[0]!);
  expect(mail.from).toEqual({ address: "linus@example.com", name: "" });
  expect(addresses(mail.to)).toEqual(["grace@example.org"]);
  expect(mail.subject).toBe("Lunch");
  expect(mail.text).toBe("Lunch på fredag?");
  expect(mail.headers.map(({ key }) => key)).not.toContain("duva-agent");
});

test("a human's reply carries In-Reply-To and References, so it threads for the recipient", async () => {
  const { duva, send, receive } = await withHumansMailbox();
  const original = await receive(fromGrace, "linus+lists@example.com");

  await send({ answers: original.id, text: "Måndag passar." });

  const mail = await parse(duva.sent()[0]!);
  expect(mail.from?.address).toBe("linus+lists@example.com");
  expect(mail.subject).toBe("Re: Möte");
  expect(mail.inReplyTo).toBe("<meet-2@example.org>");
  expect(mail.references).toBe("<meet-0@example.org> <meet-1@example.org> <meet-2@example.org>");
});

test("a reply to all goes out to the sender and the other recipients, with Cc in its header", async () => {
  const { duva, send, receive } = await withHumansMailbox();
  const original = await receive(fromGrace, "linus+lists@example.com");

  await send({ answers: original.id, replyAll: true, text: "Måndag passar." });

  const [raw] = duva.sent();
  const mail = await parse(raw!);
  expect(addresses(mail.to)).toEqual(["grace@example.org", "ada@example.org"]);
  expect(addresses(mail.cc)).toEqual(["iris@example.net"]);
  expect(raw).not.toMatch(/linus@example\.com/i);
  expect(duva.sentTo()).toEqual([["grace@example.org", "ada@example.org", "iris@example.net"]]);
});

test("Bcc recipients get the mail, but no header names them", async () => {
  const { duva, linus, params, send } = await withHumansMailbox();

  const { draft } = await send({ to: ["grace@example.org"], cc: ["ada@example.org"], bcc: ["iris@example.net"], subject: "Lunch", text: "Lunch på fredag?" });

  const [raw] = duva.sent();
  const mail = await parse(raw!);
  expect(addresses(mail.cc)).toEqual(["ada@example.org"]);
  expect(raw).not.toMatch(/iris@example\.net/);
  expect(duva.sentTo()).toEqual([["grace@example.org", "ada@example.org", "iris@example.net"]]);
  const { data: thread } = await linus.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { ...params.path, thread: draft.send!.thread! } } });
  expect(thread?.messages[0]).toMatchObject({ to: [{ address: "grace@example.org" }], cc: [{ address: "ada@example.org" }], bcc: [{ address: "iris@example.net" }] });
});

test("the sent message joins its thread, which Sent lists, newest first, a page at a time", async () => {
  const { linus, human, params, send, receive } = await withHumansMailbox();
  const original = await receive(fromGrace, "linus+lists@example.com");
  await receive("From: grace@example.org\r\nTo: linus@example.com\r\nSubject: Unanswered\r\nMessage-ID: <other@example.org>\r\n\r\nHej.\r\n");
  const { draft: reply } = await send({ answers: original.id, text: "Måndag passar." });
  const { draft: lunch } = await send({ to: ["grace@example.org"], subject: "Lunch", text: "Lunch på fredag?" });

  const { data: thread } = await linus.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { ...params.path, thread: reply.send!.thread! } } });
  const first = await linus.GET("/mailboxes/{mailbox}/sent", { params: { ...params, query: { limit: 1 } } });
  const second = await linus.GET("/mailboxes/{mailbox}/sent", { params: { ...params, query: { limit: 1, after: first.data!.next } } });

  expect(thread?.messages.map(({ text, sentBy }) => ({ text, sentBy }))).toEqual([
    { text: "Kan vi ses på måndag?", sentBy: undefined },
    { text: "Måndag passar.", sentBy: human.id },
  ]);
  // Nobody approved it, so it names no approval.
  expect(thread?.messages[1]).not.toHaveProperty("approval");
  expect(first.data?.threads.map(({ id, subject }) => ({ id, subject }))).toEqual([{ id: lunch.send!.thread, subject: "Lunch" }]);
  expect(second.data?.threads.map(({ id, snippet }) => ({ id, snippet }))).toEqual([{ id: reply.send!.thread, snippet: "Måndag passar." }]);
  expect(second.data?.next).toBeUndefined();
});

test("only those who read the mailbox list its Sent", async () => {
  const { duva, ada, params } = await withHumansMailbox();

  const byAdmin = await ada.GET("/mailboxes/{mailbox}/sent", { params });
  const byGrace = await duva.signIn("grace@example.org").GET("/mailboxes/{mailbox}/sent", { params });
  const badCursor = await duva.signIn("linus@example.org").GET("/mailboxes/{mailbox}/sent", { params: { ...params, query: { after: "nope" } } });

  expect([byAdmin.response.status, byGrace.response.status, badCursor.response.status]).toEqual([403, 403, 400]);
});

test("a send SES refuses shows its reason, and the human changes the draft and sends it again", async () => {
  const { duva, linus, send } = await withHumansMailbox({ sandbox: true });

  const { draft, draftParams } = await send({ to: ["iris@example.net"], subject: "Lunch", text: "Lunch på fredag?" });
  await linus.PATCH("/mailboxes/{mailbox}/drafts/{draft}", { params: draftParams, body: { to: ["grace@example.com"] } });
  const again = await linus.POST("/mailboxes/{mailbox}/drafts/{draft}/send", { params: draftParams });
  const { data: revised } = await linus.GET("/mailboxes/{mailbox}/drafts/{draft}", { params: draftParams });

  expect(draft.send).toEqual({ state: "failed", reason: expect.stringMatching(/^Email address is not verified\..*iris@example\.net/) });
  expect(again.response.status).toBe(202);
  expect(revised?.send?.state).toBe("sent");
  expect(addresses((await parse(duva.sent()[0]!)).to)).toEqual(["grace@example.com"]);
});

test("a send whose answer from SES is lost is unclear, and is never sent again", async () => {
  const { duva, linus, send } = await withHumansMailbox({ sesAnswersLost: true, senderInvocations: 2 });

  const { draft, draftParams } = await send({ to: ["grace@example.org"], subject: "Lunch", text: "Lunch på fredag?" });
  const again = await linus.POST("/mailboxes/{mailbox}/drafts/{draft}/send", { params: draftParams });

  expect(draft.send).toEqual({ state: "unclear" });
  expect(again.response.status).toBe(409);
  expect(duva.sent()).toHaveLength(1);
});

test("a draft without a recipient in To can't be sent", async () => {
  const { duva, linus, params, draft } = await withHumansMailbox();
  const written = await draft({ bcc: ["iris@example.net"], subject: "Lunch", text: "Lunch på fredag?" });

  const { response, error } = await linus.POST("/mailboxes/{mailbox}/drafts/{draft}/send", { params: { path: { ...params.path, draft: written.id } } });

  expect(response.status).toBe(400);
  expect(error?.message).toMatch(/recipient in To/);
  expect(duva.sent()).toEqual([]);
});

test("the human deletes a draft, and it is no longer listed", async () => {
  const { linus, params, draft } = await withHumansMailbox();
  const written = await draft({ to: ["grace@example.org"], subject: "Lunch", text: "Lunch på fredag?" });
  const draftParams = { path: { ...params.path, draft: written.id } };

  const deleted = await linus.DELETE("/mailboxes/{mailbox}/drafts/{draft}", { params: draftParams });

  expect(deleted.response.status).toBe(200);
  expect(deleted.data).toEqual(written);
  expect((await linus.GET("/mailboxes/{mailbox}/drafts", { params })).data).toEqual({ drafts: [] });
  expect((await linus.GET("/mailboxes/{mailbox}/drafts/{draft}", { params: draftParams })).response.status).toBe(404);
  expect((await linus.DELETE("/mailboxes/{mailbox}/drafts/{draft}", { params: draftParams })).response.status).toBe(404);
});

test("only the mailbox's owner deletes its drafts", async () => {
  const { ada, duva, params, draft } = await withHumansMailbox();
  const written = await draft({ text: "Hej" });
  const draftParams = { path: { ...params.path, draft: written.id } };

  const byAdmin = await ada.DELETE("/mailboxes/{mailbox}/drafts/{draft}", { params: draftParams });
  const byGrace = await duva.signIn("grace@example.org").DELETE("/mailboxes/{mailbox}/drafts/{draft}", { params: draftParams });

  expect([byAdmin.response.status, byGrace.response.status]).toEqual([403, 403]);
});

test("writing, changing, sending and deleting drafts are in the mailbox's change feed, naming the human", async () => {
  const { linus, human, params, draft, send } = await withHumansMailbox();
  const deleting = await draft({ text: "Hej" });
  await linus.PATCH("/mailboxes/{mailbox}/drafts/{draft}", { params: { path: { ...params.path, draft: deleting.id } }, body: { subject: "Hej" } });
  await linus.DELETE("/mailboxes/{mailbox}/drafts/{draft}", { params: { path: { ...params.path, draft: deleting.id } } });
  const { draft: sent } = await send({ to: ["grace@example.org"], subject: "Lunch", text: "Lunch på fredag?" });

  const { data } = await linus.GET("/mailboxes/{mailbox}/changes", { params });

  expect(data?.changes.map(({ position: _position, at: _at, ...change }) => change)).toEqual([
    { actor: human.id, type: "draftWritten", draft: deleting.id },
    { actor: human.id, type: "draftChanged", draft: deleting.id },
    { actor: human.id, type: "draftDeleted", draft: deleting.id },
    { actor: human.id, type: "draftWritten", draft: sent.id },
    { actor: human.id, type: "sendAsked", draft: sent.id },
    { actor: human.id, type: "messageSent", draft: sent.id, thread: sent.send!.thread, message: sent.send!.message },
  ]);
});

test("an agent's draft with Cc and Bcc still waits for its sponsor, who sees every recipient, and goes out with the disclosure", async () => {
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org" });
  const ada = duva.signIn("ada@example.org");
  const { data: created } = await ada.POST("/agents", { body: { name: "Hermes" } });
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: created!.agent.id, address: "hermes@example.com" } });
  const hermes = duva.withKey(created!.key);
  const params = { path: { mailbox: mailbox!.id } };
  const { data: written } = await hermes.POST("/mailboxes/{mailbox}/drafts", { params, body: { to: ["grace@example.org"], cc: ["ada@example.org"], bcc: ["iris@example.net"], subject: "Hej", text: "Hej Grace." } });

  const { data: asked } = await hermes.POST("/mailboxes/{mailbox}/drafts/{draft}/send", { params: { path: { ...params.path, draft: written!.id } } });
  const { data: pending } = await ada.GET("/approvals");
  await ada.POST("/approvals/{approval}/send", { params: { path: { approval: asked!.send!.approval! } } });

  expect(asked?.send?.state).toBe("waiting");
  expect(pending?.approvals[0]?.draft).toMatchObject({ to: [{ address: "grace@example.org" }], cc: [{ address: "ada@example.org" }], bcc: [{ address: "iris@example.net" }] });
  const [raw] = duva.sent();
  expect(addresses((await parse(raw!)).cc)).toEqual(["ada@example.org"]);
  expect(raw).toMatch(/^Duva-Agent: Hermes for ada@example\.org$/m);
  expect(duva.sentTo()).toEqual([["grace@example.org", "ada@example.org", "iris@example.net"]]);
});

test("an approver can't change a draft's Cc or Bcc", async () => {
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org" });
  const ada = duva.signIn("ada@example.org");
  const { data: created } = await ada.POST("/agents", { body: { name: "Hermes" } });
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: created!.agent.id, address: "hermes@example.com" } });
  const hermes = duva.withKey(created!.key);
  const params = { path: { mailbox: mailbox!.id } };
  const { data: written } = await hermes.POST("/mailboxes/{mailbox}/drafts", { params, body: { to: ["grace@example.org"], subject: "Hej", text: "Hej Grace." } });
  const { data: asked } = await hermes.POST("/mailboxes/{mailbox}/drafts/{draft}/send", { params: { path: { ...params.path, draft: written!.id } } });

  const { response, error } = await ada.POST("/approvals/{approval}/send", { params: { path: { approval: asked!.send!.approval! } }, body: { bcc: ["iris@example.net"] } as never });

  expect(response.status).toBe(400);
  expect(error?.message).toMatch(/reject the draft with a note/);
  expect(duva.sent()).toEqual([]);
});

test("deleting an agent's draft that waits for approval withdraws the request", async () => {
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org" });
  const ada = duva.signIn("ada@example.org");
  const { data: created } = await ada.POST("/agents", { body: { name: "Hermes" } });
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: created!.agent.id, address: "hermes@example.com" } });
  const hermes = duva.withKey(created!.key);
  const params = { path: { mailbox: mailbox!.id } };
  const { data: written } = await hermes.POST("/mailboxes/{mailbox}/drafts", { params, body: { to: ["grace@example.org"], subject: "Hej", text: "Hej Grace." } });
  const draftParams = { path: { ...params.path, draft: written!.id } };
  const { data: asked } = await hermes.POST("/mailboxes/{mailbox}/drafts/{draft}/send", { params: draftParams });

  await hermes.DELETE("/mailboxes/{mailbox}/drafts/{draft}", { params: draftParams });

  expect((await ada.GET("/approvals")).data).toEqual({ approvals: [] });
  const decision = await ada.POST("/approvals/{approval}/send", { params: { path: { approval: asked!.send!.approval! } } });
  expect(decision.response.status).toBe(409);
  const { data: feed } = await hermes.GET("/mailboxes/{mailbox}/changes", { params });
  expect(feed?.changes.slice(-2).map(({ type }) => type)).toEqual(["draftDeleted", "approvalWithdrawn"]);
});
