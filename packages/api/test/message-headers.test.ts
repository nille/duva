import { expect, test } from "vitest";
import { startDuva } from "./harness.ts";

type Client = ReturnType<Awaited<ReturnType<typeof startDuva>>["signIn"]>;
type Params = { path: { mailbox: string } };

/**
 * A deployment on example.com where ada, the first admin, added the humans Linus, with a mailbox at
 * linus@example.com, and Joan, with one at joan@example.com, without Screeners. The group
 * team@example.com has both as members. Grace is a human without a mailbox.
 */
async function withMailboxes() {
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org"] });
  const ada = duva.signIn("ada@example.org");
  const mailboxOf = async (email: string, address: string) => {
    const { data: human } = await ada.POST("/humans", { body: { email } });
    const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: human!.id, address } });
    const client = duva.signIn(email);
    const params = { path: { mailbox: mailbox!.id } };
    // Mail from first-time senders would wait in the Screener, which these tests leave out.
    await client.PATCH("/mailboxes/{mailbox}/screener", { params, body: { on: false } });
    return { client, params };
  };
  const linus = await mailboxOf("linus@example.org", "linus@example.com");
  const joan = await mailboxOf("joan@example.org", "joan@example.com");
  await ada.POST("/groups", { body: { address: "team@example.com", members: ["linus@example.com", "joan@example.com"] } });
  const headers = (message: string, as: Client = linus.client, params: Params = linus.params) =>
    as.GET("/mailboxes/{mailbox}/messages/{message}/headers", { params: { path: { ...params.path, message } } });
  return { duva, ada, linus, joan, headers };
}

/** The messages in the mailbox's Inbox, Sent or All mail, newest thread first, each thread's oldest first. */
async function messagesIn({ client, params }: { client: Client; params: Params }, list: "inbox" | "sent" | "all" = "inbox") {
  const { data } = await client.GET(list === "inbox" ? "/mailboxes/{mailbox}/threads" : list === "sent" ? "/mailboxes/{mailbox}/sent" : "/mailboxes/{mailbox}/all-mail", { params });
  const threads = await Promise.all((data?.threads ?? []).map(({ id }) => client.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { ...params.path, thread: id } } })));
  return threads.flatMap(({ data: thread }) => thread?.messages ?? []);
}

/** Grace's message to Linus, as her server sent it on: with a Received of its own, folded fields, and encoded words in Swedish. */
const fromGrace = [
  "Received: from laptop.example.org (laptop.example.org [198.51.100.7])",
  "\tby mail.example.org with ESMTPSA id 4F2A1;",
  "\tFri, 09 Oct 2026 09:59:58 +0000",
  "DKIM-Signature: v=1; a=rsa-sha256; d=example.org; s=mail;",
  " h=from:to:subject:date; bh=YWJj; b=ZGVm",
  "From: =?UTF-8?Q?Grace_H=C3=B6pper?= <grace@example.org>",
  "To: Linus <linus@example.com>",
  "Subject: =?UTF-8?B?UsOka25pbmcgZsO2cg==?=",
  " =?UTF-8?Q?_oktober?=",
  "Date: Fri, 09 Oct 2026 09:59:57 +0000",
  "Message-ID: <invoice-10@example.org>",
  "X-Note: plain words that run on",
  "  over two lines",
  "MIME-Version: 1.0",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "Här är räkningen.",
  "",
].join("\r\n");

test("a received message's headers are every field as it came, in order, unfolded, with what SES added and encoded words decoded beside them", async () => {
  const { duva, linus, headers } = await withMailboxes();
  const at = new Date("2026-10-09T10:00:00Z");
  const { messageId: sesId } = await duva.receive(fromGrace, { from: "grace@example.org", to: ["linus@example.com"] }, { at });
  const [message] = await messagesIn(linus);

  const { response, data } = await headers(message!.id);

  expect(response.status).toBe(200);
  expect(data).toEqual({
    headers: [
      { name: "Return-Path", value: "<grace@example.org>" },
      {
        name: "Received",
        value: `from mail.example.net (mail.example.net [192.0.2.25]) by inbound-smtp.eu-north-1.amazonaws.com with SMTP id ${sesId} for linus@example.com; Fri, 09 Oct 2026 10:00:00 +0000 (UTC)`,
      },
      { name: "X-SES-Spam-Verdict", value: "PASS" },
      { name: "X-SES-Virus-Verdict", value: "PASS" },
      {
        name: "Received-SPF",
        value: "pass (spfCheck: domain of example.org designates 192.0.2.25 as permitted sender) client-ip=192.0.2.25; envelope-from=grace@example.org; helo=mail.example.net;",
      },
      { name: "Authentication-Results", value: "amazonses.com; spf=pass smtp.mailfrom=grace@example.org; dkim=pass header.i=@example.org; dmarc=pass header.from=example.org;" },
      { name: "Received", value: "from laptop.example.org (laptop.example.org [198.51.100.7])\tby mail.example.org with ESMTPSA id 4F2A1;\tFri, 09 Oct 2026 09:59:58 +0000" },
      { name: "DKIM-Signature", value: "v=1; a=rsa-sha256; d=example.org; s=mail; h=from:to:subject:date; bh=YWJj; b=ZGVm" },
      { name: "From", value: "=?UTF-8?Q?Grace_H=C3=B6pper?= <grace@example.org>", decoded: "Grace Höpper <grace@example.org>" },
      { name: "To", value: "Linus <linus@example.com>" },
      { name: "Subject", value: "=?UTF-8?B?UsOka25pbmcgZsO2cg==?= =?UTF-8?Q?_oktober?=", decoded: "Räkning för oktober" },
      { name: "Date", value: "Fri, 09 Oct 2026 09:59:57 +0000" },
      { name: "Message-ID", value: "<invoice-10@example.org>" },
      { name: "X-Note", value: "plain words that run on  over two lines" },
      { name: "MIME-Version", value: "1.0" },
      { name: "Content-Type", value: "text/plain; charset=utf-8" },
    ],
  });
});

