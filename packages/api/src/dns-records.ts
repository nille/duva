// The DNS records a domain needs for SES, and whether DNS answers with them. duva deploy checks
// the first domain's, and the API those of the domains admins add later (ADR-0018). Deploy asks the
// zone's own name servers, since it checks again, while it runs, records a human adds after a
// resolver may have cached their absence (#180). Duva never changes anyone's DNS.
import { Resolver, resolve4, resolveCname, resolveMx, resolveNs, resolveTxt } from "node:dns/promises";
import { domainToASCII } from "node:url";

export type RecordType = "MX" | "TXT" | "CNAME";

export interface Dns {
  /**
   * The records of the type at the name: MX as "priority host", TXT with its strings joined.
   * Empty when there are none. Throws when the lookup fails.
   */
  resolve(type: RecordType, name: string): Promise<string[]>;
}

/**
 * DNS through the system's resolver, which may answer from its cache, and straight from the name
 * servers a zone names, which have no cache to answer from.
 */
export interface ZoneDns {
  /** Like Dns's, through the system's resolver, which also gives the host names of a zone's name servers, by NS. */
  resolve(type: RecordType | "NS", name: string): Promise<string[]>;
  /** Like Dns's, asking the name servers, by their host names. */
  resolveAt(nameServers: string[], type: RecordType, name: string): Promise<string[]>;
}

/** The records of the type at the name, through the resolver. */
async function lookUp(resolver: Pick<Resolver, "resolveCname" | "resolveMx" | "resolveNs" | "resolveTxt">, type: RecordType | "NS", name: string) {
  try {
    switch (type) {
      case "MX":
        return (await resolver.resolveMx(name)).map(({ priority, exchange }) => `${priority} ${exchange}`);
      case "TXT":
        return (await resolver.resolveTxt(name)).map((strings) => strings.join(""));
      case "CNAME":
        return await resolver.resolveCname(name);
      case "NS":
        return await resolver.resolveNs(name);
    }
  } catch (error) {
    // No such name, or no record of the type there: either way, no record.
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOTFOUND" || code === "ENODATA") return [];
    throw error;
  }
}

const systemResolver = { resolveCname, resolveMx, resolveNs, resolveTxt };

/** The system's resolver and the name servers it gives, through node:dns. */
export const realZoneDns: ZoneDns = {
  resolve: (type, name) => lookUp(systemResolver, type, name),
  async resolveAt(nameServers, type, name) {
    // One address of each, asked once for 2 seconds, so a network that lets DNS reach only its own
    // resolver costs seconds before deploy asks that resolver instead.
    const addresses = (await Promise.all(nameServers.map(async (server) => (await resolve4(server).catch(() => []))[0]))).filter((address) => address !== undefined);
    if (addresses.length === 0) throw new Error(`Couldn't find the addresses of ${name}'s name servers, ${nameServers.join(", ")}.`);
    const resolver = new Resolver({ timeout: 2_000, tries: 1 });
    resolver.setServers(addresses);
    return lookUp(resolver, type, name);
  },
};

/** The system's resolver, through node:dns. */
export const realDns: Dns = { resolve: realZoneDns.resolve };

/**
 * DNS as the name servers of each name's zone answer it. A resolver keeps an NXDOMAIN for as long as
 * the zone's SOA says, up to hours, so a record added since stays missing through it (#180).
 */
export function authoritative(dns: ZoneDns): Dns {
  // A name's zone is the nearest name at or above it with name servers of its own. No zone is at a
  // CNAME's name, and asked for NS records there a resolver gives those of where it leads, as for a
  // host that leads to a CloudFront distribution, whose domain is a zone.
  const nameServers = async (name: string): Promise<string[]> => {
    const servers = (await dns.resolve("CNAME", name)).length > 0 ? [] : await dns.resolve("NS", name);
    const parent = name.slice(name.indexOf(".") + 1);
    return servers.length > 0 || parent === name ? servers : nameServers(parent);
  };
  // A zone's name servers give what a CNAME leads to only within the zone, so a record that leads out
  // of it, as _dmarc may to a DMARC service, is followed to the zone it leads to. Past a few, it's a loop.
  const resolve = async (type: RecordType, name: string, hops = 0): Promise<string[]> => {
    const servers = await nameServers(name);
    if (servers.length === 0) throw new Error(`DNS gives no name servers for ${name}.`);
    const found = await dns.resolveAt(servers, type, name);
    if (found.length > 0 || type === "CNAME" || hops === 8) return found;
    const [target] = await dns.resolveAt(servers, "CNAME", name);
    return target === undefined ? [] : resolve(type, target, hops + 1);
  };
  return {
    async resolve(type, name) {
      try {
        return await resolve(type, name);
      } catch {
        // Where a network lets DNS reach only its own resolver, that resolver answers, cache and all.
        return dns.resolve(type, name);
      }
    },
  };
}

