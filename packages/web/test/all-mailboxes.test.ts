import type { Page } from "playwright-core";
import { expect, test } from "vitest";
import { mailboxes, phone, startWebApp } from "./web-app.ts";

// All mailboxes (ADR-0033, #144): a human with two mailboxes of their own, home@ and work@, opens
// the web app on both taken together. The domain rules are the API's tests'; these are what the
// human sees and does.

const wait = { timeout: 10_000 };
const budget = { timeout: 90_000 };

/** A message from Grace to `to`, each address a recipient. */
const note = (to: string[], subject: string) =>
  [
    "From: Grace Hopper <grace@example.org>",
    `To: ${to.join(", ")}`,
    `Subject: ${subject}`,
    "Date: Sun, 04 Oct 2026 09:00:00 +0200",
    `Message-ID: <${subject.replaceAll(" ", "-")}@example.org>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Hej.",
  ].join("\r\n");

/**
 * The web app for a deployment where Ada, the admin, has two mailboxes of her own, home@example.com
 * and work@example.com, with the Screener off in both unless `screened`.
 */
async function withTwoMailboxes(options: Parameters<typeof startWebApp>[0] & { screened?: boolean } = {}) {
  const { screened = false, ...rest } = options;
  const app = await startWebApp({ domain: "example.com", admin: "ada@example.org", ...rest });
  const ada = app.duva.signIn("ada@example.org");
  const { data: me } = await ada.GET("/whoami");
  const ids: Record<string, string> = {};
  for (const address of ["home@example.com", "work@example.com"]) {
    const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: me!.id, address } });
    if (!screened) await ada.PATCH("/mailboxes/{mailbox}/screener", { params: { path: { mailbox: mailbox!.id } }, body: { on: false } });
    ids[address] = mailbox!.id;
  }
  const receive = (to: string[], subject: string) => app.duva.receive(note(to, subject), { to });
  return { ...app, ada, home: ids["home@example.com"]!, work: ids["work@example.com"]!, receive };
}

const rows = (page: Page) => page.getByRole("list", { name: "Threads" }).getByRole("link");
const views = (page: Page) => page.getByRole("navigation", { name: "Mail" });

test("a human with two mailboxes opens on All mailboxes, whose rows name the address each came to, and its Inbox counts both", budget, async () => {
  const { page, signIn, receive, work } = await withTwoMailboxes();
  await receive(["home@example.com"], "Till hemmet");
  await receive(["work@example.com"], "Till jobbet");
  await signIn("ada@example.org");

  await expect.poll(() => rows(page).count(), wait).toBe(2);
  expect(await rows(page).allInnerTexts()).toEqual([expect.stringContaining("to work@"), expect.stringContaining("to home@")]);
  expect(await rows(page).first().getAttribute("aria-label")).toContain("to work@example.com");
  const selector = page.getByRole("button", { name: /Choose a mailbox$/ });
  expect(await selector.getAttribute("aria-label")).toBe("All mailboxes, Choose a mailbox");
  await expect.poll(() => views(page).getByRole("link", { name: /^Inbox/ }).innerText(), wait).toMatch(/^Inbox\s+2\b/);

  // The selector offers All mailboxes above each mailbox, each with its unread count.
  const links = (await mailboxes(page)).getByRole("link");
  await expect.poll(() => links.evaluateAll((all) => all.map((link) => link.getAttribute("aria-label"))), wait).toEqual([
    "All mailboxes, 2 unread",
    "home@example.com, 1 unread",
    "work@example.com, 1 unread",
  ]);
  expect(await links.first().getAttribute("aria-current")).toBe("page");

  // One mailbox's own view stays as it is, without saying where each came to.
  await links.nth(2).click();
  await expect.poll(() => page.url(), wait).toContain(`#/mailboxes/${work}/`);
  await expect.poll(() => rows(page).allInnerTexts(), wait).toEqual([expect.not.stringContaining("to work@")]);
  expect(await rows(page).count()).toBe(1);
});

