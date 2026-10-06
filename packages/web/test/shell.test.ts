import type { Page } from "playwright-core";
import { expect, test } from "vitest";
import { phone, startWebApp } from "./web-app.ts";

// The page reads the change feeds every 250 ms in these tests, but a page under the full suite's
// load can still take seconds to show what changed, so every wait has room, and every test more.
const wait = { timeout: 10_000 };
const budget = { timeout: 60_000 };

/** A message from Grace that starts its own thread. */
const note = (to: string, subject: string) =>
  [
    "From: Grace Hopper <grace@example.org>",
    `To: ${to}`,
    `Subject: ${subject}`,
    "Date: Sun, 04 Oct 2026 09:00:00 +0200",
    `Message-ID: <${subject.replaceAll(" ", "-")}@example.org>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Hej.",
  ].join("\r\n");

/**
 * The web app for a deployment where Ada, the admin, has two mailboxes of her own: lovelace@example.com,
 * created first, and ada@example.com. Mail from first-time senders goes straight to their Inboxes.
 */
async function withTwoMailboxes(options: Parameters<typeof startWebApp>[0] = {}) {
  const app = await startWebApp({ domain: "example.com", admin: "ada@example.org", ...options });
  const ada = app.duva.signIn("ada@example.org");
  const { data: me } = await ada.GET("/whoami");
  const ids: string[] = [];
  for (const address of ["lovelace@example.com", "ada@example.com"]) {
    const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: me!.id, address } });
    await ada.PATCH("/mailboxes/{mailbox}/screener", { params: { path: { mailbox: mailbox!.id } }, body: { on: false } });
    ids.push(mailbox!.id);
  }
  const receive = (to: string, subject: string) => app.duva.receive(note(to, subject), { to: [to] });
  return { ...app, ada, me: me!, lovelace: ids[0]!, receive };
}

const mailboxes = (page: Page) => page.getByRole("navigation", { name: "Mailboxes" });
const views = (page: Page) => page.getByRole("navigation", { name: "Mail" });
const title = (page: Page) => page.getByRole("heading", { level: 1 }).textContent();
const fits = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test("a human's own mailboxes are each listed by their address with their unread counts, and each opens as theirs", budget, async () => {
  const { page, signIn, receive, lovelace } = await withTwoMailboxes();
  await receive("ada@example.com", "Till Ada");
  await receive("lovelace@example.com", "Till Lovelace");
  await receive("lovelace@example.com", "Igen till Lovelace");
  await signIn("ada@example.org");

  const links = mailboxes(page).getByRole("link");
  await expect.poll(() => links.count(), wait).toBe(2);
  // The order doesn't follow the order they were made in.
  await expect.poll(() => links.nth(0).getAttribute("aria-label"), wait).toBe("ada@example.com, 1 unread");
  await expect.poll(() => links.nth(1).getAttribute("aria-label"), wait).toBe("lovelace@example.com, 2 unread");
  expect(await links.nth(0).getAttribute("aria-current")).toBe("page");

  await links.nth(1).click();

  await expect.poll(() => page.getByRole("link", { name: /Igen till Lovelace/ }).count(), wait).toBe(1);
  expect(await page.getByRole("link", { name: /Till Ada/ }).count()).toBe(0);
  expect(await links.nth(1).getAttribute("aria-current")).toBe("page");
  expect(await views(page).getByRole("link", { name: "Drafts" }).count()).toBe(1);
  expect(page.url()).toContain(`#/mailboxes/${lovelace}/`);

  await page.reload();

  await expect.poll(() => page.getByRole("link", { name: /Igen till Lovelace/ }).count(), wait).toBe(1);
  expect(await page.getByText("isn't yours to read").count()).toBe(0);
});

