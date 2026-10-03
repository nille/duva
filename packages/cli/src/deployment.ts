// What duva deploy does in an AWS account and region, given the organization's first domain and
// first admin. AWS and DNS sit behind the small interfaces below: aws.ts and dns.ts are the real ones.
import { domainToASCII } from "node:url";
import type { WebAppConfig } from "@duva/client";
import type { SignInConfig } from "@duva/client/sign-in";
import type { components } from "@duva/openapi";
import { cliRedirectUri, signInSender, stackOutputs } from "@duva/infra/outputs";

/** The Duva stack's outputs, by output name. */
export type StackOutputs = Record<string, string>;

/** What deploy gives the Duva stack when it runs. */
export interface StackParameters {
  /** The organization's first domain. */
  domain: string;
  /** The first admin's email address. */
  admin: string;
  /** Whether SES has verified the domain. Cognito can send sign-in codes from it only once SES has. */
  domainVerified: boolean;
}

export interface Aws {
  readonly region: string;
  /** The Duva stack in the region, with the parameters it was given, or undefined if there is none. */
  duvaStack(): Promise<(Partial<StackParameters> & { outputs: StackOutputs }) | undefined>;
  /** Deploys the Duva stack. Deploying what's already deployed changes nothing. */
  deployStack(parameters: StackParameters): Promise<{ account: string; outputs: StackOutputs }>;
  /**
   * Runs the stack's setup function, which sets up the organization with the stack's domain and
   * first admin, and returns that admin. Setting up again with the same admin changes nothing.
   */
  setUpOrganization(functionName: string): Promise<components["schemas"]["Actor"]>;
  /** Uploads the web app this CLI version bundles to the bucket, with its config. */
  publishWebApp(webApp: { bucket: string; config: WebAppConfig }): Promise<void>;
  /** The name of the region's active receipt rule set, or undefined if none is active. */
  activeReceiptRuleSet(): Promise<string | undefined>;
  activateReceiptRuleSet(name: string): Promise<void>;
  /**
   * The domain's SES identity, or undefined if there is none: whether SES has verified it, and its
   * DKIM and MAIL FROM statuses as SES names them.
   */
  emailIdentity(domain: string): Promise<{ dkimStatus: string; mailFromStatus: string; verified: boolean } | undefined>;
  /** Whether SES has verified the email address, or undefined if SES has no identity for it. */
  emailAddressVerified(address: string): Promise<boolean | undefined>;
  /** Asks SES to verify the email address, which SES does by mailing it a link. */
  verifyEmailAddress(address: string): Promise<void>;
  /** Whether the account is in the SES sandbox in the region, and how much SES lets it send. */
  sending(): Promise<{ sandbox: boolean; perDay: number; perSecond: number }>;
}

export interface Dns {
  /**
   * The records of the type at the name: MX as "priority host", TXT with its strings joined.
   * Empty when there are none. Throws when the lookup fails.
   */
  resolve(type: RecordType, name: string): Promise<string[]>;
}

type RecordType = "MX" | "TXT" | "CNAME";

export interface DnsRecord {
  /** What SES needs the record for. */
  purpose: "receiving" | "DKIM" | "MAIL FROM" | "DMARC";
  type: RecordType;
  name: string;
  value: string;
  /** Whether DNS answers with the value. "different" lists what it found, "unchecked" why the lookup failed. */
  status: "live" | "missing" | "different" | "unchecked";
  found?: string[];
  error?: string;
}

/** The MAIL FROM subdomain's label: mail from Duva bounces to mail.<domain>. */
const mailFromLabel = "mail";

