import { expect, test } from "vitest";
import type { DuvaOptions } from "@duva/api/harness";
import type { DuvaClient } from "@duva/client";
import type { Page } from "playwright-core";
import { phone, startWebApp } from "./web-app.ts";

// As in inbox.test.ts, every wait has room for a page under the full suite's load.
const wait = { timeout: 10_000 };
const budget = { timeout: 60_000 };

type Model = NonNullable<DuvaOptions["model"]>;

const mail = (from: string, subject: string, id: string) =>
  `From: ${from}\r\nTo: grace@example.com\r\nSubject: ${subject}\r\nDate: Sun, 04 Oct 2026 09:00:00 +0200\r\nMessage-ID: <${id}@example.org>\r\n\r\nHello.\r\n`;

/** What the side column's Inbox says, with its count once the feeds bring mail. */
const inboxCount = (page: Page) => () => page.getByRole("navigation", { name: "Mail" }).getByRole("link", { name: /^Inbox/ }).textContent();

/**
 * The web app for a deployment where the human Grace has a personal mailbox at grace@example.com,
 * its Screener off, and is signed in on its Inbox, having done `before` first.
 */
async function withGrace(options: Parameters<typeof startWebApp>[0] = {}, before?: (grace: DuvaClient) => Promise<unknown>) {
  const app = await startWebApp({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org"], ...options });
  const ada = app.duva.signIn("ada@example.org");
  const grace = app.duva.signIn("grace@example.org");
  const { data: whoami } = await grace.GET("/whoami");
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: whoami!.id, address: "grace@example.com" } });
  const params = { path: { mailbox: mailbox!.id } };
  await grace.PATCH("/mailboxes/{mailbox}/screener", { params, body: { on: false } });
  await before?.(grace);
  await app.signIn("grace@example.org");
  const heading = () => app.page.getByRole("heading", { level: 1 }).textContent();
  await expect.poll(heading, wait).toBe("Inbox");
  const banner = app.page.getByRole("banner");
  const nest = banner.getByRole("link", { name: /^Duva, Coo is/ });
  const says = app.page.getByRole("status").filter({ hasText: /^Coo\./ });
  const settings = async () => {
    await app.page.getByRole("link", { name: "Settings", exact: true }).first().click();
    await expect.poll(heading, wait).toBe("Settings");
  };
  return { ...app, grace, params, heading, banner, nest, says, settings };
}

for (const [size, viewport] of [
  ["a desk", { width: 1280, height: 800 }],
  ["a phone", phone],
] as const) {
  test(`on ${size} Coo sits in its nest where the wordmark was, named Duva, and opens Ask Coo, while Mail goes to the Inbox`, budget, async () => {
    const { page, banner, nest, heading } = await withGrace({ viewport });
    expect(await nest.getAttribute("aria-label")).toBe("Duva, Coo is resting. Ask Coo");

    await nest.click();

    await expect.poll(heading, wait).toBe("Ask Coo");
    // The nest leads the side column's head, and on a phone the top row, at its left end.
    const nestBox = (await nest.boundingBox())!;
    const write = (await banner.getByRole("button", { name: "Write" }).boundingBox())!;
    expect(nestBox.x).toBeLessThan(write.x);
    expect(Math.abs(nestBox.y + nestBox.height / 2 - (write.y + write.height / 2))).toBeLessThan(8);
    await page.getByRole("link", { name: "Mail", exact: true }).click();
    await expect.poll(heading, wait).toBe("Inbox");
  });
}

test("Coo bobs its head in the nest while it works on a turn, sits still at rest, and keeps still for reduced motion", budget, async () => {
  let answer!: () => void;
  const answered = new Promise<void>((resolve) => (answer = resolve));
  const model: Model = async function* () {
    await answered;
    yield { text: "Done." };
    yield { usage: { inputTokens: 1000, outputTokens: 10 } };
  };
  const { page, nest } = await withGrace({ model });
  const bobbing = () => nest.locator(".coo-head").evaluate((head) => getComputedStyle(head).animationName);
  expect(await bobbing()).toBe("none");

  await nest.click();
  await page.getByRole("textbox", { name: "What do you want to ask?" }).fill("Anything new?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();

  await expect.poll(() => nest.getAttribute("aria-label"), wait).toBe("Duva, Coo is working. Ask Coo");
  expect(await bobbing()).toBe("coo-bob");
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await bobbing()).toBe("none");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  answer();
  await expect.poll(() => nest.getAttribute("aria-label"), wait).toBe("Duva, Coo is resting. Ask Coo");
  expect(await bobbing()).toBe("none");
});

test("Coo says who sent the mail that came since the human last looked, politely, and goes quiet once they look at the Inbox", budget, async () => {
  const { page, duva, says, settings, heading } = await withGrace();
  await settings();
  expect(await says.count()).toBe(0);

  await duva.receive(mail("Astrid Lindqvist <astrid@example.org>", "Middag på lördag?", "astrid"), { to: ["grace@example.com"] });
  await expect.poll(() => says.textContent(), wait).toBe("Coo. New mail from Astrid Lindqvist.");
  await duva.receive(mail("SJ <bokning@sj.example>", "Din bokning", "sj"), { to: ["grace@example.com"] });
  await expect.poll(() => says.textContent(), wait).toBe("Coo. 2 new since you looked, from SJ and Astrid Lindqvist.");
  // It speaks under the nest, in the side column, so it covers none of the page beside it.
  const bubble = (await says.boundingBox())!;
  const main = (await page.getByRole("main").boundingBox())!;
  expect(bubble.x + bubble.width).toBeLessThanOrEqual(main.x);

  await says.getByRole("link").click();

  await expect.poll(heading, wait).toBe("Inbox");
  await expect.poll(() => says.count(), wait).toBe(0);
  await settings();
  expect(await says.count()).toBe(0);
});

