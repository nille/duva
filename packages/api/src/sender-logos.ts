// Sender logos (ADR-0023): the logo a sender's domain publishes through BIMI, which Duva shows in
// place of the sender's actor mark when the message passed DMARC and the domain enforces it. The
// inbound Lambda looks the logo up when mail arrives, and the logo fetcher Lambda fetches it, so
// opening mail never reaches the sender. Each lookup is kept for a while per domain and selector,
// and each logo once per content, under an ID of its own, so its URL says nothing of where it came
// from. Any failure means no logo, never an error.
import { randomUUID, createHash, X509Certificate } from "node:crypto";
import { GetCommand, PutCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { InvokeCommand, type LambdaClient } from "@aws-sdk/client-lambda";
import type { components } from "@duva/openapi";
import type { Table } from "./deployment.ts";
import type { Dns } from "./dns-records.ts";
import { timeToLiveAttribute } from "./infrastructure.ts";
import { abortable, type Network, sendPublic, TooLarge } from "./internet.ts";
import { tinyPsLogo } from "./svg-tiny-ps.ts";
import { documents, isNew, pk, sk } from "./table.ts";
import { verifiesLogo } from "./verified-marks.ts";

export type SenderLogo = components["schemas"]["SenderLogo"];

/** Fetches a logo or a mark certificate from the sender's server, or undefined when it can't. */
export interface LogoFetcher {
  get(url: string): Promise<Uint8Array | undefined>;
}

/** What looking up sender logos needs: DNS, the logo fetcher, the roots mark certificates lead to, and the URL Duva serves each logo at, by its ID. */
export interface SenderLogos {
  dns: Dns;
  fetcher: LogoFetcher;
  roots: X509Certificate[];
  url: (logo: string) => string;
}

/** Where Duva serves the logo with the ID, under the URL download links lead to. */
export const logoUrl = (downloadUrl: string, logo: string) => `${downloadUrl}logos/${logo}`;

/** The ID of the logo a path leads to under the download URL, or undefined if it leads to none. */
export const logoAt = (path: string) => /\/logos\/([0-9a-f-]{36})$/.exec(path)?.[1];

/** The selector of a message whose BIMI-Selector header names none, or one that isn't a DNS name. */
const defaultSelector = "default";

/** How long a lookup is kept: a day, or an hour when DNS or the sender's server failed. */
const lookupKept = 24 * 3600;
const failureKept = 3600;

/** How long fetching a logo or a mark certificate may take, and how long a certificate may be, which carries its logo. */
const fetchTimeout = 5_000;
const longestCertificate = 128 * 1024;

const lookupKey = (domain: string, selector: string) => ({ [pk]: `bimi#${domain}`, [sk]: `selector#${selector}` });
const logoKey = (id: string) => ({ [pk]: `logo#${id}`, [sk]: "logo" });
const contentKey = (svg: string) => ({ [pk]: `logoContent#${createHash("sha256").update(svg).digest("base64url")}`, [sk]: "logoContent" });

/** A lookup that failed, which is kept for less time than one that found what the domain publishes. */
class LookupFailed extends Error {}

/**
 * The logo of the domain, a message's From domain with a DMARC pass, for the selector its
 * BIMI-Selector header names, as kept from a recent lookup or looked up now. Undefined when the
 * domain doesn't enforce DMARC, publishes no valid logo, or anything fails.
 */
export async function senderLogo(table: Table, logos: SenderLogos, { domain, selector: named }: { domain: string; selector?: string }): Promise<SenderLogo | undefined> {
  domain = domain.toLowerCase();
  const selector = named !== undefined && /^[a-z0-9_-]+(\.[a-z0-9_-]+)*$/i.test(named) ? named.toLowerCase() : defaultSelector;
  try {
    const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: lookupKey(domain, selector) }));
    if (Item !== undefined && Date.parse(Item.expiresAt as string) > Date.now()) return Item.logo as SenderLogo | undefined;
    let found: { logo?: SenderLogo; failed?: boolean } = {};
    try {
      found = await lookUp(table, logos, domain, selector);
    } catch (error) {
      if (!(error instanceof LookupFailed)) throw error;
      console.log(`The sender logo of ${domain} wasn't found: ${error.message}`);
      found = { failed: true };
    }
    const { logo, failed = false } = found;
    const kept = failed ? failureKept : lookupKept;
    const expires = new Date(Date.now() + kept * 1000);
    await documents(table).send(
      new PutCommand({ TableName: table.name, Item: { ...lookupKey(domain, selector), ...(logo !== undefined && { logo }), expiresAt: expires.toISOString(), [timeToLiveAttribute]: Math.ceil(expires.getTime() / 1000) } }),
    );
    return logo;
  } catch (error) {
    console.error(error);
    return undefined;
  }
}

