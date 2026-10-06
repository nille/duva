import { expect, test } from "vitest";
import { startDuva } from "./harness.ts";
import type { Verdicts } from "./ses.ts";
import type { WebServerOptions } from "./web.ts";

interface Offer {
  /** The List-Unsubscribe header's value, unless the message has none. */
  unsubscribe?: string;
  /** The List-Unsubscribe-Post header's value, unless the message has none. */
  post?: string;
  /** The headers each DKIM signature covers, by its domain. */
  signatures?: Record<string, string>;
  /** Header fields written above the others, as a sender can. */
  above?: string[];
  subject?: string;
  /** The From address, news unless given. */
  from?: string;
}

/** The address newsletters come from unless given, in mixed case, as a sender may write it. */
const news = "News@Lists.example.org";

const covering = "From:To:Subject:Date:Message-ID:List-Unsubscribe:List-Unsubscribe-Post";

/** A newsletter from news@lists.example.org to grace@example.com, offering one-click at the URL, signed by lists.example.org over both headers unless given. */
const newsletter = (
  url: string,
  {
    unsubscribe = `<mailto:leave@lists.example.org?subject=unsubscribe>, <${url}>`,
    post = "List-Unsubscribe=One-Click",
    signatures = { "lists.example.org": covering },
    above = [],
    subject = "News",
    from = news,
  }: Offer = {},
) =>
  [
    ...above,
    ...Object.entries(signatures).map(([domain, headers]) => `DKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; d=${domain}; s=s1;\r\n\th=${headers};\r\n\tbh=YWJj; b=ZGVm`),
    `From: Example News <${from}>`,
    "To: grace@example.com",
    `Subject: ${subject}`,
    "Date: Tue, 06 Oct 2026 09:00:00 +0200",
    `Message-ID: <${subject.replaceAll(" ", "-")}@lists.example.org>`,
    ...(unsubscribe === "" ? [] : [`List-Unsubscribe: ${unsubscribe}`]),
    ...(post === "" ? [] : [`List-Unsubscribe-Post: ${post}`]),
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "This week's news.",
  ].join("\r\n");

/**
 * A newsletter's From and Subject for the ith of several senders at lists.example.org, so that one
 * mailbox can block each in turn: a test of many cases starts one deployment, not one for each,
 * which under load takes a second or more.
 */
const fromSender = (i: number) => ({ from: `news-${i}@lists.example.org`, subject: `News ${i}` });

/**
 * A deployment on example.com where Grace has her personal mailbox at grace@example.com, with the
 * Screener on, and sponsors the agent Iris, which has full sponsor access. lists.example.org serves
 * the web, answering as given.
 */
async function withMailbox(server: WebServerOptions = {}) {
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org"] });
  const ada = duva.signIn("ada@example.org");
  const grace = duva.signIn("grace@example.org");
  const { data: me } = await grace.GET("/whoami");
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: me!.id, address: "grace@example.com" } });
  const { data: iris } = await grace.POST("/agents", { body: { name: "Iris" } });
  await grace.PATCH("/agents/{agent}/settings", { params: { path: { agent: iris!.agent.id } }, body: { sponsorAccess: "full" } });
  const params = { path: { mailbox: mailbox!.id } };
  const requests = await duva.webServer("lists.example.org", server);
  const receive = (raw: string, verdicts: Verdicts = {}) => duva.receive(raw, { to: ["grace@example.com"] }, { verdicts });
  /** Blocks the address given (news by default) as the client given (Grace by default), and answers how unsubscribing went. */
  const block = async ({ client = grace, address = news } = {}) => {
    const { data, response } = await client.POST("/mailboxes/{mailbox}/screener/block", { params, body: { address } });
    expect(response.status).toBe(200);
    return data!.unsubscribe;
  };
  const changes = async () => (await grace.GET("/mailboxes/{mailbox}/changes", { params: { ...params, query: { spam: true } } })).data!.changes;
  const letIn = () => grace.POST("/mailboxes/{mailbox}/screener/let-in", { params, body: { address: "news@lists.example.org" } });
  return { duva, grace, letIn, graceId: me!.id, iris: duva.withKey(iris!.key), irisId: iris!.agent.id, params, requests, receive, block, changes };
}

