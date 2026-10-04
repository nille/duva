// The latency benchmark (#17): every query type, cold, warm-first and warm,
// at three memory sizes, in both packages, against the benchmark mailbox.
//
// Each package's function reads its own copy of the mailbox, which S3 counts
// requests to, so both packages run at once and S3 requests per query come
// from S3 itself. S3 reports requests per minute, so each combination runs in
// minutes of its own, and nothing else touches the copy then.
import { CloudWatchClient, GetMetricDataCommand } from "@aws-sdk/client-cloudwatch";
import {
  GetFunctionConfigurationCommand,
  InvokeCommand,
  LambdaClient,
  UpdateFunctionConfigurationCommand,
  waitUntilFunctionUpdatedV2,
} from "@aws-sdk/client-lambda";
import { CopyObjectCommand, DeleteObjectsCommand, HeadObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import type { SearchEvent } from "../src/lambda.ts";
import { queryTypes, type QueryType } from "./queries.ts";

const region = "eu-north-1";
const lambda = new LambdaClient({ region });
const s3 = new S3Client({ region });
const cloudWatch = new CloudWatchClient({ region });

const packages = {
  "x64-zip": "duva-search-spike-latency-x64-zip",
  "arm64-image": "duva-search-spike-latency-arm64-image",
} as const;
type PackageName = keyof typeof packages;

// One vCPU, two, and the most Lambda gives, six.
const memorySizes = [1769, 3538, 10240];
const coldPerType = 30;
// Cold environments start this many at a time.
const coldAtOnce = 10;
const warmPerType = 100;

// The spec's targets for p95, in milliseconds.
const targets = {
  warm: { keyword: 300, phrase: 500, vector: 500, "vector-flat": 500, hybrid: 800, "hybrid-flat": 800 },
  cold: 3_000,
};

type Condition = "cold" | "warm-first" | "warm";

interface Sample {
  query: number;
  // Inside the Lambda: from the handler receiving the query to it returning
  // ranked hits, plus the environment's init when it is cold.
  latencyMs: number;
  searchMs: number;
  initMs?: number;
  roundTripMs: number;
  maxMemoryMb?: number;
  cachedBytes: number;
  firstOnMailbox: boolean;
  hits: string[];
}

interface Combination {
  package: PackageName;
  memoryMb: number;
  type: QueryType;
  condition: Condition;
  window: { from: number; to: number };
  samples: Sample[];
  // Samples that didn't run in the condition asked for, left out.
  excluded: number;
  // Invocations that failed, with their errors.
  failed: string[];
}

type Outcome = Sample | { error: string };

export async function latency(bucket: string) {
  const startedAt = new Date().toISOString();
  const combinations = (
    await Promise.all(
      (Object.keys(packages) as PackageName[]).map(async (name) => {
        const copied = Date.now();
        const copy = await copyMailbox(bucket, name);
        await requestMetricsLive(bucket, name, copied);
        const done: Combination[] = [];
        for (const memoryMb of memorySizes) done.push(...(await measurePackage(name, memoryMb, copy)));
        await configure(packages[name], memorySizes[0]!);
        return done;
      }),
    )
  ).flat();
  const requests = await s3Requests(bucket, combinations);
  return report(startedAt, combinations, requests);
}

// A query on the fixture mailbox, which warms an environment without
// touching the benchmark mailbox.
const fixtureQuery: SearchEvent = { mailbox: "fixture", query: { words: "kayak", limit: 1 } };

async function measurePackage(name: PackageName, memoryMb: number, mailbox: string): Promise<Combination[]> {
  const functionName = packages[name];
  const done: Combination[] = [];
  const types = Object.keys(queryTypes) as QueryType[];
  await configure(functionName, memoryMb);
  // An image's first start after its deploy takes many times longer, while
  // Lambda readies it, so one start goes unmeasured.
  await invokeEvent(functionName, fixtureQuery);

  // Cold: each environment's first query is the one measured.
  await nextMinute();
  for (const type of types) {
    done.push(
      await combination(name, memoryMb, type, "cold", async () => {
        const samples = [];
        for (let round = 0; round < coldPerType / coldAtOnce; round++) {
          await configure(functionName, memoryMb);
          const queries = Array.from({ length: coldAtOnce }, (_, i) => round * coldAtOnce + i);
          samples.push(...(await Promise.all(queries.map((q) => invoke(functionName, mailbox, type, q)))));
        }
        return samples;
      }),
    );
  }

  // Warm-first: one warm environment, which forgets every mailbox before each
  // query, so each query opens the mailbox anew.
  await configure(functionName, memoryMb);
  await invokeEvent(functionName, fixtureQuery);
  await nextMinute();
  for (const type of types) {
    done.push(
      await combination(name, memoryMb, type, "warm-first", async () => {
        const samples = [];
        for (let q = 0; q < warmPerType; q++) samples.push(await invoke(functionName, mailbox, type, q, { forgetMailboxes: true }));
        return samples;
      }),
    );
  }

  // Warm: the same environment, with the mailbox open in both engines,
  // before any measured query. The measured queries cycle through the set.
  await invoke(functionName, mailbox, "keyword", 0, { forgetMailboxes: true });
  await invoke(functionName, mailbox, "vector-flat", 0);
  await nextMinute();
  for (const type of types) {
    done.push(
      await combination(name, memoryMb, type, "warm", async () => {
        const samples = [];
        for (let q = 0; q < warmPerType; q++) samples.push(await invoke(functionName, mailbox, type, q));
        return samples;
      }),
    );
  }
  return done;
}

// Runs from a minute's start to the next minute's start after it ends, so
// S3's per-minute request counts in its window are its own.
async function combination(
  name: PackageName,
  memoryMb: number,
  type: QueryType,
  condition: Condition,
  run: () => Promise<Outcome[]>,
): Promise<Combination> {
  const from = Date.now();
  const outcomes = await run();
  const to = await nextMinute();
  const failed = outcomes.flatMap((o) => ("error" in o ? [o.error] : []));
  const all = outcomes.filter((o): o is Sample => !("error" in o));
  // A warm sample from an environment Lambda started meanwhile is cold.
  const valid = (s: Sample) =>
    condition === "cold" ? s.initMs !== undefined : s.initMs === undefined && s.firstOnMailbox === (condition === "warm-first");
  const samples = all.filter(valid);
  console.error(`${name} ${memoryMb} MB ${type} ${condition}: ${samples.length} samples, p95 ${percentile(samples.map((s) => s.latencyMs), 95).toFixed(0)} ms`);
  return {
    package: name,
    memoryMb,
    type,
    condition,
    window: { from: Math.floor(from / 60_000) * 60_000, to },
    samples,
    excluded: all.length - samples.length,
    failed,
  };
}

async function nextMinute(): Promise<number> {
  const next = (Math.floor(Date.now() / 60_000) + 1) * 60_000;
  await new Promise((resolve) => setTimeout(resolve, next - Date.now() + 50));
  return next;
}

// A memory size, and a change to the configuration, which retires the
// function's environments so the next invocations start new ones.
async function configure(functionName: string, memoryMb: number) {
  const config = await lambda.send(new GetFunctionConfigurationCommand({ FunctionName: functionName }));
  const variables = { ...config.Environment?.Variables, COLD_START: crypto.randomUUID() };
  await lambda.send(
    new UpdateFunctionConfigurationCommand({ FunctionName: functionName, MemorySize: memoryMb, Environment: { Variables: variables } }),
  );
  await waitUntilFunctionUpdatedV2({ client: lambda, maxWaitTime: 300 }, { FunctionName: functionName });
}

// A failed invocation is counted, so one can't end a run of hours.
async function invoke(functionName: string, mailbox: string, type: QueryType, query: number, options: Partial<SearchEvent> = {}): Promise<Outcome> {
  const { queries, flatVectorSearch } = queryTypes[type];
  const index = query % queries.length;
  try {
    const result = await invokeEvent(functionName, { mailbox, flatVectorSearch, query: queries[index]!, ...options });
    return { query: index, ...result, latencyMs: result.searchMs + (result.initMs ?? 0) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

async function invokeEvent(functionName: string, event: SearchEvent) {
  const started = performance.now();
  const response = await lambda.send(new InvokeCommand({ FunctionName: functionName, LogType: "Tail", Payload: JSON.stringify(event) }));
  const roundTripMs = performance.now() - started;
  const payload = JSON.parse(Buffer.from(response.Payload ?? []).toString("utf8"));
  if (response.FunctionError) throw new Error(`${functionName} failed: ${JSON.stringify(payload)}`);
  const log = Buffer.from(response.LogResult ?? "", "base64").toString("utf8");
  const reported = (label: string) => {
    const match = log.match(new RegExp(`${label}: ([\\d.]+)`));
    return match ? Number(match[1]) : undefined;
  };
  return {
    hits: (payload.hits as { messageId: string }[]).map((h) => h.messageId),
    searchMs: payload.searchMs as number,
    firstOnMailbox: payload.firstOnMailbox as boolean,
    cachedBytes: payload.cachedBytes as number,
    initMs: reported("Init Duration"),
    maxMemoryMb: reported("Max Memory Used"),
    roundTripMs,
  };
}

// A copy of the benchmark mailbox for one package's function, made anew on
// every run. A table's files refer to each other by relative paths, so a
// copy of its objects is the same table under another name.
async function copyMailbox(bucket: string, name: PackageName): Promise<string> {
  const mailbox = `latency-${name}`;
  const target = `tables/${mailbox}.lance/`;
  const source = "tables/benchmark.lance/";
  for (const keys = await list(bucket, target); keys.length; keys.splice(0, 1000)) {
    await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys.slice(0, 1000).map((Key) => ({ Key })) } }));
  }
  const keys = await list(bucket, source);
  const copyOne = async () => {
    for (let key = keys.pop(); key; key = keys.pop()) {
      await s3.send(new CopyObjectCommand({ Bucket: bucket, Key: target + key.slice(source.length), CopySource: `${bucket}/${key}` }));
    }
  };
  await Promise.all(Array.from({ length: 16 }, copyOne));
  return mailbox;
}

