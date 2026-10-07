import { expect, test } from "vitest";
import type { DuvaClient } from "@duva/client";
import type { components } from "@duva/openapi";
import { type DuvaOptions, startDuva } from "./harness.ts";

type Delivery = components["schemas"]["Delivery"];

/** A message from the sender to the mailbox at `to` that starts its own thread, with the subject. */
const note = (from: string, subject: string, { to = "grace@example.com", inReplyTo }: { to?: string; inReplyTo?: string } = {}) =>
  [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    "Date: Tue, 06 Oct 2026 09:00:00 +0200",
    `Message-ID: <${subject.replaceAll(" ", "-")}@mail.test>`,
    ...(inReplyTo === undefined ? [] : [`In-Reply-To: ${inReplyTo}`]),
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Hej.",
  ].join("\r\n");

/**
 * A deployment on example.com where Ada is the first admin. Grace is a human with a personal
 * mailbox at grace@example.com, and sponsors the agent Iris, which has hers at iris@example.com.
 * Linus is another human.
 */
async function withScreener(options: DuvaOptions = {}) {
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org", "linus@example.org"], ...options });
  const ada = duva.signIn("ada@example.org");
  const grace = duva.signIn("grace@example.org");
  const { data: me } = await grace.GET("/whoami");
  const { data: created } = await grace.POST("/agents", { body: { name: "Iris" } });
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: me!.id, address: "grace@example.com" } });
  const { data: irisMailbox } = await ada.POST("/mailboxes", { body: { owner: created!.agent.id, address: "iris@example.com" } });
  const params = { path: { mailbox: mailbox!.id } };
  const irisParams = { path: { mailbox: irisMailbox!.id } };

  /** Hands SES the message for the mailbox at `to`, and answers the arrival as its change feed records it. */
  const receive = async (raw: string, { to = "grace@example.com", spam = false, dmarc }: { to?: string; spam?: boolean; dmarc?: "FAIL" | "GRAY" } = {}) => {
    await duva.receive(raw, { to: [to] }, { verdicts: { ...(spam && { spam: "FAIL" }), ...(dmarc !== undefined && { dmarc }) } });
    const { data } = await grace.GET("/mailboxes/{mailbox}/changes", { params: { ...(to === "grace@example.com" ? params : irisParams), query: { spam: true } } });
    return data!.changes.findLast((change) => change.type === "messageReceived" || change.type === "messageDropped") as { type: string; thread: string; message: string; screened?: string; delivered?: string; spam?: boolean };
  };
  /** The IDs of the threads the listing of the mailbox lists, newest first. */
  const listed = async (label: string, at = params) => (await grace.GET("/mailboxes/{mailbox}/threads", { params: { ...at, query: { label } } })).data!.threads.map(({ id }) => id);
  const allMail = async (at = params) => (await grace.GET("/mailboxes/{mailbox}/all-mail", { params: at })).data!.threads.map(({ id }) => id);
  const screener = async (client: DuvaClient = grace, at = params) => (await client.GET("/mailboxes/{mailbox}/screener", { params: at })).data!;
  /** The addresses of the senders waiting in the Screener, newest first. */
  const waiting = async (at = params) => (await screener(grace, at)).senders.map(({ address }) => address);
  /** Decides where mail from the address or domain goes in the mailbox. */
  const decide = (sender: string, delivery: Delivery, client: DuvaClient = grace, at = params) =>
    client.PUT("/mailboxes/{mailbox}/senders/{sender}", { params: { path: { ...at.path, sender } }, body: { delivery } });
  const letIn = (sender: string, client: DuvaClient = grace, at = params) => decide(sender, "inbox", client, at);
  const senders = async (client: DuvaClient = grace) => (await client.GET("/mailboxes/{mailbox}/senders", { params })).data!.senders;
  const remove = (decided: string, client: DuvaClient = grace) => client.DELETE("/mailboxes/{mailbox}/senders/{sender}", { params: { path: { ...params.path, sender: decided } } });
  const turn = (on: boolean, client: DuvaClient = grace, at = params) => client.PATCH("/mailboxes/{mailbox}/screener", { params: at, body: { on } });
  /** The mailbox's changes, from the start. */
  const changes = async (at = params) => (await grace.GET("/mailboxes/{mailbox}/changes", { params: { ...at, query: { spam: true } } })).data!.changes;
  /** Grace writes a message to the recipients and sends it from her mailbox. */
  const send = async (to: string[]) => {
    const { data: draft } = await grace.POST("/mailboxes/{mailbox}/drafts", { params, body: { to, subject: "Hej", text: "Hej." } });
    const { response } = await grace.POST("/mailboxes/{mailbox}/drafts/{draft}/send", { params: { path: { ...params.path, draft: draft!.id } } });
    expect(response.status).toBe(202);
  };
  return {
    duva,
    ada,
    grace,
    graceId: me!.id,
    iris: duva.withKey(created!.key),
    irisId: created!.agent.id,
    linus: duva.signIn("linus@example.org"),
    mailbox: mailbox!,
    params,
    irisParams,
    receive,
    listed,
    allMail,
    screener,
    waiting,
    decide,
    letIn,
    senders,
    remove,
    turn,
    changes,
    send,
  };
}

