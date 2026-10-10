// Downloading attachments. Asking for one gives a short-lived link, and following it takes the
// attachment from the raw message there and then, so nothing is stored twice. The link's ticket is
// the only thing kept, under the hash of its token, until the table's time to live removes it.
// Senders' logos are served under the same URL, at logos/ and their ID, and linked files' pages at
// files/ and their token (ADR-0034). Stopping sharing a linked file is here too.
import { createHash, randomBytes } from "node:crypto";
import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import type { components } from "@duva/openapi";
import { type OperationHandler, refusal } from "./api.ts";
import type { Table } from "./deployment.ts";
import { timeToLiveAttribute } from "./infrastructure.ts";
import type { MailBucket } from "./mail-bucket.ts";
import { type AttachmentLinks, findMessage, storedMessage } from "./mail.ts";
import { mediaTypeOf } from "./mime.ts";
import { logoAt, storedLogo } from "./sender-logos.ts";
import { mailboxFor } from "./access.ts";
import { recordChanges } from "./feed.ts";
import { linkedAt, linkedFilesOf, linkedPage, storedLink, linkKey } from "./linked-files.ts";
import { mailboxFeed } from "./organization.ts";
import { documents, pk, sk } from "./table.ts";
import { dispositionOf, type UploadsBucket } from "./uploads-bucket.ts";

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
  const link = await downloadLink(deployment, { mailbox: mailbox.id, message: id, attachment: Number(given) });
  return { statusCode: 200, body: { ...attachment, ...link } satisfies components["schemas"]["AttachmentLink"] };
};

/**
 * Links to the attachments of the mailbox's messages, for the images of its own parts a message's
 * HTML shows. Each is a new download link, so reading HTML that shows any writes their tickets.
 */
export const attachmentLinks =
  (deployment: { table: Table; downloads: Downloads }, mailbox: string): AttachmentLinks =>
  async (message, attachment) =>
    (await downloadLink(deployment, { mailbox, message, attachment })).url;

/** A new download link to the attachment, which works for the deployment's link lifetime. */
export async function downloadLink(
  { table, downloads }: { table: Table; downloads: Downloads },
  attachment: Omit<Ticket, "expiresAt">,
): Promise<{ url: string; expiresAt: string }> {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + downloads.lifetime * 1000);
  const ticket: Ticket = { ...attachment, expiresAt: expires.toISOString() };
  await documents(table).send(new PutCommand({ TableName: table.name, Item: { ...ticketKey(token), ...ticket, [timeToLiveAttribute]: Math.ceil(expires.getTime() / 1000) } }));
  return { url: `${downloads.url}${token}`, expiresAt: ticket.expiresAt };
}

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
export function createDownloads({ table, mailBucket, uploads }: { table: Table; mailBucket: MailBucket; uploads: UploadsBucket }) {
  return async (path: string): Promise<DownloadAnswer> => {
    const logo = logoAt(path);
    if (logo !== undefined) return logoAnswer(table, logo);
    const linked = linkedAt(path);
    if (linked !== undefined) return linkedPage(table, uploads, linked);
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

/**
 * The sender's logo with the ID, which anyone with its URL may see, as Duva wrote it out
 * (ADR-0023). It never changes, so a browser keeps it. Opened on its own, it still runs nothing.
 */
async function logoAnswer(table: Table, id: string): Promise<DownloadAnswer> {
  const svg = await storedLogo(table, id);
  if (svg === undefined) return text(404, "Duva has no such logo.");
  return {
    statusCode: 200,
    headers: {
      "content-type": "image/svg+xml",
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'",
      "cache-control": "public, max-age=31536000, immutable",
    },
    body: new TextEncoder().encode(svg),
  };
}

const text = (statusCode: number, line: string): DownloadAnswer => ({
  statusCode,
  headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  body: new TextEncoder().encode(`${line}\n`),
});
export const stopSharing: OperationHandler = async (event, deployment, actor) => {
  const mailbox = await mailboxFor(event, deployment, actor!, "send");
  if ("statusCode" in mailbox) return mailbox;
  const { message: id = "", file: fileId = "" } = event.pathParameters ?? {};
  const stored = await storedMessage(deployment.table, mailbox.id, id);
  if (stored === undefined) return refusal(404, `The mailbox has no message ${JSON.stringify(id)}. Read its sent threads to find the message.`);
  const entry = stored.linkedFiles?.find((each) => each.id === fileId);
  if (entry === undefined) {
    const count = stored.linkedFiles?.length ?? 0;
    return refusal(404, count === 0 ? "The message carried no linked files." : `The message has no linked file ${JSON.stringify(fileId)}. Read the message to see its linked files.`);
  }
  const ticket = { holder: entry.holder, mailbox: mailbox.id, draft: entry.draft, file: entry.file };
  const shared = await storedLink(deployment.table, ticket);
  if (shared !== undefined && shared.stoppedAt === undefined) {
    try {
      await recordChanges(deployment.table, mailboxFeed(mailbox.id), {
        by: actor!.id,
        changes: [{ type: "sharingStopped", message: id, file: fileId }],
        items: [
          {
            Update: {
              TableName: deployment.table.name,
              Key: linkKey(ticket),
              UpdateExpression: "SET stoppedAt = :now",
              ConditionExpression: `attribute_exists(${pk}) AND attribute_not_exists(stoppedAt)`,
              ExpressionAttributeValues: { ":now": new Date().toISOString() },
            },
          },
        ],
      });
    } catch (error) {
      // Stopped at the same time by another call, or erased.
      if (!(error instanceof TransactionCanceledException)) throw error;
    }
  }
  // Deleted after it stopped, so a call that stopped before deleting it finishes here.
  if (shared !== undefined) await deployment.uploads.remove(shared.key);
  const [file] = await linkedFilesOf(deployment.table, mailbox.id, [entry]);
  return { statusCode: 200, body: file! satisfies components["schemas"]["LinkedFile"] };
};

