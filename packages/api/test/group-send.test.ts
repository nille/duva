import PostalMime from "postal-mime";
import { expect, test } from "vitest";
import { type DuvaOptions, startDuva } from "./harness.ts";

type Client = ReturnType<Awaited<ReturnType<typeof startDuva>>["signIn"]>;
type Params = { path: { mailbox: string } };

/**
 * A deployment on example.com where ada, the first admin, sponsors the agent Hermes, which owns a
 * mailbox at hermes@example.com. Grace is a human with a mailbox at grace@example.com, and ada has
 * one at ada@example.com. The group team@example.com has Grace, Hermes and the external
 * linus@example.net as members, and ada isn't one.
 */
async function withTeam(options: DuvaOptions = {}) {
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org"], ...options });
  const ada = duva.signIn("ada@example.org");
  const grace = duva.signIn("grace@example.org");
  const { data: created } = await ada.POST("/agents", { body: { name: "Hermes" } });
  const { data: hermesMailbox } = await ada.POST("/mailboxes", { body: { owner: created!.agent.id, address: "hermes@example.com" } });
  const { data: me } = await grace.GET("/whoami");
  const { data: sponsor } = await ada.GET("/whoami");
  const { data: gracesMailbox } = await ada.POST("/mailboxes", { body: { owner: me!.id, address: "grace@example.com" } });
  const { data: adasMailbox } = await ada.POST("/mailboxes", { body: { owner: sponsor!.id, address: "ada@example.com" } });
  await ada.POST("/groups", { body: { address: "team@example.com", members: ["grace@example.com", "hermes@example.com", "linus@example.net"] } });
  const hermes = duva.withKey(created!.key);
  const hermess = { path: { mailbox: hermesMailbox!.id } };
  const graces = { path: { mailbox: gracesMailbox!.id } };
  const adas = { path: { mailbox: adasMailbox!.id } };
  return { duva, ada, grace, hermes, hermess, graces, adas, graceId: me!.id, agentId: created!.agent.id };
}

/** A customer's question to the team, received, and the copy of it in Grace's mailbox. */
async function withQuestion(options: DuvaOptions = {}) {
  const team = await withTeam(options);
  const { duva, grace, graces } = team;
  await duva.receive(
    "From: Customer <customer@example.net>\r\nTo: team@example.com\r\nSubject: Broken invoice\r\nMessage-ID: <question@example.net>\r\n\r\nMy invoice is wrong.\r\n",
    { to: ["team@example.com"] },
  );
  const [question] = await messagesIn(grace, graces);
  // The question was re-sent to the external member, so what members send comes after it.
  const sentAfter = () => duva.sent().slice(1);
  const sentToAfter = () => duva.sentTo().slice(1);
  return { ...team, question: question!, sentAfter, sentToAfter };
}

/** The messages in the mailbox's threads with the label, or in All mail, newest thread first, each thread's oldest first. */
async function messagesIn(client: Client, params: Params, label = "inbox") {
  const { data } =
    label === "all" ? await client.GET("/mailboxes/{mailbox}/all-mail", { params }) : await client.GET("/mailboxes/{mailbox}/threads", { params: { ...params, query: { label } } });
  const threads = await Promise.all((data?.threads ?? []).map(({ id }) => client.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { ...params.path, thread: id } } })));
  return threads.flatMap(({ data: thread }) => thread?.messages ?? []);
}

/** Drafts the body in the mailbox and sends it, and returns the draft as sending left it. */
async function draftAndSend(client: Client, params: Params, body: Record<string, unknown>) {
  const { data: draft } = await client.POST("/mailboxes/{mailbox}/drafts", { params, body });
  const draftParams = { path: { ...params.path, draft: draft!.id } };
  const sent = await client.POST("/mailboxes/{mailbox}/drafts/{draft}/send", { params: draftParams });
  return { draft: draft!, draftParams, sent };
}

const parse = (raw: string) => PostalMime.parse(raw);