test("mail from a first-time sender waits in the Screener, out of the Inbox, All mail and the unread counts", async () => {
  const { grace, params, receive, listed, allMail, screener } = await withScreener();

  const arrival = await receive(note("Mallory <mallory@example.net>", "Pitch"));

  expect(arrival.screened).toBe("waiting");
  expect(await listed("inbox")).toEqual([]);
  expect(await allMail()).toEqual([]);
  expect((await grace.GET("/mailboxes/{mailbox}", { params })).data!.unread).toBe(0);
  expect((await grace.GET("/mailboxes/{mailbox}/labels", { params })).data!.labels.map(({ id, unread }) => ({ id, unread }))).toEqual([
    { id: "inbox", unread: 0 },
    { id: "feed", unread: 0 },
    { id: "paperTrail", unread: 0 },
    { id: "spam", unread: 0 },
    { id: "trash", unread: 0 },
  ]);
  expect(await screener()).toEqual({
    on: true,
    senders: [
      {
        address: "mallory@example.net",
        name: "Mallory",
        latestAt: expect.any(String),
        threads: [expect.objectContaining({ id: arrival.thread, subject: "Pitch", labels: ["screener"], unread: true })],
      },
    ],
    decided: 0,
  });
});

test("the Screener lists waiting senders newest first, each with their waiting threads newest first", async () => {
  const { receive, screener } = await withScreener();
  const first = await receive(note("mallory@example.net", "First"));
  const other = await receive(note("Oscar <oscar@example.net>", "Other"));
  const second = await receive(note("Mallory M <MALLORY@example.net>", "Second"));

  const { senders } = await screener();

  expect(senders.map(({ address, name, threads }) => ({ address, name, threads: threads.map(({ id }) => id) }))).toEqual([
    { address: "MALLORY@example.net", name: "Mallory M", threads: [second.thread, first.thread] },
    { address: "oscar@example.net", name: "Oscar", threads: [other.thread] },
  ]);
});

test("mail from an address the mailbox has sent to skips the Screener", async () => {
  const { receive, listed, waiting, send } = await withScreener();
  await send(["Bob@Example.NET"]);

  const arrival = await receive(note("Bob <bob@example.net>", "Hello back"));

  expect(arrival.screened).toBeUndefined();
  expect(await listed("inbox")).toEqual([arrival.thread]);
  expect(await waiting()).toEqual([]);
});

test("mail from the organization's own domain with a DMARC pass skips the Screener, but not from its subdomains", async () => {
  const { receive, listed, waiting } = await withScreener();

  const colleague = await receive(note("Linus <linus@example.com>", "Lunch"));
  const sub = await receive(note("noreply@mail.example.com", "Notice"));

  expect(await listed("inbox")).toEqual([colleague.thread]);
  expect(sub.screened).toBe("waiting");
  expect(await waiting()).toEqual(["noreply@mail.example.com"]);
});

test("mail on the organization's own domain without a DMARC pass is first-time, unless the mailbox decided on it or wrote to it", async () => {
  const { receive, listed, waiting, letIn, send } = await withScreener();
  await letIn("ada@example.com");
  await send(["iris@example.com"]);

  const forged = await receive(note("Linus <linus@example.com>", "Forged"), { dmarc: "FAIL" });
  const unchecked = await receive(note("noreply@example.com", "Unchecked"), { dmarc: "GRAY" });
  const letInMail = await receive(note("ada@example.com", "Let in"), { dmarc: "FAIL" });
  const writtenTo = await receive(note("iris@example.com", "Written to"), { dmarc: "FAIL" });

  expect([forged.screened, unchecked.screened]).toEqual(["waiting", "waiting"]);
  expect([letInMail.screened, writtenTo.screened]).toEqual([undefined, undefined]);
  expect(await listed("inbox")).toEqual([writtenTo.thread, letInMail.thread]);
  expect(await waiting()).toEqual(["noreply@example.com", "linus@example.com"]);
});

