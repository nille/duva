import type { Page } from "playwright-core";
import { expect, test } from "vitest";
import { phone, startWebApp } from "./web-app.ts";

// The page reads the change feeds every 250 ms in these tests, but a page under the full suite's
// load can still take seconds to show what changed, so every wait has room, and every test more.
const wait = { timeout: 10_000 };
const budget = { timeout: 60_000 };

interface Note {
  from: string;
  subject: string;
  /** Header fields written above the others, such as a DKIM signature. */
  above?: string[];
  /** Header fields written below the others, such as List-Unsubscribe. */
  below?: string[];
}

/** A message to Grace that starts its own thread. */
const note = ({ from, subject, above = [], below = [] }: Note) =>
  [
    ...above,
    `From: ${from}`,
    "To: Grace <grace@example.com>",
    `Subject: ${subject}`,
    "Date: Tue, 06 Oct 2026 09:00:00 +0200",
    `Message-ID: <${subject.replaceAll(" ", "-")}@mail.example.net>`,
    ...below,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    `About ${subject}.`,
  ].join("\r\n");

/** A newsletter from news@lists.example.org that offers one-click unsubscribe at lists.example.org, under a DKIM signature over both headers. */
const newsletter = (subject: string) =>
  note({
    from: "Example News <news@lists.example.org>",
    subject,
    above: ["DKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; d=lists.example.org; s=s1;\r\n\th=From:To:Subject:Date:Message-ID:List-Unsubscribe:List-Unsubscribe-Post;\r\n\tbh=YWJj; b=ZGVm"],
    below: ["List-Unsubscribe: <https://lists.example.org/unsubscribe?u=grace>", "List-Unsubscribe-Post: List-Unsubscribe=One-Click"],
  });

/**
 * The web app for a deployment on example.com where Grace has her personal mailbox at
 * grace@example.com, with its Screener on, as a human's mailbox starts.
 */
async function withScreener(options: Parameters<typeof startWebApp>[0] = {}) {
  const app = await startWebApp({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org"], ...options });
  const ada = app.duva.signIn("ada@example.org");
  const grace = app.duva.signIn("grace@example.org");
  const { data: me } = await grace.GET("/whoami");
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: me!.id, address: "grace@example.com" } });
  const params = { path: { mailbox: mailbox!.id } };
  const receive = async (raw: string) => {
    await app.duva.receive(raw, { to: ["grace@example.com"] });
  };
  const listed = async (label: string) => (await grace.GET("/mailboxes/{mailbox}/threads", { params: { ...params, query: { label } } })).data!.threads.map(({ subject }) => subject);
  return { ...app, ada, grace, graceId: me!.id, params, receive, listed };
}

const side = (page: Page) => page.getByRole("navigation", { name: "Mail" });
const screenerLink = (page: Page) => side(page).getByRole("link", { name: /^Screener/ });
const waiting = (page: Page) => page.getByRole("list", { name: "Waiting senders" }).getByRole("listitem").filter({ has: page.getByRole("heading") });
const sender = (page: Page, address: string) => waiting(page).filter({ hasText: address });
/** Goes to the place in the web app at the hash, as a link there does. */
const go = (page: Page, hash: string) => page.evaluate((hash) => (location.hash = hash), hash);
const doneLine = (page: Page) => page.locator(".done-line");

test("the side column shows the Screener with how many senders wait, outside the tab title and the unread counts", budget, async () => {
  const { page, signIn, receive } = await withScreener();
  await receive(note({ from: "Bob <bob@example.net>", subject: "Hello" }));
  await receive(note({ from: "Bob <bob@example.net>", subject: "Hello again" }));
  await receive(note({ from: "Carol <carol@example.net>", subject: "Pitch" }));

  await signIn("grace@example.org");

  await expect.poll(() => screenerLink(page).textContent(), wait).toBe("Screener2, 2 senders waiting");
  expect(await page.title()).toBe("Inbox · Duva");
  expect(await side(page).getByRole("link", { name: /^Inbox/ }).textContent()).toBe("Inbox");

  // A third sender's mail arrives while the page is open.
  await receive(note({ from: "Dan <dan@example.net>", subject: "Intro" }));

  await expect.poll(() => screenerLink(page).textContent(), wait).toContain("3 senders waiting");
});

test("a mailbox whose Screener is off, with nothing waiting, has no Screener in the side column", budget, async () => {
  const { page, signIn, grace, params } = await withScreener();
  await grace.PATCH("/mailboxes/{mailbox}/screener", { params, body: { on: false } });

  await signIn("grace@example.org");

  await expect.poll(() => side(page).getByRole("link", { name: /^Inbox/ }).count(), wait).toBe(1);
  expect(await screenerLink(page).count()).toBe(0);
});

