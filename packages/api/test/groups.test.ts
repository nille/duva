import PostalMime from "postal-mime";
import { expect, test } from "vitest";
import { startDuva } from "./harness.ts";

/**
 * A deployment on example.com where ada is the first admin and sponsors the agent Hermes, which
 * owns no mailbox. Grace and Alan are humans with mailboxes at grace@example.com and
 * alan@example.com, their Screeners on as a human's is by default.
 */
async function withMembers() {
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org", "alan@example.org"] });
  const ada = duva.signIn("ada@example.org");
  const grace = duva.signIn("grace@example.org");
  const alan = duva.signIn("alan@example.org");
  const { data: created } = await ada.POST("/agents", { body: { name: "Hermes" } });
  const { data: graceActor } = await grace.GET("/whoami");
  const { data: alanActor } = await alan.GET("/whoami");
  const { data: gracesMailbox } = await ada.POST("/mailboxes", { body: { owner: graceActor!.id, address: "grace@example.com" } });
  const { data: alansMailbox } = await ada.POST("/mailboxes", { body: { owner: alanActor!.id, address: "alan@example.com" } });
  const hermes = duva.withKey(created!.key);
  const graces = { path: { mailbox: gracesMailbox!.id } };
  const alans = { path: { mailbox: alansMailbox!.id } };
  return { duva, ada, grace, alan, hermes, graces, alans };
}

const message = (from: string, to: string, subject = "Hello") =>
  `From: ${from}\r\nTo: ${to}\r\nSubject: ${subject}\r\nMessage-ID: <${subject.replaceAll(" ", "-")}@mail.test>\r\n\r\nHej.\r\n`;

/** The messages in the mailbox's threads with the label, newest thread first. */
async function messagesIn(client: ReturnType<Awaited<ReturnType<typeof startDuva>>["signIn"]>, params: { path: { mailbox: string } }, label = "inbox") {
  const { data } = await client.GET("/mailboxes/{mailbox}/threads", { params: { ...params, query: { label } } });
  const threads = await Promise.all((data?.threads ?? []).map(({ id }) => client.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { ...params.path, thread: id } } })));
  return threads.flatMap(({ data: thread }) => thread?.messages ?? []);
}

test("each local member's mailbox gets one copy of mail to the group, marked with the group", async () => {
  const { duva, ada, grace, alan, alans, graces } = await withMembers();

  const { response, data } = await ada.POST("/groups", { body: { address: "Team@Example.com", members: ["grace@example.com", "Alan@example.com"] } });

  expect(response.status).toBe(201);
  expect(data).toEqual({ address: "team@example.com", members: ["grace@example.com", "alan@example.com"], sendPolicy: "anyone", replyTo: "sender" });
  const { refused } = await duva.receive(message("linus@example.net", "team@example.com"), { to: ["team+news@example.com"] });
  expect(refused).toEqual([]);
  for (const [client, params] of [[grace, graces], [alan, alans]] as const) {
    const messages = await messagesIn(client, params);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ group: "team@example.com", recipient: "team+news@example.com", plusTag: "news", from: { address: "linus@example.net" } });
  }
  expect(duva.sent()).toEqual([]);
});

test("group mail skips a member's Screener, while mail sent to them directly still waits there", async () => {
  const { duva, ada, grace, graces } = await withMembers();
  await ada.POST("/groups", { body: { address: "team@example.com", members: ["grace@example.com"] } });

  await duva.receive(message("linus@example.net", "team@example.com", "To the team"), { to: ["team@example.com"] });
  await duva.receive(message("linus@example.net", "grace@example.com", "To Grace"), { to: ["grace@example.com"] });

  expect((await messagesIn(grace, graces)).map(({ subject }) => subject)).toEqual(["To the team"]);
  const { data: screener } = await grace.GET("/mailboxes/{mailbox}/screener", { params: graces });
  expect(screener?.senders.flatMap(({ threads }) => threads.map(({ subject }) => subject))).toEqual(["To Grace"]);
});