test("blocking a sender whose newest mail offers one-click, under a passing DKIM signature, unsubscribes with one POST", async () => {
  const { receive, block, requests, changes, graceId } = await withMailbox();
  await receive(newsletter("https://lists.example.org/unsubscribe?u=grace&l=news"));

  expect(await block()).toEqual({ outcome: "unsubscribed" });

  expect(requests).toEqual([
    {
      method: "POST",
      url: "https://lists.example.org/unsubscribe?u=grace&l=news",
      headers: expect.objectContaining({ "content-type": "application/x-www-form-urlencoded", "user-agent": "Duva one-click unsubscribe (RFC 8058)" }),
      body: "List-Unsubscribe=One-Click",
    },
  ]);
  expect(requests[0]!.headers).not.toHaveProperty("cookie");
  expect(requests[0]!.headers).not.toHaveProperty("referer");
  // After the block, and the thread it moved to Trash.
  expect((await changes()).slice(-3)).toEqual([
    expect.objectContaining({ type: "senderScreened", address: "news@lists.example.org", decision: "block", actor: graceId }),
    expect.objectContaining({ type: "threadLabelsChanged", actor: graceId }),
    expect.objectContaining({ type: "unsubscribeAttempted", address: "news@lists.example.org", outcome: "unsubscribed", actor: graceId }),
  ]);
});

test("an agent with full sponsor access that blocks a sender unsubscribes under its own name", async () => {
  const { receive, block, iris, irisId, changes } = await withMailbox();
  await receive(newsletter("https://lists.example.org/unsubscribe"));

  expect(await block({ client: iris })).toEqual({ outcome: "unsubscribed" });

  expect((await changes()).at(-1)).toEqual(expect.objectContaining({ type: "unsubscribeAttempted", outcome: "unsubscribed", actor: irisId }));
});

test("letting a sender in unsubscribes from nothing", async () => {
  const { receive, letIn, requests, changes } = await withMailbox();
  await receive(newsletter("https://lists.example.org/unsubscribe"));

  const { data } = await letIn();

  expect(data!.unsubscribe).toBeUndefined();
  expect(requests).toEqual([]);
  expect((await changes()).map(({ type }) => type)).not.toContain("unsubscribeAttempted");
});

test("unsubscribing takes the sender's newest mail, also when it waits no longer", async () => {
  const { duva, receive, block, letIn, requests } = await withMailbox();
  const other = await duva.webServer("other.example.org");
  await duva.receive(newsletter("https://other.example.org/old", { subject: "Old" }), { to: ["grace@example.com"] }, { at: new Date("2026-10-01T09:00:00Z") });
  await receive(newsletter("https://lists.example.org/new", { subject: "New" }));
  await letIn();

  expect(await block()).toEqual({ outcome: "unsubscribed" });

  expect(requests.map(({ url }) => url)).toEqual(["https://lists.example.org/new"]);
  expect(other).toEqual([]);
});

test("when the sender's newest mail offers no one-click, nothing is sent, even if older mail offered it", async () => {
  const { duva, receive, block, requests, changes } = await withMailbox();
  await duva.receive(newsletter("https://lists.example.org/old", { subject: "Old" }), { to: ["grace@example.com"] }, { at: new Date("2026-10-01T09:00:00Z") });
  await receive(newsletter("https://lists.example.org/new", { subject: "New", post: "" }));

  expect(await block()).toEqual({ outcome: "notOffered", reason: "noOneClick" });

  expect(requests).toEqual([]);
  expect((await changes()).at(-1)).toEqual(expect.objectContaining({ type: "unsubscribeAttempted", outcome: "notOffered", reason: "noOneClick" }));
});

test("one-click needs an https List-Unsubscribe and List-Unsubscribe-Post as RFC 8058 has it, each once: mailto and http aren't enough", async () => {
  const { receive, block, requests } = await withMailbox();
  for (const [i, offer] of [
    { unsubscribe: "<mailto:leave@lists.example.org>" },
    { unsubscribe: "<http://lists.example.org/unsubscribe>" },
    { unsubscribe: "https://lists.example.org/unsubscribe" },
    { unsubscribe: "" },
    { post: "" },
    { post: "List-Unsubscribe=Yes" },
    { above: ["List-Unsubscribe: <https://lists.example.org/other>"] },
  ].entries()) {
    const sender = fromSender(i);
    await receive(newsletter("https://lists.example.org/unsubscribe", { ...offer, ...sender }));

    expect({ offer, unsubscribe: await block({ address: sender.from }) }).toEqual({ offer, unsubscribe: { outcome: "notOffered", reason: "noOneClick" } });
    expect(requests).toEqual([]);
  }
});

