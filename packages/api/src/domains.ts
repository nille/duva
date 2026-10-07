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
import { forgetDomainLogo } from "./own-logos.ts";
import { maxAddresses, ruleRecipients, syncRecipients } from "./receiving.ts";
import { listed, mailboxNamed, setupOperation } from "./setup.ts";

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
export async function domainAsked(event: Parameters<OperationHandler>[0], deployment: Deployment): Promise<OrganizationDomain | ReturnType<typeof refusal>> {
  const given = event.pathParameters?.domain ?? "";
  const name = asciiDomain(given);
  const domain = (await allDomains(deployment.table)).find((each) => each.domain === name);
  if (domain === undefined) return refusal(404, `The organization has no domain ${JSON.stringify(given)}. List its domains to find it.`);
  return domain;
}

export const addDomain = setupOperation("addDomain", async (event, deployment, actor) => {
  if (!actor.admin) return onlyAdmins();
  const body = jsonBody(event) ?? {};
  const domain = typeof body.domain === "string" ? asciiDomain(body.domain) : undefined;
  if (domain === undefined) return refusal(400, `${JSON.stringify(body.domain ?? "")} isn't a domain. Give one like example.net.`);
  const domains = await allDomains(deployment.table);
  let aliasOf: string | undefined;
  let mirrored = 0;
  if (body.aliasOf !== undefined) {
    aliasOf = typeof body.aliasOf === "string" ? asciiDomain(body.aliasOf) : undefined;
    const standalone = domains.filter((each) => each.aliasOf === undefined).map((each) => each.domain);
    if (aliasOf === undefined || !standalone.includes(aliasOf)) {
      return refusal(400, `An alias domain mirrors one of the organization's standalone domains, ${standalone.join(", ")}. Give one of them as aliasOf.`);
    }
    // Each address on the standalone domain is mirrored, and SES's receipt rules list each, and the alias domain itself if the standalone domain has a catch-all.
    const catchAll = domains.some((each) => each.domain === aliasOf && each.catchAll !== undefined) ? 1 : 0;
    mirrored = (await allAddresses(deployment.table)).filter(({ address }) => address.endsWith(`@${aliasOf}`)).length;
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
  return {
    preview: [
      aliasOf === undefined
        ? `Adds the standalone domain ${domain}, whose addresses are its own.`
        : `Adds ${domain} as an alias domain of ${aliasOf}, so every address on ${aliasOf}, ${mirrored} now, also gets mail at ${domain}.`,
      `It gets an SES identity, and sends and receives mail once its DNS records are in place.`,
    ],
    run: async () => {
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
    },
  };
});

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

export const changeDomain = setupOperation("changeDomain", async (event, deployment, actor) => {
  if (!actor.admin) return refusal(403, "Only admins can choose the domain sign-in codes come from. Ask an admin to.");
  const domain = await domainAsked(event, deployment);
  if ("statusCode" in domain) return domain;
  if (jsonBody(event)?.signIn !== true) return refusal(400, "Give signIn as true to send sign-in codes from the domain. To stop, choose another domain.");
  const view = async () => ({ statusCode: 200, body: await domainView(deployment, domain, domain.domain) });
  // While Cognito sends the codes itself, choosing the first domain moves them to it.
  const current = await deployment.signInSender.domain();
  if (current === domain.domain) return { preview: [], run: view };
  // Cognito refuses a domain SES hasn't verified.
  if (!(await deployment.identities.get(domain.domain))?.verified) {
    return refusal(409, `SES hasn't verified ${domain.domain} yet, so sign-in codes can't come from it. Add its DNS records, and choose it once SES shows it verified.`);
  }
  return {
    preview: [`Sends humans' sign-in codes from ${domain.domain}, instead of ${current ?? "Cognito's own address"}.`],
    run: async () => {
      await deployment.signInSender.sendFrom(domain.domain);
      await recordSignInDomain(deployment.table, { domain: domain.domain, by: actor.id });
      return view();
    },
  };
});

export const removeDomain = setupOperation("removeDomain", async (event, deployment, actor) => {
  if (!actor.admin) return onlyAdmins();
  const domain = await domainAsked(event, deployment);
  if ("statusCode" in domain) return domain;
  // A standalone domain's alias domains mirror nothing without it, so they go with it.
  const aliases = (await allDomains(deployment.table)).filter(({ aliasOf }) => aliasOf === domain.domain).map((each) => each.domain);
  const removed = [domain.domain, ...aliases];
  const onRemoved = (address: string) => removed.includes(address.slice(address.lastIndexOf("@") + 1));
  const signIn = await signInDomain(deployment);
  if (removed.includes(signIn)) {
    return refusal(409, `Sign-in codes come from ${signIn}, so it can't be removed. Choose another domain SES has verified to send them first.`);
  }
  const addresses = (await receivingAddresses(deployment.table)).filter(({ address }) => onRemoved(address));
  const own = (await allAddresses(deployment.table)).filter(({ address }) => onRemoved(address));
  const mailboxes = await Promise.all((await allMailboxes(deployment.table)).map((id) => findMailbox(deployment.table, id)));
  const leftWithoutAddress = mailboxes.filter((mailbox) => mailbox !== undefined && mailbox.addresses.length > 0 && mailbox.addresses.every(onRemoved));
  const removal = (done: boolean) => ({
    statusCode: 200,
    body: { domains: removed, addresses, mailboxesLeftWithoutAddress: leftWithoutAddress.map((mailbox) => mailbox!.id).sort(), removed: done } satisfies components["schemas"]["DomainRemoval"],
  });
  // A dry run changes nothing, so it needs no approval.
  if (jsonBody(event)?.dryRun === true) return { preview: [], run: async () => removal(false) };
  const groups = own.filter(({ group }) => group).map(({ address }) => address);
  const ownAddresses = own.filter(({ group }) => !group).map(({ address }) => address);
  return {
    preview: [
      `Removes the domain ${domain.domain}${aliases.length === 0 ? "" : `, and its alias domain${aliases.length === 1 ? "" : "s"} ${listed(aliases)}`}, so nothing sends from ${removed.length === 1 ? "it" : "them"} and mail to ${removed.length === 1 ? "it" : "them"} is refused. Mail already received stays.`,
      ...(ownAddresses.length === 0 ? [] : [`Removes the address${ownAddresses.length === 1 ? "" : "es"} ${listed(ownAddresses)}.`]),
      ...(groups.length === 0 ? [] : [`Deletes the group${groups.length === 1 ? "" : "s"} ${listed(groups)}.`]),
      ...(await Promise.all(leftWithoutAddress.map(async (mailbox) => `Leaves ${await mailboxNamed(deployment.table, mailbox!)} with no address.`))),
    ],
    run: async () => {
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
      for (const each of removed) await forgetDomainLogo(deployment, each);
      for (const each of (await allAddresses(deployment.table)).filter(({ address }) => onRemoved(address))) await remove(each);
      // Whoever gets an address that went later isn't a group's member through it.
      for (const { address } of addresses) await removeMember(deployment.table, { address, by: actor.id });
      // SES refuses mail to every address that went, mirrored ones included, before the call is answered.
      await syncRecipients(deployment.table, deployment.receiving);
      return removal(true);
    },
  };
});

/**
 * Plans making `catchAll` the catch-all of the domain the call's path names, or clearing it
 * without one, or refuses it. SES takes mail for every address on a domain with a catch-all, and
 * its alias domains, before the call is answered, and refuses mail to unknown ones again once it is cleared.
 */
async function changingCatchAll(event: Parameters<OperationHandler>[0], deployment: Deployment, by: string, catchAll: CatchAll | undefined) {
  const domain = await domainAsked(event, deployment);
  if ("statusCode" in domain) return domain;
  if (domain.aliasOf !== undefined) {
    return refusal(400, `${domain.domain} is an alias domain, which mirrors ${domain.aliasOf}'s catch-all. Set ${domain.aliasOf}'s catch-all instead.`);
  }
  // The receipt rules list the domain with a catch-all, and each of its alias domains.
  if (catchAll !== undefined && domain.catchAll === undefined) {
    const listedDomains = 1 + (await allDomains(deployment.table)).filter(({ aliasOf }) => aliasOf === domain.domain).length;
    if ((await ruleRecipients(deployment.table)).length + listedDomains > maxAddresses) {
      return refusal(409, `The organization receives mail for ${maxAddresses} addresses, and a catch-all on ${domain.domain} takes ${listedDomains} of them. Remove addresses first.`);
    }
  }
  const current = await catchAllNamed(deployment, domain.catchAll);
  const next = await catchAllNamed(deployment, catchAll);
  const preview =
    current === next
      ? []
      : next === undefined
        ? [`Clears ${domain.domain}'s catch-all, ${current}, so mail to unknown addresses there is refused.`]
        : [`Makes ${next} the catch-all of ${domain.domain}, so mail to unknown addresses there, and on its alias domains, goes to it${current === undefined ? " instead of being refused" : `, instead of to ${current}`}.`];
  return {
    preview,
    run: async () => {
      try {
        await setStoredCatchAll(deployment.table, { domain: domain.domain, catchAll, by });
      } catch (error) {
        if (error instanceof NotStandalone) return refusal(404, `${domain.domain} was removed meanwhile. List the domains to find it.`);
        if (error instanceof NoCatchAll) return refusal(409, "The mailbox or group was deleted meanwhile. Choose another catch-all.");
        throw error;
      }
      await syncRecipients(deployment.table, deployment.receiving);
      return { statusCode: 200, body: await domainView(deployment, { domain: domain.domain, ...(catchAll !== undefined && { catchAll }) }, await signInDomain(deployment)) };
    },
  };
}

/** The catch-all as a preview names it, or undefined if there is none. */
async function catchAllNamed(deployment: Deployment, catchAll: CatchAll | undefined): Promise<string | undefined> {
  if (catchAll === undefined) return undefined;
  if (catchAll.group !== undefined) return `the group ${catchAll.group}`;
  const mailbox = await findMailbox(deployment.table, catchAll.mailbox!);
  return mailbox === undefined ? "a deleted mailbox" : mailboxNamed(deployment.table, mailbox);
}

export const setCatchAll = setupOperation("setCatchAll", async (event, deployment, actor) => {
  if (!actor.admin) return refusal(403, "Only admins can set a domain's catch-all. Ask an admin to.");
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
});

export const clearCatchAll = setupOperation("clearCatchAll", async (event, deployment, actor) => {
  if (!actor.admin) return refusal(403, "Only admins can clear a domain's catch-all. Ask an admin to.");
  return changingCatchAll(event, deployment, actor.id, undefined);
});
