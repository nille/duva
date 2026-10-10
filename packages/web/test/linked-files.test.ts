import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { startWebApp } from "./web-app.ts";

// As in inbox.test.ts, every wait has room for a page under the full suite's load.
const wait = { timeout: 10_000 };
const budget = { timeout: 60_000 };

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

/** Grace sends Ada a film as a linked file, through the API, and gives the link to its page. */
async function sendFilm({ duva, grace, mailbox }: Awaited<ReturnType<typeof withGrace>>) {
  const path = { mailbox: mailbox.id };
  const { data: draft } = await grace.POST("/mailboxes/{mailbox}/drafts", { params: { path }, body: { to: ["ada@example.org"], subject: "Filmen", text: "Here is the film." } });
  const at = { ...path, draft: draft!.id };
  const { data: upload } = await grace.POST("/mailboxes/{mailbox}/drafts/{draft}/uploads", { params: { path: at }, body: { name: "film.mov", type: "video/quicktime", size: 8 } });
  await duva.upload(upload!.parts[0]!.url, Buffer.from("En film."));
  await grace.POST("/mailboxes/{mailbox}/drafts/{draft}/uploads/{upload}/complete", { params: { path: { ...at, upload: upload!.id } } });
  await grace.PATCH("/mailboxes/{mailbox}/drafts/{draft}/attachments/{attachment}", { params: { path: { ...at, attachment: upload!.id } }, body: { linked: true } });
  await grace.POST("/mailboxes/{mailbox}/drafts/{draft}/send", { params: { path: at } });
  // The text is ASCII, so the raw message carries it as it is.
  return /https?:\/\/\S+\/download\/files\/[\w-]+/.exec(duva.sent().at(-1)!)![0];
}

test("the composer shows which files go as links, a large one by itself and a small one by choice, and how long the links work", budget, async () => {
  const { page, duva } = await withGrace();
  await page.getByRole("button", { name: "Write" }).click();
  await page.getByLabel("To", { exact: true }).fill("ada@example.org");
  await page.getByLabel("Subject", { exact: true }).fill("Filmen");

  const [chooser] = await Promise.all([page.waitForEvent("filechooser", wait), page.getByRole("button", { name: "Attach files" }).click()]);
  await chooser.setFiles([
    { name: "film.mov", mimeType: "video/quicktime", buffer: Buffer.alloc(11 * 1024 * 1024) },
    { name: "plan.txt", mimeType: "text/plain", buffer: Buffer.from("Planen") },
  ]);
  const files = page.getByRole("region", { name: "Attachments" });
  await expect.poll(() => files.getByRole("button", { name: "Download plan.txt" }).count(), wait).toBe(1);
  await expect.poll(() => files.getByRole("button", { name: "Download film.mov" }).count(), wait).toBe(1);
  const line = (name: string) => files.getByRole("listitem").filter({ hasText: name });
  expect(await line("film.mov").innerText()).toContain("Link");
  expect(await line("film.mov").innerText()).toContain("too large to carry, so it goes as a link");
  // Duva links the large one, so it can't be attached instead.
  expect(await files.getByRole("button", { name: "Attach film.mov instead" }).count()).toBe(0);

  await files.getByRole("button", { name: "Link plan.txt instead" }).click();
  await expect.poll(() => line("plan.txt").innerText(), wait).toContain("goes as a link");
  await files.getByLabel("Links work for").selectOption({ label: "a year" });
  await expect.poll(() => files.getByLabel("Links work for").inputValue(), wait).toBe("365");
  await page.getByRole("button", { name: "Send" }).click();

  await expect.poll(() => page.getByRole("status").filter({ hasText: "Sent to ada@example.org." }).count(), wait).toBe(1);
  expect(duva.sent()[0]).toMatch(/2 files, until \d+ \w+ 2027/);
});

test("a sent message lists its linked files with their downloads, and Stop sharing ends a link", budget, async () => {
  const app = await withGrace();
  const page = await sendFilm(app);
  await app.duva.download(`${page}/file`);
  await app.page.getByRole("navigation").getByRole("link", { name: /^Sent/ }).click();
  await app.page.getByRole("link", { name: /Filmen/ }).click();

  const linked = app.page.getByRole("region", { name: "Linked files" });
  await expect.poll(() => linked.innerText(), wait).toMatch(/film\.mov\s+8 bytes, until .+, downloaded once/);
  expect(await app.page.getByRole("article").innerText()).not.toContain("download/files");
  await linked.getByRole("button", { name: "Stop sharing film.mov" }).click();

  await expect.poll(() => linked.innerText(), wait).toContain("8 bytes, no longer shared, downloaded once");
  expect((await app.duva.download(page)).status).toBe(410);
});

test("a linked file's page shows the file and its sender, its Download button saves it, and Coo says it was downloaded", budget, async () => {
  const app = await withGrace();
  const link = await sendFilm(app);
  const visitor = await app.page.context().newPage();
  await visitor.goto(link);

  expect(await visitor.getByRole("heading", { level: 1 }).textContent()).toBe("film.mov");
  expect(await visitor.locator("main").innerText()).toContain("grace@example.com sent you a file.");
  const [download] = await Promise.all([visitor.waitForEvent("download", wait), visitor.getByRole("button", { name: "Download" }).click()]);

  expect(download.suggestedFilename()).toBe("film.mov");
  expect(await readFile(await download.path(), "utf8")).toBe("En film.");
  const says = app.page.getByRole("status").filter({ hasText: /^Coo\./ });
  await expect.poll(() => says.textContent(), wait).toBe("Coo. film.mov was downloaded.");
});
