import { expect, test } from "vitest";
import { fromClockValue } from "@duva/openapi";
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
    "",
    "Hej Grace.",
  ].join("\r\n");

/** The web app for Grace, with her mailbox at grace@example.com, its Screener off, and her browser in the time zone, at the time on its clock if given. */
async function withGrace({ timeZone, at }: { timeZone?: string; at?: string } = {}) {
  const app = await startWebApp({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org"], ...(timeZone !== undefined && { timeZone }) });
  if (at !== undefined) {
    const now = fromClockValue(at, timeZone ?? "UTC")!;
    await app.duva.clock(now);
    await app.page.clock.setFixedTime(now);
  }
  const ada = app.duva.signIn("ada@example.org");
  const grace = app.duva.signIn("grace@example.org");
  const { data: me } = await grace.GET("/whoami");
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: me!.id, address: "grace@example.com" } });
  await grace.PATCH("/mailboxes/{mailbox}/screener", { params: { path: { mailbox: mailbox!.id } }, body: { on: false } });
  await app.signIn("grace@example.org");
  const sheet = app.page.getByRole("region", { name: "Away", exact: true });
  const strip = app.page.getByRole("contentinfo", { name: "Status" });
  return { ...app, grace, mailbox: mailbox!.id, sheet, strip };
}

test("Grace writes her away message on Preferences and switches it on, and the status strip says she's away, a link back to it", budget, async () => {
  const { page, sheet, strip, grace } = await withGrace();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect.poll(() => sheet.isVisible(), wait).toBe(true);

  // Switching on without a text can't be saved, and says why.
  await sheet.getByRole("radio", { name: "On", exact: true }).check();
  expect(await sheet.getByText("Write a text for at least one mailbox to switch it on.").isVisible()).toBe(true);
  expect(await sheet.getByRole("button", { name: "Save" }).isDisabled()).toBe(true);

  await sheet.getByRole("textbox", { name: "To grace@example.com" }).fill("I'm away until next week, without mail.");
  await sheet.getByRole("button", { name: "Save" }).click();

  await expect.poll(() => sheet.getByRole("status").textContent(), wait).toBe("Saved.");
  expect(await strip.getByRole("link", { name: "Away", exact: true }).getAttribute("href")).toBe("#/settings/you");
  expect((await grace.GET("/away-message")).data).toMatchObject({ on: true, away: true, mailboxes: [{ text: "I'm away until next week, without mail." }] });

  await sheet.getByRole("radio", { name: "Off", exact: true }).check();
  await sheet.getByRole("button", { name: "Save" }).click();

  await expect.poll(() => strip.getByRole("link", { name: /^Away/ }).count(), wait).toBe(0);
});

// Wednesday 18 November 2026 in a time zone ahead of UTC and one behind, at either end of the day and at noon.
test.each([
  ["Europe/Stockholm", "00:05"],
  ["Europe/Stockholm", "12:00"],
  ["Europe/Stockholm", "23:55"],
  ["America/New_York", "00:05"],
  ["America/New_York", "12:00"],
  ["America/New_York", "23:55"],
])("Grace away from today to a last day, with her browser in %s at %s, sees the strip say she's away until her last day", budget, async (timeZone, time) => {
  const { page, sheet, strip, grace, mailbox } = await withGrace({ timeZone, at: `2026-11-18T${time}` });
  await grace.PATCH("/away-message", { body: { mailbox, text: "Away." } });
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect.poll(() => sheet.isVisible(), wait).toBe(true);

  await sheet.getByRole("radio", { name: "On", exact: true }).check();
  await sheet.getByRole("radio", { name: /^On these days/ }).check();
  await sheet.getByRole("textbox", { name: "First day" }).fill("2026-11-18");
  await sheet.getByRole("textbox", { name: "Last day" }).fill("2026-11-21");
  await sheet.getByRole("button", { name: "Save" }).click();

  await expect.poll(() => strip.getByRole("link", { name: /^Away/ }).textContent(), wait).toBe("Away until Nov 21");
  expect((await grace.GET("/away-message")).data).toMatchObject({ on: true, away: true, firstDay: "2026-11-18", lastDay: "2026-11-21" });
});

test("a thread notes the away message Grace's sender got, as it arrives", budget, async () => {
  const { page, duva, grace, mailbox } = await withGrace();
  await grace.PATCH("/away-message", { body: { mailbox, text: "Away." } });
  await grace.PATCH("/away-message", { body: { on: true } });

  await duva.receive(note("Lunch"), { to: ["grace@example.com"] });
  await page.getByRole("list", { name: "Threads" }).getByRole("link", { name: /Lunch/ }).click({ timeout: wait.timeout });

  await expect.poll(() => page.getByText(/^Away message sent \d/).isVisible(), wait).toBe(true);
});
