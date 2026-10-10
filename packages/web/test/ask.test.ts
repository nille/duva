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
  if (models !== "defaults") await ada.PATCH("/organization/settings", { body: { mailboxAgentAllowedModels: [...new Set(["anthropic.claude-haiku-4-5-20251001-v1:0", "anthropic.claude-sonnet-5-5", everyday] as const)], mailboxAgentModel: everyday } });
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

test("an admin allows measured models, each flagged with where it processes mail, sets the organization's models among them and the spend cap, and reads what they spent", budget, async () => {
  const { page, signIn, duva } = await withMailbox({ models: "defaults" });
  await signIn("ada@example.org");
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: /^Mail and agents/ }).click();
  const sheet = page.getByRole("region", { name: "Mailbox agents" });
  await sheet.getByText("Spent $0.00 in").waitFor(wait);
  const haiku = sheet.getByRole("checkbox", { name: /^Claude Haiku 4\.5/ });
  const novaLite = sheet.getByRole("checkbox", { name: /^Amazon Nova Lite/ });
  await haiku.waitFor(wait);
  // The organization's own models stay allowed while they are its models.
  expect(await haiku.isChecked()).toBe(true);
  expect(await haiku.isDisabled()).toBe(true);
  expect(await sheet.getByRole("checkbox", { name: /^Claude Sonnet 5\.5/ }).isChecked()).toBe(true);
  expect(await novaLite.isChecked()).toBe(false);
  // Each model is flagged with where it processes mail, which a screen reader hears as a sentence.
  for (const [model, place] of [["Claude Haiku 4\\.5", "the EU"], ["Claude Sonnet 5\\.5", "the EU"], ["Amazon Nova 2 Lite", "the EU"], ["Amazon Nova Lite", "eu-north-1"], ["Amazon Nova Pro", "the EU"]]) {
    expect(await sheet.getByRole("checkbox", { name: new RegExp(`^${model}\\s*, processed in ${place}`) }).count()).toBe(1);
  }
  expect(await sheet.getByText("Questions 100%, drafting 100%, triage 75%, label tasks 100%. About 2.0 cents a task.").isVisible()).toBe(true);
  expect(await sheet.getByRole("combobox", { name: "Everyday model" }).inputValue()).toBe("anthropic.claude-haiku-4-5-20251001-v1:0");
  expect(await sheet.getByRole("combobox", { name: "Harder model" }).inputValue()).toBe("anthropic.claude-sonnet-5-5");
  expect(await sheet.getByRole("checkbox", { name: /^Ask the decider first/ }).isChecked()).toBe(false);

  // Nova Lite runs in eu-north-1 itself, inside the deployment's continent, so it is allowed at once.
  await novaLite.check();
  await sheet.getByRole("combobox", { name: "Everyday model" }).selectOption({ label: "Amazon Nova Lite, in eu-north-1" });
  await sheet.getByRole("checkbox", { name: /^Ask the decider first/ }).check();
  await sheet.getByRole("textbox", { name: "US dollars a month" }).fill("5");
  await sheet.getByRole("button", { name: "Save" }).click();

  await expect.poll(async () => (await duva.signIn("ada@example.org").GET("/organization/settings")).data, wait).toMatchObject({
    mailboxAgentAllowedModels: ["anthropic.claude-haiku-4-5-20251001-v1:0", "anthropic.claude-sonnet-5-5", "amazon.nova-lite-v1:0"],
    mailboxAgentModel: "amazon.nova-lite-v1:0",
    mailboxAgentHarderModel: "anthropic.claude-sonnet-5-5",
    mailboxAgentDecider: true,
    mailboxAgentSpendCap: 5,
  });
  // Haiku is no longer the everyday model, so it may be taken off the list.
  expect(await haiku.isDisabled()).toBe(false);
});

test("allowing a model that processes mail outside the deployment's continent says so first, and waits for the admin", budget, async () => {
  // In Sydney, Claude runs only through the global profile, so anywhere, and Nova Lite through the US's.
  const { page, signIn, duva } = await withMailbox({ models: "defaults", region: "ap-southeast-2" });
  await signIn("ada@example.org");
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: /^Mail and agents/ }).click();
  const sheet = page.getByRole("region", { name: "Mailbox agents" });
  const novaLite = sheet.getByRole("checkbox", { name: /^Amazon Nova Lite/ });
  await novaLite.waitFor(wait);
  expect(await sheet.getByRole("checkbox", { name: /^Claude Haiku 4\.5\s*, processed in any AWS region with room/ }).count()).toBe(1);
  expect(await sheet.getByRole("checkbox", { name: /^Amazon Nova Lite\s*, processed in the US/ }).count()).toBe(1);

  await novaLite.click();
  const said = sheet.getByRole("alert").filter({ hasText: "Amazon Nova Lite processes what Coo reads of the mail in the US, outside the continent Duva is deployed on." });
  await said.waitFor(wait);
  expect(await novaLite.isChecked()).toBe(false);
  await said.getByRole("button", { name: "Keep it off" }).click();
  expect(await novaLite.isChecked()).toBe(false);
  expect(await said.count()).toBe(0);
  await novaLite.click();
  await said.getByRole("button", { name: "Allow it" }).click();
  expect(await novaLite.isChecked()).toBe(true);
  await sheet.getByRole("button", { name: "Save" }).click();

  await expect.poll(async () => (await duva.signIn("ada@example.org").GET("/organization/settings")).data!.mailboxAgentAllowedModels, wait).toContain("amazon.nova-lite-v1:0");
});

test("a human picks their Coo's everyday model from those admins allow, each flagged with where it processes mail, and keeps the organization's harder one", budget, async () => {
  const { page, signIn, duva } = await withMailbox({ models: "defaults" });
  await duva.signIn("ada@example.org").PATCH("/organization/settings", { body: { mailboxAgentAllowedModels: ["anthropic.claude-haiku-4-5-20251001-v1:0", "anthropic.claude-sonnet-5-5", "amazon.nova-lite-v1:0"] } });
  await signIn("grace@example.org");
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: /^Preferences/ }).click();
  const sheet = page.getByRole("region", { name: "Coo's models" });
  const everyday = sheet.getByRole("group", { name: "Everyday model" });
  const organizations = everyday.getByRole("radio", { name: /^The organization's, Claude Haiku 4\.5/ });
  await organizations.waitFor(wait);
  expect(await organizations.isChecked()).toBe(true);
  // Nova Pro and Nova 2 Lite aren't allowed, so they aren't offered.
  for (const name of ["Claude Haiku 4\\.5\\s*, processed in the EU", "Claude Sonnet 5\\.5\\s*, processed in the EU", "Amazon Nova Lite\\s*, processed in eu-north-1"]) {
    expect(await everyday.getByRole("radio", { name: new RegExp(`^${name}`) }).count()).toBe(1);
  }
  expect(await everyday.getByRole("radio").count()).toBe(4);  await everyday.getByRole("radio", { name: /^Amazon Nova Lite/ }).check();
  await sheet.getByRole("button", { name: "Save" }).click();
  await sheet.getByText("Saved. Coo thinks with these from its next run.").waitFor(wait);

  const { data } = await duva.signIn("grace@example.org").GET("/preferences");
  expect(data).toMatchObject({ cooEverydayModel: "amazon.nova-lite-v1:0" });
  expect(data).not.toHaveProperty("cooHarderModel");
  expect(await sheet.getByRole("group", { name: "Harder model" }).getByRole("radio", { name: /^The organization's, Claude Sonnet 5\.5/ }).isChecked()).toBe(true);
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