test("a message to both mailboxes is two rows in All mailboxes, and reading or replying to one leaves the other as it was", budget, async () => {
  const { page, signIn, receive, ada, home, work } = await withTwoMailboxes();
  await receive(["home@example.com", "work@example.com"], "Till båda");
  await signIn("ada@example.org");

  await expect.poll(() => rows(page).count(), wait).toBe(2);
  const homeRow = rows(page).filter({ hasText: "to home@" });
  await homeRow.click();
  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Till båda");

  await expect.poll(() => homeRow.getAttribute("aria-label"), wait).toMatch(/^Grace Hopper/);
  expect(await rows(page).filter({ hasText: "to work@" }).getAttribute("aria-label")).toMatch(/^Unread, /);
  const { data } = await ada.GET("/mailboxes/{mailbox}/threads", { params: { path: { mailbox: work } } });
  expect(data!.threads.map(({ unread }) => unread)).toEqual([true]);

  await page.getByRole("button", { name: /^Reply/ }).first().click();
  await page.getByLabel("Message", { exact: true }).fill("Tack!");
  await page.getByRole("button", { name: /^Send/ }).click();
  const messages = async (mailbox: string) => (await ada.GET("/mailboxes/{mailbox}/threads", { params: { path: { mailbox } } })).data?.threads.map((thread) => thread.messages);
  await expect.poll(() => messages(home), wait).toEqual([2]);
  expect(await messages(work)).toEqual([1]);
  await expect.poll(() => rows(page).filter({ hasText: "to home@" }).innerText(), wait).toContain("2");
  expect(await rows(page).filter({ hasText: "to work@" }).getAttribute("aria-label")).toMatch(/^Unread, /);
});

test("labels of one name in both mailboxes are one label in All mailboxes, listing both mailboxes' threads", budget, async () => {
  const { page, signIn, receive, ada, home, work } = await withTwoMailboxes();
  await receive(["home@example.com"], "Kvitto hemma");
  await receive(["work@example.com"], "Kvitto på jobbet");
  for (const [mailbox, name] of [
    [home, "Receipts"],
    [work, "receipts"],
  ] as const) {
    const { data: label } = await ada.POST("/mailboxes/{mailbox}/labels", { params: { path: { mailbox } }, body: { name } });
    const { data: threads } = await ada.GET("/mailboxes/{mailbox}/threads", { params: { path: { mailbox } } });
    await ada.POST("/mailboxes/{mailbox}/threads/labels", { params: { path: { mailbox } }, body: { threads: threads!.threads.map(({ id }) => id), add: [label!.id] } });
  }
  await signIn("ada@example.org");

  const labels = page.getByRole("list", { name: "Your labels" }).getByRole("link");
  await expect.poll(() => labels.allInnerTexts(), wait).toEqual([expect.stringMatching(/^receipts\s+2\b/i)]);
  await labels.first().click();

  await expect.poll(() => rows(page).count(), wait).toBe(2);
  expect(await page.getByRole("heading", { level: 1 }).textContent()).toMatch(/^receipts$/i);
});

test("new mail in All mailboxes starts from the human's preference, can go from any of their addresses, and a reply goes from where the original came", budget, async () => {
  const { page, signIn, receive, ada, home, work } = await withTwoMailboxes();
  await ada.PATCH("/preferences", { body: { newMailFrom: "work@example.com" } });
  await receive(["home@example.com"], "Fråga hemma");
  await signIn("ada@example.org");
  await expect.poll(() => rows(page).count(), wait).toBe(1);

  await page.getByRole("button", { name: "Write" }).click();
  const from = page.getByLabel("From", { exact: true });
  await expect.poll(() => from.inputValue(), wait).toBe("work@example.com");
  expect(await from.locator("option").allInnerTexts()).toEqual(["home@example.com", "work@example.com"]);
  await page.getByLabel("Subject", { exact: true }).fill("Från jobbet");
  const drafts = async (mailbox: string) => (await ada.GET("/mailboxes/{mailbox}/drafts", { params: { path: { mailbox } } })).data?.drafts.map(({ subject }) => subject);
  await expect.poll(() => drafts(work), wait).toEqual(["Från jobbet"]);

  // Going from the other mailbox's address moves the draft there.
  await from.selectOption("home@example.com");
  await expect.poll(() => drafts(home), wait).toEqual(["Från jobbet"]);
  await expect.poll(() => drafts(work), wait).toEqual([]);

  await page.goto(`${page.url().split("#")[0]}#/`);
  await rows(page).first().click();
  await page.getByRole("button", { name: /^Reply/ }).first().click();
  await expect.poll(() => page.locator(".compose-in-thread .compose-from").textContent(), wait).toBe("home@example.com");
});

