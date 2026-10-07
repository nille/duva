import type { Frame, Page } from "playwright-core";
import { expect, test } from "vitest";
import { phone, startWebApp } from "./web-app.ts";

// As in inbox.test.ts, every wait has room for a page under the full suite's load.
const wait = { timeout: 10_000 };
const budget = { timeout: 60_000 };

/** A PNG of one pixel, for the newsletter's images. */
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

/**
 * A made-up newsletter from Lindvallens IF to Grace, with a plain text and an HTML body, and its
 * logo as a part of its own that the HTML shows through `cid:`.
 */
const newsletter = ({ subject = "Höstens nyheter", text = "Höstens nyheter från Lindvallen.", html }: { subject?: string; text?: string; html: string }) =>
  [
    "From: Lindvallens IF <nyheter@lindvallen.example.net>",
    "To: Grace <grace@example.com>",
    `Subject: ${subject}`,
    "Date: Sun, 04 Oct 2026 09:00:00 +0000",
    `Message-ID: <${subject.length}-${text.length}@lindvallen.example.net>`,
    "MIME-Version: 1.0",
    'Content-Type: multipart/alternative; boundary="alt"',
    "",
    "--alt",
    "Content-Type: text/plain; charset=utf-8",
    "",
    text,
    "--alt",
    'Content-Type: multipart/related; boundary="del"',
    "",
    "--del",
    "Content-Type: text/html; charset=utf-8",
    "",
    html,
    "--del",
    "Content-Type: image/png",
    "Content-ID: <logga@lindvallen.example.net>",
    "Content-Disposition: inline",
    "Content-Transfer-Encoding: base64",
    "",
    png.toString("base64"),
    "--del--",
    "--alt--",
  ].join("\r\n");

/** The newsletter's HTML: its own colors, a remote image, its logo, a link, two SendGrid pixels and a hidden image. */
const designed = [
  `<html><head><style>.rubrik { color: rgb(160, 32, 64); }</style></head>`,
  `<body style="background: rgb(16, 34, 58); color: rgb(240, 240, 240)">`,
  `<h1 class="rubrik">Höstens nyheter</h1>`,
  `<img src="https://bilder.lindvallen.example.net/huset.png" alt="Klubbhuset" width="200" height="100">`,
  `<img src="cid:logga@lindvallen.example.net" alt="Logga" width="40" height="40">`,
  `<p>Läs mer på <a href="https://lindvallen.example.net/nyheter">vår sida</a>.</p>`,
  `<img src="https://u1.ct.sendgrid.net/wf/open?upn=abc" alt=""><img src="https://u2.ct.sendgrid.net/wf/open?upn=def" alt="">`,
  `<img src="https://bilder.lindvallen.example.net/p.gif" width="1" height="1" alt="">`,
  `</body></html>`,
].join("");

/**
 * The web app for a deployment where the human Grace has a personal mailbox at grace@example.com,
 * signed in, with the mail in her Inbox. Every request to lindvallen.example.net and sendgrid.net
 * is answered here and kept in `requested`.
 */
async function withMail(raws: string[], options: { viewport?: { width: number; height: number } } = {}) {
  const app = await startWebApp({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org"], ...options });
  const ada = app.duva.signIn("ada@example.org");
  const grace = app.duva.signIn("grace@example.org");
  const { data: me } = await grace.GET("/whoami");
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: me!.id, address: "grace@example.com" } });
  // Mail from first-time senders would wait in the Screener, which these tests leave out.
  await grace.PATCH("/mailboxes/{mailbox}/screener", { params: { path: { mailbox: mailbox!.id } }, body: { on: false } });
  for (const raw of raws) await app.duva.receive(raw, { to: ["grace@example.com"] });
  const requested: { url: string; referer?: string }[] = [];
  await app.page.context().route(/lindvallen\.example\.net|sendgrid\.net/, (route) => {
    requested.push({ url: route.request().url(), referer: route.request().headers().referer });
    const image = /\.(png|gif)$/.test(new URL(route.request().url()).pathname);
    return route.fulfill(image ? { contentType: "image/png", body: png } : { contentType: "text/html", body: "<title>Nyheter</title><p>Nyheter</p>" });
  });
  await app.signIn("grace@example.org");
  return { ...app, grace, requested };
}

