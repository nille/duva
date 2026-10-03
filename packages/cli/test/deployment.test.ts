// These tests drive duva deploy's logic, with AWS and DNS replaced by in-memory stand-ins.
import { describe, expect, test } from "vitest";
import { deployDuva, type Aws, type Dns, type StackOutputs } from "../src/deployment.ts";

test("the first deploy prints every record the domain needs, none of them live yet", async () => {
  const world = newWorld();

  const report = await deployDuva({ ...world, domain: "duva.example.com" });

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

  await deployDuva({ ...world, domain: "duva.example.com" });

  expect(world.aws.activeRuleSet).toBe("Duva-Receiving");
});

test("deploy refuses, and changes nothing, when another receipt rule set is active", async () => {
  const world = newWorld();
  world.aws.activeRuleSet = "someone-elses";

  await expect(deployDuva({ ...world, domain: "duva.example.com" })).rejects.toThrow(/someone-elses/);
  expect(world.aws.changes).toEqual([]);
});

test("the first deploy asks for the domain", async () => {
  const world = newWorld();

  await expect(deployDuva(world)).rejects.toThrow(/--domain/);
  expect(world.aws.changes).toEqual([]);
});

test("re-running with the same domain changes nothing", async () => {
  const world = newWorld();
  const first = await deployDuva({ ...world, domain: "duva.example.com" });
  const changes = [...world.aws.changes];

  const again = await deployDuva({ ...world, domain: "duva.example.com" });

  expect(again).toEqual(first);
  expect(world.aws.changes).toEqual(changes);
});

test("a re-run without a domain keeps the deployed one", async () => {
  const world = newWorld();
  await deployDuva({ ...world, domain: "duva.example.com" });

  const report = await deployDuva(world);

  expect(report.domain.name).toBe("duva.example.com");
});

test("deploy refuses a different domain, since a deployment has one domain for now", async () => {
  const world = newWorld();
  await deployDuva({ ...world, domain: "duva.example.com" });
  const changes = [...world.aws.changes];

  await expect(deployDuva({ ...world, domain: "other.example.com" })).rejects.toThrow(/duva\.example\.com/);
  expect(world.aws.changes).toEqual(changes);
});

test("deploy refuses a domain whose SES identity Duva didn't create", async () => {
  const world = newWorld();
  world.aws.identities.set("duva.example.com", { dkim: "SUCCESS", mailFrom: "SUCCESS" });

  await expect(deployDuva({ ...world, domain: "duva.example.com" })).rejects.toThrow(/already has an SES identity/);
  expect(world.aws.changes).toEqual([]);
});

