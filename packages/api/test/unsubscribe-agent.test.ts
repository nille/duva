import { expect, test } from "vitest";
import type { Model, ModelEvent } from "../src/agent-loop.ts";
import { type DuvaOptions, startDuva } from "./harness.ts";
import type { Verdicts } from "./ses.ts";
import type { ReceivedRequest } from "./web.ts";

type ModelRequest = Parameters<Model>[0];

/**
 * A stand-in for Claude that takes one step of the script per model call, from what it was asked,
 * and records every request. Past the script's end it answers without a tool.
 */
function scripted(...steps: ((request: ModelRequest) => ModelEvent[])[]) {
  const requests: ModelRequest[] = [];
  let step = 0;
  const model: Model = async function* (request) {
    requests.push(structuredClone(request));
    for (const event of steps[step++]?.(request) ?? [{ text: "I stopped." }]) yield event;
    yield { usage: { inputTokens: 1000, outputTokens: 100 } };
  };
  return { model, requests };
}

const use = (name: string, input: Record<string, unknown> = {}): ModelEvent => ({ toolUse: { toolUseId: `${name}-${Math.random()}`, name, input } });

/** What the model was given last: the page, or a tool's answer. */
const asked = (request: ModelRequest) =>
  request.messages
    .at(-1)!
    .content.map((block) => ("text" in block ? block.text : "toolResult" in block ? block.toolResult.content[0]!.text : ""))
    .join("\n");

/** The steps that unsubscribe on the opt-out page the tests serve: the address, the choice, the button, and what the page said. */
const fillsInThePage = [
  () => [use("fillAddress", { element: 1 })],
  () => [use("choose", { element: 2 })],
  () => [use("click", { element: 3 })],
  (request: ModelRequest) => [use("finish", { unsubscribed: /You're unsubscribed/.test(asked(request)), detail: "The page said you're unsubscribed." })],
];

/** The opt-out page: a form for the address and a choice, which answers that the address is unsubscribed. */
const optOutPage = `<!doctype html><html><head><title>Email preferences</title></head><body>
<h1>Leave our list</h1>
<form method="post" action="/optout/done">
<input type="hidden" name="list" value="news">
<label for="email">Your email</label><input id="email" type="email" name="email">
<label><input type="checkbox" name="all" value="yes"> Unsubscribe from all mail</label>
<button type="submit">Unsubscribe</button>
</form></body></html>`;

/** How lists.example.org answers: its opt-out page, and the page that says it's done. */
const listsServer = (request: ReceivedRequest) => {
  const path = new URL(request.url).pathname;
  if (path === "/optout") return new Response(optOutPage, { headers: { "content-type": "text/html" } });
  if (path === "/optout/done" || path === "/u/grace") return new Response("<html><body><p>You're unsubscribed. Sorry to see you go.</p></body></html>", { headers: { "content-type": "text/html" } });
  return new Response("Not found", { status: 404 });
};

interface Newsletter {
  /** The List-Unsubscribe header's value, unless it has none. */
  unsubscribe?: string;
  /** The List-Unsubscribe-Post header's value, unless it has none. */
  post?: string;
  /** The headers each DKIM signature covers, by its domain. */
  signatures?: Record<string, string>;
  html?: string;
  subject?: string;
  from?: string;
}

const covering = "From:To:Subject:Date:Message-ID:List-Unsubscribe";

/** A newsletter from news@lists.example.org to grace@example.com, with no one-click, signed by lists.example.org unless given. */
const newsletter = ({ unsubscribe, post, signatures = { "lists.example.org": covering }, html, subject = "News", from = "news@lists.example.org" }: Newsletter = {}) =>
  [
    ...Object.entries(signatures).map(([domain, headers]) => `DKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; d=${domain}; s=s1;\r\n\th=${headers};\r\n\tbh=YWJj; b=ZGVm`),
    `From: Example News <${from}>`,
    "To: grace@example.com",
    `Subject: ${subject}`,
    "Date: Wed, 07 Oct 2026 09:00:00 +0200",
    `Message-ID: <${subject.replaceAll(" ", "-")}-${Math.random()}@lists.example.org>`,
    ...(unsubscribe === undefined ? [] : [`List-Unsubscribe: ${unsubscribe}`]),
    ...(post === undefined ? [] : [`List-Unsubscribe-Post: ${post}`]),
    "MIME-Version: 1.0",
    `Content-Type: ${html === undefined ? "text/plain" : "text/html"}; charset=utf-8`,
    "",
    html ?? "This week's news.",
  ].join("\r\n");

/**
 * A deployment on example.com where Grace has her personal mailbox at grace@example.com, and
 * lists.example.org serves its opt-out pages. The mailbox agent asks the model given.
 */
async function withMailbox(options: DuvaOptions = {}) {
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org"], ...options });
  const ada = duva.signIn("ada@example.org");
  const grace = duva.signIn("grace@example.org");
  const { data: me } = await grace.GET("/whoami");
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: me!.id, address: "grace@example.com" } });
  const params = { path: { mailbox: mailbox!.id } };
  const agent = (await grace.GET("/mailboxes/{mailbox}/agent", { params })).data!.agent;
  const requests = await duva.webServer("lists.example.org", { answer: listsServer });
  const receive = (raw: string, { verdicts = {}, at, from = "bounces@lists.example.org" }: { verdicts?: Verdicts; at?: Date; from?: string } = {}) =>
    duva.receive(raw, { from, to: ["grace@example.com"] }, { verdicts, ...(at !== undefined && { at }) });
  const setDelivery = (delivery: "nowhere" | "inbox", sender = "news@lists.example.org") => grace.PUT("/mailboxes/{mailbox}/senders/{sender}", { params: { path: { ...params.path, sender } }, body: { delivery } });
  const sheet = async (sender = "news@lists.example.org") => (await grace.GET("/mailboxes/{mailbox}/senders/{sender}", { params: { path: { ...params.path, sender } } })).data!;
  const changes = async () => (await grace.GET("/mailboxes/{mailbox}/changes", { params: { ...params, query: { spam: true } } })).data!.changes;
  type Change = Awaited<ReturnType<typeof changes>>[number];
  const attempts = async () => (await changes()).filter((change): change is Extract<Change, { type: "unsubscribeAttempted" }> => change.type === "unsubscribeAttempted");
  return { duva, grace, params, agent, requests, receive, setDelivery, sheet, changes, attempts, graceId: me!.id };
}

