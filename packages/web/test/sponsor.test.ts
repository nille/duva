import type { Page } from "playwright-core";
import { expect, test } from "vitest";
import { mailboxes, phone, startWebApp } from "./web-app.ts";

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
 * and sponsors the agent Hermes, which has send access to it. Agents own no mailboxes.
 */
async function withSponsor(options: Parameters<typeof startWebApp>[0] = {}) {
  const app = await startWebApp({ domain: "example.com", admin: "ada@example.org", ...options });
  const ada = app.duva.signIn("ada@example.org");
  const { data: me } = await ada.GET("/whoami");
  const { data: adaMailbox } = await ada.POST("/mailboxes", { body: { owner: me!.id, address: "ada@example.com" } });
  // Mail from first-time senders would wait in the Screener, which these tests leave out.
  await app.duva.signIn("ada@example.org").PATCH("/mailboxes/{mailbox}/screener", { params: { path: { mailbox: adaMailbox!.id } }, body: { on: false } });
  const { data: created } = await ada.POST("/agents", { body: { name: "Hermes" } });
  await ada.PATCH("/agents/{agent}/settings", { params: { path: { agent: created!.agent.id } }, body: { sponsorAccess: "send" } });
  const hermes = app.duva.withKey(created!.key);
  const params = { path: { mailbox: adaMailbox!.id } };
  const receive = async (raw: string, to: string) => {
    await app.duva.receive(raw, { to: [to] });
  };

  /** Hermes drafts the text in Ada's mailbox and asks to send it as her, and answers the approval it waits for. */
  const ask = async (body: { answers?: string; to?: string[]; subject?: string; text: string }) => {
    const { data: draft } = await hermes.POST("/mailboxes/{mailbox}/drafts", { params, body });
    const { data: asked } = await hermes.POST("/mailboxes/{mailbox}/drafts/{draft}/send", { params: { path: { ...params.path, draft: draft!.id } } });
    return asked!.send!.approval!;
  };
  return { ...app, ada, me: me!, hermes, params, receive, ask };
}

test("the mailbox switcher lists only the human's own mailboxes, never one for the agent they sponsor", budget, async () => {
  const { page, signIn, duva, me, receive } = await withSponsor();
  const { data: work } = await duva.signIn("ada@example.org").POST("/mailboxes", { body: { owner: me.id, address: "lovelace@example.com" } });
  await duva.signIn("ada@example.org").PATCH("/mailboxes/{mailbox}/screener", { params: { path: { mailbox: work!.id } }, body: { on: false } });
  await receive(note("ada@example.com", "Till Ada"), "ada@example.com");

  await signIn("ada@example.org");

  const links = (await mailboxes(page)).getByRole("link");
  await expect.poll(() => links.count(), wait).toBe(2);
  await expect.poll(() => links.nth(0).getAttribute("aria-label"), wait).toBe("ada@example.com, 1 unread");
  expect(await links.nth(1).getAttribute("aria-label")).toBe("lovelace@example.com");
  expect(await links.nth(0).getAttribute("aria-current")).toBe("page");
  expect(await page.getByRole("navigation", { name: "Agents' mailboxes" }).count()).toBe(0);
  expect(await page.getByRole("link", { name: /^Hermes,/ }).count()).toBe(0);
  // Hermes is reached where agents are: in the status strip.
  expect(await page.getByRole("contentinfo", { name: "Status" }).getByRole("link", { name: /^Hermes is running/ }).isVisible()).toBe(true);
});

test("on a phone the switcher's sheet lists only the human's own mailboxes, and fits the screen", budget, async () => {
  const { page, signIn, duva, me } = await withSponsor({ viewport: phone });
  await duva.signIn("ada@example.org").POST("/mailboxes", { body: { owner: me.id, address: "lovelace@example.com" } });

  await signIn("ada@example.org");
  await page.getByRole("button", { name: /Mailboxes and views/ }).click();

  const links = (await mailboxes(page)).getByRole("link");
  await expect.poll(() => links.allInnerTexts(), wait).toEqual(["ada@example.com", "lovelace@example.com"]);
  expect(await page.getByRole("link", { name: /^Hermes/ }).count()).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(phone.width);
});

