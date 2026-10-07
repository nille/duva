import { readFileSync } from "node:fs";
import PostalMime from "postal-mime";
import { expect, test } from "vitest";
import type { components } from "@duva/openapi";
import { startDuva } from "./harness.ts";

/** What a human admin's change to a domain's logo answers, which only an agent admin's waits for approval instead. */
type DomainLogo = components["schemas"]["DomainLogo"];

/** The tests' logo, square SVG Tiny PS, and the VMC the tests' Mark Verifying Authority issued for example.org carrying it. */
const logo = readFileSync(new URL("marks/logo.svg", import.meta.url), "utf8");
const otherLogo = readFileSync(new URL("marks/other-logo.svg", import.meta.url), "utf8");
const vmc = readFileSync(new URL("marks/vmc.pem", import.meta.url), "utf8");
const strangersVmc = readFileSync(new URL("marks/stranger.pem", import.meta.url), "utf8");

/** A logo as an editor exports it: wider than tall, with the editor's own namespace, metadata, a comment and a handler. */
const exported = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!-- Created with Inkscape -->
<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="200" height="100" viewBox="0 0 200 100" inkscape:version="1.3" onload="alert(1)">
  <metadata><rdf:RDF/></metadata>
  <rect width="200" height="100" fill="#0b5fff" inkscape:label="Background"/>
</svg>
`;

/** The exported logo as SVG Tiny PS: square, centred, titled with the domain, and without the editor's parts. */
const converted = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny-ps" viewBox="0 -50 200 200"><title>example.org</title><rect width="200" height="100" fill="#0b5fff"></rect></svg>
`;

/** A deployment on example.org, where Ada is the first admin, and Grace a human with her personal mailbox at grace@example.org. */
async function withDomain() {
  const duva = await startDuva({ domain: "example.org", admin: "ada@example.org", humans: ["grace@example.org"] });
  const ada = duva.signIn("ada@example.org");
  const grace = duva.signIn("grace@example.org");
  const { data: me } = await grace.GET("/whoami");
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: me!.id, address: "grace@example.org" } });
  const domain = { params: { path: { domain: "example.org" } } };
  const own = { params: { path: { mailbox: mailbox!.id } } };
  return { duva, ada, grace, graceId: me!.id, mailbox: mailbox!, domain, own };
}

test("an admin sets a domain's logo, which Duva converts to SVG Tiny PS and serves to anyone at a URL that stays the same", async () => {
  const { duva, ada, domain } = await withDomain();

  const { response, data: answer } = await ada.PUT("/domains/{domain}/logo", { ...domain, body: { svg: exported } });
  const data = answer as DomainLogo;

  expect(response.status).toBe(200);
  const url = data!.logo!.url;
  expect(url).toMatch(/^http.*\/bimi\/domains\/example\.org\.svg$/);
  expect(data).toEqual({
    domain: "example.org",
    logo: { url, svg: converted },
    record: { name: "default._bimi.example.org", value: `v=BIMI1; l=${url};`, status: "missing" },
    dmarcEnforced: false,
    selectors: [],
  });
  const served = await duva.download(url);
  expect(served.status).toBe(200);
  expect(served.headers.get("content-type")).toBe("image/svg+xml");
  expect(served.headers.get("content-security-policy")).toContain("sandbox");
  // Another logo shows within five minutes.
  expect(served.headers.get("cache-control")).toBe("public, max-age=300");
  expect(await served.text()).toBe(converted);

  const again = (await ada.PUT("/domains/{domain}/logo", { ...domain, body: { svg: otherLogo } })).data as DomainLogo;
  expect(again!.logo!.url).toBe(url);
  expect(await (await duva.download(url)).text()).toBe(otherLogo);
});

test("a logo that is square SVG Tiny PS already is served byte for byte, so a mark certificate issued for it matches", async () => {
  const { duva, ada, domain } = await withDomain();

  const data = (await ada.PUT("/domains/{domain}/logo", { ...domain, body: { svg: logo } })).data as DomainLogo;

  expect(data!.logo!.svg).toBe(logo);
  expect(await (await duva.download(data!.logo!.url)).text()).toBe(logo);
});