test("a human writes from their second mailbox, and the draft lies in its Drafts, not the first's", budget, async () => {
  const { page, signIn, ada, lovelace } = await withTwoMailboxes();
  await signIn("ada@example.org");
  await mailboxes(page).getByRole("link", { name: /^lovelace@/ }).click();
  await expect.poll(() => page.url(), wait).toContain(`#/mailboxes/${lovelace}/`);

  await page.getByRole("button", { name: "Write" }).click();

  await expect.poll(() => page.getByRole("main").getByText("lovelace@example.com", { exact: true }).first().isVisible(), wait).toBe(true);
  await page.getByLabel("Subject", { exact: true }).fill("Från Lovelace");
  await page.getByLabel("Message", { exact: true }).fill("Hej.");
  const saved = async () => (await ada.GET("/mailboxes/{mailbox}/drafts", { params: { path: { mailbox: lovelace } } })).data?.drafts.map(({ text }) => text);
  await expect.poll(saved, wait).toEqual(["Hej."]);
  // Once saved, the draft's address names its mailbox (#102), and so does reloading it.
  await expect.poll(() => page.url(), wait).toMatch(new RegExp(`#/mailboxes/${lovelace}/drafts/[^/]+$`));
  await page.reload();
  await expect.poll(() => page.url(), wait).toMatch(new RegExp(`#/mailboxes/${lovelace}/drafts/`));
  await expect.poll(() => page.getByLabel("Message", { exact: true }).inputValue(), wait).toBe("Hej.");
  await views(page).getByRole("link", { name: "Drafts" }).click();

  const drafts = page.getByRole("list", { name: "Drafts" }).getByRole("listitem");
  await expect.poll(() => drafts.allInnerTexts(), wait).toEqual([expect.stringContaining("Från Lovelace")]);
  await drafts.first().getByRole("link").click();
  await expect.poll(() => page.getByLabel("Message", { exact: true }).inputValue(), wait).toBe("Hej.");
  expect(await mailboxes(page).getByRole("link", { name: /^lovelace@/ }).getAttribute("aria-current")).toBe("page");

  await mailboxes(page).getByRole("link", { name: /^ada@/ }).click();
  await views(page).getByRole("link", { name: "Drafts" }).click();
  await expect.poll(() => page.getByText("No drafts").count(), wait).toBe(1);
});

test("the Screener sheet in Settings lists every mailbox of the human's own", budget, async () => {
  const { page, signIn } = await withTwoMailboxes();
  await signIn("ada@example.org");
  await page.getByRole("navigation", { name: "Duva" }).getByRole("link", { name: "Settings" }).click();
  await page.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: "Screener" }).click();

  const sheet = page.getByRole("region", { name: "Screener" });
  await expect.poll(() => sheet.getByRole("group").count(), wait).toBe(2);
  const text = await sheet.innerText();
  expect(text).toContain("ada@example.com");
  expect(text).toContain("lovelace@example.com");
});

test("a mailbox an admin gives the human shows beside the mail without a reload, and an idle read doesn't list the mailboxes again", budget, async () => {
  const { page, signIn, ada, me } = await withTwoMailboxes();
  let listed = 0;
  page.on("request", (request) => {
    if (request.method() === "GET" && new URL(request.url()).pathname === "/api/mailboxes") listed += 1;
  });
  await signIn("ada@example.org");
  await expect.poll(() => mailboxes(page).getByRole("link").count(), wait).toBe(2);
  await expect.poll(() => page.getByText(/^Up to date/).count(), wait).toBe(1);
  const opened = listed;

  // The feeds are read every 250 ms here, so a second is several reads.
  await page.waitForTimeout(1_500);
  expect(listed).toBe(opened);

  await ada.POST("/mailboxes", { body: { owner: me.id, address: "countess@example.com" } });

  await expect.poll(() => mailboxes(page).getByRole("link").allInnerTexts(), wait).toEqual([
    expect.stringContaining("ada@example.com"),
    expect.stringContaining("countess@example.com"),
    expect.stringContaining("lovelace@example.com"),
  ]);
});

test("going back to a thread of the first mailbox opens it there, after the human went to their second", budget, async () => {
  const { page, signIn, receive } = await withTwoMailboxes();
  await receive("ada@example.com", "Till Ada");
  await signIn("ada@example.org");
  await page.getByRole("link", { name: /Till Ada/ }).click();
  await expect.poll(() => title(page), wait).toBe("Till Ada");

  await mailboxes(page).getByRole("link", { name: /^lovelace@/ }).click();
  await expect.poll(() => mailboxes(page).getByRole("link", { name: /^lovelace@/ }).getAttribute("aria-current"), wait).toBe("page");
  await page.goBack();

  await expect.poll(() => title(page), wait).toBe("Till Ada");
  expect(await mailboxes(page).getByRole("link", { name: /^ada@/ }).getAttribute("aria-current")).toBe("page");
});

