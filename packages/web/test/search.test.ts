import type { Page } from "playwright-core";
import { expect, test } from "vitest";
import { phone, startWebApp } from "./web-app.ts";

// The page reads the change feeds every 250 ms in these tests, but a page under the full suite's
// load can still take seconds to show what changed, so every wait has room, and every test more.
const wait = { timeout: 10_000 };
const budget = { timeout: 60_000 };

/** A message to Grace that starts its own thread, from Ada unless it says, received on the day. */
const note = (subject: string, text: string, { from = "Ada Lovelace <ada@example.org>", date = "Sun, 04 Oct 2026 09:00:00 +0200", to = "Grace <grace@example.com>" } = {}) =>
  [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Date: ${date}`,
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
  const grace = app.duva.signIn("grace@example.org");
  const { data: me } = await grace.GET("/whoami");
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: me!.id, address: "grace@example.com" } });
  // Mail from first-time senders would wait in the Screener, which these tests leave out.
  await grace.PATCH("/mailboxes/{mailbox}/screener", { params: { path: { mailbox: mailbox!.id } }, body: { on: false } });
  const receive = async (raw: string, at?: Date) => {
    await app.duva.receive(raw, { to: ["grace@example.com"] }, { at });
  };
  return { ...app, grace, mailbox: mailbox!, receive };
}

const searchBox = (page: Page, name = "Search your mail") => page.getByRole("searchbox", { name });

/** Searches for the words from the bar, as a human types them and presses Enter. */
async function search(page: Page, words: string, box = searchBox(page)) {
  await box.fill(words);
  await box.press("Enter");
  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Search results");
}

const results = (page: Page) => page.getByRole("list", { name: "Results" }).getByRole("listitem");

/** The subjects of the results shown, in order. */
const subjects = (page: Page) => results(page).locator(".thread-subject").allInnerTexts();

test("a human searches their mailbox from the bar and finds the threads with the words, highlighted in each snippet", budget, async () => {
  const { page, signIn, receive } = await withPersonalMailbox();
  await receive(note("Hyran för oktober", "Här kommer fakturan för hyran i oktober. Betala senast fredag."));
  await receive(note("Lunch på fredag", "Ska vi äta lunch på fredag?"));
  await receive(note("Compiler notes", "My notes on the compiler, as promised."));
  await signIn("grace@example.org");
  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Inbox");

  await search(page, "fakturan oktober");

  await expect.poll(() => subjects(page), wait).toEqual(["Hyran för oktober"]);
  const result = await results(page).first().innerText();
  expect(result).toContain("Ada Lovelace");
  expect(result).toContain("Här kommer fakturan för hyran i oktober.");
  expect(await results(page).first().locator("mark").allInnerTexts()).toEqual(["fakturan", "oktober"]);
  expect(await searchBox(page).inputValue()).toBe("fakturan oktober");
  expect(await page.title()).toBe("fakturan oktober · Duva");
});

test("pressing / anywhere outside a field puts the cursor in the search box", budget, async () => {
  const { page, signIn, receive } = await withPersonalMailbox();
  await receive(note("Lunch på fredag", "Ska vi äta lunch på fredag?"));
  await signIn("grace@example.org");
  await expect.poll(() => page.getByRole("link", { name: /Lunch på fredag/ }).count(), wait).toBe(1);

  await page.keyboard.press("/");
  await page.keyboard.type("lunch/fredag");

  expect(await searchBox(page).evaluate((box) => box === document.activeElement)).toBe(true);
  // The slash that moved the cursor isn't typed, and later ones are.
  expect(await searchBox(page).inputValue()).toBe("lunch/fredag");
});

test("the filter menu builds from:, is:unread and dates into the search, and reads them back from what was typed", budget, async () => {
  const { page, signIn, receive } = await withPersonalMailbox();
  await receive(note("Kvitto från Ada", "Kvitto på din beställning."), new Date("2026-09-20T09:00:00Z"));
  await receive(note("Kvitto från Grace", "Kvitto på din beställning.", { from: "Grace Hopper <hopper@example.net>" }), new Date("2026-09-21T09:00:00Z"));
  await receive(note("Gammalt kvitto från Ada", "Kvitto från i somras.", { date: "Mon, 03 Aug 2026 09:00:00 +0200" }), new Date("2026-08-03T09:00:00Z"));
  await signIn("grace@example.org");

  await searchBox(page).fill("kvitto");
  await page.getByRole("button", { name: "Filters" }).click();
  const filters = page.getByRole("group", { name: "Filters" });
  await filters.getByLabel("From").fill("ada");
  await filters.getByLabel("On or after").fill("2026-09-01");
  await filters.getByLabel("Unread").check();
  await filters.getByRole("button", { name: "Search" }).click();

  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Search results");
  expect(await searchBox(page).inputValue()).toBe("kvitto from:ada is:unread after:2026-09-01");
  await expect.poll(() => subjects(page), wait).toEqual(["Kvitto från Ada"]);

  // What was typed shows in the menu, and changing it there changes the search.
  await searchBox(page).fill("kvitto from:grace is:unread");
  await page.getByRole("button", { name: "Filters" }).click();
  expect(await filters.getByLabel("From").inputValue()).toBe("grace");
  expect(await filters.getByLabel("Unread").isChecked()).toBe(true);
  await filters.getByLabel("Unread").uncheck();
  await filters.getByLabel("From").fill("");
  await filters.getByRole("button", { name: "Search" }).click();

  await expect.poll(() => searchBox(page).inputValue(), wait).toBe("kvitto");
  await expect.poll(async () => (await subjects(page)).toSorted(), wait).toEqual(["Gammalt kvitto från Ada", "Kvitto från Ada", "Kvitto från Grace"]);
});

test("the filter menu closes with Escape, back on its button", budget, async () => {
  const { page, signIn } = await withPersonalMailbox();
  await signIn("grace@example.org");

  const button = page.getByRole("button", { name: "Filters" });
  await button.click();
  expect(await page.getByRole("group", { name: "Filters" }).getByLabel("From").evaluate((field) => field === document.activeElement)).toBe(true);
  await page.keyboard.press("Escape");

  expect(await page.getByRole("group", { name: "Filters" }).count()).toBe(0);
  expect(await button.getAttribute("aria-expanded")).toBe("false");
  expect(await button.evaluate((button) => button === document.activeElement)).toBe(true);
});

test("typed filters search too, and an unknown filter shows Duva's words", budget, async () => {
  const { page, signIn, receive } = await withPersonalMailbox();
  await receive(note("Semesterbilder", "Bilderna från Lissabon."));
  await receive(note("Kvitto", "Kvitto på din beställning.", { from: "Grace Hopper <hopper@example.net>" }));
  await signIn("grace@example.org");

  await search(page, "from:hopper");
  await expect.poll(() => subjects(page), wait).toEqual(["Kvitto"]);

  await search(page, "colour:red");
  await expect.poll(() => page.getByRole("alert").innerText(), wait).toContain("colour: isn't a filter.");
  expect(await results(page).count()).toBe(0);
});

test("a search that finds nothing says so", budget, async () => {
  const { page, signIn, receive } = await withPersonalMailbox();
  await receive(note("Lunch på fredag", "Ska vi äta lunch på fredag?"));
  await signIn("grace@example.org");

  await search(page, "zebra");

  await expect.poll(() => page.getByRole("heading", { name: "No threads match" }).count(), wait).toBe(1);
  expect(await page.getByRole("main").innerText()).toContain("zebra");
});

test("results are best match first, and the sort switch puts the newest first", budget, async () => {
  const { page, signIn, receive } = await withPersonalMailbox();
  await receive(note("Budget 2027", "The budget for 2027. The budget grows, so the budget needs a look.", { date: "Thu, 01 Oct 2026 09:00:00 +0200" }), new Date("2026-10-01T07:00:00Z"));
  await receive(
    note("Weekend plans", "We could walk by the sea on Saturday, then have dinner at the place by the harbour, which is within our budget, and take the late train home.", {
      date: "Sat, 03 Oct 2026 09:00:00 +0200",
    }),
    new Date("2026-10-03T07:00:00Z"),
  );
  await signIn("grace@example.org");

  await search(page, "budget");
  const sort = page.getByRole("navigation", { name: "Sort" });
  await expect.poll(() => subjects(page), wait).toEqual(["Budget 2027", "Weekend plans"]);
  expect(await sort.getByRole("link", { name: "Best match" }).getAttribute("aria-current")).toBe("page");

  await sort.getByRole("link", { name: "Newest" }).click();

  await expect.poll(() => subjects(page), wait).toEqual(["Weekend plans", "Budget 2027"]);
  expect(await sort.getByRole("link", { name: "Newest" }).getAttribute("aria-current")).toBe("page");
  expect(await searchBox(page).inputValue()).toBe("budget");
});

test("results come a page at a time", budget, async () => {
  const { page, signIn, receive } = await withPersonalMailbox();
  for (let day = 1; day <= 21; day++) await receive(note(`Rapport ${day}`, `Veckans rapport, nummer ${day}.`), new Date(`2026-09-${String(day).padStart(2, "0")}T09:00:00Z`));
  await signIn("grace@example.org");

  await search(page, "rapport");
  await page.getByRole("navigation", { name: "Sort" }).getByRole("link", { name: "Newest" }).click();

  await expect.poll(() => results(page).count(), wait).toBe(20);
  expect((await subjects(page))[0]).toBe("Rapport 21");
  await page.getByRole("button", { name: "Show more results" }).click();
  await expect.poll(() => results(page).count(), wait).toBe(21);
  expect((await subjects(page)).at(-1)).toBe("Rapport 1");
  expect(await page.getByRole("button", { name: "Show more results" }).count()).toBe(0);
});

test("opening a result shows its thread at the message that matched, and the way back to the results", budget, async () => {
  const { page, signIn, receive } = await withPersonalMailbox({ viewport: { width: 1280, height: 600 } });
  const long = Array.from({ length: 60 }, (_, line) => `Rad ${line + 1} av anteckningarna.`).join("\n");
  const message = (id: number, from: string, text: string, date: string) =>
    [
      `From: ${from}`,
      "To: Grace <grace@example.com>",
      id === 1 ? "Subject: Resplan" : "Subject: Re: Resplan",
      `Date: ${date}`,
      `Message-ID: <resplan-${id}@example.org>`,
      ...(id === 1 ? [] : [`In-Reply-To: <resplan-${id - 1}@example.org>`, `References: ${Array.from({ length: id - 1 }, (_, each) => `<resplan-${each + 1}@example.org>`).join(" ")}`]),
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "",
      text,
    ].join("\r\n");
  await receive(message(1, "Ada Lovelace <ada@example.org>", `Förslag till resan.\n${long}`, "Thu, 01 Oct 2026 09:00:00 +0200"));
  await receive(message(2, "Ada Lovelace <ada@example.org>", `Mer om resan.\n${long}`, "Fri, 02 Oct 2026 09:00:00 +0200"));
  await receive(message(3, "Ada Lovelace <ada@example.org>", "Tåget till Lissabon går klockan åtta.", "Sat, 03 Oct 2026 09:00:00 +0200"));
  await receive(message(4, "Ada Lovelace <ada@example.org>", `En sista sak om resan.\n${long}`, "Sun, 04 Oct 2026 09:00:00 +0200"));
  await signIn("grace@example.org");

  await search(page, "lissabon");
  await results(page).first().getByRole("link").click();

  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Resplan");
  const matched = page.getByRole("article").nth(2);
  await expect.poll(() => matched.evaluate((letter) => letter === document.activeElement), wait).toBe(true);
  expect(await matched.innerText()).toContain("Tåget till Lissabon går klockan åtta.");
  await expect.poll(async () => (await matched.boundingBox())!.y, wait).toBeGreaterThanOrEqual(0);
  expect((await matched.boundingBox())!.y).toBeLessThan(600);
  // It is ringed in pencil for a moment.
  const ring = () => matched.evaluate((letter) => /rgb\(43, 79, 192\)/.test(getComputedStyle(letter).boxShadow));
  await expect.poll(ring, wait).toBe(true);
  await expect.poll(ring, wait).toBe(false);

  await page.getByRole("link", { name: "Search results" }).click();
  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Search results");
  expect(await searchBox(page).inputValue()).toBe("lissabon");
  await expect.poll(() => subjects(page), wait).toEqual(["Resplan"]);
});

test("a sponsor viewing their agent's mailbox searches that mailbox", budget, async () => {
  const app = await startWebApp({ domain: "example.com", admin: "ada@example.org" });
  const ada = app.duva.signIn("ada@example.org");
  const { data: me } = await ada.GET("/whoami");
  const { data: adaMailbox } = await ada.POST("/mailboxes", { body: { owner: me!.id, address: "ada@example.com" } });
  await ada.PATCH("/mailboxes/{mailbox}/screener", { params: { path: { mailbox: adaMailbox!.id } }, body: { on: false } });
  const { data: created } = await ada.POST("/agents", { body: { name: "Hermes" } });
  await ada.POST("/mailboxes", { body: { owner: created!.agent.id, address: "hermes@example.com" } });
  await app.duva.receive(note("Biljetter till Ada", "Biljetterna är bokade.", { to: "ada@example.com" }), { to: ["ada@example.com"] });
  await app.duva.receive(note("Biljetter till Hermes", "Biljetterna är bokade.", { to: "hermes@example.com" }), { to: ["hermes@example.com"] });
  const { page, signIn } = app;
  await signIn("ada@example.org");

  await page.getByRole("navigation", { name: "Mailboxes" }).getByRole("link", { name: /^Hermes/ }).click();
  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Hermes's Inbox");
  await search(page, "biljetter", searchBox(page, "Search Hermes's mail"));

  await expect.poll(() => subjects(page), wait).toEqual(["Biljetter till Hermes"]);
  await results(page).first().getByRole("link").click();
  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Biljetter till Hermes");
});

test("on a phone the search box opens from its icon onto a row of its own, and its results fit the screen", budget, async () => {
  const { page, signIn, receive } = await withPersonalMailbox({ viewport: phone });
  await receive(note("Hyran för oktober", "Här kommer fakturan för hyran i oktober. Betala senast fredag, så slipper du påminnelsen."));
  await signIn("grace@example.org");

  // The search field opens from its icon in the bar.
  await page.getByRole("button", { name: "Search" }).click();
  const box = (await searchBox(page).boundingBox())!;
  expect(box.width).toBeGreaterThan(phone.width * 0.6);
  expect(box.x + box.width).toBeLessThanOrEqual(phone.width);
  await search(page, "fakturan");

  await expect.poll(() => subjects(page), wait).toEqual(["Hyran för oktober"]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(phone.width);
  await page.getByRole("button", { name: "Filters" }).click();
  const panel = (await page.getByRole("group", { name: "Filters" }).boundingBox())!;
  expect(panel.x).toBeGreaterThanOrEqual(0);
  expect(panel.x + panel.width).toBeLessThanOrEqual(phone.width);
});