test("mail to a group that also names a member directly reaches the member once, as mail to them", async () => {
  const { duva, ada, grace, graces } = await withMembers();
  await ada.POST("/groups", { body: { address: "team@example.com", members: ["grace@example.com"] } });
  await grace.PATCH("/mailboxes/{mailbox}/screener", { params: graces, body: { on: false } });

  await duva.receive(message("linus@example.net", "team@example.com, grace@example.com"), { to: ["team@example.com", "grace@example.com"] });

  const messages = await messagesIn(grace, graces);
  expect(messages).toHaveLength(1);
  expect(messages[0]?.recipient).toBe("grace@example.com");
  expect(messages[0]?.group).toBeUndefined();
});

test("a member that is a group expands, and a mailbox that is a member several ways gets one copy, marked with the group mailed", async () => {
  const { duva, ada, grace, alan, alans, graces } = await withMembers();
  await ada.POST("/groups", { body: { address: "crew@example.com", members: ["alan@example.com", "grace@example.com"] } });
  await ada.POST("/groups", { body: { address: "all@example.com", members: ["crew@example.com", "grace@example.com"] } });

  await duva.receive(message("linus@example.net", "all@example.com"), { to: ["all@example.com"] });

  for (const [client, params] of [[grace, graces], [alan, alans]] as const) {
    const messages = await messagesIn(client, params);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.group).toBe("all@example.com");
  }
});

test("groups that are each other's members deliver once to each mailbox", async () => {
  const { duva, ada, grace, graces } = await withMembers();
  await ada.POST("/groups", { body: { address: "one@example.com", members: ["grace@example.com"] } });
  await ada.POST("/groups", { body: { address: "two@example.com", members: ["one@example.com"] } });
  await ada.PATCH("/groups/{group}", { params: { path: { group: "one@example.com" } }, body: { members: ["grace@example.com", "two@example.com"] } });

  await duva.receive(message("linus@example.net", "two@example.com"), { to: ["two@example.com"] });

  expect(await messagesIn(grace, graces)).toHaveLength(1);
});

test("external members get the mail re-sent from the group, as the sender via the group, with Reply-To the original sender", async () => {
  const { duva, ada } = await withMembers();
  await ada.POST("/groups", { body: { address: "team@example.com", members: ["grace@example.com", "Mia@Example.net", "noah@example.org"] } });
  const raw =
    "DKIM-Signature: v=1; a=rsa-sha256; d=example.net; s=s1; b=abc\r\nReturn-Path: <bounces@example.net>\r\nFrom: Linus <linus@example.net>\r\nSender: list@example.net\r\nTo: team@example.com\r\nSubject: Hello\r\nMessage-ID: <hello@example.net>\r\n\r\nHej.\r\n";

  await duva.receive(raw, { to: ["team@example.com"] });

  expect(duva.sentTo()).toEqual([["mia@example.net", "noah@example.org"]]);
  const resent = await PostalMime.parse(duva.sent()[0]!);
  expect(resent.from).toEqual({ name: "Linus via team", address: "team@example.com" });
  expect(resent.replyTo).toEqual([{ name: "Linus", address: "linus@example.net" }]);
  expect(resent.to).toEqual([{ name: "", address: "team@example.com" }]);
  expect(resent.subject).toBe("Hello");
  expect(duva.sent()[0]).toMatch(/\r\n\r\nHej\.\r\n$/);
  const names = resent.headers.map(({ key }) => key);
  for (const gone of ["dkim-signature", "return-path", "sender", "x-ses-spam-verdict", "authentication-results"]) expect(names).not.toContain(gone);
});

test("a group can send external members' replies to the group instead, and keeps the original's Reply-To otherwise", async () => {
  const { duva, ada } = await withMembers();
  await ada.POST("/groups", { body: { address: "team@example.com", members: ["mia@example.net"], replyTo: "group" } });
  await ada.POST("/groups", { body: { address: "news@example.com", members: ["mia@example.net"] } });
  const withReplyTo = "From: linus@example.net\r\nReply-To: Desk <desk@example.net>\r\nTo: news@example.com\r\nSubject: News\r\n\r\nHej.\r\n";

  await duva.receive(message("linus@example.net", "team@example.com"), { to: ["team@example.com"] });
  await duva.receive(withReplyTo, { to: ["news@example.com"] });

  const [toTeam, toNews] = await Promise.all(duva.sent().map((raw) => PostalMime.parse(raw)));
  expect(toTeam?.from).toEqual({ name: "linus@example.net via team", address: "team@example.com" });
  expect(toTeam?.replyTo).toEqual([{ name: "", address: "team@example.com" }]);
  expect(toNews?.replyTo).toEqual([{ name: "Desk", address: "desk@example.net" }]);
});

