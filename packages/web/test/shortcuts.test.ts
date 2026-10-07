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

/** The aria-label of each line of the open list, which starts "Unread" while its thread is, in order. */
const lines = (page: Page) => page.locator(".threads a.thread").evaluateAll((links) => links.map((link) => link.getAttribute("aria-label") ?? ""));
/** The subject of the thread whose line is marked open beside the list, or undefined. */
const openLine = (page: Page) => page.evaluate(() => document.querySelector('.threads a.thread[aria-current="true"] .thread-subject')?.textContent ?? undefined);

test("on a desk j and k open the thread at the cursor beside the list once it rests there half a second, marking it read, while the focus stays in the list", budget, async () => {
  const { page } = await withThreads(["Kvitto", "Lunch", "Resplan"]);

  await page.keyboard.press("j");
  await page.waitForTimeout(300);
  expect(await heading(page)).toBe("Inbox");
  expect((await lines(page))[0]).toMatch(/^Unread, /);

  await expect.poll(() => heading(page), wait).toBe("Resplan");
  expect(await page.locator(".pane-list").getByRole("heading", { name: "Inbox", level: 2 }).count()).toBe(1);
  expect(await focused(page)).toBe("Resplan");
  expect(await openLine(page)).toBe("Resplan");
  await expect.poll(async () => (await lines(page))[0], wait).not.toMatch(/^Unread, /);

  // The keys go on moving from there, and the next rest opens the next.
  await page.keyboard.press("j");
  expect(await focused(page)).toBe("Lunch");
  await expect.poll(() => heading(page), wait).toBe("Lunch");
  expect(await focused(page)).toBe("Lunch");
  expect(await openLine(page)).toBe("Lunch");
  // Escape still closes what is open.
  await page.keyboard.press("Escape");
  await expect.poll(() => heading(page), wait).toBe("Inbox");
});

test("a quick run of j and k opens none of the threads it passes, only the one it rests on", budget, async () => {
  const { page } = await withThreads(["Kvitto", "Lunch", "Resplan"]);

  for (const key of ["j", "j", "j", "k"]) await page.keyboard.press(key);
  expect(await heading(page)).toBe("Inbox");

  await expect.poll(() => heading(page), wait).toBe("Lunch");
  expect(await focused(page)).toBe("Lunch");
  await expect.poll(async () => (await lines(page))[1], wait).not.toMatch(/^Unread, /);
  const [resplan, , kvitto] = await lines(page);
  expect(resplan).toMatch(/^Unread, /);
  expect(kvitto).toMatch(/^Unread, /);
});

test("on a phone j and k open nothing by themselves, and o still opens", budget, async () => {
  const { page } = await withThreads(["Kvitto", "Lunch"], { viewport: phone });

  await page.keyboard.press("j");
  await page.waitForTimeout(1_000);

  expect(await heading(page)).toBe("Inbox");
  expect(await focused(page)).toBe("Lunch");
  expect((await lines(page))[0]).toMatch(/^Unread, /);
  await page.keyboard.press("o");
  await expect.poll(() => heading(page), wait).toBe("Lunch");
});

