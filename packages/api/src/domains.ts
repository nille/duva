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
  findGroup,
  findMailbox,
  NoCatchAll,
  NotStandalone,
  type OrganizationDomain,
  organizationDomain,
  receivingAddresses,
  recordSignInDomain,
  removeAddress,
  removeDomains,
  removeGroup,
  removeMember,
  setCatchAll as setStoredCatchAll,
  type Address,
  type CatchAll,
} from "./organization.ts";
import { maxAddresses, ruleRecipients, syncRecipients } from "./receiving.ts";

type Domain = components["schemas"]["Domain"];
type DnsRecord = components["schemas"]["DnsRecord"];

const onlyAdmins = () => refusal(403, "Only admins can change the organization's domains. Ask an admin to.");

/** The domain sign-in codes come from: the user pool's, or the first domain's while Cognito sends them until SES verifies it. */
async function signInDomain(deployment: Deployment): Promise<string> {
  return (await deployment.signInSender.domain()) ?? (await organizationDomain(deployment.table));
}

/** The domain with its DNS records, each looked up now, and what SES has verified of it. */
async function domainView(deployment: Deployment, { domain, aliasOf, catchAll }: OrganizationDomain, signIn: string): Promise<Domain> {
  const identity = await deployment.identities.get(domain);
  const dkim = (identity?.dkimTokens ?? []).map((token) => dkimRecord(domain, token));
  const { records } = await domainRecords(deployment.dns, { region: deployment.region, domain, dkim });
  // A record is verified once SES has verified what it is for. It counts as verified even when DNS
  // doesn't answer with it, since Duva's resolver can answer from a cache made before it was added.
  // It doesn't when DNS answers with another value: SES verifies MAIL FROM by its MX record alone, so
  // a wrong SPF record would otherwise show as verified.
  const verified = (purpose: DnsRecord["purpose"]) =>
    (purpose === "DKIM" && identity?.dkimStatus === "SUCCESS") || (purpose === "MAIL FROM" && identity?.mailFromStatus === "SUCCESS");
  return {
    domain,
    kind: aliasOf === undefined ? "standalone" : "alias",
    ...(aliasOf !== undefined && { aliasOf }),
    signIn: domain === signIn,
    ...(catchAll !== undefined && { catchAll }),
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
      status: verified(purpose) && status !== "different" ? "verified" : status === "live" ? "found" : "missing",
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
    // Each address on the standalone domain is mirrored, and SES's receipt rules list each, and the alias domain itself if the standalone domain has a catch-all.
    const catchAll = domains.some((each) => each.domain === aliasOf && each.catchAll !== undefined) ? 1 : 0;
    const mirrored = (await allAddresses(deployment.table)).filter(({ address }) => address.endsWith(`@${aliasOf}`)).length;
    if ((await ruleRecipients(deployment.table)).length + mirrored + catchAll > maxAddresses) {
      const its = catchAll === 0 ? "" : `, and ${aliasOf}'s catch-all,`;
      return refusal(409, `${domain} would mirror ${mirrored} addresses${its} and the organization can receive mail for at most ${maxAddresses}. Remove addresses first.`);
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

/**
 * The domain the call's path names with its catch-all from now on, `catchAll` if given, or
 * undefined to clear it, or a refusal. SES takes mail for every address on a domain with a
 * catch-all, and its alias domains, before the call is answered, and refuses mail to unknown ones
 * again once it is cleared.
 */
async function changingCatchAll(event: Parameters<OperationHandler>[0], deployment: Deployment, by: string, catchAll: CatchAll | undefined) {
  const domain = await domainAsked(event, deployment);
  if ("statusCode" in domain) return domain;
  if (domain.aliasOf !== undefined) {
    return refusal(400, `${domain.domain} is an alias domain, which mirrors ${domain.aliasOf}'s catch-all. Set ${domain.aliasOf}'s catch-all instead.`);
  }
  // The receipt rules list the domain with a catch-all, and each of its alias domains.
  if (catchAll !== undefined && domain.catchAll === undefined) {
    const listed = 1 + (await allDomains(deployment.table)).filter(({ aliasOf }) => aliasOf === domain.domain).length;
    if ((await ruleRecipients(deployment.table)).length + listed > maxAddresses) {
      return refusal(409, `The organization receives mail for ${maxAddresses} addresses, and a catch-all on ${domain.domain} takes ${listed} of them. Remove addresses first.`);
    }
  }
  try {
    await setStoredCatchAll(deployment.table, { domain: domain.domain, catchAll, by });
  } catch (error) {
    if (error instanceof NotStandalone) return refusal(404, `${domain.domain} was removed meanwhile. List the domains to find it.`);
    if (error instanceof NoCatchAll) return refusal(409, "The mailbox or group was deleted meanwhile. Choose another catch-all.");
    throw error;
  }
  await syncRecipients(deployment.table, deployment.receiving);
  return { statusCode: 200, body: await domainView(deployment, { domain: domain.domain, ...(catchAll !== undefined && { catchAll }) }, await signInDomain(deployment)) };
}

export const setCatchAll: OperationHandler = async (event, deployment, actor) => {
  if (!actor?.admin) return refusal(403, "Only admins can set a domain's catch-all. Ask an admin to.");
  const { mailbox, group } = jsonBody(event) ?? {};
  if ((mailbox === undefined) === (group === undefined)) return refusal(400, "Give either mailbox, a mailbox's ID, or group, a group's address.");
  let catchAll: CatchAll;
  if (mailbox !== undefined) {
    if (typeof mailbox !== "string" || (await findMailbox(deployment.table, mailbox)) === undefined) {
      return refusal(400, `There is no mailbox ${JSON.stringify(mailbox)}. Give the ID of the mailbox for the catch-all, which listing the addresses shows.`);
    }
    catchAll = { mailbox };
  } else {
    const address = typeof group === "string" ? group.trim().toLowerCase() : "";
    if ((await findGroup(deployment.table, address)) === undefined) return refusal(400, `There is no group ${JSON.stringify(address)}. Give a group's address, which listing the groups shows.`);
    catchAll = { group: address };
  }
  return changingCatchAll(event, deployment, actor.id, catchAll);
};

export const clearCatchAll: OperationHandler = async (event, deployment, actor) => {
  if (!actor?.admin) return refusal(403, "Only admins can clear a domain's catch-all. Ask an admin to.");
  return changingCatchAll(event, deployment, actor.id, undefined);
};
