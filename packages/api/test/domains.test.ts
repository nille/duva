import type { components } from "@duva/openapi";
import PostalMime from "postal-mime";
import { expect, test } from "vitest";
import { type Duva, startDuva } from "./harness.ts";

/**
 * A deployment in eu-north-1 on example.com, its first domain, where ada, the first admin, has
 * grace as another human, with a mailbox at grace@example.com that lets every sender in.
 */
async function withGrace(options: Parameters<typeof startDuva>[0] = {}) {
  const duva = await startDuva({ domain: "example.com", admin: "ada@example.org", humans: ["grace@example.org"], ...options });
  const ada = duva.signIn("ada@example.org");
  const grace = duva.signIn("grace@example.org");
  const { data: me } = await grace.GET("/whoami");
  const { data: mailbox } = await ada.POST("/mailboxes", { body: { owner: me!.id, address: "grace@example.com" } });
  const graces = { path: { mailbox: mailbox!.id } };
  await grace.PATCH("/mailboxes/{mailbox}/screener", { params: graces, body: { on: false } });
  return { duva, ada, grace, mailbox: mailbox!, graces };
}

const message = (to: string, subject = "Hello") => `From: linus@example.net\r\nTo: ${to}\r\nSubject: ${subject}\r\nMessage-ID: <${subject}@example.net>\r\n\r\nHej.\r\n`;

/** Puts every record the domain lists in DNS, as its admin does at its DNS provider. */
async function addRecords(duva: Duva, ada: ReturnType<Duva["signIn"]>, domain: string) {
  const { data } = await ada.GET("/domains/{domain}", { params: { path: { domain } } });
  for (const { type, name, value } of data!.records) duva.dnsRecord(type, name, [value]);
}

test("an admin adds a domain, which gets an SES identity with DKIM and its MAIL FROM domain, and lists the DNS records it needs, all missing", async () => {
  const { duva, ada } = await withGrace();

  const { response, data } = await ada.POST("/domains", { body: { domain: "Example.NET" } });

  expect(response.status).toBe(201);
  const identity = duva.emailIdentities().find(({ domain }) => domain === "example.net");
  expect(identity).toEqual({ domain: "example.net", configurationSet: "duva-sending", mailFromDomain: "mail.example.net", dkimTokens: expect.any(Array) });
  const [one, two, three] = identity!.dkimTokens;
  expect(data).toEqual({
    domain: "example.net",
    kind: "standalone",
    signIn: false,
    ses: { verified: false, dkim: "pending", mailFrom: "pending" },
    records: [
      { purpose: "receiving", type: "MX", name: "example.net", value: "10 inbound-smtp.eu-north-1.amazonaws.com", status: "missing" },
      { purpose: "DKIM", type: "CNAME", name: `${one}._domainkey.example.net`, value: `${one}.dkim.amazonses.com`, status: "missing" },
      { purpose: "DKIM", type: "CNAME", name: `${two}._domainkey.example.net`, value: `${two}.dkim.amazonses.com`, status: "missing" },
      { purpose: "DKIM", type: "CNAME", name: `${three}._domainkey.example.net`, value: `${three}.dkim.amazonses.com`, status: "missing" },
      { purpose: "MAIL FROM", type: "MX", name: "mail.example.net", value: "10 feedback-smtp.eu-north-1.amazonses.com", status: "missing" },
      { purpose: "MAIL FROM", type: "TXT", name: "mail.example.net", value: "v=spf1 include:amazonses.com ~all", status: "missing" },
      { purpose: "DMARC", type: "TXT", name: "_dmarc.example.net", value: "v=DMARC1; p=none;", status: "missing" },
    ],
  });
});

