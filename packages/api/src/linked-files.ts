// Linked files (ADR-0034): attachments sent as links to a download page instead of inside the
// message. When carrying every attachment would make a message more than 10 MB, encoded, the
// largest go as links until it fits, and the sender may link any by choice. Each stays in the
// uploads bucket, where it was uploaded, until its link ends, 30 days after the send unless the
// draft chose 7 or 365, or its sender stops sharing it, and then it is deleted. A link is a ticket
// of Duva's own, found by the hash of its long random token, as download links are, so the table
// never holds a working link and a stopped one stops at once. The page it opens shows the file and
// a Download button, never the file itself, since link scanners open every link in mail. Download
// checks the ticket each time, counts the download, and hands out a URL for the file in S3 that
// works for minutes, so no Lambda carries the file. What each human shares at once, their agents'
// files included, is capped by the organization's setting.
import { createHash, randomBytes } from "node:crypto";
import { DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import type { components } from "@duva/openapi";
import type { Table } from "./deployment.ts";
import { recordChanges } from "./feed.ts";
import { timeToLiveAttribute } from "./infrastructure.ts";
import { storedMessage } from "./mail.ts";
import { type Actor, mailboxFeed, organizationSettings } from "./organization.ts";
import { documents, pk, sk } from "./table.ts";
import type { UploadsBucket } from "./uploads-bucket.ts";

type LinkedFile = components["schemas"]["LinkedFile"];
type DraftAttachment = components["schemas"]["DraftAttachment"];

/** How large a message may be, encoded, with the files it carries: 10 MB, which most receivers take (ADR-0034). */
export const maxCarried = 10_000_000;
/** How many days a link works after the send, unless the draft says otherwise. */
export const defaultLinkDays = 30;
export const linkDays = [7, 30, 365] as const;
/** How long a URL for a linked file in S3 works, once Download handed it out. */
const fileUrlLifetime = 5 * 60 * 1000;
/** How long a ticket outlives its link, so its page says the link expired rather than never worked. */
const ticketKept = 90 * 24 * 60 * 60;

/**
 * How many bytes a file takes in a message, encoded: base64 makes each 3 bytes 4, with a line
 * break every 76, and its part's header fields take up to about 500 bytes more.
 */
export const encodedSize = (size: number) => Math.ceil(size / 3) * 4 * (78 / 76) + 500;

/**
 * Which of the draft's files go as linked files, by ID: those chosen, and then the largest of
 * the rest, one by one, while carrying them would make the message more than 10 MB, encoded. The
 * text is counted four times its bytes, as base64 in a text and an HTML part. The linked files of
 * a forwarded message always go as their links, so they aren't among these.
 */
export function linksOf(files: { id: string; size: number; source: string; linked?: string }[], text: string): Map<string, "chosen" | "needed"> {
  const links = new Map<string, "chosen" | "needed">();
  const carried = [];
  for (const file of files) {
    if (file.source === "linked") continue;
    if (file.linked === "chosen") links.set(file.id, "chosen");
    else carried.push(file);
  }
  let size = carried.reduce((total, file) => total + encodedSize(file.size), Buffer.byteLength(text) * 4);
  for (const file of [...carried].sort((a, b) => b.size - a.size)) {
    if (size <= maxCarried) break;
    links.set(file.id, "needed");
    size -= encodedSize(file.size);
  }
  return links;
}

/** Who shares a linked file, whose cap it counts toward: the human who sent it, or the sponsor of the agent who did. */
export const holderOf = (actor: Actor) => (actor.kind === "agent" ? actor.sponsor : actor.id);

/** A linked file as a sent message lists it: which file of which draft's send, shared by whom. */
export interface LinkedEntry {
  id: string;
  holder: string;
  draft: string;
  file: string;
  name: string;
  type: string;
  size: number;
  until: string;
  /** Set when the message carries the link of a message it forwards, whose file it is. */
  carried?: true;
}

/** A linked file as Duva keeps it, in its holder's partition, with how often it was downloaded. */
interface StoredLink {
  holder: string;
  mailbox: string;
  draft: string;
  file: string;
  /** The SHA-256 of its link's token. */
  ticket: string;
  /** Where it is in the uploads bucket. */
  key: string;
  name: string;
  type: string;
  size: number;
  /** The address it was sent from. */
  from: string;
  /** The ID of the message it was sent with. */
  message: string;
  until: string;
  downloads: number;
  /** When its sender stopped sharing it, if they did. */
  stoppedAt?: string;
}

/** What a ticket points at: the shared file. */
type Ticket = Pick<StoredLink, "holder" | "mailbox" | "draft" | "file">;

export const linkKey = ({ holder, mailbox, draft, file }: Ticket) => ({ [pk]: `linked#${holder}`, [sk]: `${mailbox}#${draft}#${file}` });
const hashOf = (token: string) => createHash("sha256").update(token).digest("base64url");
const ticketKey = (hash: string) => ({ [pk]: `link#${hash}`, [sk]: "link" });
/** The path of a linked file's page under the download URL. */
const pagePath = "files/";

export async function storedLink(table: Table, ticket: Ticket): Promise<StoredLink | undefined> {
  const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: linkKey(ticket), ConsistentRead: true }));
  return Item as StoredLink | undefined;
}

