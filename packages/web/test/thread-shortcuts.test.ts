import type { Page } from "playwright-core";
import { expect, test } from "vitest";
import { startWebApp } from "./web-app.ts";

// As in inbox.test.ts, every wait has room for a page under the full suite's load.
const wait = { timeout: 10_000 };
const budget = { timeout: 60_000 };

/** A message from Ada to Grace, copying Iris when `cc` is, that starts its own thread. */
const note = (subject: string, { cc = true } = {}) =>
  [
    "From: Ada Lovelace <ada@example.org>",
    "To: Grace <grace@example.com>",
    ...(cc ? ["Cc: Iris <iris@example.net>"] : []),
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
 * The web app for a deployment where Grace has a personal mailbox at grace@example.com, with the
 * thread received open. `shortcuts` is what she saved on You before she signed in.
 */
async function withThreadOpen(raw: string, { shortcuts = "on" as "on" | "off" } = {}) {
  const app = await startWebApp({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org"] });
  const grace = app.duva.signIn("grace@example.org");
  const { data: me } = await grace.GET("/whoami");
  const { data: mailbox } = await app.duva.signIn("ada@example.org").POST("/mailboxes", { body: { owner: me!.id, address: "grace@example.com" } });
  // Mail from first-time senders would wait in the Screener, which these tests leave out.
  await grace.PATCH("/mailboxes/{mailbox}/screener", { params: { path: { mailbox: mailbox!.id } }, body: { on: false } });
  await grace.PATCH("/preferences", { body: { keyboardShortcuts: shortcuts } });
  await app.duva.receive(raw, { to: ["grace@example.com"] });
  await app.signIn("grace@example.org");
  await app.page.getByRole("list", { name: "Threads" }).getByRole("link").first().click();
  await expect.poll(() => app.page.getByRole("article").count(), wait).toBe(1);
  return { ...app, grace, mailbox: mailbox! };
}

const heading = (page: Page) => page.getByRole("heading", { level: 1 }).textContent();
/** The subjects the open list shows, in order. */
const listed = (page: Page) => page.locator(".threads .thread-subject").allInnerTexts();
/** What the desk says was just done, as a screen reader hears it from the status line. */
const said = (page: Page) => page.locator(".done-line[role=status]").innerText();
/** Opens the view by its name in the Mail navigation, and its first thread. */
async function openIn(page: Page, view: RegExp, subject: string) {
  await page.getByRole("navigation", { name: "Mail" }).getByRole("link", { name: view }).click();
  await expect.poll(() => listed(page), wait).toEqual([subject]);
  await page.getByRole("list", { name: "Threads" }).getByRole("link").first().click();
  await expect.poll(() => heading(page), wait).toBe(subject);
}
/** The label of the field with the cursor in it, as a screen reader names it. */
const cursorIn = (page: Page) => page.evaluate(() => (document.activeElement as HTMLInputElement | null)?.labels?.[0]?.textContent ?? undefined);

test("in an open thread r replies at its foot with the cursor in the reply's text", budget, async () => {
  const { page } = await withThreadOpen(note("Möte"));

  await page.keyboard.press("r");

  const reply = page.getByRole("form", { name: "Reply" });
  await expect.poll(() => reply.getByLabel("To", { exact: true }).inputValue(), wait).toBe("ada@example.org");
  expect(await reply.getByLabel("Cc", { exact: true }).count()).toBe(0);
  await expect.poll(() => cursorIn(page), wait).toBe("Message");
  // What the human types next goes into the reply, and the keys act no more.
  await page.keyboard.type("Ja, ses där. raf e#");
  expect(await reply.getByLabel("Message", { exact: true }).inputValue()).toMatch(/^Ja, ses där\. raf e#/);
  expect(await heading(page)).toBe("Möte");
  expect(await page.getByRole("form").count()).toBe(1);
});

test("in an open thread a replies to all, and f forwards with the cursor in To", budget, async () => {
  const { page } = await withThreadOpen(note("Möte"));

  await page.keyboard.press("a");

  const reply = page.getByRole("form", { name: "Reply" });
  await expect.poll(() => reply.getByLabel("Cc", { exact: true }).inputValue(), wait).toBe("iris@example.net");
  await expect.poll(() => cursorIn(page), wait).toBe("Message");
  await reply.getByRole("button", { name: "Delete draft" }).click();
  await expect.poll(() => page.getByRole("form").count(), wait).toBe(0);

  await page.keyboard.press("f");

  const forward = page.getByRole("form", { name: "Forward" });
  await expect.poll(() => forward.getByLabel("To", { exact: true }).inputValue(), wait).toBe("");
  await expect.poll(() => cursorIn(page), wait).toBe("To");
});

test("a does nothing where the message has only one recipient, as Reply all isn't offered", budget, async () => {
  const { page } = await withThreadOpen(note("Kvitto", { cc: false }));
  expect(await page.getByRole("button", { name: "Reply all" }).count()).toBe(0);

  await page.keyboard.press("a");

  await page.waitForTimeout(1_000);
  expect(await page.getByRole("form").count()).toBe(0);
});

test("in an open thread e archives it, said in the Inbox it returns to", budget, async () => {
  const { page } = await withThreadOpen(note("Möte"));

  await page.keyboard.press("e");

  await expect.poll(() => heading(page), wait).toBe("Inbox");
  await expect.poll(() => said(page), wait).toContain("Archived 1 thread.");
  // The Inbox stayed beside the thread, and reads its threads again.
  await expect.poll(() => listed(page), wait).toEqual([]);
  await openIn(page, /^All mail/, "Möte");
});

test("in an open thread # moves it to Trash, said in the Inbox it returns to", budget, async () => {
  const { page } = await withThreadOpen(note("Möte"));

  await page.keyboard.press("#");

  await expect.poll(() => heading(page), wait).toBe("Inbox");
  await expect.poll(() => said(page), wait).toContain("Moved 1 thread to Trash.");
  await expect.poll(() => listed(page), wait).toEqual([]);
  await openIn(page, /^Trash/, "Möte");
});

test("in a thread in Spam e does nothing, as Archive isn't offered there, and # moves it to Trash", budget, async () => {
  const { page } = await withThreadOpen(note("Möte"));
  await page.getByRole("toolbar", { name: "Thread actions" }).getByRole("button", { name: "Mark as spam" }).click();
  await expect.poll(() => heading(page), wait).toBe("Inbox");
  await openIn(page, /^Spam/, "Möte");

  await page.keyboard.press("e");
  await page.waitForTimeout(1_000);
  expect(await heading(page)).toBe("Möte");
  await page.keyboard.press("#");

  await expect.poll(() => said(page), wait).toContain("Moved 1 thread to Trash.");
  await openIn(page, /^Trash/, "Möte");
});

test("in a thread in Trash e and # do nothing, as Archive and Move to Trash aren't offered there", budget, async () => {
  const { page } = await withThreadOpen(note("Möte"));
  await page.keyboard.press("#");
  await expect.poll(() => heading(page), wait).toBe("Inbox");
  await openIn(page, /^Trash/, "Möte");

  await page.keyboard.press("e");
  await page.keyboard.press("#");

  await page.waitForTimeout(1_000);
  expect(await heading(page)).toBe("Möte");
});

test("in an open thread ! marks it as spam, said in the Inbox it returns to", budget, async () => {
  const { page } = await withThreadOpen(note("Möte"));

  await page.keyboard.press("!");

  await expect.poll(() => heading(page), wait).toBe("Inbox");
  await expect.poll(() => said(page), wait).toContain("Marked 1 thread as spam.");
  await expect.poll(() => listed(page), wait).toEqual([]);
  await openIn(page, /^Spam/, "Möte");
});

test("in an open thread Shift+U marks it unread and goes back to the list, and u goes back as it is", budget, async () => {
  const { page, grace, mailbox } = await withThreadOpen(note("Möte"));
  const unread = async () => (await grace.GET("/mailboxes/{mailbox}/threads", { params: { path: { mailbox: mailbox.id }, query: { label: "inbox" } } })).data!.threads[0]!.unread;
  await expect.poll(unread, wait).toBe(false);

  await page.keyboard.press("u");

  await expect.poll(() => heading(page), wait).toBe("Inbox");
  expect(await unread()).toBe(false);
  await page.getByRole("list", { name: "Threads" }).getByRole("link").first().click();
  await expect.poll(() => heading(page), wait).toBe("Möte");

  await page.keyboard.press("Shift+U");

  await expect.poll(() => heading(page), wait).toBe("Inbox");
  await expect.poll(unread, wait).toBe(true);
});

test("in an open thread l opens its labels", budget, async () => {
  const { page } = await withThreadOpen(note("Möte"));

  await page.keyboard.press("l");

  const labels = page.getByRole("group", { name: "Labels for this thread" });
  await expect.poll(() => labels.innerText(), wait).toContain("You have no labels yet.");
});

test("each of a thread's actions with a key shows its cap and says its key, as Send in a reply does", budget, async () => {
  const { page } = await withThreadOpen(note("Möte"));
  const tools = page.getByRole("toolbar", { name: "Thread actions" });
  const keyOf = async (button: ReturnType<Page["getByRole"]>) => [await button.getAttribute("aria-keyshortcuts"), await button.locator("kbd").innerText()];

  expect(await keyOf(page.getByRole("link", { name: "Inbox", exact: true }))).toEqual(["u", "u"]);
  expect(await keyOf(tools.getByRole("button", { name: "Archive" }))).toEqual(["e", "e"]);
  expect(await keyOf(tools.getByRole("button", { name: "Move to Trash" }))).toEqual(["#", "#"]);
  expect(await keyOf(tools.getByRole("button", { name: "Mark as spam" }))).toEqual(["!", "!"]);
  expect(await keyOf(tools.getByRole("button", { name: "Labels" }))).toEqual(["l", "l"]);
  expect(await keyOf(tools.getByRole("button", { name: "Mark unread" }))).toEqual(["Shift+U", "⇧U"]);
  expect(await keyOf(page.getByRole("button", { name: "Reply", exact: true }))).toEqual(["r", "r"]);
  expect(await keyOf(page.getByRole("button", { name: "Reply all" }))).toEqual(["a", "a"]);
  expect(await keyOf(page.getByRole("button", { name: "Forward" }))).toEqual(["f", "f"]);
  // The cap is no part of the button's name.
  expect(await tools.getByRole("button", { name: "Archive", exact: true }).count()).toBe(1);

  await page.keyboard.press("r");

  const send = page.getByRole("form", { name: "Reply" }).getByRole("button", { name: "Send", exact: true });
  await expect.poll(() => send.count(), wait).toBe(1);
  expect(await keyOf(send)).toEqual(["Control+Enter", "Ctrl ↵"]);
});

test("in a reply Ctrl+Enter sends it", budget, async () => {
  const { page } = await withThreadOpen(note("Möte"));
  await page.keyboard.press("r");
  await expect.poll(() => cursorIn(page), wait).toBe("Message");
  await page.keyboard.type("Ja, ses där.");

  await page.keyboard.press("Control+Enter");

  await expect.poll(() => page.getByRole("article").count(), wait).toBe(2);
  expect(await page.getByRole("article").last().innerText()).toContain("Ja, ses där.");
  expect(await page.getByRole("form").count()).toBe(0);
});

test("with shortcuts off on You, r, a, f, e, #, !, l, u and Shift+U do nothing in a thread, which shows no caps for them", budget, async () => {
  const { page } = await withThreadOpen(note("Möte"), { shortcuts: "off" });
  expect(await page.getByRole("main").locator("kbd").count()).toBe(0);
  expect(await page.getByRole("main").locator("[aria-keyshortcuts]").count()).toBe(0);

  for (const key of ["r", "a", "f", "e", "#", "!", "l", "u", "Shift+U"]) await page.keyboard.press(key);

  await page.waitForTimeout(1_000);
  expect(await heading(page)).toBe("Möte");
  expect(await page.getByRole("form").count()).toBe(0);
});

test("the ? sheet lists the keys of a thread", budget, async () => {
  const { page } = await withThreadOpen(note("Möte"));

  await page.keyboard.press("?");

  const sheet = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  const thread = sheet.getByRole("region", { name: "In a thread" });
  await expect.poll(() => thread.isVisible(), wait).toBe(true);
  expect(await thread.getByRole("term").allInnerTexts()).toEqual(["r", "a", "f", "e", "#"]);
  expect(await thread.getByRole("definition").allInnerTexts()).toEqual(["Reply", "Reply all", "Forward", "Archive", "Move to Trash"]);
});
