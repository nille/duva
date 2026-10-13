import PostalMime from "postal-mime";
import type { Page } from "playwright-core";
import { expect, test } from "vitest";
import { startWebApp } from "./web-app.ts";

// The page under the full suite's load can take seconds to show what changed, so every wait has room, and every test more.
const wait = { timeout: 10_000 };
const budget = { timeout: 60_000 };

/** The token at the end of the link in a message SES sent, after the route given. */
const tokenIn = async (raw: string, route: "sign-in" | "recovery") => (await PostalMime.parse(raw)).text?.match(new RegExp(`#/${route}/([\\w-]+)`))?.[1];

const sheet = (page: Page) => page.getByRole("region", { name: "Signing in" });
/** Opens Settings, where You shows beside the index on a desk. */
const settings = (page: Page) => page.getByRole("link", { name: "Settings", exact: true }).click();
const passkeys = (page: Page) => sheet(page).getByRole("list", { name: "Passkeys" }).getByRole("listitem");

test("a human adds passkeys in Settings, sees each with the date it was added, and removes one", budget, async () => {
  const app = await startWebApp({ admin: "ada@example.com" });
  const { page } = app;
  await app.passkeyDevice();
  await app.signIn("ada@example.com");
  await settings(page);

  await sheet(page).getByRole("button", { name: "Add a passkey" }).click();
  await page.getByRole("button", { name: "Add passkey" }).click();
  await expect.poll(() => sheet(page).getByRole("status").first().textContent(), wait).toBe("Passkey added. It signs you in from now on.");
  await sheet(page).getByRole("button", { name: "Add a passkey" }).click();
  await page.getByRole("button", { name: "Add passkey" }).click();
  await expect.poll(() => passkeys(page).count(), wait).toBe(2);
  const today = new Date().toLocaleDateString("en-US", { day: "numeric", month: "short" });
  expect(await passkeys(page).allInnerTexts()).toEqual([expect.stringMatching(new RegExp(`^Device-bound Passkey\\s+Added ${today}\\s+Remove$`)), expect.stringMatching(/^Device-bound Passkey/)]);
  await sheet(page).getByRole("button", { name: `Remove Device-bound Passkey, added ${today}` }).first().click();

  await expect.poll(() => passkeys(page).count(), wait).toBe(1);
  expect(await sheet(page).getByRole("status").first().textContent()).toBe("Removed Device-bound Passkey. It no longer signs you in.");
});

test("a human with a passkey signs in with it", budget, async () => {
  const app = await startWebApp({ admin: "ada@example.com" });
  const { page } = app;
  await app.passkeyDevice();
  await app.signIn("ada@example.com");
  await settings(page);
  await sheet(page).getByRole("button", { name: "Add a passkey" }).click();
  await page.getByRole("button", { name: "Add passkey" }).click();
  await expect.poll(() => passkeys(page).count(), wait).toBe(1);
  // Signed out of the web app and of managed login, as on another day.
  await page.evaluate(() => localStorage.clear());
  await page.context().clearCookies();
  await page.goto(app.url);

  await page.getByRole("button", { name: "Sign in" }).click();
  await page.locator("input[name=email]").fill("ada@example.com");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect.poll(() => page.getByRole("contentinfo", { name: "Status" }).innerText(), wait).toContain("ada@example.com");
});