test("each record shows as found once DNS has it, and as verified once SES has verified what it is for", async () => {
  const { duva, ada } = await withGrace();
  const { data: added } = await ada.POST("/domains", { body: { domain: "example.net" } });
  const [receiving, dkim1, dkim2, dkim3, mailFromMx, spf] = (added as components["schemas"]["Domain"]).records;
  const params = { path: { domain: "example.net" } };

  duva.dnsRecord("MX", receiving!.name, [receiving!.value]);
  duva.dnsRecord("CNAME", dkim1!.name, [dkim1!.value]);
  duva.dnsRecord("TXT", spf!.name, ["v=spf1 -all"]);
  const { data: partly } = await ada.GET("/domains/{domain}", { params });
  duva.dnsRecord("CNAME", dkim2!.name, [dkim2!.value]);
  duva.dnsRecord("CNAME", dkim3!.name, [dkim3!.value]);
  duva.dnsRecord("MX", mailFromMx!.name, [mailFromMx!.value]);
  duva.dnsRecord("TXT", spf!.name, [spf!.value]);
  const { data: verified } = await ada.GET("/domains/{domain}", { params });

  expect(partly?.records.map(({ status, found }) => ({ status, found }))).toEqual([
    { status: "found", found: undefined },
    { status: "found", found: undefined },
    { status: "missing", found: undefined },
    { status: "missing", found: undefined },
    { status: "missing", found: undefined },
    { status: "missing", found: ["v=spf1 -all"] },
    { status: "missing", found: undefined },
  ]);
  expect(partly?.ses).toEqual({ verified: false, dkim: "pending", mailFrom: "pending" });
  // SES never verifies the receiving or DMARC records.
  expect(verified?.records.map(({ status }) => status)).toEqual(["found", "verified", "verified", "verified", "verified", "verified", "missing"]);
  expect(verified?.ses).toEqual({ verified: true, dkim: "verified", mailFrom: "verified" });
});

test("records SES has verified show as verified even when Duva's lookup doesn't find them, as when DNS answers from a stale cache", async () => {
  // SES verified the first domain at deploy, and the stand-in's DNS has none of its records.
  const { ada } = await withGrace();

  const { data } = await ada.GET("/domains/{domain}", { params: { path: { domain: "example.com" } } });

  expect(data?.records.map(({ purpose, status }) => `${purpose} ${status}`)).toEqual([
    "receiving missing",
    "DKIM verified",
    "DKIM verified",
    "DKIM verified",
    "MAIL FROM verified",
    "MAIL FROM verified",
    "DMARC missing",
  ]);
});

test("a record DNS answers with another value shows as missing, with what DNS has, even once SES has verified what it is for", async () => {
  // SES verified the first domain's MAIL FROM domain, which it checks by the MX record alone.
  const { duva, ada } = await withGrace();
  duva.dnsRecord("TXT", "mail.example.com", ["v=spf1 -all"]);

  const { data } = await ada.GET("/domains/{domain}", { params: { path: { domain: "example.com" } } });

  expect(data?.records.find(({ purpose, type }) => purpose === "MAIL FROM" && type === "TXT")).toMatchObject({ status: "missing", found: ["v=spf1 -all"] });
});

test("an admin lists the organization's domains, the first one included, in alphabetical order", async () => {
  const { ada } = await withGrace();
  await ada.POST("/domains", { body: { domain: "example.net" } });
  await ada.POST("/domains", { body: { domain: "example.org" } });

  const { data } = await ada.GET("/domains");

  expect(data?.domains.map(({ domain, kind, signIn, ses }) => ({ domain, kind, signIn, verified: ses.verified }))).toEqual([
    { domain: "example.com", kind: "standalone", signIn: true, verified: true },
    { domain: "example.net", kind: "standalone", signIn: false, verified: false },
    { domain: "example.org", kind: "standalone", signIn: false, verified: false },
  ]);
});

