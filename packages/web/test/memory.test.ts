import { expect, test } from "vitest";
import type { DuvaOptions } from "@duva/api/harness";
import type { Page } from "playwright-core";
import { startWebApp } from "./web-app.ts";

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

const dentist =
  "From: Folktandvården <noreply@folktandvarden.example.se>\r\nTo: grace@example.com\r\nSubject: Påminnelse om din tid\r\nDate: Sun, 04 Oct 2026 09:00:00 +0200\r\nMessage-ID: <tid@example.se>\r\n\r\nDu har en tid tisdagen den 20 oktober kl. 08.30.\r\n";

/** Opens What Coo remembers from Settings' index, as the human does. */
async function openMemory(page: Page) {
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: "What Coo remembers", exact: true }).click();
}

/** The web app for a deployment where the human Grace has a mailbox at grace@example.com with mail from her dentist, and Claude Sonnet 5.5 does every job. */
async function withMailbox(options: Parameters<typeof startWebApp>[0] = {}) {
  const app = await startWebApp({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org"], ...options });
  const ada = app.duva.signIn("ada@example.org");
  await ada.PATCH("/organization/settings", { body: { mailboxAgentModel: "anthropic.claude-sonnet-5-5" } });
  const grace = app.duva.signIn("grace@example.org");
  const { data: whoami } = await grace.GET("/whoami");
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: whoami!.id, address: "grace@example.com" } });
  const params = { params: { path: { mailbox: mailbox!.id } } };
  await grace.PATCH("/mailboxes/{mailbox}/screener", { ...params, body: { on: false } });
  await app.duva.receive(dentist, { to: ["grace@example.com"] });
  const thread = (await grace.GET("/mailboxes/{mailbox}/threads", params)).data!.threads[0]!.id;
  return { ...app, grace, thread };
}

test("a human reads what Coo remembers and where each came from, corrects one, forgets one, and then everything", budget, async () => {
  const { page, signIn, grace, thread } = await withMailbox();
  await grace.POST("/memories", { body: { text: "Grace prefers mornings." } });
  await grace.POST("/memories", { body: { text: "Grace sees the dentist on 20 October.", threads: [thread] } });
  await grace.POST("/memories", { body: { text: "Grace's partner is Sam." } });
  await signIn("grace@example.org");

  await openMemory(page);
  await page.getByRole("heading", { level: 2, name: "What Coo remembers" }).waitFor(wait);
  const lines = page.locator(".memory-line");
  await expect.poll(() => lines.count(), wait).toBe(3);
  const dentistLine = lines.filter({ hasText: "Grace sees the dentist on 20 October." });
  expect(await dentistLine.locator(".memory-source").innerText()).toMatch(/^From Påminnelse om din tid, kept /);
  expect(await lines.filter({ hasText: "Grace prefers mornings." }).locator(".memory-source").innerText()).toMatch(/^You told me, kept /);

  const partner = lines.filter({ hasText: "Grace's partner is Sam." });
  await partner.getByRole("button", { name: "Correct" }).click();
  await page.getByRole("textbox", { name: "Correct: Grace's partner is Sam." }).fill("Grace's partner is Robin.");
  await page.locator(".memory-correct").getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Corrected." }).waitFor(wait);
  await lines.filter({ hasText: "Grace's partner is Robin." }).waitFor(wait);

  await lines.filter({ hasText: "Grace prefers mornings." }).getByRole("button", { name: "Forget" }).click();
  await page.getByText("Forgot: Grace prefers mornings.").waitFor(wait);
  await expect.poll(() => lines.count(), wait).toBe(2);

  await page.getByRole("button", { name: "Forget everything" }).click();
  await page.getByText("Coo forgets all 2 memories. This can't be undone.").waitFor(wait);
  await page.getByRole("group", { name: "Forget everything" }).getByRole("button", { name: "Forget everything" }).click();
  await page.getByText("Coo remembers nothing yet.").waitFor(wait);
  expect((await grace.GET("/memories")).data!.memories).toEqual([]);
});

test("a memory learned from mail links to its thread", budget, async () => {
  const { page, signIn, grace, thread } = await withMailbox();
  await grace.POST("/memories", { body: { text: "Grace sees the dentist on 20 October.", threads: [thread] } });
  await signIn("grace@example.org");

  await openMemory(page);
  await page.getByRole("link", { name: "Påminnelse om din tid" }).click();

  await page.getByRole("heading", { level: 1, name: "Påminnelse om din tid" }).waitFor(wait);
});

test("a human switches Coo's learning from mail off, which the index then says", budget, async () => {
  const { page, signIn, grace } = await withMailbox();
  await signIn("grace@example.org");
  await openMemory(page);
  await page.getByRole("heading", { level: 2, name: "What Coo remembers" }).waitFor(wait);

  await page.getByRole("group", { name: "Learning from mail" }).getByText("Off", { exact: true }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();

  await page.getByText("Saved.").waitFor(wait);
  expect((await grace.GET("/preferences")).data!.cooLearnsFromMail).toBe("off");
  await expect.poll(() => page.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: "What Coo remembers", exact: true }).getAttribute("aria-describedby").then((id) => page.locator(`#${id}`).innerText()), wait).toBe("Nothing yet, not learning from mail");
});

test("the first time Coo keeps a memory from mail, its answer says so once, linking to what it remembers", budget, async () => {
  let thread = "";
  const model = scripted(
    () => [use("keepMemory", { text: "Grace sees the dentist on 20 October.", threads: [thread] })],
    () => [{ text: "Your dentist is on the 20th." }],
    () => [{ text: "Hello." }],
  );
  const app = await withMailbox({ model });
  thread = app.thread;
  const { page, signIn } = app;
  await signIn("grace@example.org");

  await page.getByRole("link", { name: "Ask Coo", exact: true }).click();
  await page.getByRole("textbox", { name: "What do you want to ask?" }).fill("When is my dentist?");
  await page.keyboard.press("Enter");
  const turns = page.locator(".ask-turn");
  await expect.poll(() => turns.nth(1).locator(".ask-text").innerText(), wait).toBe("Your dentist is on the 20th.");
  expect(await turns.nth(1).locator(".ask-step").allInnerTexts()).toEqual(["Kept a memory from the thread"]);
  await page.getByRole("textbox", { name: "What do you want to ask?" }).fill("Hi");
  await page.keyboard.press("Enter");
  await expect.poll(() => turns.nth(3).locator(".ask-text").innerText(), wait).toBe("Hello.");

  expect(await page.locator(".ask-memory").allInnerTexts()).toEqual(["From now on I remember what your mail teaches me, and forget it when the mail is erased. See what I remember"]);
  await page.getByRole("link", { name: "See what I remember" }).click();
  await page.getByRole("heading", { level: 2, name: "What Coo remembers" }).waitFor(wait);
  await page.getByText("Grace sees the dentist on 20 October.").waitFor(wait);
});
