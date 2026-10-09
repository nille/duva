// Would Amazon S3 Vectors search Duva's mail better than LanceDB? Mirrors harness/recall.ts (#62): the
// benchmark mailbox's 100,000 Titan vectors from `node harness/models.ts export`, the same seeded
// labels, the same 315 queries and filters. It creates a vector bucket, an IAM role and a Lambda in
// eu-north-1, measures from inside the region, and `down` deletes them all. `all` runs every step
// and then `down`, even if a step fails. It takes about 30 minutes and cost under $1 on 2026-10-09.
// The Lambda is Python, since boto3 is in its runtime: AWS_DATA_PATH gives it the S3 Vectors model
// the AWS CLI ships, which has queryMode. Needs the AWS CLI 2.37 or newer, and zip.
//   node harness/s3vectors/probe.mjs up | load | recall | small | fresh | latency | down | all
// Into results/s3vectors-*.json. See docs/research/s3-vectors.md.
import { execFileSync, execFile } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = new URL("../..", import.meta.url).pathname;
const here = join(root, ".data/s3vectors");
const models = join(root, ".data/models");
mkdirSync(join(here, "lambda/models"), { recursive: true });
const env = { ...process.env, AWS_REGION: "eu-north-1", AWS_PROFILE: "AWSAdministratorAccess-925039213717", AWS_PAGER: "" };
const stateFile = join(here, "state.json");
const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : {};
const save = () => writeFileSync(stateFile, JSON.stringify(state, null, 2));
const resultFile = (name) => join(root, `results/s3vectors-${name}.json`);
const aws = (...args) => JSON.parse(execFileSync("aws", [...args, "--output", "json"], { env, encoding: "utf8", maxBuffer: 1 << 28 }) || "{}");
const awsAsync = async (...args) => JSON.parse((await run("aws", [...args, "--output", "json"], { env, encoding: "utf8", maxBuffer: 1 << 28 })).stdout || "{}");
const dims = 1024;
const k = 20;

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mailbox() {
  const ids = JSON.parse(readFileSync(join(models, "messages.json"), "utf8")).map((m) => m.id);
  const bytes = readFileSync(join(models, "titan-1024.f32"));
  const vectors = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  const random = seeded(62);
  const labels = ids.map(() => {
    const d = random();
    return d < 0.03 ? ["Spam"] : d < 0.081 ? ["Trash"] : d < 0.099 ? ["Inbox", "Travel"] : ["Inbox"];
  });
  return { ids, vectors, labels };
}