test("mailboxes get addresses on any standalone domain, and mail to them arrives", async () => {
  const { duva, ada, grace, mailbox, graces } = await withGrace();
  await ada.POST("/domains", { body: { domain: "example.net" } });

  const { response } = await ada.POST("/addresses", { body: { address: "grace@example.net", mailbox: mailbox.id } });

  expect(response.status).toBe(201);
  expect((await duva.receive(message("grace+news@example.net"), { to: ["grace+news@example.net"] })).refused).toEqual([]);
  expect((await grace.GET("/mailboxes/{mailbox}/threads", { params: graces })).data?.threads).toHaveLength(1);
});

test("mail from an address on any of the organization's domains, with DMARC passing, skips the Screener", async () => {
  const { duva, ada, grace, graces } = await withGrace();
  await ada.POST("/domains", { body: { domain: "example.net" } });
  await grace.PATCH("/mailboxes/{mailbox}/screener", { params: graces, body: { on: true } });

  await duva.receive("From: linus@example.net\r\nTo: grace@example.com\r\nSubject: Hi\r\n\r\nHej.\r\n", { to: ["grace@example.com"] });

  expect((await grace.GET("/mailboxes/{mailbox}/threads", { params: graces })).data?.threads).toHaveLength(1);
});

test("an alias domain mirrors every address of its standalone domain, later ones too, and mail to them reaches the same mailboxes", async () => {
  const { duva, ada, grace, mailbox, graces } = await withGrace();

  const { response, data } = await ada.POST("/domains", { body: { domain: "example.se", aliasOf: "example.com" } });
  await ada.POST("/addresses", { body: { address: "support@example.com", mailbox: mailbox.id } });

  expect(response.status).toBe(201);
  expect(data).toMatchObject({ domain: "example.se", kind: "alias", aliasOf: "example.com", signIn: false });
  expect(duva.receiptRules().flatMap(({ Recipients = [] }) => Recipients).sort()).toEqual(["grace@example.com", "grace@example.se", "support@example.com", "support@example.se"]);
  const { refused } = await duva.receive(message("Grace@example.se"), { to: ["Grace@example.se", "support+orders@example.se", "nobody@example.se"] });
  expect(refused).toEqual(["nobody@example.se"]);
  // One copy, for the first of the mailbox's addresses it came to.
  const { data: list } = await grace.GET("/mailboxes/{mailbox}/threads", { params: graces });
  expect(list?.threads).toHaveLength(1);
  // The alias domain's addresses are its standalone domain's, so the organization lists none of its own.
  expect((await ada.GET("/addresses")).data?.addresses.map(({ address }) => address)).toEqual(["grace@example.com", "support@example.com"]);
});

test("an alias domain mirrors a group's address too, and mail to it reaches the group's members", async () => {
  const { duva, ada, grace, graces } = await withGrace();
  await ada.POST("/groups", { body: { address: "team@example.com", members: ["grace@example.com"] } });

  await ada.POST("/domains", { body: { domain: "example.se", aliasOf: "example.com" } });

  expect(duva.receiptRules().flatMap(({ Recipients = [] }) => Recipients)).toContain("team@example.se");
  expect((await duva.receive(message("team@example.se"), { to: ["team@example.se"] })).refused).toEqual([]);
  const { data: list } = await grace.GET("/mailboxes/{mailbox}/threads", { params: graces });
  expect(list?.threads).toHaveLength(1);
});

test("a group takes members on any of the organization's domains, its alias domains' included", async () => {
  const { ada, mailbox } = await withGrace();
  await ada.POST("/domains", { body: { domain: "example.net" } });
  await ada.POST("/domains", { body: { domain: "example.se", aliasOf: "example.com" } });
  await ada.POST("/addresses", { body: { address: "grace@example.net", mailbox: mailbox.id } });

  const known = await ada.POST("/groups", { body: { address: "team@example.com", members: ["grace@example.net", "grace@example.se"] } });
  const unknown = await ada.POST("/groups", { body: { address: "crew@example.com", members: ["nobody@example.net"] } });

  expect(known.response.status).toBe(201);
  expect(unknown.response.status).toBe(400);
  expect(unknown.error?.message).toMatch(/nobody@example\.net isn't one of the organization's addresses/);
});

