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
