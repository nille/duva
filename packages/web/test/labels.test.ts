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
    "Hej Grace.",
  ].join("\r\n");

/** The web app for a deployment where the human Grace has a personal mailbox at grace@example.com, with a thread for each subject. */
async function withThreads(subjects: string[], options: Parameters<typeof startWebApp>[0] = {}) {
  const app = await startWebApp({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org"], ...options });
  const ada = app.duva.signIn("ada@example.org");
  const { data: grace } = await app.duva.signIn("grace@example.org").GET("/whoami");
  const { data: graceMailbox } = await ada.POST("/mailboxes", { body: { owner: grace!.id, address: "grace@example.com" } });
  // Mail from first-time senders would wait in the Screener, which these tests leave out.
  await app.duva.signIn("grace@example.org").PATCH("/mailboxes/{mailbox}/screener", { params: { path: { mailbox: graceMailbox!.id } }, body: { on: false } });
  for (const subject of subjects) await app.duva.receive(note(subject), { to: ["grace@example.com"] });
  await app.signIn("grace@example.org");
  const { page } = app;
  const views = page.getByRole("navigation", { name: "Mail" });
  /** The subjects the open view lists, newest first. */
  const listed = async () => {
    const rows = page.getByRole("list", { name: "Threads" }).getByRole("link");
    return (await rows.evaluateAll((links) => links.map((link) => link.querySelector(".thread-subject")?.textContent ?? "")));
  };
  const heading = () => page.getByRole("heading", { level: 1 }).textContent();
  const open = async (view: string) => {
    await views.getByRole("link", { name: new RegExp(`^${view}`) }).click();
    await expect.poll(heading, wait).toBe(view);
  };
  await expect.poll(heading, wait).toBe("Inbox");
  await expect.poll(listed, wait).toHaveLength(subjects.length);
  return { ...app, views, listed, heading, open };
}

test("archiving a thread from the Inbox keeps it in All mail, and Undo brings it back", budget, async () => {
  const { page, listed, open } = await withThreads(["Kvitto", "Lunch"]);

  await page.getByRole("checkbox", { name: "Select Kvitto" }).check();
  await page.getByRole("toolbar", { name: "Selected threads" }).getByRole("button", { name: "Archive" }).click();

  await expect.poll(listed, wait).toEqual(["Lunch"]);
  expect(await page.getByText("Archived 1 thread.").isVisible()).toBe(true);

  await page.getByRole("button", { name: "Undo" }).click();

  await expect.poll(listed, wait).toEqual(["Lunch", "Kvitto"]);
  await page.getByRole("checkbox", { name: "Select Kvitto" }).check();
  await page.getByRole("button", { name: "Archive" }).click();
  await expect.poll(listed, wait).toEqual(["Lunch"]);
  await open("All mail");
  await expect.poll(listed, wait).toEqual(["Lunch", "Kvitto"]);
});

test("several threads picked at once move to Trash, and are restored to the Inbox from there", budget, async () => {
  const { page, listed, open } = await withThreads(["Ett", "Två", "Tre"]);

  await page.getByRole("checkbox", { name: "Select Ett" }).check();
  await page.getByRole("checkbox", { name: "Select Tre" }).check();
  expect(await page.getByText("2 selected").isVisible()).toBe(true);
  await page.getByRole("button", { name: "Move to Trash" }).click();

  await expect.poll(listed, wait).toEqual(["Två"]);
  expect(await page.getByText("Moved 2 threads to Trash.").isVisible()).toBe(true);

  await open("Trash");
  await expect.poll(listed, wait).toEqual(["Tre", "Ett"]);
  await page.getByRole("checkbox", { name: "Select the threads shown" }).check();
  await page.getByRole("button", { name: "Restore" }).click();

  await expect.poll(listed, wait).toEqual([]);
  expect(await page.getByText("Trash is empty").isVisible()).toBe(true);
  await open("Inbox");
  await expect.poll(listed, wait).toEqual(["Tre", "Två", "Ett"]);
});

test("a thread marked as spam from its own view leaves the Inbox, and Not spam brings it back", budget, async () => {
  const { page, listed, open, heading } = await withThreads(["Erbjudande", "Lunch"]);
  await page.getByRole("link", { name: /Erbjudande/ }).click();
  await expect.poll(heading, wait).toBe("Erbjudande");

  await page.getByRole("toolbar", { name: "Thread actions" }).getByRole("button", { name: "Mark as spam" }).click();

  await expect.poll(heading, wait).toBe("Inbox");
  await expect.poll(listed, wait).toEqual(["Lunch"]);
  expect(await page.getByText("Marked 1 thread as spam.").isVisible()).toBe(true);

  await open("Spam");
  await expect.poll(listed, wait).toEqual(["Erbjudande"]);
  await page.getByRole("link", { name: /Erbjudande/ }).click();
  await page.getByRole("button", { name: "Not spam" }).click();

  await expect.poll(heading, wait).toBe("Spam");
  await expect.poll(listed, wait).toEqual([]);
  await open("Inbox");
  await expect.poll(listed, wait).toEqual(["Lunch", "Erbjudande"]);
});

test("a human creates a label, adds it to threads, and finds them under it with their unread count", budget, async () => {
  const { page, views, listed, open } = await withThreads(["Kvitto ett", "Lunch", "Kvitto två"]);

  await views.getByRole("button", { name: "New label" }).click();
  await views.getByRole("textbox", { name: "New label" }).fill("Kvitton");
  await views.getByRole("button", { name: "Create" }).click();
  await expect.poll(() => views.getByRole("link", { name: /^Kvitton/ }).count(), wait).toBe(1);

  await page.getByRole("checkbox", { name: "Select Kvitto ett" }).check();
  await page.getByRole("checkbox", { name: "Select Kvitto två" }).check();
  await page.getByRole("button", { name: "Labels" }).click();
  await page.getByRole("group", { name: "Labels for 2 threads" }).getByRole("checkbox", { name: "Kvitton" }).check();

  await expect.poll(() => page.getByText("Added Kvitton to 2 threads.").isVisible(), wait).toBe(true);
  await expect.poll(() => views.getByRole("link", { name: /^Kvitton/ }).innerText(), wait).toMatch(/Kvitton\s*2/);
  await open("Kvitton");
  await expect.poll(listed, wait).toEqual(["Kvitto två", "Kvitto ett"]);
});

test("a label is added from a thread's own view, made there if it's new", budget, async () => {
  const { page, heading, views } = await withThreads(["Resa till Köpenhamn"]);
  await page.getByRole("link", { name: /Resa till Köpenhamn/ }).click();
  await expect.poll(heading, wait).toBe("Resa till Köpenhamn");

  await page.getByRole("button", { name: "Labels" }).click();
  await page.getByRole("textbox", { name: "New label" }).fill("Resor");
  await page.getByRole("button", { name: "Create and add" }).click();

  await expect.poll(() => page.getByRole("list", { name: "Labels", exact: true }).innerText(), wait).toBe("Resor");
  await expect.poll(() => views.getByRole("link", { name: /^Resor/ }).count(), wait).toBe(1);
});

test("a human renames a label and deletes it, and its threads stay", budget, async () => {
  const { page, views, listed, open, duva } = await withThreads(["Kvitto"]);
  const grace = duva.signIn("grace@example.org");
  const { data: mailboxes } = await grace.GET("/mailboxes");
  const params = { path: { mailbox: mailboxes!.mailboxes[0]!.id } };
  const { data: label } = await grace.POST("/mailboxes/{mailbox}/labels", { params, body: { name: "Kvitton" } });
  const [thread] = (await grace.GET("/mailboxes/{mailbox}/threads", { params })).data!.threads;
  await grace.POST("/mailboxes/{mailbox}/threads/labels", { params, body: { threads: [thread!.id], add: [label!.id] } });
  await expect.poll(() => views.getByRole("link", { name: /^Kvitton/ }).count(), wait).toBe(1);
  await open("Kvitton");

  await page.getByRole("button", { name: "Rename" }).click();
  await page.getByRole("textbox", { name: "Rename Kvitton" }).fill("Ekonomi");
  await page.getByRole("button", { name: "Save" }).click();

  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Ekonomi");
  await expect.poll(() => views.getByRole("link", { name: /^Ekonomi/ }).count(), wait).toBe(1);

  await page.getByRole("button", { name: "Delete label" }).click();
  expect(await page.getByText("Delete Ekonomi? Its threads stay, without the label.").isVisible()).toBe(true);
  await page.getByRole("group", { name: "Delete label" }).getByRole("button", { name: "Delete label" }).click();

  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Inbox");
  await expect.poll(() => views.getByRole("link", { name: /^Ekonomi/ }).count(), wait).toBe(0);
  await expect.poll(listed, wait).toEqual(["Kvitto"]);
});

test("a label's name that is taken is refused with words the human can act on", budget, async () => {
  const { views } = await withThreads([]);

  await views.getByRole("button", { name: "New label" }).click();
  await views.getByRole("textbox", { name: "New label" }).fill("Trash");
  await views.getByRole("button", { name: "Create" }).click();

  await expect.poll(() => views.getByRole("alert").innerText(), wait).toBe("You have a label named Trash already, or it's a built-in name. Pick another.");
});

test("on a phone the views open from one switcher above the threads, and organizing fits the screen", budget, async () => {
  const { page, views, listed } = await withThreads(["Kvitto", "Lunch"], { viewport: phone });

  // One switcher opens the views, which lie in lines, as on a desk.
  await page.getByRole("button", { name: /Mailboxes and views/ }).click();
  expect(await views.getByRole("link", { name: /^Inbox/ }).isVisible()).toBe(true);
  // Closed again, it leaves the threads to organize.
  await page.getByRole("button", { name: /Mailboxes and views/ }).click();
  await page.getByRole("checkbox", { name: "Select Kvitto" }).check();
  await page.getByRole("button", { name: "Labels" }).click();
  expect(await page.getByRole("textbox", { name: "New label" }).last().isVisible()).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(phone.width);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Move to Trash" }).click();

  await expect.poll(listed, wait).toEqual(["Lunch"]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(phone.width);
});

test("the side column holds every view of the mail, Remind me, Sent and Drafts beside the labels, and the bar names the mail as a whole, beside Settings", budget, async () => {
  const { page, views, open } = await withThreads(["Kvitto"]);

  const names = () => views.getByRole("link").evaluateAll((links) => links.map((link) => link.querySelector(".view-name")?.textContent));
  await expect.poll(names, wait).toEqual(["Inbox", "Remind me", "Feed", "Paper Trail", "Sent", "Drafts", "All mail", "Spam", "Trash", "Ask your agent"]);
  // She sponsors her mailbox's mailbox agent, so Approvals and Alerts are hers too.
  expect(await page.getByRole("navigation", { name: "Duva" }).getByRole("link").allInnerTexts()).toEqual(["Mail", "Approvals", "Alerts", "Settings"]);

  await open("Sent");
  await expect.poll(() => page.getByText("Nothing sent yet").isVisible(), wait).toBe(true);
  await views.getByRole("link", { name: "Drafts" }).click();
  await expect.poll(() => views.getByRole("link", { name: "Drafts" }).getAttribute("aria-current"), wait).toBe("page");
});
