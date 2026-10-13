// These tests drive duva deploy's logic, with AWS and DNS replaced by in-memory stand-ins.
import { describe, expect, test } from "vitest";
import { deployDuva, type Aws, type Dns, type StackOutputs } from "../src/deployment.ts";

/** The first admin's address, on a domain other than the deployment's. */
const admin = "ada@example.org";
/** The first admin's recovery address, outside the deployment's domain. */
const recovery = "ada@elsewhere.example";

test("the first deploy prints every record the domain needs, none of them live yet", async () => {
  const world = newWorld();

  const report = await deployDuva({ ...world, admin, recovery, domain: "duva.example.com" });

  expect(report.domain.records).toEqual([
    { purpose: "receiving", type: "MX", name: "duva.example.com", value: "10 inbound-smtp.eu-north-1.amazonaws.com", status: "missing" },
    { purpose: "DKIM", type: "CNAME", name: "tok1._domainkey.duva.example.com", value: "tok1.dkim.amazonses.com", status: "missing" },
    { purpose: "DKIM", type: "CNAME", name: "tok2._domainkey.duva.example.com", value: "tok2.dkim.amazonses.com", status: "missing" },
    { purpose: "DKIM", type: "CNAME", name: "tok3._domainkey.duva.example.com", value: "tok3.dkim.amazonses.com", status: "missing" },
    { purpose: "MAIL FROM", type: "MX", name: "mail.duva.example.com", value: "10 feedback-smtp.eu-north-1.amazonses.com", status: "missing" },
    { purpose: "MAIL FROM", type: "TXT", name: "mail.duva.example.com", value: "v=spf1 include:amazonses.com ~all", status: "missing" },
    { purpose: "DMARC", type: "TXT", name: "_dmarc.duva.example.com", value: "v=DMARC1; p=none;", status: "missing" },
  ]);
});

test("deploy makes Duva's receipt rule set the active one", async () => {
  const world = newWorld();

  await deployDuva({ ...world, admin, recovery, domain: "duva.example.com" });

  expect(world.aws.activeRuleSet).toBe("Duva-Receiving");
});

test("deploy refuses, and changes nothing, when another receipt rule set is active", async () => {
  const world = newWorld();
  world.aws.activeRuleSet = "someone-elses";

  await expect(deployDuva({ ...world, admin, recovery, domain: "duva.example.com" })).rejects.toThrow(/someone-elses/);
  expect(world.aws.changes).toEqual([]);
});

test("the first deploy asks for the domain", async () => {
  const world = newWorld();

  await expect(deployDuva(world)).rejects.toThrow(/--domain/);
  expect(world.aws.changes).toEqual([]);
});

test("re-running with the same domain changes nothing", async () => {
  const world = newWorld();
  const first = await deployDuva({ ...world, admin, recovery, domain: "duva.example.com" });
  const changes = [...world.aws.changes];

  const again = await deployDuva({ ...world, admin, recovery, domain: "duva.example.com" });

  // What Coo's models mean for the mail is said on the first deploy only.
  const { cooModels: _, ...report } = first;
  expect(again).toEqual(report);
  expect(world.aws.changes).toEqual(changes);
});

test("the first deploy in the EU says once that Coo's models may process the mail outside the EU, and how to keep it there", async () => {
  const world = newWorld();

  const first = await deployDuva({ ...world, admin, recovery, domain: "duva.example.com" });
  const again = await deployDuva(world);

  expect(first.cooModels).toBe(
    "Coo thinks with GPT-6 Luna, and GPT-6 Sol for the harder work. For eu-north-1, Bedrock runs GPT-6 Luna and GPT-6 Sol in any AWS region with room, so what Coo reads of the mail may be processed outside the EU. To keep it there, allow and choose other models in Settings, under Mailbox agents.",
  );
  expect(again).not.toHaveProperty("cooModels");
});

test("the first deploy in the US says nothing of where Coo's models run, as they run in the US", async () => {
  const world = newWorld();
  world.aws.region = "us-east-1";

  const first = await deployDuva({ ...world, admin, recovery, domain: "duva.example.com" });

  expect(first).not.toHaveProperty("cooModels");
});

test("a re-run without a domain keeps the deployed one", async () => {
  const world = newWorld();
  await deployDuva({ ...world, admin, recovery, domain: "duva.example.com" });

  const report = await deployDuva(world);

  expect(report.domain.name).toBe("duva.example.com");
});

test("deploy keeps the first domain, and says admins add every other one", async () => {
  const world = newWorld();
  await deployDuva({ ...world, admin, recovery, domain: "duva.example.com" });
  const changes = [...world.aws.changes];

  await expect(deployDuva({ ...world, admin, recovery, domain: "other.example.com" })).rejects.toThrow(/first domain is duva\.example\.com.*duva domains add/);
  expect(world.aws.changes).toEqual(changes);
});

test("a re-run lists only the first domain's records, whatever domains admins have added since", async () => {
  const world = newWorld();
  await deployDuva({ ...world, admin, recovery, domain: "duva.example.com" });
  world.aws.identities.set("other.example.com", { dkim: "SUCCESS", mailFrom: "SUCCESS", verified: true });

  const report = await deployDuva(world);

  expect(report.domain.name).toBe("duva.example.com");
  expect(report.domain.records).toHaveLength(7);
  expect(report.domain.records.filter(({ name }) => !name.endsWith("duva.example.com"))).toEqual([]);
  expect(world.aws.stack?.domain).toBe("duva.example.com");
});

test("a re-run keeps the sign-in domain an admin chose, which the user pool sends codes from", async () => {
  const world = newWorld();
  await deployDuva({ ...world, admin, recovery, domain: "duva.example.com" });
  world.aws.identities.set("other.example.com", { dkim: "SUCCESS", mailFrom: "SUCCESS", verified: true });
  world.aws.poolSenders.set("eu-north-1_old", "other.example.com");

  const report = await deployDuva(world);

  expect(world.aws.stack).toMatchObject({ domain: "duva.example.com", signInDomain: "other.example.com", domainVerified: true });
  expect(report.admin.signIn).toMatch(/from no-reply@other\.example\.com/);
});

