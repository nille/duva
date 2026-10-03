// Reading a raw message. PostalMime parses the MIME, and html-to-text turns HTML-only mail into text.
import { convert } from "html-to-text";
import PostalMime, { type Address } from "postal-mime";
import type { components } from "@duva/openapi";

type EmailAddress = components["schemas"]["EmailAddress"];

/** What Duva reads from a raw message. */
export interface ParsedMail {
  messageId?: string;
  from?: EmailAddress;
  to: EmailAddress[];
  cc: EmailAddress[];
  subject: string;
  /** When the sender says it was sent, as an ISO 8601 time, if the Date header gives one. */
  date?: string;
  /** The plain-text body, from the HTML if the message has no text, with \n line endings and none at the end. */
  text: string;
  attachments: components["schemas"]["Attachment"][];
}

export async function parseMail(raw: Uint8Array): Promise<ParsedMail> {
  const email = await PostalMime.parse(raw, { attachmentEncoding: "arraybuffer" });
  const date = email.date === undefined ? undefined : new Date(email.date);
  const text = email.text ?? (email.html === undefined ? "" : htmlToText(email.html));
  return {
    messageId: email.messageId,
    from: email.from && addresses([email.from])[0],
    to: addresses(email.to),
    cc: addresses(email.cc),
    subject: email.subject ?? "",
    date: date === undefined || Number.isNaN(date.getTime()) ? undefined : date.toISOString(),
    text: text.replace(/\r\n?/g, "\n").replace(/\n+$/, ""),
    attachments: email.attachments.map(({ filename, mimeType, content }) => ({
      ...(filename !== null && { name: filename }),
      type: mimeType,
      size: typeof content === "string" ? new TextEncoder().encode(content).length : content.byteLength,
    })),
  };
}

/** The addresses in the header, with those of any RFC 5322 address group, each with its display name only if it has one. */
function addresses(list: Address[] | undefined): EmailAddress[] {
  return (list ?? []).flatMap((entry) => (entry.group === undefined ? [entry] : entry.group)).map(({ name, address }) => (name ? { name, address } : { address }));
}

/** Text for a reader: headings keep their case, images are left out, and links show their targets. */
const htmlToText = (html: string) =>
  convert(html, {
    wordwrap: false,
    selectors: [
      ...["h1", "h2", "h3", "h4", "h5", "h6"].map((selector) => ({ selector, options: { uppercase: false } })),
      { selector: "img", format: "skip" },
    ],
  });
