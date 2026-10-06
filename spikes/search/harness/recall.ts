// #62's harness: tunes the vector index. It loads the benchmark mailbox's Titan vectors, which
// `node harness/models.ts export` keeps in .data/models/, into a table on local disk, builds each
// vector index on it, and measures what share of a flat scan's top 20 each setting's top 20 has,
// over #19's questions and #17's filtered vector queries, unfiltered and filtered.
//
//   node harness/recall.ts     into results/62-recall.json
//
// Recall depends on the index and the vectors, not on where the table is, so local disk gives the
// numbers S3 would. Latency here is local disk's, so only the ordering of settings means anything.
// Run it with AWS_PROFILE set to the spike's account: it embeds the queries once, into .data/models/.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import * as lancedb from "@lancedb/lancedb";
import { Field, FixedSizeList, Float32, List, Schema, Utf8 } from "apache-arrow";
import { titanModelId } from "../src/titan.ts";
import { meanings } from "./queries.ts";

const root = new URL("..", import.meta.url).pathname;
const models = join(root, ".data/models");
const tableDirectory = join(root, ".data/recall");
const dimensions = 1024;
const k = 20;

// Labels drawn per message from a seeded generator, in the benchmark's shares: Spam and Trash 8.1%
// together, which nearly every search leaves out, and Travel 1.8%, a narrow label: filter.
const filters: Record<string, string | undefined> = {
  none: undefined,
  "not Spam or Trash": "NOT array_has_any(labels, make_array('Spam', 'Trash'))",
  "label Travel": "array_has_all(labels, make_array('Travel'))",
};

interface Setting {
  nprobes?: number;
  refineFactor?: number;
  ef?: number;
}

const indexes: { name: string; index: () => lancedb.Index; settings: Setting[] }[] = [
  {
    name: "IVF_PQ at defaults",
    index: () => lancedb.Index.ivfPq({ distanceType: "cosine" }),
    settings: [{}, { nprobes: 40 }, { refineFactor: 2 }, { refineFactor: 5 }, { nprobes: 40, refineFactor: 5 }, { nprobes: 40, refineFactor: 10 }],
  },
  {
    name: "IVF_PQ, 128 subvectors",
    index: () => lancedb.Index.ivfPq({ distanceType: "cosine", numSubVectors: 128 }),
    settings: [{}, { nprobes: 40 }, { refineFactor: 2 }, { nprobes: 40, refineFactor: 2 }, { nprobes: 40, refineFactor: 5 }],
  },
  {
    name: "IVF_PQ, 256 subvectors",
    index: () => lancedb.Index.ivfPq({ distanceType: "cosine", numSubVectors: 256 }),
    settings: [{}, { nprobes: 40 }, { refineFactor: 2 }, { nprobes: 40, refineFactor: 2 }],
  },
  {
    name: "IVF_RQ",
    index: () => lancedb.Index.ivfRq({ distanceType: "cosine" }),
    settings: [{}, { nprobes: 40 }, { refineFactor: 2 }, { refineFactor: 5 }, { nprobes: 40, refineFactor: 5 }],
  },
  {
    name: "IVF_HNSW_SQ",
    index: () => lancedb.Index.hnswSq({ distanceType: "cosine" }),
    settings: [{}, { nprobes: 40 }, { ef: 100 }, { nprobes: 40, ef: 100 }],
  },
];

