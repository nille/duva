import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import type { Locator, Page } from "playwright-core";
import { startWebApp, type WebApp } from "./web-app.ts";

/** The API tests' logo, square SVG Tiny PS. */
const logo = readFileSync(new URL("../../api/test/marks/logo.svg", import.meta.url));

// The page under the full suite's load can take seconds to show what changed, so every wait has room, and every test more.
const wait = { timeout: 10_000 };
const budget = { timeout: 60_000 };

/**
 * The web app for a deployment on example.com, where Ada is the admin and Grace a human with a
 * mailbox at grace@example.com. Its DMARC policy is none.
 */
async function withLogos() {
  const app = await startWebApp({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org"] });
  app.duva.dnsRecord("TXT", "_dmarc.example.com", ["v=DMARC1; p=none;"]);
  const ada = app.duva.signIn("ada@example.org");
  const { data: grace } = await app.duva.signIn("grace@example.org").GET("/whoami");
  await ada.POST("/mailboxes", { body: { owner: grace!.id, address: "grace@example.com" } });
  return app;
}

/** Opens Settings as the human, on the Domains sheet for an admin, with the domain's line opened. */
async function openDomain({ page, signIn }: WebApp, domain: string) {
  await signIn("ada@example.org");
  await page.getByRole("navigation").getByRole("link", { name: "Settings" }).click();
  await page.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: /^Domains/ }).click();
  await page.getByRole("region", { name: "Domains" }).getByRole("heading", { name: domain, exact: true }).click();
  return page.getByRole("region", { name: "Domains" }).getByRole("group", { name: domain, exact: true }).getByRole("region", { name: "Logo" });
}

/** Chooses the file at the button's file chooser, as a human picks it from their disk. */
async function upload(page: Page, scope: Locator, button: string, file: { name: string; mimeType: string; buffer: Buffer }) {
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), scope.getByRole("button", { name: button }).click()]);
  await chooser.setFiles(file);
}

/** Each record's name and its status, as the screen reads them. */
const statuses = (scope: Locator) => scope.locator(".dns-record").evaluateAll((records) => records.map((record) => `${record.getAttribute("aria-label")}: ${record.querySelector(".dns-status")?.textContent}`));

test("an admin uploads a domain's logo, sees it as receivers show it and the BIMI record to add, and is warned while the domain doesn't enforce DMARC", budget, async () => {
  const app = await withLogos();
  const { page, duva } = app;
  const part = await openDomain(app, "example.com");
  await expect.poll(() => part.innerText(), wait).toContain("BIMI needs DMARC enforcement, and example.com's DMARC policy doesn't enforce it");
  expect(await part.innerText()).toContain("every message from example.com that fails DMARC, from any mailbox and from any other service that sends as example.com");
  expect(await part.innerText()).toContain("No logo yet.");

  await upload(page, part, "Upload an SVG", { name: "logo.svg", mimeType: "image/svg+xml", buffer: logo });

  await expect.poll(() => part.getByRole("status").textContent(), wait).toBe("Logo set. Duva serves it now.");
  const preview = part.getByRole("img", { name: "example.com's logo" });
  await expect.poll(() => preview.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0), wait).toBe(true);
  expect(await statuses(part)).toEqual(["BIMI, TXT record: Missing"]);
  const value = await part.locator(".dns-text").nth(1).textContent();
  expect(await part.locator(".dns-text").first().textContent()).toBe("default._bimi.example.com");
  expect(value).toMatch(/^v=BIMI1; l=http.*\/bimi\/domains\/example\.com\.svg;$/);
  expect(await part.getByRole("button", { name: `Copy ${value}` }).count()).toBe(1);

  duva.dnsRecord("TXT", "default._bimi.example.com", [value!]);
  duva.dnsRecord("TXT", "_dmarc.example.com", ["v=DMARC1; p=quarantine;"]);
  await part.getByRole("button", { name: "Check again" }).click();

  await expect.poll(() => statuses(part), wait).toEqual(["BIMI, TXT record: Matches"]);
  expect(await part.innerText()).not.toContain("BIMI needs DMARC enforcement");
});

test("a picture uploaded as a logo is refused, saying why", budget, async () => {
  const app = await withLogos();
  const part = await openDomain(app, "example.com");

  await upload(app.page, part, "Upload an SVG", { name: "logo.png", mimeType: "image/png", buffer: Buffer.from("89504e470d0a1a0a0000000d49484452", "hex") });

  await expect.poll(() => part.getByRole("alert").textContent(), wait).toMatch(/^That isn't an SVG file\. Duva takes a logo as SVG, since SVG Tiny PS can't hold a picture such as a PNG/);
  expect(await part.innerText()).toContain("No logo yet.");
});

test("an admin attaches a mark certificate by its URL, which the record then gives", budget, async () => {
  const app = await withLogos();
  await app.duva.signIn("ada@example.org").PUT("/domains/{domain}/logo", { params: { path: { domain: "example.com" } }, body: { svg: logo.toString() } });
  const part = await openDomain(app, "example.com");

  await part.getByRole("textbox", { name: "Certificate URL" }).fill("https://example.com/bimi/vmc.pem");
  await part.getByRole("button", { name: "Attach" }).click();

  await expect.poll(() => part.getByRole("status").textContent(), wait).toBe("Certificate attached. Update the record in DNS.");
  expect(await part.innerText()).toContain("The record gives the certificate at https://example.com/bimi/vmc.pem.");
  expect(await part.locator(".dns-text").nth(1).textContent()).toMatch(/; a=https:\/\/example\.com\/bimi\/vmc\.pem;$/);
});

test("a human sets their own logo on You, and sees the record to ask an admin for", budget, async () => {
  const app = await withLogos();
  const { page, signIn } = app;
  await signIn("grace@example.org");
  await page.getByRole("navigation").getByRole("link", { name: "Settings" }).click();
  const mine = page.getByRole("region", { name: "My logo" });
  await expect.poll(() => mine.innerText(), wait).toContain("Only some receivers honor a mailbox's own logo, and others show the domain's.");

  await upload(page, mine, "Upload an SVG", { name: "logo.svg", mimeType: "image/svg+xml", buffer: logo });

  await expect.poll(() => statuses(mine), wait).toEqual(["BIMI on example.com, TXT record: Missing"]);
  expect(await mine.locator(".dns-text").first().textContent()).toBe("grace._bimi.example.com");
  expect(await mine.innerText()).toContain("Ask an admin to add this record at the domain's DNS provider.");
  expect(await mine.getByRole("img", { name: "grace@example.com's logo" }).count()).toBe(1);
});

test("an admin's Domains line lists each mailbox's own logo on the domain, by its owner and selector, with its record", budget, async () => {
  const app = await withLogos();
  const grace = app.duva.signIn("grace@example.org");
  const { data } = await grace.GET("/mailboxes");
  await grace.PUT("/mailboxes/{mailbox}/logo", { params: { path: { mailbox: data!.mailboxes[0]!.id } }, body: { svg: logo.toString() } });

  const part = await openDomain(app, "example.com");

  await expect.poll(() => statuses(part), wait).toEqual(["grace@example.org, selector grace, TXT record: Missing"]);
  expect(await part.innerText()).toContain("Mailboxes' own logos");
});
