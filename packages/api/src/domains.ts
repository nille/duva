// Admins add and remove the organization's domains at run time, standalone or alias, and choose the
// one sign-in codes come from (ADR-0018). Each domain is an SES identity that the API creates and
// deletes. Duva shows the DNS records each needs and checks them, but never changes anyone's DNS.
import type { components } from "@duva/openapi";
import { jsonBody, type OperationHandler, refusal } from "./api.ts";
import type { Deployment } from "./deployment.ts";
import { asciiDomain, dkimRecord, domainRecords, verification } from "./dns-records.ts";
import {
  addDomain as addStoredDomain,
  allAddresses,
  allDomains,
  allMailboxes,
  DomainTaken,
  findMailbox,
  NotStandalone,
  type OrganizationDomain,
  organizationDomain,
  receivingAddresses,
  recordSignInDomain,
  removeAddress,
  removeDomains,
  removeGroup,
  removeMember,
  type Address,
} from "./organization.ts";
import { maxAddresses, syncRecipients } from "./receiving.ts";

type Domain = components["schemas"]["Domain"];
type DnsRecord = components["schemas"]["DnsRecord"];

const onlyAdmins = () => refusal(403, "Only admins can change the organization's domains. Ask an admin to.");

/** The domain sign-in codes come from: the user pool's, or the first domain's while Cognito sends them until SES verifies it. */
async function signInDomain(deployment: Deployment): Promise<string> {
  return (await deployment.signInSender.domain()) ?? (await organizationDomain(deployment.table));
}

/** The domain with its DNS records, each looked up now, and what SES has verified of it. */
async function domainView(deployment: Deployment, { domain, aliasOf }: OrganizationDomain, signIn: string): Promise<Domain> {
  const identity = await deployment.identities.get(domain);
  const dkim = (identity?.dkimTokens ?? []).map((token) => dkimRecord(domain, token));
  const { records } = await domainRecords(deployment.dns, { region: deployment.region, domain, dkim });
  // A record SES verified is one DNS still answers with, and SES verified what it is for.
  const verified = (purpose: DnsRecord["purpose"]) =>
    (purpose === "DKIM" && identity?.dkimStatus === "SUCCESS") || (purpose === "MAIL FROM" && identity?.mailFromStatus === "SUCCESS");
  return {
    domain,
    kind: aliasOf === undefined ? "standalone" : "alias",
    ...(aliasOf !== undefined && { aliasOf }),
    signIn: domain === signIn,
    ses: {
      verified: identity?.verified ?? false,
      dkim: verification(identity?.dkimStatus ?? "NOT_STARTED"),
      mailFrom: verification(identity?.mailFromStatus ?? "NOT_STARTED"),
    },
    records: records.map(({ purpose, type, name, value, status, found }) => ({
      purpose,
      type,
      name,
      value,
      status: status !== "live" ? "missing" : verified(purpose) ? "verified" : "found",
      ...(found !== undefined && { found }),
    })),
  };
}

/** The organization's domain the call's path names, or a refusal if it has none. */
async function domainAsked(event: Parameters<OperationHandler>[0], deployment: Deployment): Promise<OrganizationDomain | ReturnType<typeof refusal>> {
  const given = event.pathParameters?.domain ?? "";
  const name = asciiDomain(given);
  const domain = (await allDomains(deployment.table)).find((each) => each.domain === name);
  if (domain === undefined) return refusal(404, `The organization has no domain ${JSON.stringify(given)}. List its domains to find it.`);
  return domain;
}

export const addDomain: OperationHandler = async (event, deployment, actor) => {
  if (!actor?.admin) return onlyAdmins();
  const body = jsonBody(event) ?? {};
  const domain = typeof body.domain === "string" ? asciiDomain(body.domain) : undefined;
  if (domain === undefined) return refusal(400, `${JSON.stringify(body.domain ?? "")} isn't a domain. Give one like example.net.`);
  const domains = await allDomains(deployment.table);
  let aliasOf: string | undefined;
  if (body.aliasOf !== undefined) {
    aliasOf = typeof body.aliasOf === "string" ? asciiDomain(body.aliasOf) : undefined;
    const standalone = domains.filter((each) => each.aliasOf === undefined).map((each) => each.domain);
    if (aliasOf === undefined || !standalone.includes(aliasOf)) {
      return refusal(400, `An alias domain mirrors one of the organization's standalone domains, ${standalone.join(", ")}. Give one of them as aliasOf.`);
    }
    // Each address on the standalone domain is mirrored, and SES's receipt rules list each.
    const mirrored = (await allAddresses(deployment.table)).filter(({ address }) => address.endsWith(`@${aliasOf}`)).length;
    if ((await receivingAddresses(deployment.table)).length + mirrored > maxAddresses) {
      return refusal(409, `${domain} would mirror ${mirrored} addresses, and the organization can receive mail for at most ${maxAddresses}. Remove addresses first.`);
    }
  }
  const taken = () => refusal(409, `The organization already has ${domain}. List its domains to see its DNS records.`);
  if (domains.some((each) => each.domain === domain)) {
    // In case SES failed when it was added.
    if ((await deployment.identities.get(domain)) === undefined) await deployment.identities.create(domain);
    return taken();
  }
  // Someone else may send with an identity Duva didn't create.
  if ((await deployment.identities.get(domain)) !== undefined) {
    return refusal(409, `${domain} already has an SES identity in ${deployment.region}, which Duva didn't create. Use another domain, or delete that identity if nothing sends with it.`);
  }
  try {
    await addStoredDomain(deployment.table, { domain, aliasOf, by: actor.id });
  } catch (error) {
    if (error instanceof DomainTaken) return taken();
    if (error instanceof NotStandalone) return refusal(409, `${aliasOf} was removed meanwhile, or is no longer a standalone domain. List the domains and try again.`);
    throw error;
  }
  await deployment.identities.create(domain);
  // An alias domain's addresses are those it mirrors.
  if (aliasOf !== undefined) await syncRecipients(deployment.table, deployment.receiving);
  return { statusCode: 201, body: await domainView(deployment, { domain, ...(aliasOf !== undefined && { aliasOf }) }, await signInDomain(deployment)) };
};

