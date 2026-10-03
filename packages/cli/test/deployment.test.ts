// These tests drive duva deploy's logic, with AWS and DNS replaced by in-memory stand-ins.
import { describe, expect, test } from "vitest";
import { deployDuva, type Aws, type Dns, type StackOutputs } from "../src/deployment.ts";

/** The first admin's address, on a domain other than the deployment's. */
const admin = "ada@example.org";

test("the first deploy prints every record the domain needs, none of them live yet", async () => {
  const world = newWorld();

  const report = await deployDuva({ ...world, admin, domain: "duva.example.com" });

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

  await deployDuva({ ...world, admin, domain: "duva.example.com" });

  expect(world.aws.activeRuleSet).toBe("Duva-Receiving");
});

test("deploy refuses, and changes nothing, when another receipt rule set is active", async () => {
  const world = newWorld();
  world.aws.activeRuleSet = "someone-elses";

  await expect(deployDuva({ ...world, admin, domain: "duva.example.com" })).rejects.toThrow(/someone-elses/);
  expect(world.aws.changes).toEqual([]);
});

test("the first deploy asks for the domain", async () => {
  const world = newWorld();

  await expect(deployDuva(world)).rejects.toThrow(/--domain/);
  expect(world.aws.changes).toEqual([]);
});

test("re-running with the same domain changes nothing", async () => {
  const world = newWorld();
  const first = await deployDuva({ ...world, admin, domain: "duva.example.com" });
  const changes = [...world.aws.changes];

  const again = await deployDuva({ ...world, admin, domain: "duva.example.com" });

  expect(again).toEqual(first);
  expect(world.aws.changes).toEqual(changes);
});

test("a re-run without a domain keeps the deployed one", async () => {
  const world = newWorld();
  await deployDuva({ ...world, admin, domain: "duva.example.com" });

  const report = await deployDuva(world);

  expect(report.domain.name).toBe("duva.example.com");
});

test("deploy refuses a different domain, since a deployment has one domain for now", async () => {
  const world = newWorld();
  await deployDuva({ ...world, admin, domain: "duva.example.com" });
  const changes = [...world.aws.changes];

  await expect(deployDuva({ ...world, admin, domain: "other.example.com" })).rejects.toThrow(/duva\.example\.com/);
  expect(world.aws.changes).toEqual(changes);
});

test("deploy refuses a domain whose SES identity Duva didn't create", async () => {
  const world = newWorld();
  world.aws.identities.set("duva.example.com", { dkim: "SUCCESS", mailFrom: "SUCCESS", verified: true });

  await expect(deployDuva({ ...world, admin, domain: "duva.example.com" })).rejects.toThrow(/already has an SES identity/);
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

  const report = await deployDuva({ ...world, admin, domain: given });

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

  const report = await deployDuva({ ...world, admin, domain: "duva.example.com" });

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

  const report = await deployDuva({ ...world, admin, domain: "duva.example.com" });

  expect(report.domain.records[0]).toMatchObject({ status: "different", found: ["10 inbound-smtp.eu-north-1.amazonaws.com", "20 mx.other.example"] });
});

test("a DMARC record at the domain counts as live, whatever its policy", async () => {
  const world = newWorld();
  world.dns.records.set("TXT _dmarc.duva.example.com", ["v=DMARC1; p=reject; rua=mailto:d@example.com"]);

  const report = await deployDuva({ ...world, admin, domain: "duva.example.com" });

  expect(report.domain.records.at(-1)).toMatchObject({ purpose: "DMARC", status: "live" });
});

test("two DMARC records at the domain show as different, since receivers then apply neither", async () => {
  const world = newWorld();
  world.dns.records.set("TXT _dmarc.duva.example.com", ["v=DMARC1; p=none;", "v=DMARC1; p=reject;"]);

  const report = await deployDuva({ ...world, admin, domain: "duva.example.com" });

  expect(report.domain.records.at(-1)).toMatchObject({ status: "different", found: ["v=DMARC1; p=none;", "v=DMARC1; p=reject;"] });
});

test("deploy prints no DMARC record when a parent domain's record covers the domain", async () => {
  const world = newWorld();
  world.dns.records.set("TXT _dmarc.example.com", ["v=DMARC1; p=none;"]);

  const report = await deployDuva({ ...world, admin, domain: "mail.duva.example.com" });

  expect(report.domain.records.map(({ purpose }) => purpose)).not.toContain("DMARC");
  expect(report.domain.dmarc).toBe("Covered by the DMARC record at _dmarc.example.com.");
});