/**
 * Looks up the domain's logo: its DMARC policy, its BIMI record, the logo and any mark certificate.
 * A certificate that can't be fetched leaves the logo unverified, and the lookup failed, so it is
 * soon looked up again.
 */
async function lookUp(table: Table, logos: SenderLogos, domain: string, selector: string): Promise<{ logo?: SenderLogo; failed?: boolean }> {
  const dmarc = await dmarcPolicy(logos.dns, domain);
  if (dmarc === undefined || !dmarc.enforced) return {};
  // Without the Public Suffix List, the organizational domain is the one whose DMARC record covers the domain.
  const found = (await bimiRecord(logos.dns, selector, domain)) ?? (dmarc.at === domain ? undefined : await bimiRecord(logos.dns, selector, dmarc.at));
  if (found?.logo === undefined) return {};
  const [bytes, certificate] = await Promise.all([fetched(logos.fetcher, found.logo), found.certificate === undefined ? undefined : logos.fetcher.get(found.certificate)]);
  const svg = tinyPsLogo(bytes);
  if (svg === undefined) return {};
  const verified =
    certificate !== undefined && verifiesLogo(new TextDecoder().decode(certificate), { domains: [domain, found.domain], logo: bytes, roots: logos.roots, at: new Date() });
  return { logo: { url: logos.url(await storeLogo(table, svg)), verified }, failed: found.certificate !== undefined && certificate === undefined };
}

async function fetched(fetcher: LogoFetcher, url: string): Promise<Uint8Array> {
  const body = await fetcher.get(url);
  if (body === undefined) throw new LookupFailed(`${url} couldn't be fetched`);
  return body;
}

/** The TXT records at the name, throwing LookupFailed when DNS fails. */
async function txt(dns: Dns, name: string): Promise<string[]> {
  try {
    return await dns.resolve("TXT", name);
  } catch (error) {
    throw new LookupFailed(`DNS failed for ${name}: ${String(error)}`);
  }
}

/** A record's tags, by name in lower case. */
export const tagsOf = (record: string) =>
  new Map(
    record.split(";").flatMap((tag) => {
      const equals = tag.indexOf("=");
      return equals < 0 ? [] : [[tag.slice(0, equals).trim().toLowerCase(), tag.slice(equals + 1).trim()] as const];
    }),
  );

/**
 * The domain's DMARC policy, from its own record or else the nearest parent's, walking up to the
 * domain below the top level, as dns-records.ts does: whether it enforces DMARC on all its mail,
 * quarantine or reject at pct 100, and where the record is. A parent's sp= is the policy for its
 * subdomains. Undefined when no record covers the domain.
 */
export async function dmarcPolicy(dns: Dns, domain: string): Promise<{ enforced: boolean; at: string } | undefined> {
  const labels = domain.split(".");
  for (let start = 0; start < labels.length - 1; start++) {
    const at = labels.slice(start).join(".");
    const records = (await txt(dns, `_dmarc.${at}`)).filter((text) => /^v\s*=\s*DMARC1\s*(;|$)/i.test(text));
    if (records.length === 0) continue;
    // Receivers ignore a name with two records.
    if (records.length > 1) return undefined;
    const tags = tagsOf(records[0]!);
    const policy = ((start > 0 ? tags.get("sp") : undefined) ?? tags.get("p"))?.toLowerCase();
    const pct = tags.get("pct") ?? "100";
    return { enforced: (policy === "quarantine" || policy === "reject") && pct === "100", at };
  }
  return undefined;
}

