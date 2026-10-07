import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { startWebApp } from "./web-app.ts";

// A page under the full suite's load can take seconds to show what changed, so every wait has room, and every test more.
const wait = { timeout: 10_000 };
const budget = { timeout: 60_000 };

const logo = readFileSync(new URL("../../api/test/marks/logo.svg", import.meta.url), "utf8");
const vmc = readFileSync(new URL("../../api/test/marks/vmc.pem", import.meta.url), "utf8");

/** A newsletter to Grace from the address, about the subject. */
const newsletter = (from: string, subject: string) =>
  [
    `From: ${from}`,
    "To: Grace <grace@example.com>",
    `Subject: ${subject}`,
    "Date: Wed, 07 Oct 2026 09:00:00 +0200",
    `Message-ID: <${subject.replaceAll(" ", "-")}@example.org>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    `About ${subject}.`,
  ].join("\r\n");

/**
 * The web app for a deployment on example.com where Grace has her personal mailbox at
 * grace@example.com. lists.example.org enforces DMARC and publishes a logo, and example.org one
 * that its VMC verifies, both served from logos.example.net. With `screener`, Grace's Screener is on.
 */
async function withLogos({ screener = false } = {}) {
  const app = await startWebApp({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org"] });
  const ada = app.duva.signIn("ada@example.org");
  const grace = app.duva.signIn("grace@example.org");
  const { data: me } = await grace.GET("/whoami");
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: me!.id, address: "grace@example.com" } });
  if (!screener) await grace.PATCH("/mailboxes/{mailbox}/screener", { params: { path: { mailbox: mailbox!.id } }, body: { on: false } });
  const files: Record<string, string> = { "/logo.svg": logo, "/vmc.pem": vmc };
  await app.duva.webServer("logos.example.net", { answer: (request) => new Response(files[new URL(request.url).pathname] ?? null, { status: files[new URL(request.url).pathname] === undefined ? 404 : 200 }) });
  for (const domain of ["lists.example.org", "example.org"]) app.duva.dnsRecord("TXT", `_dmarc.${domain}`, ["v=DMARC1; p=reject;"]);
  app.duva.dnsRecord("TXT", "default._bimi.lists.example.org", ["v=BIMI1; l=https://logos.example.net/logo.svg"]);
  app.duva.dnsRecord("TXT", "default._bimi.example.org", ["v=BIMI1; l=https://logos.example.net/logo.svg; a=https://logos.example.net/vmc.pem"]);
  const receive = (raw: string) => app.duva.receive(raw, { to: ["grace@example.com"] });
  return { ...app, receive };
}

test("a sender's logo shows in place of their mark in the list and in the letter, and a verified one carries the check", budget, async () => {
  const { page, signIn, receive } = await withLogos();
  await receive(newsletter("Example News <news@lists.example.org>", "Weekly news"));
  await receive(newsletter("Example Org <hello@example.org>", "Your order"));
  await receive(newsletter("Bob <bob@example.net>", "Lunch"));

  await signIn("grace@example.org");

  const rows = page.getByRole("list", { name: "Threads" }).getByRole("listitem");
  await expect.poll(() => rows.count(), wait).toBe(3);
  const row = (subject: string) => page.getByRole("link", { name: new RegExp(subject) });
  expect(await row("Weekly news").getByRole("img").getAttribute("alt")).toBe("Example News's logo");
  expect(await row("Weekly news").locator(".sender-logo-check").count()).toBe(0);
  expect(await row("Your order").getByRole("img").getAttribute("alt")).toBe("Example Org's verified logo");
  expect(await row("Your order").getAttribute("aria-label")).toMatch(/^Unread, Example Org, verified logo, Your order/);
  expect(await row("Your order").locator(".sender-logo-check").count()).toBe(1);
  expect(await row("Lunch").locator("img").count()).toBe(0);
  expect(await row("Lunch").locator(".actor-mark-human").count()).toBe(1);
  // The logo loaded, from Duva.
  await expect.poll(() => row("Your order").locator("img").evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0), wait).toBe(true);
  expect(await row("Your order").locator("img").getAttribute("src")).toMatch(/\/download\/logos\/[0-9a-f-]{36}$/);

  await row("Your order").click();

  const letter = page.locator("article.letter").last();
  await expect.poll(() => letter.getByRole("img", { name: "Example Org's verified logo" }).count(), wait).toBe(1);
  // The logo stands at the start of the letter's head, before the sender's name.
  const [image, name] = await Promise.all([letter.locator(".letter-head .sender-logo").boundingBox(), letter.locator(".letter-from").boundingBox()]);
  expect(image!.x).toBeLessThan(name!.x);
  expect(image!.height).toBeLessThan(24);
});

test("a logo that won't load gives way to the sender's mark", budget, async () => {
  const { page, signIn, receive } = await withLogos();
  await receive(newsletter("Example News <news@lists.example.org>", "Weekly news"));
  await page.route("**/download/logos/**", (route) => route.abort());

  await signIn("grace@example.org");

  const row = page.getByRole("link", { name: /Weekly news/ });
  await expect.poll(() => row.locator(".actor-mark-human").count(), wait).toBe(1);
  expect(await row.locator("img").count()).toBe(0);
});

test("a first-time sender's logo shows by their name in the Screener", budget, async () => {
  const { page, signIn, receive } = await withLogos({ screener: true });
  await receive(newsletter("Example Org <hello@example.org>", "Your order"));
  await signIn("grace@example.org");

  await page.getByRole("navigation", { name: "Mail" }).getByRole("link", { name: /^Screener/ }).click();

  const waiting = page.getByRole("list", { name: "Waiting senders" }).getByRole("listitem").filter({ has: page.getByRole("heading", { name: "Example Org" }) });
  await expect.poll(() => waiting.getByRole("img", { name: "Example Org's verified logo" }).count(), wait).toBe(1);
});
