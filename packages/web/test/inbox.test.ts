import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { phone, startWebApp } from "./web-app.ts";

// The page reads the change feeds every 250 ms in these tests, but a page under the full suite's
// load can still take seconds to show what changed, so every wait has room, and every test more.
const wait = { timeout: 10_000 };
const budget = { timeout: 60_000 };

/** A fixture from the API's tests, as the sender's server sends it. */
const mail = (name: string) => readFile(new URL(`../../api/test/mail/${name}.eml`, import.meta.url));

/** A message from Ada to Grace that starts its own thread. */
const note = (subject: string, text = "Hej Grace.") =>
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
    text,
  ].join("\r\n");

/** The web app for a deployment where the human Grace has a personal mailbox at grace@example.com. */
async function withPersonalMailbox(options: Parameters<typeof startWebApp>[0] = {}) {
  const app = await startWebApp({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org"], ...options });
  const ada = app.duva.signIn("ada@example.org");
  const { data: grace } = await app.duva.signIn("grace@example.org").GET("/whoami");
  const { data: graceMailbox } = await ada.POST("/mailboxes", { body: { owner: grace!.id, address: "grace@example.com" } });
  // Mail from first-time senders would wait in the Screener, which these tests leave out.
  await app.duva.signIn("grace@example.org").PATCH("/mailboxes/{mailbox}/screener", { params: { path: { mailbox: graceMailbox!.id } }, body: { on: false } });
  const receive = async (raw: string | Uint8Array, to = "grace@example.com") => {
    await app.duva.receive(raw, { to: [to] });
  };
  return { ...app, ada, receive };
}

test("after signing in, a human lands on their Inbox, newest thread first, each with sender, subject, snippet and unread state", budget, async () => {
  const { page, signIn, receive } = await withPersonalMailbox();
  await receive(await mail("plain"));
  await receive(note("Lunch på fredag", "Ska vi äta lunch på fredag?"));

  await signIn("grace@example.org");

  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Inbox");
  const threads = page.getByRole("list", { name: "Threads" }).getByRole("listitem");
  await expect.poll(() => threads.allInnerTexts(), wait).toHaveLength(2);
  const [newest, oldest] = await threads.allInnerTexts();
  expect(newest).toContain("Ada Lovelace");
  expect(newest).toContain("Lunch på fredag");
  expect(newest).toContain("Ska vi äta lunch på fredag?");
  expect(oldest).toContain("Grace Hopper");
  expect(oldest).toContain("Compiler notes");
  expect(oldest).toContain("Här är mina anteckningar om kompilatorn.");
  expect(await page.getByRole("list", { name: "Threads" }).getByRole("link", { name: /^Unread/ }).count()).toBe(2);
  expect(await page.getByRole("main").getByText("2 unread", { exact: true }).isVisible()).toBe(true);
});

test("the tab shows Duva's icon, and the page loads without an error", budget, async () => {
  const { page, signIn } = await withPersonalMailbox();
  const errors: string[] = [];
  page.on("console", (message) => void (message.type() === "error" && errors.push(message.text())));

  await signIn("grace@example.org");
  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Inbox");

  const icons = await page.locator("link[rel=icon]").evaluateAll((links) => links.map((link) => (link as HTMLLinkElement).href));
  const loaded = await page.evaluate(
    (icons) => Promise.all(icons.map((icon) => new Promise<boolean>((resolve) => Object.assign(new Image(), { onload: () => resolve(true), onerror: () => resolve(false), src: icon })))),
    icons,
  );
  expect(icons.map((icon) => new URL(icon).pathname)).toEqual(["/favicon.ico", "/favicon.svg"]);
  expect(loaded).toEqual([true, true]);
  expect(errors).toEqual([]);
});

test("opening a thread shows its messages oldest first, and the Inbox then lists it read", budget, async () => {
  const { page, signIn, receive } = await withPersonalMailbox();
  await receive(await mail("plain"));
  await receive(await mail("reply"));
  await signIn("grace@example.org");

  await page.getByRole("link", { name: /Compiler notes/ }).click();

  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Compiler notes");
  const messages = page.getByRole("article");
  await expect.poll(() => messages.count(), wait).toBe(2);
  const [first, second] = await messages.allInnerTexts();
  expect(first).toContain("Grace Hopper");
  expect(first).toContain("Hermes");
  expect(first).toContain("ada@example.org");
  expect(first).toContain("Här är mina anteckningar om kompilatorn.");
  expect(second).toContain("Ada Lovelace");
  expect(second).toContain("Tack, Grace. Jag läser dem i kväll.");

  await page.getByRole("link", { name: "Inbox", exact: true }).first().click();
  await expect.poll(() => page.getByRole("link", { name: /Compiler notes/ }).getAttribute("aria-label"), wait).not.toMatch(/^Unread/);
  await expect.poll(() => page.getByText(/^\d+ unread$/).count(), wait).toBe(0);
});

test("a thread shows the plus tag a message was sent to, and its attachments by name, type and size", budget, async () => {
  const { page, signIn, receive } = await withPersonalMailbox();
  await receive(await mail("attachment"), "grace+reports@example.com");
  await signIn("grace@example.org");

  await page.getByRole("link", { name: /The report/ }).click();

  const message = page.getByRole("article");
  await expect.poll(() => message.innerText(), wait).toContain("grace+reports@example.com");
  const text = await message.innerText();
  expect(text).toContain("with the plus tag reports");
  expect(text).toMatch(/report\.pdf\s+application\/pdf, 11 bytes/);
  expect(text).toMatch(/Attachment without a name\s+text\/csv, 8 bytes/);
});

test("long quoted text is folded until the human asks for it", budget, async () => {
  const { page, signIn, receive } = await withPersonalMailbox();
  const quoted = Array.from({ length: 8 }, (_, line) => `> Gammal rad ${line + 1}`).join("\n");
  await receive(note("Svar", `Ja, det går bra.\n\nOn Sunday Ada wrote:\n${quoted}`));
  await signIn("grace@example.org");
  await page.getByRole("link", { name: /Svar/ }).click();

  const show = page.getByRole("button", { name: "Show quoted text" });
  await expect.poll(() => show.getAttribute("aria-expanded"), wait).toBe("false");
  expect(await page.getByRole("article").getByText("Ja, det går bra.").isVisible()).toBe(true);
  expect(await page.getByRole("article").getByText("Gammal rad 8").isVisible()).toBe(false);

  await show.click();

  await expect.poll(() => page.getByRole("article").getByText("Gammal rad 8").isVisible(), wait).toBe(true);
});

test("a thread the human marks unread stays unread, however late the mark-reads from reading it reach Duva", budget, async () => {
  const { page, signIn, receive, duva } = await withPersonalMailbox();
  await receive(await mail("plain"));
  await signIn("grace@example.org");
  // The first request to mark the thread read reaches Duva only after a while, as on a slow
  // connection, and the next ones at once.
  let reads = 0;
  let settled = 0;
  await page.route("**/threads/read", async (route) => {
    if (++reads === 1) await new Promise((resolve) => setTimeout(resolve, 3000));
    const response = await route.fetch().catch(() => undefined);
    settled++;
    if (response !== undefined) await route.fulfill({ response }).catch(() => undefined);
  });
  await page.getByRole("link", { name: /Compiler notes/ }).click();
  // A reply arrives while the thread is open, which makes it unread again, so reading it marks it read once more.
  await receive(
    ["From: Ada <ada@example.org>", "To: grace@example.com", "Subject: Re: Compiler notes", "Message-ID: <notes-2@example.org>", "In-Reply-To: <notes-1@example.org>", "", "Tack."].join("\r\n"),
  );
  await expect.poll(() => reads, wait).toBeGreaterThanOrEqual(2);

  await page.getByRole("button", { name: "Mark unread" }).click();

  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Inbox");
  // Every request to mark it read reaches Duva before the test reads the thread there.
  await expect.poll(() => settled, wait).toBe(reads);
  const grace = duva.signIn("grace@example.org");
  const { data: mailboxes } = await grace.GET("/mailboxes");
  const { data: inbox } = await grace.GET("/mailboxes/{mailbox}/threads", { params: { path: { mailbox: mailboxes!.mailboxes[0]!.id } } });
  expect(inbox!.threads.map(({ unread }) => unread)).toEqual([true]);
  await expect.poll(() => page.getByRole("link", { name: /^Unread.*Compiler notes/ }).count(), wait).toBe(1);
});

test("the human marks a thread unread again, and the Inbox lists it unread", budget, async () => {
  const { page, signIn, receive } = await withPersonalMailbox();
  await receive(await mail("plain"));
  await signIn("grace@example.org");
  await page.getByRole("link", { name: /Compiler notes/ }).click();

  await page.getByRole("button", { name: "Mark unread" }).click();

  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Inbox");
  await expect.poll(() => page.getByRole("link", { name: /^Unread.*Compiler notes/ }).count(), wait).toBe(1);
});

test("new mail appears in the open Inbox without reloading", budget, async () => {
  const { page, signIn, receive } = await withPersonalMailbox();
  await receive(await mail("plain"));
  await signIn("grace@example.org");
  await expect.poll(() => page.getByRole("link", { name: /Compiler notes/ }).count(), wait).toBe(1);

  await receive(note("Ny post", "Hej igen."));

  await expect.poll(() => page.getByRole("link", { name: /^Unread.*Ny post/ }).count(), wait).toBe(1);
  const [newest] = await page.getByRole("list", { name: "Threads" }).getByRole("listitem").allInnerTexts();
  expect(newest).toContain("Ny post");
});

test("while the tab is hidden, its title counts new mail as it arrives", budget, async () => {
  const { page, signIn, receive, hide } = await withPersonalMailbox();
  await signIn("grace@example.org");
  await expect.poll(() => page.getByRole("heading", { name: "Your Inbox is empty" }).count(), wait).toBe(1);
  expect(await page.title()).toBe("Inbox · Duva");

  await hide();
  await receive(note("Ny post", "Hej igen."));

  await expect.poll(() => page.title(), wait).toBe("Inbox (1) · Duva");
});

test("returning to the tab shows at once the mail that arrived while it was hidden", budget, async () => {
  // While hidden the page would wait a minute to read the feeds again, longer than the test waits.
  const { page, signIn, receive, hide, show } = await withPersonalMailbox({ hiddenPollInterval: 60_000 });
  await signIn("grace@example.org");
  await expect.poll(() => page.getByRole("heading", { name: "Your Inbox is empty" }).count(), wait).toBe(1);
  await hide();
  // The read that was due when the tab was hidden has passed, so the next is a minute away.
  await page.waitForTimeout(2_000);

  await receive(note("Ny post", "Hej igen."));
  await page.waitForTimeout(1_000);
  expect(await page.getByRole("link", { name: /Ny post/ }).count()).toBe(0);
  await show();

  await expect.poll(() => page.getByRole("link", { name: /^Unread.*Ny post/ }).count(), wait).toBe(1);
  expect(await page.title()).toBe("Inbox (1) · Duva");
});

test("a reply that arrives while its thread is open appears there, marked new", budget, async () => {
  const { page, signIn, receive } = await withPersonalMailbox();
  await receive(await mail("plain"));
  await signIn("grace@example.org");
  await page.getByRole("link", { name: /Compiler notes/ }).click();
  await expect.poll(() => page.getByRole("article").count(), wait).toBe(1);

  await receive(await mail("reply"));

  await expect.poll(() => page.getByRole("article").count(), wait).toBe(2);
  expect(await page.getByRole("article").nth(1).innerText()).toContain("New");
});

test("a long Inbox shows its newest threads, then older ones a page at a time", budget, async () => {
  const { page, signIn, receive } = await withPersonalMailbox();
  for (let number = 1; number <= 26; number++) await receive(note(`Brev ${number}`));
  await signIn("grace@example.org");

  const threads = page.getByRole("list", { name: "Threads" }).getByRole("listitem");
  await expect.poll(() => threads.count(), wait).toBe(25);
  expect(await threads.first().innerText()).toContain("Brev 26");

  await page.getByRole("button", { name: "Show older threads" }).click();

  await expect.poll(() => threads.count(), wait).toBe(26);
  expect(await threads.last().innerText()).toContain("Brev 1");
  expect(await page.getByRole("button", { name: "Show older threads" }).count()).toBe(0);
});

test("an empty Inbox says so", budget, async () => {
  const { page, signIn } = await withPersonalMailbox();

  await signIn("grace@example.org");

  await expect.poll(() => page.getByRole("heading", { name: "Your Inbox is empty" }).count(), wait).toBe(1);
  expect(await page.getByText("grace@example.com").first().isVisible()).toBe(true);
});

test("a human without a mailbox is told to ask an admin for one", budget, async () => {
  const { page, signIn } = await startWebApp({ admin: "ada@example.org", humans: ["grace@example.org"] });

  await signIn("grace@example.org");

  await expect.poll(() => page.getByRole("heading", { name: "You don't have a mailbox yet" }).count(), wait).toBe(1);
  expect(await page.getByText("Ask an admin").isVisible()).toBe(true);
});

test("when the session has ended, the Inbox asks the human to sign in again", budget, async () => {
  // The web app renews a session whose access token expires within a minute, so with this lifetime it renews on every call.
  const { page, signIn, duva } = await withPersonalMailbox({ accessTokenLifetime: 30 });
  await signIn("grace@example.org");
  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Inbox");

  duva.endSessions();

  await expect.poll(() => page.getByRole("heading", { name: "Your session has ended" }).count(), wait).toBe(1);
  expect(await page.getByRole("button", { name: "Sign in" }).isVisible()).toBe(true);
});

test("a sponsor reaches Approvals from the bar, which says how many wait", budget, async () => {
  const { page, signIn, duva, ada } = await startWebApp({ domain: "example.com", admin: "ada@example.org" }).then(async (app) => ({
    ...app,
    ada: app.duva.signIn("ada@example.org"),
  }));
  const { data: me } = await ada.GET("/whoami");
  const { data: adaMailbox } = await ada.POST("/mailboxes", { body: { owner: me!.id, address: "ada@example.com" } });
  // Mail from first-time senders would wait in the Screener, which these tests leave out.
  await duva.signIn("ada@example.org").PATCH("/mailboxes/{mailbox}/screener", { params: { path: { mailbox: adaMailbox!.id } }, body: { on: false } });
  const { data: created } = await ada.POST("/agents", { body: { name: "Hermes" } });
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: created!.agent.id, address: "hermes@example.com" } });
  const hermes = duva.withKey(created!.key);
  const params = { path: { mailbox: mailbox!.id } };
  const { data: draft } = await hermes.POST("/mailboxes/{mailbox}/drafts", { params, body: { to: ["grace@example.org"], subject: "Hej", text: "Hej Grace." } });
  await hermes.POST("/mailboxes/{mailbox}/drafts/{draft}/send", { params: { path: { ...params.path, draft: draft!.id } } });

  await signIn("ada@example.org");

  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Inbox");
  const approvals = page.getByRole("link", { name: /Approvals/ });
  await expect.poll(() => approvals.innerText(), wait).toMatch(/Approvals\s*1/);
  await approvals.click();
  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Approvals");
  await expect.poll(() => page.getByText("Hermes asks to send").isVisible(), wait).toBe(true);
});

test("the Inbox fits a phone's screen", budget, async () => {
  const { page, signIn, receive } = await withPersonalMailbox({ viewport: phone });
  await receive(await mail("plain"));

  await signIn("grace@example.org");

  await expect.poll(() => page.getByRole("link", { name: /Compiler notes/ }).isVisible(), wait).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(phone.width);
});