test("a nested group's external members get the copy re-sent from the group mailed, once each", async () => {
  const { duva, ada } = await withMembers();
  await ada.POST("/groups", { body: { address: "inner@example.com", members: ["mia@example.net"] } });
  await ada.POST("/groups", { body: { address: "outer@example.com", members: ["inner@example.com", "mia@example.net"] } });

  await duva.receive(message("linus@example.net", "outer@example.com"), { to: ["outer@example.com"] }, { invocations: 2 });

  expect(duva.sentTo()).toEqual([["mia@example.net"]]);
  expect((await PostalMime.parse(duva.sent()[0]!)).from?.address).toBe("outer@example.com");
});

test("the group's own copy coming back to it, as from an external member forwarding to it, reaches no one again", async () => {
  const { duva, ada, grace, graces } = await withMembers();
  await grace.PATCH("/mailboxes/{mailbox}/screener", { params: graces, body: { on: false } });
  await ada.POST("/groups", { body: { address: "team@example.com", members: ["grace@example.com", "mia@example.net"] } });
  await duva.receive(message("linus@example.net", "team@example.com", "Original"), { to: ["team@example.com"] });

  await duva.receive(duva.sent()[0]!, { from: "mia@example.net", to: ["team@example.com"] });

  expect(duva.sent()).toHaveLength(1);
  expect((await messagesIn(grace, graces)).map(({ subject }) => subject)).toEqual(["Original"]);
});

test("spam to a group lands in each local member's Spam, and isn't re-sent to external members", async () => {
  const { duva, ada, grace, graces } = await withMembers();
  await ada.POST("/groups", { body: { address: "team@example.com", members: ["grace@example.com", "mia@example.net"] } });

  await duva.receive(message("linus@example.net", "team@example.com"), { to: ["team@example.com"] }, { verdicts: { spam: "FAIL" } });

  expect(await messagesIn(grace, graces, "spam")).toHaveLength(1);
  expect(duva.sent()).toEqual([]);
});

test("a group open to the organization bounces mail from outside it, and from a forged sender on its domain", async () => {
  const { duva, ada, grace, graces } = await withMembers();
  await grace.PATCH("/mailboxes/{mailbox}/screener", { params: graces, body: { on: false } });
  await ada.POST("/groups", { body: { address: "staff@example.com", members: ["grace@example.com", "mia@example.net"], sendPolicy: "organization" } });

  const outside = await duva.receive(message("linus@example.net", "staff@example.com", "Outside"), { to: ["staff@example.com"] });
  const forged = await duva.receive(message("alan@example.com", "staff@example.com", "Forged"), { to: ["staff@example.com"] }, { verdicts: { dmarc: "FAIL", dmarcPolicy: "none" } });
  await duva.receive(message("alan@example.com", "staff@example.com", "Inside"), { from: "alan@example.com", to: ["staff@example.com"] });

  expect(duva.bounces()).toEqual([
    { messageId: outside.messageId, to: "linus@example.net", from: "MAILER-DAEMON@eu-north-1.amazonses.com", recipients: ["staff@example.com"], explanation: expect.stringMatching(/organization/) },
    { messageId: forged.messageId, to: "alan@example.com", from: "MAILER-DAEMON@eu-north-1.amazonses.com", recipients: ["staff@example.com"], explanation: expect.stringMatching(/organization/) },
  ]);
  expect((await messagesIn(grace, graces)).map(({ subject }) => subject)).toEqual(["Inside"]);
  expect(duva.sentTo()).toEqual([["mia@example.net"]]);
});

test("a group open to its members takes mail from them, those of its nested groups and external ones included, and bounces the rest", async () => {
  const { duva, ada, grace, graces } = await withMembers();
  await grace.PATCH("/mailboxes/{mailbox}/screener", { params: graces, body: { on: false } });
  await ada.POST("/groups", { body: { address: "crew@example.com", members: ["alan@example.com"] } });
  await ada.POST("/groups", { body: { address: "family@example.com", members: ["grace@example.com", "crew@example.com", "mia@example.net"], sendPolicy: "members" } });

  await duva.receive(message("mia@example.net", "family@example.com", "From Mia"), { to: ["family@example.com"] });
  await duva.receive(message("alan@example.com", "family@example.com", "From Alan"), { to: ["family@example.com"] });
  const stranger = await duva.receive(message("linus@example.net", "family@example.com, grace@example.com", "From Linus"), { to: ["family@example.com", "grace@example.com"] });

  expect((await messagesIn(grace, graces)).map(({ subject, group }) => [subject, group])).toEqual([
    ["From Linus", undefined],
    ["From Alan", "family@example.com"],
    ["From Mia", "family@example.com"],
  ]);
  expect(duva.bounces()).toEqual([{ messageId: stranger.messageId, to: "linus@example.net", from: "MAILER-DAEMON@eu-north-1.amazonses.com", recipients: ["family@example.com"], explanation: expect.stringMatching(/members/) }]);
});

