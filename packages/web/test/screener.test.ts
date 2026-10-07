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
  expect(await bob.getByRole("list", { name: "Mail from Bob" }).getByRole("link").allTextContents()).toEqual([expect.stringContaining("Hello again"), expect.stringContaining("Hello")]);

  await bob.getByRole("link", { name: /Hello again/ }).click();

  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Hello again");
  await page.getByRole("link", { name: "Screener" }).first().click();
  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Screener");
});

test("choosing the Inbox for a waiting sender moves their mail there, and the count drops", budget, async () => {
  const { page, signIn, receive, listed } = await withScreener();
  await receive(note({ from: "Bob <bob@example.net>", subject: "Hello" }));
  await receive(note({ from: "Bob <bob@example.net>", subject: "Hello again" }));
  await receive(note({ from: "Carol <carol@example.net>", subject: "Pitch" }));
  await signIn("grace@example.org");
  await screenerLink(page).click();

  await sender(page, "bob@example.net").getByRole("group", { name: "Send mail from Bob to" }).getByRole("button", { name: "Inbox" }).click();

  await expect.poll(() => doneLine(page).textContent(), wait).toBe("bob@example.net's mail goes to the Inbox now. Moved 2 threads.");
  await expect.poll(() => waiting(page).getByRole("heading").allTextContents(), wait).toEqual(["Carol"]);
  await expect.poll(() => screenerLink(page).textContent(), wait).toContain("1 sender waiting");
  expect(await listed("inbox")).toEqual(["Hello again", "Hello"]);
});

test("choosing the Feed or the Paper Trail for a waiting sender files their mail there, out of the Inbox", budget, async () => {
  const { page, signIn, receive, listed } = await withScreener();
  await receive(note({ from: "News <news@example.net>", subject: "Issue 1" }));
  await receive(note({ from: "Shop <receipts@shop.example.org>", subject: "Your order" }));
  await signIn("grace@example.org");
  await screenerLink(page).click();

  await sender(page, "news@example.net").getByRole("button", { name: "Feed" }).click();
  await expect.poll(() => doneLine(page).textContent(), wait).toBe("news@example.net's mail goes to the Feed now. Moved 1 thread.");
  await sender(page, "receipts@shop.example.org").getByRole("button", { name: "Paper Trail" }).click();

  await expect.poll(() => doneLine(page).textContent(), wait).toBe("receipts@shop.example.org's mail goes to the Paper Trail now. Moved 1 thread.");
  expect([await listed("feed"), await listed("paperTrail"), await listed("inbox")]).toEqual([["Issue 1"], ["Your order"], []]);
});

test("nowhere asks first, saying it can't be undone, then erases the sender's waiting mail and says they were unsubscribed", budget, async () => {
  const { page, signIn, receive, duva, listed } = await withScreener();
  const requests = await duva.webServer("lists.example.org");
  await receive(newsletter("News"));
  await signIn("grace@example.org");
  await screenerLink(page).click();
  const news = sender(page, "news@lists.example.org");

  await news.getByRole("button", { name: "Nowhere" }).click();

  await expect.poll(() => news.innerText(), wait).toContain("This erases their waiting thread for good and drops their later mail. This can't be undone.");
  expect(requests).toEqual([]);
  await news.getByRole("button", { name: "Erase and send nowhere" }).click();

  await expect.poll(() => doneLine(page).textContent(), wait).toBe("news@lists.example.org's mail goes nowhere now. Erasing 1 thread. Unsubscribed from their mail.");
  expect(requests.map(({ url }) => url)).toEqual(["https://lists.example.org/unsubscribe?u=grace"]);
  expect([await listed("trash"), await listed("screener")]).toEqual([[], []]);
});

test("More opens the waiting sender's sheet beside the Screener, where everyone at their domain gets a delivery", budget, async () => {
  const { page, signIn, receive, listed } = await withScreener();
  await receive(note({ from: "Bob <bob@example.net>", subject: "Hello" }));
  await receive(note({ from: "Carol <carol@example.net>", subject: "Pitch" }));
  await signIn("grace@example.org");
  await screenerLink(page).click();

  await sender(page, "bob@example.net").getByRole("link", { name: "More choices for Bob" }).click();

  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Bob");
  const sheet = page.getByRole("main");
  expect(await sheet.innerText()).toContain("1 thread from them here");
  expect(await sheet.innerText()).toContain("The Screener, as a first-time sender's");
  expect(await page.getByRole("region", { name: "Screener" }).count()).toBe(1);
  await sheet.getByRole("radio", { name: "Everyone at example.net" }).check();
  await sheet.getByRole("radio", { name: /^Paper Trail/ }).check();
  await sheet.getByRole("button", { name: "Save" }).click();

  await expect.poll(async () => (await listed("paperTrail")).sort(), wait).toEqual(["Hello", "Pitch"]);
  await expect.poll(() => sheet.innerText(), wait).toContain("as decided for everyone at example.net");
});

test("a sender at a public mail provider's sheet offers only their address", budget, async () => {
  const { page, signIn, receive } = await withScreener();
  await receive(note({ from: "Eve <eve@gmail.com>", subject: "Hi" }));
  await signIn("grace@example.org");
  await screenerLink(page).click();

  await sender(page, "eve@gmail.com").getByRole("link", { name: "More choices for Eve" }).click();

  await expect.poll(() => page.getByRole("main").getByRole("radio", { name: /^Inbox/ }).count(), wait).toBe(1);
  expect(await page.getByRole("main").getByRole("radio", { name: /Everyone at/ }).count()).toBe(0);
});