test("the Screener of All mailboxes decides for the mailbox the mail came to, and the sender's sheet shows each mailbox's decision", budget, async () => {
  const { page, signIn, receive, ada, home, work } = await withTwoMailboxes({ screened: true });
  await receive(["work@example.com"], "Hej från Grace");
  await signIn("ada@example.org");

  await page.getByRole("navigation", { name: "Duva" }).getByRole("link", { name: /^Screener/ }).click();
  const waiting = page.getByRole("list", { name: "Waiting senders" }).locator("> li");
  await expect.poll(() => waiting.count(), wait).toBe(1);
  expect(await waiting.innerText()).toContain("to work@");
  await waiting.getByRole("button", { name: "Feed" }).click();

  const decided = async (mailbox: string) => (await ada.GET("/mailboxes/{mailbox}/senders", { params: { path: { mailbox } } })).data?.senders.map(({ address, delivery }) => [address, delivery]);
  await expect.poll(() => decided(work), wait).toEqual([["grace@example.org", "feed"]]);
  expect(await decided(home)).toEqual([]);

  await page.goto(`${page.url().split("#")[0]}#/senders/grace%40example.org?from=`);
  const parts = page.locator("main.sender").getByRole("region");
  await expect.poll(() => parts.evaluateAll((all) => all.map((part) => part.querySelector("h2")?.textContent)), wait).toEqual([
    expect.stringMatching(/^In home@example\.com/),
    expect.stringMatching(/^In work@example\.com/),
  ]);
  await expect.poll(() => parts.nth(0).innerText(), wait).toContain("The Screener");
  await expect.poll(() => parts.nth(1).innerText(), wait).toContain("The Feed");
});

test("a human who chooses in Preferences to open on one of their mailboxes opens on it, and still reaches All mailboxes", budget, async () => {
  const { page, signIn, receive, ada, work } = await withTwoMailboxes();
  await receive(["home@example.com"], "Till hemmet");
  await signIn("ada@example.org");
  await expect.poll(() => rows(page).count(), wait).toBe(1);

  await page.getByRole("link", { name: "Settings", exact: true }).click();
  const preferences = page.getByRole("region", { name: "Preferences" });
  const opensOn = preferences.getByRole("group", { name: "Where Duva opens" });
  await expect.poll(() => opensOn.getByRole("radio", { name: /^All mailboxes/ }).isChecked(), wait).toBe(true);
  await opensOn.getByRole("radio", { name: /^work@example\.com/ }).check();
  await preferences.getByRole("button", { name: "Save" }).click();
  await expect.poll(async () => (await ada.GET("/preferences")).data?.opensOn, wait).toBe(work);

  await page.goto(page.url().split("#")[0]!);
  await expect.poll(() => page.url(), wait).toContain(`#/mailboxes/${work}/`);
  await expect.poll(() => page.getByRole("button", { name: /Choose a mailbox$/ }).getAttribute("aria-label"), wait).toMatch(/^work@example\.com, /);

  await (await mailboxes(page)).getByRole("link", { name: /^All mailboxes/ }).click();
  await expect.poll(() => rows(page).count(), wait).toBe(1);
  expect(await page.getByRole("button", { name: /Choose a mailbox$/ }).getAttribute("aria-label")).toBe("All mailboxes, Choose a mailbox");
});

test("on a phone the switcher names All mailboxes and offers it above each mailbox", budget, async () => {
  const { page, signIn, receive, home } = await withTwoMailboxes({ viewport: phone });
  await receive(["home@example.com"], "Till hemmet");
  await receive(["work@example.com"], "Till jobbet");
  await signIn("ada@example.org");
  const switcher = page.getByRole("button", { name: /Mailboxes and views$/ });

  await expect.poll(() => switcher.getAttribute("aria-label"), wait).toBe("Inbox, All mailboxes, 2 unread, Mailboxes and views");
  expect(await rows(page).allInnerTexts()).toEqual([expect.stringContaining("to work@"), expect.stringContaining("to home@")]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await switcher.click();
  const links = page.getByRole("navigation", { name: "Mailboxes" }).getByRole("link");
  expect(await links.allInnerTexts()).toEqual([expect.stringMatching(/^All mailboxes/), expect.stringMatching(/^home@/), expect.stringMatching(/^work@/)]);
  await links.nth(1).click();

  await expect.poll(() => page.url(), wait).toContain(`#/mailboxes/${home}/`);
  await expect.poll(() => switcher.getAttribute("aria-label"), wait).toMatch(/^Inbox, home@example\.com, 1 unread/);
});

test("a human with one mailbox sees no All mailboxes", budget, async () => {
  const app = await startWebApp({ domain: "example.com", admin: "ada@example.org" });
  const ada = app.duva.signIn("ada@example.org");
  const { data: me } = await ada.GET("/whoami");
  await ada.POST("/mailboxes", { body: { owner: me!.id, address: "ada@example.com" } });
  await app.signIn("ada@example.org");

  await expect.poll(() => app.page.locator(".bar-mailbox").innerText(), wait).toMatch(/^Your mailbox/);
  expect(await app.page.getByText("All mailboxes").count()).toBe(0);
});