test("Coo says when a draft of its waits for approval, marked as Coo in Approvals, and goes quiet once the human looks there", budget, async () => {
  let step = 0;
  const model: Model = async function* (request) {
    const result = () => {
      for (const block of request.messages.at(-1)!.content.toReversed()) if ("toolResult" in block) return JSON.parse(block.toolResult.content[0]!.text) as Record<string, any>;
      throw new Error("No tool answered.");
    };
    const steps = [
      () => [{ toolUse: { toolUseId: "draft", name: "createDraft", input: { to: ["ada@example.org"], subject: "Lunch", text: "Lunch on Friday?" } } }],
      () => [{ toolUse: { toolUseId: "send", name: "sendDraft", input: { draft: result().id } } }],
    ];
    for (const event of steps[step++]?.() ?? [{ text: "It waits for you." }]) yield event;
    yield { usage: { inputTokens: 1000, outputTokens: 10 } };
  };
  const { page, nest, says, heading, duva } = await withGrace({ model });
  // With Claude Sonnet 5.5 for every job, writing the draft hands nothing over, so the script runs as written.
  await duva.signIn("ada@example.org").PATCH("/organization/settings", { body: { mailboxAgentModel: "anthropic.claude-sonnet-5-5", mailboxAgentTaskModel: "anthropic.claude-sonnet-5-5" } });
  await nest.click();
  await page.getByRole("textbox", { name: "What do you want to ask?" }).fill("Ask Ada to lunch.");
  await page.getByRole("button", { name: "Ask", exact: true }).click();

  await expect.poll(() => says.textContent(), wait).toBe("Coo. A draft of mine waits for your approval.");
  await says.getByRole("link").click();

  await expect.poll(heading, wait).toBe("Approvals");
  await expect.poll(() => says.count(), wait).toBe(0);
  const row = page.getByRole("button", { name: /^Coo/ });
  await expect.poll(() => row.locator(".actor-mark-coo").count(), wait).toBe(1);
  expect(await row.locator(".actor-mark-agent").count()).toBe(0);
});

test("Coo says when it did a label's task, and goes quiet once the human opens the thread", budget, async () => {
  let receipts: string | undefined;
  const { page, duva, grace, params, says, settings } = await withGrace({}, async (grace) => {
    const { data: mailboxes } = await grace.GET("/mailboxes");
    const params = { path: { mailbox: mailboxes!.mailboxes[0]!.id } };
    receipts = (await grace.POST("/mailboxes/{mailbox}/labels", { params, body: { name: "Receipts" } })).data!.id;
    await grace.PUT("/mailboxes/{mailbox}/labels/{label}/prompt", { params: { path: { ...params.path, label: receipts } }, body: { prompt: "Note the amount." } });
  });
  await duva.receive(mail("Shop <orders@shop.example.net>", "Your receipt", "receipt"), { to: ["grace@example.com"] });
  const thread = (await grace.GET("/mailboxes/{mailbox}/threads", { params })).data!.threads[0]!.id;
  // Looked at in the Inbox, the mail is no news, once the feeds bring it, as the Inbox's count says.
  await expect.poll(inboxCount(page), wait).toMatch(/1 unread$/);
  expect(await says.count()).toBe(0);
  await settings();

  await grace.POST("/mailboxes/{mailbox}/threads/labels", { params, body: { threads: [thread], add: [receipts!] } });

  await expect.poll(() => says.textContent(), wait).toBe("Coo. Done: Your receipt, from Receipts.");
  await says.getByRole("link").click();
  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Your receipt");
  await expect.poll(() => says.count(), wait).toBe(0);
});

test("a human who turns off Coo speaks up in Settings, You, hears nothing from Coo", budget, async () => {
  const { page, duva, grace, says, settings } = await withGrace();
  await settings();
  const you = page.getByRole("region", { name: "Preferences" });
  const speaks = you.getByRole("group", { name: "Coo speaks up" });
  await expect.poll(() => speaks.getByRole("radio", { name: /^On/ }).isChecked(), wait).toBe(true);

  await speaks.getByRole("radio", { name: /^Off/ }).check();
  await you.getByRole("button", { name: "Save" }).click();
  await expect.poll(() => you.getByRole("status").textContent(), wait).toBe("Saved. This applies from now on.");
  expect((await grace.GET("/preferences")).data?.cooSpeaksUp).toBe("off");
  await duva.receive(mail("Astrid Lindqvist <astrid@example.org>", "Middag på lördag?", "astrid"), { to: ["grace@example.com"] });
  // The Inbox's count says the mail came, which Coo would have said too.
  await expect.poll(inboxCount(page), wait).toMatch(/1 unread$/);

  expect(await says.count()).toBe(0);
});