test("when one-click isn't offered, the mailbox agent fills in the opt-out page with the harder model, only the mailbox's address and an opt-out choice, and the sender's sheet says so", async () => {
  const { model, requests: asks } = scripted(...fillsInThePage);
  const { receive, setDelivery, requests, sheet, attempts, agent, graceId } = await withMailbox({ model });
  await receive(newsletter({ unsubscribe: "<https://lists.example.org/optout>" }));

  await setDelivery("nowhere");

  expect(requests.map(({ method, url }) => `${method} ${url}`)).toEqual(["GET https://lists.example.org/optout", "POST https://lists.example.org/optout/done"]);
  expect(new URLSearchParams(requests[1]!.body)).toEqual(new URLSearchParams({ list: "news", email: "grace@example.com", all: "yes" }));
  for (const { headers } of requests) {
    expect(headers).not.toHaveProperty("cookie");
    expect(headers).not.toHaveProperty("authorization");
  }
  expect((await sheet()).decided?.unsubscribe).toEqual({ method: "page", outcome: "unsubscribed", detail: "The page said you're unsubscribed.", at: expect.any(String), actor: agent.id });
  expect(await attempts()).toEqual([
    expect.objectContaining({ actor: graceId, outcome: "notOffered", reason: "noOneClick" }),
    expect.objectContaining({ actor: agent.id, address: "news@lists.example.org", method: "page", outcome: "unsubscribed", detail: "The page said you're unsubscribed." }),
  ]);
  // It is given the page and the tools that act on it, nothing of Duva's, and it is the harder model's work (ADR-0032).
  expect(asks[0]!.tools.map(({ name }) => name)).toEqual(["fillAddress", "choose", "click", "finish"]);
  expect(new Set(asks.map(({ model: asked }) => asked))).toEqual(new Set(["anthropic.claude-sonnet-5-5"]));
  expect(asked(asks[0]!)).toContain('[1] field (email) "Your email"');
  expect(JSON.stringify(asks)).not.toContain("This week's news.");
});

