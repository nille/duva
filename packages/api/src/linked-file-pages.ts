// A linked file's page and its Download (ADR-0034), which the download Lambda answers. Its first
// download is news in the mailbox's change feed, so the page reads the message the file was sent
// in, and sits above both the mail and the links it reads (#160).
import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { Table } from "./deployment.ts";
import { recordChanges } from "./feed.ts";
import { dayRead, linkKey, linkWithToken, sizeRead, type StoredLink } from "./linked-files.ts";
import { storedMessage } from "./mail.ts";
import { mailboxFeed } from "./organization.ts";
import { escapeHtml } from "./signatures.ts";
import { documents, pk } from "./table.ts";
import type { UploadsBucket } from "./uploads-bucket.ts";

/** How long a URL for a linked file in S3 works, once Download handed it out. */
const fileUrlLifetime = 5 * 60 * 1000;

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
  const shared = await linkWithToken(table, token);
  if (shared === undefined) return page(404, "No such file", "This link never worked, or the mail it came in was erased. Ask the sender to send the file again.");
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

