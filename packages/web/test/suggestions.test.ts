// Suggestions in the composer (#156): the rest of the sentence in grey after a pause in the text,
// which Tab takes, typing on passes by and Escape hides, and none in To or Subject.
import { expect, test } from "vitest";
import type { Suggester } from "@duva/api/suggestions";
import { startWebApp } from "./web-app.ts";

// As in inbox.test.ts, every wait has room for a page under the full suite's load.
const wait = { timeout: 10_000 };
const budget = { timeout: 60_000 };

/**
 * The web app for a deployment where the human Grace has a personal mailbox at grace@example.com,
 * signed "Grace", with a stand-in suggestion model that finishes "See you" as "See you on Friday.", and records
 * what it was asked.
 */
async function withGrace() {
  const asked: string[] = [];
  const suggester: Suggester = async ({ prompt }) => {
    asked.push(prompt);
    return { text: /so far: See you$/.test(prompt) ? "See you on Friday." : "", inputTokens: 400, outputTokens: 10 };
  };
  const app = await startWebApp({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org"], suggester });
  const ada = app.duva.signIn("ada@example.org");
  const { data: grace } = await app.duva.signIn("grace@example.org").GET("/whoami");
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: grace!.id, address: "grace@example.com" } });
  await app.duva.signIn("grace@example.org").PATCH("/mailboxes/{mailbox}/signature", { params: { path: { mailbox: mailbox!.id } }, body: { text: "Grace" } });
  await app.signIn("grace@example.org");
  await app.page.getByRole("button", { name: "Write" }).click();
  const message = app.page.getByLabel("Message", { exact: true });
  return { ...app, asked, message };
}

test("after a pause in the text, the rest of the sentence shows in grey after the cursor, and Tab takes it", budget, async () => {
  const { page, message } = await withGrace();
  await page.getByLabel("To", { exact: true }).fill("ada@example.org");
  await message.click();

  await page.keyboard.type("Hi Ada,\n\nSee you");

  await expect.poll(() => page.getByText("on Friday.", { exact: true }).isVisible(), wait).toBe(true);
  expect(await page.getByText("Suggested: “on Friday.”. Tab takes it.").count()).toBe(1);
  await page.keyboard.press("Tab");
  expect(await message.inputValue()).toBe("Hi Ada,\n\nSee you on Friday.");
  expect(await message.evaluate((text) => text === document.activeElement)).toBe(true);
  expect(await page.getByText("on Friday.", { exact: true }).count()).toBe(0);
  await page.keyboard.type(" Bye");
  expect(await message.inputValue()).toBe("Hi Ada,\n\nSee you on Friday. Bye");
});

test("typing on clears the suggestion, and Escape hides it", budget, async () => {
  const { page, message } = await withGrace();
  await message.click();
  await page.keyboard.type("See you");
  await expect.poll(() => page.getByText("on Friday.", { exact: true }).isVisible(), wait).toBe(true);

  await page.keyboard.type("!");

  expect(await page.getByText("on Friday.", { exact: true }).count()).toBe(0);
  expect(await message.inputValue()).toBe("See you!");
  await page.keyboard.press("Backspace");
  await expect.poll(() => page.getByText("on Friday.", { exact: true }).isVisible(), wait).toBe(true);
  await page.keyboard.press("Escape");
  expect(await page.getByText("on Friday.", { exact: true }).count()).toBe(0);
  await page.keyboard.press("Tab");
  expect(await message.inputValue()).toBe("See you");
});

test("nothing is suggested in To, Subject or the signature", budget, async () => {
  const { page, asked } = await withGrace();

  await page.getByLabel("To", { exact: true }).click();
  await page.keyboard.type("See you");
  await page.getByLabel("Subject", { exact: true }).click();
  await page.keyboard.type("See you");
  await page.getByLabel("Signature, for this message", { exact: true }).click();
  await page.keyboard.press("End");
  await page.keyboard.type("\nSee you");
  await page.waitForTimeout(1000);

  expect(await page.getByText("on Friday.", { exact: true }).count()).toBe(0);
  expect(asked).toEqual([]);
});