test("the Screener lists waiting senders newest first, each with their mail to open", budget, async () => {
  const { page, signIn, receive } = await withScreener();
  await receive(note({ from: "Bob <bob@example.net>", subject: "Hello" }));
  await receive(note({ from: "Carol <carol@example.net>", subject: "Pitch" }));
  await receive(note({ from: "Bob <bob@example.net>", subject: "Hello again" }));
  await signIn("grace@example.org");

  await screenerLink(page).click();

  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Screener");
  await expect.poll(() => waiting(page).getByRole("heading").allTextContents(), wait).toEqual(["Bob", "Carol"]);
  expect(await page.title()).toBe("Screener · Duva");
  const bob = sender(page, "bob@example.net");
  expect(await bob.getByRole("link").allTextContents()).toEqual([expect.stringContaining("Hello again"), expect.stringContaining("Hello")]);

  await bob.getByRole("link", { name: /Hello again/ }).click();

  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Hello again");
  await page.getByRole("link", { name: "Screener" }).first().click();
  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Screener");
});

test("letting in an address moves the sender's mail to the Inbox, and the count drops", budget, async () => {
  const { page, signIn, receive, listed } = await withScreener();
  await receive(note({ from: "Bob <bob@example.net>", subject: "Hello" }));
  await receive(note({ from: "Bob <bob@example.net>", subject: "Hello again" }));
  await receive(note({ from: "Carol <carol@example.net>", subject: "Pitch" }));
  await signIn("grace@example.org");
  await screenerLink(page).click();

  await sender(page, "bob@example.net").getByRole("button", { name: "Let in" }).click();
  await sender(page, "bob@example.net").getByRole("button", { name: "This address" }).click();

  await expect.poll(() => doneLine(page).textContent(), wait).toBe("Let in bob@example.net. Moved 2 threads to the Inbox.");
  await expect.poll(() => waiting(page).getByRole("heading").allTextContents(), wait).toEqual(["Carol"]);
  await expect.poll(() => screenerLink(page).textContent(), wait).toContain("1 sender waiting");
  expect(await listed("inbox")).toEqual(["Hello again", "Hello"]);
});

test("letting in everyone at a domain moves all their senders' mail to the Inbox", budget, async () => {
  const { page, signIn, receive, listed } = await withScreener();
  await receive(note({ from: "Bob <bob@example.net>", subject: "Hello" }));
  await receive(note({ from: "Carol <carol@example.net>", subject: "Pitch" }));
  await signIn("grace@example.org");
  await screenerLink(page).click();

  await sender(page, "carol@example.net").getByRole("button", { name: "Let in" }).click();
  await sender(page, "carol@example.net").getByRole("button", { name: "Everyone at example.net" }).click();

  await expect.poll(() => doneLine(page).textContent(), wait).toBe("Let in everyone at example.net. Moved 2 threads to the Inbox.");
  await expect.poll(() => page.getByRole("main").getByRole("heading", { level: 2 }).textContent(), wait).toBe("No one is waiting");
  expect((await listed("inbox")).sort()).toEqual(["Hello", "Pitch"]);
});

test("a sender at a public mail provider is offered only their address", budget, async () => {
  const { page, signIn, receive } = await withScreener();
  await receive(note({ from: "Eve <eve@gmail.com>", subject: "Hi" }));
  await signIn("grace@example.org");
  await screenerLink(page).click();
  const eve = sender(page, "eve@gmail.com");

  await eve.getByRole("button", { name: "Let in" }).click();
  expect(await eve.getByRole("button", { name: "This address" }).count()).toBe(1);
  expect(await eve.getByRole("button", { name: /Everyone at/ }).count()).toBe(0);
  await eve.getByRole("button", { name: "Cancel" }).click();

  await eve.getByRole("button", { name: "Block" }).click();
  expect(await eve.getByRole("button", { name: /Everyone at/ }).count()).toBe(0);
});

test("blocking a sender whose mail offers one-click moves it to Trash and says they were unsubscribed", budget, async () => {
  const { page, signIn, receive, duva, listed } = await withScreener();
  const requests = await duva.webServer("lists.example.org");
  await receive(newsletter("News"));
  await signIn("grace@example.org");
  await screenerLink(page).click();

  await sender(page, "news@lists.example.org").getByRole("button", { name: "Block" }).click();
  await sender(page, "news@lists.example.org").getByRole("button", { name: "This address" }).click();

  await expect.poll(() => doneLine(page).textContent(), wait).toBe("Blocked news@lists.example.org. Moved 1 thread to Trash. Unsubscribed from their mail.");
  expect(requests.map(({ url }) => url)).toEqual(["https://lists.example.org/unsubscribe?u=grace"]);
  expect(await listed("trash")).toEqual(["News"]);
});