test("a member's mailbox sends to a members-only group from any of its addresses, but only with a DMARC pass", async () => {
  const { duva, ada, alan, alans, graces } = await withMembers();
  await ada.POST("/addresses", { body: { address: "g@example.com", mailbox: graces.path.mailbox } });
  await ada.POST("/groups", { body: { address: "family@example.com", members: ["grace@example.com", "alan@example.com"], sendPolicy: "members" } });

  await duva.receive(message("g@example.com", "family@example.com", "From G"), { to: ["family@example.com"] });
  await duva.receive(message("grace@example.com", "family@example.com", "Forged"), { to: ["family@example.com"] }, { verdicts: { dmarc: "GRAY" } });

  expect((await messagesIn(alan, alans)).map(({ subject }) => subject)).toEqual(["From G"]);
  expect(duva.bounces().map(({ recipients }) => recipients)).toEqual([["family@example.com"]]);
});

test("a member mailing its group gets no copy of its own mail, sent from Duva or elsewhere, while forged mail still reaches it", async () => {
  const { duva, ada, grace, alan, alans, graces } = await withMembers();
  await grace.PATCH("/mailboxes/{mailbox}/screener", { params: graces, body: { on: false } });
  await ada.POST("/addresses", { body: { address: "g@example.com", mailbox: graces.path.mailbox } });
  await ada.POST("/groups", { body: { address: "team@example.com", members: ["grace@example.com", "alan@example.com"] } });

  await duva.receive(message("G@example.com", "team@example.com", "From G"), { from: "bounces@mail.example.com", to: ["team@example.com"] });
  await duva.receive(message("linus@example.net", "team@example.com", "From Linus"), { from: "g@example.com", to: ["team@example.com"] });
  await duva.receive(message("mia@example.net", "team@example.com", "From Mia"), { from: "g@example.com", to: ["team@example.com"] }, { verdicts: { spf: "FAIL" } });
  const { data: draft } = await grace.POST("/mailboxes/{mailbox}/drafts", { params: graces, body: { to: ["team@example.com"], subject: "Sent by Grace", text: "Hej." } });
  await grace.POST("/mailboxes/{mailbox}/drafts/{draft}/send", { params: { path: { ...graces.path, draft: draft!.id } } });
  // SES's copy coming back to the group, its DMARC unsettled.
  await duva.receive(duva.sent()[0]!, { from: "bounces@mail.example.com", to: ["team@example.com"] }, { verdicts: { dmarc: "GRAY" } });
  await duva.receive(message("grace@example.com", "team@example.com", "Forged"), { from: "spam@example.net", to: ["team@example.com"] }, { verdicts: { dmarc: "GRAY" } });

  expect((await messagesIn(alan, alans)).map(({ subject }) => subject)).toEqual(["Forged", "Sent by Grace", "From Mia", "From Linus", "From G"]);
  // An envelope sender counts only with an SPF pass, and a From only with a DMARC pass.
  expect((await messagesIn(grace, graces)).map(({ subject }) => subject)).toEqual(["Forged", "From Mia"]);
  const { data: sent } = await grace.GET("/mailboxes/{mailbox}/sent", { params: graces });
  expect(sent?.threads).toMatchObject([{ subject: "Sent by Grace", messages: 1 }]);
});

