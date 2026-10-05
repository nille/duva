import type { Page } from "playwright-core";
import { expect, test } from "vitest";
import { phone, startWebApp } from "./web-app.ts";

// The page reads the change feeds every 250 ms in these tests, but a page under the full suite's
// load can still take seconds to show what changed, so every wait has room, and every test more.
const wait = { timeout: 10_000 };
const budget = { timeout: 60_000 };

/** A message from Grace that starts its own thread. */
const note = (to: string, subject: string, text = "Hej.") =>
  [
    "From: Grace Hopper <grace@example.org>",
    `To: ${to}`,
    `Subject: ${subject}`,
    "Date: Sun, 04 Oct 2026 09:00:00 +0200",
    `Message-ID: <${subject.replaceAll(" ", "-")}@example.org>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    text,
  ].join("\r\n");

/**
 * The web app for a deployment where Ada, the admin, has a personal mailbox at ada@example.com
 * and sponsors the agent Hermes, which owns hermes@example.com.
 */
async function withSponsor(options: Parameters<typeof startWebApp>[0] = {}) {
  const app = await startWebApp({ domain: "example.com", admin: "ada@example.org", ...options });
  const ada = app.duva.signIn("ada@example.org");
  const { data: me } = await ada.GET("/whoami");
  await ada.POST("/mailboxes", { body: { owner: me!.id, address: "ada@example.com" } });
  const { data: created } = await ada.POST("/agents", { body: { name: "Hermes" } });
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: created!.agent.id, address: "hermes@example.com" } });
  const hermes = app.duva.withKey(created!.key);
  const params = { path: { mailbox: mailbox!.id } };
  const receive = async (raw: string, to: string) => {
    await app.duva.receive(raw, { to: [to] });
  };

  /** Hermes drafts the text and asks to send it, and answers the approval it waits for. */
  const ask = async (body: { answers?: string; to?: string[]; subject?: string; text: string }) => {
    const { data: draft } = await hermes.POST("/mailboxes/{mailbox}/drafts", { params, body });
    const { data: asked } = await hermes.POST("/mailboxes/{mailbox}/drafts/{draft}/send", { params: { path: { ...params.path, draft: draft!.id } } });
    return asked!.send!.approval!;
  };
  return { ...app, ada, hermes, params, receive, ask };
}

const mailboxes = (page: Page) => page.getByRole("navigation", { name: "Mailboxes" });

test("a sponsor finds their agents' mailboxes beside their own, each with its unread count", budget, async () => {
  const { page, signIn, receive } = await withSponsor();
  await receive(note("ada@example.com", "Till Ada"), "ada@example.com");
  await receive(note("hermes@example.com", "Till Hermes"), "hermes@example.com");
  await receive(note("hermes@example.com", "Igen till Hermes"), "hermes@example.com");

  await signIn("ada@example.org");

  const links = mailboxes(page).getByRole("link");
  await expect.poll(() => links.count(), wait).toBe(2);
  await expect.poll(() => links.nth(0).getAttribute("aria-label"), wait).toBe("Your mailbox, ada@example.com, 1 unread");
  await expect.poll(() => links.nth(1).getAttribute("aria-label"), wait).toBe("Hermes, hermes@example.com, 2 unread");
  expect(await links.nth(0).getAttribute("aria-current")).toBe("page");
  await expect.poll(() => page.getByRole("link", { name: /Till Ada/ }).count(), wait).toBe(1);
});

test("a sponsor opens their agent's Inbox and reads its threads as they read their own", budget, async () => {
  const { page, signIn, receive } = await withSponsor();
  await receive(note("hermes@example.com", "Till Hermes", "Kan du svara?"), "hermes@example.com");
  await signIn("ada@example.org");

  await mailboxes(page).getByRole("link", { name: /^Hermes/ }).click();

  await expect.poll(() => page.getByRole("link", { name: /^Unread.*Till Hermes/ }).count(), wait).toBe(1);
  expect(await page.getByRole("main").getByText("hermes@example.com").isVisible()).toBe(true);
  expect(await mailboxes(page).getByRole("link", { name: /^Hermes/ }).getAttribute("aria-current")).toBe("page");

  await page.getByRole("link", { name: /Till Hermes/ }).click();

  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Till Hermes");
  expect(await page.getByRole("article").innerText()).toContain("Kan du svara?");
  await page.getByRole("link", { name: "Hermes's Inbox" }).click();
  await expect.poll(() => page.getByRole("link", { name: /Till Hermes/ }).getAttribute("aria-label"), wait).not.toMatch(/^Unread/);
  await expect.poll(() => mailboxes(page).getByRole("link", { name: /^Hermes/ }).getAttribute("aria-label"), wait).toBe("Hermes, hermes@example.com");

  await mailboxes(page).getByRole("link", { name: /^Your mailbox/ }).click();

  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Inbox");
  expect(await page.getByRole("link", { name: /Till Hermes/ }).count()).toBe(0);
});

test("a message the agent sent is marked as its own, with who approved it and what they changed", budget, async () => {
  const { page, signIn, receive, ada, hermes, params, ask } = await withSponsor();
  await receive(note("hermes@example.com", "Möte", "Kan vi ses på måndag?"), "hermes@example.com");
  const { data: list } = await hermes.GET("/mailboxes/{mailbox}/threads", { params });
  const { data: thread } = await hermes.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { ...params.path, thread: list!.threads[0]!.id } } });
  const asIs = await ask({ answers: thread!.messages[0]!.id, text: "Måndag går bra." });
  await ada.POST("/approvals/{approval}/send", { params: { path: { approval: asIs } } });
  const edited = await ask({ answers: thread!.messages[0]!.id, text: "Tisdag går bra." });
  await ada.POST("/approvals/{approval}/send", { params: { path: { approval: edited } }, body: { text: "Tisdag går bättre." } });
  await signIn("ada@example.org");

  await mailboxes(page).getByRole("link", { name: /^Hermes/ }).click();
  await page.getByRole("link", { name: /Möte/ }).click();

  const letters = page.getByRole("article");
  await expect.poll(() => letters.count(), wait).toBe(3);
  const [received, sent, revised] = await letters.allInnerTexts();
  expect(received).not.toContain("Sent by Hermes");
  expect(sent).toContain("Sent by Hermes");
  expect(sent).toContain("You approved it as written");
  expect(revised).toContain("Sent by Hermes");
  expect(revised).toContain("You approved your version, changing the text");
  expect(revised).toContain("Tisdag går bättre.");
});

test("new mail in an agent's mailbox appears without reloading, and its unread count follows", budget, async () => {
  const { page, signIn, receive } = await withSponsor();
  await signIn("ada@example.org");
  await mailboxes(page).getByRole("link", { name: /^Hermes/ }).click();
  await expect.poll(() => page.getByRole("heading", { name: "Hermes's Inbox is empty" }).count(), wait).toBe(1);

  await receive(note("hermes@example.com", "Ny post"), "hermes@example.com");

  await expect.poll(() => page.getByRole("link", { name: /^Unread.*Ny post/ }).count(), wait).toBe(1);
  await expect.poll(() => mailboxes(page).getByRole("link", { name: /^Hermes/ }).getAttribute("aria-label"), wait).toBe("Hermes, hermes@example.com, 1 unread");
});

test("Approvals says how many wait from anywhere in the web app, an agent's thread included", budget, async () => {
  const { page, signIn, receive, ask } = await withSponsor();
  await receive(note("hermes@example.com", "Till Hermes"), "hermes@example.com");
  await signIn("ada@example.org");
  await mailboxes(page).getByRole("link", { name: /^Hermes/ }).click();
  await page.getByRole("link", { name: /Till Hermes/ }).click();
  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Till Hermes");

  await ask({ to: ["grace@example.org"], subject: "Hej", text: "Hej Grace." });

  await expect.poll(() => page.getByRole("link", { name: /Approvals/ }).innerText(), wait).toMatch(/Approvals\s*1/);
});

test("while the tab is hidden, the agents' unread counts and the requests waiting for approval stay current", budget, async () => {
  const { page, signIn, receive, ask, hide } = await withSponsor();
  await signIn("ada@example.org");
  await expect.poll(() => mailboxes(page).getByRole("link", { name: /^Hermes/ }).getAttribute("aria-label"), wait).toBe("Hermes, hermes@example.com");

  await hide();
  await receive(note("hermes@example.com", "Ny post"), "hermes@example.com");
  await ask({ to: ["grace@example.org"], subject: "Hej", text: "Hej Grace." });

  await expect.poll(() => mailboxes(page).getByRole("link", { name: /^Hermes/ }).getAttribute("aria-label"), wait).toBe("Hermes, hermes@example.com, 1 unread");
  await expect.poll(() => page.getByRole("link", { name: /Approvals/ }).innerText(), wait).toMatch(/Approvals\s*1/);
  await page.getByRole("link", { name: /Approvals/ }).click();
  await expect.poll(() => page.title(), wait).toBe("Approvals (1) · Duva");
});

test("on Approvals, the tab's title counts the requests that wait, and a new one while hidden", budget, async () => {
  const { page, signIn, ask, hide } = await withSponsor();
  await ask({ to: ["grace@example.org"], subject: "Hej", text: "Hej Grace." });
  await signIn("ada@example.org");
  await page.getByRole("link", { name: /Approvals/ }).click();
  await expect.poll(() => page.title(), wait).toBe("Approvals (1) · Duva");

  await hide();
  await ask({ to: ["grace@example.org"], subject: "Igen", text: "Hej igen." });

  await expect.poll(() => page.title(), wait).toBe("Approvals (2) · Duva");
});

test("a human who sponsors no agents sees only their own mailbox", budget, async () => {
  const { page, signIn, duva } = await startWebApp({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org"] });
  const { data: grace } = await duva.signIn("grace@example.org").GET("/whoami");
  await duva.signIn("ada@example.org").POST("/mailboxes", { body: { owner: grace!.id, address: "grace@example.com" } });

  await signIn("grace@example.org");

  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Inbox");
  expect(await mailboxes(page).count()).toBe(0);
});

test("a sponsor without a mailbox of their own still reaches their agents' mailboxes", budget, async () => {
  const { page, signIn, duva } = await startWebApp({ domain: "example.com", admin: "ada@example.org" });
  const ada = duva.signIn("ada@example.org");
  const { data: created } = await ada.POST("/agents", { body: { name: "Hermes" } });
  await ada.POST("/mailboxes", { body: { owner: created!.agent.id, address: "hermes@example.com" } });

  await signIn("ada@example.org");

  await expect.poll(() => page.getByRole("heading", { name: "You don't have a mailbox yet" }).count(), wait).toBe(1);
  await mailboxes(page).getByRole("link", { name: /^Hermes/ }).click();
  await expect.poll(() => page.getByRole("heading", { name: "Hermes's Inbox is empty" }).count(), wait).toBe(1);
});

test("the mailboxes fit a phone's screen", budget, async () => {
  const { page, signIn, receive } = await withSponsor({ viewport: phone });
  await receive(note("hermes@example.com", "Till Hermes"), "hermes@example.com");

  await signIn("ada@example.org");

  await expect.poll(() => mailboxes(page).getByRole("link", { name: /^Hermes/ }).isVisible(), wait).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(phone.width);
  await mailboxes(page).getByRole("link", { name: /^Hermes/ }).click();
  await expect.poll(() => page.getByRole("link", { name: /Till Hermes/ }).isVisible(), wait).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(phone.width);
});

test("in an agent's mailbox the sponsor reads its Sent and has no replies, and in their own they write", budget, async () => {
  const { page, signIn, ada, receive, ask } = await withSponsor();
  await ada.POST("/approvals/{approval}/send", { params: { path: { approval: await ask({ to: ["grace@example.org"], subject: "Från Hermes", text: "Hej Grace." }) } } });
  await receive(note("hermes@example.com", "Till Hermes"), "hermes@example.com");
  await signIn("ada@example.org");

  await mailboxes(page).getByRole("link", { name: /^Hermes/ }).click();
  await page.getByRole("navigation", { name: "Mail" }).getByRole("link", { name: "Sent" }).click();
  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Hermes's Sent");
  await expect.poll(() => page.getByRole("list", { name: "Threads" }).getByRole("listitem").allInnerTexts(), wait).toEqual([expect.stringContaining("Från Hermes")]);
  await page.getByRole("link", { name: /Från Hermes/ }).click();
  await expect.poll(() => page.getByRole("article").count(), wait).toBe(1);
  expect(await page.getByRole("button", { name: /^Reply/ }).count()).toBe(0);

  await mailboxes(page).getByRole("link", { name: /^Your mailbox/ }).click();
  await page.getByRole("button", { name: "Write" }).click();
  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toBe("New message");
  expect(await mailboxes(page).getByRole("link", { name: /^Your mailbox/ }).getAttribute("aria-current")).toBe("page");
  expect(await page.getByText("ada@example.com", { exact: true }).first().isVisible()).toBe(true);
});