test("removing a domain deletes the groups on it, and takes its addresses out of every group", async () => {
  const { duva, ada, mailbox } = await withGrace();
  await ada.POST("/domains", { body: { domain: "example.net" } });
  await ada.POST("/addresses", { body: { address: "grace@example.net", mailbox: mailbox.id } });
  await ada.POST("/groups", { body: { address: "team@example.net", members: ["grace@example.com"] } });
  await ada.POST("/groups", { body: { address: "crew@example.com", members: ["grace@example.net", "grace@example.com"] } });

  const { data } = await ada.POST("/domains/{domain}/remove", { params: { path: { domain: "example.net" } }, body: {} });

  expect(data).toMatchObject({ addresses: [{ address: "grace@example.net", mailbox: mailbox.id }, { address: "team@example.net", group: true }] });
  expect((await ada.GET("/groups")).data?.groups.map(({ address, members }) => ({ address, members }))).toEqual([{ address: "crew@example.com", members: ["grace@example.com"] }]);
  expect((await duva.receive(message("team@example.net"), { to: ["team@example.net"] })).refused).toEqual(["team@example.net"]);
});

test("a reply to mail that came to an alias address goes out from that address", async () => {
  const { duva, ada, grace, graces } = await withGrace();
  await ada.POST("/domains", { body: { domain: "example.se", aliasOf: "example.com" } });
  await addRecords(duva, ada, "example.se");
  await duva.receive(message("grace@example.se"), { to: ["grace@example.se"] });
  const { data: list } = await grace.GET("/mailboxes/{mailbox}/threads", { params: graces });
  const { data: thread } = await grace.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { ...graces.path, thread: list!.threads[0]!.id } } });

  const { data: draft } = await grace.POST("/mailboxes/{mailbox}/drafts", { params: graces, body: { answers: thread!.messages[0]!.id, text: "Thanks." } });
  await grace.POST("/mailboxes/{mailbox}/drafts/{draft}/send", { params: { path: { ...graces.path, draft: draft!.id } } });

  expect(draft?.from).toBe("grace@example.se");
  expect(duva.sent()).toHaveLength(1);
  expect((await PostalMime.parse(duva.sent()[0]!)).from?.address).toBe("grace@example.se");
});

test("mail from a domain SES hasn't verified yet isn't sent, and says SES's reason", async () => {
  const { duva, ada, grace, graces } = await withGrace();
  await ada.POST("/domains", { body: { domain: "example.se", aliasOf: "example.com" } });
  await duva.receive(message("grace@example.se"), { to: ["grace@example.se"] });
  const { data: list } = await grace.GET("/mailboxes/{mailbox}/threads", { params: graces });
  const { data: thread } = await grace.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { ...graces.path, thread: list!.threads[0]!.id } } });
  const { data: draft } = await grace.POST("/mailboxes/{mailbox}/drafts", { params: graces, body: { answers: thread!.messages[0]!.id, text: "Thanks." } });

  await grace.POST("/mailboxes/{mailbox}/drafts/{draft}/send", { params: { path: { ...graces.path, draft: draft!.id } } });

  expect(duva.sent()).toEqual([]);
  const { data: sent } = await grace.GET("/mailboxes/{mailbox}/drafts/{draft}", { params: { path: { ...graces.path, draft: draft!.id } } });
  expect(sent?.send).toMatchObject({ state: "failed", reason: expect.stringMatching(/not verified.*grace@example\.se/) });
});

test("an address on an alias domain is refused, since the alias domain mirrors its standalone domain's", async () => {
  const { ada, mailbox } = await withGrace();
  await ada.POST("/domains", { body: { domain: "example.se", aliasOf: "example.com" } });

  const { response, error } = await ada.POST("/addresses", { body: { address: "support@example.se", mailbox: mailbox.id } });

  expect(response.status).toBe(400);
  expect(error?.message).toMatch(/alias domain.*support@example\.com/);
});

