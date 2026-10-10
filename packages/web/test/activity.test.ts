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
 * and sponsors the agent Hermes, which has send access to it, added on Monday 5 October. Two
 * messages reached Ada on Tuesday 6 October, and Hermes archived one and answered the other as her,
 * which she approved but SES refused, since the account is in the sandbox. Then Hermes asked to
 * send another answer, which waits for her. All in the browser's time zone, UTC.
 */
async function withActivity(options: Parameters<typeof startWebApp>[0] = {}) {
  const app = await startWebApp({ domain: "example.com", admin: "ada@example.org", sandbox: true, ...options });
  const { duva } = app;
  await duva.clock(new Date("2026-10-05T16:00:00Z"));
  const ada = duva.signIn("ada@example.org");
  const { data: me } = await ada.GET("/whoami");
  const { data: adaMailbox } = await ada.POST("/mailboxes", { body: { owner: me!.id, address: "ada@example.com" } });
  await ada.PATCH("/mailboxes/{mailbox}/screener", { params: { path: { mailbox: adaMailbox!.id } }, body: { on: false } });
  const { data: created } = await ada.POST("/agents", { body: { name: "Hermes" } });
  await ada.PATCH("/agents/{agent}/settings", { params: { path: { agent: created!.agent.id } }, body: { sponsorAccess: "send" } });
  const hermes = duva.withKey(created!.key);
  const params = { path: { mailbox: adaMailbox!.id } };
  await duva.clock(new Date("2026-10-06T08:00:00Z"));
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
  await duva.clock(new Date("2026-10-06T10:15:00Z"));
  const { data: again } = await hermes.POST("/mailboxes/{mailbox}/drafts", { params, body: { answers: read!.messages[0]!.id, text: "Tisdag går också bra." } });
  await hermes.POST("/mailboxes/{mailbox}/drafts/{draft}/send", { params: { path: { ...params.path, draft: again!.id } } });
  return { ...app, hermes, params, receipt, agent: created!.agent };
}

const events = (page: Page) => page.getByRole("region", { name: "Events" }).getByRole("link");
const labels = (page: Page) => events(page).evaluateAll((links) => links.map((link) => link.getAttribute("aria-label")));
const chip = (page: Page, name: string) => page.getByRole("group", { name: "Show" }).getByRole("button", { name, exact: true });
const heading = (page: Page) => page.getByRole("heading", { level: 1 }).textContent();
/** Opens Hermes's activity from the status strip along the desk's foot, where Hermes says how it stands. */
const openActivity = (page: Page) => page.getByRole("contentinfo", { name: "Status" }).getByRole("link", { name: /^Hermes is running/ }).click();

test("a sponsor opens their agent's activity from the status strip: its events, newest first, under a heading for each date, failures and what waits for them marked", budget, async () => {
  const { page, signIn } = await withActivity();
  await signIn("ada@example.org");

  await openActivity(page);

  await expect.poll(() => heading(page), wait).toBe("Hermes's activity");
  await expect.poll(() => events(page).count(), wait).toBeGreaterThan(0);
  const list = page.getByRole("region", { name: "Events" });
  expect(await list.getByRole("heading", { level: 2 }).allInnerTexts()).toEqual(["Tuesday, Oct 6", "Monday, Oct 5"]);
  const said = await labels(page);
  expect(said[0]).toBe("Tuesday, Oct 6, 10:15 AM: Hermes asked for approval to send.. Needs you");
  expect(said).toContain("Tuesday, Oct 6, 09:30 AM: Hermes archived a thread.");
  expect(said).toContainEqual(expect.stringMatching(/^Tuesday, Oct 6, 09:30 AM: Amazon SES refused to send Hermes's message: .*\. Failed$/));
  expect(said.slice(-2)).toEqual(["Monday, Oct 5, 04:00 PM: You changed Hermes's settings.", "Monday, Oct 5, 04:00 PM: You added the agent Hermes."]);
  // Mail that simply arrived in the sponsor's mailbox is none of the agent's doing.
  expect(said.some((text) => text!.includes(" wrote to "))).toBe(false);
  // Each row shows its time, then what happened, then its marks.
  expect(await events(page).first().innerText()).toBe("10:15 AM\nHermes asked for approval to send.\nNeeds you");
  expect(await events(page).filter({ hasText: "refused" }).locator(".event-mark").innerText()).toBe("Failed");
  // The date heading stays at the column's top as the events scroll under it.
  expect(await list.getByRole("heading", { level: 2 }).first().evaluate((date) => getComputedStyle(date).position)).toBe("sticky");
  expect(await page.getByRole("contentinfo", { name: "Status" }).getByRole("link", { name: /^Hermes is running/ }).getAttribute("aria-current")).toBe("page");
  expect(await page.getByRole("heading", { level: 2, name: "No event open" }).isVisible()).toBe(true);
  // Agents own no mailboxes, so the side column's views list no activity of their own.
  expect(await page.getByRole("navigation", { name: "Mail" }).getByRole("link", { name: "Activity" }).count()).toBe(0);
});

test("a sponsor reaches each agent's activity from the Agents sheet", budget, async () => {
  const { page, signIn } = await withActivity();
  await signIn("ada@example.org");

  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: "Your agents" }).click();
  await page.getByRole("region", { name: "Your agents" }).getByRole("heading", { name: "Hermes" }).click();
  await page.getByRole("link", { name: "Hermes's activity" }).click();

  await expect.poll(() => heading(page), wait).toBe("Hermes's activity");
  await expect.poll(() => events(page).count(), wait).toBeGreaterThan(0);
});

