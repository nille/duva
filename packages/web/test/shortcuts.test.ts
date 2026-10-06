import type { Page } from "playwright-core";
import { expect, test } from "vitest";
import { phone, startWebApp } from "./web-app.ts";

// The page reads the change feeds every 250 ms in these tests, but a page under the full suite's
// load can still take seconds to show what changed, so every wait has room, and every test more.
const wait = { timeout: 10_000 };
const budget = { timeout: 60_000 };

/** A message from Ada to Grace that starts its own thread. */
const note = (subject: string) =>
  [
    "From: Ada Lovelace <ada@example.org>",
    "To: Grace <grace@example.com>",
    `Subject: ${subject}`,
    "Date: Sun, 04 Oct 2026 09:00:00 +0200",
    `Message-ID: <${subject.replaceAll(" ", "-")}@example.org>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    `Hej Grace, om ${subject}.`,
  ].join("\r\n");

/**
 * The web app for a deployment where Grace has a personal mailbox at grace@example.com, with a
 * thread for each subject, the last newest, and her Inbox open.
 */
async function withThreads(subjects: string[], options: Parameters<typeof startWebApp>[0] = {}) {
  const app = await startWebApp({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org"], ...options });
  const grace = app.duva.signIn("grace@example.org");
  const { data: me } = await grace.GET("/whoami");
  const { data: mailbox } = await app.duva.signIn("ada@example.org").POST("/mailboxes", { body: { owner: me!.id, address: "grace@example.com" } });
  // Mail from first-time senders would wait in the Screener, which these tests leave out.
  await grace.PATCH("/mailboxes/{mailbox}/screener", { params: { path: { mailbox: mailbox!.id } }, body: { on: false } });
  for (const subject of subjects) await app.duva.receive(note(subject), { to: ["grace@example.com"] });
  await app.signIn("grace@example.org");
  await expect.poll(() => heading(app.page), wait).toBe("Inbox");
  await expect.poll(() => listed(app.page), wait).toHaveLength(subjects.length);
  return { ...app, grace };
}

const heading = (page: Page) => page.getByRole("heading", { level: 1 }).textContent();
/** The subjects the open list shows, in order. */
const listed = (page: Page) => page.locator(".threads .thread-subject").allInnerTexts();
/** The subject of the thread whose line has the focus, as a screen reader reads its line, or undefined. */
const focused = (page: Page) => page.evaluate(() => document.activeElement?.closest("a.thread")?.querySelector(".thread-subject")?.textContent ?? undefined);
/** What the desk says was just done, as a screen reader hears it from the status line. */
const said = (page: Page) => page.locator(".done-line[role=status]").innerText();
const sheet = (page: Page) => page.getByRole("dialog", { name: "Keyboard shortcuts" });

test("j and k move through a list's threads, each line taking the focus a screen reader reads, and Enter or o opens one", budget, async () => {
  const { page } = await withThreads(["Kvitto", "Lunch", "Resplan"]);

  await page.keyboard.press("j");
  expect(await focused(page)).toBe("Resplan");
  await page.keyboard.press("j");
  await page.keyboard.press("j");
  expect(await focused(page)).toBe("Kvitto");
  // The last thread stays the last.
  await page.keyboard.press("j");
  expect(await focused(page)).toBe("Kvitto");
  await page.keyboard.press("k");
  expect(await focused(page)).toBe("Lunch");
  expect(await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))).toMatch(/^Unread, Ada Lovelace, Lunch/);

  await page.keyboard.press("Enter");
  await expect.poll(() => heading(page), wait).toBe("Lunch");

  await page.keyboard.press("Escape");
  await expect.poll(() => heading(page), wait).toBe("Inbox");
  await expect.poll(() => listed(page), wait).toHaveLength(3);
  // The cursor is back on the thread that was open.
  await page.keyboard.press("j");
  expect(await focused(page)).toBe("Lunch");
  await page.keyboard.press("k");
  await page.keyboard.press("o");
  await expect.poll(() => heading(page), wait).toBe("Resplan");
});

test("e archives the thread at the cursor and # moves it to Trash, each said with Undo, and the cursor moves on to the next", budget, async () => {
  const { page } = await withThreads(["Kvitto", "Lunch", "Resplan"]);
  await page.keyboard.press("j");

  await page.keyboard.press("e");

  await expect.poll(() => listed(page), wait).toEqual(["Lunch", "Kvitto"]);
  expect(await said(page)).toContain("Archived 1 thread.");
  await expect.poll(() => focused(page), wait).toBe("Lunch");

  await page.keyboard.press("#");

  await expect.poll(() => listed(page), wait).toEqual(["Kvitto"]);
  expect(await said(page)).toContain("Moved 1 thread to Trash.");
  await expect.poll(() => focused(page), wait).toBe("Kvitto");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => listed(page), wait).toEqual(["Lunch", "Kvitto"]);
});

test("e and # act on the threads picked when any are", budget, async () => {
  const { page } = await withThreads(["Kvitto", "Lunch", "Resplan"]);
  await page.getByRole("checkbox", { name: "Select Kvitto" }).check();
  await page.getByRole("checkbox", { name: "Select Lunch" }).check();

  // The focus is on a checkbox, which takes no letters, so the keys still work.
  await page.keyboard.press("#");

  await expect.poll(() => listed(page), wait).toEqual(["Resplan"]);
  expect(await said(page)).toContain("Moved 2 threads to Trash.");
});

test("in Trash e does nothing, as Archive isn't offered there, and # does nothing, as the threads are in Trash already", budget, async () => {
  const { page } = await withThreads(["Kvitto"]);
  await page.keyboard.press("j");
  await page.keyboard.press("#");
  await expect.poll(() => listed(page), wait).toEqual([]);
  await page.getByRole("navigation", { name: "Mail" }).getByRole("link", { name: /^Trash/ }).click();
  await expect.poll(() => listed(page), wait).toEqual(["Kvitto"]);

  await page.keyboard.press("j");
  await page.keyboard.press("e");
  await page.keyboard.press("#");

  await page.waitForTimeout(1_000);
  expect(await listed(page)).toEqual(["Kvitto"]);
  expect(await said(page)).toBe("");
});

test("search results move and archive by keyboard as a list does", budget, async () => {
  const { page } = await withThreads(["Hyran för oktober", "Hyran för november", "Lunch"]);
  await page.keyboard.press("/");
  await page.keyboard.type("hyran");
  await page.keyboard.press("Enter");
  await expect.poll(() => heading(page), wait).toBe("Search results");
  await expect.poll(() => listed(page), wait).toHaveLength(2);
  const first = (await listed(page))[0];

  await page.keyboard.press("j");
  expect(await focused(page)).toBe(first);
  await page.keyboard.press("#");

  await expect.poll(() => listed(page), wait).toHaveLength(1);
  expect(await said(page)).toContain("Moved 1 thread to Trash.");
});

test("c writes a new message, and ? lists every shortcut on a sheet that Escape closes, back where the focus was", budget, async () => {
  const { page } = await withThreads(["Kvitto"]);
  await page.keyboard.press("j");

  await page.keyboard.press("?");

  await expect.poll(() => sheet(page).isVisible(), wait).toBe(true);
  const listedKeys = await sheet(page).innerText();
  for (const what of ["Next thread", "Previous thread", "Open the thread", "Archive", "Move to Trash", "Write", "Search", "Close", "These shortcuts"]) expect(listedKeys).toContain(what);
  expect(await sheet(page).getByRole("link", { name: "You in Settings" }).getAttribute("href")).toBe("#/settings/you");
  await page.keyboard.press("Escape");
  await expect.poll(() => sheet(page).count(), wait).toBe(0);
  expect(await focused(page)).toBe("Kvitto");

  await page.keyboard.press("c");
  await expect.poll(() => heading(page), wait).toBe("New message");
});

test("keys typed in a field stay there, and shortcuts don't act on them", budget, async () => {
  const { page } = await withThreads(["Kvitto"]);
  await page.getByRole("searchbox", { name: "Search your mail" }).click();

  await page.keyboard.type("jek#c?");

  expect(await page.getByRole("searchbox", { name: "Search your mail" }).inputValue()).toBe("jek#c?");
  expect(await heading(page)).toBe("Inbox");
  expect(await listed(page)).toEqual(["Kvitto"]);
  expect(await sheet(page).count()).toBe(0);
});

test("a human turns keyboard shortcuts off on You, and then no key acts, ? and / included", budget, async () => {
  const { page, grace } = await withThreads(["Kvitto"]);
  await page.getByRole("navigation", { name: "Duva" }).getByRole("link", { name: "Settings" }).click();
  const you = page.getByRole("region", { name: "You" });
  const shortcuts = you.getByRole("group", { name: "Keyboard shortcuts" });
  await expect.poll(() => shortcuts.getByRole("radio", { name: /^On/ }).isChecked(), wait).toBe(true);

  await shortcuts.getByRole("radio", { name: /^Off/ }).check();
  await you.getByRole("button", { name: "Save" }).click();
  await expect.poll(() => you.getByRole("status").textContent(), wait).toBe("Saved. This applies from now on.");
  expect((await grace.GET("/preferences")).data?.keyboardShortcuts).toBe("off");
  await page.getByRole("navigation", { name: "Duva" }).getByRole("link", { name: "Mail" }).click();
  await expect.poll(() => listed(page), wait).toEqual(["Kvitto"]);

  for (const key of ["j", "e", "?", "/", "c"]) await page.keyboard.press(key);

  await page.waitForTimeout(500);
  expect(await focused(page)).toBeUndefined();
  expect(await sheet(page).count()).toBe(0);
  expect(await page.evaluate(() => document.activeElement?.getAttribute("type"))).not.toBe("search");
  expect(await heading(page)).toBe("Inbox");
  expect(await listed(page)).toEqual(["Kvitto"]);
});

test("on a phone the shortcuts' sheet fits the screen", budget, async () => {
  const { page } = await withThreads(["Kvitto"], { viewport: phone });

  await page.keyboard.press("?");

  await expect.poll(() => sheet(page).isVisible(), wait).toBe(true);
  const box = (await sheet(page).boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(phone.width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(phone.width);
});

test("on a phone Escape closes a thread's More first, and then the thread", budget, async () => {
  const { page } = await withThreads(["Kvitto"], { viewport: phone });
  await page.getByRole("link", { name: /Kvitto/ }).click();
  await expect.poll(() => heading(page), wait).toBe("Kvitto");
  const more = page.getByRole("button", { name: "More" });
  await more.click();
  expect(await more.getAttribute("aria-expanded")).toBe("true");

  await page.keyboard.press("Escape");

  await expect.poll(() => more.getAttribute("aria-expanded"), wait).toBe("false");
  expect(await heading(page)).toBe("Kvitto");
  await page.keyboard.press("Escape");
  await expect.poll(() => heading(page), wait).toBe("Inbox");
});