test("an address an alias domain mirrors isn't removed on its own, so removing it answers 404", async () => {
  const { duva, ada } = await withGrace();
  await ada.POST("/domains", { body: { domain: "example.se", aliasOf: "example.com" } });

  const { response } = await ada.DELETE("/addresses/{address}", { params: { path: { address: "grace@example.se" } } });

  expect(response.status).toBe(404);
  expect((await duva.receive(message("grace@example.se"), { to: ["grace@example.se"] })).refused).toEqual([]);
});

test("an alias domain mirrors only a standalone domain the organization has", async () => {
  const { ada } = await withGrace();
  await ada.POST("/domains", { body: { domain: "example.se", aliasOf: "example.com" } });

  const ofAlias = await ada.POST("/domains", { body: { domain: "example.nu", aliasOf: "example.se" } });
  const ofUnknown = await ada.POST("/domains", { body: { domain: "example.nu", aliasOf: "example.dk" } });

  expect([ofAlias, ofUnknown].map(({ response }) => response.status)).toEqual([400, 400]);
  expect(ofAlias.error?.message).toMatch(/standalone domains, example\.com\./);
});

test.each([
  ["that isn't a domain", { domain: "example" }],
  ["the organization has", { domain: "EXAMPLE.com" }],
  ["with an SES identity someone else created", { domain: "theirs.example" }],
])("a domain %s is refused, and changes nothing", async (_, body) => {
  const { duva, ada } = await withGrace({ othersIdentities: ["theirs.example"] });
  const identities = duva.emailIdentities();
  const { data: before } = await ada.GET("/organization/changes");

  const { response, error } = await ada.POST("/domains", { body });

  expect(response.status).toBe(body.domain === "example" ? 400 : 409);
  expect(error?.message).toMatch(/domain|SES identity/);
  expect(duva.emailIdentities()).toEqual(identities);
  expect((await ada.GET("/organization/changes", { params: { query: { after: before!.position } } })).data?.changes).toEqual([]);
});

test("removing a domain runs dry first, listing its alias domains, the addresses that stop working and the mailboxes left without one, and removes nothing", async () => {
  const { duva, ada, grace, mailbox } = await withGrace();
  const { data: me } = await grace.GET("/whoami");
  await ada.POST("/domains", { body: { domain: "example.net" } });
  await ada.POST("/domains", { body: { domain: "example.nu", aliasOf: "example.net" } });
  await ada.POST("/addresses", { body: { address: "grace@example.net", mailbox: mailbox.id } });
  const { data: other } = await ada.POST("/mailboxes", { body: { owner: me!.id, address: "news@example.net" } });

  const { data } = await ada.POST("/domains/{domain}/remove", { params: { path: { domain: "example.net" } }, body: { dryRun: true } });

  expect(data).toEqual({
    domains: ["example.net", "example.nu"],
    addresses: [
      { address: "grace@example.net", mailbox: mailbox.id },
      { address: "news@example.net", mailbox: other!.id },
      { address: "grace@example.nu", mailbox: mailbox.id },
      { address: "news@example.nu", mailbox: other!.id },
    ],
    mailboxesLeftWithoutAddress: [other!.id],
    removed: false,
  });
  expect((await ada.GET("/domains")).data?.domains.map(({ domain }) => domain)).toEqual(["example.com", "example.net", "example.nu"]);
  expect((await duva.receive(message("news@example.nu"), { to: ["news@example.nu"] })).refused).toEqual([]);
});