test("a message the agent sent as the sponsor is marked as its own, with who approved it and what they changed", budget, async () => {
  const { page, signIn, receive, ada, hermes, params, ask } = await withSponsor();
  await receive(note("ada@example.com", "Möte", "Kan vi ses på måndag?"), "ada@example.com");
  const { data: list } = await hermes.GET("/mailboxes/{mailbox}/threads", { params });
  const { data: thread } = await hermes.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { ...params.path, thread: list!.threads[0]!.id } } });
  const asIs = await ask({ answers: thread!.messages[0]!.id, text: "Måndag går bra." });
  await ada.POST("/approvals/{approval}/send", { params: { path: { approval: asIs } } });
  const edited = await ask({ answers: thread!.messages[0]!.id, text: "Tisdag går bra." });
  await ada.POST("/approvals/{approval}/send", { params: { path: { approval: edited } }, body: { text: "Tisdag går bättre." } });
  await signIn("ada@example.org");

  await page.getByRole("link", { name: /Möte/ }).click();

  const letters = page.getByRole("article");
  await expect.poll(() => letters.count(), wait).toBe(3);
  // The older messages are folded until opened.
  const folded = letters.getByRole("button", { expanded: false });
  while ((await folded.count()) > 0) await folded.first().click();
  const [received, sent, revised] = await letters.allInnerTexts();
  expect(received).not.toContain("Sent by Hermes");
  expect(sent).toContain("Sent by Hermes");
  expect(sent).toContain("You approved it as written");
  expect(revised).toContain("Sent by Hermes");
  expect(revised).toContain("You approved your version, changing the text");
  expect(revised).toContain("Tisdag går bättre.");
});

test("Approvals says how many wait from anywhere in the web app, a thread open included", budget, async () => {
  const { page, signIn, receive, ask } = await withSponsor();
  await receive(note("ada@example.com", "Till Ada"), "ada@example.com");
  await signIn("ada@example.org");
  await page.getByRole("link", { name: /Till Ada/ }).click();
  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Till Ada");

  await ask({ to: ["grace@example.org"], subject: "Hej", text: "Hej Grace." });

  await expect.poll(() => page.getByRole("link", { name: /Approvals/ }).innerText(), wait).toMatch(/Approvals\s*1/);
});

test("while the tab is hidden, the requests waiting for approval stay current", budget, async () => {
  const { page, signIn, ask, hide } = await withSponsor();
  await signIn("ada@example.org");
  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Inbox");

  await hide();
  await ask({ to: ["grace@example.org"], subject: "Hej", text: "Hej Grace." });

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
  const { data: graceMailbox } = await duva.signIn("ada@example.org").POST("/mailboxes", { body: { owner: grace!.id, address: "grace@example.com" } });
  // Mail from first-time senders would wait in the Screener, which these tests leave out.
  await duva.signIn("grace@example.org").PATCH("/mailboxes/{mailbox}/screener", { params: { path: { mailbox: graceMailbox!.id } }, body: { on: false } });

  await signIn("grace@example.org");

  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Inbox");
  // The side column's head names the mailbox, and lists no others.
  expect(await page.getByRole("navigation", { name: "Mailboxes" }).count()).toBe(0);
  expect(await page.locator(".bar-mailbox").getByRole("link").getAttribute("aria-label")).toBe("Your mailbox, grace@example.com");
});

test("a sponsor without a mailbox of their own is told so, and reaches their agent's activity from the status strip", budget, async () => {
  const { page, signIn, duva } = await startWebApp({ domain: "example.com", admin: "ada@example.org" });
  await duva.signIn("ada@example.org").POST("/agents", { body: { name: "Hermes" } });

  await signIn("ada@example.org");

  await expect.poll(() => page.getByRole("heading", { name: "You don't have a mailbox yet" }).count(), wait).toBe(1);
  await page.getByRole("contentinfo", { name: "Status" }).getByRole("link", { name: /^Hermes is running/ }).click();
  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Hermes's activity");
});
