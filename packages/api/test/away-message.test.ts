import { expect, test } from "vitest";
import type { components } from "@duva/openapi";
import { startDuva } from "./harness.ts";

/** A message to Grace from the address, with the subject and any more header lines. */
const mail = (subject: string, { from = "Ada Lovelace <ada@example.org>", to = "grace@example.com", headers = [] as string[], answers }: { from?: string; to?: string; headers?: string[]; answers?: string } = {}) =>
  [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    "Date: Tue, 10 Nov 2026 09:00:00 +0100",
    `Message-ID: <${subject.replaceAll(" ", "-")}@example.org>`,
    ...(answers === undefined ? [] : [`In-Reply-To: <${answers.replaceAll(" ", "-")}@example.org>`, `References: <${answers.replaceAll(" ", "-")}@example.org>`]),
    ...headers,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Hi Grace.",
  ].join("\r\n");

const text = "I'm away until 18 November, without mail.\n\nWrite to support@example.com if it can't wait.";

// Tuesday 10 November 2026, 10:00 in Stockholm, which is an hour ahead of UTC.
const tuesday = new Date("2026-11-10T09:00:00Z");
// Tests move the clock days ahead, and sessions last as long.
const tokensLast = 30 * 24 * 3600;

/** A deployment where the human Grace has a mailbox at grace@example.com, its Screener off, and lives in Stockholm. */
async function withGrace({ screener = false }: { screener?: boolean } = {}) {
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org"], accessTokenLifetime: tokensLast });
  await duva.clock(tuesday);
  const ada = duva.signIn("ada@example.org");
  const grace = duva.signIn("grace@example.org");
  const { data: me } = await grace.GET("/whoami");
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: me!.id, address: "grace@example.com" } });
  const params = { path: { mailbox: mailbox!.id } };
  await grace.PATCH("/mailboxes/{mailbox}/screener", { params, body: { on: screener } });
  await grace.PATCH("/preferences", { body: { timeZone: "Europe/Stockholm" } });
  const away = (body: components["schemas"]["AwayMessageChanges"]) => grace.PATCH("/away-message", { body });
  /** Switches Grace's away message on, with her text for the mailbox and any days. */
  const goAway = async (days: { firstDay: string; lastDay: string } | object = {}) => {
    await away({ mailbox: mailbox!.id, text });
    return away({ on: true, ...days });
  };
  const changes = async () => (await grace.GET("/mailboxes/{mailbox}/changes", { params })).data!.changes;
  /** Receives the message, and answers its thread's ID. */
  const receive = async (raw: string, envelope: { from?: string; to?: string[] } = {}, options?: Parameters<typeof duva.receive>[2]) => {
    await duva.receive(raw, { to: ["grace@example.com"], ...envelope }, options);
    return (await changes()).findLast((change) => change.type === "messageReceived")?.thread;
  };
  /** The away messages SES accepted for sending, as raw MIME. */
  const replies = () => duva.sent().filter((raw) => /^Auto-Submitted: auto-replied/im.test(raw));
  return { duva, ada, grace, mailbox: mailbox!.id, params, away, goAway, receive, changes, replies };
}

/** The value of the raw message's header field, unfolded, or undefined if it has none. */
const header = (raw: string, name: string) => new RegExp(`^${name}: (.*(?:\\r\\n[ \\t].*)*)`, "im").exec(raw.split("\r\n\r\n")[0]!)?.[1]?.replace(/\r\n[ \t]+/g, " ");

