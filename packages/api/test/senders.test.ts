import { expect, test } from "vitest";
import type { DuvaClient } from "@duva/client";
import type { components } from "@duva/openapi";
import { type DuvaOptions, startDuva } from "./harness.ts";

type Delivery = components["schemas"]["Delivery"];

/** A message from the sender to grace@example.com that starts its own thread, with the subject, or joins the one with the Message-ID `inReplyTo`. */
const note = (from: string, subject: string, { inReplyTo, text = "Hej." }: { inReplyTo?: string; text?: string } = {}) =>
  [
    `From: ${from}`,
    "To: grace@example.com",
    `Subject: ${subject}`,
    "Date: Tue, 06 Oct 2026 09:00:00 +0200",
    `Message-ID: <${subject.replaceAll(" ", "-")}@mail.test>`,
    ...(inReplyTo === undefined ? [] : [`In-Reply-To: ${inReplyTo}`]),
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    text,
  ].join("\r\n");

/**
 * A deployment on example.com where Ada is the first admin. Grace is a human with a personal
 * mailbox at grace@example.com, with the Screener on, and sponsors the agent Iris, which has send
 * sponsor access. Linus is another human.
 */
async function withSenders(options: DuvaOptions = {}) {
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org", "linus@example.org"], ...options });
  const ada = duva.signIn("ada@example.org");
  const grace = duva.signIn("grace@example.org");
  const { data: me } = await grace.GET("/whoami");
  const { data: created } = await grace.POST("/agents", { body: { name: "Iris" } });
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: me!.id, address: "grace@example.com" } });
  await grace.PATCH("/agents/{agent}/settings", { params: { path: { agent: created!.agent.id } }, body: { sponsorAccess: "send" } });
  const params = { path: { mailbox: mailbox!.id } };

  /** Hands SES the message, and answers its arrival or its drop as the mailbox's change feed records it. */
  const receive = async (raw: string, { spam = false }: { spam?: boolean } = {}) => {
    await duva.receive(raw, { to: ["grace@example.com"] }, { verdicts: spam ? { spam: "FAIL" } : {} });
    const { data } = await grace.GET("/mailboxes/{mailbox}/changes", { params: { ...params, query: { spam: true } } });
    return data!.changes.findLast((change) => change.type === "messageReceived" || change.type === "messageDropped") as { type: string; thread: string; delivered?: string; address?: string };
  };
  /** The IDs of the threads with the label, newest first. */
  const listed = async (label: string) => (await grace.GET("/mailboxes/{mailbox}/threads", { params: { ...params, query: { label } } })).data!.threads.map(({ id }) => id);
  const thread = async (id: string) => (await grace.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { ...params.path, thread: id } } })).data!;
  const sheet = (sender: string, client: DuvaClient = grace) => client.GET("/mailboxes/{mailbox}/senders/{sender}", { params: { path: { ...params.path, sender } } });
  const decide = (sender: string, delivery: Delivery, { label, client = grace }: { label?: string; client?: DuvaClient } = {}) =>
    client.PUT("/mailboxes/{mailbox}/senders/{sender}", { params: { path: { ...params.path, sender } }, body: { delivery, ...(label !== undefined && { label }) } });
  const label = async (name: string) => (await grace.POST("/mailboxes/{mailbox}/labels", { params, body: { name } })).data!.id;
  const relabel = (threads: string[], change: { add?: string[]; remove?: string[] }) => grace.POST("/mailboxes/{mailbox}/threads/labels", { params, body: { threads, ...change } });
  const unreadOn = async (id: string) => (await grace.GET("/mailboxes/{mailbox}/labels", { params })).data!.labels.find((each) => each.id === id)?.unread;
  const changes = async () => (await grace.GET("/mailboxes/{mailbox}/changes", { params: { ...params, query: { spam: true } } })).data!.changes;
  return { duva, ada, grace, graceId: me!.id, iris: duva.withKey(created!.key), linus: duva.signIn("linus@example.org"), params, receive, listed, thread, sheet, decide, label, relabel, unreadOn, changes };
}