/**
 * The domain's BIMI record for the selector: the logo's https URL, if it gives one, and the mark
 * certificate's. Undefined when there is none, or more than one, which BIMI ignores.
 */
async function bimiRecord(dns: Dns, selector: string, domain: string): Promise<{ domain: string; logo?: string; certificate?: string } | undefined> {
  const records = (await txt(dns, `${selector}._bimi.${domain}`)).filter((text) => /^v\s*=\s*BIMI1\s*(;|$)/i.test(text));
  if (records.length !== 1) return undefined;
  const tags = tagsOf(records[0]!);
  const https = (url: string | undefined) => (url !== undefined && /^https:\/\//i.test(url) && URL.canParse(url) ? url : undefined);
  return { domain, logo: https(tags.get("l")), certificate: https(tags.get("a")) };
}

/** Stores the logo once, and returns its ID: a new one, or the one the same logo has. */
async function storeLogo(table: Table, svg: string): Promise<string> {
  const id = randomUUID();
  try {
    await documents(table).send(
      new TransactWriteCommand({
        TransactItems: [
          { Put: { TableName: table.name, Item: { ...contentKey(svg), logo: id }, ...isNew } },
          { Put: { TableName: table.name, Item: { ...logoKey(id), svg } } },
        ],
      }),
    );
    return id;
  } catch (error) {
    if (!(error instanceof TransactionCanceledException)) throw error;
    const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: contentKey(svg), ConsistentRead: true }));
    if (Item === undefined) throw error;
    return Item.logo as string;
  }
}

/** The logo's SVG, as Duva wrote it out, or undefined if there is no logo with the ID. */
export async function storedLogo(table: Table, id: string): Promise<string | undefined> {
  const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: logoKey(id) }));
  return Item?.svg as string | undefined;
}

/**
 * Fetches the URL with a GET over https only, as internet.ts sends it, following a few redirects
 * to https, and answers with its body if it is a 2xx of up to `maxBytes`.
 */
export async function getLogo(network: Network, url: string, maxBytes: number): Promise<Uint8Array | undefined> {
  const signal = AbortSignal.timeout(fetchTimeout);
  try {
    let at = new URL(url);
    for (let redirects = 0; redirects <= 3; redirects++) {
      const answer = await abortable(sendPublic(network, at, { method: "GET", schemes: ["https:"], headers: { "user-agent": "Duva BIMI" }, maxBytes, signal }), signal);
      if (typeof answer === "string") return undefined;
      if ([301, 302, 303, 307, 308].includes(answer.status) && answer.location !== undefined) {
        at = new URL(answer.location, at);
        continue;
      }
      return answer.status >= 200 && answer.status < 300 ? answer.body : undefined;
    }
    return undefined;
  } catch (error) {
    if (!(error instanceof TooLarge)) console.log(`${url} couldn't be fetched: ${String(error)}`);
    return undefined;
  }
}

/** What the logo fetcher Lambda is asked: the URL of a logo or a mark certificate. */
export interface LogoRequest {
  url: string;
}

/**
 * The logo fetcher Lambda's answer: the body, base64-encoded, or nothing. A certificate carries
 * its logo, so it may be longer than one, and tinyPsLogo refuses a logo that is too long.
 */
export const fetchForLogo = async (network: Network, { url }: LogoRequest) => {
  const body = await getLogo(network, url, longestCertificate);
  return body === undefined ? {} : { body: Buffer.from(body).toString("base64") };
};

/** The logo fetcher Lambda, which the inbound Lambda invokes and waits for. */
export function lambdaLogoFetcher(lambda: LambdaClient, functionName: string): LogoFetcher {
  return {
    async get(url) {
      try {
        const { FunctionError, Payload } = await lambda.send(new InvokeCommand({ FunctionName: functionName, Payload: JSON.stringify({ url } satisfies LogoRequest) }));
        if (FunctionError !== undefined) throw new Error(`The logo fetcher failed: ${new TextDecoder().decode(Payload)}`);
        const { body } = JSON.parse(new TextDecoder().decode(Payload)) as { body?: string };
        return body === undefined ? undefined : new Uint8Array(Buffer.from(body, "base64"));
      } catch (error) {
        console.error(error);
        return undefined;
      }
    },
  };
}
