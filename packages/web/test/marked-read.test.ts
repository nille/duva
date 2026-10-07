import type { Page, Route } from "playwright-core";
import { expect, test } from "vitest";
import { mailboxes, startWebApp } from "./web-app.ts";

// As in inbox.test.ts, every wait has room for a page under the full suite's load.
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
    "",
    `Hej Grace, om ${subject}.`,
  ].join("\r\n");

/**
 * The web app for a deployment where Grace has two mailboxes of her own, so the side column counts
 * each, with two unread threads in the first's Inbox: Möte, under her label Familj, and Lunch.
 */
async function withUnreadMail() {
  const app = await startWebApp({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org"] });
  const ada = app.duva.signIn("ada@example.org");
  const grace = app.duva.signIn("grace@example.org");
  const { data: me } = await grace.GET("/whoami");
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: me!.id, address: "grace@example.com" } });
  await ada.POST("/mailboxes", { body: { owner: me!.id, address: "hopper@example.com" } });
  const params = { path: { mailbox: mailbox!.id } };
  // Mail from first-time senders would wait in the Screener, which these tests leave out.
  await grace.PATCH("/mailboxes/{mailbox}/screener", { params, body: { on: false } });
  await app.duva.receive(note("Möte"), { to: ["grace@example.com"] });
  await app.duva.receive(note("Lunch"), { to: ["grace@example.com"] });
  const { data: familj } = await grace.POST("/mailboxes/{mailbox}/labels", { params, body: { name: "Familj" } });
  const { data: inbox } = await grace.GET("/mailboxes/{mailbox}/threads", { params: { ...params, query: { label: "inbox" } } });
  const möte = inbox!.threads.find(({ subject }) => subject === "Möte")!.id;
  await grace.POST("/mailboxes/{mailbox}/threads/labels", { params, body: { threads: [möte], add: [familj!.id] } });
  await app.signIn("grace@example.org");
  await expect.poll(() => counts(app.page), wait).toEqual({ inbox: "2", familj: "1", mailbox: "grace@example.com, 2 unread", list: "2 unread" });
  /** Whether Duva has Möte unread. */
  const unread = async () => (await grace.GET("/mailboxes/{mailbox}/threads", { params: { ...params, query: { label: "inbox" } } })).data!.threads.find(({ id }) => id === möte)!.unread;
  return { ...app, unread };
}

/** The unread counts the page shows: the side column's for the Inbox and Familj, the mailbox's in the selector, and the list's own. */
async function counts(page: Page) {
  const views = page.getByRole("navigation", { name: "Mail" });
  const count = async (name: string) => (await views.getByRole("link", { name: new RegExp(`^${name}`) }).locator(".view-count").allInnerTexts())[0] ?? "";
  const mailbox = await (await mailboxes(page)).getByRole("link", { name: /^grace@example\.com/ }).getAttribute("aria-label");
  const list = (await page.getByRole("region", { name: "Inbox" }).or(page.getByRole("main")).locator(".count").allInnerTexts())[0] ?? "";
  return { inbox: await count("Inbox"), familj: await count("Familj"), mailbox, list };
}

/** Möte's line in the list, as a screen reader names it, and whether it has the orange dot's weight. */
const möte = (page: Page) => page.getByRole("list", { name: "Threads" }).getByRole("link", { name: /Möte/ });
const reads = async (page: Page) => ({ label: await möte(page).getAttribute("aria-label"), unread: await möte(page).evaluate((line) => line.classList.contains("thread-unread")) });

/** Holds every request to the path until `release` lets it on, as a slow connection does. */
async function hold(page: Page, path: string) {
  let release!: (answer: (route: Route) => Promise<void>) => void;
  const released = new Promise<(route: Route) => Promise<void>>((resolve) => (release = resolve));
  let held = 0;
  await page.route(path, async (route) => {
    held++;
    await (await released)(route);
  });
  return { release, held: () => held };
}

/** Notes, at every frame from now on, whether Möte's line reads as unread again, or the Inbox counts other than 1. */
const watchForFlicker = (page: Page) =>
  page.evaluate(() => {
    const flickered = { seen: false };
    (window as { flickered?: typeof flickered }).flickered = flickered;
    const look = () => {
      const line = [...document.querySelectorAll(".threads .thread")].find((each) => each.textContent?.includes("Möte"));
      const inbox = [...document.querySelectorAll(".view-link")].find((each) => each.querySelector(".view-name")?.textContent === "Inbox");
      if (line?.classList.contains("thread-unread") || inbox?.querySelector(".view-count")?.textContent !== "1") flickered.seen = true;
      requestAnimationFrame(look);
    };
    look();
  });