test("while Grace is away, a person's mail to her Inbox gets her away message once, from the address it came to, as an automatic reply to it", async () => {
  const { duva, grace, params, goAway, receive, replies } = await withGrace();
  const { response, data } = await goAway();
  expect(response.status).toBe(200);
  expect(data).toMatchObject({ on: true, away: true, mailboxes: [{ address: "grace@example.com", text }] });

  await receive(mail("Lunch"), { to: ["grace+lunch@example.com"] });
  await receive(mail("Lunch again"));

  expect(replies()).toHaveLength(1);
  const [reply] = replies();
  expect(header(reply!, "From")).toBe("grace@example.com");
  expect(header(reply!, "To")).toBe("ada@example.org");
  expect(header(reply!, "Subject")).toBe("Away: Lunch");
  expect(header(reply!, "In-Reply-To")).toBe("<Lunch@example.org>");
  expect(header(reply!, "References")).toBe("<Lunch@example.org>");
  expect(header(reply!, "Precedence")).toBeUndefined();
  expect(header(reply!, "Duva-Agent")).toBeUndefined();
  expect(header(reply!, "Content-Type")).toMatch(/^multipart\/alternative/);
  expect(reply).toContain("Content-Type: text/plain");
  expect(reply).toContain("I'm away until 18 November, without mail.");
  expect(reply).toContain("Content-Type: text/html");
  expect(reply).toContain("<p>I'm away until 18 November, without mail.</p>");
  expect(duva.sentTo().at(-1)).toEqual(["ada@example.org"]);
  expect((await grace.GET("/mailboxes/{mailbox}/sent", { params })).data!.threads).toEqual([]);
});

test("the thread notes the away message on the message it answered, and the mailbox's change feed records it, sent by Duva", async () => {
  const { grace, params, goAway, receive, changes } = await withGrace();
  await goAway();

  const thread = await receive(mail("Lunch"));

  const { data } = await grace.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { ...params.path, thread: thread! } } });
  expect(data!.messages[0]!.awayMessage).toEqual({ sentAt: expect.stringMatching(/^2026-11-10T09:/), to: "ada@example.org" });
  const sent = (await changes()).filter(({ type }) => type === "awayMessageSent");
  expect(sent).toEqual([{ position: expect.any(Number), at: expect.any(String), actor: "duva", type: "awayMessageSent", thread, message: data!.messages[0]!.id, to: "ada@example.org" }]);
});

test("the away message goes from the first day's start to the last day's end in Grace's time zone, and then switches itself off", async () => {
  const { duva, away, goAway, receive, replies, grace } = await withGrace();
  await goAway({ firstDay: "2026-11-12", lastDay: "2026-11-18" });
  expect((await grace.GET("/away-message")).data).toMatchObject({ on: true, away: false, firstDay: "2026-11-12", lastDay: "2026-11-18" });

  await receive(mail("Before"));
  expect(replies()).toHaveLength(0);

  // Midnight in Stockholm is 23:00 UTC.
  await duva.clock(new Date("2026-11-11T23:00:00Z"));
  await receive(mail("First day"));
  expect(replies()).toHaveLength(1);
  expect((await grace.GET("/away-message")).data).toMatchObject({ on: true, away: true });

  await duva.clock(new Date("2026-11-18T22:59:00Z"));
  await receive(mail("Last day", { from: "Alan Turing <alan@example.org>" }));
  expect(replies()).toHaveLength(2);

  await duva.clock(new Date("2026-11-18T23:00:00Z"));
  await receive(mail("After", { from: "Joan Clarke <joan@example.org>" }));
  expect(replies()).toHaveLength(2);
  expect((await grace.GET("/away-message")).data).toMatchObject({ on: false, away: false });

  // Changing her time zone later doesn't bring it back.
  await grace.PATCH("/preferences", { body: { timeZone: "America/Los_Angeles" } });
  expect((await away({ subject: "Away" })).data).toMatchObject({ on: false, away: false });
});

test("switching the away message on again starts a new time away, so a sender who got it gets it again", async () => {
  const { away, goAway, receive, replies } = await withGrace();
  await goAway();
  await receive(mail("Lunch"));

  await away({ on: false });
  await receive(mail("While back"));
  expect(replies()).toHaveLength(1);

  await away({ on: true });
  await receive(mail("Lunch again"));

  expect(replies()).toHaveLength(2);
});

