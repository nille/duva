import { expect, test } from "vitest";
import { startWebApp } from "./web-app.ts";

// The page under the full suite's load can take seconds to show what changed, so every wait has room, and every test more.
const wait = { timeout: 10_000 };
const budget = { timeout: 60_000 };

const withOrganization = () => startWebApp({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org"] });

test("an admin opens Settings from the bar and chooses that erasing a thread erases its approval records too", budget, async () => {
  const { page, signIn, duva } = await withOrganization();
  await signIn("ada@example.org");

  await page.getByRole("navigation").getByRole("link", { name: "Settings" }).click();

  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Settings");
  const keep = page.getByRole("radio", { name: /^Keep them/ });
  const erase = page.getByRole("radio", { name: /^Erase them with the thread/ });
  await expect.poll(() => keep.isChecked(), wait).toBe(true);
  expect(await page.getByRole("group", { name: "When a thread with an agent's sends is erased" }).innerText()).toContain("who approved it");

  await erase.check();
  await page.getByRole("button", { name: "Save" }).click();

  await expect.poll(() => page.getByRole("status").textContent(), wait).toBe("Saved. This applies to threads erased from now on.");
  const ada = duva.signIn("ada@example.org");
  expect((await ada.GET("/organization/settings")).data).toEqual({ erasureErasesApprovals: true });

  await page.reload();

  await expect.poll(() => page.getByRole("radio", { name: /^Erase them with the thread/ }).isChecked(), wait).toBe(true);
});

test("a human who isn't an admin finds no Settings in the bar", budget, async () => {
  const { page, signIn } = await withOrganization();
  await signIn("grace@example.org");

  await expect.poll(() => page.getByRole("navigation").getByRole("link", { name: "Mail" }).count(), wait).toBe(1);
  expect(await page.getByRole("navigation").getByRole("link", { name: "Settings" }).count()).toBe(0);
});

test("a human who isn't an admin who opens Settings reads the organization's settings without changing them", budget, async () => {
  const { page, signIn } = await withOrganization();
  await signIn("grace@example.org");
  await expect.poll(() => page.getByRole("navigation").getByRole("link", { name: "Mail" }).count(), wait).toBe(1);

  await page.evaluate(() => (location.hash = "#/settings"));

  const keep = page.getByRole("radio", { name: /^Keep them/ });
  await expect.poll(() => keep.isChecked(), wait).toBe(true);
  expect(await keep.isDisabled()).toBe(true);
  expect(await page.getByRole("button", { name: "Save" }).count()).toBe(0);
  expect(await page.getByRole("main").innerText()).toContain("Only admins change these.");
});
