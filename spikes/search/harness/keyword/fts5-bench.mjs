// FTS5 index size and query latency for 100k Enron messages, node:sqlite.
// node fts5-bench.mjs <real|padded> <out.db>
import { DatabaseSync } from "node:sqlite";
import { readFileSync, statSync, rmSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import snowball from "snowball-stemmers";

const mode = process.argv[2] ?? "real";
const file = process.argv[3] ?? `${process.env.KEYWORD_DATA}/fts-${mode}.db`;
rmSync(file, { force: true });
const rows = readFileSync(process.env.KEYWORD_DATA + "/mail100k.jsonl", "utf8").trim().split("\n").map((l) => JSON.parse(l));
if (mode === "padded") for (let i = 0; i < rows.length; i++) rows[i].text = (rows[i].text + "\n" + rows[(i + 1) % rows.length].text).slice(0, 2000);
const avg = rows.reduce((s, r) => s + r.text.length, 0) / rows.length;
const en = snowball.newStemmer("english");
const stemText = (t) => t.toLowerCase().split(/([\p{L}\p{N}]+)/u).map((w, i) => (i % 2 ? en.stem(w) : " ")).join("");

const db = new DatabaseSync(file);
db.exec(`
PRAGMA page_size=4096; PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA secure_delete=ON;
CREATE TABLE messages(rowid INTEGER PRIMARY KEY, id TEXT UNIQUE, thread TEXT, received INTEGER, sender TEXT, unread INT, has_attachment INT, text TEXT);
CREATE TABLE labels(label TEXT, message INTEGER, PRIMARY KEY(label, message)) WITHOUT ROWID;
CREATE INDEX messages_received ON messages(received);
CREATE VIRTUAL TABLE fts USING fts5(subject, people, body, stemmed, tokenize="unicode61 remove_diacritics 0", content='', contentless_delete=1);
INSERT INTO fts(fts, rank) VALUES('secure-delete', 1);
`);
const shares = [["inbox", 0.109], ["archive", 0.81], ["spam", 0.03], ["trash", 0.051]];
let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const t0 = performance.now();
const insM = db.prepare("INSERT INTO messages VALUES (?,?,?,?,?,?,?,?)");
const insL = db.prepare("INSERT INTO labels VALUES (?,?)");
const insF = db.prepare("INSERT INTO fts(rowid, subject, people, body, stemmed) VALUES (?,?,?,?,?)");
db.exec("BEGIN");
rows.forEach((r, i) => {
  const rowid = i + 1;
  insM.run(rowid, r.id, `t${i % 88000}`, Date.parse(r.date ?? "2001-01-01"), r.from ?? "", rnd() < 0.2 ? 1 : 0, rnd() < 0.1 ? 1 : 0, mode === "lean" ? null : r.text);
  let x = rnd(), acc = 0;
  for (const [l, s] of shares) { acc += s; if (x < acc) { insL.run(l, rowid); break; } }
  if (rnd() < 0.05) insL.run("label" + Math.floor(rnd() * 5), rowid);
  insF.run(rowid, r.subject, [r.from, ...r.to].join(" "), mode === "lean" ? "" : r.text, stemText(r.subject + " " + r.text));
});
db.exec("COMMIT");
const tBuild = Math.round(performance.now() - t0);
db.exec("INSERT INTO fts(fts) VALUES('optimize')");
db.exec("VACUUM");
const size = (q) => db.prepare(q).get().s;
const ftsBytes = size("SELECT sum(pgsize) s FROM dbstat WHERE name LIKE 'fts%'");
const textBytes = size("SELECT sum(pgsize) s FROM dbstat WHERE name = 'messages'");
db.close();
const bytes = statSync(file).size;
const zstd = Number(execSync(`zstd -3 -c ${file} | wc -c`).toString());
const gz = Number(execSync(`gzip -6 -c ${file} | wc -c`).toString());

// Queries: words, pairs, phrases, filtered to leave out spam/trash, BM25, top 20.
const words = ["gas", "contract", "meeting", "california", "power", "enron", "price", "schedule", "invoice", "kitchen", "receipt", "weather", "trading", "approval", "dinner", "lawyer"];
const pairs = [["gas", "price"], ["meeting", "tomorrow"], ["power", "california"], ["contract", "signed"], ["trading", "desk"], ["dinner", "friday"]];
const phrases = ["conference call", "please let me know", "natural gas", "power plant", "credit report", "thank you for"];
const q = (match) => ({ match, sql: `SELECT m.id, bm25(fts, 5.0, 2.0, 1.0, 1.0) score FROM fts JOIN messages m ON m.rowid = fts.rowid
  WHERE fts MATCH ? AND NOT EXISTS (SELECT 1 FROM labels l WHERE l.message = fts.rowid AND l.label IN ('spam','trash'))
  ORDER BY score LIMIT 20` });
const queries = [
  ...words.map((w) => q(`{body subject people}: ${w} OR stemmed: ${en.stem(w)}`)),
  ...pairs.map(([a, b]) => q(`({body subject people}: ${a} OR stemmed: ${en.stem(a)}) AND ({body subject people}: ${b} OR stemmed: ${en.stem(b)})`)),
  ...phrases.map((p) => q(mode === "lean" ? `stemmed: "${p.split(" ").map((w) => en.stem(w)).join(" ")}"` : `{body subject people}: "${p}"`)),
];
const opened = Date.now();
const r = new DatabaseSync(file, { readOnly: true });
const openMs = Date.now() - opened;
const lat = []; const slow = [];
let first;
for (let round = 0; round < 5; round++)
  for (const { match, sql } of queries) {
    const s = performance.now();
    const hits = r.prepare(sql).all(match);
    const ms = performance.now() - s;
    if (first === undefined) first = ms;
    lat.push(ms); if (round === 1) slow.push([Math.round(ms), match]);
    if (round === 0 && hits.length === 0) console.error("no hits", match);
  }
lat.sort((a, b) => a - b);
const pct = (p) => lat[Math.floor(p * (lat.length - 1))].toFixed(2);
// erasure: delete 1,000 messages, then check that a token unique to one is gone from the file
const w = new DatabaseSync(file);
w.exec("PRAGMA secure_delete=ON");
const victim = w.prepare("SELECT rowid, text FROM messages WHERE rowid = 4242").get();
const marker = "zyxqvmarker4242";
w.exec(`INSERT INTO messages(rowid, id, text) VALUES (200001, 'm', 'secret ${marker} words'); INSERT INTO fts(rowid, subject, people, body, stemmed) VALUES (200001, 'x', 'x', 'secret ${marker} words', '${marker}')`);
w.exec("INSERT INTO fts(fts) VALUES('optimize')");
const before = execSync(`grep -c ${marker} ${file} || true`).toString().trim();
const d0 = performance.now();
w.exec("BEGIN");
w.exec("DELETE FROM fts WHERE rowid = 200001; DELETE FROM messages WHERE rowid = 200001");
for (let id = 1; id <= 1000; id++) w.exec(`DELETE FROM fts WHERE rowid = ${id}; DELETE FROM messages WHERE rowid = ${id}; DELETE FROM labels WHERE message = ${id};`);
w.exec("COMMIT");
const delMs = performance.now() - d0;
w.close();
const after = execSync(`grep -c ${marker} ${file} || true`).toString().trim();
const out = { mode, messages: rows.length, avgTextChars: Math.round(avg), buildMs: tBuild, fileBytes: bytes, ftsBytes, messagesTableBytes: textBytes, zstd3Bytes: zstd, gzip6Bytes: gz, openMs, firstQueryMs: first?.toFixed(2), queries: queries.length * 5, p50: pct(0.5), p95: pct(0.95), p99: pct(0.99), max: pct(1), slowest: slow.sort((a, b) => b[0] - a[0]).slice(0, 6), erase: { markerBeforeDelete: before, markerAfterSecureDelete: after, delete1000Ms: Math.round(delMs) } };
console.log(JSON.stringify(out, null, 1));
writeFileSync(`${process.env.KEYWORD_DATA}/fts5-${mode}.json`, JSON.stringify(out, null, 1));