test("removing a standalone domain removes its addresses, its alias domains and their identities, and the mail stays", async () => {
  const { duva, ada, grace, mailbox, graces } = await withGrace();
  await ada.POST("/domains", { body: { domain: "example.net" } });
  await ada.POST("/domains", { body: { domain: "example.nu", aliasOf: "example.net" } });
  await ada.POST("/addresses", { body: { address: "grace@example.net", mailbox: mailbox.id } });
  await ada.PATCH("/mailboxes/{mailbox}", { params: graces, body: { defaultAddress: "grace@example.net" } });
  await duva.receive(message("grace@example.nu"), { to: ["grace@example.nu"] });

  const { response, data } = await ada.POST("/domains/{domain}/remove", { params: { path: { domain: "example.net" } }, body: {} });

  expect(response.status).toBe(200);
  expect(data).toMatchObject({ removed: true });
  expect((await ada.GET("/domains")).data?.domains.map(({ domain }) => domain)).toEqual(["example.com"]);
  expect(duva.emailIdentities().map(({ domain }) => domain)).toEqual(["example.com"]);
  expect(duva.receiptRules().flatMap(({ Recipients = [] }) => Recipients)).toEqual(["grace@example.com"]);
  expect((await duva.receive(message("grace@example.net", "Later"), { to: ["grace@example.net", "grace@example.nu"] })).refused).toEqual(["grace@example.net", "grace@example.nu"]);
  expect((await grace.GET("/mailboxes/{mailbox}/threads", { params: graces })).data?.threads).toHaveLength(1);
  expect((await grace.GET("/mailboxes/{mailbox}", { params: graces })).data).toMatchObject({ defaultAddress: "grace@example.com", addresses: ["grace@example.com"] });
});

test("removing an alias domain removes only what it mirrors", async () => {
  const { duva, ada, grace, graces } = await withGrace();
  await ada.POST("/domains", { body: { domain: "example.se", aliasOf: "example.com" } });

  const { data } = await ada.POST("/domains/{domain}/remove", { params: { path: { domain: "example.se" } }, body: {} });

  expect(data).toMatchObject({ domains: ["example.se"], addresses: [{ address: "grace@example.se" }], mailboxesLeftWithoutAddress: [], removed: true });
  expect((await duva.receive(message("grace@example.se"), { to: ["grace@example.se", "grace@example.com"] })).refused).toEqual(["grace@example.se"]);
  expect((await grace.GET("/mailboxes/{mailbox}", { params: graces })).data?.addresses).toEqual(["grace@example.com"]);
  expect(duva.emailIdentities().map(({ domain }) => domain)).toEqual(["example.com"]);
});

test("removing a domain the organization doesn't have answers 404", async () => {
  const { ada } = await withGrace();

  const { response, error } = await ada.POST("/domains/{domain}/remove", { params: { path: { domain: "example.net" } }, body: { dryRun: true } });

  expect(response.status).toBe(404);
  expect(error?.message).toMatch(/no domain "example.net"/);
});

test("the domain sign-in codes come from can't be removed, nor its standalone domain, until an admin chooses another", async () => {
  const { ada } = await withGrace();
  await ada.POST("/domains", { body: { domain: "example.se", aliasOf: "example.com" } });

  const first = await ada.POST("/domains/{domain}/remove", { params: { path: { domain: "example.com" } }, body: {} });

  expect(first.response.status).toBe(409);
  expect(first.error?.message).toMatch(/Sign-in codes come from example\.com.*Choose another domain/);
  expect((await ada.GET("/domains")).data?.domains.map(({ domain }) => domain)).toEqual(["example.com", "example.se"]);
});