/** The frame the message's HTML shows in, once it has loaded. */
async function letterFrame(page: Page): Promise<Frame> {
  const element = page.getByRole("article").locator("iframe");
  await expect.poll(() => element.count(), wait).toBe(1);
  const frame = await (await element.elementHandle())!.contentFrame();
  await expect.poll(() => frame!.evaluate(() => document.readyState), wait).toBe("complete");
  return frame!;
}

/** Whether every image in the frame with the alternative text has loaded. */
const loaded = (frame: Frame, alt: string) => frame.locator(`img[alt="${alt}"]`).evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0);

const open = (page: Page, subject: string) => page.getByRole("link", { name: new RegExp(subject) }).click();

test("a human reads HTML mail as its sender designed it, with its images and colors, and without its trackers", budget, async () => {
  const { page, requested } = await withMail([newsletter({ html: designed })]);
  await open(page, "Höstens nyheter");

  const frame = await letterFrame(page);

  expect(await frame.getByRole("heading", { level: 1 }).textContent()).toBe("Höstens nyheter");
  expect(await frame.locator("h1").evaluate((heading) => getComputedStyle(heading).color)).toBe("rgb(160, 32, 64)");
  // Duva serves the mail's body as a block of its own, which keeps its styles.
  expect(await frame.locator("body > div").first().evaluate((body) => getComputedStyle(body).backgroundColor)).toBe("rgb(16, 34, 58)");
  await expect.poll(() => loaded(frame, "Klubbhuset"), wait).toBe(true);
  await expect.poll(() => loaded(frame, "Logga"), wait).toBe(true);
  expect(requested.map(({ url }) => url)).toEqual(["https://bilder.lindvallen.example.net/huset.png"]);
  expect(requested[0]!.referer).toBeUndefined();
  expect(await page.getByRole("article").getByText("Removed 3 trackers: 2 from SendGrid and 1 hidden image.").count()).toBe(1);
});

test("a single tracker is named by its service", budget, async () => {
  const { page } = await withMail([newsletter({ html: `<p>Hej</p><img src="https://lindvallen.us5.list-manage.com/track/open.php?u=1" alt="">` })]);
  await open(page, "Höstens nyheter");

  await letterFrame(page);

  expect(await page.getByRole("article").getByText("Removed a tracker from Mailchimp.").count()).toBe(1);
});

test("a script and an inline handler in HTML mail don't run, and the frame is never allowed scripts", budget, async () => {
  const html = [
    `<h1 onclick="parent.ran = 'onclick'">Höstens nyheter</h1>`,
    `<script>parent.ran = 'script'</script>`,
    `<img src="https://bilder.lindvallen.example.net/saknas" alt="Saknas" onerror="parent.ran = 'onerror'">`,
  ].join("");
  const { page } = await withMail([newsletter({ html })]);
  await open(page, "Höstens nyheter");
  const frame = await letterFrame(page);

  await frame.getByRole("heading", { level: 1 }).click();

  // Should the sanitizer ever let a script or a handler through, the frame still doesn't run them.
  await page.evaluate(() => {
    const mail = document.querySelector<HTMLIFrameElement>("article iframe")!.contentDocument!;
    const script = mail.createElement("script");
    script.textContent = "parent.ran = 'a script let through'";
    const image = mail.createElement("img");
    image.setAttribute("src", "https://bilder.lindvallen.example.net/saknas");
    image.setAttribute("onerror", "parent.ran = 'a handler let through'");
    mail.body.append(script, image);
  });
  await page.waitForTimeout(500);

  expect(await page.evaluate(() => (window as { ran?: string }).ran)).toBeUndefined();
  const sandbox = await page.getByRole("article").locator("iframe").getAttribute("sandbox");
  expect(sandbox?.split(/\s+/).sort()).toEqual(["allow-popups", "allow-popups-to-escape-sandbox", "allow-same-origin"]);
  // And should the sandbox ever allow scripts, the frame's own policy still refuses them.
  const policy = await frame.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
  expect(policy).toContain("script-src 'none'");
  expect(policy).toContain("default-src 'none'");
});

