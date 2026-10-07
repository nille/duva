// The organization's own BIMI logos (ADR-0026): each domain's default, which admins set, and a
// human's own logo for their mailbox, under a selector Duva gives it, which its mail names in
// BIMI-Selector. Duva converts each to SVG Tiny PS and serves it at a URL that stays the same,
// from S3 through the web app's CloudFront distribution, so its record in DNS does too. Duva shows
// the records and checks them, but never changes anyone's DNS.
import { X509Certificate } from "node:crypto";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { DeleteObjectCommand, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { DeleteCommand, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import type { components } from "@duva/openapi";
import { jsonBody, type OperationHandler, refusal } from "./api.ts";
import type { Deployment, Table } from "./deployment.ts";
import type { Dns } from "./dns-records.ts";
import { domainAsked } from "./domains.ts";
import { hostedLogosPath } from "./infrastructure.ts";
import { type Actor, actorOf, type Human, aliasDomains, findActor, findMailbox, isAddressOf, isAdmin, type Mailbox } from "./organization.ts";
import { dmarcPolicy, tagsOf } from "./sender-logos.ts";
import { convertedLogo, longestUpload } from "./svg-tiny-ps.ts";
import { allItems } from "./erasure.ts";
import { documents, pk, sk } from "./table.ts";
import { verifiesLogo } from "./verified-marks.ts";

type DomainLogo = components["schemas"]["DomainLogo"];
type MailboxLogo = components["schemas"]["MailboxLogo"];
type BimiRecord = components["schemas"]["BimiRecord"];

/** Where Duva serves the organization's logos, and the roots a mark certificate attached to one must lead to. */
export interface HostedLogos {
  /** The URL the logos are served under, ending in a slash. */
  url: string;
  /** Serves the body at the path under the URL, as the media type. */
  put(path: string, body: string, type: string): Promise<void>;
  /** Stops serving anything at the path. */
  remove(path: string): Promise<void>;
  /** The roots of the Mark Verifying Authorities a mark certificate Duva serves beside a logo must lead to. */
  roots: X509Certificate[];
}

/** How long a browser or a receiver may keep a logo before asking again, so another logo shows within minutes. */
export const logoCacheControl = "public, max-age=300";

/** The URL the logo or certificate at the path is served at. */
const servedAt = ({ url }: HostedLogos, path: string) => `${url}${path}`;

/** The logos bucket, which CloudFront serves under the web app's domain at /bimi/. */
export function s3HostedLogos(s3: S3Client, bucket: string, url: string, roots: X509Certificate[]): HostedLogos {
  const key = (path: string) => `${hostedLogosPath}${path}`;
  return {
    url,
    roots,
    async put(path, body, type) {
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key(path), Body: body, ContentType: type, CacheControl: logoCacheControl }));
    },
    async remove(path) {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key(path) }));
    },
  };
}

/** The media types logos and mark certificates are served as, the second as RFC 8555 names a PEM chain. */
const svgType = "image/svg+xml";
const pemType = "application/pem-certificate-chain";

const domainLogoPath = (domain: string) => `domains/${domain}.svg`;
const certificatePath = (domain: string) => `domains/${domain}.pem`;
const selectorLogoPath = (selector: string) => `selectors/${selector}.svg`;

const domainLogoKey = (domain: string) => ({ [pk]: `domainLogo#${domain}`, [sk]: "domainLogo" });
const mailboxLogoKey = (mailbox: string) => ({ [pk]: `mailbox#${mailbox}`, [sk]: "logo" });
// Each selector is the organization's, so all are listed in one partition, with the mailbox that has it.
const selectorsPartition = "logoSelectors";
const selectorKey = (selector: string) => ({ [pk]: selectorsPartition, [sk]: `selector#${selector}` });

/** A domain's logo as Duva keeps it: the SVG it serves, and the mark certificate's URL, or that Duva serves it. */
interface StoredDomainLogo {
  svg: string;
  certificate?: { url: string } | { hosted: true };
}

async function storedDomainLogo(table: Table, domain: string): Promise<StoredDomainLogo | undefined> {
  const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: domainLogoKey(domain), ConsistentRead: true }));
  return Item === undefined ? undefined : { svg: Item.svg as string, ...(Item.certificate !== undefined && { certificate: Item.certificate }) };
}

