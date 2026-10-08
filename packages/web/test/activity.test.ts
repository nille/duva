import type { Page } from "playwright-core";
import { expect, test } from "vitest";
import type { DuvaOptions } from "@duva/api/harness";
import { phone, startWebApp } from "./web-app.ts";

type Model = NonNullable<DuvaOptions["model"]>;
type Request = Parameters<Model>[0];
type Event = ReturnType<Model> extends AsyncIterable<infer Each> ? Each : never;

/** A stand-in for Claude that takes one step of the script per model call, each from what it was asked. Past the end it answers "Done.". */
function scripted(...steps: ((request: Request) => Event[])[]): Model {
  let step = 0;
  return async function* (request) {
    for (const event of steps[step++]?.(request) ?? [{ text: "Done." }]) yield event;
    yield { usage: { inputTokens: 1000, outputTokens: 100 } };
  };
}

const use = (name: string, input: Record<string, unknown> = {}): Event => ({ toolUse: { toolUseId: `${name}-${Math.random()}`, name, input } });

/** What the last tool the model used answered, as JSON. */
const lastResult = (request: Request) => {
  for (const block of request.messages.at(-1)!.content.toReversed()) if ("toolResult" in block) return JSON.parse(block.toolResult.content[0]!.text) as Record<string, any>;
  throw new Error("No tool answered.");
};

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
 * and sponsors the agent Hermes, which has send access to it. Two messages reached Ada on Tuesday
 * 6 October, and Hermes archived one and answered the other as her, which she approved, all in the
 * browser's time zone, UTC.
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
  await ada.PATCH("/agents/{agent}/settings", { params: { path: { agent: created!.agent.id } }, body: { sponsorAccess: "send" } });
  const hermes = duva.withKey(created!.key);
  const params = { path: { mailbox: adaMailbox!.id } };
  await duva.receive(note("ada@example.com", "Kvitto"), { to: ["ada@example.com"] });
  await duva.receive(note("ada@example.com", "Möte"), { to: ["ada@example.com"] });
  const { data: threads } = await hermes.GET("/mailboxes/{mailbox}/threads", { params });
  const meeting = threads!.threads.find((thread) => thread.subject === "Möte")!;
  const receipt = threads!.threads.find((thread) => thread.subject === "Kvitto")!;
  const { data: read } = await hermes.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { ...params.path, thread: meeting.id } } });
  await duva.clock(new Date("2026-10-06T09:30:00Z"));
  await hermes.POST("/mailboxes/{mailbox}/threads/labels", { params, body: { threads: [receipt.id], remove: ["inbox"] } });
  const { data: draft } = await hermes.POST("/mailboxes/{mailbox}/drafts", { params, body: { answers: read!.messages[0]!.id, text: "Måndag går bra." } });
  const { data: asked } = await hermes.POST("/mailboxes/{mailbox}/drafts/{draft}/send", { params: { path: { ...params.path, draft: draft!.id } } });
  // Ada's session from before the clock moved has ended, so she signs in again.
  await duva.signIn("ada@example.org").POST("/approvals/{approval}/send", { params: { path: { approval: asked!.send!.approval! } } });
  return { ...app, hermes, agent: created!.agent };
}

const days = (page: Page) => page.getByRole("list", { name: "Days" }).getByRole("link");
/** Opens Hermes's activity from the status strip along the desk's foot, where Hermes says how it stands. */
const openActivity = (page: Page) => page.getByRole("contentinfo", { name: "Status" }).getByRole("link", { name: /^Hermes is running/ }).click();
const fold = (page: Page) => page.getByRole("list", { name: "Days" }).getByRole("button", { name: "Sep 7 to Oct 5, nothing counted" });

