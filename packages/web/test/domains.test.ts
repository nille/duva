import { expect, test } from "vitest";
import type { Page } from "playwright-core";
import type { components } from "@duva/openapi";
import { phone, startWebApp, type WebApp } from "./web-app.ts";

type Domain = components["schemas"]["Domain"];

// The page under the full suite's load can take seconds to show what changed, so every wait has room, and every test more.
const wait = { timeout: 10_000 };
const budget = { timeout: 60_000 };

/**
 * The web app for a deployment on example.com, where Ada is the admin and Grace a human with a
 * mailbox at grace@example.com, signed in as Ada on Settings.
 */
async function withDomains(options: { viewport?: { width: number; height: number } } = {}) {
  const app = await startWebApp({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org"], ...options });
  const ada = app.duva.signIn("ada@example.org");
  const { data: grace } = await app.duva.signIn("grace@example.org").GET("/whoami");
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: grace!.id, address: "grace@example.com" } });
  return { ...app, ada, graceMailbox: mailbox!, settings: () => openSettings(app) };
}

async function openSettings({ page, signIn }: WebApp) {
  await signIn("ada@example.org");
  await page.getByRole("navigation").getByRole("link", { name: "Settings" }).click();
  await expect.poll(() => domains(page).getByRole("heading", { level: 3 }).count(), wait).toBeGreaterThan(0);
}

const domains = (page: Page) => page.getByRole("region", { name: "Domains" });
/** A domain's line, opened by clicking it. */
const line = (page: Page, domain: string) => domains(page).locator("details").filter({ has: page.getByRole("heading", { name: domain, exact: true }) });
/** What the sheet said was just done. */
const said = (page: Page) => domains(page).locator(".setting-done").textContent();
const opened = (page: Page, domain: string) => domains(page).getByRole("group", { name: domain, exact: true });
const statuses = (page: Page, domain: string) => opened(page, domain).locator(".dns-record").evaluateAll((records) => records.map((record) => `${record.getAttribute("aria-label")}: ${record.querySelector(".dns-status")?.textContent}`));

test("an admin adds a domain and sees the DNS records to add, each missing, with buttons that copy them", budget, async () => {
  const { page, settings } = await withDomains();
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await settings();

  await domains(page).getByRole("textbox", { name: "Domain" }).fill("Example.NET");
  await domains(page).getByRole("button", { name: "Add domain" }).click();

  await expect.poll(() => said(page), wait).toBe("Added example.net. Add its DNS records, below.");
  expect(await line(page, "example.net").locator(".line-summary-text").textContent()).toBe("Standalone domain. Waiting for DNS.");
  await expect.poll(() => statuses(page, "example.net"), wait).toEqual([
    "Receiving, MX record: Missing",
    "DKIM, CNAME record: Missing",
    "DKIM, CNAME record: Missing",
    "DKIM, CNAME record: Missing",
    "MAIL FROM, MX record: Missing",
    "MAIL FROM, TXT record: Missing",
    "DMARC, TXT record: Missing",
  ]);
  expect(await opened(page, "example.net").innerText()).toContain("Add these at the domain's DNS provider.");

  await opened(page, "example.net").getByRole("button", { name: "Copy 10 inbound-smtp.eu-north-1.amazonaws.com" }).click();

  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText()), wait).toBe("10 inbound-smtp.eu-north-1.amazonaws.com");
  expect(await opened(page, "example.net").getByRole("button", { name: "Copied 10 inbound-smtp.eu-north-1.amazonaws.com" }).textContent()).toBe("Copied");
});

