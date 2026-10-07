import type { Page } from "playwright-core";
import { expect, test } from "vitest";
import { startWebApp } from "./web-app.ts";

// The page reads the change feeds every 250 ms in these tests, but a page under the full suite's
// load can still take seconds to show what changed, so every wait has room, and every test more.
const wait = { timeout: 10_000 };
const budget = { timeout: 60_000 };

/** A message to Grace that starts its own thread, saying `text`. */
const note = (from: string, subject: string, text = `About ${subject}.`) =>
  [
    `From: ${from}`,
    "To: Grace <grace@example.com>",
    `Subject: ${subject}`,
    "Date: Tue, 06 Oct 2026 09:00:00 +0200",
    `Message-ID: <${subject.replaceAll(" ", "-")}@mail.example.net>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    text,
  ].join("\r\n");

/**
 * The web app for a deployment on example.com where Grace has her personal mailbox at
 * grace@example.com, whose mail from news@example.net, Example News, goes to the Inbox, and where
 * two of their newsletters wait, the second arriving later.
 */
async function withNewsletters() {
  const app = await startWebApp({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org"] });
  const grace = app.duva.signIn("grace@example.org");
  const { data: me } = await grace.GET("/whoami");
  const { data: mailbox } = await app.duva.signIn("ada@example.org").POST("/mailboxes", { body: { owner: me!.id, address: "grace@example.com" } });
  const params = { path: { mailbox: mailbox!.id } };
  await grace.PUT("/mailboxes/{mailbox}/senders/{sender}", { params: { path: { ...params.path, sender: "news@example.net" } }, body: { delivery: "inbox" } });
  await app.duva.receive(note("Example News <news@example.net>", "Issue 1", "The first issue, on lighthouses."), { to: ["grace@example.com"] }, { at: new Date("2026-10-06T08:00:00Z") });
  await app.duva.receive(note("Example News <news@example.net>", "Issue 2", "The second issue, on ferries."), { to: ["grace@example.com"] }, { at: new Date("2026-10-07T08:00:00Z") });
  const listed = async (label: string) => (await grace.GET("/mailboxes/{mailbox}/threads", { params: { ...params, query: { label } } })).data!.threads.map(({ subject }) => subject);
  await app.signIn("grace@example.org");
  await expect.poll(() => heading(app.page), wait).toBe("Inbox");
  return { ...app, grace, params, listed };
}

const heading = (page: Page) => page.getByRole("heading", { level: 1 }).textContent();
const side = (page: Page) => page.getByRole("navigation", { name: "Mail" });
const sheet = (page: Page) => page.getByRole("main");

/** Opens the thread with the subject from the Inbox, then its sender's sheet from its letter. */
async function openSheet(page: Page, subject: string) {
  await page.getByRole("list", { name: "Threads" }).getByRole("link", { name: new RegExp(subject) }).click();
  await expect.poll(() => heading(page), wait).toBe(subject);
  await page.getByRole("button", { name: "Example News news@example.net" }).click();
  await expect.poll(() => heading(page), wait).toBe("Example News");
}

test("the sender's name in a letter opens their sheet in the reading pane, saying how many threads they have and where their mail goes", budget, async () => {
  const { page } = await withNewsletters();

  await openSheet(page, "Issue 2");

  await expect.poll(() => sheet(page).innerText(), wait).toContain("2 threads from them here");
  expect(await sheet(page).innerText()).toContain("Their mail goes to\nThe Inbox");
  expect(await sheet(page).getByRole("radio", { name: /^Inbox/ }).isChecked()).toBe(true);
  expect(await sheet(page).getByRole("radio", { name: "Just news@example.net" }).isChecked()).toBe(true);
  // The Inbox stays beside the sheet, as it does beside a thread.
  expect(await page.getByRole("region", { name: "Inbox" }).count()).toBe(1);
  expect(await page.title()).toBe("Where mail from Example News goes · Duva");
});

test("choosing the Feed moves their threads there, and the Feed reads as a stream, newest first, each message open", budget, async () => {
  const { page, listed } = await withNewsletters();
  await openSheet(page, "Issue 1");

  await sheet(page).getByRole("radio", { name: /^Feed/ }).check();
  await sheet(page).getByRole("button", { name: "Save" }).click();

  await expect.poll(() => sheet(page).getByRole("status").textContent(), wait).toBe("news@example.net's mail goes to the Feed now. Moved 2 threads.");
  expect(await listed("feed")).toEqual(["Issue 2", "Issue 1"]);
  await side(page).getByRole("link", { name: "Feed" }).click();

  await expect.poll(() => heading(page), wait).toBe("Feed");
  const items = page.getByRole("list", { name: "Feed" }).getByRole("listitem").filter({ has: page.locator(".stream-subject") });
  await expect.poll(() => items.count(), wait).toBe(2);
  expect(await items.nth(0).innerText()).toContain("The second issue, on ferries.");
  expect(await items.nth(1).innerText()).toContain("The first issue, on lighthouses.");
  // Each item's subject opens its thread.
  await items.nth(0).getByRole("link", { name: "Issue 2" }).click();
  await expect.poll(() => heading(page), wait).toBe("Issue 2");
});

test("the side column lists the Feed and the Paper Trail among the Inbox's views, neither counting unread mail", budget, async () => {
  const { page, grace, params } = await withNewsletters();
  await grace.PUT("/mailboxes/{mailbox}/senders/{sender}", { params: { path: { ...params.path, sender: "news@example.net" } }, body: { delivery: "paperTrail" } });

  await side(page).getByRole("link", { name: "Paper Trail" }).click();

  await expect.poll(() => heading(page), wait).toBe("Paper Trail");
  await expect.poll(() => page.getByRole("list", { name: "Threads" }).getByRole("listitem").count(), wait).toBe(2);
  // The Inbox's count drops once the side column reads the labels again.
  await expect.poll(async () => (await side(page).getByRole("link").allTextContents()).slice(0, 5), wait).toEqual(["Inbox", "Screener", "Remind me", "Feed", "Paper Trail"]);
});

test("choosing nowhere asks once more, saying it can't be undone, and then erases their threads", budget, async () => {
  const { page, listed } = await withNewsletters();
  await openSheet(page, "Issue 2");

  await sheet(page).getByRole("radio", { name: /^Nowhere/ }).check();
  await sheet(page).getByRole("button", { name: "Save" }).click();

  await expect.poll(() => sheet(page).innerText(), wait).toContain("This erases their 2 threads here for good, Spam and Trash included, and drops their later mail. This can't be undone.");
  expect(await listed("inbox")).toEqual(["Issue 2", "Issue 1"]);
  await sheet(page).getByRole("button", { name: "Erase and send nowhere" }).click();

  await expect.poll(() => sheet(page).getByRole("status").textContent(), wait).toBe("news@example.net's mail goes nowhere now. Erasing 2 threads. Their mail offers no one-click unsubscribe, so Duva sent none.");
  expect(await listed("inbox")).toEqual([]);
  await expect.poll(() => sheet(page).innerText(), wait).toContain("Nowhere. Their mail is dropped as it arrives");
});

test("a label delivery files their mail under one of the human's own labels", budget, async () => {
  const { page, grace, params, listed } = await withNewsletters();
  const { data: reading } = await grace.POST("/mailboxes/{mailbox}/labels", { params, body: { name: "Reading" } });
  await openSheet(page, "Issue 1");

  await sheet(page).getByRole("radio", { name: /^A label/ }).check();
  await sheet(page).getByRole("combobox", { name: "Label" }).selectOption({ label: "Reading" });
  await sheet(page).getByRole("button", { name: "Save" }).click();

  await expect.poll(() => sheet(page).getByRole("status").textContent(), wait).toBe("news@example.net's mail goes to Reading now. Moved 2 threads.");
  expect(await listed(reading!.id)).toEqual(["Issue 2", "Issue 1"]);
  expect(await listed("inbox")).toEqual([]);
});
