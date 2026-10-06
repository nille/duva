import { expect, test } from "vitest";
import { phone, startWebApp } from "./web-app.ts";

// As in inbox.test.ts, every wait has room for a page under the full suite's load.
const wait = { timeout: 10_000 };
const budget = { timeout: 60_000 };

/** A customer's question to the address, which starts a thread. */
const question = (to: string, subject = "Broken invoice") =>
  [
    "From: Customer <customer@example.net>",
    `To: ${to}`,
    `Subject: ${subject}`,
    "Date: Sun, 04 Oct 2026 09:00:00 +0200",
    `Message-ID: <${subject.replaceAll(" ", "-")}@example.net>`,
    "",
    "My invoice is wrong.",
  ].join("\r\n");

/**
 * The web app for a deployment on example.com where the humans Grace and Linus have mailboxes at
 * grace@example.com and linus@example.com, and both are members of the group support@example.com,
 * which the customer has written to.
 */
async function withSupport(options: Parameters<typeof startWebApp>[0] = {}) {
  const app = await startWebApp({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org", "linus@example.org"], ...options });
  const ada = app.duva.signIn("ada@example.org");
  const grace = app.duva.signIn("grace@example.org");
  const { data: graceActor } = await grace.GET("/whoami");
  const { data: linusActor } = await app.duva.signIn("linus@example.org").GET("/whoami");
  const { data: graces } = await ada.POST("/mailboxes", { body: { owner: graceActor!.id, address: "grace@example.com" } });
  await ada.POST("/mailboxes", { body: { owner: linusActor!.id, address: "linus@example.com" } });
  await ada.POST("/groups", { body: { address: "support@example.com", members: ["grace@example.com", "linus@example.com"] } });
  await app.duva.receive(question("support@example.com"), { to: ["support@example.com"] });
  return { ...app, grace, graces: { path: { mailbox: graces!.id } } };
}

test("group mail in the Inbox is marked with its group, and mail to the member alone isn't", budget, async () => {
  const { page, signIn, duva, grace, graces } = await withSupport();
  await grace.PATCH("/mailboxes/{mailbox}/screener", { params: graces, body: { on: false } });
  await duva.receive(question("grace@example.com", "Just for Grace"), { to: ["grace@example.com"] });

  await signIn("grace@example.org");

  const rows = page.getByRole("list", { name: "Threads" }).getByRole("listitem");
  await expect.poll(() => rows.count(), wait).toBe(2);
  const toGrace = rows.filter({ hasText: "Just for Grace" });
  const toSupport = rows.filter({ hasText: "Broken invoice" });
  expect(await toSupport.locator(".group-mark").allTextContents()).toEqual(["support@example.com"]);
  expect(await toSupport.getByRole("link").getAttribute("aria-label")).toContain("to the group support@example.com");
  expect(await toGrace.locator(".group-mark").count()).toBe(0);
});

test("a member replies as the group, choosing it in From, and the thread shows the reply went as the group", budget, async () => {
  const { page, signIn, duva } = await withSupport();
  await signIn("grace@example.org");
  await page.getByRole("list", { name: "Threads" }).getByRole("link").first().click();

  expect(await page.getByRole("article").first().innerText()).toContain("Sent to the group support@example.com.");
  await page.getByRole("button", { name: "Reply", exact: true }).click();

  const from = page.getByRole("combobox", { name: "From" });
  await expect.poll(() => from.inputValue(), wait).toBe("grace@example.com");
  expect(await from.locator("option").allTextContents()).toEqual(["grace@example.com", "support@example.com"]);
  await from.selectOption("support@example.com");
  await expect.poll(() => page.getByText("Sent as the group. Its other members in the organization get a copy, so they see it was answered.").count(), wait).toBe(1);
  await page.getByLabel("Message", { exact: true }).fill("We'll fix it today.");
  await page.getByRole("button", { name: "Send" }).click();

  await expect.poll(() => page.getByRole("status").filter({ hasText: "Sent" }).count(), wait).toBeGreaterThan(0);
  expect(duva.sent().at(-1)).toContain("From: support@example.com");
  await page.getByRole("link", { name: "Open the thread" }).click();
  await expect.poll(() => page.getByRole("article").count(), wait).toBe(2);
  expect(await page.getByRole("article").nth(1).locator(".letter-sent-mark").textContent()).toBe("You sent this as support@example.com");
});

test("the other member's copy of a reply sent as the group names who sent it", budget, async () => {
  const { page, signIn, grace, graces } = await withSupport();
  const { data: threads } = await grace.GET("/mailboxes/{mailbox}/threads", { params: { ...graces, query: { label: "inbox" } } });
  const { data: thread } = await grace.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { ...graces.path, thread: threads!.threads[0]!.id } } });
  const { data: draft } = await grace.POST("/mailboxes/{mailbox}/drafts", { params: graces, body: { answers: thread!.messages[0]!.id, from: "support@example.com", text: "We'll fix it today." } });
  await grace.POST("/mailboxes/{mailbox}/drafts/{draft}/send", { params: { path: { ...graces.path, draft: draft!.id } } });

  await signIn("linus@example.org");
  await page.getByRole("list", { name: "Threads" }).getByRole("link").first().click();

  await expect.poll(() => page.getByRole("article").count(), wait).toBe(2);
  expect(await page.getByRole("article").nth(1).locator(".letter-sent-mark").textContent()).toBe("Sent by grace@example.org as support@example.com");
});

test("a human in no group writes from their own address, shown as text", budget, async () => {
  const { page, signIn, duva } = await withSupport();
  const ada = duva.signIn("ada@example.org");
  const { data: me } = await ada.GET("/whoami");
  await ada.POST("/mailboxes", { body: { owner: me!.id, address: "ada@example.com" } });
  await signIn("ada@example.org");

  await page.getByRole("button", { name: "Write" }).click();

  await expect.poll(() => page.locator(".compose-from").textContent(), wait).toBe("ada@example.com");
  expect(await page.getByRole("combobox", { name: "From" }).count()).toBe(0);
});

test("on a phone, choosing a group in From fits the screen", budget, async () => {
  const { page, signIn } = await withSupport({ viewport: phone });
  await signIn("grace@example.org");

  await page.getByRole("button", { name: "Write" }).click();
  const from = page.getByRole("combobox", { name: "From" });
  await expect.poll(() => from.count(), wait).toBe(1);
  await from.selectOption("support@example.com");

  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(phone.width);
});