test("blocking everyone at a domain says when their mail offered no unsubscribe", budget, async () => {
  const { page, signIn, receive, listed } = await withScreener();
  await receive(note({ from: "Bob <bob@example.net>", subject: "Hello" }));
  await receive(note({ from: "Carol <carol@example.net>", subject: "Pitch" }));
  await signIn("grace@example.org");
  await screenerLink(page).click();

  await sender(page, "bob@example.net").getByRole("button", { name: "Block" }).click();
  await sender(page, "bob@example.net").getByRole("button", { name: "Everyone at example.net" }).click();

  await expect.poll(() => doneLine(page).textContent(), wait).toBe(
    "Blocked everyone at example.net. Moved 2 threads to Trash. Their mail offers no one-click unsubscribe, so Duva sent none.",
  );
  expect((await listed("trash")).sort()).toEqual(["Hello", "Pitch"]);
});

test("blocking a sender says when unsubscribing failed", budget, async () => {
  const { page, signIn, receive, duva } = await withScreener();
  await duva.webServer("lists.example.org", { answer: () => new Response("No", { status: 500 }) });
  await receive(newsletter("News"));
  await signIn("grace@example.org");
  await screenerLink(page).click();

  await sender(page, "news@lists.example.org").getByRole("button", { name: "Block" }).click();
  await sender(page, "news@lists.example.org").getByRole("button", { name: "This address" }).click();

  await expect.poll(() => doneLine(page).textContent(), wait).toBe("Blocked news@lists.example.org. Moved 1 thread to Trash. Duva couldn't unsubscribe: their server refused (error 500).");
});

test("a Screener that is off says so, and where to switch it on", budget, async () => {
  const { page, signIn, grace, params } = await withScreener();
  await grace.PATCH("/mailboxes/{mailbox}/screener", { params, body: { on: false } });
  await signIn("grace@example.org");
  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Inbox");

  await go(page, "#/screener");

  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Screener");
  expect(await page.getByRole("main").innerText()).toContain("The Screener is off, so mail from first-time senders goes to the Inbox.");
  expect(await page.getByRole("main").getByRole("link", { name: "Switch it on in Settings" }).count()).toBe(1);
});

test("screened senders lists what was let in and blocked, and flips a decision", budget, async () => {
  const { page, signIn, grace, params } = await withScreener();
  await grace.POST("/mailboxes/{mailbox}/screener/let-in", { params, body: { address: "bob@example.net" } });
  await grace.POST("/mailboxes/{mailbox}/screener/block", { params, body: { domain: "spam.example.org" } });
  await signIn("grace@example.org");
  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Inbox");
  await go(page, "#/screener");

  await page.getByRole("link", { name: /^Screened senders/ }).click();

  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Screened senders");
  const letIn = page.getByRole("list", { name: "Let in" }).getByRole("listitem");
  const blocked = page.getByRole("list", { name: "Blocked" }).getByRole("listitem");
  await expect.poll(() => letIn.allInnerTexts(), wait).toEqual([expect.stringContaining("bob@example.net")]);
  expect(await blocked.allInnerTexts()).toEqual([expect.stringContaining("Everyone at spam.example.org")]);
  expect(await letIn.first().innerText()).toContain("by you");

  await letIn.first().getByRole("button", { name: "Block" }).click();

  await expect.poll(() => doneLine(page).textContent(), wait).toMatch(/^Blocked bob@example\.net\./);
  await expect.poll(() => blocked.count(), wait).toBe(2);
  expect(await letIn.count()).toBe(0);
  const { data } = await grace.GET("/mailboxes/{mailbox}/screener/senders", { params });
  expect(data!.senders.map(({ address, domain, decision }) => [address ?? domain, decision])).toEqual([
    ["bob@example.net", "block"],
    ["spam.example.org", "block"],
  ]);
});

test("removing a block says that threads still in Trash come back, and brings them back", budget, async () => {
  const { page, signIn, receive, grace, params, listed } = await withScreener();
  await receive(note({ from: "Bob <bob@example.net>", subject: "Hello" }));
  await grace.POST("/mailboxes/{mailbox}/screener/block", { params, body: { address: "bob@example.net" } });
  await signIn("grace@example.org");
  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Inbox");
  await go(page, "#/screener/senders");
  const bob = page.getByRole("list", { name: "Blocked" }).getByRole("listitem").filter({ hasText: "bob@example.net" });

  await bob.getByRole("button", { name: "Remove" }).click();

  await expect.poll(() => bob.innerText(), wait).toContain("Their threads still in Trash come back to the Inbox.");
  await bob.getByRole("button", { name: "Remove block" }).click();

  await expect.poll(() => doneLine(page).textContent(), wait).toBe("Removed the block on bob@example.net. Moved 1 thread to the Inbox.");
  expect(await listed("inbox")).toEqual(["Hello"]);
  await expect.poll(() => page.getByRole("list", { name: "Blocked" }).count(), wait).toBe(0);
});

