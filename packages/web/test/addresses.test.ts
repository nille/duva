import { expect, test } from "vitest";
import type { Page } from "playwright-core";
import { phone, startWebApp } from "./web-app.ts";

// The page under the full suite's load can take seconds to show what changed, so every wait has room, and every test more.
const wait = { timeout: 10_000 };
const budget = { timeout: 60_000 };

/**
 * The web app for a deployment on example.com and example.net, where Ada is the admin, Grace a
 * human with a mailbox at grace@example.com, and Hermes Ada's agent, with a mailbox at
 * hermes@example.com. Signed in as Ada on Settings, with Grace's line open.
 */
async function withMailboxes(options: { viewport?: { width: number; height: number } } = {}) {
  const app = await startWebApp({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org"], ...options });
  const ada = app.duva.signIn("ada@example.org");
  await ada.POST("/domains", { body: { domain: "example.net" } });
  const { data: grace } = await app.duva.signIn("grace@example.org").GET("/whoami");
  const { data: graces } = await ada.POST("/mailboxes", { body: { owner: grace!.id, address: "grace@example.com" } });
  const { data: hermes } = await ada.POST("/agents", { body: { name: "Hermes" } });
  await ada.POST("/mailboxes", { body: { owner: hermes!.agent.id, address: "hermes@example.com" } });
  const { page } = app;
  await app.signIn("ada@example.org");
  await page.getByRole("navigation").getByRole("link", { name: "Settings" }).click();
  await expect.poll(() => line(page, "grace@example.org").count(), wait).toBe(1);
  await line(page, "grace@example.org").getByRole("heading").click();
  return { ...app, ada, graces: graces! };
}

const sheet = (page: Page) => page.getByRole("region", { name: "Addresses" });
const line = (page: Page, owner: string) => sheet(page).locator("details").filter({ has: page.getByRole("heading", { name: owner, exact: true }) });
const summary = (page: Page, owner: string) => line(page, owner).locator(".line-summary-text").textContent();
const addresses = (page: Page, owner: string) => line(page, owner).getByRole("list", { name: `Addresses of ${owner}` }).getByRole("listitem").allInnerTexts();
const said = (page: Page, owner: string) => line(page, owner).getByRole("status").textContent();

test("an admin sees each mailbox with its owner and default address, humans first, then agents", budget, async () => {
  const { page } = await withMailboxes();

  const owners = await sheet(page).getByRole("heading", { level: 3 }).allTextContents();

  expect(owners).toEqual(["grace@example.org", "Hermes"]);
  expect(await summary(page, "grace@example.org")).toBe("grace@example.com");
  expect(await summary(page, "Hermes")).toBe("Agent. hermes@example.com");
});

test("an admin gives a mailbox another address on another domain, and makes it the default", budget, async () => {
  const { page, ada, graces } = await withMailboxes();

  await line(page, "grace@example.org").getByRole("textbox", { name: "New address" }).fill("Grace@Example.NET");
  await line(page, "grace@example.org").getByRole("button", { name: "Add address" }).click();

  await expect.poll(() => said(page, "grace@example.org"), wait).toBe("Added grace@example.net.");
  await expect.poll(() => addresses(page, "grace@example.org"), wait).toEqual([expect.stringMatching(/^grace@example\.com\s+Default/), expect.stringMatching(/^grace@example\.net\s+Make default/)]);
  expect(await summary(page, "grace@example.org")).toBe("grace@example.com and 1 more");

  await line(page, "grace@example.org").getByRole("button", { name: "Make grace@example.net the default" }).click();

  await expect.poll(() => summary(page, "grace@example.org"), wait).toBe("grace@example.net and 1 more");
  expect(await said(page, "grace@example.org")).toBe("New mail goes from grace@example.net from now on.");
  expect(await line(page, "grace@example.org").getByRole("button", { name: "Make grace@example.com the default" }).isVisible()).toBe(true);
  const { data } = await ada.GET("/organization/mailboxes");
  expect(data?.mailboxes.find(({ id }) => id === graces.id)).toMatchObject({ defaultAddress: "grace@example.net", addresses: ["grace@example.com", "grace@example.net"] });
});

test("an address Duva refuses says why under the field", budget, async () => {
  const { page } = await withMailboxes();

  await line(page, "grace@example.org").getByRole("textbox", { name: "New address" }).fill("hermes@example.com");
  await line(page, "grace@example.org").getByRole("button", { name: "Add address" }).click();

  await expect.poll(() => line(page, "grace@example.org").getByRole("alert").textContent(), wait).toBe("hermes@example.com is taken. Give another address.");
  expect(await line(page, "grace@example.org").getByRole("textbox", { name: "New address" }).getAttribute("aria-invalid")).toBe("true");
});

test("an admin removes an address after confirming it, and the mailbox's next address becomes its default", budget, async () => {
  const { page, ada, graces } = await withMailboxes();
  await ada.POST("/addresses", { body: { address: "support@example.com", mailbox: graces.id } });
  await page.reload();
  await line(page, "grace@example.org").getByRole("heading").click();

  await line(page, "grace@example.org").getByRole("button", { name: "Remove grace@example.com" }).click();
  const confirm = line(page, "grace@example.org").getByRole("group", { name: "Remove grace@example.com" });
  expect(await confirm.innerText()).toContain("Mail to grace@example.com is refused from now on, or goes to its domain's catch-all. The mail already here stays. support@example.com becomes the default address.");
  await confirm.getByRole("button", { name: "Remove", exact: true }).click();

  await expect.poll(() => said(page, "grace@example.org"), wait).toBe("Removed grace@example.com.");
  await expect.poll(() => summary(page, "grace@example.org"), wait).toBe("support@example.com");
  expect((await ada.GET("/addresses")).data?.addresses.map(({ address }) => address)).not.toContain("grace@example.com");
});

test("a mailbox whose last address is removed says it has none", budget, async () => {
  const { page } = await withMailboxes();

  await line(page, "grace@example.org").getByRole("button", { name: "Remove grace@example.com" }).click();
  const confirm = line(page, "grace@example.org").getByRole("group", { name: "Remove grace@example.com" });
  expect(await confirm.innerText()).toContain("The mailbox is left without an address, and gets and sends no mail until it has one.");
  await confirm.getByRole("button", { name: "Remove", exact: true }).click();

  await expect.poll(() => summary(page, "grace@example.org"), wait).toBe("No address. It gets and sends no mail until it has one.");
  expect(await line(page, "grace@example.org").getByRole("list").count()).toBe(0);
});

test("on a phone, a mailbox's addresses fit the screen", budget, async () => {
  const { page } = await withMailboxes({ viewport: phone });

  await expect.poll(() => addresses(page, "grace@example.org"), wait).toHaveLength(1);

  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(phone.width);
});