test("removing an address, or deleting a group, takes it out of every group it was a member of", async () => {
  const { ada, graces } = await withMembers();
  await ada.POST("/addresses", { body: { address: "support@example.com", mailbox: graces.path.mailbox } });
  await ada.POST("/groups", { body: { address: "inner@example.com", members: ["grace@example.com"] } });
  await ada.POST("/groups", { body: { address: "team@example.com", members: ["support@example.com", "inner@example.com", "alan@example.com"] } });

  await ada.DELETE("/addresses/{address}", { params: { path: { address: "support@example.com" } } });
  await ada.DELETE("/groups/{group}", { params: { path: { group: "inner@example.com" } } });

  expect((await ada.GET("/groups/{group}", { params: { path: { group: "team@example.com" } } })).data?.members).toEqual(["alan@example.com"]);
  const { data: feed } = await ada.GET("/organization/changes");
  expect(feed?.changes.filter(({ type }) => type === "groupChanged")).toHaveLength(2);
});

test("a bounced message is bounced once, however often Lambda runs its event", async () => {
  const { duva, ada } = await withMembers();
  await ada.POST("/groups", { body: { address: "staff@example.com", members: ["grace@example.com"], sendPolicy: "organization" } });

  await duva.receive(message("linus@example.net", "staff@example.com"), { to: ["staff@example.com"] }, { invocations: 3 });

  expect(duva.bounces()).toHaveLength(1);
});

test("an admin changes a group's members and policy, and deletes it, each a change in the organization's feed", async () => {
  const { duva, ada, alan, alans, graces } = await withMembers();
  const { data: before } = await ada.GET("/organization/changes");
  const group = { path: { group: "Team@example.com" } };
  await ada.POST("/groups", { body: { address: "team@example.com", members: ["alan@example.com"] } });

  const changed = await ada.PATCH("/groups/{group}", { params: group, body: { members: ["grace@example.com", "alan@example.com", "grace@example.com"], sendPolicy: "members" } });

  expect(changed.data).toEqual({ address: "team@example.com", members: ["grace@example.com", "alan@example.com"], sendPolicy: "members", replyTo: "sender" });
  expect((await ada.GET("/groups/{group}", { params: group })).data).toEqual(changed.data);
  await duva.receive(message("grace@example.com", "team@example.com", "Mine"), { to: ["team@example.com"] });
  expect((await messagesIn(alan, alans)).map(({ subject }) => subject)).toEqual(["Mine"]);

  const deleted = await ada.DELETE("/groups/{group}", { params: group });

  expect(deleted.data).toEqual(changed.data);
  expect((await duva.receive(message("grace@example.com", "team@example.com"), { to: ["team@example.com"] })).refused).toEqual(["team@example.com"]);
  expect((await ada.GET("/groups/{group}", { params: group })).response.status).toBe(404);
  const { data: me } = await ada.GET("/whoami");
  const { data: feed } = await ada.GET("/organization/changes", { params: { query: { after: before!.position } } });
  expect(feed?.changes).toEqual([
    expect.objectContaining({ type: "groupAdded", actor: me!.id, group: { address: "team@example.com", members: ["alan@example.com"], sendPolicy: "anyone", replyTo: "sender" } }),
    expect.objectContaining({ type: "groupChanged", actor: me!.id, group: changed.data }),
    expect.objectContaining({ type: "groupRemoved", actor: me!.id, address: "team@example.com" }),
  ]);
  // The address is free at once.
  expect((await ada.POST("/addresses", { body: { address: "team@example.com", mailbox: graces.path.mailbox } })).response.status).toBe(201);
});

test("an admin lists the groups, and their addresses among the organization's", async () => {
  const { ada, graces, alans } = await withMembers();
  await ada.POST("/groups", { body: { address: "team@example.com", members: ["grace@example.com"] } });
  await ada.POST("/groups", { body: { address: "all@example.com", members: ["team@example.com"], sendPolicy: "organization", replyTo: "group" } });

  expect((await ada.GET("/groups")).data).toEqual({
    groups: [
      { address: "all@example.com", members: ["team@example.com"], sendPolicy: "organization", replyTo: "group" },
      { address: "team@example.com", members: ["grace@example.com"], sendPolicy: "anyone", replyTo: "sender" },
    ],
  });
  expect((await ada.GET("/addresses")).data?.addresses).toEqual([
    { address: "alan@example.com", mailbox: alans.path.mailbox },
    { address: "all@example.com", group: true },
    { address: "grace@example.com", mailbox: graces.path.mailbox },
    { address: "team@example.com", group: true },
  ]);
});