test("a member's mailbox shows the groups its owner can send as, nested ones included, and another's shows none", async () => {
  const { ada, grace, graces, adas } = await withTeam();
  await ada.POST("/groups", { body: { address: "all@example.com", members: ["team@example.com"] } });

  const { data: mailbox } = await grace.GET("/mailboxes/{mailbox}", { params: graces });
  const { data: listed } = await grace.GET("/mailboxes");
  const { data: adasMailbox } = await ada.GET("/mailboxes/{mailbox}", { params: adas });

  expect(mailbox?.groups).toEqual(["all@example.com", "team@example.com"]);
  expect(listed?.mailboxes).toMatchObject([{ id: graces.path.mailbox, groups: ["all@example.com", "team@example.com"] }]);
  expect(adasMailbox?.groups).toEqual([]);
});

test("a reply to group mail goes from the member's own address unless they choose the group", async () => {
  const { grace, graces, question } = await withQuestion();

  const { data: own } = await grace.POST("/mailboxes/{mailbox}/drafts", { params: graces, body: { answers: question.id } });
  const { data: asGroup } = await grace.POST("/mailboxes/{mailbox}/drafts", { params: graces, body: { answers: question.id, from: "Team@Example.com" } });

  expect(own).toMatchObject({ from: "grace@example.com", to: [{ name: "Customer", address: "customer@example.net" }] });
  expect(asGroup).toMatchObject({ from: "team@example.com", to: [{ name: "Customer", address: "customer@example.net" }] });
});

test("a member's reply as the group goes out from the group, and each other local member gets a copy in the thread naming the sender", async () => {
  const { grace, hermes, graces, hermess, graceId, question, sentAfter, sentToAfter } = await withQuestion();

  const { sent } = await draftAndSend(grace, graces, { answers: question.id, from: "team@example.com", text: "We'll fix it today." });

  expect(sent.response.status).toBe(202);
  const [raw, ...more] = sentAfter();
  expect(more).toEqual([]);
  const mail = await parse(raw!);
  expect(mail.from?.address).toBe("team@example.com");
  expect(mail.inReplyTo).toBe("<question@example.net>");
  // External members get no copy of what a member sends as the group.
  expect(sentToAfter()).toEqual([["customer@example.net"]]);
  const copies = await messagesIn(hermes, hermess);
  expect(copies).toHaveLength(2);
  expect(copies[1]).toMatchObject({
    messageId: mail.messageId,
    from: { address: "team@example.com" },
    to: [{ name: "Customer", address: "customer@example.net" }],
    subject: "Re: Broken invoice",
    sentAs: { group: "team@example.com", by: graceId, name: "grace@example.org" },
  });
  expect(copies[1]?.text.trim()).toBe("We'll fix it today.");
  expect(copies[1]).not.toHaveProperty("sentBy");
  const own = await messagesIn(grace, graces);
  expect(own).toHaveLength(2);
  expect(own[1]).toMatchObject({ from: { address: "team@example.com" }, sentBy: graceId });
  expect(own[1]).not.toHaveProperty("sentAs");
});

test("the customer's answer to a reply sent as the group joins each member's thread", async () => {
  const { duva, grace, hermes, graces, hermess, question, sentAfter } = await withQuestion();
  await draftAndSend(grace, graces, { answers: question.id, from: "team@example.com", text: "We'll fix it today." });
  const { messageId } = await parse(sentAfter()[0]!);

  await duva.receive(
    `From: customer@example.net\r\nTo: team@example.com\r\nSubject: Re: Broken invoice\r\nMessage-ID: <thanks@example.net>\r\nIn-Reply-To: ${messageId}\r\n\r\nThanks!\r\n`,
    { to: ["team@example.com"] },
  );

  for (const [client, params] of [[grace, graces], [hermes, hermess]] as const) {
    expect((await messagesIn(client, params)).map(({ text }) => text.trim())).toEqual(["My invoice is wrong.", "We'll fix it today.", "Thanks!"]);
  }
});

test("a member the message also goes to directly gets it once, as SES delivers it", async () => {
  const { duva, grace, hermes, graces, hermess, question, sentAfter } = await withQuestion();

  await draftAndSend(grace, graces, { answers: question.id, from: "team@example.com", cc: ["hermes@example.com"], text: "We'll fix it today." });
  await duva.receive(sentAfter()[0]!, { from: "bounces@mail.example.com", to: ["hermes@example.com"] });

  const messages = await messagesIn(hermes, hermess);
  expect(messages.map(({ text }) => text.trim())).toEqual(["My invoice is wrong.", "We'll fix it today."]);
  expect(messages[1]).not.toHaveProperty("sentAs");
});

