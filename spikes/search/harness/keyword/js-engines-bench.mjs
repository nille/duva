// MiniSearch and Orama on the same 100k messages: heap, serialized size, load time, query latency.
// node --expose-gc js-engines-bench.mjs <minisearch|orama|load-minisearch|load-orama>
import { readFileSync, writeFileSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import MiniSearch from "minisearch";
import { create, insertMultiple, search, save, load } from "@orama/orama";
import snowball from "snowball-stemmers";

const which = process.argv[2];
const en = snowball.newStemmer("english");
const words = ["gas", "contract", "meeting", "california", "power", "enron", "price", "schedule", "invoice", "kitchen", "receipt", "weather", "trading", "approval", "dinner", "lawyer"];
const heap = () => { global.gc?.(); return process.memoryUsage().heapUsed; };
const time = (f) => { const s = performance.now(); const r = f(); return [performance.now() - s, r]; };
const lat = (f) => { const l = []; for (let r = 0; r < 5; r++) for (const w of words) l.push(time(() => f(w))[0]); l.sort((a, b) => a - b); return { p50: l[Math.floor(l.length / 2)].toFixed(1), p95: l[Math.floor(l.length * 0.95)].toFixed(1) }; };
const msOptions = { fields: ["subject", "people", "text"], storeFields: [], processTerm: (t) => en.stem(t.toLowerCase()) };
const oramaSchema = { id: "string", subject: "string", people: "string", text: "string", labels: "string[]" };

if (which === "minisearch" || which === "orama") {
  const rows = readFileSync(process.env.KEYWORD_DATA + "/mail100k.jsonl", "utf8").trim().split("\n").map((l, i) => { const r = JSON.parse(l); return { id: String(i + 1), subject: r.subject, people: [r.from, ...r.to].join(" "), text: r.text, labels: ["archive"] }; });
  const h0 = heap();
  if (which === "minisearch") {
    const [buildMs, ms] = time(() => { const m = new MiniSearch(msOptions); m.addAll(rows); return m; });
    const h1 = heap();
    const [serMs, json] = time(() => JSON.stringify(ms));
    writeFileSync(process.env.KEYWORD_DATA + "/minisearch.json", json);
    console.log(JSON.stringify({ engine: "minisearch", buildMs: Math.round(buildMs), heapMB: Math.round((h1 - h0) / 1e6), serializedMB: (json.length / 1e6).toFixed(1), zstdMB: (Number(execSync(`zstd -3 -c ${process.env.KEYWORD_DATA}/minisearch.json | wc -c`).toString()) / 1e6).toFixed(1), serializeMs: Math.round(serMs), query: lat((w) => ms.search(w)) }));
  } else {
    const db = create({ schema: oramaSchema, components: { tokenizer: { stemming: true, language: "english" } } });
    const [buildMs] = time(() => insertMultiple(db, rows, 5000));
    const h1 = heap();
    console.log(JSON.stringify({ engine: "orama", buildMs: Math.round(buildMs), heapMB: Math.round((h1 - h0) / 1e6), query: lat((w) => search(db, { term: w, limit: 20 })) }));
    const [serMs, data] = time(() => JSON.stringify(save(db)));
    writeFileSync(process.env.KEYWORD_DATA + "/orama.json", data);
    console.log(JSON.stringify({ engine: "orama", buildMs: Math.round(buildMs), heapMB: Math.round((h1 - h0) / 1e6), serializedMB: (data.length / 1e6).toFixed(1), serializeMs: Math.round(serMs), query: lat((w) => search(db, { term: w, limit: 20 })) }));
  }
} else if (which === "load-minisearch") {
  const h0 = heap();
  const [loadMs, ms] = time(() => MiniSearch.loadJSON(readFileSync(process.env.KEYWORD_DATA + "/minisearch.json", "utf8"), msOptions));
  console.log(JSON.stringify({ engine: "minisearch", loadMs: Math.round(loadMs), heapMB: Math.round((heap() - h0) / 1e6), query: lat((w) => ms.search(w)) }));
} else if (which === "load-orama") {
  const h0 = heap();
  const [loadMs, db] = time(() => { const d = create({ schema: oramaSchema, components: { tokenizer: { stemming: true, language: "english" } } }); load(d, JSON.parse(readFileSync(process.env.KEYWORD_DATA + "/orama.json", "utf8"))); return d; });
  console.log(JSON.stringify({ engine: "orama", loadMs: Math.round(loadMs), heapMB: Math.round((heap() - h0) / 1e6), query: lat((w) => search(db, { term: w, limit: 20 })) }));
}