test("changing the days while Grace is away goes on with the same time away, so no one gets it twice, and the new last day is when it ends", async () => {
  const { duva, away, goAway, receive, replies, grace } = await withGrace();
  await goAway({ firstDay: "2026-11-10", lastDay: "2026-11-12" });
  await receive(mail("Lunch"));

  await away({ firstDay: "2026-11-10", lastDay: "2026-11-20" });
  await receive(mail("Lunch again"));
  expect(replies()).toHaveLength(1);

  // The first last day's end passes, and it stays on until the new one's.
  await duva.clock(new Date("2026-11-13T09:00:00Z"));
  expect((await grace.GET("/away-message")).data).toMatchObject({ on: true, away: true });
  await receive(mail("Dinner", { from: "Alan Turing <alan@example.org>" }));
  expect(replies()).toHaveLength(2);

  await duva.clock(new Date("2026-11-20T23:00:00Z"));
  expect((await grace.GET("/away-message")).data).toMatchObject({ on: false, away: false });
});

test("a subject Grace gives replaces Away: and the subject answered", async () => {
  const { away, goAway, receive, replies } = await withGrace();
  await goAway();
  await away({ subject: "Away until 18 November" });

  await receive(mail("Lunch"));

  expect(header(replies()[0]!, "Subject")).toBe("Away until 18 November");
});

test("a mailbox without a text sends no away message while Grace's other mailbox with one does", async () => {
  const { duva, ada, grace, goAway, receive, replies } = await withGrace();
  const { data: me } = await grace.GET("/whoami");
  await ada.POST("/mailboxes", { body: { owner: me!.id, address: "hopper@example.com" } });
  await goAway();

  await duva.receive(mail("To the other", { to: "hopper@example.com" }), { to: ["hopper@example.com"] });
  await receive(mail("Lunch"));

  expect(replies().map((raw) => header(raw, "From"))).toEqual(["grace@example.com"]);
});

test.each([
  ["Auto-Submitted: auto-generated", "an automatic message"],
  ["Auto-Submitted: auto-replied", "another automatic reply"],
  ["Precedence: bulk", "bulk mail"],
  ["Precedence: list", "a list's mail"],
  ["Precedence: junk", "junk"],
  ["List-Id: <news.example.org>", "a mailing list's mail"],
  ["List-Unsubscribe: <https://example.org/unsubscribe>", "a newsletter"],
])("mail with %s gets no away message, as %s", async (field) => {
  const { goAway, receive, replies } = await withGrace();
  await goAway();

  await receive(mail("Automatic", { headers: [field] }));

  expect(replies()).toEqual([]);
});

test("mail saying Auto-Submitted: no is a person's, and gets the away message", async () => {
  const { goAway, receive, replies } = await withGrace();
  await goAway();

  await receive(mail("Lunch", { headers: ["Auto-Submitted: no"] }));

  expect(replies()).toHaveLength(1);
});

test.each([
  ["no-reply@example.org", "a no-reply address"],
  ["noreply@example.org", "a no-reply address"],
  ["do-not-reply@example.org", "a no-reply address"],
  ["MAILER-DAEMON@example.org", "a bounce address"],
  ["postmaster@example.org", "a bounce address"],
  ["bounces+123@example.org", "a bounce address"],
  ["news-request@example.org", "a list's address"],
  ["no-reply@example.com", "the organization's own automatic address"],
])("mail from %s gets no away message, as %s", async (from) => {
  const { goAway, receive, replies } = await withGrace();
  await goAway();

  await receive(mail("Automatic", { from }));

  expect(replies()).toEqual([]);
});

test("mail with an empty envelope sender, as a bounce has, gets no away message", async () => {
  const { goAway, receive, replies } = await withGrace();
  await goAway();

  await receive(mail("Undelivered"), { from: "" });

  expect(replies()).toEqual([]);
});

test("mail SES judged to be spam gets no away message", async () => {
  const { goAway, receive, replies } = await withGrace();
  await goAway();

  await receive(mail("Prize"), {}, { verdicts: { spam: "FAIL" } });

  expect(replies()).toEqual([]);
});

test("mail joining a thread Grace moved to Spam gets no away message", async () => {
  const { grace, params, goAway, receive, replies } = await withGrace();
  const thread = await receive(mail("Offer"));
  await grace.POST("/mailboxes/{mailbox}/threads/labels", { params, body: { threads: [thread!], add: ["spam"] } });
  await goAway();

  await receive(mail("Re: Offer", { answers: "Offer" }));

  expect(replies()).toEqual([]);
});

