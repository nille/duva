// What duva deploy does in an AWS account and region, given the organization's first domain and
// first admin. AWS and DNS sit behind small interfaces: aws.ts and the API's dns-records.ts have the
// real ones. Every later domain is the API's to add and remove at run time (ADR-0018).
import { asciiDomain, type Dns, type DnsRecord, domainRecords, verification } from "@duva/api/dns-records";
import { signInSender } from "@duva/api/infrastructure";
import type { WebAppConfig } from "@duva/client";
import type { SignInConfig } from "@duva/client/sign-in";
import type { components } from "@duva/openapi";
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
  setUpOrganization(functionName: string): Promise<components["schemas"]["Human"]>;
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
  /** Asks SES to verify the email address, which SES does by mailing it a link. */
  verifyEmailAddress(address: string): Promise<void>;
  /** Whether the account is in the SES sandbox in the region, and how much SES lets it send. */
  sending(): Promise<{ sandbox: boolean; perDay: number; perSecond: number }>;
}

export async function deployDuva({ aws, dns, ...given }: { aws: Aws; dns: Dns; domain?: string; admin?: string }) {
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

  // An admin may have chosen another domain to send sign-in codes from since, which the user pool
  // already does, so the stack keeps it. Cognito refuses to send from a domain SES hasn't verified,
  // so until then the stack sends sign-in codes from Cognito.
  const userPoolId = stack?.outputs[stackOutputs.userPoolId];
  const signInDomain = (userPoolId !== undefined ? await aws.signInDomain(userPoolId) : undefined) ?? domain;
  const domainVerified = stack?.domain === domain && ((await aws.emailIdentity(signInDomain))?.verified ?? false);
  const { account, outputs } = await aws.deployStack({ domain, admin, signInDomain, domainVerified });
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
  const signIn = [
    `Sign in at ${webUrl}, or with duva login, with a code emailed to ${firstAdmin.email}`,
    domainVerified
      ? ` from ${signInSender(signInDomain)}.`
      : ` from Cognito's no-reply@verificationemail.com until SES has verified ${signInDomain}. Once it has, run duva deploy again to send codes from ${signInSender(signInDomain)}.`,
  ];
  // In the sandbox SES sends only to verified addresses, sign-in codes included.
  const adminVerified = sendingReport.sandbox ? await aws.emailAddressVerified(firstAdmin.email) : undefined;
  if (sendingReport.sandbox && adminVerified === undefined) await aws.verifyEmailAddress(firstAdmin.email);
  // Cognito's own sender isn't in the sandbox, so the link only matters once codes come from the domain.
  if (sendingReport.sandbox && !adminVerified) {
    signIn.push(
      domainVerified
        ? ` In the SES sandbox codes reach only addresses SES has verified, so SES sent ${firstAdmin.email} a link to verify it. Open it before you sign in.`
        : ` SES also sent ${firstAdmin.email} a link to verify it, which codes from ${signInSender(signInDomain)} will need while the account is in the SES sandbox.`,
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
      ...(identity === undefined
        ? { removed: `An admin removed ${domain} from the organization, so it needs no DNS records. An admin can add it again with duva domains add.` }
        : { ses: { dkim: verification(identity.dkimStatus), mailFrom: verification(identity.mailFromStatus) } }),
    } as { name: string; records: DnsRecord[]; dmarc?: string; ses?: { dkim: string; mailFrom: string }; removed?: string },
    sending: sendingReport,
    /** How the CLI signs in, for its config. */
    signIn: { url: signInUrl, clientId: output(outputs, stackOutputs.cliClientId), redirectUri: cliRedirectUri } satisfies SignInConfig,
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