test("one-click needs a DKIM signature that covers both headers and that SES found passing", async () => {
  const { receive, block, requests } = await withMailbox();
  for (const [i, [offer, verdicts]] of ([
    [{ signatures: {} }, {}],
    [{ signatures: { "lists.example.org": "From:To:Subject:List-Unsubscribe" } }, {}],
    [{ signatures: { "lists.example.org": "From:To:Subject:List-Unsubscribe-Post" } }, {}],
    [{}, { dkim: { "lists.example.org": "FAIL" } }],
    [{ signatures: { "lists.example.org": covering, "example.net": covering } }, { dkim: { "lists.example.org": "FAIL", "example.net": "GRAY" } }],
    // A sender can write its own Authentication-Results, but SES's comes first.
    [{ above: ["Authentication-Results: amazonses.com; dkim=pass header.i=@lists.example.org"] }, { dkim: { "lists.example.org": "FAIL" } }],
  ] as [Offer, Verdicts][]).entries()) {
    const sender = fromSender(i);
    await receive(newsletter("https://lists.example.org/unsubscribe", { ...offer, ...sender }), verdicts);

    expect({ offer, verdicts, unsubscribe: await block({ address: sender.from }) }).toEqual({ offer, verdicts, unsubscribe: { outcome: "notOffered", reason: "notSigned" } });
    expect(requests).toEqual([]);
  }
});

test("a passing signature from another domain that covers both headers is enough, as when a mailing service signs", async () => {
  const { receive, block } = await withMailbox();
  await receive(newsletter("https://lists.example.org/unsubscribe", { signatures: { "lists.example.org": "From:To:Subject", "mailer.example.net": covering } }), {
    dkim: { "lists.example.org": "FAIL" },
  });

  expect(await block()).toEqual({ outcome: "unsubscribed" });
});

test("Duva never unsubscribes from mail SES judged to be spam, even in a thread taken out of Spam", async () => {
  const { receive, block, requests, grace, params } = await withMailbox();
  await receive(newsletter("https://lists.example.org/unsubscribe"), { spam: "FAIL" });
  const { data } = await grace.GET("/mailboxes/{mailbox}/threads", { params: { ...params, query: { label: "spam" } } });
  await grace.POST("/mailboxes/{mailbox}/threads/labels", { params, body: { threads: [data!.threads[0]!.id], add: ["inbox"], remove: ["spam"] } });

  expect(await block()).toEqual({ outcome: "notOffered", reason: "spam" });

  expect(requests).toEqual([]);
});

test("unsubscribing skips the sender's spam for their newest mail that isn't", async () => {
  const { duva, receive, block, requests } = await withMailbox();
  await duva.receive(newsletter("https://lists.example.org/real", { subject: "Real" }), { to: ["grace@example.com"] }, { at: new Date("2026-10-01T09:00:00Z") });
  await receive(newsletter("https://lists.example.org/spam", { subject: "Spam" }), { spam: "FAIL" });

  expect(await block()).toEqual({ outcome: "unsubscribed" });

  expect(requests.map(({ url }) => url)).toEqual(["https://lists.example.org/real"]);
});

test("blocking a sender the mailbox has no mail from unsubscribes from nothing", async () => {
  const { block, requests } = await withMailbox();

  expect(await block()).toEqual({ outcome: "notOffered", reason: "noMail" });
  expect(requests).toEqual([]);
});

test("the POST goes only to http or https on port 80 or 443", async () => {
  const { receive, block, requests } = await withMailbox();
  for (const [i, url] of ["https://lists.example.org:8443/unsubscribe", "https://lists.example.org:22/unsubscribe"].entries()) {
    const sender = fromSender(i);
    await receive(newsletter(url, sender));

    expect({ url, unsubscribe: await block({ address: sender.from }) }).toEqual({ url, unsubscribe: { outcome: "failed", reason: "notAllowed" } });
    expect(requests).toEqual([]);
  }
});

