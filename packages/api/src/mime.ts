// Reading and writing raw messages. PostalMime parses the MIME, and html-to-text turns HTML-only
// mail into text. Duva writes the MIME of the mail it sends itself, with a text part only.
import { convert } from "html-to-text";
import PostalMime, { type Address } from "postal-mime";
import type { components } from "@duva/openapi";

type EmailAddress = components["schemas"]["EmailAddress"];

/** What Duva reads from a raw message. */
export interface ParsedMail {
  messageId?: string;
  /** The Message-IDs of the messages it answers: In-Reply-To's first, then References' from the newest. */
  answers: string[];
  /**
   * The Message-IDs a reply to it continues, oldest first: those its References header lists, or
   * without one, the one its In-Reply-To gives (RFC 5322, section 3.6.4).
   */
  references: string[];
  from?: EmailAddress;
  to: EmailAddress[];
  cc: EmailAddress[];
  /** Where the sender wants replies, if the message says. */
  replyTo: EmailAddress[];
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
    answers: [...new Set([...messageIds(email.inReplyTo), ...messageIds(email.references).reverse()])],
    references: email.references === undefined ? messageIds(email.inReplyTo).slice(0, 1) : messageIds(email.references),
    from: email.from && addresses([email.from])[0],
    to: addresses(email.to),
    cc: addresses(email.cc),
    replyTo: addresses(email.replyTo),
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

/** The Message-IDs a header lists, each in its angle brackets, leaving out any comments between them. */
const messageIds = (header: string | undefined) => header?.match(/<[^<>\s]+>/g) ?? [];

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

/** A message Duva sends. */
export interface OutgoingMail {
  /** Its Message-ID, in angle brackets. */
  messageId: string;
  from: EmailAddress;
  to: EmailAddress[];
  cc: EmailAddress[];
  subject: string;
  date: Date;
  /** The Message-ID of the message it answers, if it is a reply. */
  inReplyTo?: string;
  /** The Message-IDs of the thread's messages it follows, oldest first. */
  references: string[];
  /** More header fields, each unstructured text. */
  headers: [name: string, value: string][];
  text: string;
}

/**
 * The raw MIME of the message, with CRLF line endings. Text outside ASCII, and any subject too long
 * for one line, is written as encoded words. The body is 7bit when it can be and base64 otherwise.
 */
export function buildMail({ messageId, from, to, cc, subject, date, inReplyTo, references, headers, text }: OutgoingMail): Uint8Array {
  const body = text.replace(/\r\n?/g, "\n").split("\n").join("\r\n");
  const plain = isAscii(body) && body.split("\r\n").every((line) => line.length <= 998);
  const lines = [
    `From: ${addressField(from)}`,
    `To: ${to.map(addressField).join(",\r\n ")}`,
    ...(cc.length === 0 ? [] : [`Cc: ${cc.map(addressField).join(",\r\n ")}`]),
    `Subject: ${unstructured("Subject", subject)}`,
    `Date: ${date.toUTCString().replace(/GMT$/, "+0000")}`,
    `Message-ID: ${messageId}`,
    ...(inReplyTo === undefined ? [] : [`In-Reply-To: ${inReplyTo}`]),
    ...(references.length === 0 ? [] : [`References: ${references.join("\r\n ")}`]),
    ...headers.map(([name, value]) => `${name}: ${unstructured(name, value)}`),
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    `Content-Transfer-Encoding: ${plain ? "7bit" : "base64"}`,
    "",
    plain ? body : (Buffer.from(body).toString("base64").match(/.{1,76}/g) ?? []).join("\r\n"),
  ];
  return new TextEncoder().encode(`${lines.join("\r\n")}\r\n`);
}

const isAscii = (text: string) => /^[\x20-\x7e\t\r\n]*$/.test(text);

/** The address with its display name, if it has one, quoted or as encoded words. */
function addressField({ name, address }: EmailAddress): string {
  const display = name?.replace(/[\r\n]+/g, " ").trim();
  if (!display) return address;
  return `${isAscii(display) ? `"${display.replace(/["\\]/g, "\\$&")}"` : encodedWords(display)} <${address}>`;
}

/** The header field's text as is if it fits on one line in ASCII, or else as encoded words. */
function unstructured(name: string, value: string): string {
  const line = value.replace(/[\r\n]+/g, " ");
  return isAscii(line) && name.length + 2 + line.length <= 78 ? line : encodedWords(line);
}

/**
 * The text as RFC 2047 encoded words of at most 39 bytes of UTF-8 each, one per folded line, so
 * each line stays within 78 characters, even the first after the field's name.
 */
function encodedWords(text: string): string {
  const words: string[] = [];
  let chunk = "";
  for (const character of text) {
    if (Buffer.byteLength(chunk + character) > 39) {
      words.push(chunk);
      chunk = "";
    }
    chunk += character;
  }
  words.push(chunk);
  return words.map((word) => `=?UTF-8?B?${Buffer.from(word).toString("base64")}?=`).join("\r\n ");
}