export async function deployDuva({ aws, dns, ...given }: { aws: Aws; dns: Dns; domain?: string; admin?: string }) {
  const stack = await aws.duvaStack();
  const domain = given.domain === undefined ? stack?.domain : asciiDomain(given.domain);
  if (domain === undefined) throw new Error("Give the organization's first domain, like duva deploy --domain example.com.");
  if (stack?.domain !== undefined && domain !== stack.domain) {
    throw new Error(`This deployment's domain is ${stack.domain}. For now a deployment has only one, so it can't take ${domain}. Run duva deploy without --domain.`);
  }
  const admin = given.admin === undefined ? stack?.admin : emailAddress(given.admin);
  if (admin === undefined) throw new Error("Give the first admin's email address, yours, like duva deploy --admin you@example.com.");
  if (stack?.admin !== undefined && admin !== stack.admin) {
    throw new Error(`This organization's first admin is ${stack.admin}, so it can't be ${admin}. Run duva deploy without --admin.`);
  }
  // Duva has no mailboxes for humans yet, so mail to an address on the domain reaches nobody.
  if (admin.endsWith(`@${domain}`)) {
    throw new Error(`Duva can't deliver mail to ${admin} yet, so its sign-in codes wouldn't reach you. Give an address on another domain.`);
  }
  // CloudFormation can't take over an identity it didn't create, and someone else may send with it.
  if (stack?.domain !== domain && (await aws.emailIdentity(domain)) !== undefined) {
    throw new Error(
      `${domain} already has an SES identity in ${aws.region}, which Duva didn't create. ` +
        "Use another domain, or delete that identity if nothing sends with it.",
    );
  }

  // Only one rule set is active per account and region. Taking over another would break mail flow
  // someone else set up.
  const activeRuleSet = await aws.activeReceiptRuleSet();
  if (activeRuleSet !== undefined && activeRuleSet !== stack?.outputs[stackOutputs.receiptRuleSet]) {
    throw new Error(
      `The receipt rule set ${activeRuleSet} is already active in ${aws.region}, and SES allows only one. ` +
        "Deploy Duva in another region, or deactivate that rule set if nothing needs it.",
    );
  }

  // Cognito refuses to send from a domain SES hasn't verified, so until then the stack sends sign-in codes from Cognito.
  const domainVerified = stack?.domain === domain && ((await aws.emailIdentity(domain))?.verified ?? false);
  const { account, outputs } = await aws.deployStack({ domain, admin, domainVerified });
  const ruleSet = output(outputs, stackOutputs.receiptRuleSet);
  if (activeRuleSet !== ruleSet) await aws.activateReceiptRuleSet(ruleSet);

  const firstAdmin = await aws.setUpOrganization(output(outputs, stackOutputs.setupFunction));
  const apiUrl = output(outputs, stackOutputs.apiUrl);
  const webUrl = output(outputs, stackOutputs.webUrl);
  const signInUrl = output(outputs, stackOutputs.signInUrl);
  await aws.publishWebApp({
    bucket: output(outputs, stackOutputs.webBucket),
    config: { apiUrl, signIn: { url: signInUrl, clientId: output(outputs, stackOutputs.webClientId), redirectUri: `${webUrl}/` } },
  });

  const wanted: Wanted[] = [
    { purpose: "receiving", type: "MX", name: domain, value: `10 inbound-smtp.${aws.region}.amazonaws.com` },
    ...([1, 2, 3] as const).map((n) => ({
      purpose: "DKIM" as const,
      type: "CNAME" as const,
      name: output(outputs, stackOutputs.dkimName(n)),
      value: output(outputs, stackOutputs.dkimValue(n)),
    })),
    { purpose: "MAIL FROM", type: "MX", name: `${mailFromLabel}.${domain}`, value: `10 feedback-smtp.${aws.region}.amazonses.com` },
    { purpose: "MAIL FROM", type: "TXT", name: `${mailFromLabel}.${domain}`, value: "v=spf1 include:amazonses.com ~all" },
  ];
  const records = await Promise.all(wanted.map((record) => check(dns, record)));

  // The domain needs a DMARC record of its own only if none covers it from a parent domain.
  const dmarc = await check(dns, { purpose: "DMARC", type: "TXT", name: `_dmarc.${domain}`, value: "v=DMARC1; p=none;" });
  const coveredBy = dmarc.status === "missing" ? await parentDmarc(dns, domain) : undefined;
  if (coveredBy === undefined) records.push(dmarc);

  const identity = await aws.emailIdentity(domain);
  if (identity === undefined) throw new Error(`The deployed stack made no SES identity for ${domain}.`);

  const sendingReport = await sending(aws);
  const signIn = [
    `Sign in at ${webUrl}, or with duva login, with a code emailed to ${firstAdmin.email}`,
    domainVerified
      ? ` from ${signInSender(domain)}.`
      : ` from Cognito's no-reply@verificationemail.com until SES has verified ${domain}. Once it has, run duva deploy again to send codes from ${signInSender(domain)}.`,
  ];
  // In the sandbox SES sends only to verified addresses, sign-in codes included.
  const adminVerified = sendingReport.sandbox ? await aws.emailAddressVerified(firstAdmin.email) : undefined;
  if (sendingReport.sandbox && adminVerified === undefined) await aws.verifyEmailAddress(firstAdmin.email);
  if (sendingReport.sandbox && !adminVerified) {
    signIn.push(
      ` In the SES sandbox codes reach only addresses SES has verified, so SES sent ${firstAdmin.email} a link to verify it. ` +
        "Open it before you sign in.",
    );
  }

  return {
    account,
    region: aws.region,
    apiUrl,
    webUrl,
    admin: { email: firstAdmin.email, signIn: signIn.join("") },
    domain: {
      name: domain,
      records,
      ...(coveredBy && { dmarc: `Covered by the DMARC record at ${coveredBy}.` }),
      ses: { dkim: verification(identity.dkimStatus), mailFrom: verification(identity.mailFromStatus) },
    },
    sending: sendingReport,
    /** How the CLI signs in, for its config. */
    signIn: { url: signInUrl, clientId: output(outputs, stackOutputs.cliClientId), redirectUri: cliRedirectUri } satisfies SignInConfig,
  };
}