test("the mailbox agent's unsubscribe is in its activity", async () => {
  const { model } = scripted(...fillsInThePage);
  const { grace, receive, setDelivery, agent, attempts } = await withMailbox({ model });
  await receive(newsletter({ unsubscribe: "<https://lists.example.org/optout>" }));
  await setDelivery("nowhere");
  const day = (await attempts()).at(-1)!.at.slice(0, 10);

  const { data } = await grace.GET("/agents/{agent}/activity/{day}", { params: { path: { agent: agent.id, day } } });

  expect(data!.entries.map(({ change }) => change)).toContainEqual(expect.objectContaining({ type: "unsubscribeAttempted", method: "page", outcome: "unsubscribed" }));
  const { data: summaries } = await grace.GET("/agents/{agent}/activity", { params: { path: { agent: agent.id }, query: { from: day, to: day, timeZone: "UTC" } } });
  // The one-click Grace's choice tried was hers, and isn't offered, so the agent's day counts only its own.
  expect(summaries!.days).toEqual([expect.objectContaining({ unsubscribes: 1 })]);
});

test("the address is all the agent can type, whatever it asks to type", async () => {
  const { model } = scripted(
    () => [use("fillAddress", { element: 1, value: "4111 1111 1111 1111" })],
    () => [use("click", { element: 3 })],
    () => [use("finish", { unsubscribed: true, detail: "Done." })],
  );
  const { receive, setDelivery, requests } = await withMailbox({ model });
  await receive(newsletter({ unsubscribe: "<https://lists.example.org/optout>" }));

  await setDelivery("nowhere");

  expect(new URLSearchParams(requests[1]!.body).get("email")).toBe("grace@example.com");
  expect(requests.map(({ body }) => body).join()).not.toContain("4111");
});

test("a page the agent can't unsubscribe on, as one asking for a CAPTCHA, fails with its words, and it mails the unsubscribe address next, without approval", async () => {
  const { model } = scripted(() => [use("finish", { unsubscribed: false, detail: "The page asks to solve a CAPTCHA." })]);
  const { duva, grace, receive, setDelivery, sheet, attempts, agent } = await withMailbox({ model });
  await receive(newsletter({ unsubscribe: "<https://lists.example.org/optout>, <mailto:leave@lists.example.org?subject=Unsubscribe%20me&body=Please%20remove%20me.>" }));

  await setDelivery("nowhere");

  expect((await attempts()).slice(1)).toEqual([
    expect.objectContaining({ actor: agent.id, method: "page", outcome: "failed", reason: "notDone", detail: "The page asks to solve a CAPTCHA." }),
    expect.objectContaining({ actor: agent.id, method: "mailto", outcome: "requested" }),
  ]);
  expect((await sheet()).decided?.unsubscribe).toMatchObject({ method: "mailto", outcome: "requested", actor: agent.id });
  const [sent] = duva.sent();
  expect(duva.sentTo()).toEqual([["leave@lists.example.org"]]);
  expect(sent).toMatch(/^From: grace@example\.com/m);
  expect(sent).toMatch(/^Subject: Unsubscribe me/m);
  expect(sent).toMatch(/^Duva-Agent: /m);
  expect(sent).toContain("Please remove me.");
  expect((await grace.GET("/approvals")).data!.approvals).toEqual([]);
});

test("the unsubscribe mail goes from the plus-tagged address the newsletter was sent to", async () => {
  const { duva, receive, setDelivery } = await withMailbox();
  await duva.receive(newsletter({ unsubscribe: "<mailto:leave@lists.example.org>" }), { from: "bounces@lists.example.org", to: ["grace+news@example.com"] });

  await setDelivery("nowhere");

  expect(duva.sent()[0]).toMatch(/^From: grace\+news@example\.com/m);
  expect(duva.sent()[0]).toMatch(/^Subject: unsubscribe/m);
});