test("a sender's sheet says how many threads they started, Spam and Trash included, and that their first mail waits in the Screener", async () => {
  const { receive, relabel, sheet } = await withSenders();
  const first = await receive(note("Mallory Hacker <mallory@example.net>", "First"));
  await receive(note("mallory@example.net", "Prize"), { spam: true });
  await relabel([first.thread], { add: ["trash"] });
  await receive(note("Mallory <Mallory@Example.net>", "Second"));
  await receive(note("oscar@example.net", "Other"));

  const { response, data } = await sheet("MALLORY@example.net");

  expect(response.status).toBe(200);
  expect(data).toEqual({ address: "mallory@example.net", name: "Mallory", threads: 3, goesTo: "screener" });
});

test("a sender's sheet says where their mail goes, by their own decision or else their domain's", async () => {
  const { graceId, receive, decide, sheet } = await withSenders();
  await receive(note("mallory@example.net", "First"));
  await decide("example.net", "feed");
  await decide("oscar@example.net", "paperTrail");

  const atDomain = (await sheet("mallory@example.net")).data;
  const own = (await sheet("oscar@example.net")).data;
  const domain = (await sheet("Example.NET")).data;
  const known = (await sheet("bob@example.com")).data;

  expect(atDomain).toEqual({ address: "mallory@example.net", threads: 1, goesTo: "feed", decided: { domain: "example.net", delivery: "feed", decidedAt: expect.any(String), actor: graceId } });
  expect(own).toEqual({ address: "oscar@example.net", threads: 0, goesTo: "paperTrail", decided: { address: "oscar@example.net", delivery: "paperTrail", decidedAt: expect.any(String), actor: graceId } });
  expect(domain).toMatchObject({ domain: "example.net", threads: 1, goesTo: "feed" });
  expect(known).toEqual({ address: "bob@example.com", threads: 0, goesTo: "inbox" });
});

test("only those who can read the mailbox read a sender's sheet, and a sheet needs an address or a domain", async () => {
  const { ada, linus, iris, sheet } = await withSenders();

  const [byAgent, byAdmin, byOther] = await Promise.all([sheet("mallory@example.net", iris), sheet("mallory@example.net", ada), sheet("mallory@example.net", linus)]);
  const [notSender, provider] = await Promise.all([sheet("nobody"), sheet("gmail.com")]);

  expect([byAgent.response.status, byAdmin.response.status, byOther.response.status]).toEqual([200, 403, 403]);
  expect([notSender.response.status, provider.response.status]).toEqual([400, 400]);
});

test("mail from a sender sent to the Feed skips the Inbox and arrives unread in the Feed, counted there, which All mail and search cover", async () => {
  const { grace, params, receive, listed, decide, unreadOn } = await withSenders();
  const { response, data } = await decide("news@example.net", "feed");

  const issue = await receive(note("News <news@example.net>", "Issue 1", { text: "This week, a lighthouse." }));

  expect(response.status).toBe(200);
  expect(data).toMatchObject({ sender: { address: "news@example.net", delivery: "feed" }, threads: [] });
  expect(issue.delivered).toBe("feed");
  expect(await listed("feed")).toEqual([issue.thread]);
  expect(await listed("inbox")).toEqual([]);
  expect((await grace.GET("/mailboxes/{mailbox}/all-mail", { params })).data!.threads.map(({ id }) => id)).toEqual([issue.thread]);
  expect((await grace.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { ...params.path, thread: issue.thread } } })).data).toMatchObject({ labels: ["feed"], unread: true });
  expect(await unreadOn("feed")).toBe(1);
  expect(await unreadOn("inbox")).toBe(0);
  expect((await grace.GET("/mailboxes/{mailbox}", { params })).data!.unread).toBe(0);
  const searched = await grace.GET("/mailboxes/{mailbox}/search", { params: { ...params, query: { q: "lighthouse label:feed" } } });
  expect(searched.error).toBeUndefined();
  expect(searched.data!.results.map(({ thread }) => thread.id)).toEqual([issue.thread]);
});