test("sign-in codes come only from a domain SES has verified", async () => {
  const { duva, ada } = await withGrace();
  await ada.POST("/domains", { body: { domain: "example.net" } });

  const { response, error } = await ada.PATCH("/domains/{domain}", { params: { path: { domain: "example.net" } }, body: { signIn: true } });

  expect(response.status).toBe(409);
  expect(error?.message).toMatch(/SES hasn't verified example\.net/);
  expect(duva.signInCodesFrom()).toBe("Duva <no-reply@example.com>");
});

test("an admin chooses another verified domain for sign-in codes, which changes Cognito's sender, and then the first domain can be removed", async () => {
  const { duva, ada } = await withGrace();
  await ada.POST("/domains", { body: { domain: "example.net" } });
  await addRecords(duva, ada, "example.net");

  const { response, data } = await ada.PATCH("/domains/{domain}", { params: { path: { domain: "example.net" } }, body: { signIn: true } });

  expect(response.status).toBe(200);
  expect(data).toMatchObject({ domain: "example.net", signIn: true });
  expect(duva.signInCodesFrom()).toBe("Duva <no-reply@example.net>");
  expect((await ada.GET("/domains")).data?.domains.map(({ domain, signIn }) => ({ domain, signIn }))).toEqual([
    { domain: "example.com", signIn: false },
    { domain: "example.net", signIn: true },
  ]);
  const removed = await ada.POST("/domains/{domain}/remove", { params: { path: { domain: "example.com" } }, body: {} });
  expect(removed.data).toMatchObject({ removed: true });
  expect(duva.emailIdentities().map(({ domain }) => domain)).toEqual(["example.net"]);
});

test("only an admin adds, lists, reads, changes and removes domains", async () => {
  const { duva, ada, grace } = await withGrace();
  await ada.POST("/domains", { body: { domain: "example.net" } });
  const { data: created } = await ada.POST("/agents", { body: { name: "Hermes" } });
  const hermes = duva.withKey(created!.key);
  const domain = { path: { domain: "example.net" } };

  for (const actor of [grace, hermes]) {
    const calls = [
      await actor.POST("/domains", { body: { domain: "example.org" } }),
      await actor.GET("/domains"),
      await actor.GET("/domains/{domain}", { params: domain }),
      await actor.PATCH("/domains/{domain}", { params: domain, body: { signIn: true } }),
      await actor.POST("/domains/{domain}/remove", { params: domain, body: {} }),
    ];
    expect(calls.map(({ response }) => response.status)).toEqual([403, 403, 403, 403, 403]);
  }
  expect((await ada.GET("/domains")).data?.domains.map(({ domain }) => domain)).toEqual(["example.com", "example.net"]);
});

test("adding, choosing and removing domains are in the organization's change feed, attributed to the admin", async () => {
  const { duva, ada, mailbox } = await withGrace();
  const { data: admin } = await ada.GET("/whoami");
  const { data: before } = await ada.GET("/organization/changes");

  await ada.POST("/domains", { body: { domain: "example.net" } });
  await ada.POST("/domains", { body: { domain: "example.se", aliasOf: "example.com" } });
  await addRecords(duva, ada, "example.net");
  await ada.PATCH("/domains/{domain}", { params: { path: { domain: "example.net" } }, body: { signIn: true } });
  await ada.POST("/domains/{domain}/remove", { params: { path: { domain: "example.com" } }, body: {} });

  const { data } = await ada.GET("/organization/changes", { params: { query: { after: before!.position } } });
  const change = (offset: number, details: object) => ({ position: before!.position + offset, at: expect.any(String), actor: admin?.id, ...details });
  expect(data?.changes).toEqual([
    change(1, { type: "domainAdded", domain: "example.net" }),
    change(2, { type: "domainAdded", domain: "example.se", aliasOf: "example.com" }),
    change(3, { type: "signInDomainChanged", domain: "example.net" }),
    change(4, { type: "addressRemoved", address: "grace@example.com", mailbox: mailbox.id }),
    change(5, { type: "defaultAddressChanged", mailbox: mailbox.id }),
    change(6, { type: "domainRemoved", domain: "example.com" }),
    change(7, { type: "domainRemoved", domain: "example.se" }),
  ]);
});

test("choosing the domain sign-in codes already come from records nothing", async () => {
  const { ada } = await withGrace();
  const { data: before } = await ada.GET("/organization/changes");

  const { response } = await ada.PATCH("/domains/{domain}", { params: { path: { domain: "example.com" } }, body: { signIn: true } });

  expect(response.status).toBe(200);
  expect((await ada.GET("/organization/changes", { params: { query: { after: before!.position } } })).data?.changes).toEqual([]);
});