test("removing a let-in makes the sender first-time again", budget, async () => {
  const { page, signIn, grace, params } = await withScreener();
  await grace.POST("/mailboxes/{mailbox}/screener/let-in", { params, body: { domain: "example.net" } });
  await signIn("grace@example.org");
  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Inbox");
  await go(page, "#/screener/senders");
  const net = page.getByRole("list", { name: "Let in" }).getByRole("listitem").filter({ hasText: "example.net" });

  await net.getByRole("button", { name: "Remove" }).click();

  await expect.poll(() => doneLine(page).textContent(), wait).toBe("Removed everyone at example.net. They're first-time senders again, and their mail stays where it is.");
  expect((await grace.GET("/mailboxes/{mailbox}/screener/senders", { params })).data!.senders).toEqual([]);
});

test("a sponsor lets a sender into their agent's mailbox from its Screener", budget, async () => {
  const { page, signIn, ada, grace, duva } = await withScreener();
  const { data: iris } = await grace.POST("/agents", { body: { name: "Iris" } });
  const { data: irisMailbox } = await ada.POST("/mailboxes", { body: { owner: iris!.agent.id, address: "iris@example.com" } });
  const params = { path: { mailbox: irisMailbox!.id } };
  // An agent's mailbox starts with the Screener off.
  await grace.PATCH("/mailboxes/{mailbox}/screener", { params, body: { on: true } });
  await duva.receive(["From: Carol <carol@example.net>", "To: iris@example.com", "Subject: Pitch", "Message-ID: <pitch@example.net>", "", "Hej Iris."].join("\r\n"), { to: ["iris@example.com"] });
  await signIn("grace@example.org");

  await page.getByRole("navigation", { name: "Mailboxes" }).getByRole("link", { name: /Iris/ }).click();
  await screenerLink(page).click();

  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Iris's Screener");
  await sender(page, "carol@example.net").getByRole("button", { name: "Let in" }).click();
  await sender(page, "carol@example.net").getByRole("button", { name: "This address" }).click();
  await expect.poll(() => doneLine(page).textContent(), wait).toBe("Let in carol@example.net. Moved 1 thread to the Inbox.");
  const { data: inbox } = await grace.GET("/mailboxes/{mailbox}/threads", { params: { ...params, query: { label: "inbox" } } });
  expect(inbox!.threads.map(({ subject }) => subject)).toEqual(["Pitch"]);
});

test("a human switches the Screener for their own mailbox and their agents' on the Settings view", budget, async () => {
  const { page, signIn, ada, grace, params } = await withScreener();
  const { data: iris } = await grace.POST("/agents", { body: { name: "Iris" } });
  const { data: irisMailbox } = await ada.POST("/mailboxes", { body: { owner: iris!.agent.id, address: "iris@example.com" } });
  await signIn("grace@example.org");

  await page.getByRole("navigation", { name: "Duva" }).getByRole("link", { name: "Settings" }).click();

  const sheet = page.getByRole("region", { name: "Screener" });
  const yours = sheet.getByRole("group", { name: /^Your mailbox/ });
  const irises = sheet.getByRole("group", { name: /^Iris/ });
  await expect.poll(() => yours.getByRole("radio", { name: /^On/ }).isChecked(), wait).toBe(true);
  expect(await irises.getByRole("radio", { name: /^Off/ }).isChecked()).toBe(true);

  await irises.getByRole("radio", { name: /^On/ }).check();
  await yours.getByRole("radio", { name: /^Off/ }).check();
  expect(await sheet.innerText()).toContain("Mail waiting in your mailbox's Screener moves to the Inbox when you save.");
  await sheet.getByRole("button", { name: "Save" }).click();

  await expect.poll(() => sheet.getByRole("status").textContent(), wait).toBe("Saved.");
  expect((await grace.GET("/mailboxes/{mailbox}/screener", { params })).data!.on).toBe(false);
  expect((await grace.GET("/mailboxes/{mailbox}/screener", { params: { path: { mailbox: irisMailbox!.id } } })).data!.on).toBe(true);
});

test("at phone width the Screener's senders and their choices fit the screen", budget, async () => {
  const { page, signIn, receive } = await withScreener({ viewport: phone });
  await receive(note({ from: "Bartholomew Longname-Smythe <bartholomew.longname-smythe@a-rather-long-domain.example.net>", subject: "A first message with a long subject line" }));
  await signIn("grace@example.org");

  await screenerLink(page).click();
  const longname = sender(page, "bartholomew");
  await longname.getByRole("button", { name: "Block" }).click();

  await expect.poll(() => longname.getByRole("button", { name: /Everyone at/ }).isVisible(), wait).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(phone.width);
});