/** A mailbox's own logo as Duva keeps it, with its selector, which it keeps once given. */
async function storedMailboxLogo(table: Table, mailbox: string): Promise<{ selector: string; svg?: string } | undefined> {
  const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: mailboxLogoKey(mailbox), ConsistentRead: true }));
  return Item === undefined ? undefined : { selector: Item.selector as string, ...(Item.svg !== undefined && { svg: Item.svg as string }) };
}

/** A BIMI record's value, which gives the logo's URL and the mark certificate's, if there is one. */
const recordValue = (logo: string, certificate?: string) => `v=BIMI1; l=${logo};${certificate === undefined ? "" : ` a=${certificate};`}`;

/** Whether the text is a BIMI record. */
const isBimi = (text: string) => /^v\s*=\s*BIMI1\s*(;|$)/i.test(text);

/** The record, with whether DNS has it: the BIMI records it has at the name, and whether one gives the same logo and certificate. */
async function checked(dns: Dns, name: string, value: string): Promise<BimiRecord> {
  // A failed lookup counts as no record.
  const found = (await dns.resolve("TXT", name).catch(() => [])).filter(isBimi);
  if (found.length === 0) return { name, value, status: "missing" };
  const same = (a: string, b: string) => ["l", "a"].every((tag) => (tagsOf(a).get(tag) ?? "") === (tagsOf(b).get(tag) ?? ""));
  // Receivers ignore a name with two.
  return found.length === 1 && same(found[0]!, value) ? { name, value, status: "matches" } : { name, value, status: "found", found };
}

/** Whether the domain's DMARC policy enforces DMARC on all its mail, as BIMI needs. A failed lookup counts as not. */
const enforcesDmarc = async (dns: Dns, domain: string) => (await dmarcPolicy(dns, domain).catch(() => undefined))?.enforced ?? false;

/** The domains a mailbox sends from: those of its addresses, and the alias domains that mirror them, in alphabetical order. */
function domainsOf(mailbox: Mailbox, aliases: Map<string, string>): string[] {
  const own = new Set(mailbox.addresses.map((address) => address.slice(address.lastIndexOf("@") + 1)));
  for (const [alias, standalone] of aliases) if (own.has(standalone)) own.add(alias);
  return [...own].sort();
}

/** The domain's logo, its record and its mark certificate, with every mailbox's own logo on it, each record looked up now. */
async function domainLogoView({ table, dns, hostedLogos }: Deployment, domain: string): Promise<DomainLogo> {
  const stored = await storedDomainLogo(table, domain);
  const url = servedAt(hostedLogos, domainLogoPath(domain));
  const certificate =
    stored?.certificate === undefined ? undefined : "url" in stored.certificate ? { url: stored.certificate.url, hosted: false } : { url: servedAt(hostedLogos, certificatePath(domain)), hosted: true };
  const aliases = await aliasDomains(table);
  const listed = await allItems(table, { KeyConditionExpression: `${pk} = :selectors`, ExpressionAttributeValues: { ":selectors": selectorsPartition } });
  const selectors = await Promise.all(
    listed.map(async ({ [sk]: key, mailbox: id }) => {
      const selector = (key as string).slice("selector#".length);
      const [mailbox, logo] = await Promise.all([findMailbox(table, id as string), storedMailboxLogo(table, id as string)]);
      if (mailbox === undefined || logo?.svg === undefined || !domainsOf(mailbox, aliases).includes(domain)) return [];
      const owner = await findActor(table, mailbox.owner);
      if (owner === undefined) return [];
      const logoUrl = servedAt(hostedLogos, selectorLogoPath(selector));
      return [{ selector, mailbox: mailbox.id, owner: actorOf(owner), logo: { url: logoUrl, svg: logo.svg }, record: await checked(dns, `${selector}._bimi.${domain}`, recordValue(logoUrl)) }];
    }),
  );
  return {
    domain,
    ...(stored !== undefined && { logo: { url, svg: stored.svg }, record: await checked(dns, `default._bimi.${domain}`, recordValue(url, certificate?.url)) }),
    ...(certificate !== undefined && { certificate }),
    dmarcEnforced: await enforcesDmarc(dns, domain),
    selectors: selectors.flat().sort((a, b) => a.selector.localeCompare(b.selector)),
  };
}

/** Answers with the domain's logo as it is then. */
const viewing = (deployment: Deployment, domain: string) => async () => ({ statusCode: 200, body: await domainLogoView(deployment, domain) });

