// What duva deploy does in an AWS account and region, given the organization's first domain and
// first admin, and the host on the organization's domains the web app is at, if it has one (#174).
// AWS and DNS sit behind small interfaces: aws.ts and the API's dns-records.ts have the real ones.
// Every later domain is the API's to add and remove at run time (ADR-0018).
import { callOf, defaultHarderModel, defaultMailboxAgentModel, mailboxAgentModels } from "@duva/api/agent-models";
import { asciiDomain, checkRecord, type Dns, type DnsRecord, domainRecords, mailFromDomain, verification } from "@duva/api/dns-records";
import { domainOf } from "@duva/api/email-address";
import { type SetupAnswer, signInSender } from "@duva/api/infrastructure";
import type { WebAppConfig } from "@duva/client";
import type { SignInConfig } from "@duva/client/sign-in";
import { cliRedirectUri, stackOutputs } from "@duva/infra/outputs";

export type { Dns } from "@duva/api/dns-records";

/** The Duva stack's outputs, by output name. */
export type StackOutputs = Record<string, string>;

/** What deploy gives the Duva stack when it runs. */
export interface StackParameters {
  /** The organization's first domain. */
  domain: string;
  /** The first admin's email address. */
  admin: string;
  /** The domain sign-in codes come from, the first domain until an admin chooses another. */
  signInDomain: string;
  /** Whether SES has verified the sign-in domain. Cognito can send sign-in codes from it only once SES has. */
  domainVerified: boolean;
  /** The first admin's recovery address, outside the first domain, or empty for a first admin from before recovery addresses (ADR-0041). */
  recovery: string;
  /**
   * The web app's hosts: the one it's at, then those it was at before, which still answer the links
   * sent there. None while it's on CloudFront's own domain.
   */
  webHosts: string[];
  /** The ARN of the certificate in us-east-1 that covers the web app's hosts, or empty while it has none. */
  webCertificate: string;
}

/** An ACM certificate, as deploy reads it. */
export interface Certificate {
  /** The names it covers. */
  names: string[];
  /** Its status as ACM names it, such as PENDING_VALIDATION or ISSUED. */
  status: string;
  /** Why ACM couldn't validate it, if it couldn't. */
  failure?: string;
  /** The CNAME record that validates each name, once ACM has given them. */
  records: { name: string; value: string }[];
}

export interface Aws {
  readonly region: string;
  /** The Duva stack in the region, with the parameters it was given, or undefined if there is none. */
  duvaStack(): Promise<(Partial<StackParameters> & { outputs: StackOutputs }) | undefined>;
  /**
   * Deploys the Duva stack. Where CDK isn't bootstrapped in the region, it bootstraps it first, with
   * the bootstrap stack tagged project=duva, and it tags the log group AgentCore makes with the
   * mailbox agents' runtime. Deploying what's already deployed changes nothing.
   */
  deployStack(parameters: StackParameters): Promise<{ account: string; outputs: StackOutputs }>;
  /**
   * Runs the stack's setup function, which sets up the organization with the stack's domain and
   * first admin, and returns that admin. Setting up again with the same admin changes nothing.
   * It mails the first admin their first sign-in link once SES can, and says so the time it does,
   * and gives them a mailbox at their sign-in address on the organization's domains if none has it.
   */
  setUpOrganization(functionName: string): Promise<SetupAnswer>;
  /** The IDs of the user pools the Duva stack in the region has made, those it no longer has included. */
  stackUserPools(): Promise<string[]>;
  /** The domain the user pool sends sign-in codes from, or undefined while Cognito sends them itself. */
  signInDomain(userPoolId: string): Promise<string | undefined>;
  /** Deletes the user pool and everything in it, its managed login domain first. */
  deleteUserPool(id: string): Promise<void>;
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
  /** Asks SES to verify the email address, which SES does by mailing it a link, with an identity tagged project=duva. */
  verifyEmailAddress(address: string): Promise<void>;
  /** Whether the account is in the SES sandbox in the region, and how much SES lets it send. */
  sending(): Promise<{ sandbox: boolean; perDay: number; perSecond: number }>;
  /** The organization's domains, as the deployed stack's table has them. */
  organizationDomains(): Promise<string[]>;
  /** The certificate in us-east-1, where CloudFront takes it from, or undefined if there is none. */
  certificate(arn: string): Promise<Certificate | undefined>;
  /** A certificate this deployment requested for exactly the names, which ACM has issued or still may, if there is one. */
  findCertificate(names: string[]): Promise<string | undefined>;
  /** Requests a certificate in us-east-1 for the names, validated by DNS and tagged project=duva and as this deployment's, and gives its ARN. */
  requestCertificate(names: string[]): Promise<string>;
  /** Deletes the certificate, if this deployment requested it and nothing uses it any more. */
  deleteCertificate(arn: string): Promise<void>;
}