test("mail from a sender sent to the Paper Trail skips the Inbox and arrives unread in the Paper Trail, counted there", async () => {
  const { grace, params, receive, listed, thread, decide, unreadOn } = await withSenders();
  await decide("receipts@shop.example.net", "paperTrail");

  const receipt = await receive(note("receipts@shop.example.net", "Your order"));

  expect(receipt.delivered).toBe("paperTrail");
  expect(await listed("paperTrail")).toEqual([receipt.thread]);
  expect(await listed("inbox")).toEqual([]);
  expect(await thread(receipt.thread)).toMatchObject({ labels: ["paperTrail"], unread: true });
  expect(await unreadOn("paperTrail")).toBe(1);
  expect((await grace.GET("/mailboxes/{mailbox}", { params })).data!.unread).toBe(0);
});

test("mail screened into the Feed or the Paper Trail from the Screener arrives read there, and their later mail unread", async () => {
  const { receive, listed, thread, decide, unreadOn } = await withSenders();
  const issue = await receive(note("news@example.net", "Issue 1"));
  const receipt = await receive(note("receipts@shop.example.net", "Your order"));
  const waiting = await listed("screener");

  await decide("news@example.net", "feed");
  await decide("receipts@shop.example.net", "paperTrail");
  const later = await receive(note("news@example.net", "Issue 2"));

  expect(waiting).toEqual([receipt.thread, issue.thread]);
  expect(await thread(issue.thread)).toMatchObject({ labels: ["feed"], unread: false });
  expect(await thread(receipt.thread)).toMatchObject({ labels: ["paperTrail"], unread: false });
  expect(await thread(later.thread)).toMatchObject({ labels: ["feed"], unread: true });
  expect(await unreadOn("feed")).toBe(1);
  expect(await unreadOn("paperTrail")).toBe(0);
});

test("mail from a sender filed under a label skips the Inbox and arrives unread under the label, counted there", async () => {
  const { receive, listed, thread, decide, label, unreadOn } = await withSenders();
  const travel = await label("Travel");
  const { data } = await decide("trips@example.net", "label", { label: travel });

  const booking = await receive(note("trips@example.net", "Your booking"));

  expect(data!.sender).toMatchObject({ address: "trips@example.net", delivery: "label", label: travel });
  expect(booking.delivered).toBe("label");
  expect(await listed(travel)).toEqual([booking.thread]);
  expect(await listed("inbox")).toEqual([]);
  expect(await thread(booking.thread)).toMatchObject({ labels: [travel], unread: true });
  expect(await unreadOn(travel)).toBe(1);
});