test("a sponsor opens their agent's page from the status strip, with a summary for each of the last 30 days, newest first, the quiet ones folded", budget, async () => {
  const { page, signIn } = await withActivity();
  await signIn("ada@example.org");

  await openActivity(page);

  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Hermes's activity");
  await expect.poll(() => days(page).count(), wait).toBe(1);
  expect(await days(page).first().getAttribute("aria-label")).toMatch(/^Tuesday, Oct 6.*: 1 draft, 1 sent, 1 approved, 1 organized$/);
  expect(await days(page).first().innerText()).toMatch(/1 draft, 1 sent, 1 approved, 1 organized$/);
  expect(await fold(page).getAttribute("aria-expanded")).toBe("false");
  expect(await page.getByRole("contentinfo", { name: "Status" }).getByRole("link", { name: /^Hermes is running/ }).getAttribute("aria-current")).toBe("page");
  // Agents own no mailboxes, so the side column's views list no activity of their own.
  expect(await page.getByRole("navigation", { name: "Mail" }).getByRole("link", { name: "Activity" }).count()).toBe(0);

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
  await openActivity(page);
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
  await openActivity(page);

  await days(page).first().click();

  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toMatch(/^Tuesday, Oct 6/);
  const entries = page.getByRole("list", { name: "Timeline" }).getByRole("listitem");
  await expect.poll(() => entries.count(), wait).toBeGreaterThanOrEqual(5);
  const archived = async () => (await entries.allInnerTexts()).filter((text) => text.includes(" archived "));
  await expect.poll(archived, wait).toEqual([expect.stringMatching(/^09:30 AM\n+Hermes archived a thread\. Kvitto$/)]);
  const texts = await entries.allInnerTexts();
  // Mail that simply arrived in the sponsor's mailbox is none of the agent's doing.
  expect(texts.some((text) => text.includes(" wrote to "))).toBe(false);
  expect(texts.some((text) => text.includes("You added the agent Hermes"))).toBe(true);
  expect(texts.some((text) => text.includes("You changed Hermes's settings."))).toBe(true);
  expect(texts.some((text) => text.includes("You approved Hermes's send"))).toBe(true);
  expect(texts.some((text) => text.includes("Hermes asked for approval to send"))).toBe(true);
  expect(texts.some((text) => text.includes("Duva sent Hermes's message to Grace Hopper."))).toBe(true);
  // Each entry names who did it, in a heavier hand.
  expect(await page.getByRole("list", { name: "Timeline" }).locator("strong").allInnerTexts()).toEqual(expect.arrayContaining(["Duva", "Hermes", "You"]));
  expect(await page.getByRole("list", { name: "Timeline" }).locator("strong").count()).toBe(await entries.count());
  await expect.poll(() => page.getByRole("list", { name: "Timeline" }).getByRole("link", { name: "Kvitto" }).count(), wait).toBe(1);

  // A thread several entries are about is linked from each, each link naming its entry.
  const meetingLinks = page.getByRole("list", { name: "Timeline" }).getByRole("link", { name: /^Möte\. / });
  expect(await meetingLinks.count()).toBeGreaterThan(1);
  const names = await meetingLinks.evaluateAll((links) => links.map((link) => link.getAttribute("aria-label")));
  expect(new Set(names).size).toBe(names.length);
  expect(names).toContain("Möte. 09:30 AM: Hermes asked for approval to send.");

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
  await openActivity(page);
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
  await openActivity(page);

  await fold(page).click();
  await days(page).nth(1).click();

  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toMatch(/^Monday, Oct 5/);
  await expect.poll(() => page.getByText("Nothing happened that day.").isVisible(), wait).toBe(true);
});

test("on a phone, each day and each entry fits the screen", budget, async () => {
  const { page, signIn } = await withActivity({ viewport: phone });
  await signIn("ada@example.org");
  // A phone has no status strip, so the activity opens from Your agents.
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: "Your agents" }).click();
  await page.getByRole("region", { name: "Your agents" }).getByRole("heading", { name: "Hermes" }).click();
  await page.getByRole("link", { name: "Hermes's activity" }).click();

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

test("a day Coo only answered Ask Coo isn't folded as quiet, and its timeline says what was asked and what Coo read, reached from Ask Coo", budget, async () => {
  const model = scripted(
    () => [use("listThreads")],
    (request) => [use("getThread", { thread: lastResult(request).threads.find(({ subject }: { subject: string }) => subject === "Möte").id })],
    () => [{ text: "Grace asks about a meeting." }],
  );
  const { page, signIn, duva } = await withActivity({ model });
  await duva.clock(new Date("2026-10-07T10:00:00Z"));
  await signIn("ada@example.org");
  await page.getByRole("link", { name: "Ask Coo", exact: true }).click();
  await page.getByRole("textbox", { name: "What do you want to ask?" }).fill("What came in?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect.poll(() => page.locator(".ask-turn").nth(1).locator(".ask-text").innerText(), wait).toBe("Grace asks about a meeting.");

  await page.getByRole("link", { name: "What Coo did" }).click();

  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Coo's activity");
  await expect.poll(() => days(page).count(), wait).toBe(1);
  expect(await days(page).first().getAttribute("aria-label")).toMatch(/^Wednesday, Oct 7.*: 1 conversation$/);
  expect(await page.getByRole("list", { name: "Days" }).getByRole("button", { name: "Sep 8 to Oct 6, nothing counted" }).count()).toBe(1);

  await days(page).first().click();

  const turn = page.getByRole("list", { name: "Timeline" }).getByRole("listitem").filter({ hasText: "asked Coo" });
  await expect.poll(() => turn.locator(".entry-line").allInnerTexts(), wait).toEqual(["You asked Coo “What came in?”", "Coo answered, reading Möte."]);
  expect(await turn.locator(".entry-how").innerText()).toMatch(/^Claude Haiku 4\.5\. [\d.]+ cents\.$/);
  await turn.getByRole("link", { name: /^Möte\. / }).click();
  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Möte");
});