test("a logo Duva can't convert to SVG Tiny PS is refused, saying why", async () => {
  const { ada, domain } = await withDomain();
  const refusal = async (svg: string) => {
    const { response, error } = await ada.PUT("/domains/{domain}/logo", { ...domain, body: { svg } });
    expect(response.status).toBe(400);
    return error!.message;
  };

  expect(await refusal("�PNG\r\n\u001a\n\u0000\u0000\u0000\rIHDR")).toMatch(/isn't an SVG file.*PNG/);
  expect(await refusal('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><image href="logo.png"/></svg>')).toMatch(/<image>.*picture/);
  expect(await refusal('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><style>rect{fill:red}</style><rect width="10" height="10"/></svg>')).toMatch(/<style>.*presentation attributes/);
  expect(await refusal('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="url(https://tracker.example/x)"/></svg>')).toMatch(/refers to something outside it/);
  expect(await refusal('<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>')).toMatch(/doesn't say its size.*viewBox/);
  const path = `<path d="${"M1.234567 2.345678 ".repeat(2000)}"/>`;
  expect(await refusal(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${path}</svg>`)).toMatch(/KB as SVG Tiny PS, and BIMI allows 32 KB/);

  const { data } = await ada.GET("/domains/{domain}/logo", domain);
  expect(data).not.toHaveProperty("logo");
});

test("the domain's BIMI record shows missing, found while DNS gives another logo, and matches once it gives this one", async () => {
  const { duva, ada, domain } = await withDomain();
  const set = (await ada.PUT("/domains/{domain}/logo", { ...domain, body: { svg: logo } })).data as DomainLogo;
  const value = `v=BIMI1; l=${set!.logo!.url};`;

  duva.dnsRecord("TXT", "default._bimi.example.org", ["v=BIMI1; l=https://elsewhere.example/logo.svg;"]);
  const { data: found } = await ada.GET("/domains/{domain}/logo", domain);
  expect(found!.record).toEqual({ name: "default._bimi.example.org", value, status: "found", found: ["v=BIMI1; l=https://elsewhere.example/logo.svg;"] });

  duva.dnsRecord("TXT", "default._bimi.example.org", [`v=BIMI1;l=${set!.logo!.url}`]);
  const { data: matches } = await ada.GET("/domains/{domain}/logo", domain);
  expect(matches!.record).toEqual({ name: "default._bimi.example.org", value, status: "matches" });
});

test("the domain's logo says whether its DMARC policy enforces DMARC, which BIMI needs", async () => {
  const { duva, ada, domain } = await withDomain();
  const enforced = async () => (await ada.GET("/domains/{domain}/logo", domain)).data!.dmarcEnforced;

  expect(await enforced()).toBe(false);
  duva.dnsRecord("TXT", "_dmarc.example.org", ["v=DMARC1; p=none;"]);
  expect(await enforced()).toBe(false);
  duva.dnsRecord("TXT", "_dmarc.example.org", ["v=DMARC1; p=quarantine; pct=50;"]);
  expect(await enforced()).toBe(false);
  duva.dnsRecord("TXT", "_dmarc.example.org", ["v=DMARC1; p=reject;"]);
  expect(await enforced()).toBe(true);
});

test("a VMC that vouches for the domain and its logo is served beside it and given in the record, and a logo set again drops it", async () => {
  const { duva, ada, domain } = await withDomain();
  const set = (await ada.PUT("/domains/{domain}/logo", { ...domain, body: { svg: logo } })).data as DomainLogo;

  const { response, data: answer } = await ada.PUT("/domains/{domain}/logo/certificate", { ...domain, body: { pem: vmc } });
  const data = answer as DomainLogo;

  expect(response.status).toBe(200);
  const certificate = data!.certificate!.url;
  expect(data!.certificate).toEqual({ url: expect.stringMatching(/\/bimi\/domains\/example\.org\.pem$/), hosted: true });
  expect(data!.record!.value).toBe(`v=BIMI1; l=${set!.logo!.url}; a=${certificate};`);
  const served = await duva.download(certificate);
  expect(served.headers.get("content-type")).toBe("application/pem-certificate-chain");
  expect(await served.text()).toBe(vmc);

  const again = (await ada.PUT("/domains/{domain}/logo", { ...domain, body: { svg: otherLogo } })).data as DomainLogo;
  expect(again).not.toHaveProperty("certificate");
  expect(again!.record!.value).toBe(`v=BIMI1; l=${set!.logo!.url};`);
  expect((await duva.download(certificate)).status).toBe(403);
});

test("a certificate that doesn't vouch for the domain's logo is refused, and one given by URL is taken as given", async () => {
  const { ada, domain } = await withDomain();
  const certificate = (body: { url?: string; pem?: string }) => ada.PUT("/domains/{domain}/logo/certificate", { ...domain, body });

  expect((await certificate({ url: "https://example.org/vmc.pem" })).response.status).toBe(409);
  await ada.PUT("/domains/{domain}/logo", { ...domain, body: { svg: otherLogo } });
  const { response: otherLogos, error } = await certificate({ pem: vmc });
  expect(otherLogos.status).toBe(400);
  expect(error!.message).toMatch(/doesn't vouch for example\.org's logo/);
  await ada.PUT("/domains/{domain}/logo", { ...domain, body: { svg: logo } });
  expect((await certificate({ pem: strangersVmc })).response.status).toBe(400);
  expect((await certificate({ url: "http://example.org/vmc.pem" })).response.status).toBe(400);

  const data = (await certificate({ url: "https://example.org/vmc.pem" })).data as DomainLogo;
  expect(data!.certificate).toEqual({ url: "https://example.org/vmc.pem", hosted: false });
  expect(data!.record!.value).toMatch(/; a=https:\/\/example\.org\/vmc\.pem;$/);

  const removed = (await ada.DELETE("/domains/{domain}/logo/certificate", domain)).data as DomainLogo;
  expect(removed).not.toHaveProperty("certificate");
  expect(removed!.logo!.svg).toBe(logo);
});

test("removing a domain's logo stops Duva serving it", async () => {
  const { duva, ada, domain } = await withDomain();
  const set = (await ada.PUT("/domains/{domain}/logo", { ...domain, body: { svg: logo } })).data as DomainLogo;
  await ada.PUT("/domains/{domain}/logo/certificate", { ...domain, body: { pem: vmc } });

  const { response, data } = await ada.DELETE("/domains/{domain}/logo", domain);

  expect(response.status).toBe(200);
  expect(data).toEqual({ domain: "example.org", dmarcEnforced: false, selectors: [] });
  expect((await duva.download(set!.logo!.url)).status).toBe(403);
});

test("only admins set, read and remove a domain's logo", async () => {
  const { ada, grace, domain } = await withDomain();
  await ada.PUT("/domains/{domain}/logo", { ...domain, body: { svg: logo } });

  expect((await grace.PUT("/domains/{domain}/logo", { ...domain, body: { svg: otherLogo } })).response.status).toBe(403);
  expect((await grace.GET("/domains/{domain}/logo", domain)).response.status).toBe(403);
  expect((await grace.DELETE("/domains/{domain}/logo", domain)).response.status).toBe(403);
  expect((await ada.GET("/domains/{domain}/logo", { params: { path: { domain: "example.net" } } })).response.status).toBe(404);
});

test("a human sets their mailbox's own logo, and Duva gives it a selector and lists the record its domain needs, also on the admin's domain", async () => {
  const { duva, ada, grace, graceId, mailbox, own, domain } = await withDomain();

  const { response, data } = await grace.PUT("/mailboxes/{mailbox}/logo", { ...own, body: { svg: logo } });

  expect(response.status).toBe(200);
  const url = data!.logo!.url;
  expect(url).toMatch(/\/bimi\/selectors\/grace\.svg$/);
  expect(data).toEqual({
    mailbox: mailbox.id,
    selector: "grace",
    logo: { url, svg: logo },
    records: [{ name: "grace._bimi.example.org", value: `v=BIMI1; l=${url};`, status: "missing" }],
  });
  expect(await (await duva.download(url)).text()).toBe(logo);

  duva.dnsRecord("TXT", "grace._bimi.example.org", [`v=BIMI1; l=${url};`]);
  const { data: listed } = await ada.GET("/domains/{domain}/logo", domain);
  expect(listed!.selectors).toEqual([
    {
      selector: "grace",
      mailbox: mailbox.id,
      owner: { id: graceId, kind: "human", email: "grace@example.org", admin: false },
      logo: { url, svg: logo },
      record: { name: "grace._bimi.example.org", value: `v=BIMI1; l=${url};`, status: "matches" },
    },
  ]);
});

test("a mailbox whose selector another mailbox has gets one of its own, and keeps it when its logo is set again", async () => {
  const { ada, grace, own } = await withDomain();
  await ada.POST("/domains", { body: { domain: "example.net" } });
  const { data: me } = await ada.GET("/whoami");
  const { data: adas } = await ada.POST("/mailboxes", { body: { owner: me!.id, address: "grace@example.net" } });
  await grace.PUT("/mailboxes/{mailbox}/logo", { ...own, body: { svg: logo } });

  const { data } = await ada.PUT("/mailboxes/{mailbox}/logo", { params: { path: { mailbox: adas!.id } }, body: { svg: logo } });

  expect(data!.selector).toBe("grace-2");
  expect(data!.records.map(({ name }) => name)).toEqual(["grace-2._bimi.example.net"]);
  await grace.DELETE("/mailboxes/{mailbox}/logo", own);
  const { data: again } = await grace.PUT("/mailboxes/{mailbox}/logo", { ...own, body: { svg: otherLogo } });
  expect(again!.selector).toBe("grace");
});

test("only the human who owns a mailbox sets its logo, so an agent's mailbox shows the domain's", async () => {
  const { ada, grace, mailbox, duva } = await withDomain();
  const { data: created } = await ada.POST("/agents", { body: { name: "Hermes" } });
  const { data: hermesBox } = await ada.POST("/mailboxes", { body: { owner: created!.agent.id, address: "hermes@example.org" } });
  const hermes = duva.withKey(created!.key);

  expect((await ada.PUT("/mailboxes/{mailbox}/logo", { params: { path: { mailbox: mailbox.id } }, body: { svg: logo } })).response.status).toBe(403);
  expect((await hermes.PUT("/mailboxes/{mailbox}/logo", { params: { path: { mailbox: hermesBox!.id } }, body: { svg: logo } })).response.status).toBe(403);
  expect((await ada.PUT("/mailboxes/{mailbox}/logo", { params: { path: { mailbox: hermesBox!.id } }, body: { svg: logo } })).response.status).toBe(403);
  expect((await grace.GET("/mailboxes/{mailbox}/logo", { params: { path: { mailbox: "nope" } } })).response.status).toBe(404);
});

test("mail from a mailbox with its own logo names its selector in BIMI-Selector once DNS has its record, and not after its logo is removed", async () => {
  const { duva, grace, own } = await withDomain();
  const send = async (subject: string) => {
    const { data: draft } = await grace.POST("/mailboxes/{mailbox}/drafts", { ...own, body: { to: ["someone@example.net"], subject, text: "Hello." } });
    await grace.POST("/mailboxes/{mailbox}/drafts/{draft}/send", { params: { path: { ...own.params.path, draft: draft!.id } } });
    const mail = await PostalMime.parse(duva.sent().at(-1)!);
    return mail.headers.find(({ key }) => key === "bimi-selector")?.value;
  };
  const { data } = await grace.PUT("/mailboxes/{mailbox}/logo", { ...own, body: { svg: logo } });

  expect(await send("Before the record")).toBeUndefined();
  duva.dnsRecord("TXT", "grace._bimi.example.org", [`v=BIMI1; l=${data!.logo!.url};`]);
  expect(await send("With the record")).toBe("v=BIMI1; s=grace;");
  await grace.DELETE("/mailboxes/{mailbox}/logo", own);
  expect(await send("Without a logo")).toBeUndefined();
});

test("removing a domain and deleting a mailbox stop Duva serving their logos", async () => {
  const { duva, ada, graceId, grace, own } = await withDomain();
  await ada.POST("/domains", { body: { domain: "example.net" } });
  const net = { params: { path: { domain: "example.net" } } };
  const domainLogo = (await ada.PUT("/domains/{domain}/logo", { ...net, body: { svg: logo } })).data as DomainLogo;
  const { data: mailboxLogo } = await grace.PUT("/mailboxes/{mailbox}/logo", { ...own, body: { svg: logo } });

  await ada.POST("/domains/{domain}/remove", { ...net, body: { dryRun: false } });
  await ada.POST("/humans/{human}/remove", { params: { path: { human: graceId } }, body: { delete: [own.params.path.mailbox] } });

  expect((await duva.download(domainLogo!.logo!.url)).status).toBe(403);
  expect((await duva.download(mailboxLogo!.logo!.url)).status).toBe(403);
});
