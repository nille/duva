import { expect, test } from "vitest";
import type { DuvaOptions } from "@duva/api/harness";
import { phone, startWebApp } from "./web-app.ts";

// As in inbox.test.ts, every wait has room for a page under the full suite's load.
const wait = { timeout: 10_000 };
const budget = { timeout: 60_000 };

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

const fromAda = (subject: string, text: string) =>
  `From: Ada Lovelace <ada@example.org>\r\nTo: grace@example.com\r\nSubject: ${subject}\r\nDate: Sun, 04 Oct 2026 09:00:00 +0200\r\nMessage-ID: <${subject.length}@example.org>\r\n\r\n${text}\r\n`;

/**
 * The web app for a deployment where the human Grace has a personal mailbox at grace@example.com,
 * with mail from Ada about the report. Claude Sonnet 5.5 does every job, so nothing is routed and
 * a script runs as written, unless `models` is nova, when Nova 2 Lite answers and hands over to
 * Sonnet, or defaults, as an admin left them.
 */
async function withMailbox({ models = "sonnet", ...options }: Parameters<typeof startWebApp>[0] & { models?: "sonnet" | "nova" | "defaults" } = {}) {
  const app = await startWebApp({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org"], ...options });
  const ada = app.duva.signIn("ada@example.org");
  const everyday = models === "nova" ? "amazon.nova-2-lite-v1:0" : "anthropic.claude-sonnet-5-5";
  if (models !== "defaults") await ada.PATCH("/organization/settings", { body: { mailboxAgentModel: everyday, mailboxAgentTaskModel: everyday } });
  const grace = app.duva.signIn("grace@example.org");
  const { data: whoami } = await grace.GET("/whoami");
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: whoami!.id, address: "grace@example.com" } });
  await grace.PATCH("/mailboxes/{mailbox}/screener", { params: { path: { mailbox: mailbox!.id } }, body: { on: false } });
  await app.duva.receive(fromAda("The report", "Here is the quarterly report."), { to: ["grace@example.com"] });
  const agent = async () => (await grace.GET("/mailbox-agent")).data!.agent;
  return { ...app, grace, mailbox: mailbox!, agent };
}

