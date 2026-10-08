// What a message offers for unsubscribing from its sender's mail, read from its raw copy while Duva
// still has it, since mail that goes nowhere is kept nowhere (ADR-0025). The safety line of
// ADR-0031: only mail SES didn't judge to be spam offers anything; one-click needs a DKIM signature
// that SES found passing over both unsubscribe headers (ADR-0016); the page and the unsubscribe
// address need mail that passed DMARC, with List-Unsubscribe under such a signature; and a link in
// the body counts only on the signer's own domain, aligned with the From's, or on a mailing
// service's known unsubscribe host. SES heads each raw copy it stores with its verdicts, the spam
// verdict and an Authentication-Results with a DKIM result per signature, and those come first.
// Whether the message passed DMARC, and its envelope sender, come from SES's receipt when the
// caller has it, from the event or as recorded on the stored message, and else from those headers.
import { Parser } from "htmlparser2";
import { domainOf, isEmailAddress } from "./email-address.ts";
import { parseMail } from "./mime.ts";

/** What the message offers, and what bouncing it needs. */
export interface Offer {
  /** The ID SES gave the message, when it received it, and the address it was sent to. */
  sesMessageId: string;
  receivedAt: string;
  recipient: string;
  /** The From's address, in lower case. */
  from: string;
  /** Where a bounce goes, unless the message has no envelope sender. */
  envelopeSender?: string;
  dmarcPassed: boolean;
  /** The one-click URL, or why there is none. */
  oneClick: { url: string } | "noOneClick" | "notSigned";
  /** The List-Unsubscribe page, if the message passed DMARC and a passing signature covers the header. */
  page?: string;
  /** The List-Unsubscribe address, with the subject and body its URI gives, on the same terms. */
  mailto?: { to: string; subject: string; body: string };
  /** The unsubscribe links in its body that count, at most a few. */
  links: string[];
}

/** The hosts of mailing services whose unsubscribe links in a body count, whoever signed the mail, and their subdomains. */
export const knownUnsubscribeHosts = ["list-manage.com", "createsend.com", "constantcontact.com", "klaviyo.com", "substack.com", "beehiiv.com", "mailerlite.com", "convertkit.com"];

/** How many of the body's links count at most, so a page full of them doesn't run the agent many times. */
const linksAtMost = 2;

/** What a link's text or URL says, in the languages Duva's humans write in, when it unsubscribes. */
const unsubscribeWords = /unsubscribe|opt[\s-]?out|avregistrera|avsluta prenumeration|avprenumerera|abmelden|abbestellen|désinscri|désabonner|darse de baja|cancelar suscripci/i;

/**
 * What the raw message offers, or undefined if SES judged it to be spam, which offers nothing.
 * `envelopeSender`, empty for none, and `dmarcPassed` are SES's, if the caller has them.
 */