test.each(["feed", "paperTrail", "nowhere"] as const)("mail from a sender whose delivery is %s gets no away message", async (delivery) => {
  const { grace, params, goAway, receive, replies } = await withGrace();
  await grace.PUT("/mailboxes/{mailbox}/senders/{sender}", { params: { path: { ...params.path, sender: "ada@example.org" } }, body: { delivery } });
  await goAway();

  await receive(mail("News"));

  expect(replies()).toEqual([]);
});

test("mail waiting in the Screener gets no away message, while a sender Grace screened in gets it", async () => {
  const { grace, params, goAway, receive, replies } = await withGrace({ screener: true });
  await grace.PUT("/mailboxes/{mailbox}/senders/{sender}", { params: { path: { ...params.path, sender: "alan@example.org" } }, body: { delivery: "inbox" } });
  await goAway();

  await receive(mail("Hello"));
  await receive(mail("Lunch", { from: "Alan Turing <alan@example.org>" }));

  expect(replies().map((raw) => header(raw, "To"))).toEqual(["alan@example.org"]);
});

test("a group's copy of mail to it gets no away message", async () => {
  const { duva, ada, goAway, replies } = await withGrace();
  await ada.POST("/groups", { body: { address: "team@example.com", members: ["grace@example.com"] } });
  await goAway();

  await duva.receive(mail("To the team", { to: "team@example.com" }), { to: ["team@example.com"] });

  expect(replies()).toEqual([]);
});

test("Grace's own mail to her mailbox gets no away message", async () => {
  const { goAway, receive, replies } = await withGrace();
  await goAway();

  await receive(mail("Note to self", { from: "Grace <grace@example.com>" }));

  expect(replies()).toEqual([]);
});

test("a message SES hands Duva twice gets one away message", async () => {
  const { goAway, receive, replies } = await withGrace();
  await goAway();

  await receive(mail("Lunch"), {}, { invocations: 2 });

  expect(replies()).toHaveLength(1);
});

test("the away message can't be switched on without a text, nor have days that have passed or a mailbox that isn't Grace's", async () => {
  const { away, mailbox } = await withGrace();

  const noText = await away({ on: true });
  const passed = await away({ firstDay: "2026-11-01", lastDay: "2026-11-09" });
  const backwards = await away({ firstDay: "2026-11-18", lastDay: "2026-11-12" });
  const alone = await away({ firstDay: "2026-11-18" });
  const notHers = await away({ mailbox: "someone-else", text });
  const textAlone = await away({ text });

  expect(noText.response.status).toBe(400);
  expect(noText.error).toEqual({ message: "Give a text for at least one of your mailboxes first, with mailbox and text, then switch it on." });
  expect(passed.error).toEqual({ message: "The last day has passed in your time zone, Europe/Stockholm. Give a lastDay from today on." });
  expect(backwards.error).toEqual({ message: "The last day is before the first. Give a lastDay from firstDay on." });
  expect(alone.error).toEqual({ message: "Give firstDay and lastDay together, as days, or both as null to be away until you switch it off." });
  expect(notHers.error).toEqual({ message: "\"someone-else\" isn't one of your mailboxes. Give mailbox as the ID of one of yours, which listing your mailboxes gives." });
  expect(textAlone.error).toEqual({ message: "Give mailbox and text together, to change that mailbox's text." });
  expect((await away({ mailbox, text: null })).data).toMatchObject({ on: false, away: false, mailboxes: [{ mailbox, address: "grace@example.com" }] });
});

test("only humans have an away message", async () => {
  const { duva, ada } = await withGrace();
  const { data: agent } = await ada.POST("/agents", { body: { name: "Hermes" } });
  const hermes = duva.withKey(agent!.key);

  const { response, error } = await hermes.GET("/away-message");

  expect(response.status).toBe(403);
  expect(error).toEqual({ message: "Only humans have an away message. Ask your sponsor to set theirs." });
});