async function main() {
  const ids = (JSON.parse(readFileSync(join(models, "messages.json"), "utf8")) as { id: string }[]).map((m) => m.id);
  const bytes = readFileSync(join(models, "titan-1024.f32"));
  const vectors = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  const queries = await queryVectors();

  rmSync(tableDirectory, { recursive: true, force: true });
  const db = await lancedb.connect(tableDirectory);
  const schema = new Schema([
    new Field("id", new Utf8(), false),
    new Field("labels", new List(new Field("item", new Utf8(), true)), false),
    new Field("vector", new FixedSizeList(dimensions, new Field("item", new Float32(), true)), false),
  ]);
  const table = await db.createEmptyTable("benchmark", schema);
  const random = seeded(62);
  // In batches of 2,000, as the benchmark table was loaded.
  for (let at = 0; at < ids.length; at += 2_000) {
    const rows = ids.slice(at, at + 2_000).map((id, i) => {
      const draw = random();
      const labels = draw < 0.03 ? ["Spam"] : draw < 0.081 ? ["Trash"] : draw < 0.099 ? ["Inbox", "Travel"] : ["Inbox"];
      return { id, labels, vector: Array.from(vectors.subarray((at + i) * dimensions, (at + i + 1) * dimensions)) };
    });
    await table.add(rows);
  }
  await table.createIndex("labels", { config: lancedb.Index.labelList() });

  const search = async (vector: number[], where: string | undefined, setting: Setting | "flat") => {
    let query = table.query().nearestTo(vector).column("vector").distanceType("cosine").select(["id", "_distance"]).limit(k);
    if (setting === "flat") query = query.bypassVectorIndex();
    else {
      if (setting.nprobes !== undefined) query = query.nprobes(setting.nprobes);
      if (setting.refineFactor !== undefined) query = query.refineFactor(setting.refineFactor);
      if (setting.ef !== undefined) query = query.ef(setting.ef);
    }
    if (where !== undefined) query = query.where(where);
    const rows: { id: string }[] = await query.toArray();
    return rows.map((row) => row.id);
  };

  const truth = new Map<string, string[][]>();
  for (const [name, where] of Object.entries(filters)) {
    const tops = [];
    for (const vector of queries) tops.push(await search(vector, where, "flat"));
    truth.set(name, tops);
    console.error(`flat scan, ${name}: done`);
  }

  const results = [];
  for (const { name, index, settings } of indexes) {
    const started = performance.now();
    await table.createIndex("vector", { config: index(), replace: true });
    const buildMs = Math.round(performance.now() - started);
    for (const setting of settings) {
      const byFilter: Record<string, { recall: number; worst: number; p50Ms: number; p95Ms: number }> = {};
      for (const [filter, where] of Object.entries(filters)) {
        const recalls: number[] = [];
        const ms: number[] = [];
        for (const [i, vector] of queries.entries()) {
          const at = performance.now();
          const found = await search(vector, where, setting);
          ms.push(performance.now() - at);
          const expected = truth.get(filter)![i]!;
          recalls.push(found.filter((id) => expected.includes(id)).length / expected.length);
        }
        byFilter[filter] = { recall: round(mean(recalls)), worst: round(Math.min(...recalls)), p50Ms: round(percentile(ms, 0.5)), p95Ms: round(percentile(ms, 0.95)) };
      }
      results.push({ index: name, buildMs, ...setting, ...byFilter });
      console.error(name, JSON.stringify(setting), Object.entries(byFilter).map(([f, r]) => `${f} ${r.recall}`).join(", "));
    }
  }

  const report = {
    measuredAt: new Date().toISOString(),
    lancedb: JSON.parse(readFileSync(join(root, "node_modules/@lancedb/lancedb/package.json"), "utf8")).version,
    mailbox: { messages: ids.length, fragments: Math.ceil(ids.length / 2_000) },
    queries: { count: queries.length, from: "harness/questions.json and the meanings of harness/queries.ts", model: titanModelId, dimensions },
    method: `Recall is the share of a flat scan's top ${k} in the setting's top ${k}, averaged over the queries, with the worst query's beside it. Latency is on local disk.`,
    filters,
    results,
  };
  writeFileSync(join(root, "results/62-recall.json"), JSON.stringify(report, null, 2) + "\n");
  rmSync(tableDirectory, { recursive: true, force: true });
}

// Each question and meaning embedded once, as a search embeds its words.
async function queryVectors(): Promise<number[][]> {
  const file = join(models, "queries-titan-1024.json");
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
  const questions = (JSON.parse(readFileSync(join(root, "harness/questions.json"), "utf8")) as { questions: { question: string }[] }).questions;
  const texts = [...questions.map((q) => q.question), ...meanings];
  const bedrock = new BedrockRuntimeClient({ region: "eu-north-1", retryMode: "adaptive", maxAttempts: 10 });
  const out: number[][] = [];
  for (let at = 0; at < texts.length; at += 16) {
    out.push(
      ...(await Promise.all(
        texts.slice(at, at + 16).map(async (inputText) => {
          const response = await bedrock.send(
            new InvokeModelCommand({ modelId: titanModelId, contentType: "application/json", accept: "application/json", body: JSON.stringify({ inputText, dimensions, normalize: true }) }),
          );
          return (JSON.parse(Buffer.from(response.body).toString("utf8")) as { embedding: number[] }).embedding;
        }),
      )),
    );
  }
  mkdirSync(models, { recursive: true });
  writeFileSync(file, JSON.stringify(out));
  return out;
}

function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
const percentile = (values: number[], p: number) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(p * values.length))]!;
const round = (value: number) => Math.round(value * 1000) / 1000;

await main();
