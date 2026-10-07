import { expect, onTestFinished, test, vi } from "vitest";
import type { Page } from "playwright-core";
import { phone, startWebApp } from "./web-app.ts";

/** Where the mailbox agents call their model, and what they may spend, in a deployment in eu-north-1 until an admin chooses. */
const mailboxAgentDefaults = { mailboxAgentModel: "anthropic.claude-sonnet-5-5", mailboxAgentProfile: "eu", mailboxAgentRegion: "eu-central-1", mailboxAgentSpendCap: 20 } as const;

// The page under the full suite's load can take seconds to show what changed, so every wait has room, and every test more.
const wait = { timeout: 10_000 };
const budget = { timeout: 60_000 };

const mailSheet = (page: Page) => page.getByRole("region", { name: "Mail", exact: true });
const agentsSheet = (page: Page) => page.getByRole("region", { name: "Agents", exact: true });
const settingsIndex = (page: Page) => page.getByRole("navigation", { name: "Settings" });
/** Opens a page of Settings from its index, as the human does. */
const openPage = (page: Page, name: string) => settingsIndex(page).getByRole("link", { name, exact: true }).click();
/** Opens Settings from the bar, then the page from its index. */
const openSettings = async (page: Page, name?: string) => {
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  if (name !== undefined) await openPage(page, name);
};

/** The names of the index's entries, in order, without their states. */
const entries = (page: Page) => settingsIndex(page).locator(".settings-entry-name").allTextContents();

