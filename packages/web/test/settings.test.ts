import { expect, onTestFinished, test, vi } from "vitest";
import type { Page } from "playwright-core";
import { startWebApp } from "./web-app.ts";

// The page under the full suite's load can take seconds to show what changed, so every wait has room, and every test more.
const wait = { timeout: 10_000 };
const budget = { timeout: 60_000 };

const organization = (page: Page) => page.getByRole("region", { name: "Organization" });

const withOrganization = () => startWebApp({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org"] });

test("an admin opens Settings from the bar and chooses that erasing a thread erases its approval records too", budget, async () => {
  const { page, signIn, duva } = await withOrganization();
  await signIn("ada@example.org");

  await page.getByRole("navigation").getByRole("link", { name: "Settings" }).click();

  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Settings");
  const keep = organization(page).getByRole("radio", { name: /^Keep them/ });
  const erase = organization(page).getByRole("radio", { name: /^Erase them with the thread/ });
  await expect.poll(() => keep.isChecked(), wait).toBe(true);
  expect(await page.getByRole("group", { name: "When a thread with an agent's sends is erased" }).innerText()).toContain("who approved it");

  await erase.check();
  await organization(page).getByRole("button", { name: "Save" }).click();

  await expect.poll(() => organization(page).getByRole("status").textContent(), wait).toBe("Saved. This applies to threads erased from now on.");
  const ada = duva.signIn("ada@example.org");
  expect((await ada.GET("/organization/settings")).data).toEqual({ erasureErasesApprovals: true, retentionDays: 30, searchLanguages: ["English", "Swedish"] });

  await page.reload();

  await expect.poll(() => page.getByRole("radio", { name: /^Erase them with the thread/ }).isChecked(), wait).toBe(true);
});

test("an admin reads what translating searches does, and adds Danish to the search languages", budget, async () => {
  const { page, signIn, duva } = await withOrganization();
  await signIn("ada@example.org");

  await page.getByRole("navigation").getByRole("link", { name: "Settings" }).click();

  const languages = page.getByRole("group", { name: "Languages your mail is in" });
  const checkbox = (name: string) => languages.getByRole("checkbox", { name: new RegExp(`^${name}`) });
  await expect.poll(() => checkbox("English").isChecked(), wait).toBe(true);
  expect(await checkbox("Swedish").isChecked()).toBe(true);
  expect(await checkbox("Danish").isChecked()).toBe(false);
  const lead = await languages.innerText();
  expect(lead).toContain("Amazon's Nova Lite model, in the same AWS region as your mail");
  expect(lead).toContain("adds a little time to each search");

  await checkbox("Danish").check();
  await organization(page).getByRole("button", { name: "Save" }).click();

  await expect
    .poll(() => organization(page).getByRole("status").textContent(), wait)
    .toBe("Saved. Searches use these languages from now on. Each mailbox's search index is being rebuilt, and finds less until it is done.");
  const ada = duva.signIn("ada@example.org");
  expect((await ada.GET("/organization/settings")).data).toEqual({ erasureErasesApprovals: false, retentionDays: 30, searchLanguages: ["English", "Swedish", "Danish"] });
  expect(await organization(page).getByRole("button", { name: "Save" }).isDisabled()).toBe(true);
});

test("a human who isn't an admin opens Settings from the bar and reads the organization's settings without changing them", budget, async () => {
  const { page, signIn } = await withOrganization();
  await signIn("grace@example.org");

  await page.getByRole("navigation").getByRole("link", { name: "Settings" }).click();

  const keep = organization(page).getByRole("radio", { name: /^Keep them/ });
  await expect.poll(() => keep.isChecked(), wait).toBe(true);
  expect(await keep.isDisabled()).toBe(true);
  expect(await organization(page).getByRole("button", { name: "Save" }).count()).toBe(0);
  expect(await organization(page).innerText()).toContain("Only admins change these.");
});

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

const you = (page: Page) => page.getByRole("region", { name: "You" });
const row = (page: Page, subject: string) => page.getByRole("list", { name: "Threads" }).getByRole("listitem").filter({ hasText: subject }).locator("time");
const saved = "Saved. This applies from now on.";

test("a human's times and dates follow their browser's language until they choose otherwise", budget, async () => {
  const { page, signIn } = await withGracesInbox();
  await signIn("grace@example.org");

  await expect.poll(() => row(page, "Lunch").textContent(), wait).toBe("09:15 AM");
  expect(await row(page, "Kvitto").textContent()).toBe("Oct 4");
  await page.getByRole("link", { name: /Lunch/ }).click();
  await expect.poll(() => page.getByRole("article").locator("time").textContent(), wait).toBe("Oct 4, 2025, 02:05 PM");
});

test("a human chooses 24-hour time and ISO dates, and the Inbox and a thread show them, also after a reload", budget, async () => {
  const { page, signIn, grace } = await withGracesInbox();
  await signIn("grace@example.org");

  await page.getByRole("navigation").getByRole("link", { name: "Settings" }).click();
  await expect.poll(() => you(page).getByRole("radio", { name: /^Default/ }).first().isChecked(), wait).toBe(true);
  await you(page).getByRole("radio", { name: /^24-hour/ }).check();
  await you(page).getByRole("radio", { name: /^Year first/ }).check();
  await you(page).getByRole("button", { name: "Save" }).click();

  await expect.poll(() => you(page).getByRole("status").textContent(), wait).toBe(saved);
  expect((await grace.GET("/preferences")).data).toEqual({ hourCycle: "h23", dateFormat: "iso", mailView: "html" });

  await page.getByRole("navigation").getByRole("link", { name: "Mail" }).click();
  await expect.poll(() => row(page, "Lunch").textContent(), wait).toBe("09:15");
  expect(await row(page, "Lunch").getAttribute("title")).toBe("2026-10-05 09:15");
  expect(await row(page, "Kvitto").textContent()).toBe("10-04");

  await page.reload();

  await expect.poll(() => row(page, "Kvitto").textContent(), wait).toBe("10-04");
  await page.getByRole("link", { name: /Lunch/ }).click();
  await expect.poll(() => page.getByRole("article").locator("time").textContent(), wait).toBe("2025-10-04 14:05");
});

test("each choice of how times and dates show has an example from today", budget, async () => {
  const { page, signIn } = await withGracesInbox();
  await signIn("grace@example.org");

  await page.getByRole("navigation").getByRole("link", { name: "Settings" }).click();

  await expect.poll(() => you(page).getByRole("radio").count(), wait).toBe(9);
  const examples = await you(page).locator(".choices-short .choice").evaluateAll((choices) => choices.map((choice) => choice.querySelector(".hint")?.textContent));
  expect(examples).toEqual(["02:30 PM", "2:30 PM", "14:30", "Oct 5, 2026", "2026-10-05", "5 Oct 2026", "Oct 5, 2026"]);
});

test("a human chooses dates with the day first, and their 12-hour time stays", budget, async () => {
  const { page, signIn, grace } = await withGracesInbox();
  await grace.PATCH("/preferences", { body: { hourCycle: "h12" } });
  await signIn("grace@example.org");

  await page.getByRole("navigation").getByRole("link", { name: "Settings" }).click();
  await expect.poll(() => you(page).getByRole("radio", { name: /^12-hour/ }).isChecked(), wait).toBe(true);
  await you(page).getByRole("radio", { name: /^Day first/ }).check();
  await you(page).getByRole("button", { name: "Save" }).click();
  await expect.poll(() => you(page).getByRole("status").textContent(), wait).toBe(saved);

  await page.getByRole("navigation").getByRole("link", { name: "Mail" }).click();
  await expect.poll(() => row(page, "Kvitto").textContent(), wait).toBe("4 Oct");
  expect(await row(page, "Lunch").textContent()).toBe("9:15 AM");
  await page.getByRole("link", { name: /Lunch/ }).click();

  await expect.poll(() => page.getByRole("article").locator("time").textContent(), wait).toBe("4 Oct 2025, 2:05 PM");
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
  await app.page.getByRole("navigation").getByRole("link", { name: "Settings" }).click();
  const field = organization(app.page).getByRole("textbox", { name: "How long Trash and Spam keep mail" });
  await expect.poll(() => field.inputValue(), wait).toBe("30");
  return { ...app, field };
}

test("an admin shortens how long Trash and Spam keep mail, warned first how many threads saving erases", budget, async () => {
  const { page, duva, field } = await withOldSpam();
  const note = () => organization(page).locator(".setting-note").textContent();

  await field.fill("14");
  await expect.poll(note, wait).toBe("No thread in Trash or Spam is older than 14 days now, so saving erases none at once.");
  await field.fill("7");

  await expect.poll(note, wait).toBe("Saving erases 2 threads in Trash and Spam that are older than 7 days, at the eraser's next daily run. This can't be undone.");
  await organization(page).getByRole("button", { name: "Save" }).click();

  await expect.poll(() => organization(page).getByRole("status").last().textContent(), wait).toBe("Saved. The eraser's next daily run follows it.");
  expect((await duva.signIn("ada@example.org").GET("/organization/settings")).data).toMatchObject({ erasureErasesApprovals: false, retentionDays: 7 });
  expect(await organization(page).locator(".setting-note").count()).toBe(0);
});

test("a longer period warns of nothing, and one outside 7 to 365 days can't be saved", budget, async () => {
  const { page, field } = await withOldSpam();
  const save = organization(page).getByRole("button", { name: "Save" });

  await field.fill("90");
  expect(await organization(page).locator(".setting-note").count()).toBe(0);
  expect(await save.isEnabled()).toBe(true);
  await field.fill("400");

  await expect.poll(() => organization(page).locator(".field-error").textContent(), wait).toBe("Give a whole number of days from 7 to 365.");
  expect(await save.isDisabled()).toBe(true);
  expect(await field.getAttribute("aria-invalid")).toBe("true");
});

test("a human who isn't an admin reads how long Trash and Spam keep mail without changing it", budget, async () => {
  const { page, signIn } = await withOrganization();
  await signIn("grace@example.org");

  await page.getByRole("navigation").getByRole("link", { name: "Settings" }).click();

  const field = organization(page).getByRole("textbox", { name: "How long Trash and Spam keep mail" });
  await expect.poll(() => field.inputValue(), wait).toBe("30");
  expect(await field.isDisabled()).toBe(true);
});