test("a Screener that is off says so, and where to switch it on", budget, async () => {
  const { page, signIn, grace, params } = await withScreener();
  await grace.PATCH("/mailboxes/{mailbox}/screener", { params, body: { on: false } });
  await signIn("grace@example.org");
  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Inbox");

  await go(page, "#/screener");

  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Screener");
  // The heading shows before the Screener's state has loaded.
  await expect.poll(() => page.getByRole("main").innerText(), wait).toContain("The Screener is off, so mail from first-time senders goes to the Inbox.");
  expect(await page.getByRole("main").getByRole("link", { name: "Switch it on in Settings" }).getAttribute("href")).toBe("#/settings/screener");
});

test("screened senders lists the decisions by where they send mail, and opens one on its sheet", budget, async () => {
  const { page, signIn, grace, params } = await withScreener();
  const decide = (sender: string, delivery: "inbox" | "feed" | "nowhere") => grace.PUT("/mailboxes/{mailbox}/senders/{sender}", { params: { path: { ...params.path, sender } }, body: { delivery } });
  await decide("bob@example.net", "inbox");
  await decide("news@example.org", "feed");
  await decide("spam.example.org", "nowhere");
  await signIn("grace@example.org");
  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Inbox");
  await go(page, "#/screener");

  await page.getByRole("link", { name: /^Screened senders/ }).click();

  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Screened senders");
  const group = (name: string) => page.getByRole("list", { name }).getByRole("listitem");
  await expect.poll(() => group("Inbox").allInnerTexts(), wait).toEqual([expect.stringContaining("bob@example.net")]);
  expect(await group("Feed").allInnerTexts()).toEqual([expect.stringContaining("news@example.org")]);
  expect(await group("Nowhere").allInnerTexts()).toEqual([expect.stringContaining("Everyone at spam.example.org")]);
  expect(await group("Inbox").first().innerText()).toContain("by you");

  await group("Feed").getByRole("link", { name: "news@example.org" }).click();

  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toBe("news@example.org");
  expect(await page.getByRole("main").getByRole("radio", { name: /^Feed/ }).isChecked()).toBe(true);
  expect(await page.getByRole("region", { name: "Screened senders" }).count()).toBe(1);
});

test("removing a decision makes the sender first-time again, and says where their mail went", budget, async () => {
  const { page, signIn, receive, grace, params, listed } = await withScreener();
  await grace.PUT("/mailboxes/{mailbox}/senders/{sender}", { params: { path: { ...params.path, sender: "example.net" } }, body: { delivery: "feed" } });
  await receive(note({ from: "Bob <bob@example.net>", subject: "Hello" }));
  await signIn("grace@example.org");
  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Inbox");
  await go(page, "#/screener/senders");
  const net = page.getByRole("list", { name: "Feed" }).getByRole("listitem").filter({ hasText: "example.net" });

  await net.getByRole("button", { name: "Remove" }).click();

  await expect.poll(() => doneLine(page).textContent(), wait).toBe("Removed everyone at example.net. They're first-time senders again. Moved 1 thread to the Inbox.");
  expect(await listed("inbox")).toEqual(["Hello"]);
  expect((await grace.GET("/mailboxes/{mailbox}/senders", { params })).data!.senders).toEqual([]);
});

test("a sponsor sends a waiting sender's mail to the Inbox in their agent's mailbox from its Screener", budget, async () => {
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
  await sender(page, "carol@example.net").getByRole("button", { name: "Inbox" }).click();
  await expect.poll(() => doneLine(page).textContent(), wait).toBe("carol@example.net's mail goes to the Inbox now. Moved 1 thread.");
  const { data: inbox } = await grace.GET("/mailboxes/{mailbox}/threads", { params: { ...params, query: { label: "inbox" } } });
  expect(inbox!.threads.map(({ subject }) => subject)).toEqual(["Pitch"]);
});

test("a human switches the Screener for their own mailbox and their agents' on the Settings view", budget, async () => {
  const { page, signIn, ada, grace, params } = await withScreener();
  const { data: iris } = await grace.POST("/agents", { body: { name: "Iris" } });
  const { data: irisMailbox } = await ada.POST("/mailboxes", { body: { owner: iris!.agent.id, address: "iris@example.com" } });
  await signIn("grace@example.org");

  await page.getByRole("navigation", { name: "Duva" }).getByRole("link", { name: "Settings" }).click();
  await page.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: "Screener" }).click();

  const sheet = page.getByRole("region", { name: "Screener" });
  const yours = sheet.getByRole("group", { name: /^Your mailbox/ });
  const irises = sheet.getByRole("group", { name: /^Iris/ });
  await expect.poll(() => yours.getByRole("radio", { name: /^On/ }).isChecked(), wait).toBe(true);
  expect(await irises.getByRole("radio", { name: /^Off/ }).isChecked()).toBe(true);
  // What On and Off mean is said once, in the sheet's lead, and each mailbox is one line.
  expect((await sheet.innerText()).match(/first-time senders/g)).toHaveLength(1);
  expect((await yours.innerText()).replace(/\n+/g, "\n")).toBe("Your mailbox\ngrace@example.com\nOn\nOff");

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

  await page.getByRole("button", { name: /Mailboxes and views/ }).click();
  await screenerLink(page).click();
  const longname = sender(page, "bartholomew");
  await longname.getByRole("button", { name: "Nowhere" }).click();
  await expect.poll(() => longname.getByRole("button", { name: "Erase and send nowhere" }).isVisible(), wait).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(phone.width);
  await longname.getByRole("button", { name: "Cancel" }).click();

  await longname.getByRole("link", { name: /More choices/ }).click();

  await expect.poll(() => page.getByRole("main").getByRole("radio", { name: /Everyone at/ }).isVisible(), wait).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(phone.width);
});