const withOrganization = () => startWebApp({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org"] });

test("an admin's Settings opens on Preferences, with an index of every page in order, in two groups: You, and the Organization an admin sets", budget, async () => {
  const { page, signIn } = await withOrganization();
  await signIn("ada@example.org");

  await openSettings(page);

  await expect.poll(() => page.getByRole("region", { name: "Preferences" }).isVisible(), wait).toBe(true);
  expect(await page.getByRole("heading", { level: 1 }).textContent()).toBe("Settings");
  expect(await entries(page)).toEqual(["Preferences", "Mail and agents", "Domains", "Addresses", "People", "Groups"]);
  // Two plain groups: what is the human's own, and what the organization shares, at the same level.
  expect(await settingsIndex(page).getByRole("list", { name: "You" }).locator(".settings-entry-name").allTextContents()).toEqual(["Preferences"]);
  expect(await settingsIndex(page).getByRole("list", { name: "Organization" }).locator(".settings-entry-name").allTextContents()).toEqual(["Mail and agents", "Domains", "Addresses", "People", "Groups"]);
  expect(await settingsIndex(page).getByRole("link", { name: "Preferences", exact: true }).getAttribute("aria-current")).toBe("page");
  // The domain's receiving and DMARC records aren't in DNS yet, and its entry says so.
  await expect.poll(() => settingsIndex(page).getByRole("link", { name: /^Domains/ }).textContent(), wait).toBe("Domainsexample.com, 2 records missing");
  expect(await page.getByRole("region", { name: "Domains" }).count()).toBe(0);

  await settingsIndex(page).getByRole("link", { name: /^Domains/ }).click();

  await expect.poll(() => page.getByRole("region", { name: "Domains" }).isVisible(), wait).toBe(true);
  expect(await page.getByRole("region", { name: "Preferences" }).count()).toBe(0);
  expect(await settingsIndex(page).getByRole("link", { name: /^Domains/ }).getAttribute("aria-current")).toBe("page");
  expect(await page.evaluate(() => location.hash)).toBe("#/settings/domains");
});

test("each line of the index says what its page holds now, as its link's description", budget, async () => {
  const { page, signIn, duva } = await withOrganization();
  const ada = duva.signIn("ada@example.org");
  const { data: me } = await ada.GET("/whoami");
  await ada.POST("/mailboxes", { body: { owner: me!.id, address: "ada@example.com" } });
  await ada.POST("/groups", { body: { address: "team@example.com", members: ["ada@example.com"] } });
  await signIn("ada@example.org");

  await openSettings(page);

  /** What the page's line says of it, as a screen reader hears it after the page's name. */
  const state = (name: string) =>
    settingsIndex(page)
      .getByRole("link", { name, exact: true })
      .evaluate((link) => document.getElementById(link.getAttribute("aria-describedby") ?? "")?.textContent);
  await expect.poll(() => state("Groups"), wait).toBe("1 group");
  expect(await state("Preferences")).toBe("Default clock, mail as designed");
  expect(await state("Screener")).toBe("On");
  expect(await state("Mail and agents")).toBe("Trash and Spam keep mail 30 days");
  expect(await state("Domains")).toBe("example.com, 2 records missing");
  expect(await state("Addresses")).toBe("1 mailbox");
  expect(await state("People")).toBe("2 humans");

  // A change on a page shows in its line once another page opens.
  await openPage(page, "Screener");
  await page.getByRole("region", { name: "Screener" }).getByRole("radio", { name: "Off" }).check();
  await page.getByRole("region", { name: "Screener" }).getByRole("button", { name: "Save" }).click();
  await expect.poll(() => page.getByRole("region", { name: "Screener" }).getByRole("status").textContent(), wait).toBe("Saved.");
  await openPage(page, "Preferences");

  await expect.poll(() => state("Screener"), wait).toBe("Off");
});

test("an admin opens the Organization page and chooses that erasing a thread erases its approval records too, on the Agents sheet", budget, async () => {
  const { page, signIn, duva } = await withOrganization();
  await signIn("ada@example.org");

  await openSettings(page, "Mail and agents");

  const keep = agentsSheet(page).getByRole("radio", { name: /^Keep them/ });
  const erase = agentsSheet(page).getByRole("radio", { name: /^Erase them with the thread/ });
  await expect.poll(() => keep.isChecked(), wait).toBe(true);
  expect(await page.getByRole("group", { name: "When a thread with an agent's sends is erased" }).innerText()).toContain("who approved it");

  await erase.check();
  expect(await mailSheet(page).getByRole("button", { name: "Save" }).isDisabled()).toBe(true);
  await agentsSheet(page).getByRole("button", { name: "Save" }).click();

  await expect.poll(() => agentsSheet(page).getByRole("status").textContent(), wait).toBe("Saved. This applies to threads erased from now on.");
  const ada = duva.signIn("ada@example.org");
  expect((await ada.GET("/organization/settings")).data).toEqual({ erasureErasesApprovals: true, retentionDays: 30, searchLanguages: ["English", "Swedish"], agentSendsPerHourCap: 100, agentNewRecipientsPerDayCap: 50, undoWindowSeconds: 0, ...mailboxAgentDefaults });

  await page.reload();

  await expect.poll(() => page.getByRole("radio", { name: /^Erase them with the thread/ }).isChecked(), wait).toBe(true);
});

test("an admin sets how many seconds an approved send waits to be undone, on the Agents sheet", budget, async () => {
  const { page, signIn, duva } = await withOrganization();
  await signIn("ada@example.org");
  await openSettings(page, "Mail and agents");
  const field = agentsSheet(page).getByRole("textbox", { name: "Seconds" });
  await expect.poll(() => field.inputValue(), wait).toBe("0");

  await field.fill("121");
  await expect.poll(() => agentsSheet(page).getByText("Give a whole number of seconds from 0 to 120.").isVisible(), wait).toBe(true);
  expect(await field.getAttribute("aria-invalid")).toBe("true");
  await field.fill("45");
  await agentsSheet(page).getByRole("button", { name: "Save" }).click();

  await expect.poll(() => agentsSheet(page).getByRole("status").textContent(), wait).toBe("Saved. Sends approved from now on wait this long.");
  expect((await duva.signIn("ada@example.org").GET("/organization/settings")).data).toMatchObject({ undoWindowSeconds: 45 });
});

test("the Mail sheet and the Agents sheet each save only their own settings", budget, async () => {
  const { page, signIn, duva } = await withOrganization();
  await signIn("ada@example.org");
  await openSettings(page, "Mail and agents");
  const field = mailSheet(page).getByRole("textbox", { name: "How long Trash and Spam keep mail" });
  await expect.poll(() => field.inputValue(), wait).toBe("30");

  await field.fill("60");
  await agentsSheet(page).getByRole("textbox", { name: "Sends an hour" }).fill("80");
  await agentsSheet(page).getByRole("button", { name: "Save" }).click();

  await expect.poll(() => agentsSheet(page).getByRole("status").textContent(), wait).toBe("Saved. Agents above a lowered cap are lowered to it.");
  const ada = duva.signIn("ada@example.org");
  expect((await ada.GET("/organization/settings")).data).toMatchObject({ retentionDays: 30, agentSendsPerHourCap: 80 });
  expect(await mailSheet(page).getByRole("button", { name: "Save" }).isEnabled()).toBe(true);
});

test("an admin reads what translating searches does, and adds Danish to the search languages, told under them that saving rebuilds the indexes", budget, async () => {
  const { page, signIn, duva } = await withOrganization();
  await signIn("ada@example.org");

  await openSettings(page, "Mail and agents");

  const languages = page.getByRole("group", { name: "Languages your mail is in" });
  const checkbox = (name: string) => languages.getByRole("checkbox", { name: new RegExp(`^${name}`) });
  const rebuilds = "Saving rebuilds every mailbox's search index, which finds less until that is done.";
  await expect.poll(() => checkbox("English").isChecked(), wait).toBe(true);
  expect(await checkbox("Swedish").isChecked()).toBe(true);
  expect(await checkbox("Danish").isChecked()).toBe(false);
  const lead = await languages.innerText();
  expect(lead).toContain("Amazon's Nova Lite model, in the same AWS region as your mail");
  expect(lead).toContain("adds a little time to each search");
  expect(lead).not.toContain(rebuilds);
  // Each language's box is as tall as the others.
  const heights = await languages.locator(".choice").evaluateAll((choices) => choices.map((choice) => choice.getBoundingClientRect().height));
  expect(new Set(heights).size).toBe(1);

  await checkbox("Danish").check();
  expect(await languages.innerText()).toContain(rebuilds);
  await checkbox("Swedish").uncheck();
  expect(await languages.innerText()).toContain(rebuilds);
  await checkbox("Swedish").check();
  await mailSheet(page).getByRole("button", { name: "Save" }).click();

  await expect
    .poll(() => mailSheet(page).getByRole("status").textContent(), wait)
    .toBe("Saved. Searches use these languages from now on. Each mailbox's search index is being rebuilt, and finds less until it is done.");
  const ada = duva.signIn("ada@example.org");
  expect((await ada.GET("/organization/settings")).data).toEqual({ erasureErasesApprovals: false, retentionDays: 30, searchLanguages: ["English", "Swedish", "Danish"], agentSendsPerHourCap: 100, agentNewRecipientsPerDayCap: 50, undoWindowSeconds: 0, ...mailboxAgentDefaults });
  expect(await mailSheet(page).getByRole("button", { name: "Save" }).isDisabled()).toBe(true);
  expect(await languages.innerText()).not.toContain(rebuilds);
});

test("a human who isn't an admin lands on You and reads the organization's retention in a sentence, with no Organization page and nothing of AWS", budget, async () => {
  const { page, signIn } = await withOrganization();
  await signIn("grace@example.org");

  await openSettings(page);

  await expect.poll(() => page.getByText("Trash and Spam keep mail 30 days. Admins choose this for everyone.").isVisible(), wait).toBe(true);
  expect(await page.getByRole("region", { name: "Preferences" }).isVisible()).toBe(true);
  expect(await entries(page)).toEqual(["Preferences"]);
  // Grace has no mailbox, so no mailbox agent for an MCP client to reach.
  expect(await page.getByRole("region", { name: "AI apps" }).count()).toBe(0);
  const text = await page.locator("main").innerText();
  for (const word of ["AWS", "Nova", "Organization", "send limits", "For admins"]) expect(text).not.toContain(word);

  await page.evaluate(() => (location.hash = "#/settings/organization"));

  await expect.poll(() => page.evaluate(() => location.hash), wait).toBe("#/settings/organization");
  expect(await page.getByRole("region", { name: "Preferences" }).isVisible()).toBe(true);
  expect(await page.getByRole("region", { name: "Agents", exact: true }).count()).toBe(0);
  expect(await page.getByRole("radio", { name: /^Keep them/ }).count()).toBe(0);
});

test("Preferences shows Duva's MCP address and how to connect Claude Code and Claude Desktop to it, to a human with a mailbox", budget, async () => {
  const { page, signIn, duva, url } = await withOrganization();
  const { data: grace } = await duva.signIn("grace@example.org").GET("/whoami");
  await duva.signIn("ada@example.org").POST("/mailboxes", { body: { owner: grace!.id, address: "grace@example.com" } });
  await signIn("grace@example.org");
  await openSettings(page);

  const sheet = page.getByRole("region", { name: "AI apps" });
  await expect.poll(() => sheet.isVisible(), wait).toBe(true);
  const address = `${url}api/mcp`;
  expect(await sheet.locator("code").allTextContents()).toEqual([address, `claude mcp add --transport http duva ${address}`]);
  expect(await sheet.getByRole("button", { name: `Copy ${address}`, exact: true }).isVisible()).toBe(true);
  expect(await sheet.innerText()).toContain("Add custom connector");
});

test("on a phone Settings opens on its index, each page links back to it, and Sign out is on Preferences", budget, async () => {
  const { page, signIn } = await startWebApp({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org"], viewport: phone });
  await signIn("ada@example.org");

  await openSettings(page);

  await expect.poll(() => settingsIndex(page).getByRole("link", { name: "Mail and agents" }).isVisible(), wait).toBe(true);
  expect(await page.getByRole("region", { name: "Preferences" }).isVisible()).toBe(false);
  expect(await page.getByRole("link", { name: "Settings", exact: true }).filter({ visible: true }).count()).toBe(1);
  // Preferences' line says the human's choices in words here too.
  expect(await settingsIndex(page).getByRole("link", { name: "Preferences", exact: true }).innerText()).toContain("Default clock, mail as designed");

  await openPage(page, "Preferences");

  await expect.poll(() => page.getByRole("region", { name: "Preferences" }).isVisible(), wait).toBe(true);
  expect(await settingsIndex(page).isVisible()).toBe(false);
  expect(await page.getByText("Signed in as ada@example.org.").isVisible()).toBe(true);
  expect(await page.getByRole("main").getByRole("button", { name: "Sign out" }).isVisible()).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(phone.width);

  await page.getByRole("main").getByRole("link", { name: "Settings" }).click();

  await expect.poll(() => settingsIndex(page).isVisible(), wait).toBe(true);
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe("H1");
  expect(await page.getByRole("region", { name: "Preferences" }).isVisible()).toBe(false);
  await openPage(page, "Mail and agents");
  await expect.poll(() => agentsSheet(page).isVisible(), wait).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(phone.width);
});

test("opening a page from the index by keyboard takes the focus to its sheet", budget, async () => {
  const { page, signIn } = await withOrganization();
  await signIn("ada@example.org");
  await openSettings(page);
  await expect.poll(() => page.getByRole("region", { name: "Preferences" }).isVisible(), wait).toBe(true);

  await settingsIndex(page).getByRole("link", { name: "Mail and agents" }).focus();
  await page.keyboard.press("Enter");

  await expect.poll(() => page.evaluate(() => document.activeElement?.textContent), wait).toBe("Mail");
});

for (const viewport of [undefined, phone]) {
  test(`opening a page by its address, from Mail or by a reload, takes the focus to its sheet's title, even one shown once its data is read${viewport === undefined ? "" : ", on a phone"}`, budget, async () => {
    const { page, signIn, duva } = await startWebApp({ domain: "example.com", admin: "ada@example.org", ...(viewport === undefined ? {} : { viewport }) });
    const ada = duva.signIn("ada@example.org");
    const { data: me } = await ada.GET("/whoami");
    await ada.POST("/mailboxes", { body: { owner: me!.id, address: "ada@example.com" } });
    const { data: hermes } = await ada.POST("/agents", { body: { name: "Hermes" } });
    await signIn("ada@example.org");
    await expect.poll(() => page.getByRole("navigation", { name: "Duva" }).isVisible(), wait).toBe(true);
    const focused = () => page.evaluate(() => `${document.activeElement?.tagName} ${document.activeElement?.closest("summary")?.querySelector("h3")?.textContent ?? document.activeElement?.textContent}`);

    for (const [hash, title] of [
      ["#/settings/agents", "H2 Your agents"],
      ["#/settings/screener", "H2 Screener"],
      ["#/settings/organization", "H2 Mail"],
      // An agent's own page gives the focus on to its line.
      [`#/settings/agents/${hermes!.agent.id}`, "SUMMARY Hermes"],
    ] as const) {
      await page.evaluate(() => (location.hash = "#/"));
      await expect.poll(() => settingsIndex(page).count(), wait).toBe(0);
      await page.evaluate((hash) => (location.hash = hash), hash);
      await expect.poll(focused, wait).toBe(title);

      await page.reload();
      await expect.poll(focused, wait).toBe(title);
    }
  });
}

/** A message from Ada to Grace, dated a year before it arrives, so the thread shows its date with the year. */
const note = (subject: string) =>
  [
    "From: Ada Lovelace <ada@example.org>",
    "To: Grace <grace@example.com>",
    `Subject: ${subject}`,
    "Date: Sat, 04 Oct 2025 14:05:00 +0000",
    `Message-ID: <${subject}@example.org>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Hej Grace.",
  ].join("\r\n");

/**
 * The web app at noon on 5 October 2026, UTC, where Grace, a human who isn't an admin, has a
 * personal mailbox. Its Inbox holds Lunch, which arrived that morning at 09:15, and Kvitto, which
 * arrived the day before.
 */
async function withGracesInbox() {
  const app = await withOrganization();
  const ada = app.duva.signIn("ada@example.org");
  const grace = app.duva.signIn("grace@example.org");
  const { data: me } = await grace.GET("/whoami");
  const { data: graceMailbox } = await ada.POST("/mailboxes", { body: { owner: me!.id, address: "grace@example.com" } });
  // Mail from first-time senders would wait in the Screener, which these tests leave out.
  await app.duva.signIn("grace@example.org").PATCH("/mailboxes/{mailbox}/screener", { params: { path: { mailbox: graceMailbox!.id } }, body: { on: false } });
  await app.duva.receive(note("Kvitto"), { to: ["grace@example.com"] }, { at: new Date("2026-10-04T08:00:00Z") });
  await app.duva.receive(note("Lunch"), { to: ["grace@example.com"] }, { at: new Date("2026-10-05T09:15:00Z") });
  await app.page.clock.setFixedTime(new Date("2026-10-05T12:00:00Z"));
  return { ...app, grace };
}

const you = (page: Page) => page.getByRole("region", { name: "Preferences" });
const row = (page: Page, subject: string) => page.getByRole("list", { name: "Threads" }).getByRole("listitem").filter({ hasText: subject }).locator("time");
const saved = "Saved. This applies from now on.";

test("a human's times and dates follow their browser's language until they choose otherwise", budget, async () => {
  const { page, signIn } = await withGracesInbox();
  await signIn("grace@example.org");

  await expect.poll(() => row(page, "Lunch").textContent(), wait).toBe("09:15 AM");
  expect(await row(page, "Kvitto").textContent()).toBe("Oct 4");
  await page.getByRole("link", { name: /Lunch/ }).click();
  await expect.poll(() => page.getByRole("article").locator(".letter-dated").textContent(), wait).toBe("Dated Oct 4, 2025, 02:05 PM");
});

test("a human chooses 24-hour time and ISO dates, and the Inbox and a thread show them, also after a reload", budget, async () => {
  const { page, signIn, grace } = await withGracesInbox();
  await signIn("grace@example.org");

  await openSettings(page);
  await expect.poll(() => you(page).getByRole("radio", { name: /^Default/ }).first().isChecked(), wait).toBe(true);
  await you(page).getByRole("radio", { name: /^24-hour/ }).check();
  await you(page).getByRole("radio", { name: /^Year first/ }).check();
  await you(page).getByRole("button", { name: "Save" }).click();

  await expect.poll(() => you(page).getByRole("status").textContent(), wait).toBe(saved);
  expect((await grace.GET("/preferences")).data).toEqual({ hourCycle: "h23", dateFormat: "iso", mailView: "html", keyboardShortcuts: "on", cooSpeaksUp: "on" });

  await page.getByRole("navigation").getByRole("link", { name: "Mail", exact: true }).click();
  await expect.poll(() => row(page, "Lunch").textContent(), wait).toBe("09:15");
  expect(await row(page, "Lunch").getAttribute("title")).toBe("2026-10-05 09:15");
  expect(await row(page, "Kvitto").textContent()).toBe("10-04");

  await page.reload();

  await expect.poll(() => row(page, "Kvitto").textContent(), wait).toBe("10-04");
  await page.getByRole("link", { name: /Lunch/ }).click();
  await expect.poll(() => page.getByRole("article").locator(".letter-dated").textContent(), wait).toBe("Dated 2025-10-04 14:05");
});

test("each choice of how times and dates show has an example from today", budget, async () => {
  const { page, signIn } = await withGracesInbox();
  await signIn("grace@example.org");

  await openSettings(page);

  await expect.poll(() => you(page).getByRole("radio").count(), wait).toBe(13);
  const examples = await you(page).locator(".choices-short .choice").evaluateAll((choices) => choices.map((choice) => choice.querySelector(".hint")?.textContent));
  expect(examples).toEqual(["02:30 PM", "2:30 PM", "14:30", "Oct 5, 2026", "2026-10-05", "5 Oct 2026", "Oct 5, 2026"]);
});

test("a human chooses dates with the day first, and their 12-hour time stays", budget, async () => {
  const { page, signIn, grace } = await withGracesInbox();
  await grace.PATCH("/preferences", { body: { hourCycle: "h12" } });
  await signIn("grace@example.org");

  await openSettings(page);
  await expect.poll(() => you(page).getByRole("radio", { name: /^12-hour/ }).isChecked(), wait).toBe(true);
  await you(page).getByRole("radio", { name: /^Day first/ }).check();
  await you(page).getByRole("button", { name: "Save" }).click();
  await expect.poll(() => you(page).getByRole("status").textContent(), wait).toBe(saved);
  // The index says the human's choices in words.
  await openPage(page, "Screener");
  await expect.poll(() => settingsIndex(page).getByRole("link", { name: "Preferences", exact: true }).innerText(), wait).toContain("12-hour clock, dates day first, mail as designed");

  await page.getByRole("navigation").getByRole("link", { name: "Mail", exact: true }).click();
  await expect.poll(() => row(page, "Kvitto").textContent(), wait).toBe("4 Oct");
  expect(await row(page, "Lunch").textContent()).toBe("9:15 AM");
  await page.getByRole("link", { name: /Lunch/ }).click();

  await expect.poll(() => page.getByRole("article").locator(".letter-dated").textContent(), wait).toBe("Dated 4 Oct 2025, 2:05 PM");
});

/**
 * The web app where Grace's mailbox has two threads that went to Spam ten days ago, and one that
 * went there today, signed in as Ada on Settings. The API's clock moves the ten days ahead.
 */
async function withOldSpam() {
  const app = await withOrganization();
  const ada = app.duva.signIn("ada@example.org");
  const { data: grace } = await app.duva.signIn("grace@example.org").GET("/whoami");
  await ada.POST("/mailboxes", { body: { owner: grace!.id, address: "grace@example.com" } });
  for (const subject of ["Vinst", "Lotteri"]) await app.duva.receive(note(subject), { to: ["grace@example.com"] }, { verdicts: { spam: "FAIL" } });
  vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 10 * 24 * 60 * 60 * 1000 });
  onTestFinished(() => void vi.useRealTimers());
  await app.duva.receive(note("Erbjudande"), { to: ["grace@example.com"] }, { verdicts: { spam: "FAIL" } });
  await app.signIn("ada@example.org");
  await openSettings(app.page, "Mail and agents");
  const field = mailSheet(app.page).getByRole("textbox", { name: "How long Trash and Spam keep mail" });
  await expect.poll(() => field.inputValue(), wait).toBe("30");
  return { ...app, field };
}

test("an admin shortens how long Trash and Spam keep mail, warned first how many threads saving erases", budget, async () => {
  const { page, duva, field } = await withOldSpam();
  const note = () => mailSheet(page).locator(".setting-note").textContent();

  await field.fill("14");
  await expect.poll(note, wait).toBe("No thread in Trash or Spam is older than 14 days now, so saving erases none at once.");
  await field.fill("7");

  await expect.poll(note, wait).toBe("Saving erases 2 threads in Trash and Spam that are older than 7 days, at the eraser's next daily run. This can't be undone.");
  await mailSheet(page).getByRole("button", { name: "Save" }).click();

  await expect.poll(() => mailSheet(page).getByRole("status").last().textContent(), wait).toBe("Saved. The eraser's next daily run follows it.");
  expect((await duva.signIn("ada@example.org").GET("/organization/settings")).data).toMatchObject({ erasureErasesApprovals: false, retentionDays: 7 });
  expect(await mailSheet(page).locator(".setting-note").count()).toBe(0);
});

test("a longer period warns of nothing, and one outside 7 to 365 days can't be saved", budget, async () => {
  const { page, field } = await withOldSpam();
  const save = mailSheet(page).getByRole("button", { name: "Save" });

  await field.fill("90");
  expect(await mailSheet(page).locator(".setting-note").count()).toBe(0);
  expect(await save.isEnabled()).toBe(true);
  await field.fill("400");

  await expect.poll(() => mailSheet(page).locator(".field-error").textContent(), wait).toBe("Give a whole number of days from 7 to 365.");
  expect(await save.isDisabled()).toBe(true);
  expect(await field.getAttribute("aria-invalid")).toBe("true");
});