test("a record whose lookup fails shows as unchecked, and deploy still finishes", async () => {
  const world = newWorld();
  world.dns.records.set("CNAME tok1._domainkey.duva.example.com", new Error("queryCname ESERVFAIL tok1._domainkey.duva.example.com"));

  const report = await deployDuva({ ...world, admin, domain: "duva.example.com" });

  expect(report.domain.records[1]).toMatchObject({ status: "unchecked", error: "queryCname ESERVFAIL tok1._domainkey.duva.example.com" });
  expect(world.aws.activeRuleSet).toBe("Duva-Receiving");
});

test("deploy shows whether SES has verified the domain's DKIM and MAIL FROM", async () => {
  const world = newWorld();
  const first = await deployDuva({ ...world, admin, domain: "duva.example.com" });
  world.aws.identities.set("duva.example.com", { dkim: "SUCCESS", mailFrom: "TEMPORARY_FAILURE", verified: true });

  const again = await deployDuva(world);

  expect([first.domain.ses, again.domain.ses]).toEqual([
    { dkim: "pending", mailFrom: "pending" },
    { dkim: "verified", mailFrom: "temporary failure" },
  ]);
});

test("in the SES sandbox, deploy says what that means for sending and how to get out", async () => {
  const world = newWorld();

  const { sending } = await deployDuva({ ...world, admin, domain: "duva.example.com" });

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

  const { sending } = await deployDuva({ ...world, admin, domain: "duva.example.com" });

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

  const report = await deployDuva({ ...world, domain: "duva.example.com", admin: "ada@example.org" });

  expect(world.aws.organization).toEqual({ domain: "duva.example.com", admin: "ada@example.org" });
  expect(report.admin.email).toBe("ada@example.org");
});

test("a re-run without an admin keeps the first one", async () => {
  const world = newWorld();
  await deployDuva({ ...world, domain: "duva.example.com", admin: "ada@example.org" });
  const changes = [...world.aws.changes];

  const report = await deployDuva(world);

  expect(report.admin.email).toBe("ada@example.org");
  expect(world.aws.changes).toEqual(changes);
});

test("deploy refuses another first admin, and changes nothing", async () => {
  const world = newWorld();
  await deployDuva({ ...world, domain: "duva.example.com", admin: "ada@example.org" });
  const changes = [...world.aws.changes];

  await expect(deployDuva({ ...world, admin: "bo@example.org" })).rejects.toThrow(/ada@example\.org/);
  expect(world.aws.changes).toEqual(changes);
});

test("deploy takes the admin's address with its domain in lower case", async () => {
  const world = newWorld();

  const report = await deployDuva({ ...world, domain: "duva.example.com", admin: " Ada@Example.ORG " });

  expect(report.admin.email).toBe("Ada@example.org");
});

