// The writes measurement (#18): how soon new mail is searchable, what single
// and batched writes cost, what five concurrent writers and maintenance during
// writes do to a mailbox, and what maintenance takes on 100k messages.
//
// It works on copies of the benchmark table named writes-*, in the
// duva-search-spike stack's bucket, through two functions of its own in the
// duva-search-spike-writes stack. It never writes to the benchmark table or
// changes the duva-search-spike stack.
//
//   node harness/writes.ts up                   build the package, create or update the stack
//   node harness/writes.ts <step>               run one step, into results/18-writes.json
//   node harness/writes.ts all                  run every step in order
//   node harness/writes.ts down                 delete the writes-* tables and the stack
//
// Steps: single, batches, unindexed, labels, concurrent, during-maintenance, maintenance, erasure.
// They run in this order: single copies the benchmark to writes-live, and
// the steps after it carry on writing there, so a step run again writes its
// messages twice. Run all to start over.
// Run it with AWS_PROFILE set to the spike's account.
import { randomUUID } from "node:crypto";
import { createReadStream, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CloudFormationClient,
  CreateStackCommand,
  DeleteStackCommand,
  DescribeStacksCommand,
  UpdateStackCommand,
  waitUntilStackCreateComplete,
  waitUntilStackDeleteComplete,
  waitUntilStackUpdateComplete,
} from "@aws-sdk/client-cloudformation";
import {
  GetFunctionConfigurationCommand,
  InvokeCommand,
  LambdaClient,
  UpdateFunctionConfigurationCommand,
  waitUntilFunctionUpdatedV2,
} from "@aws-sdk/client-lambda";
import { CopyObjectCommand, DeleteObjectsCommand, GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import type { SearchEvent } from "../src/lambda.ts";
import type { SearchFilters, SearchHit, SearchQuery } from "../src/search.ts";
import { tokenOf } from "../src/generated-mail.ts";
import type { Requests, WritesEvent } from "../src/writes-lambda.ts";
import { packageAll } from "./package.ts";

const region = "eu-north-1";
const stackName = "duva-search-spike-writes";
const bucket = "duva-search-spike-925039213717-eu-north-1";
const benchmark = "benchmark";
const writerFunction = "duva-search-spike-writes-writer";
const readerFunction = "duva-search-spike-writes-reader";
const root = new URL("..", import.meta.url).pathname;
const resultsFile = join(root, "results/18-writes.json");

const cloudFormation = new CloudFormationClient({ region });
const s3 = new S3Client({ region });
const lambda = new LambdaClient({ region });

// eu-north-1 on-demand prices from the AWS Price List, 2026-10-03.
const prices = {
  s3PutListPer1k: 0.005,
  s3GetHeadPer1k: 0.0004,
  lambdaGbSecond: 0.0000166667,
  lambdaRequest: 0.0000002,
  titanPer1kTokens: 0.000021,
};

async function up() {
  const [zip] = await packageAll({ handlers: { index: "lambda.ts", writes: "writes-lambda.ts" }, names: ["x64-zip"] });
  const key = `artifacts/writes-x64-zip-${zip!.hash}.zip`;
  await new Upload({ client: s3, params: { Bucket: bucket, Key: key, Body: createReadStream(zip!.file) } }).done();
  const input = {
    StackName: stackName,
    TemplateBody: readFileSync(join(root, "infra/writes-stack.yaml"), "utf8"),
    Capabilities: ["CAPABILITY_NAMED_IAM" as const],
    Parameters: [
      { ParameterKey: "Bucket", ParameterValue: bucket },
      { ParameterKey: "ZipKey", ParameterValue: key },
    ],
    Tags: [{ Key: "duva-search-spike", Value: "throwaway" }],
  };
  const waitFor = { client: cloudFormation, maxWaitTime: 1800 };
  if (!(await stackExists())) {
    await cloudFormation.send(new CreateStackCommand({ ...input, OnFailure: "DELETE" }));
    await waitUntilStackCreateComplete(waitFor, { StackName: stackName });
  } else {
    try {
      await cloudFormation.send(new UpdateStackCommand(input));
      await waitUntilStackUpdateComplete(waitFor, { StackName: stackName });
    } catch (error) {
      if (!(error instanceof Error && error.message.includes("No updates are to be performed"))) throw error;
    }
  }
  return { stack: stackName, zip: { key, zipBytes: zip!.zipBytes, unzippedBytes: zip!.unzippedBytes } };
}

async function down() {
  const deleted = (await deleteObjects("tables/writes-")) + (await deleteObjects("artifacts/writes-"));
  if (await stackExists()) {
    await cloudFormation.send(new DeleteStackCommand({ StackName: stackName }));
    await waitUntilStackDeleteComplete({ client: cloudFormation, maxWaitTime: 1800 }, { StackName: stackName });
  }
  return { deletedObjects: deleted, stack: stackName, deleted: !(await stackExists()) };
}

async function stackExists(): Promise<boolean> {
  try {
    const { Stacks } = await cloudFormation.send(new DescribeStacksCommand({ StackName: stackName }));
    return Stacks?.[0]?.StackStatus !== "DELETE_COMPLETE";
  } catch (error) {
    if (error instanceof Error && error.message.includes("does not exist")) return false;
    throw error;
  }
}


// The table most steps write to: a copy of the benchmark, so 100k messages
// in 50 fragments with every index built, which then lives on step to step.
const live = "writes-live";

// Messages one at a time, as inbound mail arrives. The writer's own reader
// times each commit until a search finds the message, and the reader
// function, another warm environment, checks the same from outside.
async function single() {
  const copied = await copyBenchmark(live);
  const before = await writer({ op: "stats", mailbox: live });
  const readsBefore = await readerLatency(live);
  const inProcess = await writer({ op: "add", mailbox: live, run: "single", from: 0, count: 100, batchSize: 1, reader: true });
  const crossProcess = [];
  for (let n = 100; n < 120; n++) {
    const written = await writer({ op: "add", mailbox: live, run: "single", from: n, count: 1, batchSize: 1 });
    crossProcess.push({ id: `single-${n}`, writer: written.result.operations[0], ...(await searchUntilFound(live, `single-${n}`)) });
  }
  // The same write from a new environment, which opens the mailbox first, as
  // the first inbound message after a quiet spell would.
  const cold = [];
  for (let n = 120; n < 125; n++) {
    await setWriterMemory(1769);
    const { result, report } = await writer({ op: "add", mailbox: live, run: "single", from: n, count: 1, batchSize: 1 });
    cold.push({ open: result.open, write: result.operations[0], report });
  }
  const verified = await verify(live, "single-", 125);
  return {
    copied,
    before,
    readsBefore,
    writes: summarizeWrites(inProcess.result.operations),
    freshnessInProcess: summarizeFreshness(inProcess.result.operations),
    readerRequestsPerSearch: summarizeRequests(
      inProcess.result.operations.flatMap((o: Operation) => (o.freshness?.lastSearch ? [o.freshness.lastSearch.requests] : [])),
    ),
    // From the writer's answer reaching the harness, so it leaves out the
    // time from the commit to that answer.
    freshnessCrossProcess: {
      notFound: crossProcess.filter((c) => c.foundAfterMs === undefined).length,
      writerResponseToFoundMs: summarize(crossProcess.flatMap((c) => (c.foundAfterMs === undefined ? [] : [c.foundAfterMs]))),
      searchesUntilFound: summarize(crossProcess.map((c) => c.searches)),
      trials: crossProcess,
    },
    writerInvocation: inProcess.report,
    cold: {
      initMs: summarize(cold.map((c) => c.report.initMs ?? 0)),
      openMs: summarize(cold.map((c) => c.open.ms)),
      openRequests: summarizeRequests(cold.map((c) => c.open.requests)),
      writeMs: summarize(cold.map((c) => c.write.ms)),
      writeRequests: summarizeRequests(cold.map((c) => c.write.requests)),
      // The invocation's billed time, init included, is what one cold
      // inbound write costs in Lambda.
      // A mean, since summarize rounds to tenths.
      lambdaUsd: mean(cold.map((c) => lambdaUsd((c.report.durationMs ?? 0) + (c.report.initMs ?? 0), 1769) + prices.lambdaRequest)),
      trials: cold,
    },
    verified,
    after: await writer({ op: "stats", mailbox: live }),
    readsAfter: await readerLatency(live),
    raw: inProcess.result.operations,
  };
}

// Batches as a per-mailbox queue would deliver them.
async function batches() {
  const sizes = [
    { batchSize: 10, batches: 10 },
    { batchSize: 100, batches: 5 },
    { batchSize: 1000, batches: 2 },
  ];
  const results = [];
  let from = 0;
  for (const { batchSize, batches } of sizes) {
    const count = batchSize * batches;
    const { result, report } = await writer({ op: "add", mailbox: live, run: "batch", from, count, batchSize, reader: true });
    from += count;
    results.push({
      batchSize,
      batches,
      writes: summarizeWrites(result.operations),
      freshness: summarizeFreshness(result.operations),
      invocation: report,
      raw: result.operations,
    });
  }
  const unindexed = await writer({ op: "stats", mailbox: live });
  const readsUnindexed = await readerLatency(live);
  const verified = await verify(live, "batch-", from);
  // Maintenance after every single and batched write so far, and the
  // searches after it, against the same searches before it.
  const maintenance = await optimizeIn(live, 1769);
  const readsAfterMaintenance = await readerLatency(live);
  return { sizes: results, unindexed, readsUnindexed, verified, maintenance, readsAfterMaintenance };
}

// What rows that no index holds yet do to searches: from a table maintenance
// just left fully indexed, after 1, 10, 50 and 150 messages written one at a
// time, and then after one batch of 100 in a single fragment. Each search
// runs with Spam and Trash left out, with a label included, and unfiltered,
// from the writer's own reader, which counts its S3 requests.
async function unindexed() {
  const checkpoints: unknown[] = [];
  const at = async (state: string) => {
    const searches: Record<string, unknown> = {};
    for (const [kind, query] of Object.entries(unindexedQueries)) {
      const { result } = await writer({ op: "search", mailbox: live, query, times: 6 });
      const warm = result.searches.slice(1);
      searches[kind] = { ms: summarize(warm.map((s: Search) => s.ms)), requests: summarizeRequests(warm.map((s: Search) => s.requests)) };
    }
    checkpoints.push({ state, stats: (await writer({ op: "stats", mailbox: live })).result, searches });
  };
  const maintenance = [await optimizeIn(live, 1769)];
  await at("fully indexed");
  let written = 0;
  for (const target of [1, 10, 50, 150]) {
    await writer({ op: "add", mailbox: live, run: "unindexed", from: written, count: target - written, batchSize: 1 });
    written = target;
    await at(`${target} written one at a time`);
  }
  maintenance.push(await optimizeIn(live, 1769));
  await writer({ op: "add", mailbox: live, run: "unindexed", from: written, count: 100, batchSize: 100 });
  await at("100 written in one batch");
  maintenance.push(await optimizeIn(live, 1769));
  return { checkpoints, maintenance, verified: await verify(live, "unindexed-", written + 100) };
}

interface Search {
  ms: number;
  requests: Requests;
}

// Changing a message's labels and removing it, on messages of the
// benchmark, which sit in its large fragments.
async function labels() {
  const ids = (await writer({ op: "verify", mailbox: live, prefix: "enron-00" })).result.rows.slice(0, 90).map((r: Row) => r.id);
  const relabel = ids.slice(0, 30);
  const removeOneByOne = ids.slice(30, 60);
  const removeTogether = ids.slice(60, 90);
  const changed = await writer({ op: "changeLabels", mailbox: live, ids: relabel, labels: ["Trash"] });
  const removed = await writer({ op: "remove", mailbox: live, ids: removeOneByOne, together: false });
  const removedTogether = await writer({ op: "remove", mailbox: live, ids: removeTogether, together: true });
  const rows: Row[] = (await writer({ op: "verify", mailbox: live, prefix: "enron-00" })).result.rows;
  const byId = new Map(rows.map((r) => [r.id, r]));
  return {
    changeLabels: summarizeWrites(changed.result.operations),
    removeOneByOne: summarizeWrites(removed.result.operations),
    removeTogether: { ...removedTogether.result.operations[0], messages: removeTogether.length },
    relabeledAsTrash: relabel.filter((id: string) => byId.get(id)?.labels.join() === "Trash").length,
    removedStillThere: [...removeOneByOne, ...removeTogether].filter((id: string) => byId.has(id)).length,
    after: await writer({ op: "stats", mailbox: live }),
    readsAfter: await readerLatency(live),
    raw: { changed: changed.result.operations, removed: removed.result.operations },
  };
}

// Five writers adding messages one at a time to one mailbox at once.
async function concurrent() {
  const writers = 5;
  const perWriter = 40;
  const started = Date.now();
  const results = await Promise.all(
    Array.from({ length: writers }, (_, w) =>
      writer({ op: "add", mailbox: live, run: `concurrent${w}`, from: 0, count: perWriter, batchSize: 1 }),
    ),
  );
  const operations: Operation[] = results.flatMap((r) => r.result.operations);
  const verified = await Promise.all(Array.from({ length: writers }, (_, w) => verify(live, `concurrent${w}-`, perWriter)));
  return {
    writers,
    perWriter,
    wallMs: Date.now() - started,
    writes: summarizeWrites(operations),
    failures: operations.flatMap((o) => o.failures),
    verified: sumVerified(verified),
    after: await writer({ op: "stats", mailbox: live }),
    raw: operations,
  };
}

// The same five writers, plus one changing labels and removing messages,
// while maintenance runs on the table again and again until they are done.
// The table's row count checks that no earlier message went missing either.
async function duringMaintenance() {
  const writers = 5;
  const perWriter = 60;
  const ids = (await writer({ op: "verify", mailbox: live, prefix: "enron-01" })).result.rows.slice(0, 40).map((r: Row) => r.id);
  const relabel = ids.slice(0, 20);
  const remove = ids.slice(20, 40);
  const rowsBefore = (await writer({ op: "stats", mailbox: live })).result.rows;
  const started = Date.now();
  let writing = true;
  const adding = Array.from({ length: writers }, (_, w) =>
    writer({ op: "add", mailbox: live, run: `during${w}`, from: 0, count: perWriter, batchSize: 1 }),
  );
  const editing = (async () => {
    const changed = await writer({ op: "changeLabels", mailbox: live, ids: relabel, labels: ["Spam"] });
    const removed = await writer({ op: "remove", mailbox: live, ids: remove, together: false });
    return [...changed.result.operations, ...removed.result.operations] as Operation[];
  })();
  const maintaining = (async () => {
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    const runs = [];
    while (writing) runs.push(await writer({ op: "optimize", mailbox: live, keepVersionsMs: 0 }));
    return runs;
  })();
  const [added, edited] = await Promise.all([Promise.all(adding), editing]).finally(() => {
    writing = false;
  });
  const maintenance = await maintaining;
  const operations: Operation[] = added.flatMap((r) => r.result.operations);
  const verified = await Promise.all(Array.from({ length: writers }, (_, w) => verify(live, `during${w}-`, perWriter)));
  const rows: Row[] = (await writer({ op: "verify", mailbox: live, prefix: "enron-01" })).result.rows;
  const byId = new Map(rows.map((r) => [r.id, r]));
  const windows = maintenance.map(({ result }) => [result.startedAt, result.endedAt] as const);
  const duringMaintenance = (o: Operation) => windows.some(([from, to]) => o.committedAt! >= from && o.committedAt! - o.ms <= to);
  const rowsAfter = (await writer({ op: "stats", mailbox: live })).result.rows;
  return {
    writers,
    perWriter,
    rows: { before: rowsBefore, after: rowsAfter, expected: rowsBefore + writers * perWriter - remove.length },
    wallMs: Date.now() - started,
    writes: summarizeWrites(operations),
    writeFailures: operations.flatMap((o) => o.failures),
    edits: summarizeWrites(edited),
    editFailures: edited.flatMap((o) => o.failures),
    relabeledAsSpam: relabel.filter((id: string) => byId.get(id)?.labels.join() === "Spam").length,
    removedStillThere: remove.filter((id: string) => byId.has(id)).length,
    maintenance: maintenance.map(({ result, report }) => ({
      startedAt: result.startedAt,
      endedAt: result.endedAt,
      ms: result.ms,
      failures: result.failures,
      optimizeStats: result.optimizeStats,
      before: result.before,
      after: result.after,
      requests: result.requests,
      report,
    })),
    // Writes that overlapped a maintenance run against the ones that didn't,
    // to see whether any waited on it.
    writesDuringMaintenance: summarizeWrites(operations.filter(duringMaintenance)),
    writesBetweenMaintenance: summarizeWrites(operations.filter((o) => !duringMaintenance(o))),
    verified: sumVerified(verified),
    after: await writer({ op: "stats", mailbox: live }),
    readsAfter: await readerLatency(live),
    raw: { operations, edited },
  };
}

// Maintenance on a fresh copy of the 100k-message mailbox at three memory
// sizes: first on the benchmark as loaded, in 50 fragments, then after 1,000
// new messages in 20 writes, when LanceDB suggests running it.
async function maintenance() {
  const sizes = [1769, 3008, 10240];
  const results = [];
  for (const memoryMb of sizes) {
    const mailbox = `writes-maintenance-${memoryMb}`;
    await copyBenchmark(mailbox);
    const first = await optimizeIn(mailbox, memoryMb);
    const added = await writer({ op: "add", mailbox, run: "maintenance", from: 0, count: 1000, batchSize: 50 });
    const afterNewMail = await optimizeIn(mailbox, memoryMb);
    results.push({ memoryMb, asLoaded: first, newMessages: 1000, addInvocation: added.report, afterNewMail });
  }
  await setWriterMemory(1769);
  await deleteObjects("tables/writes-maintenance-");
  return { results };
}

// What removing a message leaves behind on S3: whether its words are still
// in the table's files after the removal, and after each of two maintenance
// runs that keep no old versions. Maintenance keeps the version it started
// from, since the versions it writes are newer than its cutoff, so a second
// run is what drops it. The writer adds 20 messages in one fragment, so a
// word that is in one of them alone can be looked for in every file's bytes.
// First one of the 20 is removed, then four more.
async function erasure() {
  // A table of its own each run, since a warm writer keeps the last one open.
  const mailbox = `writes-erasure-${Date.now()}`;
  await writer({ op: "add", mailbox, run: "erasure", from: 0, count: 20, batchSize: 20 });
  const found = async (ids: string[]) => {
    const files: Record<string, string[]> = {};
    for (const id of ids) files[id] = await filesContaining(`tables/${mailbox}.lance/`, tokenOf(id));
    return files;
  };
  const removals = [];
  for (const ids of [["erasure-7"], ["erasure-8", "erasure-9", "erasure-10", "erasure-11"]]) {
    const before = await found(ids);
    await writer({ op: "remove", mailbox, ids, together: true });
    const afterRemoval = await found(ids);
    const maintenance = [];
    for (let run = 0; run < 2; run++) {
      const optimized = await writer({ op: "optimize", mailbox, keepVersionsMs: 0 });
      maintenance.push({ optimizeStats: optimized.result.optimizeStats, filesWithTheirWords: await found(ids) });
    }
    removals.push({ removed: ids, before, afterRemoval, maintenance });
  }
  const left = await writer({ op: "verify", mailbox, prefix: "erasure-" });
  await deleteObjects(`tables/${mailbox}.lance/`);
  return { removals, rowsLeft: left.result.rows.length };
}


interface Operation {
  ids?: string[];
  ms: number;
  requests: Requests;
  failures: string[];
  ok: boolean;
  embedMs?: number;
  inputTokens?: number;
  committedAt?: number;
  freshness?: { foundAfterMs?: number; searches: number; lastSearch?: { ms: number; requests: Requests } };
}

interface Row {
  id: string;
  labels: string[];
}

// A write's time and requests, and what a message costs in S3 requests and
// embedding at eu-north-1's prices. Lambda's time is in each invocation's
// report, since one invocation makes many writes.
function summarizeWrites(operations: Operation[], memoryMb = 1769) {
  if (operations.length === 0) return { operations: 0 };
  const messages = operations.reduce((n, o) => n + (o.ids?.length ?? 1), 0);
  const requests = summarizeRequests(operations.map((o) => o.requests));
  const total = (key: string) => operations.reduce((n, o) => n + (o.requests[key] ?? 0), 0);
  const tier1 = total("put") + total("put_part") + total("complete_multipart") + total("list");
  const tier2 = total("get") + total("head");
  const tokens = operations.reduce((n, o) => n + (o.inputTokens ?? 0), 0);
  const s3Usd = (tier1 / 1000) * prices.s3PutListPer1k + (tier2 / 1000) * prices.s3GetHeadPer1k;
  const embedUsd = (tokens / 1000) * prices.titanPer1kTokens;
  return {
    operations: operations.length,
    messages,
    failed: operations.filter((o) => !o.ok).length,
    retried: operations.filter((o) => o.failures.length > 0).length,
    // Puts S3 refused. With nothing else failing, each is a lost race for
    // the next version's manifest, which LanceDB retries inside the same
    // call. Its own count of attempts isn't exposed.
    failedPuts: total("putErrors"),
    operationsWithFailedPuts: operations.filter((o) => (o.requests.putErrors ?? 0) > 0).length,
    // The whole operation, embedding included, and the embedding alone.
    ms: summarize(operations.map((o) => o.ms)),
    embedMs: operations[0]?.embedMs === undefined ? undefined : summarize(operations.map((o) => o.embedMs!)),
    commitMs: operations[0]?.embedMs === undefined ? undefined : summarize(operations.map((o) => o.ms - o.embedMs!)),
    requestsPerOperation: requests,
    perMessage: {
      s3Requests: (tier1 + tier2) / messages,
      s3Usd: s3Usd / messages,
      inputTokens: tokens / messages,
      embedUsd: embedUsd / messages,
      // As if each operation were an invocation of its own, at the writer's
      // memory size, so warm: a cold one adds its init (see single's cold).
      lambdaUsd: (operations.reduce((n, o) => n + lambdaUsd(o.ms, memoryMb) + prices.lambdaRequest, 0)) / messages,
    },
  };
}

function mean(values: number[]) {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function lambdaUsd(ms: number, memoryMb: number) {
  return (ms / 1000) * (memoryMb / 1024) * prices.lambdaGbSecond;
}

// How long after each commit a search found its message, leaving out the
// ones it never found, which are counted.
function summarizeFreshness(operations: Operation[]) {
  const found = operations.flatMap((o) => (o.freshness?.foundAfterMs === undefined ? [] : [o.freshness]));
  return {
    notFound: operations.length - found.length,
    foundAfterMs: summarize(found.map((f) => f.foundAfterMs!)),
    searches: summarize(found.map((f) => f.searches)),
  };
}

function summarizeRequests(requests: Requests[]) {
  const keys = [...new Set(requests.flatMap((r) => Object.keys(r)))].sort();
  return Object.fromEntries(keys.map((key) => [key, summarize(requests.map((r) => r[key] ?? 0))]));
}

function summarize(values: number[]) {
  if (values.length === 0) return { n: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
  const round = (v: number) => Math.round(v * 10) / 10;
  return {
    n: values.length,
    min: round(sorted[0]!),
    p50: round(at(50)),
    p95: round(at(95)),
    max: round(sorted.at(-1)!),
    mean: round(values.reduce((a, b) => a + b, 0) / values.length),
  };
}

// The queries filter by no date, so one object is both a search module's
// query and a Lambda's event.
type DatelessQuery = Omit<SearchQuery, "filters"> & { filters?: Omit<SearchFilters, "date"> };

const notSpamOrTrash = { labels: { exclude: ["Spam", "Trash"] } };
const unindexedQueries: Record<string, DatelessQuery> = {
  keywordNotSpamOrTrash: { words: "pipeline capacity", filters: notSpamOrTrash, limit: 10 },
  keywordInInbox: { words: "pipeline capacity", filters: { labels: { include: ["Inbox"] } }, limit: 10 },
  keyword: { words: "pipeline capacity", limit: 10 },
  phraseNotSpamOrTrash: { phrase: "out of the office", filters: notSpamOrTrash, limit: 10 },
  vectorNotSpamOrTrash: { meaning: "travel plans for the conference", filters: notSpamOrTrash, limit: 10 },
  vectorInInbox: { meaning: "travel plans for the conference", filters: { labels: { include: ["Inbox"] } }, limit: 10 },
  hybridNotSpamOrTrash: { words: "contract", meaning: "a reminder to sign the contract", filters: notSpamOrTrash, limit: 10 },
};

// Searches like #17's, from the reader function, a warm environment of its
// own: the first search of each kind opens what it needs and is left out.
// Its vector and hybrid searches embed their query, which costs next to
// nothing.
const readerQueries: Record<string, DatelessQuery> = {
  keyword: unindexedQueries.keywordNotSpamOrTrash!,
  phrase: unindexedQueries.phraseNotSpamOrTrash!,
  filteredVector: unindexedQueries.vectorInInbox!,
  hybrid: unindexedQueries.hybridNotSpamOrTrash!,
};

async function readerLatency(mailbox: string) {
  const results: Record<string, unknown> = {};
  for (const [kind, query] of Object.entries(readerQueries)) {
    await reader({ mailbox, query });
    const searchMs = [];
    for (let i = 0; i < 20; i++) searchMs.push((await reader({ mailbox, query })).searchMs);
    results[kind] = summarize(searchMs);
  }
  return results;
}

async function searchUntilFound(mailbox: string, id: string) {
  const started = performance.now();
  const searches = [];
  for (let i = 0; i < 100; i++) {
    const answer = await reader({ mailbox, query: { words: tokenOf(id), limit: 5 } });
    searches.push(answer.searchMs);
    if (answer.hits.some((h) => h.messageId === id)) {
      return { foundAfterMs: performance.now() - started, searches: searches.length, searchMs: searches };
    }
  }
  return { foundAfterMs: undefined, searches: searches.length, searchMs: searches };
}

// Every id the writers wrote, each exactly once.
async function verify(mailbox: string, prefix: string, expected: number) {
  const rows: Row[] = (await writer({ op: "verify", mailbox, prefix })).result.rows;
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.id, (counts.get(row.id) ?? 0) + 1);
  const missing = Array.from({ length: expected }, (_, n) => `${prefix}${n}`).filter((id) => !counts.has(id));
  return { expected, found: counts.size, missing, duplicated: [...counts].filter(([, n]) => n > 1).map(([id]) => id) };
}

function sumVerified(verified: Awaited<ReturnType<typeof verify>>[]) {
  return {
    expected: verified.reduce((n, v) => n + v.expected, 0),
    found: verified.reduce((n, v) => n + v.found, 0),
    missing: verified.flatMap((v) => v.missing),
    duplicated: verified.flatMap((v) => v.duplicated),
  };
}

// Maintenance in a new environment of the given size, so its peak memory is
// its own.
// A run that fails, like one out of memory, is reported, not thrown.
async function optimizeIn(mailbox: string, memoryMb: number) {
  await setWriterMemory(memoryMb);
  try {
    const { result, report } = await writer({ op: "optimize", mailbox, keepVersionsMs: 0 });
    return { memoryMb, ...result, report, lambdaUsd: lambdaUsd(report.durationMs ?? 0, memoryMb) };
  } catch (error) {
    return { memoryMb, error: error instanceof Error ? error.message : String(error) };
  }
}

// Changing the configuration retires the function's warm environments.
async function setWriterMemory(memoryMb: number) {
  const config = await lambda.send(new GetFunctionConfigurationCommand({ FunctionName: writerFunction }));
  await lambda.send(
    new UpdateFunctionConfigurationCommand({
      FunctionName: writerFunction,
      MemorySize: memoryMb,
      Environment: { Variables: { ...config.Environment?.Variables, NEW_ENVIRONMENT: randomUUID() } },
    }),
  );
  await waitUntilFunctionUpdatedV2({ client: lambda, maxWaitTime: 300 }, { FunctionName: writerFunction });
}

// What each operation returns is in src/writes-lambda.ts.
async function writer(event: WritesEvent): Promise<{ result: any; report: InvocationReport }> {
  return invoke(writerFunction, event);
}

async function reader(event: SearchEvent): Promise<{ hits: SearchHit[]; searchMs: number }> {
  return (await invoke(readerFunction, event)).result;
}

interface InvocationReport {
  durationMs?: number;
  initMs?: number;
  maxMemoryMb?: number;
  memoryMb?: number;
  roundTripMs: number;
}

async function invoke(functionName: string, event: unknown) {
  const started = performance.now();
  const response = await lambda.send(new InvokeCommand({ FunctionName: functionName, LogType: "Tail", Payload: JSON.stringify(event) }));
  const roundTripMs = performance.now() - started;
  const result = JSON.parse(Buffer.from(response.Payload ?? []).toString("utf8"));
  if (response.FunctionError) throw new Error(`${functionName} failed: ${JSON.stringify(result)}`);
  const log = Buffer.from(response.LogResult ?? "", "base64").toString("utf8");
  const reported = (label: string) => {
    const match = log.match(new RegExp(`${label}: ([\\d.]+)`));
    return match ? Number(match[1]) : undefined;
  };
  const report: InvocationReport = {
    durationMs: reported("\\tDuration"),
    initMs: reported("Init Duration"),
    maxMemoryMb: reported("Max Memory Used"),
    memoryMb: reported("Memory Size"),
    roundTripMs,
  };
  return { result, report };
}

// --- S3 ------------------------------------------------------------------

// A copy of the benchmark table under another name. A table's files refer
// to each other by relative paths, so copying every object copies the table.
async function copyBenchmark(name: string) {
  if (!name.startsWith("writes-")) throw new Error("The writes measurement only writes to writes-* tables.");
  await deleteObjects(`tables/${name}.lance/`);
  const source = `tables/${benchmark}.lance/`;
  const keys = await listKeys(source);
  const started = performance.now();
  let next = 0;
  await Promise.all(
    // Eight at a time, to keep the load light while #17 measures.
    Array.from({ length: 8 }, async () => {
      while (next < keys.length) {
        const key = keys[next++]!;
        await s3.send(
          new CopyObjectCommand({ Bucket: bucket, CopySource: `${bucket}/${key}`, Key: `tables/${name}.lance/${key.slice(source.length)}` }),
        );
      }
    }),
  );
  return { table: name, objects: keys.length, ms: performance.now() - started };
}

async function listKeys(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
    keys.push(...(page.Contents ?? []).map((o) => o.Key!));
    token = page.NextContinuationToken;
  } while (token);
  return keys;
}

async function deleteObjects(prefix: string): Promise<number> {
  const keys = await listKeys(prefix);
  for (let i = 0; i < keys.length; i += 1000) {
    await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys.slice(i, i + 1000).map((Key) => ({ Key })) } }));
  }
  return keys.length;
}