export interface DnsRecord<Purpose extends string = "receiving" | "DKIM" | "MAIL FROM" | "DMARC"> {
  /** What the record is for: what SES needs it for, unless deploy checks it for the web app (#174). */
  purpose: Purpose;
  type: RecordType;
  name: string;
  value: string;
  /** Whether DNS answers with the value. "different" lists what it found, "unchecked" why the lookup failed. */
  status: "live" | "missing" | "different" | "unchecked";
  found?: string[];
  error?: string;
}

export type WantedRecord<Purpose extends string = DnsRecord["purpose"]> = Omit<DnsRecord<Purpose>, "status" | "found" | "error">;

/** The MAIL FROM subdomain's label: mail from Duva bounces to mail.<domain>. */
const mailFromLabel = "mail";

/** The domain's MAIL FROM domain. */
export const mailFromDomain = (domain: string) => `${mailFromLabel}.${domain}`;

/** A DKIM CNAME record for one of the tokens SES gave the domain's identity. */
export const dkimRecord = (domain: string, token: string) => ({ name: `${token}._domainkey.${domain}`, value: `${token}.dkim.amazonses.com` });

/**
 * The records the domain needs in the region, each with whether DNS answers with it. Its DMARC
 * record only if no parent domain's covers it, and then `coveredBy` names that one.
 */
export async function domainRecords(dns: Dns, { region, domain, dkim }: { region: string; domain: string; dkim: { name: string; value: string }[] }) {
  const wanted: WantedRecord[] = [
    { purpose: "receiving", type: "MX", name: domain, value: `10 inbound-smtp.${region}.amazonaws.com` },
    ...dkim.map(({ name, value }) => ({ purpose: "DKIM" as const, type: "CNAME" as const, name, value })),
    { purpose: "MAIL FROM", type: "MX", name: mailFromDomain(domain), value: `10 feedback-smtp.${region}.amazonses.com` },
    { purpose: "MAIL FROM", type: "TXT", name: mailFromDomain(domain), value: "v=spf1 include:amazonses.com ~all" },
  ];
  const records = await Promise.all(wanted.map((record) => checkRecord(dns, record)));

  // The domain needs a DMARC record of its own only if none covers it from a parent domain.
  const dmarc = await checkRecord(dns, { purpose: "DMARC", type: "TXT", name: `_dmarc.${domain}`, value: "v=DMARC1; p=none;" });
  const coveredBy = dmarc.status === "missing" ? await parentDmarc(dns, domain) : undefined;
  if (coveredBy === undefined) records.push(dmarc);
  return { records, coveredBy };
}

/** The record with whether DNS answers with it. */
export async function checkRecord<Purpose extends string>(dns: Dns, record: WantedRecord<Purpose>): Promise<DnsRecord<Purpose>> {
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
    // A failed lookup counts as no record, so the domain may list a DMARC record it doesn't need.
    const found = await dns.resolve("TXT", name).catch(() => []);
    if (found.some((text) => kind(text) === "v=dmarc1")) return name;
  }
  return undefined;
}

/** The domain in lower-case ASCII, international labels in Punycode, or undefined if it isn't a domain. */
export function asciiDomain(given: string): string | undefined {
  const domain = domainToASCII(given.trim().replace(/\.$/, ""));
  const labels = domain.split(".");
  // domainToASCII accepts some names that aren't domains, like a..b, so check every label too.
  const valid =
    domain.length <= 253 &&
    labels.length >= 2 &&
    labels.every((label) => /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) &&
    !/^[0-9]+$/.test(labels.at(-1) ?? "");
  return valid ? domain : undefined;
}

/** An SES verification status, like TEMPORARY_FAILURE, in words: temporary failure. SUCCESS reads as verified. */
export const verification = (status: string) => (status === "SUCCESS" ? "verified" : status.toLowerCase().replaceAll("_", " "));
