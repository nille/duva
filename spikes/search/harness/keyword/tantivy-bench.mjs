// Tantivy (via @oxdev03/node-tantivy-binding) on the same 100k Enron messages.
import { readFileSync, rmSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import t from "@oxdev03/node-tantivy-binding";
const { SchemaBuilder, Index, Document, TextAnalyzerBuilder, TokenizerStatic: Tokenizer, FilterStatic: Filter } = t;

const dir = process.env.KEYWORD_DATA + "/tantivy-index";
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir);
const rows = readFileSync(process.env.KEYWORD_DATA + "/mail100k.jsonl", "utf8").trim().split("\n").map((l) => JSON.parse(l));
const sb = new SchemaBuilder();
sb.addTextField("id", { stored: true, tokenizerName: "raw" });
sb.addTextField("labels", { tokenizerName: "raw", indexOption: "basic" });
sb.addTextField("subject", { tokenizerName: "en_stem" });
sb.addTextField("people", { tokenizerName: "default" });
sb.addTextField("body", { tokenizerName: "en_stem" });
sb.addDateField("received", { indexed: true, fast: true });
const schema = sb.build();
const index = new Index(schema, dir);
index.registerTokenizer("sv_stem", new TextAnalyzerBuilder(Tokenizer.simple()).filter(Filter.lowercase()).filter(Filter.stemmer("swedish")).build());
const shares = [["inbox", 0.109], ["archive", 0.81], ["spam", 0.03], ["trash", 0.051]];
let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const t0 = performance.now();
const w = index.writer(200_000_000, 1);
rows.forEach((r, i) => {
  const d = new Document();
  d.addText("id", String(i + 1));
  let x = rnd(), acc = 0;
  for (const [l, s] of shares) { acc += s; if (x < acc) { d.addText("labels", l); break; } }
  d.addText("subject", r.subject);
  d.addText("people", [r.from, ...r.to].join(" "));
  d.addText("body", r.text);
  d.addDate("received", Date.parse(r.date ?? "2001-01-01"));
  w.addDocument(d);
});
w.commit();
w.waitMergingThreads();
const buildMs = Math.round(performance.now() - t0);
const bytes = readdirSync(dir).reduce((s, f) => s + statSync(`${dir}/${f}`).size, 0);
const zstd = Number(execSync(`tar -C ${dir} -cf - . | zstd -3 -c | wc -c`).toString());
const o0 = performance.now();
const reader = new Index(schema, dir, true);
const searcher = reader.searcher();
const openMs = performance.now() - o0;
const words = ["gas", "contract", "meeting", "california", "power", "enron", "price", "schedule", "invoice", "kitchen", "receipt", "weather", "trading", "approval", "dinner", "lawyer"];
const pairs = [["gas", "price"], ["meeting", "tomorrow"], ["power", "california"], ["contract", "signed"], ["trading", "desk"], ["dinner", "friday"]];
const phrases = ["conference call", "please let me know", "natural gas", "power plant", "credit report", "thank you for"];
const not = " -labels:spam -labels:trash";
const qs = [
  ...words.map((x) => `+(body:${x} subject:${x}^5 people:${x}^2)${not}`),
  ...pairs.map(([a, b]) => `+(body:${a} subject:${a} people:${a}) +(body:${b} subject:${b} people:${b})${not}`),
  ...phrases.map((p) => `+(body:"${p}" subject:"${p}")${not}`),
];
const lat = []; let first;
for (let round = 0; round < 5; round++) for (const q of qs) {
  const s = performance.now();
  const res = searcher.search(reader.parseQuery(q), 20);
  const ms = performance.now() - s;
  if (first === undefined) first = ms;
  lat.push(ms);
  if (round === 0 && res.hits.length === 0) console.error("no hits", q);
}
lat.sort((a, b) => a - b);
const pct = (p) => lat[Math.floor(p * (lat.length - 1))].toFixed(2);
console.log(JSON.stringify({ messages: rows.length, buildMs, segments: searcher.numSegments, indexBytes: bytes, zstd3Bytes: zstd, openMs: openMs.toFixed(1), firstQueryMs: first.toFixed(2), queries: lat.length, p50: pct(0.5), p95: pct(0.95), p99: pct(0.99), max: pct(1), rss: process.memoryUsage().rss }, null, 1));