test("a re-run after an admin removed the first domain says so, and lists no records for it", async () => {
  const world = newWorld();
  await deployDuva({ ...world, admin, recovery, domain: "duva.example.com" });
  world.aws.identities.set("other.example.com", { dkim: "SUCCESS", mailFrom: "SUCCESS", verified: true });
  world.aws.poolSenders.set("eu-north-1_old", "other.example.com");
  world.aws.identities.delete("duva.example.com");

  const report = await deployDuva(world);

  expect(report.domain).toEqual({ name: "duva.example.com", records: [], removed: expect.stringMatching(/admin removed duva\.example\.com.*duva domains add/) });
  expect(world.aws.stack).toMatchObject({ domain: "duva.example.com", signInDomain: "other.example.com", domainVerified: true });
});

test("deploy refuses a domain whose SES identity Duva didn't create", async () => {
  const world = newWorld();
  world.aws.identities.set("duva.example.com", { dkim: "SUCCESS", mailFrom: "SUCCESS", verified: true });

  await expect(deployDuva({ ...world, admin, recovery, domain: "duva.example.com" })).rejects.toThrow(/already has an SES identity/);
  expect(world.aws.changes).toEqual([]);
});

describe("deploy refuses a domain that isn't one, and changes nothing", () => {
  test.each(["", "example", "a..example.com", "-a.example.com", "a-.example.com", "a_b.example.com", "a b.com", "example.123", `${"a".repeat(64)}.com`])(
    "%j",
    async (domain) => {
      const world = newWorld();

      await expect(deployDuva({ ...world, admin, domain })).rejects.toThrow(/isn't a domain/);
      expect(world.aws.changes).toEqual([]);
    },
  );
});

test.each([
  ["Duva.Example.COM.", "duva.example.com"],
  ["mejl.räksmörgås.se", "mejl.xn--rksmrgs-5wao1o.se"],
])("deploy takes %j as %j", async (given, domain) => {
  const world = newWorld();

  const report = await deployDuva({ ...world, admin, recovery, domain: given });

  expect(report.domain.name).toBe(domain);
  expect(world.aws.stack?.domain).toBe(domain);
});

test("a re-run shows which records are live, and what DNS has instead of the others", async () => {
  const world = newWorld();
  world.dns.records.set("MX duva.example.com", ["10 Inbound-SMTP.eu-north-1.amazonaws.com"]);
  world.dns.records.set("CNAME tok1._domainkey.duva.example.com", ["tok1.dkim.amazonses.com"]);
  world.dns.records.set("CNAME tok2._domainkey.duva.example.com", ["tok9.dkim.amazonses.com"]);
  world.dns.records.set("MX mail.duva.example.com", ["10 feedback-smtp.eu-north-1.amazonses.com"]);
  world.dns.records.set("TXT mail.duva.example.com", ["google-site-verification=abc", "v=spf1 -all"]);

  const report = await deployDuva({ ...world, admin, recovery, domain: "duva.example.com" });

  expect(report.domain.records.map(({ name, type, status, found }) => ({ name, type, status, found }))).toEqual([
    { type: "MX", name: "duva.example.com", status: "live", found: undefined },
    { type: "CNAME", name: "tok1._domainkey.duva.example.com", status: "live", found: undefined },
    { type: "CNAME", name: "tok2._domainkey.duva.example.com", status: "different", found: ["tok9.dkim.amazonses.com"] },
    { type: "CNAME", name: "tok3._domainkey.duva.example.com", status: "missing", found: undefined },
    { type: "MX", name: "mail.duva.example.com", status: "live", found: undefined },
    { type: "TXT", name: "mail.duva.example.com", status: "different", found: ["v=spf1 -all"] },
    { type: "TXT", name: "_dmarc.duva.example.com", status: "missing", found: undefined },
  ]);
});

test("an MX record with other mail servers next to SES's shows as different", async () => {
  const world = newWorld();
  world.dns.records.set("MX duva.example.com", ["10 inbound-smtp.eu-north-1.amazonaws.com", "20 mx.other.example"]);

  const report = await deployDuva({ ...world, admin, recovery, domain: "duva.example.com" });

  expect(report.domain.records[0]).toMatchObject({ status: "different", found: ["10 inbound-smtp.eu-north-1.amazonaws.com", "20 mx.other.example"] });
});

test("a DMARC record at the domain counts as live, whatever its policy", async () => {
  const world = newWorld();
  world.dns.records.set("TXT _dmarc.duva.example.com", ["v=DMARC1; p=reject; rua=mailto:d@example.com"]);

  const report = await deployDuva({ ...world, admin, recovery, domain: "duva.example.com" });

  expect(report.domain.records.at(-1)).toMatchObject({ purpose: "DMARC", status: "live" });
});

test("two DMARC records at the domain show as different, since receivers then apply neither", async () => {
  const world = newWorld();
  world.dns.records.set("TXT _dmarc.duva.example.com", ["v=DMARC1; p=none;", "v=DMARC1; p=reject;"]);

  const report = await deployDuva({ ...world, admin, recovery, domain: "duva.example.com" });

  expect(report.domain.records.at(-1)).toMatchObject({ status: "different", found: ["v=DMARC1; p=none;", "v=DMARC1; p=reject;"] });
});

test("deploy prints no DMARC record when a parent domain's record covers the domain", async () => {
  const world = newWorld();
  world.dns.records.set("TXT _dmarc.example.com", ["v=DMARC1; p=none;"]);

  const report = await deployDuva({ ...world, admin, recovery, domain: "mail.duva.example.com" });

  expect(report.domain.records.map(({ purpose }) => purpose)).not.toContain("DMARC");
  expect(report.domain.dmarc).toBe("Covered by the DMARC record at _dmarc.example.com.");
});

test("a record whose lookup fails shows as unchecked, and deploy still finishes", async () => {
  const world = newWorld();
  world.dns.records.set("CNAME tok1._domainkey.duva.example.com", new Error("queryCname ESERVFAIL tok1._domainkey.duva.example.com"));

  const report = await deployDuva({ ...world, admin, recovery, domain: "duva.example.com" });

  expect(report.domain.records[1]).toMatchObject({ status: "unchecked", error: "queryCname ESERVFAIL tok1._domainkey.duva.example.com" });
  expect(world.aws.activeRuleSet).toBe("Duva-Receiving");
});

test("deploy shows whether SES has verified the domain's DKIM and MAIL FROM", async () => {
  const world = newWorld();
  const first = await deployDuva({ ...world, admin, recovery, domain: "duva.example.com" });
  world.aws.identities.set("duva.example.com", { dkim: "SUCCESS", mailFrom: "TEMPORARY_FAILURE", verified: true });

  const again = await deployDuva(world);

  expect([first.domain.ses, again.domain.ses]).toEqual([
    { dkim: "pending", mailFrom: "pending" },
    { dkim: "verified", mailFrom: "temporary failure" },
  ]);
});

test("in the SES sandbox, deploy says what that means for sending and how to get out", async () => {
  const world = newWorld();

  const { sending } = await deployDuva({ ...world, admin, recovery, domain: "duva.example.com" });

  expect(sending.sandbox).toBe(true);
  expect(sending.detail).toMatch(/only to verified addresses/);
  expect(sending.detail).toMatch(/200 messages a day, 1 a second/);
  expect(sending.detail).toMatch(/production access/);
  expect(sending.detail).toContain("https://eu-north-1.console.aws.amazon.com/ses/home?region=eu-north-1#/account");
});

test("with production access, deploy says sending is open", async () => {
  const world = newWorld();
  world.aws.sandbox = false;
  world.aws.perDay = 50000;
  world.aws.perSecond = 14;

  const { sending } = await deployDuva({ ...world, admin, recovery, domain: "duva.example.com" });

  expect(sending).toEqual({ sandbox: false, detail: "The account has production access in eu-north-1, so Duva can send to any address. SES lets it send 50000 messages a day, 14 a second.",
  });
});

test("the first deploy asks for the first admin's address", async () => {
  const world = newWorld();

  await expect(deployDuva({ ...world, domain: "duva.example.com" })).rejects.toThrow(/--admin/);
  expect(world.aws.changes).toEqual([]);
});

test("deploy sets up the organization with the first admin", async () => {
  const world = newWorld();

  const report = await deployDuva({ ...world, domain: "duva.example.com", admin: "ada@example.org", recovery });

  expect(world.aws.organization).toEqual({ domain: "duva.example.com", admin: "ada@example.org", recovery });
  expect(report.admin.email).toBe("ada@example.org");
});

test("a re-run without an admin keeps the first one", async () => {
  const world = newWorld();
  await deployDuva({ ...world, domain: "duva.example.com", admin: "ada@example.org", recovery });
  const changes = [...world.aws.changes];

  const report = await deployDuva(world);

  expect(report.admin.email).toBe("ada@example.org");
  expect(world.aws.changes).toEqual(changes);
});

test("deploy refuses another first admin, and changes nothing", async () => {
  const world = newWorld();
  await deployDuva({ ...world, domain: "duva.example.com", admin: "ada@example.org", recovery });
  const changes = [...world.aws.changes];

  await expect(deployDuva({ ...world, admin: "bo@example.org" })).rejects.toThrow(/ada@example\.org/);
  expect(world.aws.changes).toEqual(changes);
});

test("deploy takes the admin's address with its domain in lower case", async () => {
  const world = newWorld();

  const report = await deployDuva({ ...world, domain: "duva.example.com", admin: " Ada@Example.ORG ", recovery });

  expect(report.admin.email).toBe("Ada@example.org");
});

describe("deploy refuses an admin address that isn't one, and changes nothing", () => {
  test.each(["", "ada", "ada@", "@example.org", "ada@example", "ada@@example.org", "a da@example.org"])("%j", async (address) => {
    const world = newWorld();

    await expect(deployDuva({ ...world, domain: "duva.example.com", admin: address, recovery })).rejects.toThrow(/isn't an email address/);
    expect(world.aws.changes).toEqual([]);
  });
});

test("the first deploy asks for the first admin's recovery address", async () => {
  const world = newWorld();

  await expect(deployDuva({ ...world, domain: "duva.example.com", admin })).rejects.toThrow(/--recovery/);
  expect(world.aws.changes).toEqual([]);
});

test("deploy refuses a recovery address on the deployment's domain, and changes nothing", async () => {
  const world = newWorld();

  await expect(deployDuva({ ...world, domain: "duva.example.com", admin, recovery: "ada@Duva.Example.com" })).rejects.toThrow(/outside duva\.example\.com/);
  expect(world.aws.changes).toEqual([]);
});

test("a first admin may sign in with an address on the deployment's domain, since their first sign-in link goes to their recovery address, and managed login's code to the mailbox setup gave them", async () => {
  const world = newWorld();

  const report = await deployDuva({ ...world, domain: "duva.example.com", admin: "ada@duva.example.com", recovery });

  expect(world.aws.organization).toEqual({ domain: "duva.example.com", admin: "ada@duva.example.com", recovery });
  expect(report.admin).toMatchObject({ email: "ada@duva.example.com", recoveryAddress: recovery });
  expect(report.admin.signIn).toMatch(/Adding a passkey first asks for a code, which managed login emails to your mailbox in Duva at ada@duva\.example\.com\./);
});

test("deploy names no mailbox for a first admin who signs in outside the deployment's domain", async () => {
  const world = newWorld();

  const report = await deployDuva({ ...world, domain: "duva.example.com", admin, recovery });

  expect(report.admin.signIn).not.toMatch(/your mailbox in Duva/);
});

test("deploy gives the first admin their recovery address, and setup mails the first sign-in link there once SES has verified the domain, once", async () => {
  const world = newWorld();
  world.aws.sandbox = false;

  const first = await deployDuva({ ...world, admin, recovery, domain: "duva.example.com" });
  world.aws.identities.set("duva.example.com", { dkim: "SUCCESS", mailFrom: "SUCCESS", verified: true });
  const verified = await deployDuva(world);
  const again = await deployDuva(world);

  expect(world.aws.stack).toMatchObject({ recovery });
  expect(first.admin.signIn).toMatch(/Once SES has verified duva\.example\.com, run duva deploy again, and Duva mails a sign-in link to ada@elsewhere\.example/);
  expect(verified.admin.signIn).toMatch(/Duva mailed a sign-in link to ada@elsewhere\.example\. Follow it within 30 minutes/);
  expect(again.admin.signIn).toMatch(/with your passkey, or with a code emailed to ada@example\.org from no-reply@duva\.example\.com.*sign-in link.*ada@elsewhere\.example/);
  expect(world.aws.linksMailed).toEqual([recovery]);
});

test("deploy keeps the first admin's recovery address, and refuses another", async () => {
  const world = newWorld();
  await deployDuva({ ...world, admin, recovery, domain: "duva.example.com" });
  const changes = [...world.aws.changes];

  await expect(deployDuva({ ...world, recovery: "ada@other.example" })).rejects.toThrow(/already has the first admin's recovery address.*Settings/);
  expect(world.aws.changes).toEqual(changes);
  expect((await deployDuva({ ...world, recovery: " ada@Elsewhere.EXAMPLE " })).admin.recoveryAddress).toBe(recovery);
});

test("a deployment from before recovery addresses deploys again without one, and its first admin signs in with a code", async () => {
  const world = newWorld();
  await deployDuva({ ...world, admin, recovery, domain: "duva.example.com" });
  world.aws.stack = { ...world.aws.stack!, recovery: undefined };
  world.aws.organization = { ...world.aws.organization!, recovery: undefined };

  const report = await deployDuva(world);

  expect(world.aws.stack).toMatchObject({ recovery: "" });
  expect(report.admin).not.toHaveProperty("recoveryAddress");
  expect(report.admin.signIn).toMatch(/with a code emailed to ada@example\.org/);
});

test("in the SES sandbox, deploy asks SES to verify the recovery address, which the first sign-in link needs", async () => {
  const world = newWorld();
  await deployDuva({ ...world, admin, recovery, domain: "duva.example.com" });
  world.aws.identities.set("duva.example.com", { dkim: "SUCCESS", mailFrom: "SUCCESS", verified: true });

  const report = await deployDuva(world);
  world.aws.addresses.set(recovery, true);
  const verified = await deployDuva(world);

  expect(world.aws.changes).toContain("asked SES to verify ada@elsewhere.example");
  expect(report.admin.signIn).toMatch(/SES sent ada@elsewhere\.example a link to verify it\. Open it, then run duva deploy again/);
  expect(verified.admin.signIn).toMatch(/Duva mailed a sign-in link to ada@elsewhere\.example/);
});

test("in the SES sandbox, deploy doesn't ask SES to verify an admin's address on the domain it verified", async () => {
  const world = newWorld();

  await deployDuva({ ...world, domain: "duva.example.com", admin: "ada@duva.example.com", recovery });

  expect(world.aws.changes).not.toContain("asked SES to verify ada@duva.example.com");
});

test("deploy publishes the web app with how it reaches the API and signs in", async () => {
  const world = newWorld();

  const report = await deployDuva({ ...world, admin, recovery, domain: "duva.example.com" });

  expect(report.webUrl).toBe("https://web.example");
  expect(world.aws.webApp).toEqual({
    bucket: "duva-web",
    config: {
      apiUrl: "https://api.example",
      signIn: { url: "https://sign-in.example", clientId: "web-client", redirectUri: "https://web.example/" },
    },
  });
});

test("deploy gives the CLI how it signs in, through a loopback redirect", async () => {
  const world = newWorld();

  const { signIn } = await deployDuva({ ...world, admin, recovery, domain: "duva.example.com" });

  expect(signIn).toEqual({ url: "https://sign-in.example", clientId: "cli-client", redirectUri: "http://127.0.0.1:8976/callback" });
});

test("in the SES sandbox, deploy asks SES to verify the admin's address and says to confirm it", async () => {
  const world = newWorld();
  await deployDuva({ ...world, domain: "duva.example.com", admin: "ada@example.org", recovery });
  world.aws.identities.set("duva.example.com", { dkim: "SUCCESS", mailFrom: "SUCCESS", verified: true });

  const report = await deployDuva(world);

  expect(world.aws.changes).toContain("asked SES to verify ada@example.org");
  expect(report.admin.signIn).toMatch(/SES sent ada@example\.org a link.*open it/i);
});

test("while codes come from Cognito, deploy doesn't ask the admin to verify their address before signing in, since Cognito's sender isn't in the sandbox", async () => {
  const world = newWorld();

  const report = await deployDuva({ ...world, domain: "duva.example.com", admin: "ada@example.org", recovery });

  expect(report.admin.signIn).not.toMatch(/before you sign in/);
});

test("a re-run in the sandbox doesn't ask SES to verify the admin's address again", async () => {
  const world = newWorld();
  await deployDuva({ ...world, domain: "duva.example.com", admin: "ada@example.org", recovery });
  world.aws.addresses.set("ada@example.org", true);
  world.aws.addresses.set(recovery, true);
  const changes = [...world.aws.changes];

  const report = await deployDuva(world);

  expect(world.aws.changes).toEqual(changes);
  expect(report.admin.signIn).not.toMatch(/SES sent/);
});

test("with production access, deploy doesn't ask SES to verify the admin's address", async () => {
  const world = newWorld();
  world.aws.sandbox = false;

  await deployDuva({ ...world, domain: "duva.example.com", admin: "ada@example.org", recovery });

  expect(world.aws.changes).not.toContain("asked SES to verify ada@example.org");
});

test("until SES has verified the domain, the stack sends sign-in codes from Cognito, and deploy says so", async () => {
  const world = newWorld();

  const report = await deployDuva({ ...world, admin, recovery, domain: "duva.example.com" });

  expect(world.aws.stack?.domainVerified).toBe(false);
  expect(report.admin.signIn).toMatch(/Once SES has verified duva\.example\.com, run duva deploy again.*a code emailed to ada@example\.org from Cognito's no-reply@verificationemail\.com/);
});

test("once SES has verified the domain, a re-run sends sign-in codes from it", async () => {
  const world = newWorld();
  await deployDuva({ ...world, admin, recovery, domain: "duva.example.com" });
  world.aws.identities.set("duva.example.com", { dkim: "SUCCESS", mailFrom: "SUCCESS", verified: true });

  const report = await deployDuva(world);

  expect(world.aws.stack?.domainVerified).toBe(true);
  expect(report.admin.signIn).toMatch(/from no-reply@duva\.example\.com/);
});

test("a deploy that brings a new user pool gives the CLI and the web app its sign-in, and deletes the old pool once setup has moved the humans", async () => {
  const world = newWorld();
  await deployDuva({ ...world, admin, recovery, domain: "duva.example.com" });
  world.aws.shipped = { userPool: "eu-north-1_new", signInUrl: "https://new-sign-in.example", webClientId: "new-web-client", cliClientId: "new-cli-client" };

  const { signIn } = await deployDuva(world);

  expect(signIn).toEqual({ url: "https://new-sign-in.example", clientId: "new-cli-client", redirectUri: "http://127.0.0.1:8976/callback" });
  expect(world.aws.webApp?.config).toMatchObject({ signIn: { url: "https://new-sign-in.example", clientId: "new-web-client" } });
  expect([...world.aws.userPools]).toEqual(["eu-north-1_new"]);
  expect(world.aws.changes.slice(-2)).toEqual(["moved the humans to eu-north-1_new", "deleted the user pool eu-north-1_old"]);
});

test("while setup fails, deploy keeps the old user pool", async () => {
  const world = newWorld();
  await deployDuva({ ...world, admin, recovery, domain: "duva.example.com" });
  world.aws.shipped = { ...world.aws.shipped, userPool: "eu-north-1_new" };
  world.aws.setupFails = true;

  await expect(deployDuva(world)).rejects.toThrow(/Setting up/);
  expect([...world.aws.userPools].sort()).toEqual(["eu-north-1_new", "eu-north-1_old"]);
});

test("deploy given a web host requests its certificate, prints the records that validate it, and waits until ACM has validated it before deploying", async () => {
  const world = newWorld();
  world.onWait = (waits) => {
    if (waits === 3) world.dns.records.set("CNAME _v.duva.example.com", ["_v.duva-example-com.acm-validations.aws."]);
  };

  await deployDuva({ ...world, admin, recovery, domain: "example.com", web: "duva.example.com" });

  expect(world.said).toEqual([
    "Add a CNAME record at _v.duva.example.com with the value _v.duva-example-com.acm-validations.aws, so ACM can validate the web app's certificate for duva.example.com.",
    "Waiting until ACM has validated the web app's certificate. You can stop, and run duva deploy again, which waits for the same one.",
    "DNS has the record at _v.duva.example.com.",
    "ACM has validated the web app's certificate.",
  ]);
  expect(world.waits).toHaveLength(3);
  expect(world.aws.changes.slice(0, 2)).toEqual([
    "requested a certificate for duva.example.com",
    `deployed the stack with ${JSON.stringify({ domain: "example.com", admin, signInDomain: "example.com", domainVerified: false, recovery, webHosts: ["duva.example.com"], webCertificate: "arn:aws:acm:us-east-1:123456789012:certificate/1" })}`,
  ]);
});

test("deploy says which records the web app needs in DNS: its certificate's, and its host's CNAME to CloudFront", async () => {
  const world = newWorld();
  world.dns.records.set("CNAME _v.duva.example.com", ["_v.duva-example-com.acm-validations.aws"]);

  const report = await deployDuva({ ...world, admin, recovery, domain: "example.com", web: "duva.example.com" });

  expect(report.web?.records).toEqual([
    { purpose: "certificate", type: "CNAME", name: "_v.duva.example.com", value: "_v.duva-example-com.acm-validations.aws", status: "live" },
    { purpose: "web app", type: "CNAME", name: "duva.example.com", value: "d111111abcdef8.cloudfront.net", status: "missing" },
  ]);
});

test("the web app on a host is at its URL there, for the CLI, in the config the web app signs in with and for the first sign-in link, once DNS leads the host to CloudFront", async () => {
  const world = newWorld();
  world.aws.sandbox = false;
  world.dns.records.set("CNAME _v.duva.example.com", ["_v.duva-example-com.acm-validations.aws"]);

  const report = await deployDuva({ ...world, admin, recovery, domain: "example.com", web: "Duva.Example.COM" });
  world.aws.identities.set("example.com", { dkim: "SUCCESS", mailFrom: "SUCCESS", verified: true });
  world.dns.records.set("CNAME duva.example.com", ["d111111abcdef8.cloudfront.net"]);
  const again = await deployDuva(world);

  expect(report.webUrl).toBe("https://duva.example.com");
  expect(world.aws.webApp?.config).toMatchObject({ signIn: { redirectUri: "https://duva.example.com/" } });
  expect(report.admin.signIn).toMatch(/Until then, sign in at https:\/\/duva\.example\.com once DNS has its CNAME record to d111111abcdef8\.cloudfront\.net, or with duva login,/);
  expect(again.admin.signIn).toMatch(/^Duva mailed a sign-in link to ada@elsewhere\.example\. Follow it within 30 minutes to sign in at https:\/\/duva\.example\.com, then register a passkey\./);
});

test("a re-run keeps the web app's host and its certificate, and waits for nothing", async () => {
  const world = newWorld();
  world.dns.records.set("CNAME _v.duva.example.com", ["_v.duva-example-com.acm-validations.aws"]);
  const first = await deployDuva({ ...world, admin, recovery, domain: "example.com", web: "duva.example.com" });
  const changes = [...world.aws.changes];
  const said = world.said.length;

  const again = await deployDuva(world);

  const { cooModels: _, ...report } = first;
  expect(again).toEqual(report);
  expect(world.aws.changes).toEqual(changes);
  expect(world.said).toHaveLength(said);
});

describe("deploy refuses a web host off the organization's domains, or where DNS can't take its CNAME, and changes nothing", () => {
  test.each([
    ["duva.example.net", /duva\.example\.net isn't on one of the organization's domains, example\.com\. Give a host on one of them, like duva\.example\.com/],
    ["duvaexample.com", /duvaexample\.com isn't on one of the organization's domains/],
    ["example.com", /can't be at example\.com itself.*like duva\.example\.com/],
    ["mail.example.com", /mail\.example\.com has the MAIL FROM records/],
    ["not a host", /"not a host" isn't a host name/],
  ])("%j", async (web, refusal) => {
    const world = newWorld();

    await expect(deployDuva({ ...world, admin, recovery, domain: "example.com", web })).rejects.toThrow(refusal);
    expect(world.aws.changes).toEqual([]);
  });
});

test("a later deploy takes a web host on a domain an admin added", async () => {
  const world = newWorld();
  await deployDuva({ ...world, admin, recovery, domain: "example.com" });
  world.aws.addedDomains.push("example.net");
  world.dns.records.set("CNAME _v.duva.example.net", ["_v.duva-example-net.acm-validations.aws"]);

  await deployDuva({ ...world, web: "duva.example.net" });

  expect(world.aws.stack?.webHosts).toEqual(["duva.example.net"]);
});

test("moving the web app keeps its earlier host for links already sent, with one certificate for both, and deletes the one it replaced", async () => {
  const world = newWorld();
  world.dns.records.set("CNAME _v.duva.example.com", ["_v.duva-example-com.acm-validations.aws"]);
  await deployDuva({ ...world, admin, recovery, domain: "example.com", web: "duva.example.com" });
  world.said.length = 0;
  world.onWait = () => world.dns.records.set("CNAME _v.web.example.com", ["_v.web-example-com.acm-validations.aws"]);

  const report = await deployDuva({ ...world, web: "web.example.com" });

  expect(world.aws.stack).toMatchObject({ webHosts: ["web.example.com", "duva.example.com"], webCertificate: "arn:aws:acm:us-east-1:123456789012:certificate/2" });
  expect([...world.aws.certificates.keys()]).toEqual(["arn:aws:acm:us-east-1:123456789012:certificate/2"]);
  expect(world.aws.certificates.get("arn:aws:acm:us-east-1:123456789012:certificate/2")?.names).toEqual(["web.example.com", "duva.example.com"]);
  // The new host can point at CloudFront while ACM validates, so the web app opens there once it moves.
  expect(world.said.slice(0, 3)).toEqual([
    "Add a CNAME record at web.example.com with the value d111111abcdef8.cloudfront.net, where the web app moves once deploy is done.",
    "Add a CNAME record at _v.web.example.com with the value _v.web-example-com.acm-validations.aws, so ACM can validate the web app's certificate for web.example.com and duva.example.com.",
    "Waiting until ACM has validated the web app's certificate. You can stop, and run duva deploy again, which waits for the same one.",
  ]);
  expect(report.webUrl).toBe("https://web.example.com");
  expect(report.web?.records.filter(({ purpose }) => purpose === "web app").map(({ name }) => name)).toEqual(["web.example.com", "duva.example.com"]);
});

test("deploy stops waiting for the certificate after an hour, and a re-run waits for the same one", async () => {
  const world = newWorld();

  await expect(deployDuva({ ...world, admin, recovery, domain: "example.com", web: "duva.example.com" })).rejects.toThrow(
    "ACM hasn't validated the web app's certificate in an hour. Add the records above to DNS, and run duva deploy again, which waits for the same certificate.",
  );
  expect(world.waits.reduce((total, wait) => total + wait, 0)).toBe(3_600_000);
  expect(world.aws.changes).toEqual(["requested a certificate for duva.example.com"]);

  world.dns.records.set("CNAME _v.duva.example.com", ["_v.duva-example-com.acm-validations.aws"]);
  await deployDuva({ ...world, admin, recovery, domain: "example.com", web: "duva.example.com" });
  expect(world.aws.certificates.size).toBe(1);
  expect(world.aws.stack?.webCertificate).toBe("arn:aws:acm:us-east-1:123456789012:certificate/1");
});

test("when ACM can't validate the certificate, deploy says why, and a re-run requests another", async () => {
  const world = newWorld();
  world.aws.certificateFailure = "CAA_ERROR";

  await expect(deployDuva({ ...world, admin, recovery, domain: "example.com", web: "duva.example.com" })).rejects.toThrow(
    "ACM couldn't validate the web app's certificate for duva.example.com: CAA_ERROR. Fix what stopped it, and run duva deploy again for another.",
  );
  expect(world.aws.changes).toEqual(["requested a certificate for duva.example.com"]);

  world.aws.certificateFailure = undefined;
  world.dns.records.set("CNAME _v.duva.example.com", ["_v.duva-example-com.acm-validations.aws"]);
  await deployDuva({ ...world, admin, recovery, domain: "example.com", web: "duva.example.com" });
  expect(world.aws.stack?.webCertificate).toBe("arn:aws:acm:us-east-1:123456789012:certificate/2");
});

/**
 * An AWS account and region with nothing of Duva's in it, and DNS with no records. SES gives a new
 * domain identity the DKIM tokens tok1, tok2 and tok3, and ACM validates a name by a CNAME at _v.
 * before it. Deploy's waits take no time, and what it says is kept.
 */
function newWorld() {
  const dns = new InMemoryDns();
  const aws = new InMemoryAws(dns);
  const world = {
    aws,
    dns,
    said: [] as string[],
    say: (line: string) => void world.said.push(line),
    waits: [] as number[],
    /** What changes while deploy waits, given how many times it has. */
    onWait: (_waits: number) => {},
    async wait(ms: number) {
      world.waits.push(ms);
      world.onWait(world.waits.length);
    },
  };
  return world;
}

interface Identity {
  dkim: string;
  mailFrom: string;
  verified: boolean;
}

interface Parameters {
  domain: string;
  admin: string;
  signInDomain: string;
  domainVerified: boolean;
  recovery: string;
  webHosts: string[];
  webCertificate: string;
}

/** The record ACM validates the name by. */
const validation = (name: string) => ({ name: `_v.${name}`, value: `_v.${name.replaceAll(".", "-")}.acm-validations.aws` });

class InMemoryAws implements Aws {
  /** The DNS ACM looks its validation records up in. */
  readonly dns: Dns;
  constructor(dns: Dns) {
    this.dns = dns;
  }
  region = "eu-north-1";
  account = "123456789012";
  stack?: Partial<Parameters> & { outputs: StackOutputs };
  identities = new Map<string, Identity>();
  /** Whether SES has verified each email address it has an identity for. */
  addresses = new Map<string, boolean>();
  /** The organization that the stack's setup set up, with its first admin's recovery address. */
  organization?: { domain: string; admin: string; recovery?: string };
  /** The recovery addresses setup mailed the first admin's first sign-in link to, in order. */
  linksMailed: string[] = [];
  /** What deploy published to the web app's bucket. */
  webApp?: { bucket: string; config: unknown };
  activeRuleSet?: string;
  sandbox = true;
  perDay = 200;
  perSecond = 1;
  /** Every change deploy made, in order. */
  changes: string[] = [];
  /** What the stack this CLI version ships makes of the user pool, by its outputs. */
  shipped = { userPool: "eu-north-1_old", signInUrl: "https://sign-in.example", webClientId: "web-client", cliClientId: "cli-client" };
  /** The user pools the stack has made, those it retired included. */
  userPools = new Set<string>();
  /** The user pool setup last gave every human a Cognito user in. */
  humansMovedTo?: string;
  /** Whether the stack's setup function fails. */
  setupFails = false;
  /** The domain each user pool sends sign-in codes from, once one does: the stack's sign-in domain, or one the API chose since. */
  poolSenders = new Map<string, string>();
  /** The domains admins added to the organization after the first. */
  addedDomains: string[] = [];
  /** ACM's certificates in us-east-1, by ARN, with the region of the deployment that requested each. */
  certificates = new Map<string, { names: string[]; status: string; failure?: string; deployment: string }>();
  /** Why ACM fails to validate the certificates it is asked for, if it does. */
  certificateFailure?: string;

  async duvaStack() {
    return this.stack;
  }

  async deployStack(parameters: Parameters) {
    const { domain, admin, signInDomain, domainVerified, recovery } = parameters;
    if (this.stack?.domain !== domain) this.identities.set(domain, { dkim: "PENDING", mailFrom: "PENDING", verified: false });
    const { userPool, signInUrl, webClientId, cliClientId } = this.shipped;
    if (
      this.stack?.domain !== domain ||
      this.stack.admin !== admin ||
      this.stack.signInDomain !== signInDomain ||
      this.stack.domainVerified !== domainVerified ||
      this.stack.recovery !== recovery ||
      JSON.stringify(this.stack.webHosts) !== JSON.stringify(parameters.webHosts) ||
      this.stack.webCertificate !== parameters.webCertificate ||
      this.stack.outputs.UserPoolId !== userPool
    ) {
      // CloudFront takes only a certificate ACM issued for every host.
      const certificate = this.certificates.get(parameters.webCertificate);
      if (parameters.webHosts.length > 0 && (certificate?.status !== "ISSUED" || certificate.names.join() !== parameters.webHosts.join())) throw new Error("CloudFront refused the certificate");
      const dkim = Object.fromEntries(
        [1, 2, 3].flatMap((n) => [
          [`DkimName${n}`, `tok${n}._domainkey.${domain}`],
          [`DkimValue${n}`, `tok${n}.dkim.amazonses.com`],
        ]),
      );
      const outputs = {
        ApiUrl: "https://api.example",
        ReceiptRuleSet: "Duva-Receiving",
        WebUrl: parameters.webHosts.length > 0 ? `https://${parameters.webHosts[0]}` : "https://web.example",
        WebDistributionDomain: "d111111abcdef8.cloudfront.net",
        WebBucket: "duva-web",
        UserPoolId: userPool,
        SignInUrl: signInUrl,
        WebClientId: webClientId,
        CliClientId: cliClientId,
        SetupFunction: "duva-setup",
        ...dkim,
      };
      this.stack = { ...parameters, outputs };
      this.userPools.add(userPool);
      if (domainVerified) this.poolSenders.set(userPool, signInDomain);
      else this.poolSenders.delete(userPool);
      this.changes.push(`deployed the stack with ${JSON.stringify(parameters)}`);
    }
    return { account: this.account, outputs: this.stack.outputs };
  }

  async setUpOrganization(functionName: string) {
    const { domain, admin } = this.stack ?? {};
    if (functionName !== "duva-setup" || domain === undefined || admin === undefined) throw new Error("No setup function");
    if (this.setupFails) throw new Error("Setting up the organization failed: Rate exceeded.");
    if (this.humansMovedTo !== this.shipped.userPool) {
      this.humansMovedTo = this.shipped.userPool;
      this.changes.push(`moved the humans to ${this.shipped.userPool}`);
    }
    const recovery = this.stack?.recovery || undefined;
    if (this.organization === undefined) {
      this.organization = { domain, admin, ...(recovery && { recovery }) };
      this.changes.push(`set up the organization with ${admin}`);
    }
    if (this.organization.admin !== admin) throw new Error(`The organization's first admin is ${this.organization.admin}`);
    // Setup gives the first admin the recovery address deploy names if they have none.
    this.organization.recovery ??= recovery;
    // It gives a first admin on the domain a mailbox at their sign-in address, and answers with it.
    const address = admin.toLowerCase();
    const mailbox = address.endsWith(`@${domain}`) ? { id: "ada-mailbox", kind: "personal" as const, owner: "ada-id", defaultAddress: address, addresses: [address] } : undefined;
    const human = { id: "ada-id", kind: "human" as const, email: admin, admin: true, ...(this.organization.recovery && { recoveryAddress: this.organization.recovery }), ...(mailbox && { mailbox }) };
    // It mails the first sign-in link once, when SES sends from the domain and, in the sandbox, to a verified address.
    const to = this.organization.recovery;
    const pool = this.stack?.outputs.UserPoolId ?? "";
    if (to === undefined || this.linksMailed.includes(to) || !this.poolSenders.has(pool) || (this.sandbox && this.addresses.get(to) !== true)) return human;
    this.linksMailed.push(to);
    return { ...human, signInLink: { to, expiresAt: new Date(Date.now() + 30 * 60_000).toISOString() } };
  }

  async stackUserPools() {
    return [...this.userPools];
  }

  async signInDomain(userPoolId: string) {
    return this.poolSenders.get(userPoolId);
  }

  async deleteUserPool(id: string) {
    this.userPools.delete(id);
    this.changes.push(`deleted the user pool ${id}`);
  }

  async publishWebApp(webApp: { bucket: string; config: unknown }) {
    if (JSON.stringify(webApp) !== JSON.stringify(this.webApp)) this.changes.push("published the web app");
    this.webApp = webApp;
  }

  async emailAddressVerified(address: string) {
    return this.addresses.get(address);
  }

  async verifyEmailAddress(address: string) {
    this.addresses.set(address, false);
    this.changes.push(`asked SES to verify ${address}`);
  }

  async activeReceiptRuleSet() {
    return this.activeRuleSet;
  }

  async activateReceiptRuleSet(name: string) {
    this.activeRuleSet = name;
    this.changes.push(`activated ${name}`);
  }

  async emailIdentity(domain: string) {
    const identity = this.identities.get(domain);
    return identity && { dkimStatus: identity.dkim, mailFromStatus: identity.mailFrom, verified: identity.verified };
  }

  async sending() {
    return { sandbox: this.sandbox, perDay: this.perDay, perSecond: this.perSecond };
  }

  async organizationDomains() {
    return this.organization === undefined ? [] : [this.organization.domain, ...this.addedDomains];
  }

  async certificate(arn: string) {
    const certificate = this.certificates.get(arn);
    if (certificate === undefined) return undefined;
    const records = certificate.names.map(validation);
    if (certificate.status === "PENDING_VALIDATION" && this.certificateFailure !== undefined) Object.assign(certificate, { status: "FAILED", failure: this.certificateFailure });
    // ACM validates a certificate once DNS has the record for each of its names.
    const found = await Promise.all(records.map(async ({ name, value }) => (await this.dns.resolve("CNAME", name)).some((each) => each.replace(/\.$/, "") === value)));
    if (certificate.status === "PENDING_VALIDATION" && found.every(Boolean)) certificate.status = "ISSUED";
    return { names: certificate.names, status: certificate.status, ...(certificate.failure !== undefined && { failure: certificate.failure }), records };
  }

  async findCertificate(names: string[]) {
    const sameNames = (each: string[]) => each.length === names.length && each.every((name) => names.includes(name));
    for (const [arn, { names: covered, status, deployment }] of this.certificates) {
      if (deployment === this.region && sameNames(covered) && ["PENDING_VALIDATION", "ISSUED"].includes(status)) return arn;
    }
    return undefined;
  }

  async requestCertificate(names: string[]) {
    const arn = `arn:aws:acm:us-east-1:${this.account}:certificate/${++this.certificatesRequested}`;
    this.certificates.set(arn, { names, status: "PENDING_VALIDATION", deployment: this.region });
    this.changes.push(`requested a certificate for ${names.join(", ")}`);
    return arn;
  }

  async deleteCertificate(arn: string) {
    const certificate = this.certificates.get(arn);
    if (certificate?.deployment !== this.region) return;
    this.certificates.delete(arn);
    this.changes.push(`deleted the certificate for ${certificate.names.join(", ")}`);
  }

  private certificatesRequested = 0;
}

class InMemoryDns implements Dns {
  /** Records by "TYPE name". A failure stands for a DNS lookup that fails. */
  records = new Map<string, string[] | Error>();

  async resolve(type: "MX" | "TXT" | "CNAME", name: string) {
    const found = this.records.get(`${type} ${name}`) ?? [];
    if (found instanceof Error) throw found;
    return found;
  }
}
