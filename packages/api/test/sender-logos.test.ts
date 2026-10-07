import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { startDuva } from "./harness.ts";
import type { Verdicts } from "./ses.ts";
import type { WebServerOptions } from "./web.ts";

/** The tests' logo, SVG Tiny PS, and the VMC the tests' Mark Verifying Authority issued for example.org carrying it. */
const logo = readFileSync(new URL("marks/logo.svg", import.meta.url), "utf8");
const otherLogo = readFileSync(new URL("marks/other-logo.svg", import.meta.url), "utf8");
const vmc = readFileSync(new URL("marks/vmc.pem", import.meta.url), "utf8");
const strangersVmc = readFileSync(new URL("marks/stranger.pem", import.meta.url), "utf8");

/** The tests' logo as Duva writes it out again. */
const written = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny-ps" viewBox="0 0 64 64">
  <title>Example Org</title>
  <rect width="64" height="64" fill="#0b5fff"></rect>
  <circle cx="32" cy="32" r="18" fill="#ffffff"></circle>
</svg>`;

/** A newsletter from the address, with a BIMI-Selector header if given. */
const newsletter = (from: string, { selector, subject = "News", headers = [] }: { selector?: string; subject?: string; headers?: string[] } = {}) =>
  [
    `From: News <${from}>`,
    "To: grace@example.com",
    `Subject: ${subject}`,
    "Date: Wed, 07 Oct 2026 09:00:00 +0200",
    `Message-ID: <${subject.replaceAll(" ", "-")}.${from}>`,
    ...(selector === undefined ? [] : [`BIMI-Selector: v=BIMI1; s=${selector};`]),
    ...headers,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "This week's news.",
  ].join("\r\n");

/**
 * A deployment on example.com where Grace has her personal mailbox at grace@example.com, and
 * logos.example.net serves logos and mark certificates, by path, as given. A test of many cases
 * starts one deployment, not one for each, which under load takes a second or more.
 */
async function withMailbox(files: Record<string, string | WebServerOptions["answer"]> = {}) {
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org"] });
  const ada = duva.signIn("ada@example.org");
  const grace = duva.signIn("grace@example.org");
  const { data: me } = await grace.GET("/whoami");
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: me!.id, address: "grace@example.com" } });
  const params = { path: { mailbox: mailbox!.id } };
  const requests = await duva.webServer("logos.example.net", {
    answer: (request) => {
      const file = files[new URL(request.url).pathname];
      if (typeof file === "function") return file(request);
      return file === undefined ? new Response(null, { status: 404 }) : new Response(file, { headers: { "content-type": "image/svg+xml" } });
    },
  });
  /** Hands SES the message for Grace, which passes DMARC unless the verdicts say otherwise, and answers with the message as Grace reads it, and its thread's summary. */
  const receive = async (raw: string, { verdicts = {}, at }: { verdicts?: Verdicts; at?: Date } = {}) => {
    await duva.receive(raw, { to: ["grace@example.com"] }, { verdicts, ...(at !== undefined && { at }) });
    // Signed in afresh, since a test may have moved the clock past an earlier session's end.
    const grace = duva.signIn("grace@example.org");
    // New senders wait in the Screener, those on the organization's domains go to the Inbox, and spam to Spam.
    const listed = await Promise.all(["screener", "inbox", "spam"].map(async (label) => (await grace.GET("/mailboxes/{mailbox}/threads", { params: { ...params, query: { label } } })).data!.threads));
    const summary = listed.flat().sort((a, b) => b.latestAt.localeCompare(a.latestAt))[0]!;
    const { data: thread } = await grace.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { ...params.path, thread: summary.id } } });
    return { summary, message: thread!.messages.at(-1)! };
  };
  /** Publishes the domain's DMARC and BIMI records in DNS, as its owner does. */
  const publish = (domain: string, { dmarc, bimi, selector = "default" }: { dmarc?: string; bimi?: string; selector?: string }) => {
    if (dmarc !== undefined) duva.dnsRecord("TXT", `_dmarc.${domain}`, [dmarc]);
    if (bimi !== undefined) duva.dnsRecord("TXT", `${selector}._bimi.${domain}`, [bimi]);
  };
  return { duva, grace, params, requests, receive, publish };
}

test("mail that passed DMARC from a domain that enforces it shows the logo its BIMI record gives, which Duva serves", async () => {
  const { duva, requests, receive, publish } = await withMailbox({ "/logo.svg": logo });
  publish("lists.example.org", { dmarc: "v=DMARC1; p=reject;", bimi: "v=BIMI1; l=https://logos.example.net/logo.svg" });

  const { message, summary } = await receive(newsletter("news@lists.example.org"));

  expect(message.logo).toEqual({ url: expect.stringMatching(/\/download\/logos\/[0-9a-f-]{36}$/), verified: false });
  expect(summary.logo).toEqual(message.logo);
  const served = await duva.download(message.logo!.url);
  expect(served.status).toBe(200);
  expect(served.headers.get("content-type")).toBe("image/svg+xml");
  expect(served.headers.get("content-security-policy")).toContain("sandbox");
  expect(await served.text()).toBe(written);
  expect(requests.map(({ method, url }) => `${method} ${url}`)).toEqual(["GET https://logos.example.net/logo.svg"]);
});

test("reading mail with a logo never reaches the sender's server", async () => {
  const { duva, grace, params, requests, receive, publish } = await withMailbox({ "/logo.svg": logo });
  publish("lists.example.org", { dmarc: "v=DMARC1; p=quarantine;", bimi: "v=BIMI1; l=https://logos.example.net/logo.svg" });
  const { message, summary } = await receive(newsletter("news@lists.example.org"));

  await grace.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { ...params.path, thread: summary.id } } });
  await duva.download(message.logo!.url);

  expect(requests).toHaveLength(1);
});

test("a logo with a mark certificate from a Mark Verifying Authority for the domain and the logo is verified", async () => {
  const { receive, publish } = await withMailbox({ "/logo.svg": logo, "/vmc.pem": vmc });
  publish("example.org", { dmarc: "v=DMARC1; p=reject;", bimi: "v=BIMI1; l=https://logos.example.net/logo.svg; a=https://logos.example.net/vmc.pem" });

  const { message } = await receive(newsletter("news@example.org"));

  expect(message.logo).toEqual({ url: expect.any(String), verified: true });
});

test("a logo whose mark certificate doesn't vouch for it shows, but isn't verified", async () => {
  const { duva, receive, publish } = await withMailbox({ "/logo.svg": logo, "/other.svg": otherLogo, "/vmc.pem": vmc, "/stranger.pem": strangersVmc, "/broken.pem": "-----BEGIN CERTIFICATE-----\nnot one\n-----END CERTIFICATE-----\n" });
  publish("example.org", { dmarc: "v=DMARC1; p=reject;" });
  const cases = {
    // From an authority no one trusts.
    stranger: "v=BIMI1; l=https://logos.example.net/logo.svg; a=https://logos.example.net/stranger.pem",
    // Carrying another logo than the record gives.
    other: "v=BIMI1; l=https://logos.example.net/other.svg; a=https://logos.example.net/vmc.pem",
    // Not a certificate at all.
    broken: "v=BIMI1; l=https://logos.example.net/logo.svg; a=https://logos.example.net/broken.pem",
    // Not there.
    missing: "v=BIMI1; l=https://logos.example.net/logo.svg; a=https://logos.example.net/missing.pem",
  };
  for (const [selector, bimi] of Object.entries(cases)) publish("example.org", { selector, bimi });
  const verified: Record<string, boolean | undefined> = {};
  for (const selector of Object.keys(cases)) verified[selector] = (await receive(newsletter("news@example.org", { selector, subject: selector }))).message.logo?.verified;

  // For a domain it doesn't name, from a subdomain with a record of its own.
  publish("shop.example.net", { dmarc: "v=DMARC1; p=reject;", bimi: "v=BIMI1; l=https://logos.example.net/logo.svg; a=https://logos.example.net/vmc.pem" });
  verified.otherDomain = (await receive(newsletter("news@shop.example.net", { subject: "otherDomain" }))).message.logo?.verified;

  // Expired: it is valid for ten years from when it was made, in 2026.
  publish("example.org", { bimi: "v=BIMI1; l=https://logos.example.net/logo.svg; a=https://logos.example.net/vmc.pem" });
  await duva.clock(new Date("2037-01-01T00:00:00Z"));
  verified.expired = (await receive(newsletter("news@example.org", { subject: "expired" }))).message.logo?.verified;

  expect(verified).toEqual({ stranger: false, other: false, broken: false, missing: false, otherDomain: false, expired: false });
});

test("mail shows no logo unless it passed DMARC and its domain enforces DMARC on all its mail", async () => {
  const { receive, publish } = await withMailbox({ "/logo.svg": logo });
  const bimi = "v=BIMI1; l=https://logos.example.net/logo.svg";
  publish("none.example.org", { dmarc: "v=DMARC1; p=none;", bimi });
  publish("partly.example.org", { dmarc: "v=DMARC1; p=reject; pct=50", bimi });
  publish("unpublished.example.org", { bimi });
  publish("passing.example.org", { dmarc: "v=DMARC1; p=reject;", bimi });
  publish("twice.example.org", { bimi });
  publish("lenient.example.org", { dmarc: "v=DMARC1; p=reject; sp=none;" });
  publish("sub.lenient.example.org", { bimi });

  const logos = {
    none: (await receive(newsletter("news@none.example.org", { subject: "none" }))).message.logo,
    partly: (await receive(newsletter("news@partly.example.org", { subject: "partly" }))).message.logo,
    unpublished: (await receive(newsletter("news@unpublished.example.org", { subject: "unpublished" }))).message.logo,
    failed: (await receive(newsletter("news@passing.example.org", { subject: "failed" }), { verdicts: { dmarc: "FAIL", dmarcPolicy: "none" } })).message.logo,
    gray: (await receive(newsletter("news@passing.example.org", { subject: "gray" }), { verdicts: { dmarc: "GRAY" } })).message.logo,
    spam: (await receive(newsletter("news@passing.example.org", { subject: "spam" }), { verdicts: { spam: "FAIL" } })).message.logo,
    subdomainOfLenient: (await receive(newsletter("news@sub.lenient.example.org", { subject: "lenient" }))).message.logo,
  };

  expect(logos).toEqual({ none: undefined, partly: undefined, unpublished: undefined, failed: undefined, gray: undefined, spam: undefined, subdomainOfLenient: undefined });
});

test("mail from a subdomain without records of its own shows its organization's logo", async () => {
  const { receive, publish } = await withMailbox({ "/logo.svg": logo, "/vmc.pem": vmc });
  publish("example.org", { dmarc: "v=DMARC1; p=quarantine; sp=reject", bimi: "v=BIMI1; l=https://logos.example.net/logo.svg; a=https://logos.example.net/vmc.pem" });

  const { message } = await receive(newsletter("news@mail.example.org"));

  expect(message.logo).toEqual({ url: expect.any(String), verified: true });
});

test("the BIMI-Selector header picks which of the domain's logos shows", async () => {
  const { requests, receive, publish } = await withMailbox({ "/logo.svg": logo, "/other.svg": otherLogo });
  publish("lists.example.org", { dmarc: "v=DMARC1; p=reject;", bimi: "v=BIMI1; l=https://logos.example.net/logo.svg" });
  publish("lists.example.org", { selector: "sale", bimi: "v=BIMI1; l=https://logos.example.net/other.svg" });

  const plain = (await receive(newsletter("news@lists.example.org"))).message.logo;
  const sale = (await receive(newsletter("news@lists.example.org", { selector: "sale", subject: "Sale" }))).message.logo;

  expect(sale!.url).not.toBe(plain!.url);
  expect(requests.map(({ url }) => url)).toEqual(["https://logos.example.net/logo.svg", "https://logos.example.net/other.svg"]);
});

test("a domain's logo is looked up once a day, and the same logo from two domains is stored once", async () => {
  const { duva, requests, receive, publish } = await withMailbox({ "/logo.svg": logo });
  const bimi = "v=BIMI1; l=https://logos.example.net/logo.svg";
  publish("lists.example.org", { dmarc: "v=DMARC1; p=reject;", bimi });
  publish("shop.example.org", { dmarc: "v=DMARC1; p=reject;", bimi });

  const first = (await receive(newsletter("news@lists.example.org", { subject: "First" }))).message.logo;
  const again = (await receive(newsletter("news@lists.example.org", { subject: "Again" }))).message.logo;
  const shop = (await receive(newsletter("news@shop.example.org", { subject: "Shop" }))).message.logo;
  expect(requests).toHaveLength(2);
  await duva.clock(new Date(Date.now() + 25 * 3600_000));
  const tomorrow = (await receive(newsletter("news@lists.example.org", { subject: "Tomorrow" }))).message.logo;

  expect(requests).toHaveLength(3);
  expect(new Set([first, again, shop, tomorrow].map((each) => each!.url)).size).toBe(1);
});

test("a logo that isn't SVG Tiny PS, or can't be fetched safely, shows no logo, and the mail arrives all the same", async () => {
  const svg = (inside: string, root = 'xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny-ps"') => `<svg ${root}><title>Example</title>${inside}</svg>`;
  const { duva, receive, publish } = await withMailbox({
    "/script.svg": svg("<script>alert(1)</script>"),
    "/handler.svg": svg('<rect width="1" height="1" onclick="alert(1)"/>'),
    "/external.svg": svg('<use xlink:href="https://logos.example.net/more.svg#a"/>', 'xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.2" baseProfile="tiny-ps"'),
    "/image.svg": svg('<image width="1" height="1" href="#a"/>'),
    "/full.svg": '<svg xmlns="http://www.w3.org/2000/svg" version="1.1"><title>Example</title></svg>',
    "/untitled.svg": '<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny-ps"><rect width="1" height="1"/></svg>',
    "/large.svg": svg(`<desc>${"x".repeat(40_000)}</desc>`),
    "/never.svg": () => new Promise<Response>(() => {}),
  });
  const cases = ["script", "handler", "external", "image", "full", "untitled", "large", "missing", "never"];
  const records: Record<string, string> = { ...Object.fromEntries(cases.map((name) => [name, `v=BIMI1; l=https://logos.example.net/${name}.svg`])), http: "v=BIMI1; l=http://logos.example.net/logo.svg", declined: "v=BIMI1; l=;", private: "v=BIMI1; l=https://inside.example.net/logo.svg" };
  await duva.webServer("inside.example.net", { addresses: ["10.0.0.7"], answer: () => new Response(logo) });
  publish("lists.example.org", { dmarc: "v=DMARC1; p=reject;" });
  for (const [selector, bimi] of Object.entries(records)) publish("lists.example.org", { selector, bimi });

  const logos: Record<string, unknown> = {};
  for (const selector of Object.keys(records)) {
    const { message } = await receive(newsletter("news@lists.example.org", { selector, subject: selector }));
    expect(message.subject).toBe(selector);
    logos[selector] = message.logo;
  }

  expect(Object.values(logos).filter((each) => each !== undefined)).toEqual([]);
}, 60_000);