test("a human asks their mailbox's agent from the side column, and reads its answer with what it did, linking to the thread it read", budget, async () => {
  const model = scripted(
    () => [{ text: "Let me look. " }, use("listThreads")],
    (request) => [use("getThread", { thread: lastResult(request).threads[0].id })],
    () => [{ text: "Ada sent the quarterly report." }],
  );
  const { page, signIn } = await withMailbox({ model });
  await signIn("grace@example.org");

  await page.getByRole("link", { name: "Ask Coo", exact: true }).click();
  await page.getByRole("heading", { level: 1, name: "Ask Coo" }).waitFor(wait);
  await page.getByRole("textbox", { name: "What do you want to ask?" }).fill("What did Ada send?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();

  const turns = page.locator(".ask-turn");
  await expect.poll(() => turns.count(), wait).toBe(2);
  await expect.poll(() => turns.nth(0).innerText(), wait).toContain("What did Ada send?");
  await expect.poll(() => turns.nth(1).locator(".ask-text").innerText(), wait).toBe("Let me look. Ada sent the quarterly report.");
  const steps = turns.nth(1).getByRole("list", { name: "What it did" }).getByRole("listitem");
  await expect.poll(() => steps.allInnerTexts(), wait).toEqual(["Listed threads", "Read the thread"]);
  await steps.nth(1).getByRole("link", { name: "the thread" }).click();
  await page.getByRole("heading", { level: 1, name: "The report" }).waitFor(wait);
});

test("a reply the agent asks to send says it waits in Approvals, which counts it", budget, async () => {
  const model = scripted(
    () => [use("listThreads")],
    (request) => [use("getThread", { thread: lastResult(request).threads[0].id })],
    (request) => [use("createDraft", { answers: lastResult(request).messages[0].id, text: "Thanks, Ada." })],
    (request) => [use("sendDraft", { draft: lastResult(request).id })],
    () => [{ text: "I wrote a reply. It waits for you." }],
  );
  const { page, signIn } = await withMailbox({ model });
  await signIn("grace@example.org");

  await page.getByRole("link", { name: "Ask Coo", exact: true }).click();
  await page.getByRole("textbox", { name: "What do you want to ask?" }).fill("Thank Ada.");
  await page.keyboard.press("Enter");

  const waits = page.getByRole("link", { name: "Waits for you in Approvals" });
  await waits.waitFor(wait);
  await expect.poll(() => page.locator(".ask-step").allInnerTexts(), wait).toEqual(["Listed threads", "Read the thread", "Wrote the draft", "Asked to send the draft. Waits for you in Approvals"]);
  await expect.poll(() => page.getByRole("link", { name: /^Approvals/ }).innerText(), wait).toContain("1");
  await waits.click();
  await page.getByRole("heading", { level: 1, name: /Approvals/ }).waitFor(wait);
});

test("what Duva refuses the agent shows on its step, and a turn Duva refuses keeps the words asked", budget, async () => {
  const model = scripted(() => [use("createDraft", { to: ["ada@example.org"], text: "Hello" })], () => [{ text: "I can't write drafts." }]);
  const { page, signIn, grace, agent } = await withMailbox({ model });
  const path = { params: { path: { agent: (await agent()).id } } };
  await grace.PATCH("/agents/{agent}/settings", { ...path, body: { sponsorAccess: "read" } });
  await signIn("grace@example.org");
  await page.getByRole("link", { name: "Ask Coo", exact: true }).click();
  await page.getByText("It reads and searches your mail.").waitFor(wait);

  await page.getByRole("textbox", { name: "What do you want to ask?" }).fill("Write to Ada.");
  await page.keyboard.press("Enter");
  await expect.poll(() => page.locator(".ask-step-refused").innerText(), wait).toContain("Duva refused: Your sponsor access is read");

  await grace.POST("/agents/{agent}/pause", path);
  await page.getByRole("textbox", { name: "What do you want to ask?" }).fill("And now?");
  await page.keyboard.press("Enter");
  await expect.poll(() => page.getByRole("alert").innerText(), wait).toBe("Your mailbox agent is paused by grace@example.org. Unpause it in Settings to ask it.");
  expect(await page.getByRole("textbox", { name: "What do you want to ask?" }).inputValue()).toBe("And now?");
});

test("what was asked is there when the human comes back, Shift+A opens Ask Coo, and Start over clears it", budget, async () => {
  const { page, signIn } = await withMailbox({ model: scripted(() => [{ text: "Hello Grace." }]) });
  await signIn("grace@example.org");
  await page.getByRole("heading", { level: 1, name: "Inbox" }).waitFor(wait);
  await page.keyboard.press("Shift+A");
  await page.getByRole("heading", { level: 2, name: "Ask about your mail" }).waitFor(wait);
  await page.getByRole("button", { name: "What came in today that needs me?" }).click();
  await expect.poll(() => page.locator(".ask-turn").count(), wait).toBe(2);

  await page.reload();
  await expect.poll(() => page.locator(".ask-turn .ask-text").allInnerTexts(), wait).toEqual(["What came in today that needs me?", "Hello Grace."]);
  await page.getByRole("button", { name: "Start over" }).click();

  await page.getByRole("heading", { level: 2, name: "Ask about your mail" }).waitFor(wait);
  expect(await page.locator(".ask-turn").count()).toBe(0);
});

test("a turn the harder model took over says so and why, and Think harder has it answer the last turn again", budget, async () => {
  const model: Model = async function* (request) {
    const nova = request.model === "amazon.nova-2-lite-v1:0";
    const looked = request.messages.some(({ content }) => content.some((block) => "toolResult" in block));
    if (nova && !looked) yield use("listThreads");
    else if (nova) yield use("ask_for_help", { why: "Which report?" });
    else yield { text: request.system.includes("handed it to you") ? "Ada sent the quarterly report." : "Ada sent it on Sunday." };
    yield { usage: { inputTokens: 1000, outputTokens: 100 } };
  };
  const { page, signIn } = await withMailbox({ model, models: "nova" });
  await signIn("grace@example.org");
  await page.getByRole("link", { name: "Ask Coo", exact: true }).click();

  await page.getByRole("textbox", { name: "What do you want to ask?" }).fill("What about the report?");
  await page.keyboard.press("Enter");

  const turns = page.locator(".ask-turn");
  await expect.poll(() => turns.nth(1).locator(".ask-text").innerText(), wait).toBe("Ada sent the quarterly report.");
  expect(await turns.nth(1).locator(".ask-handover").innerText()).toBe("Claude Sonnet 5.5 took this over, since the first model asked for help: “Which report?”");
  await turns.nth(1).getByRole("button", { name: "Think harder" }).click();
  await expect.poll(() => turns.count(), wait).toBe(3);
  await expect.poll(() => turns.locator(".ask-text").allInnerTexts(), wait).toEqual(["What about the report?", "Ada sent the quarterly report.", "Ada sent it on Sunday."]);
  expect(await turns.nth(2).locator(".ask-handover").innerText()).toBe("Claude Sonnet 5.5 thought harder about this.");
  // The answer thought harder about offers it no more, nor does the one before it.
  expect(await page.getByRole("button", { name: "Think harder" }).count()).toBe(0);
});

test("on a phone, Ask Coo takes the screen, with the field at its foot", budget, async () => {
  const { page, signIn } = await withMailbox({ viewport: phone, model: scripted(() => [{ text: "Hello." }]) });
  await signIn("grace@example.org");
  await page.getByRole("heading", { level: 1, name: "Inbox" }).waitFor(wait);
  await page.evaluate(() => void (location.hash = "#/agent"));

  const field = page.getByRole("textbox", { name: "What do you want to ask?" });
  await field.waitFor(wait);
  const box = (await field.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(phone.width);
  await field.fill("Hi");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect.poll(() => page.locator(".ask-turn").count(), wait).toBe(2);
});

test("an admin chooses the mailbox agents' model for each job, where the mail they read is processed and their spend cap, and reads what they spent", budget, async () => {
  const { page, signIn, duva } = await withMailbox({ models: "defaults" });
  await signIn("ada@example.org");
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: /^Mail and agents/ }).click();
  const sheet = page.getByRole("region", { name: "Mailbox agents" });
  await sheet.getByText("Spent $0.00 in").waitFor(wait);
  expect(await sheet.getByRole("combobox", { name: "Answering in Ask Coo" }).inputValue()).toBe("anthropic.claude-haiku-4-5-20251001-v1:0");
  expect(await sheet.getByRole("combobox", { name: "Tasks from labels' prompts" }).inputValue()).toBe("anthropic.claude-haiku-4-5-20251001-v1:0");
  expect(await sheet.getByRole("checkbox", { name: /^Ask the decider first/ }).isChecked()).toBe(false);
  expect(await sheet.getByRole("combobox", { name: "The harder work" }).inputValue()).toBe("anthropic.claude-sonnet-5-5");
  expect(await sheet.getByRole("radio", { name: /^In the EU/ }).isChecked()).toBe(true);
  expect(await sheet.getByRole("combobox", { name: "Called from" }).inputValue()).toBe("eu-central-1");

  await sheet.getByRole("combobox", { name: "Tasks from labels' prompts" }).selectOption({ label: "Amazon Nova Lite" });
  await sheet.getByRole("radio", { name: /^In the region Duva calls/ }).check();
  await expect.poll(() => sheet.getByText("Claude Haiku 4.5 doesn't run that way. Choose another place, or another model.").isVisible(), wait).toBe(true);
  await sheet.getByRole("combobox", { name: "Tasks from labels' prompts" }).selectOption({ label: "Claude Haiku 4.5" });
  await sheet.getByRole("checkbox", { name: /^Ask the decider first/ }).check();
  await sheet.getByRole("combobox", { name: "The harder work" }).selectOption({ label: "Claude Haiku 4.5" });
  await sheet.getByRole("radio", { name: /^In the EU/ }).check();
  await sheet.getByRole("combobox", { name: "Called from" }).selectOption("us-west-2");
  await expect.poll(() => sheet.getByText("Choose an EU region for that, or In any region.").isVisible(), wait).toBe(true);
  expect(await sheet.getByRole("button", { name: "Save" }).isDisabled()).toBe(true);
  await sheet.getByRole("radio", { name: /^In any region/ }).check();
  await sheet.getByRole("textbox", { name: "US dollars a month" }).fill("5");
  await sheet.getByRole("button", { name: "Save" }).click();

  await expect.poll(async () => (await duva.signIn("ada@example.org").GET("/organization/settings")).data, wait).toMatchObject({
    mailboxAgentModel: "anthropic.claude-haiku-4-5-20251001-v1:0",
    mailboxAgentHarderModel: "anthropic.claude-haiku-4-5-20251001-v1:0",
    mailboxAgentDecider: true,
    mailboxAgentProfile: "global",
    mailboxAgentRegion: "us-west-2",
    mailboxAgentSpendCap: 5,
  });
});

