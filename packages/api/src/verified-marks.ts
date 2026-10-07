// Mark certificates: the VMC or CMC a BIMI record's a= names, which a Mark Verifying Authority
// issues once it has checked that the logo is the brand's (ADR-0023). Duva takes one as verifying a
// logo when its chain leads to one of the authorities' roots, every certificate in it is valid now
// and for marks, the first names the domain, and the logo it carries is the logo the record gives.
// Revocation isn't checked.
import { X509Certificate } from "node:crypto";
import { gunzipSync } from "node:zlib";

/** The extended key usage of a mark certificate, BIMI's (RFC 9495's id-kp-BrandIndicatorforMessageIdentification). */
export const markPurpose = "1.3.6.1.5.5.7.3.31";

/** The logotype extension (RFC 3709), in which a mark certificate carries its logo. */
const logotypeExtension = "1.3.6.1.5.5.7.1.12";

/** How many certificates a chain may have, its root included. */
const longestChain = 5;

/**
 * Whether the PEM chain is a mark certificate, then the certificates that issued it, that leads to
 * one of the roots, every certificate in it valid at `at` and for marks, its first naming one of
 * `domains` and carrying exactly the logo's SVG.
 */
export function verifiesLogo(pem: string, { domains, logo, roots, at }: { domains: string[]; logo: Uint8Array; roots: X509Certificate[]; at: Date }): boolean {
  let chain: X509Certificate[];
  try {
    chain = (pem.match(/-----BEGIN CERTIFICATE-----[^-]+-----END CERTIFICATE-----/g) ?? []).map((each) => new X509Certificate(each));
  } catch {
    return false;
  }
  const [mark, ...issuers] = chain;
  if (mark === undefined || mark.ca || !mark.keyUsage?.includes(markPurpose)) return false;
  if (!namesDomain(mark, domains)) return false;
  const carried = logoOf(mark);
  if (carried === undefined || !Buffer.from(carried).equals(Buffer.from(logo))) return false;
  const current = (certificate: X509Certificate) => certificate.validFromDate <= at && at <= certificate.validToDate;
  // An issuing certificate that names its purposes must name marks among them.
  const forMarks = (certificate: X509Certificate) => certificate.keyUsage === undefined || certificate.keyUsage.includes(markPurpose);
  const issued = (certificate: X509Certificate, by: X509Certificate) => by.ca && certificate.checkIssued(by) && certificate.verify(by.publicKey);
  let certificate = mark;
  for (let length = 1; length < longestChain; length++) {
    if (!current(certificate)) return false;
    const root = roots.find((each) => issued(certificate, each));
    if (root !== undefined) return current(root);
    const issuer = issuers.find((each) => each !== certificate && issued(certificate, each) && forMarks(each));
    if (issuer === undefined) return false;
    certificate = issuer;
  }
  return false;
}

/** Whether the certificate's subject alternative names include one of the domains. */
function namesDomain(certificate: X509Certificate, domains: string[]): boolean {
  const names = (certificate.subjectAltName ?? "")
    .split(", ")
    .flatMap((name) => (name.startsWith("DNS:") ? [name.slice(4).toLowerCase()] : []));
  return domains.some((domain) => names.includes(domain.toLowerCase()));
}

/** The SVG the mark certificate carries in its logotype extension, as a data: URI, gzipped or not. */
function logoOf(certificate: X509Certificate): Uint8Array | undefined {
  try {
    const extension = extensionOf(new Uint8Array(certificate.raw), logotypeExtension);
    if (extension === undefined) return undefined;
    const uri = ia5Strings(extension, read(extension, 0)).find((each) => /^data:image\/svg\+xml(;[^,]*)?,/i.test(each));
    if (uri === undefined) return undefined;
    const comma = uri.indexOf(",");
    const data = /;base64$/i.test(uri.slice(0, comma)) ? Buffer.from(uri.slice(comma + 1), "base64") : Buffer.from(decodeURIComponent(uri.slice(comma + 1)));
    return new Uint8Array(data[0] === 0x1f && data[1] === 0x8b ? gunzipSync(data, { maxOutputLength: 1 << 20 }) : data);
  } catch {
    return undefined;
  }
}

/** A DER element: its tag, and where its value starts and ends. */
interface Element {
  tag: number;
  start: number;
  end: number;
}

/** The DER element at the offset. */
function read(der: Uint8Array, offset: number): Element {
  const tag = der[offset]!;
  let length = der[offset + 1]!;
  let start = offset + 2;
  if (length & 0x80) {
    const bytes = length & 0x7f;
    if (bytes === 0 || bytes > 4) throw new Error("Not DER");
    length = 0;
    for (let i = 0; i < bytes; i++) length = length * 256 + der[start + i]!;
    start += bytes;
  }
  const end = start + length;
  if (end > der.length) throw new Error("Not DER");
  return { tag, start, end };
}

/** The elements inside a constructed element. */
function children(der: Uint8Array, { start, end }: Element): Element[] {
  const inside: Element[] = [];
  for (let offset = start; offset < end; ) {
    const child = read(der, offset);
    inside.push(child);
    offset = child.end;
  }
  return inside;
}

/** The value of the certificate's extension with the OID, the DER inside its OCTET STRING. */
function extensionOf(der: Uint8Array, oid: string): Uint8Array | undefined {
  const [tbs] = children(der, read(der, 0));
  // Extensions are the tbsCertificate's [3], a SEQUENCE of SEQUENCEs: OID, critical, OCTET STRING.
  const tagged = children(der, tbs!).find(({ tag }) => tag === 0xa3);
  if (tagged === undefined) return undefined;
  for (const extension of children(der, children(der, tagged)[0]!)) {
    const [id, ...rest] = children(der, extension);
    const value = rest.at(-1);
    if (id?.tag === 0x06 && objectId(der.subarray(id.start, id.end)) === oid && value?.tag === 0x04) return der.subarray(value.start, value.end);
  }
  return undefined;
}

/** Every IA5String in the element, at any depth. */
function ia5Strings(der: Uint8Array, element: Element): string[] {
  if (element.tag === 0x16) return [new TextDecoder().decode(der.subarray(element.start, element.end))];
  if ((element.tag & 0x20) === 0) return [];
  return children(der, element).flatMap((child) => ia5Strings(der, child));
}

/** An OBJECT IDENTIFIER's value in dotted form. */
function objectId(bytes: Uint8Array): string {
  const arcs: number[] = [];
  let arc = 0;
  for (const byte of bytes) {
    arc = arc * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) {
      arcs.push(arc);
      arc = 0;
    }
  }
  const [first = 0, ...rest] = arcs;
  return [Math.min(2, Math.floor(first / 40)), first - Math.min(2, Math.floor(first / 40)) * 40, ...rest].join(".");
}
