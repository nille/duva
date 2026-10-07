import { expect, test } from "vitest";
import { startWebApp } from "./web-app.ts";

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
    "",
    "Hej Grace.",
  ].join("\r\n");

/** The web app for Grace, with her mailbox at grace@example.com and a thread for each subject. Her session outlasts the days the clock moves. */
async function withThreads(subjects: string[], { timeZone }: { timeZone?: string } = {}) {
  const app = await startWebApp({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org"], accessTokenLifetime: 30 * 86_400 });
  const ada = app.duva.signIn("ada@example.org");
  const grace = app.duva.signIn("grace@example.org");
  const { data: me } = await grace.GET("/whoami");
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: me!.id, address: "grace@example.com" } });
  const params = { path: { mailbox: mailbox!.id } };
  await grace.PATCH("/mailboxes/{mailbox}/screener", { params, body: { on: false } });
  for (const subject of subjects) await app.duva.receive(note(subject), { to: ["grace@example.com"] });
  if (timeZone !== undefined) await grace.PATCH("/preferences", { body: { timeZone } });
  await app.signIn("grace@example.org");
  const { page } = app;
  const views = page.getByRole("navigation", { name: "Mail" });
  const listed = async () => page.getByRole("list", { name: "Threads" }).getByRole("link").evaluateAll((links) => links.map((link) => link.querySelector(".thread-subject")?.textContent ?? ""));
  const heading = () => page.getByRole("heading", { level: 1 }).textContent();
  const open = async (view: string) => {
    await views.getByRole("link", { name: new RegExp(`^${view}`) }).click();
    await expect.poll(heading, wait).toBe(view);
  };
  /** When the thread with the subject comes back, as Duva says. */
  const reminderOf = async (subject: string) => {
    const { data } = await grace.GET("/mailboxes/{mailbox}/reminders", { params });
    return data!.threads.find((thread) => thread.subject === subject)?.reminder?.at;
  };
  await expect.poll(listed, wait).toHaveLength(subjects.length);
  return { ...app, views, listed, heading, open, reminderOf };
}

test("b sets the threads picked aside for tomorrow morning, Remind me lists them with the time, and at that time they come back to the top of the Inbox marked Back", budget, async () => {
  const { page, duva, listed, open, reminderOf } = await withThreads(["Kvitto", "Lunch"]);

  await page.getByRole("checkbox", { name: "Select Kvitto" }).check();
  await page.keyboard.press("b");
  const picker = page.getByRole("group", { name: "Remind me about this thread" });
  await picker.getByRole("button", { name: /^Tomorrow morning/ }).click();

  await expect.poll(listed, wait).toEqual(["Lunch"]);
  expect(await page.getByText(/^Set 1 thread aside until /).isVisible()).toBe(true);
  const at = await reminderOf("Kvitto");
  // The browser's clock, which the presets count on, may be in another time zone than the test's.
  expect(await page.evaluate((at) => new Date(at).getHours(), at!)).toBe(8);

  await open("Remind me");
  await expect.poll(listed, wait).toEqual(["Kvitto"]);
  expect(await page.getByRole("link", { name: /Kvitto.*, back / }).isVisible()).toBe(true);

  await duva.clock(new Date(at!));
  await open("Inbox");

  await expect.poll(listed, wait).toEqual(["Kvitto", "Lunch"]);
  const row = page.getByRole("link", { name: /^Unread, Ada Lovelace, Kvitto, back from Remind me, set aside / });
  await expect.poll(() => row.isVisible(), wait).toBe(true);
  expect(await row.locator(".thread-back-mark").textContent()).toBe("Back");
});

test("a thread is set aside until a time of the human's own on their time zone's clock from its tools, and cancelling its reminder from Remind me puts it back in the Inbox", budget, async () => {
  const { page, listed, open, reminderOf } = await withThreads(["Kvitto"], { timeZone: "America/New_York" });
  await page.getByRole("link", { name: /Kvitto/ }).click();
  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Kvitto");

  await page.getByRole("toolbar", { name: "Thread actions" }).getByRole("button", { name: "Remind me" }).click();
  const picker = page.getByRole("group", { name: "Remind me about this thread" });
  await picker.getByLabel("Another time").fill("2031-03-04T09:30");
  await picker.getByRole("button", { name: "Set" }).click();

  // New York keeps standard time, five hours behind UTC, until 9 March 2031.
  await expect.poll(() => reminderOf("Kvitto"), wait).toBe("2031-03-04T14:30:00.000Z");
  await open("Remind me");
  await expect.poll(listed, wait).toEqual(["Kvitto"]);

  await page.getByRole("checkbox", { name: "Select Kvitto" }).check();
  await page.getByRole("toolbar", { name: "Selected threads" }).getByRole("button", { name: "Remind me" }).click();
  await page.getByRole("button", { name: "Cancel reminder" }).click();

  await expect.poll(listed, wait).toEqual([]);
  expect(await page.getByText("Nothing set aside").isVisible()).toBe(true);
  await open("Inbox");
  await expect.poll(listed, wait).toEqual(["Kvitto"]);
});

test("a time less than a minute away is refused in the picker, which says what to choose", budget, async () => {
  const { page } = await withThreads(["Kvitto"]);
  await page.getByRole("checkbox", { name: "Select Kvitto" }).check();
  await page.getByRole("toolbar", { name: "Selected threads" }).getByRole("button", { name: "Remind me" }).click();
  const picker = page.getByRole("group", { name: "Remind me about this thread" });

  await picker.getByLabel("Another time").fill("2020-01-01T08:00");
  await picker.getByRole("button", { name: "Set" }).click();

  expect(await picker.getByRole("alert").textContent()).toBe("Choose a time at least a minute from now.");
});