/** Whether the shared file's link works at the time. */
const isLive = (shared: StoredLink | undefined, now = Date.now()): shared is StoredLink => shared !== undefined && shared.stoppedAt === undefined && Date.parse(shared.until) > now;

/**
 * Shares the files sent from the mailbox with the message, each under a new link until `until`,
 * and gives each file's page URL, by its ID. A file shared before for the same draft, as by a
 * send that stopped before SES took it, gets the new link in place of its old one.
 */
export async function linkFiles(
  table: Table,
  { holder, mailbox, draft, message, from, until, downloadUrl, files }: { holder: string; mailbox: string; draft: string; message: string; from: string; until: string; downloadUrl: string; files: { id: string; key: string; name: string; type: string; size: number }[] },
): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  const db = documents(table);
  for (const { id, key, name, type, size } of files) {
    const token = randomBytes(32).toString("base64url");
    const ticket: Ticket = { holder, mailbox, draft, file: id };
    const shared: StoredLink = { ...ticket, ticket: hashOf(token), key, name, type, size, from, message, until, downloads: 0 };
    await db.send(new PutCommand({ TableName: table.name, Item: { ...ticketKey(shared.ticket), ...ticket, [timeToLiveAttribute]: Math.ceil(Date.parse(until) / 1000) + ticketKept } }));
    // Kept as long as its ticket, so the message says how often it was downloaded until then.
    await db.send(new PutCommand({ TableName: table.name, Item: { ...linkKey(ticket), ...shared, [timeToLiveAttribute]: Math.ceil(Date.parse(until) / 1000) + ticketKept } }));
    urls.set(id, `${downloadUrl}${pagePath}${token}`);
  }
  return urls;
}

/**
 * Ends the links of the draft's files and forgets them, for a send that never went out, or mail
 * erased. Their files are left to the caller.
 */
export async function unlinkFiles(table: Table, { holder, mailbox, draft, files }: { holder: string; mailbox: string; draft: string; files: string[] }): Promise<void> {
  const db = documents(table);
  for (const file of files) {
    const shared = await storedLink(table, { holder, mailbox, draft, file });
    if (shared === undefined) continue;
    await db.send(new DeleteCommand({ TableName: table.name, Key: ticketKey(shared.ticket) }));
    await db.send(new DeleteCommand({ TableName: table.name, Key: linkKey(shared) }));
  }
}

/**
 * How many bytes of linked files the human has linked now, their agents' included, but for those
 * of the draft `besides`, whose send is under way again after one that stopped.
 */
export async function linkedSize(table: Table, holder: string, besides?: { mailbox: string; draft: string }): Promise<number> {
  let total = 0;
  let start: Record<string, unknown> | undefined;
  const now = Date.now();
  do {
    const page = await documents(table).send(
      new QueryCommand({ TableName: table.name, KeyConditionExpression: `${pk} = :holder`, ExpressionAttributeValues: { ":holder": `linked#${holder}` }, ExclusiveStartKey: start }),
    );
    for (const item of (page.Items ?? []) as StoredLink[]) if (isLive(item, now) && !(item.mailbox === besides?.mailbox && item.draft === besides.draft)) total += item.size;
    start = page.LastEvaluatedKey;
  } while (start !== undefined);
  return total;
}

