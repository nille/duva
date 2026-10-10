import { expect, test } from "vitest";
import { startWebApp } from "./web-app.ts";

// The page reads the change feeds every 250 ms in these tests, but a page under the full suite's
// load can still take seconds to show what changed, so every wait has room, and every test more.
const wait = { timeout: 10_000 };
const budget = { timeout: 60_000 };

const receipt = [
  "From: Shop <orders@shop.example.net>",
  "To: Grace <grace@example.com>",
  "Subject: Your receipt",
  "Date: Sun, 04 Oct 2026 09:00:00 +0200",
  "Message-ID: <receipt-1@shop.example.net>",
  "",
  "You paid 42 euros.",
].join("\r\n");

/**
 * The web app where Grace has the mailbox grace@example.com, its Screener off, with a label
 * Receipts and a receipt in her Inbox, the task runner holding the tasks prompts give if `tasksHeld`.
 */
async function withReceipt({ tasksHeld = false } = {}) {
  const app = await startWebApp({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org"], tasksHeld });
  const ada = app.duva.signIn("ada@example.org");
  const grace = app.duva.signIn("grace@example.org");
  const { data: me } = await grace.GET("/whoami");
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: me!.id, address: "grace@example.com" } });
  const params = { path: { mailbox: mailbox!.id } };
  await grace.PATCH("/mailboxes/{mailbox}/screener", { params, body: { on: false } });
  const { data: receipts } = await grace.POST("/mailboxes/{mailbox}/labels", { params, body: { name: "Receipts" } });
  await app.duva.receive(receipt, { to: ["grace@example.com"] });
  const thread = (await grace.GET("/mailboxes/{mailbox}/threads", { params })).data!.threads[0]!.id;
  await app.signIn("grace@example.org");
  const heading = () => app.page.getByRole("heading", { level: 1 }).textContent();
  await expect.poll(heading, wait).toBe("Inbox");
  const views = app.page.getByRole("navigation", { name: "Mail" });
  return { ...app, grace, params, receipts: receipts!.id, thread, heading, views };
}

test("a human writes a label's prompt in its head, and a thread given the label shows the mailbox agent's task and its note", budget, async () => {
  const { page, grace, params, receipts, thread, heading, views } = await withReceipt();
  await views.getByRole("link", { name: /^Receipts/ }).click();
  await expect.poll(heading, wait).toBe("Receipts");

  await page.getByRole("button", { name: "Add a prompt" }).click();
  await page.getByRole("textbox", { name: "Prompt for Receipts" }).fill("Note the amount.");
  await page.getByRole("button", { name: "Save prompt" }).click();

  await expect.poll(() => page.getByText("Saved. Coo gets each message labelled Receipts from now on.").isVisible(), wait).toBe(true);
  await expect.poll(() => page.getByText(/^Coo gets each message here, with this prompt:/).textContent(), wait).toBe("Coo gets each message here, with this prompt: Note the amount.");
  await grace.POST("/mailboxes/{mailbox}/threads/labels", { params, body: { threads: [thread], add: [receipts] } });
  await page.getByRole("link", { name: /^Unread, Shop, Your receipt/ }).click();
  const tasks = page.getByRole("region", { name: "Tasks" });
  await expect.poll(() => tasks.getByRole("listitem").first().textContent(), wait).toMatch(/^Coofrom ReceiptsDone.*Stand-in answer\.$/);
});

test("a thread open while the mailbox agent works on its task shows how the task goes, without reloading", budget, async () => {
  const { page, grace, params, receipts, thread, duva } = await withReceipt({ tasksHeld: true });
  await grace.PUT("/mailboxes/{mailbox}/labels/{label}/prompt", { params: { path: { ...params.path, label: receipts } }, body: { prompt: "Note the amount." } });
  await grace.POST("/mailboxes/{mailbox}/threads/labels", { params, body: { threads: [thread], add: [receipts] } });
  // Read already, so opening it changes nothing, and what the agent does comes last.
  await grace.POST("/mailboxes/{mailbox}/threads/read", { params, body: { threads: [thread] } });
  await page.getByRole("link", { name: /^Shop, Your receipt/ }).click();
  const task = page.getByRole("region", { name: "Tasks" }).getByRole("listitem").first();
  await expect.poll(() => task.textContent(), wait).toMatch(/^Coofrom ReceiptsWaiting/);

  await duva.releaseTasks();

  await expect.poll(() => task.textContent(), wait).toMatch(/^Coofrom ReceiptsDone.*Stand-in answer\.$/);
});

test("a label's prompt written elsewhere, as with the CLI, shows in the label's head without reloading, and so does removing it", budget, async () => {
  const { page, grace, params, receipts, heading, views } = await withReceipt();
  await views.getByRole("link", { name: /^Receipts/ }).click();
  await expect.poll(heading, wait).toBe("Receipts");
  const path = { ...params.path, label: receipts };

  await grace.PUT("/mailboxes/{mailbox}/labels/{label}/prompt", { params: { path }, body: { prompt: "Note the amount." } });
  await expect.poll(() => page.getByText(/^Coo gets each message here, with this prompt:/).textContent(), wait).toBe("Coo gets each message here, with this prompt: Note the amount.");
  await grace.DELETE("/mailboxes/{mailbox}/labels/{label}/prompt", { params: { path } });
  await expect.poll(() => page.getByRole("button", { name: "Add a prompt" }).isVisible(), wait).toBe(true);
});

test("a human edits and removes a label's prompt, and the Feed takes one while the Inbox doesn't", budget, async () => {
  const { page, heading, views } = await withReceipt();
  expect(await page.getByRole("button", { name: "Add a prompt" }).count()).toBe(0);
  await views.getByRole("link", { name: /^Feed/ }).click();
  await expect.poll(heading, wait).toBe("Feed");

  await page.getByRole("button", { name: "Add a prompt" }).click();
  await page.getByRole("textbox", { name: "Prompt for Feed" }).fill("Summarize it.");
  await page.getByRole("button", { name: "Save prompt" }).click();
  const shown = () => page.getByText(/^Coo gets each message here, with this prompt:/).textContent();
  await expect.poll(shown, wait).toBe("Coo gets each message here, with this prompt: Summarize it.");
  await page.getByRole("button", { name: "Edit prompt" }).click();
  await page.getByRole("textbox", { name: "Prompt for Feed" }).fill("Summarize it in a line.");
  await page.getByRole("button", { name: "Save prompt" }).click();
  await expect.poll(shown, wait).toBe("Coo gets each message here, with this prompt: Summarize it in a line.");
  await page.getByRole("button", { name: "Edit prompt" }).click();
  await page.getByRole("button", { name: "Remove prompt" }).click();

  await expect.poll(() => page.getByRole("button", { name: "Add a prompt" }).isVisible(), wait).toBe(true);
  expect(await page.getByText(/^Coo gets each message here/).count()).toBe(0);
});