async function list(bucket: string, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
    keys.push(...(page.Contents ?? []).map((o) => o.Key!));
    token = page.NextContinuationToken;
  } while (token);
  return keys;
}

// S3 starts counting a few minutes after request metrics are turned on, and
// up to 15 the first time. So this asks for one of the copy's objects each
// minute until S3 has counted a request.
async function requestMetricsLive(bucket: string, name: PackageName, since: number) {
  const [key] = await list(bucket, `tables/latency-${name}.lance/_versions/`);
  if (!key) throw new Error(`The ${name} copy of the benchmark mailbox has no versions.`);
  for (let attempt = 0; attempt < 30; attempt++) {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    const counts = await requestCounts(bucket, [name], since, Date.now() + 60_000);
    if (counts.get(`${name} AllRequests`)?.size) return;
    await new Promise((resolve) => setTimeout(resolve, 60_000));
  }
  throw new Error(`S3 hasn't counted any request to the ${name} copy in 30 minutes.`);
}

const requestMetrics = ["AllRequests", "GetRequests", "HeadRequests", "ListRequests", "PutRequests"] as const;
type Requests = Record<(typeof requestMetrics)[number], number>;

// S3's request counts per minute for each package's copy, summed over each
// combination's window. S3 publishes them a few minutes late, so this waits
// until each package's last minute has its count, or ten minutes at most,
// since a last minute may have had no requests.
export async function s3Requests(bucket: string, combinations: Pick<Combination, "package" | "window">[]): Promise<Requests[]> {
  const names = [...new Set(combinations.map((c) => c.package))];
  const from = Math.min(...combinations.map((c) => c.window.from));
  const to = Math.max(...combinations.map((c) => c.window.to));
  const lastMinute = (name: PackageName) => Math.max(...combinations.filter((c) => c.package === name).map((c) => c.window.to)) - 60_000;
  let counts = await requestCounts(bucket, names, from, to);
  while (Date.now() < to + 10 * 60_000) {
    if (names.every((name) => [...(counts.get(`${name} AllRequests`)?.keys() ?? [])].some((t) => t >= lastMinute(name)))) break;
    await new Promise((resolve) => setTimeout(resolve, 60_000));
    counts = await requestCounts(bucket, names, from, to);
  }
  return combinations.map((c) =>
    Object.fromEntries(
      requestMetrics.map((metric) => {
        let sum = 0;
        for (const [t, v] of counts.get(`${c.package} ${metric}`) ?? []) if (t >= c.window.from && t < c.window.to) sum += v;
        return [metric, sum];
      }),
    ) as Requests,
  );
}