async function filesContaining(prefix: string, word: string): Promise<string[]> {
  const files = [];
  for (const key of await listKeys(prefix)) {
    const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const bytes = Buffer.from(await object.Body!.transformToByteArray());
    if (bytes.includes(word)) files.push(key.slice(prefix.length));
  }
  return files;
}


const steps: Record<string, () => Promise<unknown>> = {
  single,
  batches,
  unindexed,
  labels,
  concurrent,
  "during-maintenance": duringMaintenance,
  maintenance,
  erasure,
};

async function runStep(name: string) {
  const startedAt = new Date().toISOString();
  const result = await steps[name]!();
  const results = existsSync(resultsFile) ? JSON.parse(readFileSync(resultsFile, "utf8")) : {};
  results.lancedbVersion = JSON.parse(readFileSync(join(root, "node_modules/@lancedb/lancedb/package.json"), "utf8")).version;
  results.region = region;
  results.prices = prices;
  results[name] = { startedAt, endedAt: new Date().toISOString(), ...(result as object) };
  writeFileSync(resultsFile, JSON.stringify(results, null, 2) + "\n");
  return { step: name, startedAt, endedAt: results[name].endedAt };
}

const commands: Record<string, () => Promise<unknown>> = {
  up,
  down,
  all: async () => {
    const done = [];
    for (const name of Object.keys(steps)) done.push(await runStep(name));
    return done;
  },
  ...Object.fromEntries(Object.keys(steps).map((name) => [name, () => runStep(name)])),
};

const command = commands[process.argv[2] ?? ""];
if (!command) {
  console.error(`Usage: node harness/writes.ts ${Object.keys(commands).join("|")}`);
  process.exit(1);
}
console.log(JSON.stringify(await command(), null, 2));
