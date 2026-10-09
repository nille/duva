import { expect, test } from "vitest";
import { startWebApp } from "./web-app.ts";

// As in inbox.test.ts, every wait has room for a page under the full suite's load.
const wait = { timeout: 10_000 };
const budget = { timeout: 60_000 };

/** A message from Ada to Grace, with a long folded field and a subject in encoded words. */
const invoice = [
  "DKIM-Signature: v=1; a=rsa-sha256; d=example.org; s=mail;",
  " h=from:to:subject:date; bh=YWJj; b=ZGVm",
  "From: Ada Lovelace <ada@example.org>",
  "To: Grace <grace@example.com>",
  "Subject: =?UTF-8?B?UsOka25pbmc=?=",
  "Date: Sun, 04 Oct 2026 09:00:00 +0200",
  "Message-ID: <invoice@example.org>",
  "",
  "Här är räkningen.",
].join("\r\n");

/** The web app for a deployment where the human Grace has a personal mailbox at grace@example.com, with the invoice open from its Inbox. */
async function withInvoice(viewport?: { width: number; height: number }) {
  const app = await startWebApp({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org"], ...(viewport && { viewport }) });
  const ada = app.duva.signIn("ada@example.org");
  const { data: grace } = await app.duva.signIn("grace@example.org").GET("/whoami");
  const { data: graceMailbox } = await ada.POST("/mailboxes", { body: { owner: grace!.id, address: "grace@example.com" } });
  // Mail from first-time senders would wait in the Screener, which these tests leave out.
  await app.duva.signIn("grace@example.org").PATCH("/mailboxes/{mailbox}/screener", { params: { path: { mailbox: graceMailbox!.id } }, body: { on: false } });
  await app.duva.receive(invoice, { to: ["grace@example.com"] });
  await app.signIn("grace@example.org");
  await app.page.getByRole("link", { name: /Räkning/ }).first().click();
  return app;
}

test("a human shows a message's headers from its menu, copies them and closes the sheet with Escape", budget, async () => {
  const { page } = await withInvoice();
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const menu = page.getByRole("button", { name: "Message actions" });
  await expect.poll(() => menu.count(), wait).toBe(1);

  await menu.click();
  await page.getByRole("menuitem", { name: "Show headers" }).click();

  const sheet = page.getByRole("dialog", { name: "Headers" });
  await expect.poll(() => sheet.getByRole("term").count(), wait).toBeGreaterThan(5);
  const fields = await sheet.getByRole("term").allInnerTexts();
  expect(fields.slice(-6)).toEqual(["DKIM-Signature", "From", "To", "Subject", "Date", "Message-ID"]);
  expect(fields[0]).toBe("Return-Path");
  expect(await sheet.innerText()).toContain("v=1; a=rsa-sha256; d=example.org; s=mail; h=from:to:subject:date; bh=YWJj; b=ZGVm");
  // The subject shows as it came, and decoded beside it.
  expect(await sheet.getByRole("definition").nth(fields.indexOf("Subject")).innerText()).toMatch(/=\?UTF-8\?B\?UsOka25pbmc=\?=\s+Decoded\s+Räkning/);

  await sheet.getByRole("button", { name: "Copy" }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText()), wait).toContain("\nSubject: =?UTF-8?B?UsOka25pbmc=?=\nDate: Sun, 04 Oct 2026 09:00:00 +0200\n");
  expect(await sheet.getByRole("button", { name: "Copied" }).count()).toBe(1);

  await page.keyboard.press("Escape");
  await expect.poll(() => sheet.count(), wait).toBe(0);
  // Escape put the sheet away and left the thread open, with the focus back on the menu's button.
  expect(await page.getByRole("heading", { level: 1, name: "Räkning" }).count()).toBe(1);
  expect(await menu.evaluate((button) => button === document.activeElement)).toBe(true);
});

test("on a phone the headers take the whole screen, and Done closes them", budget, async () => {
  const { page } = await withInvoice({ width: 390, height: 844 });
  const menu = page.getByRole("button", { name: "Message actions" });
  await expect.poll(() => menu.count(), wait).toBe(1);

  await menu.click();
  await page.getByRole("menuitem", { name: "Show headers" }).click();

  const sheet = page.getByRole("dialog", { name: "Headers" });
  await expect.poll(() => sheet.getByRole("term").count(), wait).toBeGreaterThan(5);
  expect(await sheet.boundingBox()).toEqual({ x: 0, y: 0, width: 390, height: 844 });
  await sheet.getByRole("button", { name: "Done" }).click();
  await expect.poll(() => sheet.count(), wait).toBe(0);
});
