import type { Page } from "playwright-core";
import { expect, test } from "vitest";
import { mailboxes, phone, startWebApp } from "./web-app.ts";

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
const fold = (page: Page) => page.getByRole("list", { name: "Days" }).getByRole("button", { name: "Sep 7 to Oct 5, nothing counted" });

test("a sponsor opens their agent's page from the side column, with a summary for each of the last 30 days, newest first, the quiet ones folded", budget, async () => {
  const { page, signIn } = await withActivity();
  await signIn("ada@example.org");

  await (await mailboxes(page)).getByRole("link", { name: /^Hermes/ }).click();
  await page.getByRole("navigation", { name: "Mail" }).getByRole("link", { name: "Activity" }).click();

  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Hermes's activity");
  await expect.poll(() => days(page).count(), wait).toBe(1);
  expect(await days(page).first().getAttribute("aria-label")).toMatch(/^Tuesday, Oct 6.*: 1 sent, 1 approved, 2 received$/);
  expect(await days(page).first().innerText()).toMatch(/1 sent, 1 approved, 2 received$/);
  expect(await fold(page).getAttribute("aria-expanded")).toBe("false");
  expect(await page.getByRole("navigation", { name: "Mail" }).getByRole("link", { name: "Activity" }).getAttribute("aria-current")).toBe("page");

  await fold(page).click();

  expect(await fold(page).getAttribute("aria-expanded")).toBe("true");
  await expect.poll(() => days(page).count(), wait).toBe(30);
  expect(await days(page).nth(1).getAttribute("aria-label")).toMatch(/^Monday, Oct 5.*: nothing counted$/);
  expect(await days(page).last().getAttribute("aria-label")).toMatch(/^Monday, Sep 7/);

  await fold(page).click();

  await expect.poll(() => days(page).count(), wait).toBe(1);
});

test("from the keyboard, a fold of quiet days opens and its days are the next stops", budget, async () => {
  const { page, signIn } = await withActivity();
  await signIn("ada@example.org");
  await (await mailboxes(page)).getByRole("link", { name: /^Hermes/ }).click();
  await page.getByRole("navigation", { name: "Mail" }).getByRole("link", { name: "Activity" }).click();
  await expect.poll(() => days(page).count(), wait).toBe(1);

  await days(page).first().focus();
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))).toBe("Sep 7 to Oct 5, nothing counted");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");

  expect(await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))).toMatch(/^Monday, Oct 5.*: nothing counted$/);
});

test("a sponsor reaches each agent's page from the Agents sheet", budget, async () => {
  const { page, signIn } = await withActivity();
  await signIn("ada@example.org");

  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: "Your agents" }).click();
  await page.getByRole("region", { name: "Your agents" }).getByRole("heading", { name: "Hermes" }).click();
  await page.getByRole("link", { name: "Hermes's activity" }).click();

  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Hermes's activity");
  await expect.poll(() => days(page).count(), wait).toBe(1);
});

test("opening a day shows its timeline, newest first, each entry linking to its thread", budget, async () => {
  const { page, signIn } = await withActivity();
  await signIn("ada@example.org");
  await (await mailboxes(page)).getByRole("link", { name: /^Hermes/ }).click();
  await page.getByRole("navigation", { name: "Mail" }).getByRole("link", { name: "Activity" }).click();

  await days(page).first().click();

  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toMatch(/^Tuesday, Oct 6/);
  const entries = page.getByRole("list", { name: "Timeline" }).getByRole("listitem");
  await expect.poll(() => entries.count(), wait).toBeGreaterThanOrEqual(5);
  const arrivals = async () => (await entries.allInnerTexts()).filter((text) => text.includes(" wrote to "));
  await expect.poll(arrivals, wait).toEqual([expect.stringMatching(/^08:00 AM\n+Grace Hopper wrote to hermes@example\.com\. Möte$/), expect.stringMatching(/^08:00 AM\n+Grace Hopper wrote to hermes@example\.com\. Kvitto$/)]);
  const texts = await entries.allInnerTexts();
  expect(texts.at(-1)).toMatch(/You added the agent Hermes/);
  expect(texts.some((text) => text.includes("You approved Hermes's send"))).toBe(true);
  expect(texts.some((text) => text.includes("Hermes asked for approval to send"))).toBe(true);
  expect(texts.some((text) => text.includes("Duva sent Hermes's message to Grace Hopper."))).toBe(true);
  // Each entry names who did it, in a heavier hand.
  expect(await page.getByRole("list", { name: "Timeline" }).locator("strong").allInnerTexts()).toEqual(expect.arrayContaining(["Duva", "Hermes", "You", "Grace Hopper"]));
  expect(await page.getByRole("list", { name: "Timeline" }).locator("strong").count()).toBe(await entries.count());
  await expect.poll(() => page.getByRole("list", { name: "Timeline" }).getByRole("link", { name: "Kvitto" }).count(), wait).toBe(1);

  // A thread several entries are about is linked from each, each link naming its entry.
  const meetingLinks = page.getByRole("list", { name: "Timeline" }).getByRole("link", { name: /^Möte\. / });
  expect(await meetingLinks.count()).toBeGreaterThan(1);
  const names = await meetingLinks.evaluateAll((links) => links.map((link) => link.getAttribute("aria-label")));
  expect(new Set(names).size).toBe(names.length);
  expect(names).toContain("Möte. 08:00 AM: Grace Hopper wrote to hermes@example.com.");

  // The subject follows what happened on its line, with no gap between them.
  const arrival = entries.filter({ hasText: "Kvitto" });
  const said = (await arrival.locator(".entry-said").boundingBox())!;
  const subject = (await arrival.getByRole("link").boundingBox())!;
  expect(Math.abs(subject.y + subject.height - (said.y + said.height))).toBeLessThan(8);
  expect(subject.x - (said.x + said.width)).toBeLessThan(16);

  await page.getByRole("list", { name: "Timeline" }).getByRole("link", { name: "Kvitto" }).click();

  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Kvitto");
  await page.goBack();
  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toMatch(/^Tuesday, Oct 6/);
  await page.getByRole("link", { name: "Hermes's activity" }).click();
  await expect.poll(() => days(page).count(), wait).toBe(1);
});