test("a member opens a mailbox an admin gave them since the page opened, and it is theirs", budget, async () => {
  const app = await startWebApp({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org"] });
  const ada = app.duva.signIn("ada@example.org");
  const { data: grace } = await app.duva.signIn("grace@example.org").GET("/whoami");
  await ada.POST("/mailboxes", { body: { owner: grace!.id, address: "grace@example.com" } });
  const { page } = app;
  await app.signIn("grace@example.org");
  await expect.poll(() => title(page), wait).toBe("Inbox");

  const { data: given } = await ada.POST("/mailboxes", { body: { owner: grace!.id, address: "hopper@example.com" } });
  await page.evaluate((id) => (location.hash = `#/mailboxes/${id}/`), given!.id);

  await expect.poll(() => page.getByRole("main").getByText("hopper@example.com").first().isVisible(), wait).toBe(true);
  expect(await page.getByText("isn't yours to read").count()).toBe(0);
  expect(await mailboxes(page).getByRole("link").count()).toBe(2);
});

test("on a phone the bar is one row with the search icon and Write, and the places lie in a tab bar at the foot", budget, async () => {
  const { page, signIn } = await withTwoMailboxes({ viewport: phone });
  await signIn("ada@example.org");
  const write = page.getByRole("button", { name: "Write" });
  const searchIcon = page.getByRole("button", { name: "Search" });
  await expect.poll(() => write.isVisible(), wait).toBe(true);

  const wordmark = (await page.locator(".bar .wordmark").boundingBox())!;
  for (const control of [write, searchIcon]) {
    const box = (await control.boundingBox())!;
    expect(Math.abs(box.y + box.height / 2 - (wordmark.y + wordmark.height / 2))).toBeLessThan(4);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  expect(await page.getByRole("button", { name: "Sign out" }).isVisible()).toBe(false);
  expect(await page.getByRole("searchbox").isVisible()).toBe(false);

  const places = page.getByRole("navigation", { name: "Duva" }).getByRole("link");
  expect(await places.allInnerTexts()).toEqual(["Mail", "Settings"]);
  const tabBarHeight = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--tab-bar-height"));
  expect(tabBarHeight).not.toBe("0px");
  for (const place of await places.all()) {
    const box = (await place.boundingBox())!;
    expect(box.y + box.height).toBeGreaterThan(phone.height - 4);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }

  await searchIcon.click();

  expect(await searchIcon.getAttribute("aria-expanded")).toBe("true");
  await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("type")), wait).toBe("search");
  await page.keyboard.type("Lunch");
  await page.keyboard.press("Enter");
  await expect.poll(() => title(page), wait).toBe("Search results");
  expect(await page.getByRole("searchbox").isVisible()).toBe(true);
  expect(await fits(page)).toBe(true);
});

test("on a desk there is no tab bar, and the bar's search field stands out from the desk at 3:1", budget, async () => {
  const { page, signIn } = await withTwoMailboxes();
  await signIn("ada@example.org");
  await expect.poll(() => page.getByRole("searchbox").isVisible(), wait).toBe(true);

  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--tab-bar-height"))).toBe("0px");
  expect(await page.getByRole("button", { name: "Search" }).isVisible()).toBe(false);
  expect(await page.getByRole("button", { name: "Sign out" }).isVisible()).toBe(true);
  const contrast = await page.getByRole("searchbox").evaluate((field) => {
    const rgb = (color: string) => color.match(/\d+/g)!.slice(0, 3).map(Number);
    const luminance = (color: string) => {
      const [r, g, b] = rgb(color).map((value) => value / 255).map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    const border = luminance(getComputedStyle(field).borderTopColor);
    const desk = luminance(getComputedStyle(document.body).backgroundColor);
    return (Math.max(border, desk) + 0.05) / (Math.min(border, desk) + 0.05);
  });
  expect(contrast).toBeGreaterThanOrEqual(3);
});

test("on a phone one switcher names the view and the mailbox, and opens the mailboxes and views in place of the strips", budget, async () => {
  const { page, signIn, receive } = await withTwoMailboxes({ viewport: phone });
  await receive("lovelace@example.com", "Till Lovelace");
  await signIn("ada@example.org");
  const switcher = page.getByRole("button", { name: /Mailboxes and views/ });

  await expect.poll(() => switcher.getAttribute("aria-label"), wait).toBe("Inbox, ada@example.com, New mail in another mailbox, Mailboxes and views");
  expect(await mailboxes(page).isVisible()).toBe(false);
  expect(await views(page).isVisible()).toBe(false);

  await switcher.click();

  expect(await switcher.getAttribute("aria-expanded")).toBe("true");
  // Nothing in it scrolls sideways: the mailboxes and views lie in lines, as on a desk.
  const sideways = await page.locator(".side-nav, .side-nav *").evaluateAll((all) => all.filter((element) => element.scrollWidth > element.clientWidth + 1 && getComputedStyle(element).overflowX !== "visible").length);
  expect(sideways).toBe(0);
  expect(await fits(page)).toBe(true);
  for (const link of await page.locator(".side-nav a").all()) expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await views(page).getByRole("link", { name: "Sent" }).click();

  await expect.poll(() => switcher.getAttribute("aria-label"), wait).toBe("Sent, ada@example.com, New mail in another mailbox, Mailboxes and views");
  expect(await switcher.getAttribute("aria-expanded")).toBe("false");

  await switcher.click();
  await mailboxes(page).getByRole("link", { name: /^lovelace@/ }).click();
  await expect.poll(() => switcher.getAttribute("aria-label"), wait).toBe("Inbox, lovelace@example.com, Mailboxes and views");
  await page.getByRole("link", { name: /Till Lovelace/ }).click();

  // While a thread is read the switcher steps aside, and the back link names the view.
  await expect.poll(() => title(page), wait).toBe("Till Lovelace");
  expect(await switcher.isVisible()).toBe(false);
  expect(await page.getByRole("link", { name: "Inbox" }).isVisible()).toBe(true);

  await page.getByRole("link", { name: "Inbox" }).click();
  await switcher.click();
  await page.keyboard.press("Escape");
  expect(await switcher.getAttribute("aria-expanded")).toBe("true");
  await views(page).getByRole("link", { name: "Inbox" }).focus();
  await page.keyboard.press("Escape");
  expect(await switcher.getAttribute("aria-expanded")).toBe("false");
  expect(await switcher.evaluate((button) => button === document.activeElement)).toBe(true);
});

test("the title a view opens at is ringed after the keyboard took the human there, and not after the mouse", budget, async () => {
  const { page, signIn, receive } = await withTwoMailboxes();
  await receive("ada@example.com", "Till Ada");
  await signIn("ada@example.org");
  await expect.poll(() => page.getByRole("link", { name: /Till Ada/ }).count(), wait).toBe(1);
  const focusedTitle = () =>
    page.evaluate(() => {
      const title = document.activeElement;
      if (title?.tagName !== "H1") return undefined;
      const style = getComputedStyle(title);
      return { text: title.textContent, ringed: style.outlineStyle !== "none" || getComputedStyle(title, "::before").content !== "none" };
    });

  await page.getByRole("link", { name: /Till Ada/ }).click();
  await expect.poll(focusedTitle, wait).toEqual({ text: "Till Ada", ringed: false });
  await views(page).getByRole("link", { name: "Sent" }).click();
  await expect.poll(focusedTitle, wait).toEqual({ text: "Sent", ringed: false });

  await views(page).getByRole("link", { name: "Inbox" }).focus();
  await page.keyboard.press("Enter");
  await expect.poll(focusedTitle, wait).toEqual({ text: "Inbox", ringed: true });
  await page.getByRole("link", { name: /Till Ada/ }).focus();
  await page.keyboard.press("Enter");
  await expect.poll(focusedTitle, wait).toEqual({ text: "Till Ada", ringed: true });
});

test("the first Tab reaches a skip link, which takes the human past the bar and the side column to the view", budget, async () => {
  const { page, signIn, receive } = await withTwoMailboxes();
  await receive("ada@example.com", "Till Ada");
  await signIn("ada@example.org");
  await expect.poll(() => page.getByRole("link", { name: /Till Ada/ }).count(), wait).toBe(1);

  await page.keyboard.press("Tab");

  const skip = page.getByRole("link", { name: "Skip to main content" });
  expect(await skip.evaluate((link) => link === document.activeElement)).toBe(true);
  expect(await skip.isVisible()).toBe(true);
  await page.keyboard.press("Enter");

  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName === "H1" && document.activeElement.closest("main") !== null), wait).toBe(true);
  expect(await title(page)).toBe("Inbox");
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.activeElement?.closest("main") !== null)).toBe(true);
});

test("the mail's serif is fetched with the page, and Settings loads when first opened", budget, async () => {
  const { page, signIn } = await withTwoMailboxes();
  const scripts: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "script") scripts.push(new URL(request.url()).pathname);
  });
  await signIn("ada@example.org");
  await expect.poll(() => title(page), wait).toBe("Inbox");

  expect(await page.locator('link[rel="preload"][as="font"]').getAttribute("href")).toMatch(/source-serif-4-latin-opsz-normal/);
  const opening = scripts.length;
  await page.getByRole("navigation", { name: "Duva" }).getByRole("link", { name: "Settings" }).click();
  await expect.poll(() => title(page), wait).toBe("Settings");
  expect(scripts.length).toBeGreaterThan(opening);
});