test("the unsubscribe mail counts toward the mailbox agent's send limits", async () => {
  const { duva, grace, params, receive, setDelivery, agent } = await withMailbox();
  await grace.PATCH("/agents/{agent}/settings", { params: { path: { agent: agent.id } }, body: { sendsPerHour: 1 } });
  await receive(newsletter({ unsubscribe: "<mailto:leave@lists.example.org>" }));
  await receive(newsletter({ unsubscribe: "<mailto:leave-other@lists.example.org>", from: "other@lists.example.org", subject: "Other" }));

  await setDelivery("nowhere");
  await setDelivery("nowhere", "other@lists.example.org");

  expect(duva.sentTo()).toEqual([["leave@lists.example.org"]]);
  const { data } = await grace.GET("/mailboxes/{mailbox}/drafts", { params });
  expect(data!.drafts.map(({ send }) => send?.state)).toContain("waitingForLimit");
});

test("with no page and no unsubscribe address, the agent follows an unsubscribe link in the body on the signer's own domain", async () => {
  const { model } = scripted(() => [use("finish", { unsubscribed: true, detail: "The page said you're unsubscribed." })]);
  const { duva, receive, setDelivery, requests, sheet } = await withMailbox({ model });
  const elsewhere = await duva.webServer("tracker.example.net");
  const html = `<p>News.</p><p><a href="https://tracker.example.net/unsubscribe?u=grace">Unsubscribe</a> <a href="https://lists.example.org/u/grace">Unsubscribe</a> <a href="https://lists.example.org/archive">Archive</a></p>`;
  await receive(newsletter({ html }));

  await setDelivery("nowhere");

  expect(requests.map(({ url }) => url)).toEqual(["https://lists.example.org/u/grace"]);
  expect(elsewhere).toEqual([]);
  expect((await sheet()).decided?.unsubscribe).toMatchObject({ method: "link", outcome: "unsubscribed" });
});

test("a link on a mailing service's known unsubscribe host counts, whoever signed the mail", async () => {
  const { model } = scripted(() => [use("finish", { unsubscribed: true, detail: "Unsubscribed." })]);
  const { duva, receive, setDelivery } = await withMailbox({ model });
  const mailchimp = await duva.webServer("us1.list-manage.com", { answer: () => new Response("<p>Unsubscribed.</p>", { headers: { "content-type": "text/html" } }) });
  await receive(newsletter({ html: `<a href="https://us1.list-manage.com/unsubscribe?u=1">unsubscribe from this list</a>`, signatures: { "mailservice.example.net": covering } }));

  await setDelivery("nowhere");

  expect(mailchimp.map(({ url }) => url)).toEqual(["https://us1.list-manage.com/unsubscribe?u=1"]);
});

test("a link in mail that no aligned signature covers doesn't count", async () => {
  const { duva, receive, setDelivery, requests } = await withMailbox();
  await receive(newsletter({ html: `<a href="https://lists.example.org/u/grace">Unsubscribe</a>`, signatures: { "mailservice.example.net": covering } }));

  await setDelivery("nowhere");

  expect(requests).toEqual([]);
  expect(duva.bounces()).toHaveLength(1);
});

test("as a last resort the agent bounces the message as if the address were unknown, and each later one, which tries nothing else", async () => {
  const { duva, receive, setDelivery, requests, sheet, attempts, agent } = await withMailbox();
  const first = await receive(newsletter());

  await setDelivery("nowhere");
  const later = await receive(newsletter({ subject: "Later", unsubscribe: "<https://lists.example.org/optout>", post: "List-Unsubscribe=One-Click" }));

  expect(duva.bounces()).toEqual([
    { messageId: first.messageId, to: "bounces@lists.example.org", from: "MAILER-DAEMON@eu-north-1.amazonses.com", recipients: ["grace@example.com"], explanation: expect.any(String), status: "5.1.1" },
    { messageId: later.messageId, to: "bounces@lists.example.org", from: "MAILER-DAEMON@eu-north-1.amazonses.com", recipients: ["grace@example.com"], explanation: expect.any(String), status: "5.1.1" },
  ]);
  expect(requests).toEqual([]);
  expect((await sheet()).decided?.unsubscribe).toMatchObject({ method: "bounce", outcome: "bounced", actor: agent.id });
  expect((await attempts()).map(({ method, outcome }) => `${method ?? "oneClick"} ${outcome}`)).toEqual(["oneClick notOffered", "bounce bounced", "bounce bounced"]);
});