test("on a desk an event opens beside the events, its row marked, with what was recorded on it and links to the thread and draft it touched", budget, async () => {
  const { page, signIn } = await withActivity();
  await signIn("ada@example.org");
  await openActivity(page);

  await events(page).filter({ hasText: "archived" }).click();

  await expect.poll(() => heading(page), wait).toBe("Hermes archived a thread.");
  expect(await page.getByRole("main").getByText("Tuesday, Oct 6, 09:30 AM").isVisible()).toBe(true);
  const beside = page.getByRole("region", { name: "Hermes's activity" });
  expect(await beside.getByRole("region", { name: "Events" }).isVisible()).toBe(true);
  expect(await events(page).filter({ hasText: "archived" }).getAttribute("aria-current")).toBe("true");
  const facts = page.getByRole("main").getByRole("definition");
  await expect.poll(() => page.getByRole("main").getByRole("link", { name: "Kvitto" }).count(), wait).toBe(1);

  // What SES said in refusing is recorded on the failed send.
  await events(page).filter({ hasText: "refused" }).click();
  await expect.poll(() => heading(page), wait).toMatch(/^Amazon SES refused to send Hermes's message/);
  expect(await page.getByRole("main").getByText("Failed", { exact: true }).isVisible()).toBe(true);
  expect(await page.getByRole("main").getByRole("term").allInnerTexts()).toEqual(["Thread", "Why it failed"]);
  expect(await facts.last().innerText()).toMatch(/grace@example\.org/);

  // A draft still waiting links to it.
  await events(page).first().click();
  await expect.poll(() => heading(page), wait).toBe("Hermes asked for approval to send.");
  expect(await page.getByRole("main").getByText("Needs you", { exact: true }).isVisible()).toBe(true);
  await page.getByRole("main").getByRole("link", { name: "Open the draft" }).click();
  await expect.poll(() => page.evaluate(() => location.hash), wait).toMatch(/^#\/drafts\/[^/?]+$/);
  await expect.poll(() => page.getByRole("main").getByText("Tisdag går också bra.").count(), wait).toBeGreaterThan(0);
  await page.goBack();
  await expect.poll(() => heading(page), wait).toBe("Hermes asked for approval to send.");

  await page.getByRole("main").getByRole("link", { name: "Möte" }).click();
  await expect.poll(() => heading(page), wait).toBe("Möte");
});

test("chips choose the kinds of event shown, several at once, the address keeping them, and a choice with none says so with the way back to all", budget, async () => {
  const { page, signIn, agent } = await withActivity();
  await signIn("ada@example.org");
  await openActivity(page);
  await expect.poll(() => events(page).count(), wait).toBeGreaterThan(0);
  expect(await chip(page, "All").getAttribute("aria-pressed")).toBe("true");

  await chip(page, "Organizing").click();

  await expect.poll(() => page.evaluate(() => location.hash), wait).toBe(`#/agents/${agent.id}?kinds=organizing`);
  await expect.poll(() => labels(page), wait).toEqual(["Tuesday, Oct 6, 09:30 AM: Hermes archived a thread."]);
  expect(await chip(page, "Organizing").getAttribute("aria-pressed")).toBe("true");
  expect(await chip(page, "All").getAttribute("aria-pressed")).toBe("false");

  await chip(page, "Pauses and limits").click();

  await expect.poll(() => page.evaluate(() => location.hash), wait).toBe(`#/agents/${agent.id}?kinds=organizing,pausesAndLimits`);
  await expect.poll(() => labels(page), wait).toEqual(["Tuesday, Oct 6, 09:30 AM: Hermes archived a thread.", "Monday, Oct 5, 04:00 PM: You changed Hermes's settings."]);

  // A reload keeps the choice.
  await page.reload();
  await expect.poll(() => labels(page), wait).toEqual(["Tuesday, Oct 6, 09:30 AM: Hermes archived a thread.", "Monday, Oct 5, 04:00 PM: You changed Hermes's settings."]);
  expect(await chip(page, "Pauses and limits").getAttribute("aria-pressed")).toBe("true");

  await chip(page, "Organizing").click();
  await chip(page, "Pauses and limits").click();

  await expect.poll(() => page.evaluate(() => location.hash), wait).toBe(`#/agents/${agent.id}`);
  await expect.poll(() => chip(page, "All").getAttribute("aria-pressed"), wait).toBe("true");

  // Failures are any events that failed, whatever their kind.
  await chip(page, "Failures").click();

  await expect.poll(() => page.evaluate(() => location.hash), wait).toBe(`#/agents/${agent.id}?failed=true`);
  await expect.poll(() => labels(page), wait).toEqual([expect.stringMatching(/^Tuesday, Oct 6, 09:30 AM: Amazon SES refused to send/)]);

  await chip(page, "Approvals").click();

  await expect.poll(() => page.getByRole("heading", { name: "No events of these kinds." }).isVisible(), wait).toBe(true);
  expect(await events(page).count()).toBe(0);

  await page.getByRole("button", { name: "Show all events" }).click();

  await expect.poll(() => page.evaluate(() => location.hash), wait).toBe(`#/agents/${agent.id}`);
  await expect.poll(() => events(page).count(), wait).toBeGreaterThan(5);
  expect(await chip(page, "All").getAttribute("aria-pressed")).toBe("true");
});

test("each chip shows its kind of event alone, and a kind with none says so", budget, async () => {
  const { page, signIn } = await withActivity();
  await signIn("ada@example.org");
  await openActivity(page);
  await expect.poll(() => events(page).count(), wait).toBeGreaterThan(0);
  const shown: [chip: string, said: RegExp | undefined][] = [
    ["Conversations", undefined],
    ["Tasks", undefined],
    ["Drafts and sends", /^Hermes started a draft\.$/],
    ["Approvals", /^You approved Hermes's send\.$/],
    ["Organizing", /^Hermes archived a thread\.$/],
    ["Screening and senders", undefined],
    ["Unsubscribes", undefined],
    ["Pauses and limits", /^You changed Hermes's settings\.$/],
    ["Alerts", /^Hermes's message .* failed/],
  ];
  const lines = () => page.getByRole("region", { name: "Events" }).locator(".event-said").allInnerTexts();

  for (const [name, said] of shown) {
    await chip(page, name).click();
    if (said === undefined) {
      await expect.poll(() => page.getByRole("heading", { name: "No events of these kinds." }).isVisible(), wait).toBe(true);
    } else {
      // It shows, and nothing of another kind beside it, as the list before the click still did.
      const read = async () => {
        const now = await lines();
        return { said: now.some((line) => said.test(line)), others: now.filter((line) => shown.some(([other, its]) => other !== name && its?.test(line))) };
      };
      await expect.poll(read, wait).toEqual({ said: true, others: [] });
    }
    await chip(page, name).click();
    await expect.poll(() => chip(page, "All").getAttribute("aria-pressed"), wait).toBe("true");
  }
});

test("More at the foot reads older events, and under a filter older events of its kinds", budget, async () => {
  const { page, signIn, hermes, params, receipt } = await withActivity();
  // Hermes marks the receipt read and unread 30 times each, 60 events of organizing.
  for (let time = 0; time < 30; time++) {
    await hermes.POST("/mailboxes/{mailbox}/threads/read", { params, body: { threads: [receipt.id] } });
    await hermes.POST("/mailboxes/{mailbox}/threads/unread", { params, body: { threads: [receipt.id] } });
  }
  await signIn("ada@example.org");
  await openActivity(page);

  await expect.poll(() => events(page).count(), wait).toBe(50);
  const first = await labels(page);
  await page.getByRole("button", { name: "More" }).click();
  await expect.poll(() => events(page).count(), wait).toBeGreaterThan(50);
  const all = await labels(page);
  expect(all.slice(0, 50)).toEqual(first);
  expect(all.at(-1)).toBe("Monday, Oct 5, 04:00 PM: You added the agent Hermes.");
  expect(await page.getByRole("button", { name: "More" }).count()).toBe(0);

  await chip(page, "Organizing").click();

  await expect.poll(() => events(page).count(), wait).toBe(50);
  await page.getByRole("button", { name: "More" }).click();
  await expect.poll(() => events(page).count(), wait).toBe(61);
  expect((await labels(page)).at(-1)).toBe("Tuesday, Oct 6, 09:30 AM: Hermes archived a thread.");
  expect(await page.getByRole("button", { name: "More" }).count()).toBe(0);
});

test("on a desk j and k move through the events, and the one the focus rests on half a second opens beside them, the focus staying in the list", budget, async () => {
  const { page, signIn } = await withActivity();
  await signIn("ada@example.org");
  await openActivity(page);
  await expect.poll(() => events(page).count(), wait).toBeGreaterThan(0);
  const focused = () => page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
  const said = await labels(page);

  await page.keyboard.press("j");
  await page.keyboard.press("j");
  await page.waitForTimeout(250);
  expect(await focused()).toBe(said[1]);
  expect(await heading(page)).toBe("Hermes's activity");

  await expect.poll(() => heading(page), wait).toBe(said[1]!.replace(/^[^:]+:[^:]+: /, ""));
  expect(await focused()).toBe(said[1]);

  await page.keyboard.press("k");
  await expect.poll(() => heading(page), wait).toBe("Hermes asked for approval to send.");
  expect(await focused()).toBe(said[0]);

  await page.keyboard.press("Escape");
  await expect.poll(() => heading(page), wait).toBe("Hermes's activity");
});

test("on a phone an open event takes the screen alone, with the way back to the events, and everything fits the screen", budget, async () => {
  const { page, signIn, agent } = await withActivity({ viewport: phone });
  await signIn("ada@example.org");
  await expect.poll(() => heading(page), wait).toBe("Inbox");
  await page.evaluate((agent) => (location.hash = `#/agents/${agent}`), agent.id);
  await expect.poll(() => events(page).count(), wait).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(phone.width);
  expect(await page.getByRole("heading", { name: "No event open" }).isVisible()).toBe(false);

  await events(page).filter({ hasText: "refused" }).click();

  await expect.poll(() => heading(page), wait).toMatch(/^Amazon SES refused/);
  expect(await page.getByRole("region", { name: "Events" }).isVisible()).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(phone.width);

  await page.getByRole("link", { name: "Hermes's activity" }).click();

  await expect.poll(() => heading(page), wait).toBe("Hermes's activity");
  expect(await page.getByRole("region", { name: "Events" }).isVisible()).toBe(true);
});

test("a turn of Ask Coo is an event saying what was asked, opening into the threads Coo read, the models and the cost, reached from Ask Coo", budget, async () => {
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

  await expect.poll(() => heading(page), wait).toBe("Coo's activity");
  await expect.poll(() => labels(page), wait).toContain("Wednesday, Oct 7, 10:00 AM: You asked Coo “What came in?”");

  await events(page).filter({ hasText: "What came in?" }).click();

  await expect.poll(() => heading(page), wait).toBe("You asked Coo “What came in?”");
  const fact = (term: string) => page.getByRole("main").locator(".event-fact").filter({ has: page.getByRole("term").filter({ hasText: term }) }).getByRole("definition").innerText();
  expect(await fact("Asked")).toBe("“What came in?”");
  expect(await fact("Models")).toBe("Claude Haiku 4.5");
  expect(await fact("Cost")).toMatch(/^[\d.]+ cents?$/);
  await expect.poll(() => fact("Threads"), wait).toBe("Möte");
  await page.getByRole("main").getByRole("link", { name: "Möte" }).click();
  await expect.poll(() => heading(page), wait).toBe("Möte");
});