// Per minute, keyed by package and metric: "x64-zip GetRequests".
async function requestCounts(bucket: string, names: PackageName[], from: number, to: number) {
  const counts = new Map<string, Map<number, number>>();
  let token: string | undefined;
  do {
    const page = await cloudWatch.send(
      new GetMetricDataCommand({
        StartTime: new Date(from),
        EndTime: new Date(to),
        NextToken: token,
        MetricDataQueries: names.flatMap((name, p) =>
          requestMetrics.map((metric, m) => ({
            Id: `m${p}_${m}`,
            Label: `${name} ${metric}`,
            MetricStat: {
              Metric: {
                Namespace: "AWS/S3",
                MetricName: metric,
                Dimensions: [
                  { Name: "BucketName", Value: bucket },
                  { Name: "FilterId", Value: `latency-${name}` },
                ],
              },
              Period: 60,
              Stat: "Sum",
            },
          })),
        ),
      }),
    );
    for (const result of page.MetricDataResults ?? []) {
      const perMinute = counts.get(result.Label!) ?? new Map<number, number>();
      counts.set(result.Label!, perMinute);
      result.Timestamps?.forEach((t, i) => perMinute.set(t.getTime(), result.Values![i]!));
    }
    token = page.NextToken;
  } while (token);
  return counts;
}