test("the frame is as tall as the mail, so the page scrolls and the frame doesn't", budget, async () => {
  const { page } = await withMail([newsletter({ html: `<div style="height: 1500px">Höstens nyheter</div><p>Slutet</p>` })]);
  await open(page, "Höstens nyheter");
  const frame = await letterFrame(page);

  const element = page.getByRole("article").locator("iframe");
  await expect.poll(async () => (await element.boundingBox())!.height, wait).toBeGreaterThan(1500);
  const { scrollHeight, clientHeight } = await frame.evaluate(() => ({ scrollHeight: document.documentElement.scrollHeight, clientHeight: document.documentElement.clientHeight }));
  expect(scrollHeight).toBeLessThanOrEqual(clientHeight);
});

test("mail whose styles fill the frame is still as tall as what it holds", budget, async () => {
  const html = `<style>html, body { height: 100%; }</style><div style="height: 100vh">Höstens nyheter</div><div style="height: 900px">Slutet</div>`;
  const { page } = await withMail([newsletter({ html })]);
  const errors: string[] = [];
  page.on("console", (message) => void (message.type() === "error" && errors.push(message.text())));
  page.on("pageerror", (error) => void errors.push(error.message));
  await open(page, "Höstens nyheter");
  await letterFrame(page);

  const element = page.getByRole("article").locator("iframe");
  // A height of the frame's own, such as 100vh, means nothing in a frame as tall as the mail, so it counts for none.
  await expect.poll(async () => (await element.boundingBox())!.height, wait).toBeGreaterThanOrEqual(900);
  const fitted = (await element.boundingBox())!.height;
  await page.waitForTimeout(500);
  expect((await element.boundingBox())!.height).toBe(fitted);
  expect(errors).toEqual([]);
});

test("a link in mail that would lead into Duva leads nowhere", budget, async () => {
  const { page } = await withMail([newsletter({ html: `<p><a href="/#settings">Inställningar</a> och <a href="//lindvallen.example.net/">klubben</a></p>` })]);
  await open(page, "Höstens nyheter");
  const frame = await letterFrame(page);

  expect(await frame.getByText("Inställningar").getAttribute("href")).toBeNull();
  expect(await frame.getByRole("link", { name: "klubben" }).getAttribute("href")).toBe("//lindvallen.example.net/");
});

test("a link in HTML mail opens in a new tab, which can't reach Duva's page and isn't told where it came from", budget, async () => {
  const { page, requested } = await withMail([newsletter({ html: designed })]);
  await open(page, "Höstens nyheter");
  const frame = await letterFrame(page);

  const [tab] = await Promise.all([page.context().waitForEvent("page", wait), frame.getByRole("link", { name: "vår sida" }).click()]);
  await tab.waitForLoadState();

  expect(tab.url()).toBe("https://lindvallen.example.net/nyheter");
  expect(await tab.evaluate(() => window.opener)).toBeNull();
  expect(requested.find(({ url }) => url === "https://lindvallen.example.net/nyheter")?.referer).toBeUndefined();
});

test("a human switches a message to its plain text and back", budget, async () => {
  const { page } = await withMail([newsletter({ html: designed })]);
  await open(page, "Höstens nyheter");
  await letterFrame(page);
  const article = page.getByRole("article");

  await article.getByRole("button", { name: "Show as plain text" }).click();

  await expect.poll(() => article.locator("iframe").count(), wait).toBe(0);
  expect(await article.innerText()).toContain("Höstens nyheter från Lindvallen.");
  expect(await article.getByText(/^Removed/).count()).toBe(0);

  await article.getByRole("button", { name: "Show as designed" }).click();

  const frame = await letterFrame(page);
  expect(await frame.getByRole("heading", { level: 1 }).textContent()).toBe("Höstens nyheter");
});

