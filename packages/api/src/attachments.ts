// Downloading attachments. Asking for one gives a short-lived link, and following it takes the
// attachment from the raw message there and then, so nothing is stored twice. The link's ticket is
// the only thing kept, under the hash of its token, until the table's time to live removes it.
import { createHash, randomBytes } from "node:crypto";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import type { components } from "@duva/openapi";
import { type OperationHandler, refusal } from "./api.ts";
import type { Table } from "./deployment.ts";
import { timeToLiveAttribute } from "./infrastructure.ts";
import type { MailBucket } from "./mail-bucket.ts";
import { findMessage } from "./mail.ts";
import { mediaTypeOf } from "./mime.ts";
import { mailboxFor } from "./access.ts";
import { documents, pk, sk } from "./table.ts";

/** Where download links lead, and how long each works. */
export interface Downloads {
  /** The URL each link is the token appended to, ending in a slash. */
  url: string;
  /** How many seconds a link works. */
  lifetime: number;
}

/** How many seconds a download link works, unless a test says otherwise. */
export const downloadLinkLifetime = 300;

// A ticket is found by the hash of its token, so the table never holds a working link.
const ticketKey = (token: string) => ({ [pk]: `download#${createHash("sha256").update(token).digest("base64url")}`, [sk]: "download" });

interface Ticket {
  mailbox: string;
  message: string;
  attachment: number;
  expiresAt: string;
}

export const getAttachment: OperationHandler = async (event, deployment, actor) => {
  const mailbox = await mailboxFor(event, deployment, actor!, "read");
  if ("statusCode" in mailbox) return mailbox;
  const id = event.pathParameters?.message ?? "";
  const given = event.pathParameters?.attachment ?? "";
  if (!/^\d+$/.test(given)) return refusal(400, `${JSON.stringify(given)} isn't an attachment's place. Give attachment as a whole number from 0.`);
  const found = await findMessage(deployment.table, deployment.mailBucket, mailbox.id, id);
  if (found === undefined) return refusal(404, `The mailbox has no message ${JSON.stringify(id)}. Read its threads to find the message.`);
  const attachment = found.message.attachments[Number(given)];
  if (attachment === undefined) {
    const count = found.message.attachments.length;
    return refusal(404, count === 0 ? "The message has no attachments." : `The message has ${count} attachment${count === 1 ? "" : "s"}. Give attachment from 0 to ${count - 1}.`);
  }
  const { downloads } = deployment;
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + downloads.lifetime * 1000);
  const ticket: Ticket = { mailbox: mailbox.id, message: id, attachment: Number(given), expiresAt: expires.toISOString() };
  await documents(deployment.table).send(
    new PutCommand({ TableName: deployment.table.name, Item: { ...ticketKey(token), ...ticket, [timeToLiveAttribute]: Math.ceil(expires.getTime() / 1000) } }),
  );
  return { statusCode: 200, body: { ...attachment, url: `${downloads.url}${token}`, expiresAt: ticket.expiresAt } satisfies components["schemas"]["AttachmentLink"] };
};

/** What following a download link answers: the attachment, or a line of text saying why not. */
export interface DownloadAnswer {
  statusCode: number;
  headers: Record<string, string>;
  body: Uint8Array<ArrayBuffer>;
}

/**
 * Follows the download link at the path, whose last segment is its token: answers with the
 * attachment, taken from the raw message, while the link works and the mailbox still has it.
 */
export function createDownloads({ table, mailBucket }: { table: Table; mailBucket: MailBucket }) {
  return async (path: string): Promise<DownloadAnswer> => {
    const token = path.split("/").at(-1) ?? "";
    const { Item } = token === "" ? { Item: undefined } : await documents(table).send(new GetCommand({ TableName: table.name, Key: ticketKey(token), ConsistentRead: true }));
    const ticket = Item as Ticket | undefined;
    if (ticket === undefined || Date.parse(ticket.expiresAt) <= Date.now()) return text(404, "This download link has expired or never worked. Open the message in Duva and download the attachment again.");
    const part = (await findMessage(table, mailBucket, ticket.mailbox, ticket.message))?.parts[ticket.attachment];
    if (part === undefined) return text(404, "The mailbox no longer has this attachment.");
    return {
      statusCode: 200,
      headers: {
        "content-type": mediaTypeOf(part.type),
        "content-disposition": dispositionOf(part.name),
        // The content is the sender's, so a browser saves it and never runs it.
        "x-content-type-options": "nosniff",
        "content-security-policy": "sandbox; default-src 'none'",
        "cache-control": "private, no-store",
      },
      body: part.content,
    };
  };
}

const text = (statusCode: number, line: string): DownloadAnswer => ({
  statusCode,
  headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  body: new TextEncoder().encode(`${line}\n`),
});

/**
 * A Content-Disposition that saves the attachment under its name: in ASCII for old clients, and
 * in UTF-8 (RFC 6266) for the rest, so Swedish and Danish names survive.
 */
function dispositionOf(name: string | undefined): string {
  if (name === undefined || name.trim() === "") return "attachment";
  const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, "_");
  const utf8 = encodeURIComponent(name).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}