test("a reply to another member's copy goes to its recipients, and a reply to all leaves the group out", async () => {
  const { grace, hermes, graces, hermess, question } = await withQuestion();
  await draftAndSend(grace, graces, { answers: question.id, from: "team@example.com", text: "We'll fix it today." });
  const [, copy] = await messagesIn(hermes, hermess);
  const [received] = await messagesIn(hermes, hermess);

  const { data: reply } = await hermes.POST("/mailboxes/{mailbox}/drafts", { params: hermess, body: { answers: copy!.id } });
  const { data: all } = await hermes.POST("/mailboxes/{mailbox}/drafts", { params: hermess, body: { answers: received!.id, replyAll: true, from: "team@example.com" } });

  expect(reply).toMatchObject({ from: "hermes@example.com", to: [{ name: "Customer", address: "customer@example.net" }], cc: [] });
  expect(all).toMatchObject({ from: "team@example.com", to: [{ name: "Customer", address: "customer@example.net" }], cc: [] });
});

test("a new message sent as the group starts a thread in each other member's All mail, out of their Inbox", async () => {
  const { grace, hermes, graces, hermess } = await withTeam();

  await draftAndSend(grace, graces, { from: "team@example.com", to: ["customer@example.net"], subject: "Planned outage", text: "On Sunday." });

  expect(await messagesIn(hermes, hermess)).toEqual([]);
  expect((await messagesIn(hermes, hermess, "all")).map(({ subject, sentAs }) => ({ subject, group: sentAs?.group }))).toEqual([
    { subject: "Planned outage", group: "team@example.com" },
  ]);
});

test("an agent that is a member sends as the group with its sponsor's approval, and with the disclosure", async () => {
  const { ada, grace, hermes, graces, hermess, agentId, sentAfter } = await withQuestion();
  const [question] = await messagesIn(hermes, hermess);

  const { sent } = await draftAndSend(hermes, hermess, { answers: question!.id, from: "team@example.com", text: "Looking into it." });

  expect(sent.data?.send?.state).toBe("waiting");
  expect(sentAfter()).toEqual([]);
  await ada.POST("/approvals/{approval}/send", { params: { path: { approval: sent.data!.send!.approval! } } });
  const mail = await parse(sentAfter()[0]!);
  expect(mail.from).toEqual({ name: "Hermes", address: "team@example.com" });
  expect(mail.headers.find(({ key }) => key === "duva-agent")?.value).toBe("Hermes for ada@example.org");
  expect(mail.text).toBe("Looking into it.\n\nSent by Hermes for ada@example.org\n");
  const copies = await messagesIn(grace, graces);
  expect(copies[1]).toMatchObject({ from: { name: "Hermes", address: "team@example.com" }, sentAs: { group: "team@example.com", by: agentId, name: "Hermes" } });
});

test("a paused agent's send as the group is held, with no copies, until it is unpaused", async () => {
  const { duva, ada, grace, hermes, graces, hermess, agentId, sentAfter } = await withQuestion({ sendsHeld: true });
  await duva.releaseSends();
  const [question] = await messagesIn(hermes, hermess);
  const { sent } = await draftAndSend(hermes, hermess, { answers: question!.id, from: "team@example.com", text: "Looking into it." });
  await ada.POST("/approvals/{approval}/send", { params: { path: { approval: sent.data!.send!.approval! } } });
  const agent = { params: { path: { agent: agentId } } };
  await ada.POST("/agents/{agent}/pause", agent);

  await duva.releaseSends();
  expect(sentAfter()).toEqual([]);
  expect(await messagesIn(grace, graces)).toHaveLength(1);

  await ada.POST("/agents/{agent}/unpause", agent);
  await duva.releaseSends();
  expect((await parse(sentAfter()[0]!)).from?.address).toBe("team@example.com");
  expect((await messagesIn(grace, graces))[1]).toMatchObject({ sentAs: { group: "team@example.com", by: agentId, name: "Hermes" } });
});

