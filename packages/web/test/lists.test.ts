import type { Page } from "playwright-core";
import { expect, test } from "vitest";
import { phone, startWebApp } from "./web-app.ts";

// The page reads the change feeds every 250 ms in these tests, but a page under the full suite's
// load can still take seconds to show what changed, so every wait has room, and every test more.
const wait = { timeout: 10_000 };
const budget = { timeout: 60_000 };

/** A message to Grace that starts its own thread, from Ada unless it says. */
const note = (subject: string, from = "Ada Lovelace <ada@example.org>") =>
  [
    `From: ${from}`,
    "To: Grace <grace@example.com>",
    `Subject: ${subject}`,
    "Date: Sun, 04 Oct 2026 09:00:00 +0200",
    `Message-ID: <${subject.replaceAll(" ", "-")}@example.org>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    `About ${subject}.`,
  ].join("\r\n");

/**
 * The web app for a deployment where Grace has a personal mailbox at grace@example.com with its
 * Screener on, Ada let in and a thread from her for each subject, and one from a first-time sender waiting.
 */
async function withLists(subjects: string[], options: Parameters<typeof startWebApp>[0] = {}) {
  const app = await startWebApp({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org"], ...options });
  const grace = app.duva.signIn("grace@example.org");
  const { data: me } = await grace.GET("/whoami");
  const { data: mailbox } = await app.duva.signIn("ada@example.org").POST("/mailboxes", { body: { owner: me!.id, address: "grace@example.com" } });
  const params = { path: { mailbox: mailbox!.id } };
  await grace.POST("/mailboxes/{mailbox}/screener/let-in", { params, body: { address: "ada@example.org" } });
  for (const subject of subjects) await app.duva.receive(note(subject), { to: ["grace@example.com"] });
  await app.duva.receive(note("Hello from Linus", "Linus <linus@example.net>"), { to: ["grace@example.com"] });
  await app.signIn("grace@example.org");
  await expect.poll(() => heading(app.page), wait).toBe("Inbox");
  return app;
}

const heading = (page: Page) => page.getByRole("heading", { level: 1 }).textContent();
/** Goes to the place in the web app at the hash, as a link there does. */
const go = async (page: Page, hash: string, title: string) => {
  await page.evaluate((hash) => (location.hash = hash), hash);
  await expect.poll(() => heading(page), wait).toBe(title);
};
/** How wide the sheet is that a view lays on the desk, in pixels. */
const sheetWidth = (page: Page, selector: string) => page.locator(selector).first().evaluate((sheet) => Math.round(sheet.getBoundingClientRect().width));
const head = (page: Page) => page.locator(".desk-head").innerText();

test("every list lies at one width in the list's column, and a thread opens beside it", budget, async () => {
  const { page } = await withLists(["Kvitto"]);
  await expect.poll(() => page.getByRole("list", { name: "Threads" }).getByRole("listitem").count(), wait).toBe(1);
  const inbox = await sheetWidth(page, ".index");

  await go(page, "#/screener", "Screener");
  await expect.poll(() => page.locator(".waiting").count(), wait).toBe(1);
  const screener = await sheetWidth(page, ".waiting");
  await page.getByRole("link", { name: "Screened senders" }).click();
  await expect.poll(() => page.locator(".screened-sheet").count(), wait).toBe(1);
  const screened = await sheetWidth(page, ".screened-sheet");
  await page.getByRole("searchbox", { name: "Search your mail" }).fill("kvitto");
  await page.getByRole("searchbox", { name: "Search your mail" }).press("Enter");
  await expect.poll(() => page.getByRole("list", { name: "Results" }).count(), wait).toBe(1);
  const results = await sheetWidth(page, ".index");
  await page.getByRole("list", { name: "Results" }).getByRole("link").first().click();
  await expect.poll(() => heading(page), wait).toBe("Kvitto");
  const [list, thread] = [(await page.locator(".index").boundingBox())!, (await page.getByRole("article").boundingBox())!];

  expect([screener, screened, results]).toEqual([inbox, inbox, inbox]);
  expect(thread.x).toBeGreaterThanOrEqual(list.x + list.width);
});

test("the status strip says when the mail was last checked, and no list's head says it or repeats the mailbox's address", budget, async () => {
  const { page } = await withLists(["Kvitto"]);
  await expect.poll(() => page.getByRole("contentinfo", { name: "Status" }).innerText(), wait).toMatch(/Up to date at/);
  expect(await head(page)).not.toMatch(/Up to date/);
  expect(await head(page)).not.toContain("grace@example.com");

  for (const [hash, title] of [
    ["#/sent", "Sent"],
    ["#/all", "All mail"],
    ["#/screener", "Screener"],
    ["#/screener/senders", "Screened senders"],
  ]) {
    await go(page, hash!, title!);
    // The connection is checked every 250 ms, so a second is several reads.
    await page.waitForTimeout(1_000);
    const text = await head(page);
    expect(text, title).not.toMatch(/Up to date/);
    expect(text, title).not.toContain("grace@example.com");
  }
  await page.getByRole("searchbox", { name: "Search your mail" }).fill("kvitto");
  await page.getByRole("searchbox", { name: "Search your mail" }).press("Enter");
  await expect.poll(() => heading(page), wait).toBe("Search results");
  expect(await head(page)).not.toContain("grace@example.com");
});

test("Select all says it picks only the threads shown while older ones aren't", budget, async () => {
  const { page } = await withLists(Array.from({ length: 26 }, (_, number) => `Brev ${number + 1}`));
  const tools = page.getByRole("toolbar", { name: "Selected threads" });
  await expect.poll(() => page.getByRole("list", { name: "Threads" }).getByRole("listitem").count(), wait).toBe(25);

  await tools.getByRole("checkbox", { name: "Select the threads shown" }).check();

  expect(await tools.innerText()).toContain("25 selected, only the threads shown");
  await page.getByRole("button", { name: "Show older threads" }).click();
  await expect.poll(() => page.getByRole("list", { name: "Threads" }).getByRole("listitem").count(), wait).toBe(26);
  // The older thread shown now isn't picked, so the box is mixed.
  expect(await tools.innerText()).toContain("25 selected");
  expect(await tools.getByRole("checkbox", { name: "Select the threads shown" }).evaluate((box) => (box as HTMLInputElement).indeterminate)).toBe(true);
  await tools.getByRole("checkbox", { name: "Select the threads shown" }).check();
  expect(await tools.innerText()).toContain("26 selected");
  expect(await tools.innerText()).not.toContain("only the threads shown");
});

test("on a phone every list fits the screen", budget, async () => {
  const { page } = await withLists(["Kvitto"], { viewport: phone });
  await expect.poll(() => page.getByRole("list", { name: "Threads" }).getByRole("listitem").count(), wait).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(phone.width);

  await go(page, "#/screener", "Screener");
  await expect.poll(() => page.locator(".waiting").count(), wait).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(phone.width);
  await go(page, "#/screener/senders", "Screened senders");
  await expect.poll(() => page.locator(".screened-sheet").count(), wait).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(phone.width);
});

/**
 * The web app for a deployment where Ada, the admin, has a personal mailbox at ada@example.com and
 * sponsors the agent Hermes, which owns hermes@example.com and works in Ada's mailbox with full
 * sponsor access. Mail from Grace and from Hermes waits in Ada's Inbox.
 */
async function withAgentAtWork(options: Parameters<typeof startWebApp>[0] = {}) {
  const app = await startWebApp({ domain: "example.com", admin: "ada@example.org", ...options });
  const ada = app.duva.signIn("ada@example.org");
  const { data: me } = await ada.GET("/whoami");
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: me!.id, address: "ada@example.com" } });
  const inAdas = { path: { mailbox: mailbox!.id } };
  await ada.PATCH("/mailboxes/{mailbox}/screener", { params: inAdas, body: { on: false } });
  const { data: created } = await ada.POST("/agents", { body: { name: "Hermes" } });
  await ada.POST("/mailboxes", { body: { owner: created!.agent.id, address: "hermes@example.com" } });
  await ada.PATCH("/agents/{agent}/settings", { params: { path: { agent: created!.agent.id } }, body: { sponsorAccess: "send" } });
  const hermes = app.duva.withKey(created!.key);
  const toAda = (subject: string, from: string) => note(subject, from).replace("To: Grace <grace@example.com>", "To: ada@example.com");
  await app.duva.receive(toAda("Möte", "Grace Hopper <grace@example.org>"), { to: ["ada@example.com"] });
  // Hermes's own mail carries the header every message an agent sends does.
  await app.duva.receive(toAda("Veckorapport", "Hermes <hermes@example.com>").replace("\r\n", "\r\nDuva-Agent: Hermes for ada@example.org\r\n"), { to: ["ada@example.com"] });
  const { data: listed } = await ada.GET("/mailboxes/{mailbox}/threads", { params: inAdas });
  const meeting = listed!.threads.find(({ subject }) => subject === "Möte")!;
  const { data: thread } = await ada.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { ...inAdas.path, thread: meeting.id } } });
  /** Hermes drafts a reply to Grace's message in Ada's mailbox and asks to send it, and answers the approval it waits for. */
  const askToReply = async () => {
    const { data: draft } = await hermes.POST("/mailboxes/{mailbox}/drafts", { params: inAdas, body: { answers: thread!.messages[0]!.id, text: "Måndag går bra." } });
    const { data: asked } = await hermes.POST("/mailboxes/{mailbox}/drafts/{draft}/send", { params: { path: { ...inAdas.path, draft: draft!.id } } });
    return asked!.send!.approval!;
  };
  return { ...app, ada, askToReply };
}

const row = (page: Page, subject: string) => page.getByRole("list", { name: "Threads" }).getByRole("listitem").filter({ hasText: subject });

test("a row says when an agent sent it, and a thread whose reply an agent asks to send says it waits for you, naming the agent", budget, async () => {
  const { page, signIn, ada, askToReply } = await withAgentAtWork();
  const approval = await askToReply();
  await signIn("ada@example.org");
  await expect.poll(() => heading(page), wait).toBe("Inbox");

  const meeting = row(page, "Möte");
  await expect.poll(() => meeting.innerText(), wait).toContain("Waiting for you");
  expect(await meeting.innerText()).toContain("Hermes");
  expect(await meeting.getByRole("link").getAttribute("aria-label")).toContain("Hermes's reply waits for you");
  expect(await meeting.getByRole("link").getAttribute("aria-label")).toContain("Grace Hopper, Möte");
  const report = row(page, "Veckorapport");
  expect(await report.getByRole("link").getAttribute("aria-label")).toContain("Hermes, an agent, Veckorapport");
  expect(await report.innerText()).not.toContain("Waiting for you");
  expect(await report.locator(".actor-mark-agent").count()).toBe(1);
  expect(await meeting.locator(".actor-mark-human").count()).toBe(1);

  await ada.POST("/approvals/{approval}/send", { params: { path: { approval } } });

  await expect.poll(() => meeting.innerText(), wait).not.toContain("Waiting for you");
});

test("on a phone a row an agent sent carries its diamond, and a human's their dot", budget, async () => {
  const { page, signIn } = await withAgentAtWork({ viewport: phone });
  await signIn("ada@example.org");

  await expect.poll(() => row(page, "Veckorapport").locator(".actor-mark-agent").count(), wait).toBe(1);
  expect(await row(page, "Möte").locator(".actor-mark-human").count()).toBe(1);
});

test("new senders waiting in the Screener show as one row at the top of the Inbox, which opens the Screener", budget, async () => {
  const { page } = await withLists(["Kvitto"]);
  const waiting = page.getByRole("region", { name: "Screener" });

  await expect.poll(() => waiting.innerText(), wait).toContain("1 new sender waits in the Screener");
  const [rowTop, listTop] = [(await waiting.boundingBox())!.y, (await page.getByRole("list", { name: "Threads" }).boundingBox())!.y];
  expect(rowTop).toBeLessThan(listTop);
  await waiting.getByRole("link", { name: "Screen them" }).click();
  await expect.poll(() => heading(page), wait).toBe("Screener");

  await page.getByRole("button", { name: "Let in" }).click();
  await page.getByRole("button", { name: "This address" }).click();
  await go(page, "#/", "Inbox");
  await expect.poll(() => page.getByRole("list", { name: "Threads" }).getByRole("listitem").count(), wait).toBe(2);
  await expect.poll(() => waiting.count(), wait).toBe(0);
});

test("the Inbox's chips show its unread threads, or those with a label, and All shows it whole again", budget, async () => {
  const { page, duva } = await withLists(["Kvitto", "Lunch", "Resplan"]);
  const grace = duva.signIn("grace@example.org");
  const { data: mailboxes } = await grace.GET("/mailboxes");
  const params = { path: { mailbox: mailboxes!.mailboxes[0]!.id } };
  const { data: threads } = await grace.GET("/mailboxes/{mailbox}/threads", { params });
  const id = (subject: string) => threads!.threads.find((thread) => thread.subject === subject)!.id;
  await grace.POST("/mailboxes/{mailbox}/threads/read", { params, body: { threads: [id("Kvitto"), id("Resplan")] } });
  const { data: family } = await grace.POST("/mailboxes/{mailbox}/labels", { params, body: { name: "Familj" } });
  await grace.POST("/mailboxes/{mailbox}/threads/labels", { params, body: { threads: [id("Resplan")], add: [family!.id] } });
  await page.reload();
  const chips = page.getByRole("navigation", { name: "Show" });
  await expect.poll(() => chips.getByRole("link").allInnerTexts(), wait).toEqual(["All", "Unread", "Familj"]);
  expect(await chips.getByRole("link", { name: "All" }).getAttribute("aria-current")).toBe("page");
  const subjects = () => page.locator(".threads .thread-subject").allInnerTexts();

  await chips.getByRole("link", { name: "Unread" }).click();

  await expect.poll(subjects, wait).toEqual(["Lunch"]);
  expect(await chips.getByRole("link", { name: "Unread" }).getAttribute("aria-current")).toBe("page");
  await chips.getByRole("link", { name: "Familj" }).click();
  await expect.poll(subjects, wait).toEqual(["Resplan"]);
  await chips.getByRole("link", { name: "All" }).click();
  await expect.poll(() => heading(page), wait).toBe("Inbox");
  await expect.poll(subjects, wait).toHaveLength(3);
});
