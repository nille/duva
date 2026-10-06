import { expect, test } from "vitest";
import { startWebApp } from "./web-app.ts";

// The page reads the change feeds every 250 ms in these tests, but a page under the full suite's
// load can still take seconds to show what changed, so every wait has room, and every test more.
const wait = { timeout: 10_000 };
const budget = { timeout: 60_000 };

/** A message from Ada to Grace that starts its own thread. */
const note = (subject: string) =>
  [
    "From: Ada Lovelace <ada@example.org>",
    "To: Grace <grace@example.com>",
    `Subject: ${subject}`,
    "Date: Sun, 04 Oct 2026 09:00:00 +0200",
    `Message-ID: <${subject.replaceAll(" ", "-")}@example.org>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    "Hej Grace.",
  ].join("\r\n");

/** The web app for a deployment where the human Grace has a personal mailbox, with the threads in Trash and the rest in her Inbox, showing Trash. */
async function withTrash({ trashed, kept }: { trashed: string[]; kept: string[] }) {
  const app = await startWebApp({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org"] });
  const ada = app.duva.signIn("ada@example.org");
  const grace = app.duva.signIn("grace@example.org");
  const { data: me } = await grace.GET("/whoami");
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: me!.id, address: "grace@example.com" } });
  // Mail from first-time senders would wait in the Screener, which these tests leave out.
  await app.duva.signIn("grace@example.org").PATCH("/mailboxes/{mailbox}/screener", { params: { path: { mailbox: mailbox!.id } }, body: { on: false } });
  const params = { path: { mailbox: mailbox!.id } };
  for (const subject of [...trashed, ...kept]) await app.duva.receive(note(subject), { to: ["grace@example.com"] });
  const { data: inbox } = await grace.GET("/mailboxes/{mailbox}/threads", { params });
  const threads = inbox!.threads.filter(({ subject }) => trashed.includes(subject)).map(({ id }) => id);
  if (threads.length > 0) await grace.POST("/mailboxes/{mailbox}/threads/labels", { params, body: { threads, add: ["trash"] } });
  await app.signIn("grace@example.org");
  const { page } = app;
  const listed = () => page.getByRole("list", { name: "Threads" }).getByRole("link").evaluateAll((links) => links.map((link) => link.querySelector(".thread-subject")?.textContent ?? ""));
  const heading = () => page.getByRole("heading", { level: 1 }).textContent();
  const open = async (view: string) => {
    await page.getByRole("navigation", { name: "Mail" }).getByRole("link", { name: new RegExp(`^${view}`) }).click();
    await expect.poll(heading, wait).toBe(view);
  };
  await expect.poll(heading, wait).toBe("Inbox");
  await open("Trash");
  return { ...app, listed, open };
}

test("emptying Trash asks first, then erases its threads for good", budget, async () => {
  const { page, listed, open } = await withTrash({ trashed: ["Ett", "Tre"], kept: ["Två"] });
  await expect.poll(listed, wait).toEqual(["Tre", "Ett"]);

  await page.getByRole("button", { name: "Empty Trash" }).click();
  expect(await page.getByText("Erase every thread in Trash for good? This can't be undone.").isVisible()).toBe(true);
  await page.getByRole("button", { name: "Cancel" }).click();
  expect(await listed()).toEqual(["Tre", "Ett"]);

  await page.getByRole("button", { name: "Empty Trash" }).click();
  await page.getByRole("button", { name: "Erase for good" }).click();

  await expect.poll(() => page.getByRole("heading", { name: "Trash is empty" }).isVisible(), wait).toBe(true);
  await expect.poll(() => page.getByText("Emptied Trash. Its threads are erased for good.").isVisible(), wait).toBe(true);
  expect(await page.getByRole("button", { name: "Undo" }).count()).toBe(0);
  await open("All mail");
  await expect.poll(listed, wait).toEqual(["Två"]);
});

test("an empty Trash offers nothing to empty, and says when Trash is erased", budget, async () => {
  const { page } = await withTrash({ trashed: [], kept: ["Två"] });

  await expect.poll(() => page.getByRole("heading", { name: "Trash is empty" }).isVisible(), wait).toBe(true);
  expect(await page.getByRole("button", { name: "Empty Trash" }).count()).toBe(0);
  expect(await page.getByText("Each is erased for good after 30 days here.", { exact: false }).isVisible()).toBe(true);
});
