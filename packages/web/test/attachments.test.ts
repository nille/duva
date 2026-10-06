import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { startWebApp } from "./web-app.ts";

// As in inbox.test.ts, every wait has room for a page under the full suite's load.
const wait = { timeout: 10_000 };
const budget = { timeout: 60_000 };

/** A message from Ada to Grace with drawings attached, one of them with a Danish and Swedish name. */
const drawings = [
  "From: Ada Lovelace <ada@example.org>",
  "To: Grace <grace@example.com>",
  "Subject: Ritningar",
  "Date: Sun, 04 Oct 2026 09:00:00 +0200",
  "Message-ID: <drawings@example.org>",
  "MIME-Version: 1.0",
  'Content-Type: multipart/mixed; boundary="part"',
  "",
  "--part",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "Här är ritningarna.",
  "--part",
  "Content-Type: text/plain; charset=utf-8",
  "Content-Disposition: attachment; filename*=UTF-8''bl%C3%A5%20%C3%A6ble.txt",
  "Content-Transfer-Encoding: base64",
  "",
  Buffer.from("Ritning ett.").toString("base64"),
  "--part--",
].join("\r\n");

/** The web app for a deployment where the human Grace has a personal mailbox at grace@example.com, with the drawings in its Inbox. */
async function withDrawings() {
  const app = await startWebApp({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org"] });
  const ada = app.duva.signIn("ada@example.org");
  const { data: grace } = await app.duva.signIn("grace@example.org").GET("/whoami");
  const { data: graceMailbox } = await ada.POST("/mailboxes", { body: { owner: grace!.id, address: "grace@example.com" } });
  // Mail from first-time senders would wait in the Screener, which these tests leave out.
  await app.duva.signIn("grace@example.org").PATCH("/mailboxes/{mailbox}/screener", { params: { path: { mailbox: graceMailbox!.id } }, body: { on: false } });
  await app.duva.receive(drawings, { to: ["grace@example.com"] });
  await app.signIn("grace@example.org");
  await app.page.getByRole("link", { name: /Ritningar/ }).click();
  return app;
}

test("a human downloads an attachment from the thread, under its own name", budget, async () => {
  const { page } = await withDrawings();
  const attachment = page.getByRole("button", { name: "Download blå æble.txt" });
  await expect.poll(() => attachment.count(), wait).toBe(1);

  const [download] = await Promise.all([page.waitForEvent("download", wait), attachment.click()]);

  expect(download.suggestedFilename()).toBe("blå æble.txt");
  expect(await readFile(await download.path(), "utf8")).toBe("Ritning ett.");
});

test("a human forwards a message, and it goes out with its attachments", budget, async () => {
  const { page, duva } = await withDrawings();
  await page.getByRole("button", { name: "Forward" }).click();

  await expect.poll(() => page.getByLabel("Subject", { exact: true }).inputValue(), wait).toBe("Fwd: Ritningar");
  expect(await page.getByLabel("Message", { exact: true }).inputValue()).toContain("> Här är ritningarna.");
  expect(await page.getByRole("region", { name: "Attachments" }).innerText()).toContain("blå æble.txt");
  await page.getByLabel("To", { exact: true }).fill("iris@example.net");
  await page.getByRole("button", { name: "Send" }).click();
  await expect.poll(() => page.getByRole("status").filter({ hasText: "Sent" }).count(), wait).toBeGreaterThan(0);

  // The API's tests read the MIME whole. Here it's enough that the attachment went with it.
  expect(duva.sent()[0]).toContain("filename*=UTF-8''bl%C3%A5%20%C3%A6ble.txt");
  await page.getByRole("link", { name: "Open the thread" }).click();
  await expect.poll(() => page.getByRole("article").count(), wait).toBe(2);
});
