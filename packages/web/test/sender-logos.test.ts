import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { phone, startWebApp } from "./web-app.ts";

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
async function withLogos({ screener = false, viewport }: { screener?: boolean; viewport?: { width: number; height: number } } = {}) {
  const app = await startWebApp({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org"], viewport });
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

/** Each avatar's box, whether it is round, and where the name after it starts. */
const avatars = (within: import("playwright-core").Locator, name: string) =>
  within.evaluateAll(
    (elements, name) =>
      elements.map((element) => {
        const avatar = element.querySelector(".avatar")!;
        const box = avatar.getBoundingClientRect();
        const check = avatar.querySelector(".sender-logo-check")?.getBoundingClientRect();
        return {
          width: Math.round(box.width),
          height: Math.round(box.height),
          round: getComputedStyle(avatar).borderRadius === "50%",
          // The check's middle lies on the avatar's lower right edge.
          checkAtCorner: check === undefined ? undefined : Math.abs(check.x + check.width / 2 - box.right) < 4 && Math.abs(check.y + check.height / 2 - box.bottom) < 4,
          nameLeft: Math.round(element.querySelector(name)!.getBoundingClientRect().left),
        };
      }),
    name,
  );

test.each([
  ["a desk", { width: 1280, height: 800 }],
  ["a phone", phone],
])("on %s a sender's logo or mark sits in a round avatar at the start of each row and letter, so names line up, with the check at its corner", budget, async (_, viewport) => {
  const { page, signIn, receive } = await withLogos({ viewport });
  await receive(newsletter("Example Org <hello@example.org>", "Your order"));
  await receive(newsletter("Bob <bob@example.net>", "Lunch"));
  await receive(
    [
      "From: Example Org <hello@example.org>",
      "To: Grace <grace@example.com>",
      "Subject: Re: Your order",
      "Date: Wed, 07 Oct 2026 10:00:00 +0200",
      "Message-ID: <Your-order-shipped@example.org>",
      "In-Reply-To: <Your-order@example.org>",
      "References: <Your-order@example.org>",
      "",
      "It has shipped.",
    ].join("\r\n"),
  );
  await signIn("grace@example.org");

  const rows = page.getByRole("list", { name: "Threads" }).locator("a.thread");
  await expect.poll(() => rows.count(), wait).toBe(2);
  await expect.poll(() => rows.locator("img").evaluateAll((images) => images.every((image) => (image as HTMLImageElement).complete)), wait).toBe(true);
  const listed = await avatars(rows, ".thread-sender-name");
  expect(listed.map(({ width, height, round }) => ({ width, height, round }))).toEqual(Array(2).fill({ width: 20, height: 20, round: true }));
  expect(listed.map(({ checkAtCorner }) => checkAtCorner)).toEqual([true, undefined]);
  expect(new Set(listed.map(({ nameLeft }) => nameLeft)).size).toBe(1);

  // Opened once, the thread is read, so opened again its older letter folds to a slug.
  await rows.filter({ hasText: "Your order" }).click();
  await expect.poll(() => page.locator("article.letter").count(), wait).toBe(2);
  await page.goBack();
  await rows.filter({ hasText: "Your order" }).click();

  await expect.poll(() => page.locator(".letter-slug").count(), wait).toBe(1);
  const slug = await avatars(page.locator(".letter-slug"), ".letter-slug-from");
  const head = await avatars(page.locator(".letter-head"), ".letter-from");
  for (const avatar of [...slug, ...head]) expect(avatar).toMatchObject({ width: 20, height: 20, round: true, checkAtCorner: true });
});