test("each member's copy of mail to a group has the headers SES stored with it", async () => {
  const { duva, linus, joan, headers } = await withMailboxes();
  await duva.receive("From: customer@example.net\r\nTo: team@example.com\r\nSubject: Broken invoice\r\nMessage-ID: <question@example.net>\r\n\r\nMy invoice is wrong.\r\n", {
    to: ["team@example.com"],
  });
  const [toLinus] = await messagesIn(linus);
  const [toJoan] = await messagesIn(joan);

  const { data: linuses } = await headers(toLinus!.id);
  const { data: joans } = await headers(toJoan!.id, joan.client, joan.params);

  expect(linuses?.headers.map(({ name }) => name)).toEqual([
    "Return-Path",
    "Received",
    "X-SES-Spam-Verdict",
    "X-SES-Virus-Verdict",
    "Received-SPF",
    "Authentication-Results",
    "From",
    "To",
    "Subject",
    "Message-ID",
  ]);
  expect(linuses?.headers.find(({ name }) => name === "Received")?.value).toMatch(/ for team@example\.com; /);
  expect(joans).toEqual(linuses);
});

test("a sent message's headers are those it went out with, under the Message-ID SES gave it, the disclosure of an agent's included", async () => {
  const { duva, linus, headers } = await withMailboxes();
  const { data: created } = await linus.client.POST("/agents", { body: { name: "Hermes" } });
  await linus.client.PATCH("/agents/{agent}/settings", { params: { path: { agent: created!.agent.id } }, body: { sponsorAccess: "send" } });
  const hermes = duva.withKey(created!.key);
  const { data: draft } = await hermes.POST("/mailboxes/{mailbox}/drafts", { params: linus.params, body: { to: ["customer@example.net"], subject: "Svar på fråga", text: "Hello." } });
  const { data: asked } = await hermes.POST("/mailboxes/{mailbox}/drafts/{draft}/send", { params: { path: { ...linus.params.path, draft: draft!.id } } });
  await linus.client.POST("/approvals/{approval}/send", { params: { path: { approval: asked!.send!.approval! } } });
  const [sent] = await messagesIn(linus, "sent");

  const { response, data } = await headers(sent!.id);

  expect(response.status).toBe(200);
  expect(sent!.messageId).toMatch(/^<[\w-]+@eu-north-1\.amazonses\.com>$/);
  expect(data?.headers).toEqual([
    { name: "From", value: "linus@example.com" },
    { name: "To", value: "customer@example.net" },
    { name: "Subject", value: "=?UTF-8?B?U3ZhciBww6UgZnLDpWdh?=", decoded: "Svar på fråga" },
    { name: "Date", value: expect.stringMatching(/^\w{3}, \d{2} \w{3} \d{4} \d{2}:\d{2}:\d{2} \+0000$/) },
    { name: "Message-ID", value: sent!.messageId },
    { name: "Duva-Agent", value: "Hermes for linus@example.org" },
    { name: "MIME-Version", value: "1.0" },
    { name: "Content-Type", value: "text/plain; charset=utf-8" },
    { name: "Content-Transfer-Encoding", value: "7bit" },
  ]);
});

test("a copy of what a member sent as the group has the headers it went out with", async () => {
  const { duva, linus, joan, headers } = await withMailboxes();
  const { data: draft } = await linus.client.POST("/mailboxes/{mailbox}/drafts", { params: linus.params, body: { from: "team@example.com", to: ["customer@example.net"], subject: "Fixed", text: "Done." } });
  await linus.client.POST("/mailboxes/{mailbox}/drafts/{draft}/send", { params: { path: { ...linus.params.path, draft: draft!.id } } });
  const [copy] = await messagesIn(joan, "all");

  const { data } = await headers(copy!.id, joan.client, joan.params);

  expect(copy?.sentAs?.group).toBe("team@example.com");
  expect(data?.headers.slice(0, 3)).toEqual([
    { name: "From", value: "team@example.com" },
    { name: "To", value: "customer@example.net" },
    { name: "Subject", value: "Fixed" },
  ]);
  expect(data?.headers.find(({ name }) => name === "Message-ID")?.value).toBe(copy!.messageId);
  expect(duva.sent()).toHaveLength(1);
});

test("only those who read the mailbox read a message's headers, and a message the mailbox doesn't have answers 404", async () => {
  const { duva, ada, linus, headers } = await withMailboxes();
  await duva.receive(fromGrace, { to: ["linus@example.com"] });
  const [message] = await messagesIn(linus);
  const { data: created } = await linus.client.POST("/agents", { body: { name: "Hermes" } });
  await linus.client.PATCH("/agents/{agent}/settings", { params: { path: { agent: created!.agent.id } }, body: { sponsorAccess: "read" } });

  const byAdmin = await headers(message!.id, ada);
  const byGrace = await headers(message!.id, duva.signIn("grace@example.org"));
  const byAgent = await headers(message!.id, duva.withKey(created!.key));
  const unknown = await headers("no-such-message");

  expect(byAdmin.response.status).toBe(403);
  expect(byGrace.response.status).toBe(403);
  expect(byGrace.error).toEqual({ message: expect.stringMatching(/owner/) });
  expect(byAgent.data?.headers.find(({ name }) => name === "Subject")?.decoded).toBe("Räkning för oktober");
  expect(unknown.response.status).toBe(404);
  expect(unknown.error).toEqual({ message: expect.stringMatching(/threads/) });
});