const onlyAdmins = (doing: string) => refusal(403, `Only admins can ${doing} the organization's domains' logos. Ask an admin to.`);

/** The SVG text the call's body gives, or a refusal. */
function uploaded(event: Parameters<OperationHandler>[0]): string | ReturnType<typeof refusal> {
  const svg = jsonBody(event)?.svg;
  if (typeof svg !== "string" || svg.trim() === "") return refusal(400, "Give svg, the text of the logo's SVG file.");
  if (Buffer.byteLength(svg) > longestUpload) return refusal(400, `The logo is over ${longestUpload / 1024} KB. Export it as a simpler SVG, and upload that.`);
  return svg;
}

export const getDomainLogo: OperationHandler = async (event, deployment, actor) => {
  if (!isAdmin(actor)) return onlyAdmins("read");
  const domain = await domainAsked(event, deployment);
  if ("statusCode" in domain) return domain;
  return { statusCode: 200, body: await domainLogoView(deployment, domain.domain) };
};

export const setDomainLogo: OperationHandler = async (event, deployment, actor) => {
  if (!isAdmin(actor)) return onlyAdmins("set");
  const domain = await domainAsked(event, deployment);
  if ("statusCode" in domain) return domain;
  const given = uploaded(event);
  if (typeof given !== "string") return given;
  const converted = convertedLogo(given, domain.domain);
  if ("refused" in converted) return refusal(400, converted.refused);
  const { svg } = converted;
  const stored = await storedDomainLogo(deployment.table, domain.domain);
  const view = viewing(deployment, domain.domain);
  if (stored?.svg === svg) return view();
  await deployment.hostedLogos.put(domainLogoPath(domain.domain), svg, svgType);
  await documents(deployment.table).send(new PutCommand({ TableName: deployment.table.name, Item: { ...domainLogoKey(domain.domain), svg, by: actor!.id, at: new Date().toISOString() } }));
  if (stored?.certificate !== undefined && "hosted" in stored.certificate) await deployment.hostedLogos.remove(certificatePath(domain.domain));
  return view();
};

export const removeDomainLogo: OperationHandler = async (event, deployment, actor) => {
  if (!isAdmin(actor)) return onlyAdmins("remove");
  const domain = await domainAsked(event, deployment);
  if ("statusCode" in domain) return domain;
  const stored = await storedDomainLogo(deployment.table, domain.domain);
  const view = viewing(deployment, domain.domain);
  if (stored === undefined) return view();
  await forgetDomainLogo(deployment, domain.domain);
  return view();
};

/** Stops serving the domain's logo and mark certificate, and forgets them, as when the domain is removed. */
export async function forgetDomainLogo({ table, hostedLogos }: Deployment, domain: string): Promise<void> {
  await hostedLogos.remove(domainLogoPath(domain));
  await hostedLogos.remove(certificatePath(domain));
  await documents(table).send(new DeleteCommand({ TableName: table.name, Key: domainLogoKey(domain) }));
}

