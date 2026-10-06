import type { Page } from "playwright-core";
import { expect, test } from "vitest";
import { phone, startWebApp } from "./web-app.ts";

// The page reads the change feeds every 250 ms in these tests, but a page under the full suite's
// load can still take seconds to show what changed, so every wait has room, and every test more.
const wait = { timeout: 10_000 };
const budget = { timeout: 60_000 };

/** A message from Grace that starts its own thread. */
const note = (to: string, subject: string) =>
  [
    "From: Grace Hopper <grace@example.org>",
    `To: ${to}`,
    `Subject: ${subject}`,
    "Date: Tue, 06 Oct 2026 09:00:00 +0200",
    `Message-ID: <${subject.replaceAll(" ", "-")}@example.org>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    "Hej.",
  ].join("\r\n");

/**
 * The web app for a deployment where Ada, the admin, has a personal mailbox at ada@example.com
 * and sponsors the agent Hermes, which owns hermes@example.com. Two messages reached Hermes on
 * Tuesday 6 October, and it answered one, which Ada approved, all in the browser's time zone, UTC.
 */
async function withActivity(options: Parameters<typeof startWebApp>[0] = {}) {
  const app = await startWebApp({ domain: "example.com", admin: "ada@example.org", ...options });
  const { duva } = app;
  await duva.clock(new Date("2026-10-06T08:00:00Z"));
  const ada = duva.signIn("ada@example.org");
  const { data: me } = await ada.GET("/whoami");
  const { data: adaMailbox } = await ada.POST("/mailboxes", { body: { owner: me!.id, address: "ada@example.com" } });
  await ada.PATCH("/mailboxes/{mailbox}/screener", { params: { path: { mailbox: adaMailbox!.id } }, body: { on: false } });
  const { data: created } = await ada.POST("/agents", { body: { name: "Hermes" } });
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: created!.agent.id, address: "hermes@example.com" } });
  const hermes = duva.withKey(created!.key);
  const params = { path: { mailbox: mailbox!.id } };
  await duva.receive(note("hermes@example.com", "Kvitto"), { to: ["hermes@example.com"] });
  await duva.receive(note("hermes@example.com", "Möte"), { to: ["hermes@example.com"] });
  const { data: threads } = await hermes.GET("/mailboxes/{mailbox}/threads", { params });
  const meeting = threads!.threads.find((thread) => thread.subject === "Möte")!;
  const { data: read } = await hermes.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { ...params.path, thread: meeting.id } } });
  await duva.clock(new Date("2026-10-06T09:30:00Z"));
  const { data: draft } = await hermes.POST("/mailboxes/{mailbox}/drafts", { params, body: { answers: read!.messages[0]!.id, text: "Måndag går bra." } });
  const { data: asked } = await hermes.POST("/mailboxes/{mailbox}/drafts/{draft}/send", { params: { path: { ...params.path, draft: draft!.id } } });
  // Ada's session from before the clock moved has ended, so she signs in again.
  await duva.signIn("ada@example.org").POST("/approvals/{approval}/send", { params: { path: { approval: asked!.send!.approval! } } });
  return { ...app, hermes, agent: created!.agent };
}

const days = (page: Page) => page.getByRole("list", { name: "Days" }).getByRole("link");

test("a sponsor opens their agent's page from the side column, with a summary for each of the last 30 days, newest first", budget, async () => {
  const { page, signIn } = await withActivity();
  await signIn("ada@example.org");

  await page.getByRole("navigation", { name: "Mailboxes" }).getByRole("link", { name: /^Hermes/ }).click();
  await page.getByRole("navigation", { name: "Mail" }).getByRole("link", { name: "Activity" }).click();

  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Hermes's activity");
  await expect.poll(() => days(page).count(), wait).toBe(30);
  expect(await days(page).first().getAttribute("aria-label")).toMatch(/^Tuesday, Oct 6.*: 1 sent, 1 approved, 2 received$/);
  expect(await days(page).nth(1).getAttribute("aria-label")).toMatch(/^Monday, Oct 5.*: nothing counted$/);
  expect(await days(page).last().getAttribute("aria-label")).toMatch(/^Monday, Sep 7/);
  expect(await page.getByRole("navigation", { name: "Mail" }).getByRole("link", { name: "Activity" }).getAttribute("aria-current")).toBe("page");
});

test("a sponsor reaches each agent's page from the Agents sheet", budget, async () => {
  const { page, signIn } = await withActivity();
  await signIn("ada@example.org");

  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: "Your agents" }).click();
  await page.getByRole("region", { name: "Your agents" }).getByRole("heading", { name: "Hermes" }).click();
  await page.getByRole("link", { name: "Hermes's activity" }).click();

  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Hermes's activity");
  await expect.poll(() => days(page).count(), wait).toBe(30);
});

test("opening a day shows its timeline, newest first, each entry linking to its thread", budget, async () => {
  const { page, signIn } = await withActivity();
  await signIn("ada@example.org");
  await page.getByRole("navigation", { name: "Mailboxes" }).getByRole("link", { name: /^Hermes/ }).click();
  await page.getByRole("navigation", { name: "Mail" }).getByRole("link", { name: "Activity" }).click();

  await days(page).first().click();

  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toMatch(/^Tuesday, Oct 6/);
  const entries = page.getByRole("list", { name: "Timeline" }).getByRole("listitem");
  await expect.poll(() => entries.count(), wait).toBeGreaterThanOrEqual(5);
  const arrivals = async () => (await entries.allInnerTexts()).filter((text) => text.includes("A message arrived"));
  await expect.poll(arrivals, wait).toEqual([expect.stringMatching(/^08:00 AM\nA message arrived\.\nMöte$/), expect.stringMatching(/^08:00 AM\nA message arrived\.\nKvitto$/)]);
  const texts = await entries.allInnerTexts();
  expect(texts.at(-1)).toMatch(/You added the agent Hermes/);
  expect(texts.some((text) => text.includes("You approved Hermes's send"))).toBe(true);
  expect(texts.some((text) => text.includes("Hermes asked for approval to send"))).toBe(true);
  await expect.poll(() => page.getByRole("list", { name: "Timeline" }).getByRole("link", { name: "Kvitto" }).count(), wait).toBe(1);

  await page.getByRole("list", { name: "Timeline" }).getByRole("link", { name: "Kvitto" }).click();

  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Kvitto");
  await page.goBack();
  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toMatch(/^Tuesday, Oct 6/);
  await page.getByRole("link", { name: "Hermes's activity" }).click();
  await expect.poll(() => days(page).count(), wait).toBe(30);
});

test("a day the agent did nothing says so", budget, async () => {
  const { page, signIn } = await withActivity();
  await signIn("ada@example.org");
  await page.getByRole("navigation", { name: "Mailboxes" }).getByRole("link", { name: /^Hermes/ }).click();
  await page.getByRole("navigation", { name: "Mail" }).getByRole("link", { name: "Activity" }).click();

  await days(page).nth(1).click();

  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toMatch(/^Monday, Oct 5/);
  await expect.poll(() => page.getByText("Nothing happened that day.").isVisible(), wait).toBe(true);
});

test("on a phone, each day and each entry fits the screen", budget, async () => {
  const { page, signIn } = await withActivity({ viewport: phone });
  await signIn("ada@example.org");
  await page.getByRole("navigation", { name: "Mailboxes" }).getByRole("link", { name: /^Hermes/ }).click();
  await page.getByRole("navigation", { name: "Mail" }).getByRole("link", { name: "Activity" }).click();

  await expect.poll(() => days(page).count(), wait).toBe(30);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(phone.width);
  expect(await days(page).first().innerText()).toMatch(/1 sent/);

  await days(page).first().click();

  await expect.poll(() => page.getByRole("list", { name: "Timeline" }).getByRole("listitem").count(), wait).toBeGreaterThanOrEqual(5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(phone.width);
});