test("the POST goes only to a public address: never a private, shared, loopback or link-local one", async () => {
  const { duva, receive, block } = await withMailbox();
  for (const [i, address] of ["10.0.0.7", "172.16.4.1", "192.168.1.1", "100.64.0.1", "127.0.0.1", "169.254.169.254", "0.0.0.0", "::1", "fd00::7", "fe80::1", "::ffff:10.0.0.7", "::127.0.0.1", "64:ff9b::a00:7"].entries()) {
    const requests = await duva.webServer("lists.example.org", { addresses: [address] });
    const sender = fromSender(i);
    await receive(newsletter("https://lists.example.org/unsubscribe", sender));

    expect({ address, unsubscribe: await block({ address: sender.from }) }).toEqual({ address, unsubscribe: { outcome: "failed", reason: "notPublic" } });
    expect(requests).toEqual([]);
  }
});

test("a host name that resolves to a public and a private address is refused", async () => {
  const { receive, block, requests } = await withMailbox({ addresses: ["93.184.215.10", "10.0.0.7"] });
  await receive(newsletter("https://lists.example.org/unsubscribe"));

  expect(await block()).toEqual({ outcome: "failed", reason: "notPublic" });
  expect(requests).toEqual([]);
});

test("a URL that names an address that isn't public is refused", async () => {
  const { receive, block } = await withMailbox();
  for (const [i, url] of ["https://127.0.0.1/unsubscribe", "https://169.254.169.254/latest/meta-data/", "https://[::1]/unsubscribe", "https://10.0.0.7/unsubscribe"].entries()) {
    const sender = fromSender(i);
    await receive(newsletter(url, sender));

    expect({ url, unsubscribe: await block({ address: sender.from }) }).toEqual({ url, unsubscribe: { outcome: "failed", reason: "notPublic" } });
  }
});

test("a redirect is checked as the URL was: to an address that isn't public, nothing more is sent", async () => {
  const { duva, receive, block, requests } = await withMailbox({ answer: () => new Response(null, { status: 307, headers: { location: "http://intranet.example.net/admin" } }) });
  const intranet = await duva.webServer("intranet.example.net", { addresses: ["10.0.0.7"] });
  await receive(newsletter("https://lists.example.org/unsubscribe"));

  expect(await block()).toEqual({ outcome: "failed", reason: "notPublic" });

  expect(requests).toHaveLength(1);
  expect(intranet).toEqual([]);
});

test("a redirect to a port other than 80 or 443 is refused", async () => {
  const { receive, block } = await withMailbox({ answer: () => new Response(null, { status: 308, headers: { location: "https://lists.example.org:6379/" } }) });
  await receive(newsletter("https://lists.example.org/unsubscribe"));

  expect(await block()).toEqual({ outcome: "failed", reason: "notAllowed" });
});

test("a 307 or 308 repeats the POST at the new URL, without the cookies the first answer set", async () => {
  const { duva, receive, block, requests } = await withMailbox({
    answer: () => new Response(null, { status: 308, headers: { location: "https://esp.example.net/one-click?u=grace", "set-cookie": "session=abc" } }),
  });
  const esp = await duva.webServer("esp.example.net");
  await receive(newsletter("https://lists.example.org/unsubscribe"));

  expect(await block()).toEqual({ outcome: "unsubscribed" });

  expect(requests).toHaveLength(1);
  expect(esp).toEqual([expect.objectContaining({ method: "POST", url: "https://esp.example.net/one-click?u=grace", body: "List-Unsubscribe=One-Click" })]);
  expect(esp[0]!.headers.cookie).toBeUndefined();
  expect(esp[0]!.headers.referer).toBeUndefined();
});

test("another redirect isn't followed, and doesn't unsubscribe, since it may lead to a page that asks to confirm", async () => {
  const { duva, receive, block } = await withMailbox();
  for (const [i, status] of [301, 302, 303].entries()) {
    await duva.webServer("lists.example.org", { answer: () => new Response(null, { status, headers: { location: "https://esp.example.net/confirm" } }) });
    const esp = await duva.webServer("esp.example.net");
    const sender = fromSender(i);
    await receive(newsletter("https://lists.example.org/unsubscribe", sender));

    expect(await block({ address: sender.from })).toEqual({ outcome: "failed", reason: "refused", status });
    expect(esp).toEqual([]);
  }
});