function percentile(values: number[], p: number): number {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

const spread = (values: number[]) => ({ p50: percentile(values, 50), p95: percentile(values, 95), p99: percentile(values, 99) });
const round = (n: number | undefined) => (n === undefined ? undefined : Math.round(n * 10) / 10);

function report(startedAt: string, combinations: Combination[], requests: Requests[]) {
  const results = combinations.map((c, i) => {
    const p95 = percentile(c.samples.map((s) => s.latencyMs), 95);
    const target = c.condition === "cold" ? targets.cold : c.condition === "warm" ? targets.warm[c.type] : undefined;
    return {
      package: c.package,
      memoryMb: c.memoryMb,
      type: c.type,
      condition: c.condition,
      queries: c.samples.length,
      excluded: c.excluded,
      failed: c.failed,
      latencyMs: spread(c.samples.map((s) => s.latencyMs)),
      ...(c.condition === "cold" ? { initMs: spread(c.samples.map((s) => s.initMs!)), searchMs: spread(c.samples.map((s) => s.searchMs)) } : {}),
      roundTripMs: spread(c.samples.map((s) => s.roundTripMs)),
      target: target && { p95Ms: target, met: p95 < target },
      // Excluded and failed queries hit S3 too, so they count.
      s3RequestsPerQuery: requests[i]!.AllRequests / (c.samples.length + c.excluded + c.failed.length),
      s3Requests: requests[i],
      maxMemoryMb: Math.max(...c.samples.map((s) => s.maxMemoryMb ?? 0)),
      cachedMb: Math.max(...c.samples.map((s) => s.cachedBytes)) / 2 ** 20,
      queriesWithoutHits: c.samples.filter((s) => s.hits.length === 0).length,
      window: { from: new Date(c.window.from).toISOString(), to: new Date(c.window.to).toISOString() },
      samples: c.samples.map((s) => ({ query: s.query, latencyMs: round(s.latencyMs), initMs: round(s.initMs), roundTripMs: round(s.roundTripMs), hits: s.hits.length })),
    };
  });
  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    region,
    readConsistencyIntervalSeconds: 0,
    caches: "index cache a quarter of the function's memory, metadata cache a sixteenth",
    querySet: Object.fromEntries(Object.entries(queryTypes).map(([type, t]) => [type, t.queries])),
    recall: recallAgainstFlat(combinations),
    results,
  };
}

// What the vector index gives up: for each vector and hybrid query, the share
// of the flat scan's hits that the index also found, from warm queries.
function recallAgainstFlat(combinations: Combination[]) {
  const hitsOf = (type: QueryType) => {
    const hits = new Map<number, string[]>();
    for (const c of combinations.filter((c) => c.type === type && c.condition === "warm")) {
      for (const s of c.samples) if (!hits.has(s.query)) hits.set(s.query, s.hits);
    }
    return hits;
  };
  return Object.fromEntries(
    (["vector", "hybrid"] as const).map((type) => {
      const indexed = hitsOf(type);
      const flat = hitsOf(`${type}-flat`);
      const perQuery = [...flat].map(([query, exact]) => {
        const found = new Set(indexed.get(query) ?? []);
        return { query, recall: exact.length ? exact.filter((id) => found.has(id)).length / exact.length : 1 };
      });
      const mean = perQuery.reduce((sum, q) => sum + q.recall, 0) / Math.max(perQuery.length, 1);
      return [type, { meanRecall: mean, perQuery }];
    }),
  );
}