test("a label delivery needs one of the mailbox's own labels, and only a label delivery takes a label", async () => {
  const { decide, label } = await withSenders();
  const travel = await label("Travel");

  const results = await Promise.all([decide("trips@example.net", "label"), decide("trips@example.net", "label", { label: "inbox" }), decide("trips@example.net", "label", { label: "no-such-label" })]);
  const withFeed = await decide("trips@example.net", "feed", { label: travel });

  for (const { response, error } of results) {
    expect(response.status).toBe(400);
    expect(error?.message).toMatch(/one of the mailbox's own labels/);
  }
  expect(withFeed.response.status).toBe(400);
  expect(withFeed.error?.message).toMatch(/only with delivery label/);
});

test("changing a sender's delivery moves all their threads, archived ones too, keeping labels given by hand, and leaves Trash, Spam and Remind me alone", async () => {
  const { grace, graceId, params, receive, listed, decide, label, relabel, changes } = await withSenders();
  await decide("news@example.net", "inbox");
  const kept = await receive(note("news@example.net", "Kept"));
  const labelled = await receive(note("news@example.net", "Labelled"));
  const archived = await receive(note("news@example.net", "Archived"));
  const filed = await receive(note("news@example.net", "Filed"));
  const aside = await receive(note("news@example.net", "Aside"));
  const trashed = await receive(note("news@example.net", "Trashed"));
  const spam = await receive(note("news@example.net", "Spam"), { spam: true });
  const reading = await label("Reading");
  await relabel([labelled.thread], { add: [reading] });
  await relabel([archived.thread], { remove: ["inbox"] });
  await relabel([filed.thread], { add: ["paperTrail"] });
  await grace.POST("/mailboxes/{mailbox}/threads/remind", { params, body: { threads: [aside.thread], preset: "nextWeek" } });
  await relabel([trashed.thread], { add: ["trash"] });

  const { data } = await decide("news@example.net", "feed");

  expect(data!.threads.map(({ id, labels }) => ({ id, labels }))).toEqual([
    { id: filed.thread, labels: ["feed"] },
    { id: archived.thread, labels: ["feed"] },
    { id: labelled.thread, labels: [reading, "feed"] },
    { id: kept.thread, labels: ["feed"] },
  ]);
  expect(await listed("feed")).toEqual([filed.thread, archived.thread, labelled.thread, kept.thread]);
  expect(await listed("inbox")).toEqual([]);
  expect(await listed("paperTrail")).toEqual([]);
  expect(await listed("trash")).toEqual([trashed.thread]);
  expect(await listed("spam")).toEqual([spam.thread]);
  expect((await grace.GET("/mailboxes/{mailbox}/reminders", { params })).data!.threads.map(({ id }) => id)).toEqual([aside.thread]);
  expect((await changes()).slice(-5)).toEqual([
    expect.objectContaining({ type: "senderDeliverySet", address: "news@example.net", delivery: "feed", actor: graceId }),
    expect.objectContaining({ type: "threadLabelsChanged", thread: filed.thread, added: ["feed"], removed: ["paperTrail"], actor: graceId }),
    expect.objectContaining({ type: "threadLabelsChanged", thread: archived.thread, added: ["feed"], removed: [], actor: graceId }),
    expect.objectContaining({ type: "threadLabelsChanged", thread: labelled.thread, added: ["feed"], removed: ["inbox"], actor: graceId }),
    expect.objectContaining({ type: "threadLabelsChanged", thread: kept.thread, added: ["feed"], removed: ["inbox"], actor: graceId }),
  ]);
});

test("deciding again where a sender's mail already goes, by their address or their domain, leaves their archived threads archived", async () => {
  const { receive, listed, decide, relabel } = await withSenders();
  const first = await receive(note("bob@example.net", "First"));
  await decide("bob@example.net", "inbox");
  await relabel([first.thread], { remove: ["inbox"] });
  const later = await receive(note("bob@example.net", "Later"));

  await decide("bob@example.net", "inbox");
  await decide("example.net", "inbox");

  expect(await listed("inbox")).toEqual([later.thread]);
});

test("moving a sender from a label to the Paper Trail takes their threads out of the label, and back to the Inbox puts them there", async () => {
  const { receive, listed, decide, label } = await withSenders();
  const travel = await label("Travel");
  await decide("trips@example.net", "label", { label: travel });
  const booking = await receive(note("trips@example.net", "Booking"));

  await decide("trips@example.net", "paperTrail");
  const trail = { paperTrail: await listed("paperTrail"), travel: await listed(travel) };
  await decide("trips@example.net", "inbox");

  expect(trail).toEqual({ paperTrail: [booking.thread], travel: [] });
  expect(await listed("inbox")).toEqual([booking.thread]);
  expect(await listed("paperTrail")).toEqual([]);
});

test("a reply from a Feed sender in a thread in the Inbox leaves it there, and one in their own thread keeps it in the Feed, each unread again", async () => {
  const { grace, params, receive, listed, thread, decide } = await withSenders();
  await decide("bob@example.net", "inbox");
  const talk = await receive(note("bob@example.net", "Talk"));
  await decide("news@example.net", "feed");
  const issue = await receive(note("news@example.net", "Issue"));
  await grace.POST("/mailboxes/{mailbox}/threads/read", { params, body: { threads: [talk.thread, issue.thread] } });

  const inTalk = await receive(note("news@example.net", "Re Talk", { inReplyTo: "<Talk@mail.test>" }));
  const inIssue = await receive(note("news@example.net", "Re Issue", { inReplyTo: "<Issue@mail.test>" }));

  expect([inTalk.thread, inIssue.thread]).toEqual([talk.thread, issue.thread]);
  expect(await thread(talk.thread)).toMatchObject({ labels: ["inbox"], unread: true });
  expect(await listed("feed")).toEqual([issue.thread]);
  expect(await thread(issue.thread)).toMatchObject({ labels: ["feed"], unread: true });
  expect(await listed("inbox")).toEqual([talk.thread]);
});

test("filing a thread in the Feed by hand takes it out of the Inbox, and one restored from Trash goes back to the Feed", async () => {
  const { receive, listed, relabel, decide } = await withSenders();
  await decide("news@example.net", "inbox");
  const issue = await receive(note("news@example.net", "Issue"));

  await relabel([issue.thread], { add: ["feed"] });
  const filed = { feed: await listed("feed"), inbox: await listed("inbox") };
  await relabel([issue.thread], { add: ["trash"] });
  await relabel([issue.thread], { remove: ["trash"] });

  expect(filed).toEqual({ feed: [issue.thread], inbox: [] });
  expect(await listed("feed")).toEqual([issue.thread]);
  expect(await listed("inbox")).toEqual([]);
});

test("mail from a sender whose mail goes nowhere is dropped on arrival, kept nowhere, and recorded without what it says", async () => {
  const { duva, receive, listed, decide, changes } = await withSenders();
  await decide("mallory@example.net", "nowhere");

  const dropped = await receive(note("Mallory <mallory@example.net>", "Pitch", { text: "Buy my thing." }));

  expect(dropped).toEqual({ position: expect.any(Number), at: expect.any(String), type: "messageDropped", address: "mallory@example.net" });
  expect(await listed("inbox")).toEqual([]);
  expect(await listed("trash")).toEqual([]);
  expect(duva.stored().some((raw) => raw.includes("Buy my thing."))).toBe(false);
  expect((await changes()).filter(({ type }) => type === "messageReceived")).toEqual([]);
});

test("spam from a sender whose mail goes nowhere is dropped too, and a reply from them in a thread the mailbox has", async () => {
  const { receive, listed, decide, send } = await withSendersAndSending();
  const question = await send("mallory@example.net", "Question");
  await decide("example.net", "nowhere");

  const spam = await receive(note("mallory@example.net", "Prize"), { spam: true });
  const reply = await receive(note("mallory@example.net", "Re Question", { inReplyTo: question }));

  expect([spam.type, reply.type]).toEqual(["messageDropped", "messageDropped"]);
  expect(await listed("spam")).toEqual([]);
});

test("choosing nowhere erases the sender's threads in the mailbox for good, Spam and Trash included, and removing it brings none back", async () => {
  const { duva, graceId, receive, listed, decide, relabel, grace, params, sheet, changes } = await withSenders();
  const waiting = await receive(note("mallory@example.net", "Waiting", { text: "First pitch." }));
  const trashed = await receive(note("mallory@example.net", "Trashed"));
  await relabel([trashed.thread], { add: ["trash"] });
  await receive(note("mallory@example.net", "Prize"), { spam: true });
  const other = await receive(note("oscar@example.net", "Other"));

  const { response, data } = await decide("mallory@example.net", "nowhere");
  await grace.DELETE("/mailboxes/{mailbox}/senders/{sender}", { params: { path: { ...params.path, sender: "mallory@example.net" } } });

  expect(response.status).toBe(200);
  expect(data).toEqual({
    sender: { address: "mallory@example.net", delivery: "nowhere", decidedAt: expect.any(String), actor: graceId },
    threads: [],
    erasing: 3,
    unsubscribe: { outcome: "notOffered", reason: "noOneClick" },
  });
  expect(await listed("screener")).toEqual([other.thread]);
  expect([await listed("trash"), await listed("spam"), await listed("inbox")]).toEqual([[], [], []]);
  expect((await sheet("mallory@example.net")).data!.threads).toBe(0);
  expect(duva.stored().some((raw) => raw.includes("First pitch."))).toBe(false);
  expect((await changes()).filter(({ type }) => type === "threadErased")).toEqual(
    expect.arrayContaining([expect.objectContaining({ thread: waiting.thread, actor: graceId }), expect.objectContaining({ thread: trashed.thread, actor: graceId })]),
  );
});

test("choosing nowhere for a domain leaves the threads of an address there with its own delivery", async () => {
  const { receive, listed, decide } = await withSenders();
  await decide("oscar@example.net", "inbox");
  const oscar = await receive(note("oscar@example.net", "Oscar"));
  await receive(note("mallory@example.net", "Mallory"));

  const { data } = await decide("example.net", "nowhere");

  expect(data!.erasing).toBe(1);
  expect(await listed("inbox")).toEqual([oscar.thread]);
  expect(await listed("screener")).toEqual([]);
});

test("only the mailbox's owner, or an agent's sponsor, chooses nowhere, and an agent with send sponsor access chooses the rest", async () => {
  const { iris, receive, listed, decide } = await withSenders();
  const pitch = await receive(note("mallory@example.net", "Pitch"));

  const nowhere = await decide("mallory@example.net", "nowhere", { client: iris });
  const feed = await decide("mallory@example.net", "feed", { client: iris });

  expect(nowhere.response.status).toBe(403);
  expect(nowhere.error?.message).toMatch(/Only your sponsor can send a sender's mail nowhere/);
  expect(feed.response.status).toBe(200);
  expect(await listed("feed")).toEqual([pitch.thread]);
});

test("mail for two mailboxes, one of which sends its sender nowhere, is kept for the other", async () => {
  const { duva, ada, decide, listed } = await withSenders();
  const { data: linus } = await duva.signIn("linus@example.org").GET("/whoami");
  const { data: linusMailbox } = await ada.POST("/mailboxes", { body: { owner: linus!.id, address: "linus@example.com" } });
  await decide("mallory@example.net", "nowhere");

  await duva.receive(note("mallory@example.net", "To both", { text: "For you both." }).replace("To: grace@example.com", "To: grace@example.com, linus@example.com"), { to: ["grace@example.com", "linus@example.com"] });

  const linusScreener = await duva.signIn("linus@example.org").GET("/mailboxes/{mailbox}/screener", { params: { path: { mailbox: linusMailbox!.id } } });
  expect(linusScreener.data!.senders.map(({ address }) => address)).toEqual(["mallory@example.net"]);
  expect(await listed("screener")).toEqual([]);
  expect(duva.stored().some((raw) => raw.includes("For you both."))).toBe(true);
});

test("a group's copy skips its members' deliveries, as it skips their Screeners, since the group's send policy is its gate", async () => {
  const { duva, ada, decide, listed } = await withSenders();
  await ada.POST("/groups", { body: { address: "team@example.com", members: ["grace@example.com"], sendPolicy: "anyone" } });
  await decide("mallory@example.net", "nowhere");

  await duva.receive(note("mallory@example.net", "To the team").replace("To: grace@example.com", "To: team@example.com"), { to: ["team@example.com"] });

  expect((await listed("inbox")).length).toBe(1);
});

test("deleting a label sends the mail of senders filed under it to the Inbox", async () => {
  const { grace, params, receive, listed, decide, label, sheet } = await withSenders();
  const travel = await label("Travel");
  await decide("trips@example.net", "label", { label: travel });

  await grace.DELETE("/mailboxes/{mailbox}/labels/{label}", { params: { path: { ...params.path, label: travel } } });
  const later = await receive(note("trips@example.net", "Later"));

  expect((await sheet("trips@example.net")).data).toMatchObject({ goesTo: "inbox", decided: { delivery: "inbox" } });
  expect(await listed("inbox")).toEqual([later.thread]);
});

test("setup turns a let-in from before deliveries into the Inbox and a block into nowhere, and lists earlier threads by whom they are from", async () => {
  const { duva, receive, listed, decide, sheet, grace, params } = await withSenders({ beforeDeliveries: true });
  await decide("bob@example.net", "inbox");
  const before = await receive(note("bob@example.net", "Before"));
  await decide("mallory@example.net", "nowhere");

  await duva.setUp({ admin: "ada@example.org" });
  const dropped = await receive(note("mallory@example.net", "After"));

  expect((await grace.GET("/mailboxes/{mailbox}/senders", { params })).data!.senders.map(({ address, delivery }) => ({ address, delivery }))).toEqual([
    { address: "mallory@example.net", delivery: "nowhere" },
    { address: "bob@example.net", delivery: "inbox" },
  ]);
  expect(dropped.type).toBe("messageDropped");
  expect((await sheet("bob@example.net")).data!.threads).toBe(1);
  await decide("bob@example.net", "feed");
  expect(await listed("feed")).toEqual([before.thread]);
});

test("setup erases, once, the threads a block from before deliveries put in Trash, as choosing nowhere erases, in the mailbox's change feed", async () => {
  const { duva, graceId, receive, listed, decide, relabel, sheet, changes } = await withSenders({ beforeDeliveries: true });
  const prize = await receive(note("mallory@example.net", "Prize"));
  const again = await receive(note("mallory@example.net", "Prize again"));
  const kept = await receive(note("bob@example.net", "Kept"));
  await relabel([kept.thread], { add: ["trash"] });
  // Blocking put the sender's threads in Trash, to wait out the retention period there.
  await relabel([prize.thread, again.thread], { add: ["trash"] });
  await decide("mallory@example.net", "nowhere");
  const blocked = await listed("trash");

  await duva.setUp({ admin: "ada@example.org" });
  const erased = (await changes()).filter((change) => change.type === "threadErased");
  await duva.setUp({ admin: "ada@example.org" });

  expect(blocked).toEqual([kept.thread, again.thread, prize.thread]);
  expect(await listed("trash")).toEqual([kept.thread]);
  expect((await sheet("mallory@example.net")).data!.threads).toBe(0);
  expect(erased).toEqual([expect.objectContaining({ type: "threadErased", thread: again.thread, actor: graceId }), expect.objectContaining({ type: "threadErased", thread: prize.thread, actor: graceId })]);
  expect((await changes()).filter((change) => change.type === "threadErased")).toHaveLength(2);
});

/** A deployment as withSenders() gives, where Grace also writes to people. */
async function withSendersAndSending() {
  const senders = await withSenders();
  const { grace, params } = senders;
  /** Grace sends a message with the subject to the address, its Message-ID on example.com. */
  const send = async (to: string, subject: string) => {
    const { data: draft } = await grace.POST("/mailboxes/{mailbox}/drafts", { params, body: { to: [to], subject, text: "Hej." } });
    await grace.POST("/mailboxes/{mailbox}/drafts/{draft}/send", { params: { path: { ...params.path, draft: draft!.id } } });
    const sent = senders.duva.sent().find((raw) => raw.includes(`Subject: ${subject}`))!;
    return /^Message-ID: (.+)$/im.exec(sent)![1]!.trim();
  };
  return { ...senders, send };
}
