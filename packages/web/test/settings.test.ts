import { expect, test } from "vitest";
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
  expect((await ada.GET("/organization/settings")).data).toEqual({ erasureErasesApprovals: true });

  await page.reload();

  await expect.poll(() => page.getByRole("radio", { name: /^Erase them with the thread/ }).isChecked(), wait).toBe(true);
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