async function up() {
  state.bucket ??= `duva-s3v-probe-${Date.now()}`;
  state.role ??= `duva-s3v-probe-${Date.now()}`;
  state.fn ??= state.role;
  save();
  aws("s3vectors", "create-vector-bucket", "--vector-bucket-name", state.bucket);
  for (const index of ["mailbox", "small"]) aws("s3vectors", "create-index", "--vector-bucket-name", state.bucket, "--index-name", index, "--data-type", "float32", "--dimension", String(dims), "--distance-metric", "cosine");
  writeFileSync(resultFile("index"), JSON.stringify(aws("s3vectors", "get-index", "--vector-bucket-name", state.bucket, "--index-name", "mailbox"), null, 2));
  const account = aws("sts", "get-caller-identity").Account;
  const trust = { Version: "2012-10-17", Statement: [{ Effect: "Allow", Principal: { Service: "lambda.amazonaws.com" }, Action: "sts:AssumeRole", Condition: { StringEquals: { "aws:SourceAccount": account } } }] };
  state.roleArn = aws("iam", "create-role", "--role-name", state.role, "--assume-role-policy-document", JSON.stringify(trust)).Role.Arn;
  save();
  const policy = {
    Version: "2012-10-17",
    Statement: [
      { Effect: "Allow", Action: ["s3vectors:QueryVectors", "s3vectors:GetVectors", "s3vectors:PutVectors", "s3vectors:DeleteVectors"], Resource: `arn:aws:s3vectors:eu-north-1:${account}:bucket/${state.bucket}/index/*` },
      { Effect: "Allow", Action: ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"], Resource: `arn:aws:logs:eu-north-1:${account}:log-group:/aws/lambda/${state.fn}:*` },
    ],
  };
  aws("iam", "put-role-policy", "--role-name", state.role, "--policy-name", "probe", "--policy-document", JSON.stringify(policy));
  // The Lambda's code: the handler, the queries, and the CLI's S3 Vectors model.
  const cli = execFileSync("bash", ["-c", "dirname $(readlink -f $(command -v aws))"], { encoding: "utf8" }).trim();
  execFileSync("bash", ["-c", `cp ${join(root, "harness/s3vectors/handler.py")} ${join(here, "lambda")}/ && cp ${join(models, "queries-titan-1024.json")} ${join(here, "lambda/queries.json")} && cp -r ${cli}/awscli/botocore/data/s3vectors ${join(here, "lambda/models")}/`]);
  execFileSync("bash", ["-c", `cd ${join(here, "lambda")} && rm -f ../fn.zip && zip -qr ../fn.zip .`]);
  await new Promise((r) => setTimeout(r, 12_000)); // IAM propagation
  aws("lambda", "create-function", "--function-name", state.fn, "--runtime", "python3.13", "--architectures", "x86_64", "--memory-size", "1024", "--timeout", "900",
    "--role", state.roleArn, "--handler", "handler.handler", "--zip-file", `fileb://${join(here, "fn.zip")}`,
    "--environment", JSON.stringify({ Variables: { BUCKET: state.bucket, AWS_DATA_PATH: "/var/task/models", COLD: "0" } }));
  aws("lambda", "wait", "function-active-v2", "--function-name", state.fn);
  console.log("up", state);
}

async function putAll(index, count) {
  const { ids, vectors, labels } = mailbox();
  const n = count ?? ids.length;
  const batches = [];
  for (let at = 0; at < n; at += 500) batches.push(at);
  const started = Date.now();
  let next = 0, done = 0;
  const worker = async () => {
    while (next < batches.length) {
      const at = batches[next++];
      const file = join(here, `batch-${at}.json`);
      const vs = [];
      for (let i = at; i < Math.min(at + 500, n); i++) vs.push({ key: ids[i], data: { float32: Array.from(vectors.subarray(i * dims, (i + 1) * dims)) }, metadata: { labels: labels[i] } });
      writeFileSync(file, JSON.stringify({ vectorBucketName: state.bucket, indexName: index, vectors: vs }));
      for (let attempt = 1; ; attempt++) {
        try { await awsAsync("s3vectors", "put-vectors", "--cli-input-json", `file://${file}`); break; }
        catch (e) { if (attempt >= 5) throw e; await new Promise((r) => setTimeout(r, 2000 * attempt)); }
      }
      rmSync(file);
      if (++done % 20 === 0) console.log(`${index}: ${done}/${batches.length} batches, ${Math.round((Date.now() - started) / 1000)} s`);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return { vectors: n, seconds: (Date.now() - started) / 1000 };
}

async function load() {
  const out = { mailbox: await putAll("mailbox"), small: await putAll("small", 2000) };
  writeFileSync(resultFile("load"), JSON.stringify(out, null, 2));
  console.log(out);
}

function invoke(payload, tail = false) {
  const outFile = join(here, "out.json");
  const r = aws("lambda", "invoke", "--function-name", state.fn, "--cli-binary-format", "raw-in-base64-out", "--payload", JSON.stringify(payload), ...(tail ? ["--log-type", "Tail"] : []), outFile);
  const body = JSON.parse(readFileSync(outFile, "utf8"));
  if (r.FunctionError) throw new Error(JSON.stringify(body));
  const log = tail ? Buffer.from(r.LogResult, "base64").toString("utf8") : "";
  return { body, log };
}

// The flat scan's top 20 per query and filter, computed here, as the truth to measure recall against.
function truth(subset) {
  const { ids, vectors, labels } = mailbox();
  const n = subset ?? ids.length;
  const norms = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let d = 0; d < dims; d++) s += vectors[i * dims + d] ** 2; norms[i] = Math.sqrt(s); }
  const queries = JSON.parse(readFileSync(join(models, "queries-titan-1024.json"), "utf8"));
  const keep = { none: () => true, notSpamTrash: (l) => !l.includes("Spam") && !l.includes("Trash"), travel: (l) => l.includes("Travel") };
  const out = {};
  for (const [name, ok] of Object.entries(keep)) {
    out[name] = queries.map((q) => {
      let qn = 0; for (const x of q) qn += x * x; qn = Math.sqrt(qn);
      const top = [];
      for (let i = 0; i < n; i++) {
        if (!ok(labels[i])) continue;
        let dot = 0; const o = i * dims;
        for (let d = 0; d < dims; d++) dot += q[d] * vectors[o + d];
        const sim = dot / (qn * norms[i]);
        if (top.length < k) { top.push([sim, ids[i]]); top.sort((a, b) => b[0] - a[0]); }
        else if (sim > top[k - 1][0]) { top[k - 1] = [sim, ids[i]]; top.sort((a, b) => b[0] - a[0]); }
      }
      return top.map((t) => t[1]);
    });
  }
  return out;
}

const mean = (v) => v.reduce((a, b) => a + b, 0) / v.length;
const pct = (v, p) => [...v].sort((a, b) => a - b)[Math.min(v.length - 1, Math.floor(p * v.length))];
const r3 = (x) => Math.round(x * 1000) / 1000;

function recallFor(index, subset) {
  const t = truth(subset);
  const report = {};
  for (const [mode, asked] of [["ENHANCED", 20], ["ENHANCED", 100]]) {
    for (const filter of ["none", "notSpamTrash", "travel"]) {
      const rows = [];
      for (let from = 0; from < 315; from += 105) rows.push(...invoke({ kind: "recall", index, filter, mode, k: asked, from, to: from + 105 }).body.rows);
      for (const r of rows) { r.keys = r.keys.slice(0, k); r.labels = r.labels.slice(0, k); }
      const recalls = rows.map((r, i) => r.keys.filter((key) => t[filter][i].includes(key)).length / t[filter][i].length);
      const short = rows.filter((r) => r.keys.length < k).length;
      const violations = rows.reduce((s, r) => s + r.labels.filter((l) => (filter === "notSpamTrash" && (l.includes("Spam") || l.includes("Trash"))) || (filter === "travel" && !l.includes("Travel"))).length, 0);
      const ms = rows.map((r) => r.ms);
      report[`${mode} topK ${asked} ${filter}`] = { recall: r3(mean(recalls)), worst: r3(Math.min(...recalls)), queriesWithFewerThan20: short, filterViolations: violations, p50Ms: pct(ms, 0.5), p95Ms: pct(ms, 0.95) };
      console.log(index, mode, asked, filter, JSON.stringify(report[`${mode} topK ${asked} ${filter}`]));
    }
  }
  return report;
}

async function recall() {
  writeFileSync(resultFile("recall"), JSON.stringify({ measuredAt: new Date().toISOString(), k, mailbox: recallFor("mailbox") }, null, 2));
}
async function small() {
  writeFileSync(resultFile("recall-small"), JSON.stringify({ measuredAt: new Date().toISOString(), k, vectors: 2000, small: recallFor("small", 2000) }, null, 2));
}

async function latency() {
  const cold = [];
  for (let i = 1; i <= 30; i++) {
    aws("lambda", "update-function-configuration", "--function-name", state.fn, "--environment", JSON.stringify({ Variables: { BUCKET: state.bucket, AWS_DATA_PATH: "/var/task/models", COLD: String(Date.now()) } }));
    aws("lambda", "wait", "function-updated-v2", "--function-name", state.fn);
    const at = Date.now();
    const { body, log } = invoke({ kind: "latency", filter: "notSpamTrash", n: 1, offset: i }, true);
    const roundTrip = Date.now() - at;
    const init = Number(/Init Duration: ([\d.]+) ms/.exec(log)?.[1] ?? NaN);
    const duration = Number(/\tDuration: ([\d.]+) ms/.exec(log)?.[1] ?? NaN);
    cold.push({ initDurationMs: init, durationMs: duration, firstQueryMs: body.ms[0], moduleInitMs: body.initMs, roundTripMs: roundTrip, firstInEnvironment: body.firstInEnvironment });
    console.log("cold", i, cold.at(-1));
  }
  const warm = {};
  for (const filter of ["none", "notSpamTrash", "travel"]) {
    for (const metadata of [true, false]) {
      const ms = invoke({ kind: "latency", filter, n: 100, metadata }).body.ms;
      warm[`${filter}${metadata ? "" : " keys only"}`] = { p50: pct(ms, 0.5), p95: pct(ms, 0.95), p99: pct(ms, 0.99), max: Math.max(...ms) };
    }
    const k100 = invoke({ kind: "latency", filter, n: 50, k: 100 }).body.ms;
    warm[`${filter} topK 100`] = { p50: pct(k100, 0.5), p95: pct(k100, 0.95) };
    console.log("warm", filter, warm);
  }
  // A configuration change doesn't always reach the next invoke, so only runs that were the first in a
  // new environment count as cold.
  const fresh = cold.filter((c) => c.firstInEnvironment);
  const summary = (key) => ({ p50: pct(fresh.map((c) => c[key]), 0.5), p95: pct(fresh.map((c) => c[key]), 0.95) });
  writeFileSync(resultFile("latency"), JSON.stringify({ measuredAt: new Date().toISOString(), lambda: "python3.13 x86_64 1024 MB, boto3 with the CLI 2.37.9 service model",
    cold: { environments: fresh.length, initDurationMs: summary("initDurationMs"), firstQueryMs: summary("firstQueryMs"), durationMs: summary("durationMs"), roundTripMs: summary("roundTripMs"), runs: cold }, warm }, null, 2));
}

async function fresh() {
  const out = invoke({ kind: "fresh", trials: 10 }).body;
  writeFileSync(resultFile("fresh"), JSON.stringify({ measuredAt: new Date().toISOString(), ...out }, null, 2));
  console.log(out);
}

async function down() {
  const tryIt = (...a) => { try { aws(...a); } catch (e) { console.error("down:", a.slice(0, 2).join(" "), String(e.message).split("\n")[0]); } };
  if (state.fn) { tryIt("lambda", "delete-function", "--function-name", state.fn); tryIt("logs", "delete-log-group", "--log-group-name", `/aws/lambda/${state.fn}`); }
  if (state.role) { tryIt("iam", "delete-role-policy", "--role-name", state.role, "--policy-name", "probe"); tryIt("iam", "delete-role", "--role-name", state.role); }
  if (state.bucket) {
    for (const index of ["mailbox", "small"]) tryIt("s3vectors", "delete-index", "--vector-bucket-name", state.bucket, "--index-name", index);
    tryIt("s3vectors", "delete-vector-bucket", "--vector-bucket-name", state.bucket);
  }
  const left = JSON.parse(execFileSync("aws", ["s3vectors", "list-vector-buckets", "--output", "json"], { env, encoding: "utf8" })).vectorBuckets.filter((b) => b.vectorBucketName.startsWith("duva-s3v-probe"));
  console.log("down; probe buckets left:", left.length);
  if (left.length === 0) rmSync(stateFile, { force: true });
}

const steps = { up, load, recall, small, latency, fresh, down };
const step = process.argv[2];
if (step === "all") {
  try { for (const s of ["up", "load", "recall", "small", "fresh", "latency"]) { console.log("== " + s); await steps[s](); } }
  finally { await down(); }
} else await steps[step]();