test("an admin checks a domain's records again once they're in DNS, and sees SES verify it", budget, async () => {
  const { page, duva, ada, settings } = await withDomains();
  const added = (await ada.POST("/domains", { body: { domain: "example.net" } })).data as Domain;
  await settings();
  await line(page, "example.net").getByRole("heading").click();
  await expect.poll(() => statuses(page, "example.net"), wait).toHaveLength(7);

  // Every record but DMARC, as its admin adds them at the domain's DNS provider, and the SPF record with another value first.
  for (const { type, name, value, purpose } of added.records) if (purpose !== "DMARC") duva.dnsRecord(type, name, [type === "TXT" ? "v=spf1 -all" : value]);
  await opened(page, "example.net").getByRole("button", { name: "Check again" }).click();

  await expect.poll(() => opened(page, "example.net").innerText(), wait).toContain("DNS has v=spf1 -all instead.");
  expect(await statuses(page, "example.net")).toContain("MAIL FROM, TXT record: Missing");

  const spf = added.records.find(({ type, purpose }) => purpose === "MAIL FROM" && type === "TXT")!;
  duva.dnsRecord("TXT", spf.name, [spf.value]);
  await opened(page, "example.net").getByRole("button", { name: "Check again" }).click();

  await expect.poll(() => statuses(page, "example.net"), wait).toEqual([
    "Receiving, MX record: Found",
    "DKIM, CNAME record: Verified",
    "DKIM, CNAME record: Verified",
    "DKIM, CNAME record: Verified",
    "MAIL FROM, MX record: Verified",
    "MAIL FROM, TXT record: Verified",
    "DMARC, TXT record: Missing",
  ]);
  expect(await line(page, "example.net").locator(".line-summary-text").textContent()).toBe("Standalone domain. Verified.");
});

test("an admin adds an alias domain of a standalone one, and its line says which it mirrors", budget, async () => {
  const { page, settings } = await withDomains();
  await settings();

  await domains(page).getByRole("textbox", { name: "Domain" }).fill("example.se");
  await domains(page).getByRole("radio", { name: /^Alias/ }).check();
  expect(await domains(page).getByRole("combobox", { name: "Mirrors" }).inputValue()).toBe("example.com");
  await domains(page).getByRole("button", { name: "Add domain" }).click();

  await expect.poll(() => line(page, "example.se").locator(".line-summary-text").textContent(), wait).toBe("Alias of example.com. Waiting for DNS.");
  expect(await opened(page, "example.se").innerText()).toContain("It uses the catch-all of example.com, which it mirrors.");
  expect(await line(page, "example.com").locator(".line-summary-text").textContent()).toBe("Standalone domain. Verified. Sign-in codes come from here.");
});

test("a domain Duva refuses says why", budget, async () => {
  const { page, settings } = await withDomains();
  await settings();

  await domains(page).getByRole("textbox", { name: "Domain" }).fill("example.com");
  await domains(page).getByRole("button", { name: "Add domain" }).click();

  await expect.poll(() => domains(page).getByRole("alert").textContent(), wait).toMatch(/example\.com/);
});

test("an admin removes a domain after a confirmation listing its addresses and the mailboxes left without one", budget, async () => {
  const { page, ada, graceMailbox, settings } = await withDomains();
  await ada.POST("/domains", { body: { domain: "example.net" } });
  await ada.POST("/domains", { body: { domain: "example.dk", aliasOf: "example.net" } });
  await ada.POST("/addresses", { body: { address: "grace@example.net", mailbox: graceMailbox.id } });
  const { data: hermes } = await ada.POST("/agents", { body: { name: "Hermes" } });
  await ada.POST("/mailboxes", { body: { owner: hermes!.agent.id, address: "hermes@example.net" } });
  await settings();
  await line(page, "example.net").getByRole("heading").click();

  await opened(page, "example.net").getByRole("button", { name: "Remove domain" }).click();

  const confirm = opened(page, "example.net").getByRole("group", { name: "Remove domain" });
  await expect.poll(() => confirm.isVisible(), wait).toBe(true);
  const asked = await confirm.innerText();
  expect(asked).toContain("Remove example.net and its alias domains example.dk?");
  for (const address of ["grace@example.net", "grace@example.dk", "hermes@example.net", "hermes@example.dk"]) expect(asked).toContain(address);
  expect(asked).toContain("Hermes is left without an address");
  await confirm.getByRole("button", { name: "Cancel" }).click();
  expect(await line(page, "example.net").count()).toBe(1);

  await opened(page, "example.net").getByRole("button", { name: "Remove domain" }).click();
  await confirm.getByRole("button", { name: "Remove", exact: true }).click();

  await expect.poll(() => said(page), wait).toBe("Removed example.net, example.dk.");
  await expect.poll(() => line(page, "example.net").count(), wait).toBe(0);
  expect(await line(page, "example.dk").count()).toBe(0);
  // The Addresses sheet follows.
  const graces = page.getByRole("region", { name: "Addresses" }).locator("details").filter({ has: page.getByRole("heading", { name: "grace@example.org", exact: true }) });
  await expect.poll(() => graces.locator(".line-summary-text").textContent(), wait).toBe("grace@example.com");
});

