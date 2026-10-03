// The writes Lambda (#18): adds, relabels and removes messages in a mailbox
// through the search module, and runs LanceDB's maintenance on its table. It
// reports how long each operation took and the S3 requests it made, so the
// harness can count the cost of each and whether any message went missing.
// The tables live under SEARCH_URI.
import * as lancedb from "@lancedb/lancedb";
import { lanceSearch } from "./lancedb-search.ts";
import { generatedMessage, tokenOf } from "./generated-mail.ts";
import type { MailboxSearch, Message, SearchQuery } from "./search.ts";
import { titanEmbedder, type Embedder } from "./titan.ts";

export type WritesEvent =
  // Messages run-from to run-(from+count-1), added in batches of batchSize.
  // With a reader, a second connection searches for each batch's last message
  // after its commit until it finds it.
  | { op: "add"; mailbox: string; run: string; from: number; count: number; batchSize: number; reader?: boolean }
  | { op: "changeLabels"; mailbox: string; ids: string[]; labels: string[] }
  // One message per removal, or all of them in one.
  | { op: "remove"; mailbox: string; ids: string[]; together: boolean }
  // Compaction, index updates and version pruning, which LanceDB runs as one.
  | { op: "optimize"; mailbox: string; keepVersionsMs: number }
  // The rows whose id starts with the prefix, with their labels.
  | { op: "verify"; mailbox: string; prefix: string }
  | { op: "stats"; mailbox: string }
  // A search from the reader's connection, repeated, with each one's time and
  // requests. Dates aren't carried, since the measurement doesn't filter by them.
  | { op: "search"; mailbox: string; query: SearchQuery; times: number };

const uri = process.env.SEARCH_URI;
if (!uri) throw new Error("Set SEARCH_URI to the tables' location.");
const storageOptions = { region: process.env.AWS_REGION ?? "eu-north-1" };

// LanceDB counts its object store requests once a metrics recorder is
// installed. It exports them through OpenTelemetry, and this provider only
// keeps the callbacks, to read the counters when asked.
type Observer = (result: { observe(value: number, attributes?: Record<string, string>): void }) => void;
const callbacks = new Map<string, Observer>();
const instrument = (name: string) => ({ addCallback: (callback: Observer) => void callbacks.set(name, callback) });
lancedb.instrumentLanceDbMetrics({
  getMeter: () => ({ createObservableCounter: instrument, createObservableGauge: instrument }),
} as unknown as Parameters<typeof lancedb.instrumentLanceDbMetrics>[0]);

// Requests by operation (get, put, head, list, delete), and the ones that
// failed, as putErrors and so on. A failed put is usually a lost commit race:
// LanceDB writes each version's manifest only if it doesn't exist yet.
export type Requests = Record<string, number>;

function requestCounts(): Requests {
  const counts: Requests = {};
  const read = (metric: string, suffix: string) =>
    callbacks.get(metric)?.({
      observe(value, attributes) {
        const key = `${attributes?.operation ?? "other"}${suffix}`;
        counts[key] = (counts[key] ?? 0) + value;
      },
    });
  read("lance_object_store_requests_total", "");
  read("lance_object_store_errors_total", "Errors");
  return counts;
}

async function counted<T>(work: () => Promise<T>): Promise<{ value: T; ms: number; requests: Requests }> {
  const before = requestCounts();
  const started = performance.now();
  const value = await work();
  const ms = performance.now() - started;
  const after = requestCounts();
  const requests: Requests = {};
  for (const [key, count] of Object.entries(after)) {
    if (count - (before[key] ?? 0) > 0) requests[key] = count - (before[key] ?? 0);
  }
  return { value, ms, requests };
}

// An operation that fails is retried, as a queue would redeliver it, and
// every failure is kept.
const attempts = 5;

async function retried<T>(work: () => Promise<T>): Promise<{ value?: T; failures: string[] }> {
  const failures: string[] = [];
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return { value: await work(), failures };
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
      await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
    }
  }
  return { failures };
}

// Embedding is timed apart from the commit, and its tokens counted.
const titan = titanEmbedder();
let embedMs = 0;
const embedder = {
  dimensions: titan.dimensions,
  async embed(texts: string[]) {
    const started = performance.now();
    try {
      return await titan.embed(texts);
    } finally {
      embedMs += performance.now() - started;
    }
  },
};

// A warm environment keeps each mailbox it has opened. The reader has a
// connection of its own, as another Lambda would.
function opener(engineEmbedder: Embedder) {
  const engine = lanceSearch({ uri: uri!, storageOptions, embedder: engineEmbedder });
  const opened = new Map<string, Promise<MailboxSearch>>();
  return (mailbox: string) => {
    if (!opened.has(mailbox)) opened.set(mailbox, engine.mailbox(mailbox));
    return opened.get(mailbox)!;
  };
}
const writer = opener(embedder);
const reader = opener(titanEmbedder());