/** What deploy works through: AWS, DNS, a way to say what a human needs to do while it runs, and a way to wait. */
export interface Deployer {
  aws: Aws;
  dns: Dns;
  say(line: string): void;
  wait(ms: number): Promise<void>;
}

/** Whether the names are the same, in any order. */
export const sameNames = (names: string[], others: string[]) => names.length === others.length && names.every((name) => others.includes(name));

/** How often deploy looks whether ACM has validated the web app's certificate, and for how long. */
const certificateCheckEvery = 15_000;
const certificateWait = 3_600_000;

/** Deploys Duva, saying what it needs a human to do while it runs, and waiting for it, as for the web app's certificate. */
export async function deployDuva({ aws, dns, say, wait, ...given }: Deployer & { domain?: string; admin?: string; recovery?: string; web?: string }) {
  const stack = await aws.duvaStack();
  const domain = given.domain === undefined ? stack?.domain : domainGiven(given.domain);
  if (domain === undefined) throw new Error("Give the organization's first domain, like duva deploy --domain example.com.");
  if (stack?.domain !== undefined && domain !== stack.domain) {
    throw new Error(
      `This deployment's first domain is ${stack.domain}, and deploy keeps it. Admins add every other domain, so add ${domain} with duva domains add, and run duva deploy without --domain.`,
    );
  }
  const admin = given.admin === undefined ? stack?.admin : emailAddress(given.admin);
  if (admin === undefined) throw new Error("Give the first admin's email address, yours, like duva deploy --admin you@example.com.");
  if (stack?.admin !== undefined && admin !== stack.admin) {
    throw new Error(`This organization's first admin is ${stack.admin}, so it can't be ${admin}. Run duva deploy without --admin.`);
  }
  // The first sign-in link goes to the recovery address, so the admin's own address may be a mailbox
  // in Duva that doesn't exist yet. A first admin from before recovery addresses has none.
  const recovery = given.recovery === undefined ? stack?.recovery || undefined : emailAddress(given.recovery);
  if (recovery === undefined && stack === undefined) {
    throw new Error("Give your recovery address, outside the domain, where Duva mails your first sign-in link, like duva deploy --recovery you@gmail.com.");
  }
  if (recovery !== undefined && domainOf(recovery) === domain) {
    throw new Error(`Your recovery address must be outside ${domain}, so a sign-in link reaches you even when you can't sign in to Duva. Give one on another domain, like a Gmail address.`);
  }
  // The first admin changes it in Settings from then on, so the stack's may be out of date.
  if (stack?.recovery && recovery !== stack.recovery) {
    throw new Error("Duva already has the first admin's recovery address, which they change in Settings. Run duva deploy without --recovery.");
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

  // A host given moves the web app there, and the hosts it had keep answering what was sent there (#174).
  const earlierHosts = stack?.webHosts ?? [];
  let webHosts = earlierHosts;
  if (given.web !== undefined) {
    const organization = stack === undefined ? [] : await aws.organizationDomains();
    const host = webHostGiven(given.web, organization.length > 0 ? organization : [domain]);
    webHosts = [host, ...earlierHosts.filter((earlier) => earlier !== host)];
  }
  // A host the web app moves to on a distribution that exists can lead to it already, while ACM
  // validates, so the web app opens there once it has moved.
  const distribution = stack?.outputs[stackOutputs.distributionDomain];
  if (distribution !== undefined) {
    for (const host of webHosts.filter((host) => !earlierHosts.includes(host))) {
      const { status } = await checkRecord(dns, { purpose: "web app", type: "CNAME", name: host, value: distribution });
      if (status !== "live") say(`Add a CNAME record at ${host} with the value ${distribution}, where the web app moves once deploy is done.`);
    }
  }
  const webCertificate = webHosts.length === 0 ? "" : await certificateFor({ aws, dns, say, wait }, webHosts, stack?.webCertificate);

  // An admin may have chosen another domain to send sign-in codes from since, which the user pool
  // already does, so the stack keeps it. Cognito refuses to send from a domain SES hasn't verified,
  // so until then the stack sends sign-in codes from Cognito.
  const userPoolId = stack?.outputs[stackOutputs.userPoolId];
  const signInDomain = (userPoolId !== undefined ? await aws.signInDomain(userPoolId) : undefined) ?? domain;
  const domainVerified = stack?.domain === domain && ((await aws.emailIdentity(signInDomain))?.verified ?? false);
  const { account, outputs } = await aws.deployStack({ domain, admin, signInDomain, domainVerified, recovery: recovery ?? "", webHosts, webCertificate });
  // ACM deletes a certificate only once CloudFront has let it go, which the deploy waited for.
  if (stack?.webCertificate && stack.webCertificate !== webCertificate) await aws.deleteCertificate(stack.webCertificate);
  const ruleSet = output(outputs, stackOutputs.receiptRuleSet);
  if (activeRuleSet !== ruleSet) await aws.activateReceiptRuleSet(ruleSet);

  // The web app signs in with the stack's app client as soon as it has one, whatever happens next.
  const apiUrl = output(outputs, stackOutputs.apiUrl);
  const webUrl = output(outputs, stackOutputs.webUrl);
  const signInUrl = output(outputs, stackOutputs.signInUrl);
  await aws.publishWebApp({
    bucket: output(outputs, stackOutputs.webBucket),
    config: { apiUrl, signIn: { url: signInUrl, clientId: output(outputs, stackOutputs.webClientId), redirectUri: `${webUrl}/` } },
  });

  const firstAdmin = await aws.setUpOrganization(output(outputs, stackOutputs.setupFunction));
  // Setup has given every human a Cognito user in the stack's user pool, so a pool the stack
  // retired holds nobody who still signs in with it (#30).
  const userPool = output(outputs, stackOutputs.userPoolId);
  for (const retired of await aws.stackUserPools()) if (retired !== userPool) await aws.deleteUserPool(retired);

  const identity = await aws.emailIdentity(domain);
  // Only an admin's removal of the first domain deletes its identity once the stack has made it.
  if (identity === undefined && stack?.domain !== domain) throw new Error(`The deployed stack made no SES identity for ${domain}.`);
  const dkim = ([1, 2, 3] as const).map((n) => ({ name: output(outputs, stackOutputs.dkimName(n)), value: output(outputs, stackOutputs.dkimValue(n)) }));
  const { records, coveredBy } = identity === undefined ? { records: [] as DnsRecord[], coveredBy: undefined } : await domainRecords(dns, { region: aws.region, domain, dkim });

  const sendingReport = await sending(aws);
  const distributionDomain = output(outputs, stackOutputs.distributionDomain);
  const web = webHosts.length === 0 ? undefined : await webRecords(aws, dns, webCertificate, webHosts, distributionDomain);
  // Once the web app has a host, CloudFront's own domain sends browsers there, sign-in links included.
  const opens = web === undefined || web.find(({ purpose, name }) => purpose === "web app" && name === webHosts[0])?.status === "live" ? "" : ` once DNS has its CNAME record to ${distributionDomain}`;
  const at = `${webUrl}${opens}`;
  const sender = signInSender(signInDomain);
  const recoveryAddress = firstAdmin.recoveryAddress;
  const codes = `with a code emailed to ${firstAdmin.email} from ${domainVerified ? sender : "Cognito's no-reply@verificationemail.com"}`;
  const signIn =
    recoveryAddress === undefined
      ? [
          `Sign in at ${at}, or with duva login, ${codes}`,
          domainVerified ? "." : ` until SES has verified ${signInDomain}. Once it has, run duva deploy again to send codes from ${sender}.`,
        ]
      : firstAdmin.signInLink !== undefined
        ? [`Duva mailed a sign-in link to ${recoveryAddress}. Follow it within 30 minutes to sign in at ${at}, then register a passkey. After that, sign in with your passkey, or ${codes}.`]
        : domainVerified
          ? [`Sign in at ${at}, or with duva login, with your passkey, or ${codes}. Without either, ask for a sign-in link on the sign-in page, which Duva mails to ${recoveryAddress}.`]
          : [`Once SES has verified ${signInDomain}, run duva deploy again, and Duva mails a sign-in link to ${recoveryAddress} from ${sender}. Until then, sign in at ${at}, or with duva login, ${codes}.`];
  // In the sandbox SES sends only to verified addresses, sign-in codes and links included. An
  // address on a domain SES has verified needs no verifying of its own.
  const unverified = async (address: string) => {
    if (!sendingReport.sandbox || domainOf(address) === domain) return false;
    const verified = await aws.emailAddressVerified(address);
    if (verified === undefined) await aws.verifyEmailAddress(address);
    return verified !== true;
  };
  // Cognito's own sender isn't in the sandbox, so the link only matters once codes come from the domain.
  if (await unverified(firstAdmin.email)) {
    signIn.push(
      domainVerified
        ? ` In the SES sandbox codes reach only addresses SES has verified, so SES sent ${firstAdmin.email} a link to verify it. Open it before you sign in.`
        : ` SES also sent ${firstAdmin.email} a link to verify it, which codes from ${sender} will need while the account is in the SES sandbox.`,
    );
  }
  // Managed login emails a code before it registers a passkey, which a first admin on the domain reads in the mailbox setup gave them (#177).
  if (recoveryAddress !== undefined && firstAdmin.mailbox !== undefined) {
    signIn.push(` Adding a passkey first asks for a code, which managed login emails to your mailbox in Duva at ${firstAdmin.email}.`);
  }
  if (recoveryAddress !== undefined && (await unverified(recoveryAddress))) {
    signIn.push(` In the SES sandbox Duva mails only addresses SES has verified, so SES sent ${recoveryAddress} a link to verify it. Open it, then run duva deploy again to mail your sign-in link there.`);
  }

  return {
    account,
    region: aws.region,
    apiUrl,
    webUrl,
    admin: { email: firstAdmin.email, ...(recoveryAddress !== undefined && { recoveryAddress }), signIn: signIn.join("") },
    domain: {
      name: domain,
      records,
      ...(coveredBy && { dmarc: `Covered by the DMARC record at ${coveredBy}.` }),
      ...(identity === undefined
        ? { removed: `An admin removed ${domain} from the organization, so it needs no DNS records. An admin can add it again with duva domains add.` }
        : { ses: { dkim: verification(identity.dkimStatus), mailFrom: verification(identity.mailFromStatus) } }),
    } as { name: string; records: DnsRecord[]; dmarc?: string; ses?: { dkim: string; mailFrom: string }; removed?: string },
    sending: sendingReport,
    ...(web !== undefined && { web: { records: web } }),
    // Said once, on the first deploy, as admins choose other models in Settings from then on.
    ...(stack === undefined && cooModels(aws.region)),
    /** How the CLI signs in, for its config. */
    signIn: { url: signInUrl, clientId: output(outputs, stackOutputs.cliClientId), redirectUri: cliRedirectUri } satisfies SignInConfig,
  };
}

/**
 * The host the web app is to be at, in lower-case ASCII. Throws unless it is under one of the
 * organization's domains, at a name that can take the CNAME record CloudFront needs.
 */
function webHostGiven(given: string, domains: string[]): string {
  const host = asciiDomain(given);
  const example = `duva.${domains[0]}`;
  if (host === undefined) throw new Error(`${JSON.stringify(given)} isn't a host name. Give one like ${example}.`);
  // DNS allows no CNAME record beside other records, as a domain's MX and SES's MAIL FROM records are.
  if (domains.includes(host)) throw new Error(`The web app can't be at ${host} itself, whose MX record leaves no room for the CNAME record CloudFront needs. Give a host under it, like duva.${host}.`);
  if (domains.some((domain) => host === mailFromDomain(domain))) {
    throw new Error(`${host} has the MAIL FROM records SES sends with, which leave no room for the CNAME record CloudFront needs. Give another host, like ${example}.`);
  }
  if (!domains.some((domain) => host.endsWith(`.${domain}`))) {
    throw new Error(`${host} isn't on one of the organization's domains, ${domains.join(", ")}. Give a host on one of them, like ${example}, or have an admin add its domain first.`);
  }
  return host;
}

/**
 * The ARN of a certificate ACM issued for exactly the hosts: the stack's, while it is one, or one
 * this deployment requested for them. For a new one, deploy says which records ACM validates it by,
 * then waits until ACM has validated it, for an hour at most. A re-run waits for the same one.
 */
async function certificateFor({ aws, dns, say, wait }: Deployer, hosts: string[], current: string | undefined): Promise<string> {
  const stackCertificate = current ? await aws.certificate(current) : undefined;
  if (current && stackCertificate?.status === "ISSUED" && sameNames(stackCertificate.names, hosts)) return current;

  const arn = (await aws.findCertificate(hosts)) ?? (await aws.requestCertificate(hosts));
  const hostsNamed = hosts.join(" and ");
  let waiting: Set<string> | undefined;
  for (let waited = 0; ; waited += certificateCheckEvery) {
    const certificate = await aws.certificate(arn);
    if (certificate === undefined) throw new Error(`ACM has no certificate ${arn} in us-east-1. Run duva deploy again for another.`);
    if (certificate.status !== "ISSUED" && certificate.status !== "PENDING_VALIDATION") {
      throw new Error(`ACM couldn't validate the web app's certificate for ${hostsNamed}: ${certificate.failure ?? certificate.status}. Fix what stopped it, and run duva deploy again for another.`);
    }
    // ACM gives each name's record moments after the request.
    const records = await Promise.all(certificate.records.map((record) => checkRecord(dns, { purpose: "certificate", type: "CNAME", ...record })));
    if (waiting !== undefined) {
      for (const { name, status } of records) if (status === "live" && waiting.delete(name)) say(`DNS has the record at ${name}.`);
    }
    if (certificate.status === "ISSUED") {
      if (waiting !== undefined) say("ACM has validated the web app's certificate.");
      return arn;
    }
    if (waiting === undefined && records.length === certificate.names.length) {
      waiting = new Set();
      for (const { name, value, status } of records) {
        if (status === "live") continue;
        waiting.add(name);
        say(`Add a CNAME record at ${name} with the value ${value}, so ACM can validate the web app's certificate for ${hostsNamed}.`);
      }
      say("Waiting until ACM has validated the web app's certificate. You can stop, and run duva deploy again, which waits for the same one.");
    }
    if (waited >= certificateWait) {
      throw new Error("ACM hasn't validated the web app's certificate in an hour. Add the records above to DNS, and run duva deploy again, which waits for the same certificate.");
    }
    await wait(certificateCheckEvery);
  }
}

/** The records the web app needs in DNS: those ACM validates its certificate by, and a CNAME to CloudFront for each host. */
async function webRecords(aws: Aws, dns: Dns, arn: string, hosts: string[], distribution: string): Promise<DnsRecord<"certificate" | "web app">[]> {
  const validation = (await aws.certificate(arn))?.records ?? [];
  return Promise.all([
    ...validation.map((record) => checkRecord(dns, { purpose: "certificate" as const, type: "CNAME" as const, ...record })),
    ...hosts.map((host) => checkRecord(dns, { purpose: "web app" as const, type: "CNAME" as const, name: host, value: distribution })),
  ]);
}

/** Where Coo's default models process what it reads of the mail, if that may be outside the deployment's continent (#158). */
function cooModels(region: string): { cooModels?: string } {
  const outside = [defaultMailboxAgentModel, defaultHarderModel].filter((model) => ["us", "anywhere"].includes(callOf(model, region).processedIn));
  if (outside.length === 0) return {};
  const name = (model: keyof typeof mailboxAgentModels) => mailboxAgentModels[model].name;
  const place = { us: "in the US", anywhere: "in any AWS region with room" }[callOf(outside[0]!, region).processedIn as "us" | "anywhere"];
  const continent = region.startsWith("eu-") ? "the EU" : "the continent Duva is deployed on";
  return {
    cooModels:
      `Coo thinks with ${name(defaultMailboxAgentModel)}, and ${name(defaultHarderModel)} for the harder work. For ${region}, Bedrock runs ${outside.map(name).join(" and ")} ${place}, ` +
      `so what Coo reads of the mail may be processed outside ${continent}. To keep it there, allow and choose other models in Settings, under Mailbox agents.`,
  };
}

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

/** The domain in lower-case ASCII, international labels in Punycode. Throws if it isn't a domain. */
function domainGiven(given: string): string {
  const domain = asciiDomain(given);
  if (domain === undefined) throw new Error(`${JSON.stringify(given)} isn't a domain. Give one like example.com.`);
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
    return `${local}@${domainGiven(address.slice(at + 1))}`;
  } catch {
    throw notAnAddress;
  }
}

function output(outputs: StackOutputs, name: string): string {
  const value = outputs[name];
  if (value === undefined) throw new Error(`The deployed stack has no ${name} output.`);
  return value;
}