test("SES bounces only within 24 hours of receiving the message, so older mail waits for the sender's next, which goes through the methods again", async () => {
  const { duva, receive, setDelivery, sheet } = await withMailbox();
  await receive(newsletter(), { at: new Date(Date.now() - 2 * 24 * 60 * 60_000) });

  await setDelivery("nowhere");
  expect((await sheet()).decided?.unsubscribe).toMatchObject({ method: "bounce", outcome: "failed", reason: "tooLate" });
  expect(duva.bounces()).toEqual([]);

  const later = await receive(newsletter({ subject: "Later" }));
  expect(duva.bounces().map(({ messageId }) => messageId)).toEqual([later.messageId]);

  await receive(newsletter({ subject: "Last", unsubscribe: "<mailto:leave@lists.example.org>" }));
  expect(duva.sentTo()).toEqual([]);
  expect(duva.bounces()).toHaveLength(2);
});

test("a later message with an unsubscribe address, after a bounce too late to send, has the agent mail it", async () => {
  const { duva, receive, setDelivery, sheet } = await withMailbox();
  await receive(newsletter(), { at: new Date(Date.now() - 2 * 24 * 60 * 60_000) });
  await setDelivery("nowhere");

  await receive(newsletter({ subject: "Later", unsubscribe: "<mailto:leave@lists.example.org>" }));

  expect(duva.sentTo()).toEqual([["leave@lists.example.org"]]);
  expect(duva.bounces()).toEqual([]);
  expect((await sheet()).decided?.unsubscribe).toMatchObject({ method: "mailto", outcome: "requested" });
});

test("two messages handed on before the agent goes on get one unsubscribe mail", async () => {
  const { duva, receive, setDelivery } = await withMailbox({ tasksHeld: true });
  await receive(newsletter({ unsubscribe: "<mailto:leave@lists.example.org>" }));
  await setDelivery("nowhere");
  await receive(newsletter({ subject: "Later", unsubscribe: "<mailto:leave@lists.example.org>" }));

  await duva.releaseTasks();

  expect(duva.sentTo()).toEqual([["leave@lists.example.org"]]);
});

