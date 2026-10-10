import PostalMime from "postal-mime";
import { expect, test } from "vitest";
import { startWebApp } from "./web-app.ts";

// As in inbox.test.ts, every wait has room for a page under the full suite's load.
const wait = { timeout: 10_000 };
const budget = { timeout: 60_000 };

/** The web app for Grace, whose mailbox has grace@example.com and support@example.com, its Screener off. */
async function withGrace() {
  const app = await startWebApp({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org"] });
  const ada = app.duva.signIn("ada@example.org");
  const grace = app.duva.signIn("grace@example.org");
  const { data: me } = await grace.GET("/whoami");
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: me!.id, address: "grace@example.com" } });
  await ada.POST("/addresses", { body: { address: "support@example.com", mailbox: mailbox!.id } });
  const params = { path: { mailbox: mailbox!.id } };
  await grace.PATCH("/mailboxes/{mailbox}/screener", { params, body: { on: false } });
  return { ...app, grace, params };
}

test("Grace sets her mailbox's signature and her support address's own on the You page", budget, async () => {
  const { page, signIn, grace, params } = await withGrace();
  await signIn("grace@example.org");
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  const sheet = page.getByRole("region", { name: "Signature", exact: true });
  await expect.poll(() => sheet.isVisible(), wait).toBe(true);

  await sheet.getByRole("textbox", { name: "For the mailbox" }).fill("Grace Hopper\nhttps://example.com");
  await sheet.getByRole("textbox", { name: "support@example.com" }).fill("Example Support");
  await sheet.getByRole("button", { name: "Save" }).click();

  await expect.poll(() => sheet.getByRole("status").textContent(), wait).toBe("Saved.");
  expect((await grace.GET("/mailboxes/{mailbox}/signature", { params })).data).toEqual({
    text: "Grace Hopper\nhttps://example.com",
    addresses: [{ address: "grace@example.com" }, { address: "support@example.com", text: "Example Support" }],
  });
});

test("the composer shows the From's signature under the text, and choosing another From swaps it", budget, async () => {
  const { page, signIn, grace, params, duva } = await withGrace();
  await grace.PATCH("/mailboxes/{mailbox}/signature", { params, body: { text: "Grace Hopper" } });
  await grace.PATCH("/mailboxes/{mailbox}/signature", { params, body: { address: "support@example.com", text: "Example Support" } });
  await signIn("grace@example.org");

  await page.getByRole("button", { name: "Write" }).click();
  const signature = page.getByLabel("Signature, for this message", { exact: true });
  await expect.poll(() => signature.inputValue(), wait).toBe("Grace Hopper");
  await page.getByLabel("From", { exact: true }).selectOption("support@example.com");
  await expect.poll(() => signature.inputValue(), wait).toBe("Example Support");

  await page.getByLabel("To", { exact: true }).fill("ada@example.org");
  await page.getByLabel("Subject", { exact: true }).fill("Your ticket");
  await page.getByLabel("Message", { exact: true }).fill("It's fixed.");
  await page.getByRole("button", { name: "Send" }).click();

  await expect.poll(() => page.getByRole("status").filter({ hasText: "Sent to ada@example.org." }).count(), wait).toBe(1);
  expect((await PostalMime.parse(duva.sent().at(-1)!)).text).toBe("It's fixed.\n\n-- \nExample Support\n");
});

test("a signature changed or removed in one draft stays so in that draft only", budget, async () => {
  const { page, signIn, grace, params } = await withGrace();
  await grace.PATCH("/mailboxes/{mailbox}/signature", { params, body: { text: "Grace Hopper" } });
  await signIn("grace@example.org");

  await page.getByRole("button", { name: "Write" }).click();
  const signature = page.getByLabel("Signature, for this message", { exact: true });
  await expect.poll(() => signature.inputValue(), wait).toBe("Grace Hopper");
  await page.getByLabel("Subject", { exact: true }).fill("Casual");
  await signature.fill("G");
  const signatures = async () => (await grace.GET("/mailboxes/{mailbox}/drafts", { params })).data!.drafts.map(({ subject, signature }) => [subject, signature ?? null]);
  await expect.poll(signatures, wait).toEqual([["Casual", "G"]]);
  await page.getByRole("navigation").getByRole("link", { name: "Drafts" }).click();

  await page.getByRole("button", { name: "Write" }).click();
  await expect.poll(() => page.getByLabel("Signature, for this message", { exact: true }).inputValue(), wait).toBe("Grace Hopper");
  await page.getByLabel("Subject", { exact: true }).fill("Without");
  await page.getByRole("button", { name: "Remove signature" }).click();
  expect(await page.getByLabel("Signature, for this message", { exact: true }).count()).toBe(0);
  await expect.poll(signatures, wait).toEqual([
    ["Without", null],
    ["Casual", "G"],
  ]);

  // Opened again, each draft shows what its writer left, and the mailbox keeps its own.
  await page.getByRole("navigation").getByRole("link", { name: "Drafts" }).click();
  await page.getByRole("list", { name: "Drafts" }).getByRole("link").filter({ hasText: "Casual" }).click();
  await expect.poll(() => page.getByLabel("Signature, for this message", { exact: true }).inputValue(), wait).toBe("G");
  expect((await grace.GET("/mailboxes/{mailbox}/signature", { params })).data?.text).toBe("Grace Hopper");
});