/** An SES verification status, like TEMPORARY_FAILURE, in words: temporary failure. SUCCESS reads as verified. */
const verification = (status: string) => (status === "SUCCESS" ? "verified" : status.toLowerCase().replaceAll("_", " "));

async function sending(aws: Aws) {
  const { sandbox, perDay, perSecond } = await aws.sending();
  const quota = `SES lets it send ${perDay} messages a day, ${perSecond} a second.`;
  if (!sandbox) {
    return { sandbox, detail: `The account has production access in ${aws.region}, so Duva can send to any address. ${quota}` };
  }
  return {
    sandbox,
    detail:
      `The account is in the SES sandbox in ${aws.region}, so Duva can send only to verified addresses. ${quota} ` +
      "Receiving works as usual. To send to anyone, request production access at " +
      `https://${aws.region}.console.aws.amazon.com/ses/home?region=${aws.region}#/account.`,
  };
}

type Wanted = Omit<DnsRecord, "status" | "found" | "error">;

/** The record with whether DNS answers with it. */
async function check(dns: Dns, record: Wanted): Promise<DnsRecord> {
  let found: string[];
  try {
    found = await dns.resolve(record.type, record.name);
  } catch (error) {
    return { ...record, status: "unchecked", error: error instanceof Error ? error.message : String(error) };
  }
  // Of a name's TXT records, only those of the same kind (SPF or DMARC) can stand in for it.
  if (record.type === "TXT") found = found.filter((text) => kind(text) === kind(record.value));
  if (found.length === 0) return { ...record, status: "missing" };
  // Any one DMARC policy is the organization's choice, but receivers ignore a name with two. Anything
  // else must be exactly what SES needs, and an MX with other mail servers next to SES's sends some
  // mail elsewhere.
  const live =
    record.purpose === "DMARC" ? found.length === 1 : found.every((value) => sameValue(record.type, value, record.value));
  return live ? { ...record, status: "live" } : { ...record, status: "different", found };
}

/** What a TXT record is, from its first tag, like v=spf1. */
const kind = (text: string) => text.split(/[\s;]/, 1)[0]?.toLowerCase();

function sameValue(type: RecordType, found: string, wanted: string): boolean {
  if (type === "TXT") return found === wanted;
  const host = (value: string) => value.toLowerCase().replace(/\.$/, "");
  // An MX record's priority doesn't matter while SES's server is the only one.
  if (type === "MX") return host(found.split(" ").at(-1) ?? "") === host(wanted.split(" ").at(-1) ?? "");
  return host(found) === host(wanted);
}

/**
 * The name of the nearest parent domain's DMARC record, which covers the domain too, or undefined if
 * there is none. Walks up to the domain below the top level, as DMARCbis receivers do. Receivers that
 * follow RFC 7489 look only at the organizational domain, which needs the Public Suffix List, so for
 * a.b.example.com they'd skip a record at b.example.com that this counts.
 */
async function parentDmarc(dns: Dns, domain: string): Promise<string | undefined> {
  const labels = domain.split(".");
  for (let start = 1; start < labels.length - 1; start++) {
    const name = `_dmarc.${labels.slice(start).join(".")}`;
    // A failed lookup counts as no record, so deploy may print a DMARC record the domain doesn't need.
    const found = await dns.resolve("TXT", name).catch(() => []);
    if (found.some((text) => kind(text) === "v=dmarc1")) return name;
  }
  return undefined;
}

/** The domain in lower-case ASCII, international labels in Punycode. Throws if it isn't a domain. */
function asciiDomain(given: string): string {
  const domain = domainToASCII(given.replace(/\.$/, ""));
  const labels = domain.split(".");
  // domainToASCII accepts some names that aren't domains, like a..b, so check every label too.
  const valid =
    domain.length <= 253 &&
    labels.length >= 2 &&
    labels.every((label) => /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) &&
    !/^[0-9]+$/.test(labels.at(-1) ?? "");
  if (!valid) throw new Error(`${JSON.stringify(given)} isn't a domain. Give one like example.com.`);
  return domain;
}

/**
 * The email address, its domain in lower-case ASCII. Throws if it isn't an email address. The
 * local part is kept as given, since only the receiving server may read it case-insensitively.
 */
function emailAddress(given: string): string {
  const address = given.trim();
  const at = address.lastIndexOf("@");
  const local = address.slice(0, at);
  const notAnAddress = new Error(`${JSON.stringify(given)} isn't an email address. Give one like you@example.com.`);
  if (at < 1 || !/^[^\s@"]{1,64}$/.test(local)) throw notAnAddress;
  try {
    return `${local}@${asciiDomain(address.slice(at + 1))}`;
  } catch {
    throw notAnAddress;
  }
}

function output(outputs: StackOutputs, name: string): string {
  const value = outputs[name];
  if (value === undefined) throw new Error(`The deployed stack has no ${name} output.`);
  return value;
}