test("only a group's members can send as it, others get 403, and an address that is neither the mailbox's nor a group can't be From", async () => {
  const { ada, grace, adas, graces, question } = await withQuestion();
  await ada.POST("/groups", { body: { address: "others@example.com", members: ["ada@example.com"] } });

  const asked = await ada.POST("/mailboxes/{mailbox}/drafts", { params: adas, body: { from: "team@example.com", to: ["customer@example.net"] } });
  const { data: draft } = await grace.POST("/mailboxes/{mailbox}/drafts", { params: graces, body: { answers: question.id } });
  const changed = await grace.PATCH("/mailboxes/{mailbox}/drafts/{draft}", { params: { path: { ...graces.path, draft: draft!.id } }, body: { from: "others@example.com" } });
  const elsewhere = await grace.POST("/mailboxes/{mailbox}/drafts", { params: graces, body: { from: "ada@example.com" } });

  expect(asked.response.status).toBe(403);
  expect(asked.error?.message).toMatch(/team@example\.com/);
  expect(changed.response.status).toBe(403);
  expect(elsewhere.response.status).toBe(400);
  expect(elsewhere.error?.message).toMatch(/ada@example\.com/);
});

test("a draft from the group goes out only while its owner is still a member", async () => {
  const { duva, ada, grace, graces, question, sentAfter } = await withQuestion({ sendsHeld: true });
  const { draft } = await draftAndSend(grace, graces, { answers: question.id, from: "team@example.com", text: "Fixed." });
  const { data: later } = await grace.POST("/mailboxes/{mailbox}/drafts", { params: graces, body: { answers: question.id, from: "team@example.com", text: "Fixed again." } });

  await ada.PATCH("/groups/{group}", { params: { path: { group: "team@example.com" } }, body: { members: ["hermes@example.com"] } });
  await duva.releaseSends();
  const refused = await grace.POST("/mailboxes/{mailbox}/drafts/{draft}/send", { params: { path: { ...graces.path, draft: later!.id } } });

  expect(sentAfter()).toEqual([]);
  const { data: failed } = await grace.GET("/mailboxes/{mailbox}/drafts/{draft}", { params: { path: { ...graces.path, draft: draft.id } } });
  expect(failed?.send).toMatchObject({ state: "failed", reason: expect.stringMatching(/team@example\.com/) });
  expect(refused.response.status).toBe(403);
});

test("each member gets one copy, however often Lambda runs the sender", async () => {
  const { grace, hermes, graces, hermess, question } = await withQuestion({ senderInvocations: 2 });

  await draftAndSend(grace, graces, { answers: question.id, from: "team@example.com", text: "We'll fix it today." });

  expect(await messagesIn(hermes, hermess)).toHaveLength(2);
});

test("a member erasing their copy leaves the sent message and the other copies", async () => {
  const { duva, ada, grace, hermes, graces, hermess, adas, question } = await withQuestion();
  await ada.PATCH("/groups/{group}", { params: { path: { group: "team@example.com" } }, body: { members: ["grace@example.com", "hermes@example.com", "ada@example.com"] } });
  await draftAndSend(grace, graces, { answers: question.id, from: "team@example.com", text: "We'll fix it today." });
  const stored = duva.stored().filter((raw) => raw.includes("We'll fix it today."));
  const [thread] = (await ada.GET("/mailboxes/{mailbox}/all-mail", { params: adas })).data!.threads;

  await ada.POST("/mailboxes/{mailbox}/threads/labels", { params: adas, body: { threads: [thread!.id], add: ["trash"] } });
  await ada.POST("/mailboxes/{mailbox}/trash/empty", { params: adas });

  expect(stored).toHaveLength(3);
  expect(duva.stored().filter((raw) => raw.includes("We'll fix it today."))).toHaveLength(2);
  expect((await messagesIn(grace, graces)).map(({ text }) => text.trim())).toContain("We'll fix it today.");
  expect((await messagesIn(hermes, hermess)).map(({ text }) => text.trim())).toContain("We'll fix it today.");
});
