// Signatures (#157): the plain text a mailbox's owner sets to close the mail sent from it, one for
// the mailbox and optionally one for any of its addresses, which wins for mail from that address.
// Each sits in the mailbox's partition, so it goes with the mailbox, and setting one is a change in
// its feed. A draft takes its From's signature when it is written, and keeps it on its own, so the
// writer can change or drop it for that one message, and changing From swaps it while the writer
// left it as it was. The sender puts it after a line of "-- ", below the text and above a forward's
// quoted original, and the disclosure's line follows it. In an HTML part it is text whose links are
// links, never an image. Away messages are sent without drafts, so they carry none.
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { components } from "@duva/openapi";
import { jsonBody, type OperationHandler, refusal } from "./operation-handler.ts";
import { mailboxFor } from "./access.ts";
import type { Table } from "./deployment.ts";
import { recordChanges } from "./feed.ts";
import { aliasDomains, type Mailbox, mailboxFeed, mailboxKey, mirroredAddress } from "./organization.ts";
import { documents, pk, sk } from "./table.ts";

type Signature = components["schemas"]["Signature"];

export const maxSignature = 1000;
export const maxSignatureRead = maxSignature.toLocaleString("en");

/** The heading a forward's quoted original starts with, which a signature goes above. */
export const forwardedHeading = "Forwarded message";

// The mailbox's signature, and each address's own, by the address in lower case.
const signatureKey = (mailbox: string, address?: string) => ({ [pk]: mailboxKey(mailbox)[pk]!, [sk]: address === undefined ? "signature" : `signature#${address}` });

/** The mailbox's signature and its addresses' own, as stored. */
async function storedSignatures(table: Table, mailbox: string): Promise<{ text?: string; addresses: Map<string, string> }> {
  const { Items = [] } = await documents(table).send(
    new QueryCommand({
      TableName: table.name,
      KeyConditionExpression: `${pk} = :mailbox AND begins_with(${sk}, :signature)`,
      ExpressionAttributeValues: { ":mailbox": signatureKey(mailbox)[pk], ":signature": signatureKey(mailbox)[sk] },
      ConsistentRead: true,
    }),
  );
  const own = Items.find((item) => item.address === undefined);
  return { text: own?.text as string | undefined, addresses: new Map(Items.filter((item) => item.address !== undefined).map((item) => [item.address as string, item.text as string])) };
}

/**
 * The signature mail from each address carries in the mailbox: the address's own, an alias domain's
 * mirror and a plus tag of it included, or else the mailbox's, as a group's mail does. Undefined for none.
 */
export async function signaturesIn(table: Table, mailbox: Mailbox): Promise<(from: string) => string | undefined> {
  const { text, addresses } = await storedSignatures(table, mailbox.id);
  const aliases = addresses.size === 0 ? new Map<string, string>() : await aliasDomains(table);
  return (from) => addresses.get(mirroredAddress(from, aliases)) ?? text;
}

const signatureOf = async (table: Table, mailbox: Mailbox): Promise<Signature> => {
  const { text, addresses } = await storedSignatures(table, mailbox.id);
  return {
    ...(text !== undefined && { text }),
    addresses: mailbox.addresses.map((address) => ({ address, ...(addresses.has(address) && { text: addresses.get(address)! }) })),
  };
};

export const getSignature: OperationHandler = async (event, deployment, actor) => {
  const mailbox = await mailboxFor(event, deployment, actor!, "read");
  if ("statusCode" in mailbox) return mailbox;
  return { statusCode: 200, body: (await signatureOf(deployment.table, mailbox)) satisfies Signature };
};

export const changeSignature: OperationHandler = async (event, deployment, actor) => {
  const mailbox = await mailboxFor(event, deployment, actor!, "organize");
  if ("statusCode" in mailbox) return mailbox;
  const { table } = deployment;
  const body = jsonBody(event) ?? {};
  const unknown = Object.keys(body).find((name) => name !== "address" && name !== "text");
  if (unknown !== undefined) return refusal(400, `A signature has no ${JSON.stringify(unknown)}. Give text, with address for one of the mailbox's addresses.`);
  const given = signatureGiven(body.text);
  if (given === false) return refusal(400, `Give text as up to ${maxSignatureRead} characters of plain text, or null to remove it.`);
  let address: string | undefined;
  if (body.address !== undefined) {
    address = typeof body.address === "string" ? body.address.trim().toLowerCase() : "";
    if (!mailbox.addresses.includes(address)) return refusal(400, `${JSON.stringify(body.address)} isn't one of the mailbox's addresses. Give one of ${mailbox.addresses.join(", ")}, or leave address out for the mailbox's signature.`);
  }
  const key = signatureKey(mailbox.id, address);
  await recordChanges(table, mailboxFeed(mailbox.id), {
    by: actor!.id,
    changes: [{ type: "signatureChanged", ...(address !== undefined && { address }) }],
    items: [given === null ? { Delete: { TableName: table.name, Key: key } } : { Put: { TableName: table.name, Item: { ...key, ...(address !== undefined && { address }), text: given } } }],
  });
  return { statusCode: 200, body: (await signatureOf(table, mailbox)) satisfies Signature };
};

/**
 * The signature given, its line ends made \n and the space around it gone, null to have none, or
 * false if it isn't one: not text, or longer than a signature can be.
 */
export function signatureGiven(given: unknown): string | null | false {
  if (given === null) return null;
  if (typeof given !== "string") return false;
  const text = given.replace(/\r\n?/g, "\n").replace(/^\s*\n|\s+$/g, "");
  if (text.length > maxSignature) return false;
  return text === "" ? null : text;
}

/**
 * The text with the signature after a line of "-- ", below what was written and above the quoted
 * original a forward's text ends with.
 */
export function signed(text: string, signature: string | undefined, forwards: boolean): string {
  if (signature === undefined) return text;
  const at = forwards ? text.lastIndexOf(`\n\n${forwardedHeading}\n`) : -1;
  const written = (at === -1 ? text : text.slice(0, at)).trimEnd();
  return `${written}${written === "" ? "" : "\n\n"}-- \n${signature}${at === -1 ? "" : text.slice(at)}`;
}

export const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// A web address in a signature, up to the space after it, without the punctuation that ends a sentence.
const webAddress = /(https?:\/\/[^\s<>"]*[^\s<>".,;:!?)\]'])/;

/** The text as an HTML element that keeps its lines, with the web addresses of the signature it carries as links. */
export function textHtml(text: string, signature: string | undefined): string {
  const block = signature === undefined ? -1 : text.lastIndexOf(`-- \n${signature}`);
  if (block === -1) return `<div style="white-space:pre-wrap">${escapeHtml(text)}</div>`;
  const start = block + 4;
  const end = start + signature!.length;
  const linked = signature!
    .split(webAddress)
    .map((part, index) => (index % 2 === 1 ? `<a href="${escapeHtml(part)}">${escapeHtml(part)}</a>` : escapeHtml(part)))
    .join("");
  return `<div style="white-space:pre-wrap">${escapeHtml(text.slice(0, start))}${linked}${escapeHtml(text.slice(end))}</div>`;
}

/** The message's body: its text, and an HTML part as well when the signature it carries has a link, so the link is one. */
export function signedBody(text: string, signature: string | undefined): { text: string; html?: string } {
  if (signature === undefined || !webAddress.test(signature)) return { text };
  return { text, html: `<!doctype html>\n<html><body>\n${textHtml(text, signature)}\n</body></html>` };
}