test("hovering a line opens nothing", budget, async () => {
  const { page } = await withThreads(["Kvitto"]);

  await page.locator(".threads a.thread").hover();
  await page.waitForTimeout(1_000);

  expect(await heading(page)).toBe("Inbox");
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
  for (const what of [
    "Move, and open after a moment",
    "Open the thread",
    "Select the thread",
    "Archive",
    "Move to Trash",
    "Mark as spam",
    "Labels",
    "Mark unread",
    "Mark read",
    "Back to the list",
    "Undo",
    "Go to the Inbox",
    "Go to Sent",
    "Go to Drafts",
    "Go to All mail",
    "Write",
    "Search",
    "These shortcuts",
  ])
    expect(listedKeys).toContain(what);
  // Each key shows as a printed cap, and a chord as its keys in turn.
  expect(await sheet(page).locator("kbd").allInnerTexts()).toEqual(expect.arrayContaining(["j", "x", "!", "Shift", "U", "z", "g", "i"]));
  expect(await sheet(page).getByRole("link", { name: "Preferences in Settings" }).getAttribute("href")).toBe("#/settings/you");
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
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  const you = page.getByRole("region", { name: "Preferences" });
  const shortcuts = you.getByRole("group", { name: "Keyboard shortcuts" });
  await expect.poll(() => shortcuts.getByRole("radio", { name: /^On/ }).isChecked(), wait).toBe(true);

  await shortcuts.getByRole("radio", { name: /^Off/ }).check();
  await you.getByRole("button", { name: "Save" }).click();
  await expect.poll(() => you.getByRole("status").textContent(), wait).toBe("Saved. This applies from now on.");
  expect((await grace.GET("/preferences")).data?.keyboardShortcuts).toBe("off");
  await page.getByRole("navigation", { name: "Duva" }).getByRole("link", { name: "Mail" }).click();
  await expect.poll(() => listed(page), wait).toEqual(["Kvitto"]);

  for (const key of ["j", "e", "?", "/", "c"]) await page.keyboard.press(key);

  // Long enough for j to have opened the thread at the cursor, had it moved there.
  await page.waitForTimeout(1_000);
  expect(await focused(page)).toBeUndefined();
  expect(await sheet(page).count()).toBe(0);
  expect(await page.evaluate(() => document.activeElement?.getAttribute("type"))).not.toBe("search");
  expect(await heading(page)).toBe("Inbox");
  expect(await listed(page)).toEqual(["Kvitto"]);
  // Nor does Write show a key it doesn't take.
  const write = page.getByRole("button", { name: "Write" });
  expect(await write.getAttribute("aria-keyshortcuts")).toBeNull();
  expect(await write.locator("kbd").count()).toBe(0);
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

test("x picks the thread at the cursor, and ! marks the threads picked as spam", budget, async () => {
  const { page } = await withThreads(["Kvitto", "Lunch", "Resplan"]);
  await page.keyboard.press("j");
  await page.keyboard.press("x");
  await page.keyboard.press("j");
  await page.keyboard.press("x");
  const tools = page.getByRole("toolbar", { name: "Selected threads" });
  await expect.poll(() => tools.innerText(), wait).toContain("2 selected");
  expect(await page.getByRole("checkbox", { name: "Select Resplan" }).isChecked()).toBe(true);
  expect(await page.getByRole("checkbox", { name: "Select Lunch" }).isChecked()).toBe(true);

  await page.keyboard.press("!");

  await expect.poll(() => listed(page), wait).toEqual(["Kvitto"]);
  expect(await said(page)).toContain("Marked 2 threads as spam.");
});

test("z undoes what was just done, as Undo does", budget, async () => {
  const { page } = await withThreads(["Kvitto", "Lunch"]);
  await page.keyboard.press("j");
  await page.keyboard.press("e");
  await expect.poll(() => listed(page), wait).toEqual(["Kvitto"]);

  await page.keyboard.press("z");

  await expect.poll(() => listed(page), wait).toEqual(["Lunch", "Kvitto"]);
  expect(await said(page)).toContain("Undone.");
});

test("Shift+I marks the thread at the cursor read, and Shift+U unread again", budget, async () => {
  const { page } = await withThreads(["Kvitto"]);
  const line = () => page.getByRole("list", { name: "Threads" }).getByRole("link").getAttribute("aria-label");
  expect(await line()).toMatch(/^Unread/);
  await page.keyboard.press("j");

  await page.keyboard.press("Shift+I");

  await expect.poll(line, wait).not.toMatch(/^Unread/);
  expect(await said(page)).toContain("Marked 1 thread read.");
  await page.keyboard.press("Shift+U");
  await expect.poll(line, wait).toMatch(/^Unread/);
  expect(await said(page)).toContain("Marked 1 thread unread.");
});

test("l opens the labels for the thread at the cursor, to label it from the keyboard", budget, async () => {
  const { page, grace } = await withThreads(["Kvitto"]);
  const { data: mailboxes } = await grace.GET("/mailboxes");
  await grace.POST("/mailboxes/{mailbox}/labels", { params: { path: { mailbox: mailboxes!.mailboxes[0]!.id } }, body: { name: "Kvitton" } });
  await page.reload();
  await expect.poll(() => listed(page), wait).toEqual(["Kvitto"]);
  // The list can show before the labels have loaded, and the labels would then open without Kvitton.
  await expect.poll(() => page.getByRole("link", { name: /Kvitton/ }).count(), wait).toBeGreaterThan(0);
  await page.keyboard.press("j");

  await page.keyboard.press("l");

  const picker = page.getByRole("group", { name: "Labels for this thread" });
  await expect.poll(() => picker.getByRole("checkbox", { name: "Kvitton" }).evaluate((box) => box === document.activeElement), wait).toBe(true);
  await page.keyboard.press("Space");
  await expect.poll(() => said(page), wait).toContain("Added Kvitton to 1 thread.");
});

test("g then i, t, d or a goes to the Inbox, Sent, Drafts or All mail, also from a thread, and u goes back to the list", budget, async () => {
  const { page } = await withThreads(["Kvitto"]);
  for (const [key, title] of [
    ["t", "Sent"],
    ["d", "Drafts"],
    ["a", "All mail"],
    ["i", "Inbox"],
  ]) {
    await page.keyboard.press("g");
    await page.keyboard.press(key!);
    await expect.poll(() => heading(page), wait).toBe(title);
  }
  await expect.poll(() => listed(page), wait).toEqual(["Kvitto"]);
  // A key no chord ends does what it does alone, also right after g.
  await page.keyboard.press("g");
  await page.keyboard.press("j");
  expect(await focused(page)).toBe("Kvitto");
  await page.keyboard.press("o");
  await expect.poll(() => heading(page), wait).toBe("Kvitto");

  await page.keyboard.press("u");

  await expect.poll(() => heading(page), wait).toBe("Inbox");
  await page.keyboard.press("j");
  await page.keyboard.press("o");
  await expect.poll(() => heading(page), wait).toBe("Kvitto");
  // In a thread a alone replies to all, and after g it goes to All mail.
  await page.keyboard.press("g");
  await page.keyboard.press("a");
  await expect.poll(() => heading(page), wait).toBe("All mail");
});