export const setLogoCertificate: OperationHandler = async (event, deployment, actor) => {
  if (!isAdmin(actor)) return onlyAdmins("change");
  const domain = await domainAsked(event, deployment);
  if ("statusCode" in domain) return domain;
  const { url, pem } = jsonBody(event) ?? {};
  if ((url === undefined) === (pem === undefined)) return refusal(400, "Give either url, the https URL of the VMC or CMC, or pem, its PEM.");
  const stored = await storedDomainLogo(deployment.table, domain.domain);
  if (stored === undefined) return refusal(409, `${domain.domain} has no logo, and a mark certificate vouches for one. Set the logo it was issued for first.`);
  const view = viewing(deployment, domain.domain);
  const write = (certificate: StoredDomainLogo["certificate"]) =>
    documents(deployment.table).send(new PutCommand({ TableName: deployment.table.name, Item: { ...domainLogoKey(domain.domain), ...stored, certificate, by: actor!.id, at: new Date().toISOString() } }));
  if (url !== undefined) {
    if (typeof url !== "string" || !/^https:\/\//i.test(url) || !URL.canParse(url)) return refusal(400, `${JSON.stringify(url)} isn't an https URL. Receivers fetch the certificate only over https.`);
    await write({ url });
    if (stored.certificate !== undefined && "hosted" in stored.certificate) await deployment.hostedLogos.remove(certificatePath(domain.domain));
    return view();
  }
  if (typeof pem !== "string") return refusal(400, "Give pem as the text of the certificate's PEM file.");
  // A subdomain's certificate may name the domain whose DMARC record covers it.
  const covering = (await dmarcPolicy(deployment.dns, domain.domain).catch(() => undefined))?.at ?? domain.domain;
  if (!verifiesLogo(pem, { domains: [domain.domain, covering], logo: new TextEncoder().encode(stored.svg), roots: deployment.hostedLogos.roots, at: new Date() })) {
    return refusal(
      400,
      `The certificate doesn't vouch for ${domain.domain}'s logo. A VMC or CMC must lead to a Mark Verifying Authority, be current, name ${domain.domain}, and carry the very logo Duva serves, so set the logo it was issued for first.`,
    );
  }
  await deployment.hostedLogos.put(certificatePath(domain.domain), pem, pemType);
  await write({ hosted: true });
  return view();
};

export const removeLogoCertificate: OperationHandler = async (event, deployment, actor) => {
  if (!isAdmin(actor)) return onlyAdmins("change");
  const domain = await domainAsked(event, deployment);
  if ("statusCode" in domain) return domain;
  const stored = await storedDomainLogo(deployment.table, domain.domain);
  const view = viewing(deployment, domain.domain);
  if (stored?.certificate === undefined) return view();
  const { certificate, ...logo } = stored;
  await documents(deployment.table).send(new PutCommand({ TableName: deployment.table.name, Item: { ...domainLogoKey(domain.domain), ...logo, by: actor!.id, at: new Date().toISOString() } }));
  if ("hosted" in certificate) await deployment.hostedLogos.remove(certificatePath(domain.domain));
  return view();
};

/** The mailbox the call's path names, if the actor is the human who owns it, or a refusal. */
async function ownMailbox(event: Parameters<OperationHandler>[0], deployment: Deployment, actor: Actor, doing: string): Promise<{ mailbox: Mailbox; owner: Human } | ReturnType<typeof refusal>> {
  const id = event.pathParameters?.mailbox ?? "";
  const mailbox = await findMailbox(deployment.table, id);
  if (mailbox === undefined) return refusal(404, `There is no mailbox ${JSON.stringify(id)}. List the mailboxes you can read to find its ID.`);
  if (actor.kind !== "human" || mailbox.owner !== actor.id) {
    return refusal(403, `Only the human who owns a mailbox can ${doing} its logo, and an agent's mail shows its domain's. Ask an admin to set the domain's logo instead.`);
  }
  return { mailbox, owner: actor };
}

/** The mailbox's own logo, with the record each of its domains needs, each looked up now. */
async function mailboxLogoView({ table, dns, hostedLogos }: Deployment, mailbox: Mailbox): Promise<MailboxLogo> {
  const stored = await storedMailboxLogo(table, mailbox.id);
  if (stored?.svg === undefined) return { mailbox: mailbox.id, records: [] };
  const url = servedAt(hostedLogos, selectorLogoPath(stored.selector));
  const domains = domainsOf(mailbox, await aliasDomains(table));
  return {
    mailbox: mailbox.id,
    selector: stored.selector,
    logo: { url, svg: stored.svg },
    records: await Promise.all(domains.map((domain) => checked(dns, `${stored.selector}._bimi.${domain}`, recordValue(url)))),
  };
}

export const getMailboxLogo: OperationHandler = async (event, deployment, actor) => {
  const owned = await ownMailbox(event, deployment, actor!, "read");
  if ("statusCode" in owned) return owned;
  const { mailbox } = owned;
  return { statusCode: 200, body: await mailboxLogoView(deployment, mailbox) };
};

export const setMailboxLogo: OperationHandler = async (event, deployment, actor) => {
  const owned = await ownMailbox(event, deployment, actor!, "set");
  if ("statusCode" in owned) return owned;
  const { mailbox, owner } = owned;
  const given = uploaded(event);
  if (typeof given !== "string") return given;
  const converted = convertedLogo(given, mailbox.defaultAddress ?? owner.email);
  if ("refused" in converted) return refusal(400, converted.refused);
  const selector = (await storedMailboxLogo(deployment.table, mailbox.id))?.selector ?? (await claimSelector(deployment.table, mailbox));
  // Another call may have given the mailbox a selector meanwhile, which it keeps, and frees the one this one claimed.
  try {
    await documents(deployment.table).send(
      new PutCommand({ TableName: deployment.table.name, Item: { ...mailboxLogoKey(mailbox.id), selector }, ConditionExpression: `attribute_not_exists(${pk}) OR selector = :selector`, ExpressionAttributeValues: { ":selector": selector } }),
    );
  } catch (error) {
    if (!(error instanceof ConditionalCheckFailedException)) throw error;
    await documents(deployment.table).send(new DeleteCommand({ TableName: deployment.table.name, Key: selectorKey(selector), ConditionExpression: "mailbox = :mailbox", ExpressionAttributeValues: { ":mailbox": mailbox.id } }));
    return setMailboxLogo(event, deployment, actor);
  }
  await deployment.hostedLogos.put(selectorLogoPath(selector), converted.svg, svgType);
  await documents(deployment.table).send(new PutCommand({ TableName: deployment.table.name, Item: { ...mailboxLogoKey(mailbox.id), selector, svg: converted.svg } }));
  return { statusCode: 200, body: await mailboxLogoView(deployment, mailbox) };
};

export const removeMailboxLogo: OperationHandler = async (event, deployment, actor) => {
  const owned = await ownMailbox(event, deployment, actor!, "remove");
  if ("statusCode" in owned) return owned;
  const { mailbox } = owned;
  const stored = await storedMailboxLogo(deployment.table, mailbox.id);
  if (stored?.svg !== undefined) {
    await deployment.hostedLogos.remove(selectorLogoPath(stored.selector));
    // The mailbox keeps its selector, so a logo set again needs no new records.
    await documents(deployment.table).send(new PutCommand({ TableName: deployment.table.name, Item: { ...mailboxLogoKey(mailbox.id), selector: stored.selector } }));
  }
  return { statusCode: 200, body: await mailboxLogoView(deployment, mailbox) };
};

/**
 * Gives the mailbox a selector of its own: the local part of its default address, as a DNS label,
 * or with -2, -3 and on after it if another mailbox has that one. Never default, the domain's.
 */
async function claimSelector(table: Table, mailbox: Mailbox): Promise<string> {
  const local = (mailbox.defaultAddress ?? "").slice(0, Math.max((mailbox.defaultAddress ?? "").lastIndexOf("@"), 0));
  const base = local.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "mailbox";
  for (let number = base === "default" ? 2 : 1; ; number++) {
    const selector = number === 1 ? base : `${base}-${number}`;
    try {
      await documents(table).send(new PutCommand({ TableName: table.name, Item: { ...selectorKey(selector), mailbox: mailbox.id }, ConditionExpression: `attribute_not_exists(${pk})` }));
      return selector;
    } catch (error) {
      if (!(error instanceof ConditionalCheckFailedException)) throw error;
    }
  }
}

/** Stops serving the mailbox's own logo, and frees its selector, as when the mailbox is deleted. */
export async function forgetMailboxLogo({ table, hostedLogos }: Deployment, mailbox: string): Promise<void> {
  const stored = await storedMailboxLogo(table, mailbox);
  if (stored === undefined) return;
  await hostedLogos.remove(selectorLogoPath(stored.selector));
  await documents(table).send(new DeleteCommand({ TableName: table.name, Key: selectorKey(stored.selector) }));
  await documents(table).send(new DeleteCommand({ TableName: table.name, Key: mailboxLogoKey(mailbox) }));
}

/**
 * The BIMI-Selector header for mail the mailbox sends from the address, if the mailbox has a logo
 * of its own, the address is one of its own, not a group's, and DNS has a BIMI record for its
 * selector on the address's domain. A failed lookup counts as none.
 */
export async function bimiSelectorHeader(table: Table, dns: Dns, mailbox: Mailbox, from: string): Promise<[string, string] | undefined> {
  const stored = await storedMailboxLogo(table, mailbox.id);
  if (stored?.svg === undefined || !isAddressOf(mailbox, from, await aliasDomains(table))) return undefined;
  const domain = from.slice(from.lastIndexOf("@") + 1).toLowerCase();
  const found = (await dns.resolve("TXT", `${stored.selector}._bimi.${domain}`).catch(() => [])).some(isBimi);
  return found ? ["BIMI-Selector", `v=BIMI1; s=${stored.selector};`] : undefined;
}
