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

  // The forward opens at the thread's foot, under the message, with the cursor in To.
  const forward = page.getByRole("form", { name: "Forward" });
  await expect.poll(() => forward.getByLabel("Subject", { exact: true }).inputValue(), wait).toBe("Fwd: Ritningar");
  expect(await forward.getByLabel("To", { exact: true }).evaluate((field) => field === document.activeElement)).toBe(true);
  expect(await page.getByLabel("Message", { exact: true }).inputValue()).toContain("> Här är ritningarna.");
  expect(await forward.getByRole("region", { name: "Attachments" }).innerText()).toContain("blå æble.txt");
  await page.getByLabel("To", { exact: true }).fill("iris@example.net");
  await page.getByRole("button", { name: "Send" }).click();
  await expect.poll(() => page.getByRole("article").count(), wait).toBe(2);

  // The API's tests read the MIME whole. Here it's enough that the attachment went with it.
  expect(duva.sent()[0]).toContain("filename*=UTF-8''bl%C3%A5%20%C3%A6ble.txt");
});

/** The web app for a deployment where the human Grace has a personal mailbox at grace@example.com, and is signed in. */
async function withGrace() {
  const app = await startWebApp({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org"] });
  const ada = app.duva.signIn("ada@example.org");
  const grace = app.duva.signIn("grace@example.org");
  const { data: me } = await grace.GET("/whoami");
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: me!.id, address: "grace@example.com" } });
  await app.signIn("grace@example.org");
  return { ...app, grace, mailbox: mailbox! };
}

test("a human attaches files with Attach files and by dropping them on the draft, removes one, and sends the rest", budget, async () => {
  const { page, duva } = await withGrace();
  await page.getByRole("button", { name: "Write" }).click();
  await page.getByLabel("To", { exact: true }).fill("ada@example.org");
  await page.getByLabel("Subject", { exact: true }).fill("Planen");

  const [chooser] = await Promise.all([page.waitForEvent("filechooser", wait), page.getByRole("button", { name: "Attach files" }).click()]);
  await chooser.setFiles({ name: "plan.txt", mimeType: "text/plain", buffer: Buffer.from("Planen är") });
  const files = page.getByRole("region", { name: "Attachments" });
  await expect.poll(() => files.getByRole("button", { name: "Download plan.txt" }).count(), wait).toBe(1);
  expect(await files.innerText()).toContain("text/plain, 10 bytes");

  // A file dragged from the desktop and dropped anywhere on the draft.
  await page.getByRole("form", { name: "New message" }).evaluate((form) => {
    const carried = new DataTransfer();
    carried.items.add(new File(["# Anteckningar"], "anteckningar.md", { type: "text/markdown" }));
    for (const type of ["dragenter", "dragover", "drop"]) form.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: carried }));
  });
  await expect.poll(() => files.getByRole("button", { name: "Download anteckningar.md" }).count(), wait).toBe(1);

  await files.getByRole("button", { name: "Remove plan.txt" }).click();
  await expect.poll(() => files.getByRole("button", { name: "Remove plan.txt" }).count(), wait).toBe(0);
  await page.getByRole("button", { name: "Send" }).click();

  await expect.poll(() => page.getByRole("status").filter({ hasText: "Sent to ada@example.org." }).count(), wait).toBe(1);
  expect(duva.sent()[0]).toContain('filename*=UTF-8\'\'anteckningar.md');
  expect(duva.sent()[0]).not.toContain("plan.txt");
});

test("a sponsor sees each file of an agent's pending send in Approvals, with its size, and opens it before deciding", budget, async () => {
  const { page, duva, grace, mailbox } = await withGrace();
  const { data: created } = await grace.POST("/agents", { body: { name: "Hermes" } });
  await grace.PATCH("/agents/{agent}/settings", { params: { path: { agent: created!.agent.id } }, body: { sponsorAccess: "send" } });
  const hermes = duva.withKey(created!.key);
  const path = { mailbox: mailbox.id };
  const { data: draft } = await hermes.POST("/mailboxes/{mailbox}/drafts", { params: { path }, body: { to: ["ada@example.org"], subject: "Offerten", text: "Offerten bifogas." } });
  const at = { ...path, draft: draft!.id };
  const { data: upload } = await hermes.POST("/mailboxes/{mailbox}/drafts/{draft}/uploads", { params: { path: at }, body: { name: "offert.pdf", type: "application/pdf", size: 11 } });
  await duva.upload(upload!.parts[0]!.url, Buffer.from("Hello, PDF!"));
  await hermes.POST("/mailboxes/{mailbox}/drafts/{draft}/uploads/{upload}/complete", { params: { path: { ...at, upload: upload!.id } } });
  await hermes.POST("/mailboxes/{mailbox}/drafts/{draft}/send", { params: { path: at } });

  await page.getByRole("navigation").getByRole("link", { name: /^Approvals/ }).click();
  const file = page.getByRole("button", { name: "Download offert.pdf" });
  await expect.poll(() => file.count(), wait).toBe(1);
  expect(await page.getByRole("region", { name: "Attachments" }).innerText()).toContain("application/pdf, 11 bytes");
  const [download] = await Promise.all([page.waitForEvent("download", wait), file.click()]);

  expect(download.suggestedFilename()).toBe("offert.pdf");
  expect(await readFile(await download.path(), "utf8")).toBe("Hello, PDF!");
});