test("only an admin creates, reads, changes and deletes groups", async () => {
  const { ada, grace, hermes } = await withMembers();
  await ada.POST("/groups", { body: { address: "team@example.com", members: ["grace@example.com"] } });
  const group = { path: { group: "team@example.com" } };

  for (const actor of [grace, hermes]) {
    const statuses = [
      await actor.POST("/groups", { body: { address: "mine@example.com", members: ["grace@example.com"] } }),
      await actor.GET("/groups"),
      await actor.GET("/groups/{group}", { params: group }),
      await actor.PATCH("/groups/{group}", { params: group, body: { sendPolicy: "members" } }),
      await actor.DELETE("/groups/{group}", { params: group }),
    ].map(({ response }) => response.status);
    expect(statuses).toEqual([403, 403, 403, 403, 403]);
  }
  expect((await ada.GET("/groups/{group}", { params: group })).data?.sendPolicy).toBe("anyone");
});

test.each([
  ["a local member that isn't one of the organization's addresses", { address: "team@example.com", members: ["nobody@example.com"] }, 400, /nobody@example.com/],
  ["a plus-tagged local member", { address: "team@example.com", members: ["grace+team@example.com"] }, 400, /plus tag/],
  ["a member that isn't an address", { address: "team@example.com", members: ["grace"] }, 400, /grace/],
  ["the group as its own member", { address: "team@example.com", members: ["team@example.com"] }, 400, /itself/],
  ["an address on another domain", { address: "team@example.net", members: ["grace@example.com"] }, 400, /example.com/],
  ["an address in use", { address: "grace@example.com", members: ["alan@example.com"] }, 409, /taken/],
] as const)("a group with %s is refused", async (_, body, status, message) => {
  const { ada } = await withMembers();

  const { response, error } = await ada.POST("/groups", { body: { ...body, members: [...body.members] } });

  expect(response.status).toBe(status);
  expect(error?.message).toMatch(message);
  expect((await ada.GET("/groups")).data?.groups).toEqual([]);
});

test("a group's address is removed by deleting the group, not as a mailbox's address", async () => {
  const { duva, ada } = await withMembers();
  await ada.POST("/groups", { body: { address: "team@example.com", members: ["grace@example.com"] } });

  const { response, error } = await ada.DELETE("/addresses/{address}", { params: { path: { address: "team@example.com" } } });

  expect(response.status).toBe(409);
  expect(error?.message).toMatch(/group/);
  expect((await duva.receive(message("linus@example.net", "team@example.com"), { to: ["team@example.com"] })).refused).toEqual([]);
});

test("changing a missing group is not found", async () => {
  const { ada } = await withMembers();

  const changed = await ada.PATCH("/groups/{group}", { params: { path: { group: "team@example.com" } }, body: { sendPolicy: "members" } });
  const deleted = await ada.DELETE("/groups/{group}", { params: { path: { group: "team@example.com" } } });

  expect([changed.response.status, deleted.response.status]).toEqual([404, 404]);
});

test("a thread of group mail is listed with the groups its mail came through", async () => {
  const { duva, ada, grace, graces } = await withMembers();
  await ada.POST("/groups", { body: { address: "team@example.com", members: ["grace@example.com"] } });
  await ada.POST("/groups", { body: { address: "support@example.com", members: ["grace@example.com"] } });

  await duva.receive(message("linus@example.net", "team@example.com", "To the team"), { to: ["team@example.com"] });
  await duva.receive(
    "From: linus@example.net\r\nTo: support@example.com\r\nSubject: Re: To the team\r\nMessage-ID: <again@mail.test>\r\nIn-Reply-To: <To-the-team@mail.test>\r\n\r\nHej.\r\n",
    { to: ["support@example.com"] },
  );
  await duva.receive(message("linus@example.net", "grace@example.com", "To Grace"), { to: ["grace@example.com"] });
  await grace.PUT("/mailboxes/{mailbox}/senders/{sender}", { params: { path: { ...graces.path, sender: "linus@example.net" } }, body: { delivery: "inbox" } });

  const { data } = await grace.GET("/mailboxes/{mailbox}/threads", { params: { ...graces, query: { label: "inbox" } } });

  expect(data?.threads.map(({ subject, groups }) => ({ subject, groups }))).toEqual([
    { subject: "To Grace", groups: undefined },
    { subject: "To the team", groups: ["team@example.com", "support@example.com"] },
  ]);
});