test("a human with two mailboxes asks Coo from one of them or from All mailboxes, in one conversation, each turn saying where it was asked", budget, async () => {
  const model = scripted(
    () => [use("listThreads")],
    () => [{ text: "Ada sent the report." }],
    () => [use("listAllMailboxesThreads")],
    () => [{ text: "Nothing at home." }],
  );
  const { page, signIn, duva, grace } = await withMailbox({ model });
  const { data: whoami } = await grace.GET("/whoami");
  await duva.signIn("ada@example.org").POST("/mailboxes", { body: { owner: whoami!.id, address: "grace.home@example.com" } });
  await signIn("grace@example.org");

  await page.getByRole("link", { name: "Ask Coo", exact: true }).click();
  const scope = page.getByRole("navigation", { name: "Ask about" });
  await scope.waitFor(wait);
  await expect.poll(() => scope.getByRole("link").allInnerTexts(), wait).toEqual(["All mailboxes", "grace.home@example.com", "grace@example.com"]);
  const current = scope.locator('[aria-current="page"]');
  await page.getByRole("textbox", { name: "What do you want to ask?" }).fill("What did Ada send?");
  await page.keyboard.press("Enter");
  const turns = page.locator(".ask-turn");
  await expect.poll(() => turns.count(), wait).toBe(2);
  const asked = await current.innerText();

  await scope.getByRole("link", { name: "All mailboxes" }).click();
  await expect.poll(() => current.innerText(), wait).toBe("All mailboxes");
  await page.getByText("Coo. Works in all your mailboxes, as itself").waitFor(wait);
  await page.getByRole("textbox", { name: "What do you want to ask?" }).fill("Anything at home?");
  await page.keyboard.press("Enter");

  await expect.poll(() => turns.count(), wait).toBe(4);
  await expect.poll(() => page.locator(".ask-turn-human .ask-where").allInnerTexts(), wait).toEqual([`in ${asked}`, "in All mailboxes"]);
  await expect.poll(() => turns.nth(3).locator(".ask-text").innerText(), wait).toBe("Nothing at home.");
  expect(await page.evaluate(() => location.hash)).toBe("#/agent");
});