describe("deploy refuses a domain that isn't one, and changes nothing", () => {
  test.each(["", "example", "a..example.com", "-a.example.com", "a-.example.com", "a_b.example.com", "a b.com", "example.123", `${"a".repeat(64)}.com`])(
    "%j",
    async (domain) => {
      const world = newWorld();

      await expect(deployDuva({ ...world, domain })).rejects.toThrow(/isn't a domain/);
      expect(world.aws.changes).toEqual([]);
    },
  );
});

test.each([
  ["Duva.Example.COM.", "duva.example.com"],
  ["mejl.räksmörgås.se", "mejl.xn--rksmrgs-5wao1o.se"],
])("deploy takes %j as %j", async (given, domain) => {
  const world = newWorld();

  const report = await deployDuva({ ...world, domain: given });

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

  const report = await deployDuva({ ...world, domain: "duva.example.com" });

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

  const report = await deployDuva({ ...world, domain: "duva.example.com" });

  expect(report.domain.records[0]).toMatchObject({ status: "different", found: ["10 inbound-smtp.eu-north-1.amazonaws.com", "20 mx.other.example"] });
});

test("a DMARC record at the domain counts as live, whatever its policy", async () => {
  const world = newWorld();
  world.dns.records.set("TXT _dmarc.duva.example.com", ["v=DMARC1; p=reject; rua=mailto:d@example.com"]);

  const report = await deployDuva({ ...world, domain: "duva.example.com" });

  expect(report.domain.records.at(-1)).toMatchObject({ purpose: "DMARC", status: "live" });
});

test("two DMARC records at the domain show as different, since receivers then apply neither", async () => {
  const world = newWorld();
  world.dns.records.set("TXT _dmarc.duva.example.com", ["v=DMARC1; p=none;", "v=DMARC1; p=reject;"]);

  const report = await deployDuva({ ...world, domain: "duva.example.com" });

  expect(report.domain.records.at(-1)).toMatchObject({ status: "different", found: ["v=DMARC1; p=none;", "v=DMARC1; p=reject;"] });
});

test("deploy prints no DMARC record when a parent domain's record covers the domain", async () => {
  const world = newWorld();
  world.dns.records.set("TXT _dmarc.example.com", ["v=DMARC1; p=none;"]);

  const report = await deployDuva({ ...world, domain: "mail.duva.example.com" });

  expect(report.domain.records.map(({ purpose }) => purpose)).not.toContain("DMARC");
  expect(report.domain.dmarc).toBe("Covered by the DMARC record at _dmarc.example.com.");
});

test("a record whose lookup fails shows as unchecked, and deploy still finishes", async () => {
  const world = newWorld();
  world.dns.records.set("CNAME tok1._domainkey.duva.example.com", new Error("queryCname ESERVFAIL tok1._domainkey.duva.example.com"));

  const report = await deployDuva({ ...world, domain: "duva.example.com" });

  expect(report.domain.records[1]).toMatchObject({ status: "unchecked", error: "queryCname ESERVFAIL tok1._domainkey.duva.example.com" });
  expect(world.aws.activeRuleSet).toBe("Duva-Receiving");
});

test("deploy shows whether SES has verified the domain's DKIM and MAIL FROM", async () => {
  const world = newWorld();
  const first = await deployDuva({ ...world, domain: "duva.example.com" });
  world.aws.identities.set("duva.example.com", { dkim: "SUCCESS", mailFrom: "TEMPORARY_FAILURE" });

  const again = await deployDuva(world);

  expect([first.domain.ses, again.domain.ses]).toEqual([
    { dkim: "pending", mailFrom: "pending" },
    { dkim: "verified", mailFrom: "temporary failure" },
  ]);
});

test("in the SES sandbox, deploy says what that means for sending and how to get out", async () => {
  const world = newWorld();

  const { sending } = await deployDuva({ ...world, domain: "duva.example.com" });

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

  const { sending } = await deployDuva({ ...world, domain: "duva.example.com" });

  expect(sending).toEqual({ sandbox: false, detail: "The account has production access in eu-north-1, so Duva can send to any address. SES lets it send 50000 messages a day, 14 a second.",
  });
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
}

class InMemoryAws implements Aws {
  region = "eu-north-1";
  account = "123456789012";
  stack?: { domain?: string; outputs: StackOutputs };
  identities = new Map<string, Identity>();
  activeRuleSet?: string;
  sandbox = true;
  perDay = 200;
  perSecond = 1;
  /** Every change deploy made, in order. */
  changes: string[] = [];

  async duvaStack() {
    return this.stack;
  }

  async deployStack({ domain }: { domain: string }) {
    if (this.stack?.domain !== domain) {
      this.identities.set(domain, { dkim: "PENDING", mailFrom: "PENDING" });
      const dkim = Object.fromEntries(
        [1, 2, 3].flatMap((n) => [
          [`DkimName${n}`, `tok${n}._domainkey.${domain}`],
          [`DkimValue${n}`, `tok${n}.dkim.amazonses.com`],
        ]),
      );
      this.stack = { domain, outputs: { ApiUrl: "https://api.example", ReceiptRuleSet: "Duva-Receiving", ...dkim } };
      this.changes.push(`deployed the stack with ${domain}`);
    }
    return { account: this.account, outputs: this.stack.outputs };
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
    return identity && { dkimStatus: identity.dkim, mailFromStatus: identity.mailFrom };
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
