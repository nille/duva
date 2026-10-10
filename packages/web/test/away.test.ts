import { expect, test } from "vitest";
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

/** The day so many days from today in the browser, as a date field takes it. */
const daysOn = (days: number) => {
  const at = new Date(Date.now() + days * 86_400_000);
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
};

/** The web app for Grace, with her mailbox at grace@example.com, its Screener off. */
async function withGrace() {
  const app = await startWebApp({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org"] });
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

  await sheet.getByRole("radio", { name: /^On these days/ }).check();
  await sheet.getByRole("textbox", { name: "First day" }).fill(daysOn(0));
  await sheet.getByRole("textbox", { name: "Last day" }).fill(daysOn(3));
  await sheet.getByRole("button", { name: "Save" }).click();

  const lastDay = new Date(`${daysOn(3)}T12:00:00`).getDate();
  await expect.poll(() => strip.getByRole("link", { name: /^Away until / }).textContent(), wait).toMatch(new RegExp(`^Away until \\D*${lastDay}\\b`));
  expect((await grace.GET("/away-message")).data).toMatchObject({ on: true, away: true, firstDay: daysOn(0), lastDay: daysOn(3) });

  await sheet.getByRole("radio", { name: "Off", exact: true }).check();
  await sheet.getByRole("button", { name: "Save" }).click();

  await expect.poll(() => strip.getByRole("link", { name: /^Away/ }).count(), wait).toBe(0);
});

test("a thread notes the away message Grace's sender got, as it arrives", budget, async () => {
  const { page, duva, grace, mailbox } = await withGrace();
  await grace.PATCH("/away-message", { body: { mailbox, text: "Away." } });
  await grace.PATCH("/away-message", { body: { on: true } });

  await duva.receive(note("Lunch"), { to: ["grace@example.com"] });
  await page.getByRole("list", { name: "Threads" }).getByRole("link", { name: /Lunch/ }).click({ timeout: wait.timeout });

  await expect.poll(() => page.getByText(/^Away message sent \d/).isVisible(), wait).toBe(true);
});