test("on a desk a day's timeline opens beside the days, its day marked as the one open, and a quiet day inside its fold", budget, async () => {
  const { page, signIn } = await withActivity();
  await signIn("ada@example.org");
  await (await mailboxes(page)).getByRole("link", { name: /^Hermes/ }).click();
  await page.getByRole("navigation", { name: "Mail" }).getByRole("link", { name: "Activity" }).click();
  await expect.poll(() => days(page).count(), wait).toBe(1);
  expect(await page.getByRole("heading", { level: 2, name: "No day open" }).isVisible()).toBe(true);

  await days(page).first().click();

  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toMatch(/^Tuesday, Oct 6/);
  const beside = page.getByRole("region", { name: "Hermes's activity" });
  expect(await beside.getByRole("list", { name: "Days" }).isVisible()).toBe(true);
  expect(await days(page).first().getAttribute("aria-current")).toBe("true");
  await expect.poll(() => page.getByRole("main").getByRole("list", { name: "Timeline" }).isVisible(), wait).toBe(true);

  await fold(page).click();
  await days(page).nth(1).click();

  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toMatch(/^Monday, Oct 5/);
  await expect.poll(() => days(page).count(), wait).toBe(30);
  expect(await fold(page).getAttribute("aria-expanded")).toBe("true");
  expect(await days(page).nth(1).getAttribute("aria-current")).toBe("true");
  expect(await days(page).first().getAttribute("aria-current")).toBe(null);
});

test("on a phone a day's timeline takes the screen alone, with the way back to the days", budget, async () => {
  const { page, signIn, agent } = await withActivity({ viewport: phone });
  await signIn("ada@example.org");
  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Inbox");
  await page.evaluate((agent) => (location.hash = `#/agents/${agent}/2026-10-06`), agent.id);

  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toMatch(/^Tuesday, Oct 6/);
  expect(await page.getByRole("list", { name: "Days" }).isVisible()).toBe(false);
  expect(await page.getByRole("link", { name: "Hermes's activity" }).isVisible()).toBe(true);
});

test("a day the agent did nothing says so", budget, async () => {
  const { page, signIn } = await withActivity();
  await signIn("ada@example.org");
  await (await mailboxes(page)).getByRole("link", { name: /^Hermes/ }).click();
  await page.getByRole("navigation", { name: "Mail" }).getByRole("link", { name: "Activity" }).click();

  await fold(page).click();
  await days(page).nth(1).click();

  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toMatch(/^Monday, Oct 5/);
  await expect.poll(() => page.getByText("Nothing happened that day.").isVisible(), wait).toBe(true);
});

test("on a phone, each day and each entry fits the screen", budget, async () => {
  const { page, signIn } = await withActivity({ viewport: phone });
  await signIn("ada@example.org");
  await page.getByRole("button", { name: /Mailboxes and views/ }).click();
  await (await mailboxes(page)).getByRole("link", { name: /^Hermes/ }).click();
  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Hermes's Inbox");
  await page.getByRole("button", { name: /Mailboxes and views/ }).click();
  await page.getByRole("navigation", { name: "Mail" }).getByRole("link", { name: "Activity" }).click();

  await expect.poll(() => days(page).count(), wait).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(phone.width);
  expect(await days(page).first().innerText()).toMatch(/1 sent/);
  expect(await fold(page).innerText()).toMatch(/^Sep 7 to Oct 5\nNothing counted$/);
  await fold(page).click();
  await expect.poll(() => days(page).count(), wait).toBe(30);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(phone.width);

  await days(page).first().click();

  const entries = page.getByRole("list", { name: "Timeline" }).getByRole("listitem");
  await expect.poll(() => entries.count(), wait).toBeGreaterThanOrEqual(5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(phone.width);
  // On a phone the thread takes a line of its own, under what happened.
  const arrival = entries.filter({ hasText: "Kvitto" });
  await expect.poll(() => arrival.getByRole("link", { name: /^Kvitto\. / }).count(), wait).toBe(1);
  const said = (await arrival.locator(".entry-said").boundingBox())!;
  const subject = (await arrival.getByRole("link").boundingBox())!;
  expect(subject.y).toBeGreaterThanOrEqual(said.y + said.height - 1);
});