test("a 307 or 308 may lead to http, but to no other scheme", async () => {
  const { duva, receive, block } = await withMailbox({ answer: () => new Response(null, { status: 307, headers: { location: "ftp://esp.example.net:80/" } }) });
  await duva.webServer("esp.example.net");
  await receive(newsletter("https://lists.example.org/unsubscribe"));

  expect(await block()).toEqual({ outcome: "failed", reason: "notAllowed" });
});

test("a 307 to http on port 80 repeats the POST there", async () => {
  const { duva, receive, block } = await withMailbox({ answer: () => new Response(null, { status: 307, headers: { location: "http://esp.example.net/one-click" } }) });
  const esp = await duva.webServer("esp.example.net");
  await receive(newsletter("https://lists.example.org/unsubscribe"));

  expect(await block()).toEqual({ outcome: "unsubscribed" });
  expect(esp).toEqual([expect.objectContaining({ method: "POST", url: "http://esp.example.net/one-click", body: "List-Unsubscribe=One-Click" })]);
});

test("the POST follows three redirects at most", async () => {
  const { receive, block, requests } = await withMailbox({ answer: ({ url }) => new Response(null, { status: 307, headers: { location: `${url}x` } }) });
  await receive(newsletter("https://lists.example.org/unsubscribe"));

  expect(await block()).toEqual({ outcome: "failed", reason: "tooManyRedirects" });
  expect(requests).toHaveLength(4);
});

test("an error from the sender's server fails, with its status", async () => {
  const { receive, block, changes } = await withMailbox({ answer: () => new Response("Gone", { status: 410 }) });
  await receive(newsletter("https://lists.example.org/unsubscribe"));

  expect(await block()).toEqual({ outcome: "failed", reason: "refused", status: 410 });
  expect((await changes()).at(-1)).toEqual(expect.objectContaining({ type: "unsubscribeAttempted", outcome: "failed", reason: "refused", status: 410 }));
});

test("a server whose name doesn't resolve fails as unreachable", async () => {
  const { receive, block } = await withMailbox();
  await receive(newsletter("https://nowhere.example.org/unsubscribe"));

  expect(await block()).toEqual({ outcome: "failed", reason: "unreachable" });
});

test("a server that doesn't answer within 5 seconds fails", async () => {
  const { receive, block } = await withMailbox({ answer: () => new Promise<never>(() => {}) });
  await receive(newsletter("https://lists.example.org/unsubscribe"));

  const started = Date.now();
  expect(await block()).toEqual({ outcome: "failed", reason: "timedOut" });
  expect(Date.now() - started).toBeLessThan(7_000);
}, 15_000);


test("blocking a domain unsubscribes from the newest mail from an address on exactly that domain", async () => {
  const { duva, receive, grace, params, requests, changes, graceId } = await withMailbox();
  const sub = await duva.webServer("mail.lists.example.org");
  await duva.receive(newsletter("https://lists.example.org/older", { subject: "Older" }), { to: ["grace@example.com"] }, { at: new Date("2026-10-01T09:00:00Z") });
  await receive(newsletter("https://mail.lists.example.org/newer", { subject: "Newer", from: "news@mail.lists.example.org" }));

  const { data } = await grace.POST("/mailboxes/{mailbox}/screener/block", { params, body: { domain: "lists.example.org" } });

  expect(data!.unsubscribe).toEqual({ outcome: "unsubscribed" });
  expect(requests.map(({ url }) => url)).toEqual(["https://lists.example.org/older"]);
  expect(sub).toEqual([]);
  expect((await changes()).at(-1)).toEqual(expect.objectContaining({ type: "unsubscribeAttempted", domain: "lists.example.org", outcome: "unsubscribed", actor: graceId }));
});

test("blocking a domain leaves out mail from an address there the mailbox let in, since its own decision beats the block", async () => {
  const { receive, grace, params, letIn, requests } = await withMailbox();
  await receive(newsletter("https://lists.example.org/unsubscribe"));
  await letIn();

  const { data } = await grace.POST("/mailboxes/{mailbox}/screener/block", { params, body: { domain: "lists.example.org" } });

  expect(data!.unsubscribe).toEqual({ outcome: "notOffered", reason: "noMail" });
  expect(requests).toEqual([]);
});