test("a logo is written out again with nothing but the elements and attributes Duva read", async () => {
  const { duva, receive, publish } = await withMailbox({
    "/logo.svg": `<?xml version="1.0"?>\n<!-- Made with an editor -->\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:editor="https://editor.example" version="1.2" baseProfile="tiny-ps" editor:version="3"><title>Ex &amp; Co</title><metadata><editor:doc>x</editor:doc></metadata><rect width="2" height="2" fill="url(#g)"/></svg>`,
  });
  publish("lists.example.org", { dmarc: "v=DMARC1; p=reject;", bimi: "v=BIMI1; l=https://logos.example.net/logo.svg" });

  const { message } = await receive(newsletter("news@lists.example.org"));

  expect(await (await duva.download(message.logo!.url)).text()).toBe(
    `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny-ps"><title>Ex &amp; Co</title><rect width="2" height="2" fill="url(#g)"></rect></svg>`,
  );
});

test("an agent's mail from the organization's domain keeps the agent's mark, while a human's from there shows the domain's logo", async () => {
  const { receive, publish } = await withMailbox({ "/logo.svg": logo });
  publish("example.com", { dmarc: "v=DMARC1; p=reject;", bimi: "v=BIMI1; l=https://logos.example.net/logo.svg" });

  const agents = (await receive(newsletter("iris@example.com", { subject: "From Iris", headers: ["Duva-Agent: Iris, for Grace"] }))).message;
  const humans = (await receive(newsletter("ada@example.com", { subject: "From Ada" }))).message;

  expect(agents.fromAgent).toBe(true);
  expect(agents.logo).toBeUndefined();
  expect(humans.logo).toEqual({ url: expect.any(String), verified: false });
});

test("a logo URL that leads to no logo is not found", async () => {
  const { duva } = await withMailbox();

  const served = await duva.download("http://duva.test/download/logos/00000000-0000-4000-8000-000000000000");

  expect(served.status).toBe(404);
});