describe("deploy refuses an admin address that isn't one, and changes nothing", () => {
  test.each(["", "ada", "ada@", "@example.org", "ada@example", "ada@@example.org", "a da@example.org"])("%j", async (address) => {
    const world = newWorld();

    await expect(deployDuva({ ...world, domain: "duva.example.com", admin: address })).rejects.toThrow(/isn't an email address/);
    expect(world.aws.changes).toEqual([]);
  });
});

test("deploy refuses an admin address on the deployment's domain, where no mail reaches the admin yet", async () => {
  const world = newWorld();

  await expect(deployDuva({ ...world, domain: "duva.example.com", admin: "ada@duva.example.com" })).rejects.toThrow(/another domain/);
  expect(world.aws.changes).toEqual([]);
});

test("deploy publishes the web app with how it reaches the API and signs in", async () => {
  const world = newWorld();

  const report = await deployDuva({ ...world, admin, domain: "duva.example.com" });

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

  const { signIn } = await deployDuva({ ...world, admin, domain: "duva.example.com" });

  expect(signIn).toEqual({ url: "https://sign-in.example", clientId: "cli-client", redirectUri: "http://127.0.0.1:8976/callback" });
});

test("in the SES sandbox, deploy asks SES to verify the admin's address and says to confirm it", async () => {
  const world = newWorld();

  const report = await deployDuva({ ...world, domain: "duva.example.com", admin: "ada@example.org" });

  expect(world.aws.changes).toContain("asked SES to verify ada@example.org");
  expect(report.admin.signIn).toMatch(/SES sent ada@example\.org a link.*open it/i);
});

test("a re-run in the sandbox doesn't ask SES to verify the admin's address again", async () => {
  const world = newWorld();
  await deployDuva({ ...world, domain: "duva.example.com", admin: "ada@example.org" });
  world.aws.addresses.set("ada@example.org", true);
  const changes = [...world.aws.changes];

  const report = await deployDuva(world);

  expect(world.aws.changes).toEqual(changes);
  expect(report.admin.signIn).not.toMatch(/SES sent/);
});

test("with production access, deploy doesn't ask SES to verify the admin's address", async () => {
  const world = newWorld();
  world.aws.sandbox = false;

  await deployDuva({ ...world, domain: "duva.example.com", admin: "ada@example.org" });

  expect(world.aws.changes).not.toContain("asked SES to verify ada@example.org");
});

test("until SES has verified the domain, the stack sends sign-in codes from Cognito, and deploy says so", async () => {
  const world = newWorld();

  const report = await deployDuva({ ...world, admin, domain: "duva.example.com" });

  expect(world.aws.stack?.domainVerified).toBe(false);
  expect(report.admin.signIn).toMatch(/no-reply@verificationemail\.com until SES has verified duva\.example\.com.*duva deploy again/);
});

test("once SES has verified the domain, a re-run sends sign-in codes from it", async () => {
  const world = newWorld();
  await deployDuva({ ...world, admin, domain: "duva.example.com" });
  world.aws.identities.set("duva.example.com", { dkim: "SUCCESS", mailFrom: "SUCCESS", verified: true });

  const report = await deployDuva(world);

  expect(world.aws.stack?.domainVerified).toBe(true);
  expect(report.admin.signIn).toMatch(/from no-reply@duva\.example\.com/);
});

/**
 * An AWS account and region with nothing of Duva's in it, and DNS with no records. SES gives a new
 * domain identity the DKIM tokens tok1, tok2 and tok3.
 */
function newWorld() {
  const aws = new InMemoryAws();
  const dns = new InMemoryDns();
  return { aws, dns };
}

interface Identity {
  dkim: string;
  mailFrom: string;
  verified: boolean;
}

interface Parameters {
  domain: string;
  admin: string;
  domainVerified: boolean;
}

class InMemoryAws implements Aws {
  region = "eu-north-1";
  account = "123456789012";
  stack?: Partial<Parameters> & { outputs: StackOutputs };
  identities = new Map<string, Identity>();
  /** Whether SES has verified each email address it has an identity for. */
  addresses = new Map<string, boolean>();
  /** The organization that the stack's setup set up. */
  organization?: { domain: string; admin: string };
  /** What deploy published to the web app's bucket. */
  webApp?: { bucket: string; config: unknown };
  activeRuleSet?: string;
  sandbox = true;
  perDay = 200;
  perSecond = 1;
  /** Every change deploy made, in order. */
  changes: string[] = [];

  async duvaStack() {
    return this.stack;
  }

  async deployStack(parameters: Parameters) {
    const { domain, admin, domainVerified } = parameters;
    if (this.stack?.domain !== domain) this.identities.set(domain, { dkim: "PENDING", mailFrom: "PENDING", verified: false });
    if (this.stack?.domain !== domain || this.stack.admin !== admin || this.stack.domainVerified !== domainVerified) {
      const dkim = Object.fromEntries(
        [1, 2, 3].flatMap((n) => [
          [`DkimName${n}`, `tok${n}._domainkey.${domain}`],
          [`DkimValue${n}`, `tok${n}.dkim.amazonses.com`],
        ]),
      );
      const outputs = {
        ApiUrl: "https://api.example",
        ReceiptRuleSet: "Duva-Receiving",
        WebUrl: "https://web.example",
        WebBucket: "duva-web",
        SignInUrl: "https://sign-in.example",
        WebClientId: "web-client",
        CliClientId: "cli-client",
        SetupFunction: "duva-setup",
        ...dkim,
      };
      this.stack = { ...parameters, outputs };
      this.changes.push(`deployed the stack with ${JSON.stringify(parameters)}`);
    }
    return { account: this.account, outputs: this.stack.outputs };
  }

  async setUpOrganization(functionName: string) {
    const { domain, admin } = this.stack ?? {};
    if (functionName !== "duva-setup" || domain === undefined || admin === undefined) throw new Error("No setup function");
    if (this.organization === undefined) {
      this.organization = { domain, admin };
      this.changes.push(`set up the organization with ${admin}`);
    }
    if (this.organization.admin !== admin) throw new Error(`The organization's first admin is ${this.organization.admin}`);
    return { id: "ada-id", kind: "human" as const, email: admin, admin: true };
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