export const listDomains: OperationHandler = async (_event, deployment, actor) => {
  if (!actor?.admin) return refusal(403, "Only admins can list the organization's domains.");
  const signIn = await signInDomain(deployment);
  const domains = await Promise.all((await allDomains(deployment.table)).map((domain) => domainView(deployment, domain, signIn)));
  return { statusCode: 200, body: { domains } satisfies components["schemas"]["DomainList"] };
};

export const getDomain: OperationHandler = async (event, deployment, actor) => {
  if (!actor?.admin) return refusal(403, "Only admins can read the organization's domains.");
  const domain = await domainAsked(event, deployment);
  if ("statusCode" in domain) return domain;
  return { statusCode: 200, body: await domainView(deployment, domain, await signInDomain(deployment)) };
};

export const changeDomain: OperationHandler = async (event, deployment, actor) => {
  if (!actor?.admin) return refusal(403, "Only admins can choose the domain sign-in codes come from. Ask an admin to.");
  const domain = await domainAsked(event, deployment);
  if ("statusCode" in domain) return domain;
  if (jsonBody(event)?.signIn !== true) return refusal(400, "Give signIn as true to send sign-in codes from the domain. To stop, choose another domain.");
  // While Cognito sends the codes itself, choosing the first domain moves them to it.
  if ((await deployment.signInSender.domain()) !== domain.domain) {
    // Cognito refuses a domain SES hasn't verified.
    if (!(await deployment.identities.get(domain.domain))?.verified) {
      return refusal(409, `SES hasn't verified ${domain.domain} yet, so sign-in codes can't come from it. Add its DNS records, and choose it once SES shows it verified.`);
    }
    await deployment.signInSender.sendFrom(domain.domain);
    await recordSignInDomain(deployment.table, { domain: domain.domain, by: actor.id });
  }
  return { statusCode: 200, body: await domainView(deployment, domain, domain.domain) };
};

export const removeDomain: OperationHandler = async (event, deployment, actor) => {
  if (!actor?.admin) return onlyAdmins();
  const domain = await domainAsked(event, deployment);
  if ("statusCode" in domain) return domain;
  // A standalone domain's alias domains mirror nothing without it, so they go with it.
  const removed = [domain.domain, ...(await allDomains(deployment.table)).filter(({ aliasOf }) => aliasOf === domain.domain).map((each) => each.domain)];
  const onRemoved = (address: string) => removed.includes(address.slice(address.lastIndexOf("@") + 1));
  const signIn = await signInDomain(deployment);
  if (removed.includes(signIn)) {
    return refusal(409, `Sign-in codes come from ${signIn}, so it can't be removed. Choose another domain SES has verified to send them first.`);
  }
  const addresses = (await receivingAddresses(deployment.table)).filter(({ address }) => onRemoved(address));
  const own = (await allAddresses(deployment.table)).filter(({ address }) => onRemoved(address));
  const mailboxes = await Promise.all((await allMailboxes(deployment.table)).map((id) => findMailbox(deployment.table, id)));
  const mailboxesLeftWithoutAddress = mailboxes
    .filter((mailbox) => mailbox !== undefined && mailbox.addresses.length > 0 && mailbox.addresses.every(onRemoved))
    .map((mailbox) => mailbox!.id)
    .sort();
  const removal = (done: boolean) => ({
    statusCode: 200,
    body: { domains: removed, addresses, mailboxesLeftWithoutAddress, removed: done } satisfies components["schemas"]["DomainRemoval"],
  });
  if (jsonBody(event)?.dryRun === true) return removal(false);

  // A group's address goes with its group.
  const remove = ({ address, group }: Address) => (group ? removeGroup(deployment.table, { address, by: actor.id }) : removeAddress(deployment.table, { address, by: actor.id }));
  for (const each of own) await remove(each);
  // Mail stays where it is. Without the identities, nothing sends from the domains.
  for (const each of removed) await deployment.identities.delete(each);
  await removeDomains(deployment.table, { domains: removed, by: actor.id });
  // An alias domain or an address added on one of them meanwhile goes too.
  const lateAliases = (await allDomains(deployment.table)).filter(({ aliasOf }) => aliasOf !== undefined && removed.includes(aliasOf)).map((each) => each.domain);
  for (const each of lateAliases) await deployment.identities.delete(each);
  if (lateAliases.length > 0) await removeDomains(deployment.table, { domains: lateAliases, by: actor.id });
  removed.push(...lateAliases);
  for (const each of (await allAddresses(deployment.table)).filter(({ address }) => onRemoved(address))) await remove(each);
  // Whoever gets an address that went later isn't a group's member through it.
  for (const { address } of addresses) await removeMember(deployment.table, { address, by: actor.id });
  // SES refuses mail to every address that went, mirrored ones included, before the call is answered.
  await syncRecipients(deployment.table, deployment.receiving);
  return removal(true);
};