test("the address goes only in a field for an email address", async () => {
  const { model, requests: asks } = scripted(() => [use("fillAddress", { element: 1 })], () => [use("finish", { unsubscribed: false, detail: "No email field." })]);
  const { duva, receive, setDelivery } = await withMailbox({ model });
  await duva.webServer("forms.example.org", { answer: () => new Response(`<form method="post"><label for="n">Your name</label><input id="n" name="name"><button>Unsubscribe</button></form>`) });
  await receive(newsletter({ unsubscribe: "<https://forms.example.org/optout>", signatures: { "lists.example.org": covering } }));

  await setDelivery("nowhere");

  expect(asked(asks[1]!)).toMatch(/isn't an email address field/);
});

test("mail that didn't pass DMARC gets no page, no unsubscribe mail, no link and no bounce", async () => {
  const { duva, receive, setDelivery, requests, sheet } = await withMailbox();
  await receive(newsletter({ unsubscribe: "<https://lists.example.org/optout>, <mailto:leave@lists.example.org>", html: `<a href="https://lists.example.org/u/grace">Unsubscribe</a>` }), {
    verdicts: { dmarc: "FAIL", dmarcPolicy: "none" },
  });

  await setDelivery("nowhere");

  expect(requests).toEqual([]);
  expect(duva.sent()).toEqual([]);
  expect(duva.bounces()).toEqual([]);
  expect((await sheet()).decided?.unsubscribe).toMatchObject({ method: "bounce", outcome: "failed", reason: "notBounceable" });
});

test("a page or address that no passing DKIM signature covers isn't used", async () => {
  const { duva, receive, setDelivery, requests } = await withMailbox();
  await receive(newsletter({ unsubscribe: "<https://lists.example.org/optout>, <mailto:leave@lists.example.org>", signatures: { "lists.example.org": "From:To:Subject" } }));

  await setDelivery("nowhere");

  expect(requests).toEqual([]);
  expect(duva.sent()).toEqual([]);
});

test("spam that is dropped is never answered: no page, no unsubscribe mail and no bounce", async () => {
  const { duva, receive, setDelivery, requests } = await withMailbox();
  await setDelivery("nowhere");

  await receive(newsletter({ unsubscribe: "<https://lists.example.org/optout>, <mailto:leave@lists.example.org>" }), { verdicts: { spam: "FAIL" } });

  expect(requests).toEqual([]);
  expect(duva.sent()).toEqual([]);
  expect(duva.bounces()).toEqual([]);
});

test("mail from the organization's own domains is never bounced, which the sender's sheet says", async () => {
  const { duva, receive, setDelivery, sheet } = await withMailbox();
  await receive(newsletter({ from: "news@example.com", signatures: { "example.com": covering } }), { from: "news@example.com" });

  await setDelivery("nowhere", "news@example.com");

  expect(duva.bounces()).toEqual([]);
  expect((await sheet("news@example.com")).decided?.unsubscribe).toMatchObject({ method: "bounce", outcome: "failed", reason: "notBounceable", detail: expect.stringMatching(/own domain/) });
});

test("once a method worked, the sender's later mail is only dropped", async () => {
  const { model, requests: asks } = scripted(...fillsInThePage);
  const { duva, receive, setDelivery, requests, attempts } = await withMailbox({ model });
  await receive(newsletter({ unsubscribe: "<https://lists.example.org/optout>" }));
  await setDelivery("nowhere");

  await receive(newsletter({ subject: "Later", unsubscribe: "<https://lists.example.org/optout>, <mailto:leave@lists.example.org>" }));

  expect(requests).toHaveLength(2);
  expect(asks).toHaveLength(4);
  expect(duva.sent()).toEqual([]);
  expect(duva.bounces()).toEqual([]);
  expect(await attempts()).toHaveLength(2);
});

test("a sender set back to the Inbox before the agent goes on stops it", async () => {
  const { duva, receive, setDelivery, requests, attempts } = await withMailbox({ tasksHeld: true });
  await receive(newsletter({ unsubscribe: "<https://lists.example.org/optout>, <mailto:leave@lists.example.org>" }));
  await setDelivery("nowhere");
  await setDelivery("inbox");

  await duva.releaseTasks();

  expect(requests).toEqual([]);
  expect(duva.sent()).toEqual([]);
  expect(duva.bounces()).toEqual([]);
  expect(await attempts()).toHaveLength(1);
});

test("a paused mailbox agent doesn't go on, and one-click alone is tried", async () => {
  const { duva, grace, receive, setDelivery, agent, attempts } = await withMailbox();
  await grace.POST("/agents/{agent}/pause", { params: { path: { agent: agent.id } } });
  await receive(newsletter({ unsubscribe: "<mailto:leave@lists.example.org>" }));

  await setDelivery("nowhere");

  expect(duva.sent()).toEqual([]);
  expect(duva.bounces()).toEqual([]);
  expect(await attempts()).toHaveLength(1);
});

test("the agent's model calls count toward the spend cap, and at the cap the page fails and it goes on without the model", async () => {
  // Each call takes a million tokens, $2.20 with the default Claude Sonnet 5.5 through eu, past a $1 cap.
  const model: Model = async function* () {
    yield use("fillAddress", { element: 1 });
    yield { usage: { inputTokens: 1_000_000, outputTokens: 0 } };
  };
  const { duva, receive, setDelivery, attempts } = await withMailbox({ model });
  const { response } = await duva.signIn("ada@example.org").PATCH("/organization/settings", { body: { mailboxAgentSpendCap: 1 } });
  expect(response.status).toBe(200);
  await receive(newsletter({ unsubscribe: "<https://lists.example.org/optout>, <mailto:leave@lists.example.org>" }));

  await setDelivery("nowhere");

  expect((await attempts()).slice(1)).toEqual([
    expect.objectContaining({ method: "page", outcome: "failed", reason: "notDone", detail: expect.stringMatching(/spend cap/) }),
    expect.objectContaining({ method: "mailto", outcome: "requested" }),
  ]);
});