async function table(mailbox: string): Promise<lancedb.Table> {
  const db = await lancedb.connect(uri!, { storageOptions, readConsistencyInterval: 0 });
  return db.openTable(mailbox);
}

export async function handler(event: WritesEvent) {
  const started = Date.now();
  const result = await run(event);
  return { startedAt: started, endedAt: Date.now(), ...result };
}

async function run(event: WritesEvent) {
  switch (event.op) {
    case "add":
      return add(event);
    case "changeLabels": {
      const mailbox = await writer(event.mailbox);
      const operations = [];
      for (const id of event.ids) {
        operations.push({ id, ...(await countedRetried(() => mailbox.changeLabels(id, event.labels))) });
      }
      return { operations };
    }
    case "remove": {
      const mailbox = await writer(event.mailbox);
      const groups = event.together ? [event.ids] : event.ids.map((id) => [id]);
      const operations = [];
      for (const ids of groups) operations.push({ ids, ...(await countedRetried(() => mailbox.remove(ids))) });
      return { operations };
    }
    case "optimize": {
      const t = await table(event.mailbox);
      const before = await tableStats(t);
      const { value, ms, requests } = await counted(() =>
        retried(() => t.optimize({ cleanupOlderThan: new Date(Date.now() - event.keepVersionsMs) })),
      );
      return { ms, requests, failures: value.failures, optimizeStats: value.value, before, after: await tableStats(t) };
    }
    case "verify": {
      const t = await table(event.mailbox);
      const rows: { id: string; labels: string[] }[] = await t
        .query()
        .where(`id LIKE '${event.prefix.replaceAll("'", "''")}%'`)
        .select(["id", "labels"])
        .toArray();
      return { rows: rows.map((r) => ({ id: r.id, labels: [...r.labels] })) };
    }
    case "stats":
      return tableStats(await table(event.mailbox));
    case "search": {
      const search = await reader(event.mailbox);
      const searches = [];
      for (let i = 0; i < event.times; i++) {
        const { value: hits, ms, requests } = await counted(() => search.search(event.query));
        searches.push({ ms, requests, hits: hits.length });
      }
      return { searches };
    }
  }
}

async function countedRetried(work: () => Promise<void>) {
  const { value, ms, requests } = await counted(() => retried(work));
  return { ms, requests, failures: value.failures, ok: value.failures.length < attempts };
}

// Opening the mailbox is timed apart, since an environment that inbound mail
// starts cold opens it before its first write.
async function add(event: Extract<WritesEvent, { op: "add" }>) {
  const { value: mailbox, ms: openMs, requests: openRequests } = await counted(() => writer(event.mailbox));
  const search = event.reader ? await reader(event.mailbox) : undefined;
  // The reader's first query opens the table, so it is warm before the
  // first commit it waits for.
  if (search) await search.search({ words: "warm", limit: 1 });
  const operations = [];
  for (let start = 0; start < event.count; start += event.batchSize) {
    const batch = Array.from({ length: Math.min(event.batchSize, event.count - start) }, (_, i) =>
      generatedMessage(event.run, event.from + start + i),
    );
    const tokensBefore = titan.usage.inputTokens;
    embedMs = 0;
    const write = await countedRetried(() => mailbox.add(batch));
    const operation = {
      ids: batch.map((m) => m.id),
      ...write,
      embedMs,
      inputTokens: titan.usage.inputTokens - tokensBefore,
      committedAt: Date.now(),
      freshness: search && write.ok ? await freshness(search, batch.at(-1)!) : undefined,
    };
    operations.push(operation);
  }
  return { open: { ms: openMs, requests: openRequests }, operations };
}

// Searches for the message's token until it comes back, and reports how long
// that took after the commit and how many searches it needed.
async function freshness(search: MailboxSearch, message: Message) {
  const committed = performance.now();
  const queries = [];
  for (let i = 0; i < 600; i++) {
    const { value: hits, ms, requests } = await counted(() => search.search({ words: tokenOf(message.id), limit: 5 }));
    queries.push({ ms, requests });
    if (hits.some((h) => h.messageId === message.id)) {
      return { foundAfterMs: performance.now() - committed, searches: queries.length, lastSearch: queries.at(-1) };
    }
  }
  return { foundAfterMs: undefined, searches: queries.length };
}

async function tableStats(t: lancedb.Table) {
  await t.checkoutLatest();
  const indexes = [];
  for (const index of await t.listIndices()) {
    const stats = await t.indexStats(index.name);
    indexes.push({ name: index.name, indexedRows: stats?.numIndexedRows, unindexedRows: stats?.numUnindexedRows });
  }
  const stats = await t.stats();
  return {
    version: await t.version(),
    versions: (await t.listVersions()).length,
    rows: stats.numRows,
    fragments: stats.fragmentStats.numFragments,
    smallFragments: stats.fragmentStats.numSmallFragments,
    indexes,
  };
}