test("a human chooses plain text on the You sheet, and HTML mail shows as text until they switch a message", budget, async () => {
  const { page, grace } = await withMail([newsletter({ html: designed })]);
  await page.getByRole("navigation").getByRole("link", { name: "Settings" }).click();
  const you = page.getByRole("region", { name: "You" });
  await expect.poll(() => you.getByRole("radio", { name: /^As designed/ }).isChecked(), wait).toBe(true);

  await you.getByRole("radio", { name: /^Plain text/ }).check();
  await you.getByRole("button", { name: "Save" }).click();

  await expect.poll(() => you.getByRole("status").textContent(), wait).toBe("Saved. This applies from now on.");
  expect((await grace.GET("/preferences")).data?.mailView).toBe("text");
  await page.getByRole("navigation").getByRole("link", { name: "Mail", exact: true }).click();
  await open(page, "Höstens nyheter");
  const article = page.getByRole("article");
  await expect.poll(() => article.innerText(), wait).toContain("Höstens nyheter från Lindvallen.");
  expect(await article.locator("iframe").count()).toBe(0);

  await article.getByRole("button", { name: "Show as designed" }).click();

  await letterFrame(page);
});

test("a quote the mail cites at its end folds behind Show quoted text", budget, async () => {
  const html = [
    `<div dir="ltr">Det låter bra, vi ses på lördag.</div>`,
    `<div class="gmail_quote"><div class="gmail_attr">On Sat, Oct 3, Ada wrote:</div>`,
    `<blockquote class="gmail_quote">Ska vi ses på matchen?</blockquote></div>`,
  ].join("");
  const { page } = await withMail([newsletter({ subject: "Matchen", text: "Det låter bra, vi ses på lördag.", html })]);
  await open(page, "Matchen");
  let frame = await letterFrame(page);
  const article = page.getByRole("article");

  expect(await frame.locator("body").innerText()).toBe("Det låter bra, vi ses på lördag.");

  await article.getByRole("button", { name: "Show quoted text" }).click();

  await expect.poll(async () => (frame = await letterFrame(page)).locator("body").innerText(), wait).toContain("Ska vi ses på matchen?");
  expect(await article.getByRole("button", { name: "Hide quoted text" }).count()).toBe(1);
});

test("a quote with the sender's own words after it shows as written, without folding", budget, async () => {
  const html = `<blockquote type="cite">Ska vi ses på matchen?</blockquote><p>Ja, på lördag.</p>`;
  const { page } = await withMail([newsletter({ subject: "Matchen", text: "Ja, på lördag.", html })]);
  await open(page, "Matchen");

  const frame = await letterFrame(page);

  expect(await frame.locator("body").innerText()).toContain("Ska vi ses på matchen?");
  expect(await page.getByRole("article").getByRole("button", { name: "Show quoted text" }).count()).toBe(0);
});

test("on a phone, mail laid out wider than the sheet shrinks to fit it, so it never scrolls sideways", budget, async () => {
  const html = `<table width="600"><tr><td><h1>Höstens nyheter</h1><img src="https://bilder.lindvallen.example.net/huset.png" alt="Klubbhuset" width="600" height="200"></td></tr></table>`;
  const { page } = await withMail([newsletter({ html })], { viewport: phone });
  await open(page, "Höstens nyheter");
  const frame = await letterFrame(page);

  const sheet = (await page.getByRole("article").boundingBox())!;
  const box = (await page.getByRole("article").locator("iframe").boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(sheet.x + sheet.width);
  await expect.poll(() => loaded(frame, "Klubbhuset"), wait).toBe(true);
  const image = (await frame.locator('img[alt="Klubbhuset"]').boundingBox())!;
  expect(image.x + image.width).toBeLessThanOrEqual(box.x + box.width + 1);
  expect(box.height).toBeLessThan(250);
});