const gigabyte = 1024 ** 3;

/**
 * Why sharing `adding` more bytes of linked files would take the holder past the organization's
 * cap, said to the actor who sends, or undefined if it wouldn't.
 */
export async function overCap(table: Table, actor: Actor, adding: number, sending?: { mailbox: string; draft: string }): Promise<string | undefined> {
  if (adding === 0) return undefined;
  const { settings } = await organizationSettings(table);
  const cap = settings.linkedFilesCapGb * gigabyte;
  if ((await linkedSize(table, holderOf(actor), sending)) + adding <= cap) return undefined;
  const whose = actor.kind === "agent" ? "its sponsor" : "you";
  return `Its linked files would take ${whose} past the ${settings.linkedFilesCapGb} GB of linked files the organization lets each human have linked at once. Stop sharing older files in the sent mail, or ask an admin to raise the cap.`;
}

/** The size of the files the draft would newly share as links. */
export const newlyLinked = (files: (DraftAttachment & { linked?: string })[]) => files.reduce((total, file) => total + (file.linked === undefined ? 0 : file.size), 0);

/** The linked files the message lists, each with how it stands now and how often it was downloaded. */
export async function linkedFilesOf(table: Table, mailbox: string, entries: LinkedEntry[]): Promise<LinkedFile[]> {
  const now = Date.now();
  return Promise.all(
    entries.map(async ({ id, holder, draft, file, name, type, size, until }) => {
      const shared = await storedLink(table, { holder, mailbox, draft, file });
      // One forgotten after its link ended expired, unless erasure ended it.
      const state = Date.parse(until) <= now && shared?.stoppedAt === undefined ? "expired" : shared === undefined || shared.stoppedAt !== undefined ? "stopped" : "sharing";
      return { id, name, type, size, until, state, downloads: shared?.downloads ?? 0 } satisfies LinkedFile;
    }),
  );
}

/**
 * The linked files of the forwarded message that a forward carries, as the same links: those
 * still shared, each as a draft's file of its own.
 */
export async function carriedFiles(table: Table, mailbox: string, entries: LinkedEntry[] | undefined) {
  const carried = [];
  for (const [index, entry] of (entries ?? []).entries()) {
    if (!isLive(await storedLink(table, { holder: entry.holder, mailbox, draft: entry.draft, file: entry.file }))) continue;
    const { holder, draft, file, name, type, size, until } = entry;
    carried.push({ id: `linked-${index}`, name, type, size, source: "linked" as const, until, carries: { holder, draft, file } });
  }
  return carried;
}

/**
 * The page URLs of the forwarded message's linked files that the forward carries, by the file
 * they carry, as its raw text gives them, matched by their tokens' hashes, since Duva keeps no
 * token. A file no longer shared has none.
 */
export async function carriedUrls(table: Table, mailbox: string, text: string, downloadUrl: string, carries: Pick<Ticket, "holder" | "draft" | "file">[]): Promise<Map<string, string>> {
  const byHash = new Map<string, string>();
  for (const [url] of text.matchAll(new RegExp(`${escaped(`${downloadUrl}${pagePath}`)}[\\w-]+`, "g"))) byHash.set(hashOf(url.slice(url.lastIndexOf("/") + 1)), url);
  const urls = new Map<string, string>();
  for (const carried of carries) {
    const shared = await storedLink(table, { ...carried, mailbox });
    const url = isLive(shared) ? byHash.get(shared.ticket) : undefined;
    if (url !== undefined) urls.set(carriedKey(carried), url);
  }
  return urls;
}