export async function offerOf(
  raw: Uint8Array,
  { sesMessageId, receivedAt, recipient, envelopeSender, dmarcPassed: given }: { sesMessageId: string; receivedAt: string; recipient: string; envelopeSender?: string; dmarcPassed?: boolean },
): Promise<Offer | undefined> {
  const fields = fieldsOf(raw);
  const first = (name: string) => fields.find((field) => field.name === name)?.value;
  if (first("x-ses-spam-verdict")?.toUpperCase() === "FAIL") return undefined;
  const parsed = await parseMail(raw);
  const from = (parsed.from?.address ?? "").toLowerCase();
  const results = sesResults(fields);
  const dmarcPassed = given ?? results?.some((result) => /^dmarc=pass\b/i.test(result)) ?? false;
  const signatures = passingSignatures(fields, results);
  // SES heads the raw copy with the envelope sender as Return-Path.
  const returnPath = (envelopeSender ?? /<([^>]*)>/.exec(first("return-path") ?? "")?.[1])?.trim().toLowerCase();
  const all = (name: string) => fields.filter((field) => field.name === name).map(({ value }) => value);
  const [unsubscribe, ...moreUnsubscribe] = all("list-unsubscribe");
  const uris = unsubscribe === undefined || moreUnsubscribe.length > 0 ? [] : [...unsubscribe.matchAll(/<([^>]*)>/g)].map(([, uri]) => uri!.replace(/\s/g, ""));
  const headerSigned = signatures.some(({ headers }) => headers.includes("list-unsubscribe"));
  const listed = dmarcPassed && headerSigned;
  const page = listed ? uris.find((uri) => /^https:\/\//i.test(uri) && URL.canParse(uri)) : undefined;
  const mailto = listed ? mailtoOf(uris.find((uri) => /^mailto:/i.test(uri))) : undefined;
  return {
    sesMessageId,
    receivedAt,
    recipient,
    from,
    ...(returnPath !== undefined && returnPath !== "" && { envelopeSender: returnPath }),
    dmarcPassed,
    oneClick: oneClickOffered(fields, uris, signatures),
    ...(page !== undefined && { page }),
    ...(mailto !== undefined && { mailto }),
    links: dmarcPassed ? bodyLinks(parsed.html ?? "", parsed.text ?? "", signedDomains(signatures, from)) : [],
  };
}

/** A header field: its name in lower case, and its value unfolded. */
interface Field {
  name: string;
  value: string;
}

/** The header fields of the raw message, in order. */
function fieldsOf(raw: Uint8Array): Field[] {
  const text = new TextDecoder().decode(raw);
  const end = text.search(/\r?\n\r?\n/);
  const header = end < 0 ? text : text.slice(0, end);
  return header
    .split(/\r?\n(?![ \t])/)
    .map((field) => {
      const colon = field.indexOf(":");
      return { name: field.slice(0, colon).trim().toLowerCase(), value: field.slice(colon + 1).replace(/\r?\n[ \t]/g, " ").trim() };
    })
    .filter(({ name }) => name !== "");
}

/** The results in SES's Authentication-Results, the first, or undefined if the first isn't SES's. A sender can write its own lower down. */
function sesResults(fields: Field[]): string[] | undefined {
  const results = fields.find(({ name }) => name === "authentication-results")?.value.split(";").map((part) => part.trim());
  return results?.[0]?.toLowerCase() === "amazonses.com" ? results : undefined;
}

/** A DKIM signature SES found passing: its domain, the headers it covers, and whether it covers the whole body. */
interface Signature {
  domain: string;
  headers: string[];
  wholeBody: boolean;
}

/**
 * The DKIM signatures every result SES gave for their domain passed. SES names each signature by
 * its identity, which is on the signature's domain or under it. So a signature that fails beside a
 * passing one of the same domain refuses both, and a failed result naming no signature refuses all.
 */
function passingSignatures(fields: Field[], results: string[] | undefined): Signature[] {
  if (results === undefined) return [];
  const dkim = results.flatMap((result) => {
    const verdict = /^dkim=(\w+)/i.exec(result)?.[1]?.toLowerCase();
    if (verdict === undefined || verdict === "none") return [];
    const identity = /\bheader\.[id]=(\S+)/i.exec(result)?.[1];
    return [{ passed: verdict === "pass", domain: identity?.slice(identity.lastIndexOf("@") + 1).toLowerCase() }];
  });
  if (dkim.some(({ passed, domain }) => !passed && domain === undefined)) return [];
  return fields
    .filter(({ name }) => name === "dkim-signature")
    .flatMap(({ value }) => {
      const tags = new Map(value.split(";").map((tag) => tag.replace(/\s/g, "").split("=", 2) as [string, string]).map(([name, tagged = ""]) => [name.toLowerCase(), tagged]));
      const domain = tags.get("d")?.toLowerCase();
      if (domain === undefined) return [];
      const ofDomain = dkim.filter((result) => result.domain === domain || result.domain?.endsWith(`.${domain}`));
      if (ofDomain.length === 0 || !ofDomain.every(({ passed }) => passed)) return [];
      return [{ domain, headers: (tags.get("h") ?? "").toLowerCase().split(":"), wholeBody: !tags.has("l") }];
    });
}

/**
 * The one-click URL the message offers, or why it offers none: it has no https List-Unsubscribe
 * with List-Unsubscribe-Post One-Click, each exactly once, or no signature that passed covers both.
 */
function oneClickOffered(fields: Field[], uris: string[], signatures: Signature[]): Offer["oneClick"] {
  const posts = fields.filter((field) => field.name === "list-unsubscribe-post").map(({ value }) => value);
  if (uris.length === 0 || posts.length !== 1 || posts[0]!.toLowerCase() !== "list-unsubscribe=one-click") return "noOneClick";
  const url = uris.find((uri) => /^https:\/\//i.test(uri));
  if (url === undefined || !URL.canParse(url)) return "noOneClick";
  return signatures.some(({ headers }) => headers.includes("list-unsubscribe") && headers.includes("list-unsubscribe-post")) ? { url } : "notSigned";
}

/** The address, subject and body of a mailto: URI (RFC 6068), its first address if it has several, or undefined if it has none. */
function mailtoOf(uri: string | undefined): Offer["mailto"] {
  if (uri === undefined) return undefined;
  const [path = "", query = ""] = uri.slice("mailto:".length).split("?", 2);
  const decode = (part: string) => {
    try {
      return decodeURIComponent(part);
    } catch {
      return undefined;
    }
  };
  const to = decode(path.split(",")[0] ?? "")?.trim();
  if (to === undefined || !isEmailAddress(to)) return undefined;
  const fields = new Map(query.split("&").map((pair) => pair.split("=", 2) as [string, string?]).map(([name, value = ""]) => [name.toLowerCase(), decode(value) ?? ""]));
  return { to: to.toLowerCase(), subject: fields.get("subject") || "unsubscribe", body: fields.get("body") ?? "" };
}

/**
 * The domains whose links in the body count: those of signatures that passed over the whole body
 * and are aligned with the From's domain, the one on or under the other, as DMARC's relaxed
 * alignment roughly has it.
 */
function signedDomains(signatures: Signature[], from: string): string[] {
  const fromDomain = domainOf(from);
  const under = (domain: string, parent: string) => domain === parent || domain.endsWith(`.${parent}`);
  return signatures.filter(({ domain, wholeBody }) => wholeBody && (under(fromDomain, domain) || under(domain, fromDomain))).map(({ domain }) => domain);
}

/**
 * The https links in the body that say they unsubscribe, by their text or their URL, on a domain
 * given or a known unsubscribe host, or under one, in the order they come, each once.
 */
function bodyLinks(html: string, text: string, domains: string[]): string[] {
  const found: string[] = [];
  let href: string | undefined;
  let words = "";
  const parser = new Parser({
    onopentag(name, attributes) {
      if (name === "a") {
        href = attributes.href;
        words = "";
      }
    },
    ontext(data) {
      if (href !== undefined) words += data;
    },
    onclosetag(name) {
      if (name !== "a" || href === undefined) return;
      if (unsubscribeWords.test(words) || unsubscribeWords.test(href)) found.push(href.trim());
      href = undefined;
    },
  });
  parser.write(html);
  parser.end();
  for (const [url] of text.matchAll(/https:\/\/[^\s<>"]+/g)) if (unsubscribeWords.test(url)) found.push(url);
  const hosts = [...domains, ...knownUnsubscribeHosts];
  const counts = (url: string) => {
    if (!/^https:\/\//i.test(url) || !URL.canParse(url)) return false;
    const host = new URL(url).hostname.toLowerCase();
    return hosts.some((each) => host === each || host.endsWith(`.${each}`));
  };
  return [...new Set(found.filter(counts))].slice(0, linksAtMost);
}
