// The public Enron email corpus, as CMU publishes it: one tarball of maildirs,
// about 520,000 files. It reads the tarball as a stream, so nothing is
// unpacked, and it is never committed (.data/ is ignored).
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync } from "node:fs";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";

const corpusUrl = "https://www.cs.cmu.edu/~enron/enron_mail_20150507.tar.gz";

// A message as the corpus has it, before the harness gives it labels.
export interface CorpusMessage {
  id: string;
  sender: string;
  recipients: string[];
  subject: string;
  date: Date;
  hasAttachment: boolean;
  text: string;
}

export async function download(file: string): Promise<void> {
  if (existsSync(file)) return;
  mkdirSync(dirname(file), { recursive: true });
  const response = await fetch(corpusUrl);
  if (!response.ok || !response.body) throw new Error(`Downloading ${corpusUrl} failed: ${response.status}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(`${file}.part`));
  renameSync(`${file}.part`, file);
}

// The corpus has many copies of one message, in its sender's sent folders and
// each recipient's folders. One is kept, by sender, date, subject and body.
export async function* messages(file: string): AsyncGenerator<CorpusMessage> {
  const seen = new Set<string>();
  for await (const entry of tarFiles(createReadStream(file).pipe(createGunzip()))) {
    const message = parse(entry);
    if (!message) continue;
    if (seen.has(message.id)) continue;
    seen.add(message.id);
    yield message;
  }
}

// The files in a tar stream: 512-byte headers, each followed by the file's
// bytes padded to a whole block.
async function* tarFiles(stream: AsyncIterable<Buffer>): AsyncGenerator<Buffer> {
  let buffer: Buffer = Buffer.alloc(0);
  let wanted: { size: number; isFile: boolean } | undefined;
  for await (const chunk of stream) {
    buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk;
    for (;;) {
      if (!wanted) {
        if (buffer.length < 512) break;
        const header = buffer.subarray(0, 512);
        buffer = buffer.subarray(512);
        if (header.every((b) => b === 0)) continue;
        const size = parseInt(header.subarray(124, 136).toString("ascii").replace(/\0.*$/, "").trim() || "0", 8);
        const type = String.fromCharCode(header[156]!);
        wanted = { size, isFile: type === "0" || type === "\0" };
      }
      const padded = Math.ceil(wanted.size / 512) * 512;
      if (buffer.length < padded) break;
      if (wanted.isFile) yield Buffer.from(buffer.subarray(0, wanted.size));
      buffer = buffer.subarray(padded);
      wanted = undefined;
    }
  }
}

// Attachments were stripped from the corpus, but forwarded and replied mail
// still names them, like "<<Q3 forecast.xls>>" or " - contract.doc".
const attachmentMention = /<<[^<>\n]{1,200}\.(?:doc|docx|xls|xlsx|ppt|pdf|txt|zip|jpg|gif|tif|wpd|rtf)\s*>>|^\s*-\s+\S[^\n]{0,100}\.(?:doc|docx|xls|xlsx|ppt|pdf|zip|wpd|rtf)\s*$/im;

// Messages longer than this are cut. A few in the corpus run to megabytes.
const maxTextLength = 50_000;

function parse(file: Buffer): CorpusMessage | undefined {
  const raw = file.toString("latin1");
  const split = raw.search(/\r?\n\r?\n/);
  if (split < 0) return undefined;
  const headers = new Map<string, string>();
  for (const line of raw.slice(0, split).replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon > 0) headers.set(line.slice(0, colon).toLowerCase(), line.slice(colon + 1).trim());
  }
  const sender = headers.get("from")?.toLowerCase();
  const date = new Date((headers.get("date") ?? "").replace(/\s*\(.*\)\s*$/, ""));
  // Some messages carry dates decades off, from senders' broken clocks.
  if (!sender || Number.isNaN(date.getTime()) || date.getUTCFullYear() < 1997 || date.getUTCFullYear() > 2002) return undefined;
  const subject = headers.get("subject") ?? "";
  const text = raw.slice(split).trim().slice(0, maxTextLength);
  const recipients = ["to", "cc"]
    .flatMap((h) => (headers.get(h) ?? "").split(","))
    .map((r) => r.trim().toLowerCase())
    .filter(Boolean);
  const id = createHash("sha256").update(`${sender}\n${date.toISOString()}\n${subject}\n${text}`).digest("hex").slice(0, 20);
  return { id: `enron-${id}`, sender, recipients, subject, date, hasAttachment: attachmentMention.test(text), text };
}