const flickered = (page: Page) => page.evaluate(() => (window as { flickered?: { seen: boolean } }).flickered!.seen);

test("a thread opened beside the list reads as read in its line and every count at once, before Duva has the mark, and stays so", budget, async () => {
  const { page, unread } = await withUnreadMail();
  const reading = await hold(page, "**/threads/read");

  await möte(page).click();

  await expect.poll(() => reading.held(), wait).toBe(1);
  await expect.poll(() => reads(page), wait).toEqual({ label: expect.not.stringMatching(/^Unread/), unread: false });
  expect(await counts(page)).toEqual({ inbox: "1", familj: "", mailbox: "grace@example.com, 1 unread", list: "1 unread" });
  expect(await unread()).toBe(true);
  await watchForFlicker(page);

  reading.release((route) => route.continue());

  await expect.poll(unread, wait).toBe(false);
  // The feeds say the thread was read, and what the page reads again then agrees.
  await page.waitForTimeout(1_500);
  expect(await flickered(page)).toBe(false);
  expect(await counts(page)).toEqual({ inbox: "1", familj: "", mailbox: "grace@example.com, 1 unread", list: "1 unread" });
  await page.keyboard.press("u");
  await expect.poll(() => page.title(), wait).toBe("Inbox (1) · Duva");
});

test("a thread whose mark Duva refuses reads as unread again in its line and the counts, and the thread says it couldn't be marked", budget, async () => {
  const { page } = await withUnreadMail();
  const reading = await hold(page, "**/threads/read");
  await möte(page).click();
  await expect.poll(() => reads(page), wait).toEqual({ label: expect.not.stringMatching(/^Unread/), unread: false });

  reading.release((route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "Internal error" }) }));

  await expect.poll(() => reads(page), wait).toEqual({ label: expect.stringMatching(/^Unread/), unread: true });
  expect(await counts(page)).toEqual({ inbox: "2", familj: "1", mailbox: "grace@example.com, 2 unread", list: "2 unread" });
  expect(await page.getByText("Duva couldn't mark the thread read, so it still shows as unread.").isVisible()).toBe(true);
});

test("Shift+U reads as unread in the thread's line and every count at once, before Duva has the mark", budget, async () => {
  const { page, unread } = await withUnreadMail();
  await möte(page).click();
  await expect.poll(unread, wait).toBe(false);
  await expect.poll(() => counts(page), wait).toEqual({ inbox: "1", familj: "", mailbox: "grace@example.com, 1 unread", list: "1 unread" });
  const marking = await hold(page, "**/threads/unread");

  await page.keyboard.press("Shift+U");

  await expect.poll(() => marking.held(), wait).toBe(1);
  await expect.poll(() => reads(page), wait).toEqual({ label: expect.stringMatching(/^Unread/), unread: true });
  expect(await counts(page)).toEqual({ inbox: "2", familj: "1", mailbox: "grace@example.com, 2 unread", list: "2 unread" });
  expect(await unread()).toBe(false);

  marking.release((route) => route.continue());

  await expect.poll(unread, wait).toBe(true);
  await expect.poll(() => page.title(), wait).toBe("Inbox (2) · Duva");
  expect(await counts(page)).toEqual({ inbox: "2", familj: "1", mailbox: "grace@example.com, 2 unread", list: "2 unread" });
});

test("Shift+U reads as unread at once while the mark from reading the thread is still on its way, and Duva has it unread last", budget, async () => {
  const { page, unread } = await withUnreadMail();
  const reading = await hold(page, "**/threads/read");
  await möte(page).click();
  await expect.poll(() => reads(page), wait).toEqual({ label: expect.not.stringMatching(/^Unread/), unread: false });

  await page.keyboard.press("Shift+U");

  await expect.poll(() => reads(page), wait).toEqual({ label: expect.stringMatching(/^Unread/), unread: true });
  expect(await counts(page)).toEqual({ inbox: "2", familj: "1", mailbox: "grace@example.com, 2 unread", list: "2 unread" });

  reading.release((route) => route.continue());

  await expect.poll(() => page.title(), wait).toBe("Inbox (2) · Duva");
  expect(await unread()).toBe(true);
  expect(await counts(page)).toEqual({ inbox: "2", familj: "1", mailbox: "grace@example.com, 2 unread", list: "2 unread" });
});