test("the domain sign-in codes come from can't be removed until an admin sends them from another domain SES has verified", budget, async () => {
  const { page, duva, ada, settings } = await withDomains();
  const added = (await ada.POST("/domains", { body: { domain: "example.net" } })).data as Domain;
  await settings();
  await line(page, "example.com").getByRole("heading").click();

  await opened(page, "example.com").getByRole("button", { name: "Remove domain" }).click();
  await expect.poll(() => opened(page, "example.com").getByRole("alert").textContent(), wait).toMatch(/Sign-in codes come from example\.com, so it can't be removed/);

  await line(page, "example.net").getByRole("heading").click();
  expect(await opened(page, "example.net").innerText()).toContain("Once SES has verified example.net, sign-in codes can come from it.");
  for (const { type, name, value } of added.records) duva.dnsRecord(type, name, [value]);
  await opened(page, "example.net").getByRole("button", { name: "Check again" }).click();
  await opened(page, "example.net").getByRole("button", { name: "Send them from example.net" }).click();

  await expect.poll(() => said(page), wait).toBe("Sign-in codes come from no-reply@example.net from now on.");
  await expect.poll(() => line(page, "example.net").locator(".line-summary-text").textContent(), wait).toBe("Standalone domain. Verified. Sign-in codes come from here.");
  await line(page, "example.com").getByRole("heading").click();
  await opened(page, "example.com").getByRole("button", { name: "Remove domain" }).click();
  await expect.poll(() => opened(page, "example.com").getByRole("group", { name: "Remove domain" }).isVisible(), wait).toBe(true);
});

test("an admin sets a domain's catch-all to a mailbox, then a group, then clears it", budget, async () => {
  const { page, ada, settings } = await withDomains();
  await ada.POST("/groups", { body: { address: "team@example.com", members: ["grace@example.com"] } });
  await settings();
  await line(page, "example.com").getByRole("heading").click();
  const catchAll = opened(page, "example.com").getByRole("combobox", { name: /that the organization doesn't have/ });
  const save = opened(page, "example.com").getByRole("region", { name: "Catch-all" }).getByRole("button", { name: "Save" });
  const summary = () => line(page, "example.com").locator(".line-summary-text").textContent();
  expect(await catchAll.inputValue()).toBe("");

  await catchAll.selectOption({ label: "grace@example.org, grace@example.com" });
  await save.click();

  await expect.poll(summary, wait).toBe("Standalone domain. Verified. Sign-in codes come from here. Catch-all to grace@example.org.");
  expect((await ada.GET("/domains/{domain}", { params: { path: { domain: "example.com" } } })).data?.catchAll).toEqual({ mailbox: expect.any(String) });

  await catchAll.selectOption({ label: "team@example.com" });
  await save.click();

  await expect.poll(summary, wait).toBe("Standalone domain. Verified. Sign-in codes come from here. Catch-all to team@example.com.");
  expect((await ada.GET("/domains/{domain}", { params: { path: { domain: "example.com" } } })).data?.catchAll).toEqual({ group: "team@example.com" });

  await catchAll.selectOption({ label: "None. Such mail is refused" });
  await save.click();

  await expect.poll(summary, wait).toBe("Standalone domain. Verified. Sign-in codes come from here.");
  expect((await ada.GET("/domains/{domain}", { params: { path: { domain: "example.com" } } })).data?.catchAll).toBeUndefined();
});

test("a human who isn't an admin sees neither the Domains sheet nor the Addresses sheet", budget, async () => {
  const { page, signIn } = await withDomains();
  await signIn("grace@example.org");

  await page.getByRole("navigation").getByRole("link", { name: "Settings" }).click();

  await expect.poll(() => page.getByRole("region", { name: "You" }).isVisible(), wait).toBe(true);
  expect(await page.getByRole("region", { name: "Domains" }).count()).toBe(0);
  expect(await page.getByRole("region", { name: "Addresses" }).count()).toBe(0);
});

test("on a phone, a domain's records fit the screen", budget, async () => {
  const { page, ada, settings } = await withDomains({ viewport: phone });
  await ada.POST("/domains", { body: { domain: "a-rather-long-subdomain.example.net" } });
  await settings();

  await line(page, "a-rather-long-subdomain.example.net").getByRole("heading").click();

  await expect.poll(() => statuses(page, "a-rather-long-subdomain.example.net"), wait).toHaveLength(7);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(phone.width);
});