test("a first-time sender's message that joins a thread the mailbox has is never screened", async () => {
  const { receive, listed, waiting, letIn } = await withScreener();
  await letIn("bob@example.net");
  const started = await receive(note("bob@example.net", "Plans"));

  const joined = await receive(note("Carol <carol@example.net>", "Re Plans", { inReplyTo: "<Plans@mail.test>" }));

  expect(joined.thread).toBe(started.thread);
  expect(joined.screened).toBeUndefined();
  expect(await listed("inbox")).toEqual([started.thread]);
  expect(await waiting()).toEqual([]);
});

test("spam goes to Spam, not the Screener, from a first-time sender and from one sent to the Feed", async () => {
  const { receive, listed, waiting, decide } = await withScreener();
  await decide("news@example.net", "feed");

  const spam = await receive(note("mallory@example.net", "Prize"), { spam: true });
  const feedSpam = await receive(note("news@example.net", "Prize again"), { spam: true });

  expect([spam.screened, feedSpam.screened, feedSpam.delivered]).toEqual([undefined, undefined, undefined]);
  expect(await listed("spam")).toEqual([feedSpam.thread, spam.thread]);
  expect(await listed("feed")).toEqual([]);
  expect(await waiting()).toEqual([]);
});

test("sending an address's mail to the Inbox moves its waiting threads there, and its later mail skips the Screener", async () => {
  const { graceId, receive, listed, waiting, screener, letIn, changes } = await withScreener();
  const first = await receive(note("mallory@example.net", "First"));
  const second = await receive(note("mallory@example.net", "Second"));
  await receive(note("oscar@example.net", "Other"));

  const { response, data } = await letIn("Mallory@Example.NET");
  const later = await receive(note("mallory@example.net", "Later"));

  expect(response.status).toBe(200);
  expect(data).toEqual({
    sender: { address: "mallory@example.net", delivery: "inbox", decidedAt: expect.any(String), actor: graceId },
    threads: [expect.objectContaining({ id: second.thread, labels: ["inbox"] }), expect.objectContaining({ id: first.thread, labels: ["inbox"] })],
  });
  expect(later.screened).toBeUndefined();
  expect(await listed("inbox")).toEqual([later.thread, second.thread, first.thread]);
  expect(await waiting()).toEqual(["oscar@example.net"]);
  expect((await screener()).decided).toBe(1);
  expect((await changes()).filter(({ type }) => type !== "messageReceived")).toEqual([
    { position: 4, at: expect.any(String), actor: graceId, type: "senderDeliverySet", address: "mallory@example.net", delivery: "inbox" },
    { position: 5, at: expect.any(String), actor: graceId, type: "threadLabelsChanged", thread: second.thread, added: ["inbox"], removed: ["screener"] },
    { position: 6, at: expect.any(String), actor: graceId, type: "threadLabelsChanged", thread: first.thread, added: ["inbox"], removed: ["screener"] },
  ]);
});

test("deciding on a sender again replaces the decision", async () => {
  const { receive, listed, screener, decide } = await withScreener();
  await decide("mallory@example.net", "feed");
  await decide("mallory@example.net", "inbox");

  const arrival = await receive(note("mallory@example.net", "First"));

  expect(await listed("inbox")).toEqual([arrival.thread]);
  expect(await listed("feed")).toEqual([]);
  expect((await screener()).decided).toBe(1);
});

