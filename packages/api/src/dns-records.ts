// The DNS records a domain needs for SES, and whether DNS answers with them. duva deploy checks
// the first domain's, and the API those of the domains admins add later (ADR-0018). Duva never
// changes anyone's DNS.
import { resolveCname, resolveMx, resolveTxt } from "node:dns/promises";
import { domainToASCII } from "node:url";

export type RecordType = "MX" | "TXT" | "CNAME";

export interface Dns {
  /**
   * The records of the type at the name: MX as "priority host", TXT with its strings joined.
   * Empty when there are none. Throws when the lookup fails.
   */
  resolve(type: RecordType, name: string): Promise<string[]>;
}

/** The system's resolver, through node:dns. */
export const realDns: Dns = {
  async resolve(type, name) {
    try {
      switch (type) {
        case "MX":
          return (await resolveMx(name)).map(({ priority, exchange }) => `${priority} ${exchange}`);
        case "TXT":
          return (await resolveTxt(name)).map((strings) => strings.join(""));
        case "CNAME":
          return await resolveCname(name);
      }
    } catch (error) {
      // No such name, or no record of the type there: either way, no record.
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOTFOUND" || code === "ENODATA") return [];
      throw error;
    }
  },
};

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

export type WantedRecord = Omit<DnsRecord, "status" | "found" | "error">;

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
  const records = await Promise.all(wanted.map((record) => check(dns, record)));

  // The domain needs a DMARC record of its own only if none covers it from a parent domain.
  const dmarc = await check(dns, { purpose: "DMARC", type: "TXT", name: `_dmarc.${domain}`, value: "v=DMARC1; p=none;" });
  const coveredBy = dmarc.status === "missing" ? await parentDmarc(dns, domain) : undefined;
  if (coveredBy === undefined) records.push(dmarc);
  return { records, coveredBy };
}

/** The record with whether DNS answers with it. */
async function check(dns: Dns, record: WantedRecord): Promise<DnsRecord> {
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
