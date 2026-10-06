// Reading and writing raw messages. PostalMime parses the MIME, and html-to-text turns HTML-only
// mail, and a text part that holds an HTML document, into text. Duva writes the MIME of the mail it
// sends itself: a text part, followed by any attachments a forward carries.
import { randomUUID } from "node:crypto";
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
  /**
   * The plain-text body, from the HTML if the message has no text or its text is an HTML document,
   * with \n line endings and none at the end.
   */
  text: string;
  /** Whether the text comes from the HTML, since the message has no text of its own. */
  textFromHtml: boolean;
  /** The HTML body, from the HTML part or a text part that holds an HTML document, if it has one. */
  html?: string;
  attachments: components["schemas"]["Attachment"][];
  /** The attachments' contents, decoded, in the same order. */
  parts: Part[];
}

/** An attachment with its content. */
export interface Part {
  name?: string;
  type: string;
  /** Its Content-ID, in angle brackets, if it has one. */
  contentId?: string;
  content: Uint8Array<ArrayBuffer>;
}

export async function parseMail(raw: Uint8Array): Promise<ParsedMail> {
  const email = await PostalMime.parse(raw, { attachmentEncoding: "arraybuffer" });
  const date = email.date === undefined ? undefined : new Date(email.date);
  const textFromHtml = email.text === undefined || isHtmlDocument(email.text);
  const text = textFromHtml ? htmlToText(email.html ?? email.text ?? "") : email.text!;
  const html = email.html ?? (email.text !== undefined && isHtmlDocument(email.text) ? email.text : undefined);
  const parts = email.attachments.map(({ filename, mimeType, contentId, content }) => ({
    ...(filename !== null && { name: filename }),
    type: mimeType,
    ...(contentId !== undefined && { contentId }),
    content: typeof content === "string" ? new TextEncoder().encode(content) : new Uint8Array(content),
  }));
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
    textFromHtml,
    ...(html !== undefined && { html }),
    attachments: parts.map(({ name, type, content }) => ({ ...(name !== undefined && { name }), type, size: content.byteLength })),
    parts,
  };
}

/** The Message-IDs a header lists, each in its angle brackets, leaving out any comments between them. */
const messageIds = (header: string | undefined) => header?.match(/<[^<>\s]+>/g) ?? [];

/** The addresses in the header, with those of any RFC 5322 address group, each with its display name only if it has one. */
function addresses(list: Address[] | undefined): EmailAddress[] {
  return (list ?? []).flatMap((entry) => (entry.group === undefined ? [entry] : entry.group)).map(({ name, address }) => (name ? { name, address } : { address }));
}

/**
 * Whether the text is an HTML document, as some senders put in a message's text part: it starts
 * with a doctype or an html tag, after any XML declaration and comments.
 */
const isHtmlDocument = (text: string) => /^\s*(<\?xml[^>]*>\s*)?(<!--(?:[^-]|-(?!->))*-->\s*)*(<!doctype html\b|<html\b)/i.test(text);

/** Text for a reader: headings keep their case, images are left out, and links show their targets. */
const htmlToText = (html: string) =>
  convert(html, {
    wordwrap: false,
    selectors: [
      ...["h1", "h2", "h3", "h4", "h5", "h6"].map((selector) => ({ selector, options: { uppercase: false } })),
      { selector: "img", format: "skip" },
    ],
  });

/**
 * The message's text as search indexes it: its text, or for mail with only HTML, the HTML as text
 * without the targets of its links, where trackers sit, and without its images.
 */
export const searchableText = ({ text, textFromHtml, html }: ParsedMail) =>
  textFromHtml && html !== undefined
    ? convert(html, { wordwrap: false, selectors: [{ selector: "img", format: "skip" }, { selector: "a", options: { ignoreHref: true } }] }).replace(/\n+$/, "")
    : text;

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
  /** The attachments it carries, after the text. */
  attachments: Part[];
}

/**
 * The raw MIME of the message, with CRLF line endings. Text outside ASCII, and any subject too long
 * for one line, is written as encoded words. The text is 7bit when it can be and base64 otherwise.
 * With attachments, the message is multipart/mixed, the text first, and each attachment is base64.
 */
export function buildMail({ messageId, from, to, cc, subject, date, inReplyTo, references, headers, text, attachments }: OutgoingMail): Uint8Array {
  const body = text.replace(/\r\n?/g, "\n").split("\n").join("\r\n");
  const plain = isAscii(body) && body.split("\r\n").every((line) => line.length <= 998);
  const textPart = [
    "Content-Type: text/plain; charset=utf-8",
    `Content-Transfer-Encoding: ${plain ? "7bit" : "base64"}`,
    "",
    plain ? body : base64Lines(Buffer.from(body)),
  ];
  const boundary = `duva-${randomUUID()}`;
  const content =
    attachments.length === 0
      ? textPart
      : [
          `Content-Type: multipart/mixed;\r\n boundary="${boundary}"`,
          "",
          ...[textPart, ...attachments.map(attachmentPart)].flatMap((part) => [`--${boundary}`, ...part]),
          `--${boundary}--`,
        ];
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
    ...content,
  ];
  return new TextEncoder().encode(`${lines.join("\r\n")}\r\n`);
}

const base64Lines = (bytes: Uint8Array) => (Buffer.from(bytes).toString("base64").match(/.{1,76}/g) ?? []).join("\r\n");

/** The media type as given if it is one, or else application/octet-stream, so a sender's text never reaches a header as it is. */
export const mediaTypeOf = (type: string) => (/^[\w.+-]+\/[\w.+-]+$/.test(type) ? type : "application/octet-stream");

/**
 * An attachment's part. Its name is given twice, as clients read one or the other: in
 * Content-Type's name, as encoded words in quotes, which RFC 2047 doesn't allow but older clients
 * read, and in Content-Disposition's filename as RFC 2231 parameter values, split into lines that
 * fit. A line break in the sender's name becomes a space, so it can't add header fields.
 */
function attachmentPart({ name: given, type, content }: Part): string[] {
  const name = given?.replace(/[\x00-\x1f\x7f]+/g, " ").trim();
  const named = name !== undefined && name !== "";
  const media = mediaTypeOf(type);
  return [
    named ? `Content-Type: ${media};\r\n name="${isAscii(name) && !/["\\]/.test(name) && name.length <= 60 ? name : encodedWords(name)}"` : `Content-Type: ${media}`,
    named ? `Content-Disposition: attachment;\r\n ${rfc2231("filename", name)}` : "Content-Disposition: attachment",
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(content),
  ];
}

/** The parameter as RFC 2231 extended values in UTF-8, continued over as many lines as it takes to keep each within 78 characters. */
function rfc2231(parameter: string, value: string): string {
  const encoded = [...value].map((character) => (/[A-Za-z0-9.\-_~!$&+^`|#]/.test(character) ? character : [...Buffer.from(character)].map((byte) => `%${byte.toString(16).toUpperCase().padStart(2, "0")}`).join("")));
  const chunks: string[] = [];
  let chunk = "UTF-8''";
  for (const piece of encoded) {
    if (chunk.length + piece.length > 60) {
      chunks.push(chunk);
      chunk = "";
    }
    chunk += piece;
  }
  chunks.push(chunk);
  return chunks.length === 1 ? `${parameter}*=${chunks[0]}` : chunks.map((each, index) => `${parameter}*${index}*=${each}`).join(";\r\n ");
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