test("deciding on something that is neither an email address nor a domain is refused", async () => {
  const { grace, params, decide, senders } = await withScreener();

  const notAddresses = await Promise.all([decide("not an address", "inbox"), decide("example", "feed")]);
  const notEmail = await decide("a@b@example.net", "inbox");
  const noDelivery = await grace.PUT("/mailboxes/{mailbox}/senders/{sender}", { params: { path: { ...params.path, sender: "mallory@example.net" } }, body: { delivery: "trash" } as unknown as { delivery: Delivery } });

  for (const { response, error } of notAddresses) {
    expect(response.status).toBe(400);
    expect(error?.message).toMatch(/isn't an address or a domain/);
  }
  expect(notEmail.response.status).toBe(400);
  expect(notEmail.error?.message).toMatch(/isn't an email address/);
  expect(noDelivery.response.status).toBe(400);
  expect(noDelivery.error?.message).toMatch(/Give delivery as inbox, feed, paperTrail, label or nowhere/);
  expect(await senders()).toEqual([]);
});

test("a waiting thread moved to Trash and restored waits again, and adding inbox moves it to the Inbox", async () => {
  const { grace, params, receive, listed, waiting } = await withScreener();
  const { thread } = await receive(note("mallory@example.net", "Pitch"));
  const label = (change: { add?: string[]; remove?: string[] }) => grace.POST("/mailboxes/{mailbox}/threads/labels", { params, body: { threads: [thread], ...change } });

  await label({ add: ["trash"] });
  const trashed = { trash: await listed("trash"), waiting: await waiting() };
  await label({ remove: ["trash"] });
  const restored = await waiting();
  const { data } = await label({ add: ["inbox"] });

  expect(trashed).toEqual({ trash: [thread], waiting: [] });
  expect(restored).toEqual(["mallory@example.net"]);
  expect(data!.threads).toMatchObject([{ id: thread, labels: ["inbox"] }]);
  expect(await listed("inbox")).toEqual([thread]);
  expect(await waiting()).toEqual([]);
});

test("a waiting thread with one of the mailbox's own labels is left out of that label's listing and unread count", async () => {
  const { grace, params, receive, listed } = await withScreener();
  const { thread } = await receive(note("mallory@example.net", "Pitch"));
  const { data: label } = await grace.POST("/mailboxes/{mailbox}/labels", { params, body: { name: "Later" } });

  await grace.POST("/mailboxes/{mailbox}/threads/labels", { params, body: { threads: [thread], add: [label!.id] } });

  expect(await listed(label!.id)).toEqual([]);
  expect((await grace.GET("/mailboxes/{mailbox}/labels", { params })).data!.labels.find(({ id }) => id === label!.id)?.unread).toBe(0);
});

test("the screener state can't be added or removed as a label", async () => {
  const { grace, params, receive } = await withScreener();
  const { thread } = await receive(note("mallory@example.net", "Pitch"));

  const { response } = await grace.POST("/mailboxes/{mailbox}/threads/labels", { params, body: { threads: [thread], remove: ["screener"] } });

  expect(response.status).toBe(400);
});

test("a human's mailbox starts with the Screener on, and an agent's with it off", async () => {
  const { grace, irisParams, receive, listed, screener } = await withScreener();

  const arrival = await receive(note("mallory@example.net", "Hi Iris", { to: "iris@example.com" }), { to: "iris@example.com" });

  expect((await screener()).on).toBe(true);
  expect((await screener(grace, irisParams)).on).toBe(false);
  expect(arrival.screened).toBeUndefined();
  expect(await listed("inbox", irisParams)).toEqual([arrival.thread]);
});

test("switching the Screener off moves waiting threads to the Inbox, and later first-time senders' mail goes there too", async () => {
  const { graceId, receive, listed, screener, turn, changes } = await withScreener();
  const waited = await receive(note("mallory@example.net", "First"));

  const { response, data } = await turn(false);
  const later = await receive(note("oscar@example.net", "Later"));

  expect(response.status).toBe(200);
  expect(data).toEqual({ on: false, senders: [], decided: 0 });
  expect(later.screened).toBeUndefined();
  expect(await listed("inbox")).toEqual([later.thread, waited.thread]);
  expect(await screener()).toEqual({ on: false, senders: [], decided: 0 });
  expect((await changes()).filter(({ type }) => type !== "messageReceived")).toEqual([
    { position: 2, at: expect.any(String), actor: graceId, type: "screenerSwitched", on: false },
    { position: 3, at: expect.any(String), actor: graceId, type: "threadLabelsChanged", thread: waited.thread, added: ["inbox"], removed: ["screener"] },
  ]);
});

test("a delivery holds while the Screener is off", async () => {
  const { receive, listed, decide, turn } = await withScreener();
  await turn(false);
  await decide("news@example.net", "feed");

  const arrival = await receive(note("news@example.net", "Issue 1"));

  expect(arrival.delivered).toBe("feed");
  expect(await listed("feed")).toEqual([arrival.thread]);
});

test("switching the Screener on sends every sender already in the mailbox to the Inbox, except those in Spam", async () => {
  const { grace, graceId, irisParams, receive, listed, waiting, screener, turn, changes } = await withScreener();
  const iris = { to: "iris@example.com" };
  await receive(note("Mallory <mallory@example.net>", "One", iris), iris);
  await receive(note("mallory@example.net", "Two", iris), iris);
  await receive(note("oscar@example.net", "Three", iris), iris);
  await receive(note("spammer@example.net", "Four", iris), { ...iris, spam: true });

  const { response, data } = await turn(true, grace, irisParams);
  const known = await receive(note("oscar@example.net", "Five", iris), iris);
  const spammer = await receive(note("spammer@example.net", "Six", iris), iris);
  const stranger = await receive(note("stranger@example.net", "Seven", iris), iris);

  expect(response.status).toBe(200);
  expect(data).toEqual({ on: true, senders: [], decided: 2 });
  expect(known.screened).toBeUndefined();
  expect(await listed("inbox", irisParams)).toContain(known.thread);
  expect([spammer.screened, stranger.screened]).toEqual(["waiting", "waiting"]);
  expect(await waiting(irisParams)).toEqual(["stranger@example.net", "spammer@example.net"]);
  expect((await screener(grace, irisParams)).decided).toBe(2);
  expect((await changes(irisParams)).filter(({ type }) => type === "screenerSwitched")).toEqual([
    { position: 5, at: expect.any(String), actor: graceId, type: "screenerSwitched", on: true, letIn: 2 },
  ]);
});

test("switching the Screener on keeps the mailbox's deliveries, and switching it to what it is records nothing", async () => {
  const { grace, irisParams, receive, listed, decide, turn, changes } = await withScreener();
  const iris = { to: "iris@example.com" };
  await decide("news@example.net", "paperTrail", grace, irisParams);
  await receive(note("oscar@example.net", "One", iris), iris);

  await turn(true, grace, irisParams);
  await turn(true, grace, irisParams);
  await turn(false, grace, irisParams);
  await turn(false, grace, irisParams);
  const filed = await receive(note("news@example.net", "Two", iris), iris);

  expect(filed.delivered).toBe("paperTrail");
  expect(await listed("paperTrail", irisParams)).toEqual([filed.thread]);
  expect((await changes(irisParams)).filter(({ type }) => type === "screenerSwitched").map((change) => (change as { on: boolean }).on)).toEqual([true, false]);
});

test("the owner and an agent's sponsor switch the Screener, and no one else", async () => {
  const { grace, iris, irisId, linus, ada, params, irisParams, turn, screener } = await withScreener();
  await grace.PATCH("/agents/{agent}/settings", { params: { path: { agent: irisId } }, body: { sponsorAccess: "send" } });

  const byOwner = await turn(false, grace, params);
  const bySponsor = await turn(true, grace, irisParams);
  const byAgentInOwn = await turn(false, iris, irisParams);
  const byAgentInSponsors = await turn(true, iris, params);
  const byOther = await turn(true, linus, params);
  const byAdmin = await turn(true, ada, params);

  expect([byOwner, bySponsor, byAgentInOwn].map(({ response }) => response.status)).toEqual([200, 200, 200]);
  expect(byAgentInSponsors.response.status).toBe(403);
  expect(byAgentInSponsors.error?.message).toMatch(/Only your sponsor can switch their Screener/);
  expect([byOther, byAdmin].map(({ response }) => response.status)).toEqual([403, 403]);
  expect((await screener()).on).toBe(false);
});

test("switching needs on as true or false", async () => {
  const { grace, params } = await withScreener();

  const { response, error } = await grace.PATCH("/mailboxes/{mailbox}/screener", { params, body: { on: "yes" } as unknown as { on: boolean } });

  expect(response.status).toBe(400);
  expect(error?.message).toMatch(/Give on as true/);
});

test("an agent with organize sponsor access or more screens its sponsor's mailbox, one with read sees what waits, and anyone else is refused", async () => {
  const { grace, iris, irisId, linus, ada, params, receive, waiting, letIn, decide, screener, changes } = await withScreener();
  await receive(note("mallory@example.net", "First"));
  await receive(note("oscar@example.net", "Second"));
  const access = (sponsorAccess: "read" | "send") => grace.PATCH("/agents/{agent}/settings", { params: { path: { agent: irisId } }, body: { sponsorAccess } });

  const withoutAccess = await iris.GET("/mailboxes/{mailbox}/screener", { params });
  await access("read");
  const seen = await screener(iris);
  const readDecides = await letIn("mallory@example.net", iris);
  await access("send");
  const letInByAgent = await letIn("mallory@example.net", iris);
  const feedByAgent = await decide("oscar@example.net", "feed", iris);
  const others = await Promise.all([letIn("oscar@example.net", linus), decide("oscar@example.net", "feed", ada), linus.GET("/mailboxes/{mailbox}/screener", { params })]);

  expect(withoutAccess.response.status).toBe(403);
  expect(seen.senders.map(({ address }) => address)).toEqual(["oscar@example.net", "mallory@example.net"]);
  expect(readDecides.response.status).toBe(403);
  expect([letInByAgent, feedByAgent].map(({ response }) => response.status)).toEqual([200, 200]);
  expect(others.map(({ response }) => response.status)).toEqual([403, 403, 403]);
  expect(await waiting()).toEqual([]);
  expect((await changes()).filter(({ type }) => type === "senderDeliverySet")).toEqual([
    expect.objectContaining({ actor: irisId, address: "mallory@example.net", delivery: "inbox" }),
    expect.objectContaining({ actor: irisId, address: "oscar@example.net", delivery: "feed" }),
  ]);
});

test("the first setup with the Screener switches it on for humans' mailboxes, sending their senders to the Inbox, and leaves agents' off", async () => {
  const { duva, irisParams, receive, listed, waiting, screener, send, changes } = await withScreener({ beforeScreener: true });
  const iris = { to: "iris@example.com" };
  await receive(note("Mallory <mallory@example.net>", "Before"));
  await receive(note("spammer@example.net", "Spam before"), { spam: true });
  await receive(note("oscar@example.net", "Iris before", iris), iris);
  await send(["bob@example.net"]);
  const beforeSetUp = await receive(note("stranger@example.net", "Before setup"));

  await duva.setUp({ admin: "ada@example.org" });
  const known = await receive(note("mallory@example.net", "After"));
  const sentTo = await receive(note("bob@example.net", "Reply as new"));
  const firstTime = await receive(note("newcomer@example.net", "Hello"));
  const spammer = await receive(note("spammer@example.net", "Not spam now"));
  const toIris = await receive(note("newcomer@example.net", "Hi Iris", iris), iris);

  expect(beforeSetUp.screened).toBeUndefined();
  expect([known.screened, sentTo.screened]).toEqual([undefined, undefined]);
  expect([firstTime.screened, spammer.screened]).toEqual(["waiting", "waiting"]);
  expect(await listed("inbox")).toEqual([sentTo.thread, known.thread, beforeSetUp.thread, expect.any(String)]);
  expect(await waiting()).toEqual(["spammer@example.net", "newcomer@example.net"]);
  expect(await screener()).toMatchObject({ on: true, decided: 2 });
  expect((await changes()).filter(({ type }) => type === "screenerSwitched")).toEqual([{ position: expect.any(Number), at: expect.any(String), type: "screenerSwitched", on: true, letIn: 2 }]);
  expect(toIris.screened).toBeUndefined();
  expect(await screener(undefined, irisParams)).toMatchObject({ on: false, decided: 0 });
});

test("setup again leaves the Screener as the owner switched it", async () => {
  const { duva, receive, screener, turn, changes } = await withScreener({ beforeScreener: true });
  await receive(note("mallory@example.net", "Before"));
  await duva.setUp({ admin: "ada@example.org" });
  await turn(false);

  await duva.setUp({ admin: "ada@example.org" });
  const arrival = await receive(note("stranger@example.net", "After"));

  expect(arrival.screened).toBeUndefined();
  expect((await screener()).on).toBe(false);
  expect((await changes()).filter(({ type }) => type === "screenerSwitched").map((change) => (change as { on: boolean }).on)).toEqual([true, false]);
});

test("a delivery for a domain covers everyone at exactly that domain, while its subdomains still wait", async () => {
  const { graceId, receive, listed, waiting, screener, letIn, changes } = await withScreener();
  const mallory = await receive(note("mallory@example.net", "First"));
  await receive(note("oscar@sub.example.net", "Sub"));

  const { response, data } = await letIn("Example.NET");
  const colleague = await receive(note("trudy@example.net", "Later"));
  const sub = await receive(note("walter@sub.example.net", "Later sub"));

  expect(response.status).toBe(200);
  expect(data).toEqual({
    sender: { domain: "example.net", delivery: "inbox", decidedAt: expect.any(String), actor: graceId },
    threads: [expect.objectContaining({ id: mallory.thread, labels: ["inbox"] })],
  });
  expect([colleague.screened, sub.screened]).toEqual([undefined, "waiting"]);
  expect(await listed("inbox")).toEqual([colleague.thread, mallory.thread]);
  expect(await waiting()).toEqual(["walter@sub.example.net", "oscar@sub.example.net"]);
  expect((await screener()).decided).toBe(1);
  expect((await changes()).filter(({ type }) => type === "senderDeliverySet")).toEqual([
    { position: expect.any(Number), at: expect.any(String), actor: graceId, type: "senderDeliverySet", domain: "example.net", delivery: "inbox" },
  ]);
});

test("filing a domain's mail in the Paper Trail moves its senders' waiting threads there, and their later mail goes straight there", async () => {
  const { receive, listed, waiting, screener, decide } = await withScreener();
  const waited = await receive(note("mallory@example.net", "First"));
  const other = await receive(note("oscar@example.org", "Other"));

  const { data } = await decide("example.net", "paperTrail");
  const later = await receive(note("trudy@example.net", "Later"));

  expect(data!.threads).toEqual([expect.objectContaining({ id: waited.thread, labels: ["paperTrail"] })]);
  expect(later.delivered).toBe("paperTrail");
  expect(await listed("paperTrail")).toEqual([later.thread, waited.thread]);
  expect(await waiting()).toEqual(["oscar@example.org"]);
  expect((await screener()).senders[0]!.threads.map(({ id }) => id)).toEqual([other.thread]);
});

test("an address's decision beats its domain's, either way", async () => {
  const { receive, listed, decide } = await withScreener();
  await decide("example.net", "inbox");
  await decide("mallory@example.net", "feed");
  await decide("example.org", "feed");
  await decide("Oscar@example.org", "inbox");

  const fed = await receive(note("mallory@example.net", "Fed"));
  const letInAtDomain = await receive(note("trudy@example.net", "Let in"));
  const fedAtDomain = await receive(note("walter@example.org", "Fed at domain"));
  const letInAddress = await receive(note("oscar@example.org", "Let in address"));

  expect(await listed("feed")).toEqual([fedAtDomain.thread, fed.thread]);
  expect(await listed("inbox")).toEqual([letInAddress.thread, letInAtDomain.thread]);
});

test("a decision on an address at a domain moves only that address's waiting threads, and one on a domain leaves those with their own decision", async () => {
  const { receive, listed, waiting, letIn, decide } = await withScreener();
  await receive(note("mallory@example.net", "First"));
  const trudy = await receive(note("trudy@example.net", "Second"));
  await letIn("mallory@example.net");

  const { data } = await decide("example.net", "feed");

  expect(data!.threads.map(({ id }) => id)).toEqual([trudy.thread]);
  expect((await listed("inbox")).length).toBe(1);
  expect(await waiting()).toEqual([]);
});

test("a decision on a public mail provider's domain is refused", async () => {
  const { decide, senders } = await withScreener();

  const providers = await Promise.all([decide("gmail.com", "inbox"), decide("Outlook.com", "nowhere"), decide("proton.me", "feed"), decide("icloud.com.", "inbox")]);

  for (const { response, error } of providers) {
    expect(response.status).toBe(400);
    expect(error?.message).toMatch(/is a public mail provider/);
  }
  expect(await senders()).toEqual([]);
});

test("the senders list gives each address and domain, its delivery, when and by whom, newest first", async () => {
  const { graceId, iris, irisId, grace, receive, letIn, decide, senders, turn } = await withScreener();
  await receive(note("bob@example.org", "Known"));
  await turn(false);
  await turn(true);
  await letIn("example.net");
  await grace.PATCH("/agents/{agent}/settings", { params: { path: { agent: irisId } }, body: { sponsorAccess: "send" } });
  await decide("mallory@example.net", "paperTrail", iris);

  expect(await senders()).toEqual([
    { address: "mallory@example.net", delivery: "paperTrail", decidedAt: expect.any(String), actor: irisId },
    { domain: "example.net", delivery: "inbox", decidedAt: expect.any(String), actor: graceId },
    { address: "bob@example.org", delivery: "inbox", decidedAt: expect.any(String), actor: graceId },
  ]);
});

test("removing a decision makes the sender first-time again, and moves their threads where their mail went to the Inbox", async () => {
  const { graceId, receive, listed, decide, remove, senders, screener, changes } = await withScreener();
  const first = await receive(note("mallory@example.net", "First"));
  await decide("example.net", "feed");

  const { response, data } = await remove("Example.NET");
  const later = await receive(note("mallory@example.net", "Later"));

  expect(response.status).toBe(200);
  expect(data).toEqual({
    sender: { domain: "example.net", delivery: "feed", decidedAt: expect.any(String), actor: graceId },
    threads: [expect.objectContaining({ id: first.thread, labels: ["inbox"] })],
  });
  expect(later.screened).toBe("waiting");
  expect(await listed("inbox")).toEqual([first.thread]);
  expect(await senders()).toEqual([]);
  expect((await screener()).decided).toBe(0);
  expect((await changes()).filter(({ type }) => type === "senderDeliveryRemoved" || type === "threadLabelsChanged").slice(-2)).toEqual([
    { position: expect.any(Number), at: expect.any(String), actor: graceId, type: "senderDeliveryRemoved", domain: "example.net", delivery: "feed" },
    { position: expect.any(Number), at: expect.any(String), actor: graceId, type: "threadLabelsChanged", thread: first.thread, added: ["inbox"], removed: ["feed"] },
  ]);
});

test("removing an address's decision leaves its threads as its domain's decision has them", async () => {
  const { receive, listed, decide, remove } = await withScreener();
  await decide("example.net", "feed");
  await decide("mallory@example.net", "paperTrail");
  const mallory = await receive(note("mallory@example.net", "Mallory"));

  const { data } = await remove("mallory@example.net");

  expect(data!.threads.map(({ id, labels }) => ({ id, labels }))).toEqual([{ id: mallory.thread, labels: ["feed"] }]);
  expect(await listed("feed")).toEqual([mallory.thread]);
});

test("removing a decision the mailbox doesn't have is refused", async () => {
  const { remove, letIn } = await withScreener();
  await letIn("mallory@example.net");

  const results = await Promise.all([remove("oscar@example.net"), remove("example.net")]);

  for (const { response, error } of results) {
    expect(response.status).toBe(404);
    expect(error?.message).toMatch(/hasn't decided where mail from/);
  }
});

test("an agent with read sponsor access sees the senders, one with full removes decisions, and anyone else is refused", async () => {
  const { grace, iris, irisId, linus, params, letIn, senders, remove } = await withScreener();
  await letIn("mallory@example.net");
  await letIn("oscar@example.net");
  const access = (sponsorAccess: "read" | "send") => grace.PATCH("/agents/{agent}/settings", { params: { path: { agent: irisId } }, body: { sponsorAccess } });

  await access("read");
  const seen = await senders(iris);
  const readRemoves = await remove("mallory@example.net", iris);
  await access("send");
  const fullRemoves = await remove("mallory@example.net", iris);
  const others = await Promise.all([remove("oscar@example.net", linus), linus.GET("/mailboxes/{mailbox}/senders", { params })]);

  expect(seen.map(({ address }) => address)).toEqual(["oscar@example.net", "mallory@example.net"]);
  expect([readRemoves.response.status, fullRemoves.response.status]).toEqual([403, 200]);
  expect(others.map(({ response }) => response.status)).toEqual([403, 403]);
  expect((await senders()).map(({ address }) => address)).toEqual(["oscar@example.net"]);
});

test("switching the Screener on leaves senders at a domain decided on as the domain has them", async () => {
  const { receive, listed, decide, turn } = await withScreener();
  await turn(false);
  await decide("example.net", "feed");
  await receive(note("mallory@example.net", "Before"));
  await turn(true);

  const later = await receive(note("mallory@example.net", "Later"));

  expect(later.delivered).toBe("feed");
  expect((await listed("feed"))[0]).toBe(later.thread);
});