test("following a sign-in link signs the human in, and asks them to add a passkey, which they do after signing in to managed login", budget, async () => {
  const app = await startWebApp({ domain: "example.com", admin: "ada@example.org" });
  const { page, duva } = app;
  await duva.signIn("ada@example.org").POST("/humans", { body: { email: "grace@example.com", recoveryAddress: "grace@elsewhere.org" } });
  await app.passkeyDevice();

  // As from the mail, in a tab of its own.
  await page.goto(`${app.url}#/sign-in/${await tokenIn(duva.sent().at(-1)!, "sign-in")}`);

  await expect.poll(() => sheet(page).locator(".notice").textContent(), wait).toBe("You signed in with a link. Add a passkey, so you sign in without one next time. Adding one first asks for a code, which Duva emails to grace@example.com.");
  expect(await page.getByRole("contentinfo", { name: "Status" }).innerText()).toContain("grace@example.com");
  expect(await page.getByRole("link", { name: "Add a recovery address" }).count()).toBe(0);
  // Managed login has no session of hers, so she signs in there before she adds one.
  await sheet(page).getByRole("button", { name: "Add a passkey" }).click();
  await page.locator("input[name=email]").fill("grace@example.com");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Add passkey" }).click();
  await expect.poll(() => sheet(page).getByRole("status").first().textContent(), wait).toBe("Passkey added. It signs you in from now on.");
  await expect.poll(() => passkeys(page).count(), wait).toBe(1);
});

test("a sign-in link that expired or was used says so, and offers to mail a new one", budget, async () => {
  const app = await startWebApp({ admin: "ada@example.com" });
  const { page } = app;

  await page.goto(`${app.url}#/sign-in/not-a-token`);

  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toBe("That sign-in link doesn't work");
  expect(await page.getByRole("form", { name: "Email me a sign-in link" }).isVisible()).toBe(true);
});

test("a human who lost their passkey asks for a sign-in link on the sign-in page, which goes to their recovery address, and the page says the same for any address", budget, async () => {
  const app = await startWebApp({ domain: "example.com", admin: "ada@example.org" });
  const { page, duva } = app;
  await duva.signIn("ada@example.org").POST("/humans", { body: { email: "grace@example.com", recoveryAddress: "grace@elsewhere.org" } });
  const before = duva.sent().length;
  await page.goto(app.url);
  const form = page.getByRole("form", { name: "Email me a sign-in link" });

  await page.getByRole("button", { name: "I've lost my passkey" }).click();
  await form.getByRole("textbox", { name: "The address you sign in with" }).fill("grace@example.com");
  await form.getByRole("button", { name: "Email me a link" }).click();
  await expect.poll(() => form.getByRole("status").textContent(), wait).toMatch(/^If the address signs in to Duva, Duva mailed a sign-in link to its recovery address\./);
  const known = await form.getByRole("status").textContent();
  await form.getByRole("textbox", { name: "The address you sign in with" }).fill("nobody@example.com");
  await form.getByRole("button", { name: "Email me a link" }).click();

  await expect.poll(() => duva.sentTo().slice(before), wait).toEqual([["grace@elsewhere.org"]]);
  expect(await form.getByRole("status").textContent()).toBe(known);
});

test("a human without a recovery address is asked to add one, quietly, until they follow the link mailed to it", budget, async () => {
  const app = await startWebApp({ domain: "example.com", admin: "ada@example.org" });
  const { page, duva } = app;
  await app.signIn("ada@example.org");
  const ask = page.getByRole("link", { name: "Add a recovery address" });
  await expect.poll(() => ask.count(), wait).toBe(1);

  await ask.click();
  await expect.poll(() => sheet(page).locator(".notice").textContent(), wait).toBe("Add a recovery address, so a sign-in link reaches you if you lose your passkeys.");
  await sheet(page).getByRole("textbox", { name: "New recovery address" }).fill("ada@elsewhere.org");
  await sheet(page).getByRole("button", { name: "Send link" }).click();
  await expect.poll(() => sheet(page).getByRole("status").last().textContent(), wait).toBe(
    "Duva mailed a link to ada@elsewhere.org. Your recovery address changes once you follow it, within 30 minutes.",
  );
  await page.goto(`${app.url}#/recovery/${await tokenIn(duva.sent().at(-1)!, "recovery")}`);
  await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), wait).toBe("Recovery address confirmed");
  await page.getByRole("link", { name: "Open Duva" }).click();

  await expect.poll(() => page.getByRole("contentinfo", { name: "Status" }).innerText(), wait).toContain("ada@example.org");
  expect(await ask.count()).toBe(0);
});