/** A linked file's key among those a forward carries: whose, which draft's, which file. */
export const carriedKey = ({ holder, draft, file }: { holder: string; draft: string; file: string }) => `${holder}#${draft}#${file}`;

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A size as people read it: 11 bytes, 12 KB, 1.4 MB, 2.1 GB. */
export function sizeRead(bytes: number): string {
  if (bytes < 1024) return bytes === 1 ? "1 byte" : `${bytes} bytes`;
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < gigabyte) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / gigabyte).toFixed(1)} GB`;
}

/** The day as the list of linked files says it, as 8 November 2026, in UTC. */
export const dayRead = (at: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(at));

/** Each group of linked files with the same end as the list heads it, like 2 files, until 8 November 2026. */
const groupsOf = <Link extends { until: string }>(links: Link[]) => {
  const days = [...new Set(links.map(({ until }) => dayRead(until)))];
  return days.map((day) => {
    const files = links.filter(({ until }) => dayRead(until) === day);
    return { heading: `${files.length} file${files.length === 1 ? "" : "s"}, until ${day}`, files };
  });
};

/**
 * The message's text and HTML with its linked files listed after the text, a plain list with no
 * banner or logo: a line saying how many until when, then each file's name and size, with the link
 * to its page.
 */
export function withLinkedFiles(text: string, links: { name: string; size: number; until: string; url: string }[]): { text: string; html: string } {
  const groups = groupsOf(links);
  const listed = groups.map(({ heading, files }) => [heading, ...files.map(({ name, size, url }) => `${name}, ${sizeRead(size)}: ${url}`)].join("\n"));
  const html = [
    `<div style="white-space:pre-wrap">${escapeHtml(text)}</div>`,
    ...groups.map(({ heading, files }) => `<p>${escapeHtml(heading)}</p>\n<ul>\n${files.map(({ name, size, url }) => `<li><a href="${escapeHtml(url)}">${escapeHtml(name)}</a>, ${escapeHtml(sizeRead(size))}</li>`).join("\n")}\n</ul>`),
  ].join("\n");
  return { text: [text, ...listed].join("\n\n"), html: `<!doctype html>\n<html><body>\n${html}\n</body></html>` };
}

/** The message's text without the list of its linked files after it, as Duva shows mail it sent. */
export function withoutLinkedFiles(text: string, entries: LinkedEntry[]): string {
  const first = groupsOf(entries)[0];
  if (first === undefined) return text;
  const at = text.lastIndexOf(`\n\n${first.heading}\n`);
  return at === -1 ? text : text.slice(0, at);
}

/** Deletes the file whose link ended, when its schedule hands it to the sender. */
export async function expireFile(table: Table, uploads: UploadsBucket, ticket: Ticket): Promise<void> {
  const shared = await storedLink(table, ticket);
  if (shared !== undefined && Date.parse(shared.until) <= Date.now()) await uploads.remove(shared.key);
}

/** The event that has the sender delete a linked file once its link ended. */
export interface ExpireEvent {
  expire: Ticket;
}

/** What following a linked file's link answers, as the download Lambda gives it. */
export interface PageAnswer {
  statusCode: number;
  headers: Record<string, string>;
  body: Uint8Array<ArrayBuffer>;
}

/** The token and whether Download was asked for, if the path under the download URL is a linked file's page or its Download, or else undefined. */
export function linkedAt(path: string): { token: string; download: boolean } | undefined {
  const [, token, download] = /\/files\/([\w-]+)(\/file)?$/.exec(path) ?? [];
  return token === undefined ? undefined : { token, download: download !== undefined };
}

/**
 * Answers a linked file's page, or its Download. The page is small, so a link scanner that opens
 * it costs nothing. Download checks the ticket again, counts the download, recording the first in
 * the mailbox's change feed as news for Coo, and sends the browser on to the file in S3, at a URL
 * that works for minutes. An expired or stopped link says so.
 */
export async function linkedPage(table: Table, uploads: UploadsBucket, { token, download }: { token: string; download: boolean }): Promise<PageAnswer> {
  const db = documents(table);
  const { Item } = await db.send(new GetCommand({ TableName: table.name, Key: ticketKey(hashOf(token)), ConsistentRead: true }));
  const shared = Item === undefined ? undefined : await storedLink(table, Item as Ticket);
  if (shared === undefined || shared.ticket !== hashOf(token)) return page(404, "No such file", "This link never worked, or the mail it came in was erased. Ask the sender to send the file again.");
  if (shared.stoppedAt !== undefined) return page(410, "No longer shared", `${shared.from} stopped sharing ${shared.name}, so it was deleted. Ask them to send it again.`);
  if (Date.parse(shared.until) <= Date.now()) return page(410, "Link expired", `The link to ${shared.name} expired on ${dayRead(shared.until)}, so the file was deleted. Ask ${shared.from} to send it again.`);
  if (!download) return filePage(shared, token);
  await counted(table, shared);
  const url = await uploads.downloadUrl(shared.key, { name: shared.name, type: shared.type }, new Date(Date.now() + fileUrlLifetime));
  // A body, since the download Lambda's stream sends the status only with its first write.
  return { statusCode: 302, headers: { location: url, "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" }, body: new TextEncoder().encode("Your download starts.\n") };
}

/** Counts a download of the shared file, the first in one transaction with its change in the mailbox's feed. */
async function counted(table: Table, shared: StoredLink): Promise<void> {
  const update = (condition: string) => ({
    TableName: table.name,
    Key: linkKey(shared),
    UpdateExpression: "ADD downloads :one",
    ConditionExpression: `attribute_exists(${pk}) AND ${condition}`,
    ExpressionAttributeValues: { ":one": 1, ...(condition.includes(":none") && { ":none": 0 }) },
  });
  if (shared.downloads === 0) {
    const sent = await storedMessage(table, shared.mailbox, shared.message);
    const entry = sent?.linkedFiles?.find((each) => each.draft === shared.draft && each.file === shared.file);
    if (sent !== undefined && entry !== undefined) {
      try {
        await recordChanges(table, mailboxFeed(shared.mailbox), {
          by: undefined,
          changes: [{ type: "linkedFileDownloaded", thread: sent.thread, message: shared.message, file: entry.id, name: shared.name }],
          items: [{ Update: update("downloads = :none") }],
        });
        return;
      } catch (error) {
        // Another download was the first.
        if (!(error instanceof TransactionCanceledException)) throw error;
      }
    }
  }
  await documents(table).send(new UpdateCommand(update("attribute_exists(downloads)")));
}

const style = `body{margin:0;padding:0 1rem;background:#efefec;color:#161616;font:13.5px/1.6 ui-monospace,"SF Mono",Menlo,Consolas,monospace}
main{max-width:30rem;margin:12vh auto;padding:2rem;box-sizing:border-box;background:#fff;border-radius:10px;box-shadow:0 1px 0 rgb(22 22 22/.03),0 12px 32px -18px rgb(22 22 22/.22)}
h1{margin:0 0 .25rem;font:700 1.625rem/1.05 system-ui,sans-serif;letter-spacing:-.03em;overflow-wrap:anywhere}
p{margin:0 0 1rem;color:#56564f}
button{font:inherit;font-size:.78125rem;font-weight:600;color:#161616;background:#ff5a1f;border:0;border-radius:999px;height:2.25rem;padding:0 1rem;cursor:pointer}
button:active{translate:0 1px}
button:hover{background:#e5470d}
button:focus-visible{outline:2px solid #161616;outline-offset:2px}`;

/** A small page, which keeps nothing from the browser and lets nothing run. */
function page(statusCode: number, title: string, body: string): PageAnswer {
  return html(statusCode, title, `<h1>${escapeHtml(title)}</h1>\n<p>${escapeHtml(body)}</p>`);
}

/** The shared file's page, with its name, size, sender and end, and a Download button, a form, which link scanners don't submit. */
function filePage(shared: StoredLink, token: string): PageAnswer {
  return html(
    200,
    shared.name,
    [
      `<p>${escapeHtml(shared.from)} sent you a file.</p>`,
      `<h1>${escapeHtml(shared.name)}</h1>`,
      `<p>${escapeHtml(sizeRead(shared.size))}, until ${escapeHtml(dayRead(shared.until))}</p>`,
      `<form method="get" action="${escapeHtml(token)}/file"><button type="submit">Download</button></form>`,
    ].join("\n"),
  );
}

function html(statusCode: number, title: string, main: string): PageAnswer {
  const document = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(title)}</title>
<style>${style}</style>
</head>
<body>
<main>
${main}
</main>
</body>
</html>
`;
  return {
    statusCode,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      // The form's action leads to this page's own URL, which sends the browser on to S3.
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
      "referrer-policy": "no-referrer",
    },
    body: new TextEncoder().encode(document),
  };
}

const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
