// LanceDB behind the search module: one table per mailbox, named by its ID, in a directory on local
// disk or under an S3 prefix. Commits on S3 rely on its conditional writes, so there is no
// external commit store. The search spike (#2) measured what is set here, and #62 tuned the vector
// index (see vectorIndex).
import * as lancedb from "@lancedb/lancedb";
import { Bool, Field, FixedSizeList, Float32, List, Schema, TimestampMillisecond, Utf8 } from "apache-arrow";
import type { components } from "@duva/openapi";
import type { IndexedMessage, IndexedThread, IndexWriter, SearchEngine, SearchFilters, SearchHit, Search, SearchTerm } from "./search-engine.ts";
import { definiteForms, type Language, messageLanguage } from "./swedish.ts";
import { type Embedder, embeddingDimensions } from "./titan.ts";

export interface LanceSearchOptions {
  /** A local directory, or s3://bucket/prefix. */
  uri: string;
  /** Passed to LanceDB's object store, like the region for S3. */
  storageOptions?: Record<string, string>;
  /** Holds the index and metadata caches, which a Lambda sizes to its memory. */
  session?: lancedb.Session;
  /** Embeds each message as it is written, and each search's words. */
  embedder: Embedder;
  /** How many messages a mailbox has before maintenance builds its vector index. */
  vectorIndexFrom?: number;
}

// A full-text index stems for one language, so each message's subject and text go to the columns
// of the language it is written in, and the other language's stay empty. A word searches all of
// them, and each column stems it its own way, so "fakturor" finds "fakturan" next to "invoices"
// finding "invoice". Names, addresses and attachment names are matched as written, without stemming.
const subjectColumns = ["subject_en", "subject_sv"];
const searchedColumns = [...subjectColumns, "text_en", "text_sv", "people", "attachments"];

const schema = new Schema([
  new Field("id", new Utf8(), false),
  new Field("thread", new Utf8(), false),
  new Field("received", new TimestampMillisecond(), false),
  // The sender and the recipients in lower case, each as "name <address>", for from: and to:.
  new Field("sender", new Utf8(), false),
  new Field("recipients", new Utf8(), false),
  new Field("people", new Utf8(), false),
  new Field("attachments", new Utf8(), false),
  new Field("has_attachment", new Bool(), false),
  new Field("labels", new List(new Field("item", new Utf8(), true)), false),
  new Field("unread", new Bool(), false),
  new Field("subject_en", new Utf8(), false),
  new Field("text_en", new Utf8(), false),
  new Field("subject_sv", new Utf8(), false),
  new Field("text_sv", new Utf8(), false),
  // What the message means, from its subject and the start of its text.
  new Field("vector", new FixedSizeList(embeddingDimensions, new Field("item", new Float32(), true)), false),
]);

// Positions make phrase queries possible, and stop words stay so that a phrase like "out of office"
// keeps its every word. The language must be written as LanceDB's enum spells it: in 0.39.0 any
// other spelling, "english" included, panics in native code and aborts the process
// (lancedb/lancedb#4367). Swedish keeps å, ä and ö, which are letters of their own there: folding
// them would make "får" (gets) and "far" (father) one word. An Index can be used once.
const fullText = (language: Language, stem = true) => () =>
  lancedb.Index.fts({ withPosition: true, removeStopWords: false, stem, language, lowercase: true, asciiFolding: language === "English" });

const indexes: [column: string, index: () => lancedb.Index][] = [
  ["subject_en", fullText("English")],
  ["text_en", fullText("English")],
  ["subject_sv", fullText("Swedish")],
  ["text_sv", fullText("Swedish")],
  ["people", fullText("English", false)],
  ["attachments", fullText("English", false)],
  ["id", lancedb.Index.btree],
  ["thread", lancedb.Index.btree],
  ["received", lancedb.Index.btree],
  ["has_attachment", lancedb.Index.bitmap],
  ["unread", lancedb.Index.bitmap],
  ["labels", lancedb.Index.labelList],
];

/** How many of the best matches a search sorted by newest picks the newest from. */
const newestPool = 10_000;

/** How long old versions are kept, so a search still reading one finds its files. */
const versionsKept = 5 * 60 * 1000;

/** How much of a message's text its vector is made from, after its subject, as the spike embedded it. */
const embeddedTextLength = 2_000;

/** What a message's vector is made from. Titan refuses an empty text. */
const embeddedText = ({ subject, text }: IndexedMessage) => `${subject}\n\n${text.slice(0, embeddedTextLength)}`.trim() || "(empty)";

/**
 * How many messages a search finds by meaning at most, the nearest first, and how far their meaning
 * may be from the search's, in cosine distance. Without a limit a search would find every message
 * by meaning, however unlike. Titan's distances are near: on the spike's 100k mailbox (#62), #19's
 * questions were a median 0.59 from the message each asks about and 0.91 from the median message,
 * and in the behavior suite's fixture "when should I see someone about my teeth" is 0.73 from the
 * dentist's reminder, its nearest.
 */
const meaningPool = 20;
const furthestMeaning = 0.8;

/** Reciprocal rank fusion's k, as LanceDB's own RRF has it. */
const fusionK = 60;

// The vector index (ADR-0007), tuned in #62 with the spike's `node harness/recall.ts` on its 100k
// mailbox's Titan vectors (results/62-recall.json): over #19's 300 questions and #17's 15
// meanings, the share of a flat scan's top 20 in the index's top 20. Leaving out Spam and Trash, or
// keeping a label 1.8% of the mail has, moved none by more than 0.04.
//
//   IVF_PQ at LanceDB's defaults                          0.50, built in 47 s
//   IVF_PQ, refine factor 10                              0.87
//   IVF_PQ with 256 subvectors, refine factor 2           0.97, built in 294 s
//   IVF_HNSW_SQ, ef 100                                   0.95, but 0 for some queries
//   IVF_RQ, refine factor 5                               0.98, built in 0.8 s
//
// Probing 40 partitions instead of 20 changed none of them by more than 0.01, so the loss is in the
// quantization, which refining from the full vectors makes up. IVF_RQ keeps a bit per dimension, and
// a search refines its 20 from the nearest 100. Below vectorIndexFrom messages, comparing every
// vector is exact and quick, and the index trains on the vectors there are, so it waits for enough.
// Rows written since maintenance last ran are compared one by one beside it.
const vectorIndexFrom = 1_000;
const vectorIndex = () => lancedb.Index.ivfRq({ distanceType: "cosine" });
const refineFactor = 5;

export function lanceSearch(options: LanceSearchOptions): SearchEngine {
  const connection = lancedb.connect(options.uri, {
    storageOptions: options.storageOptions,
    // Zero means every read checks for the writer's new commits.
    readConsistencyInterval: 0,
    session: options.session,
  });
  // A warm Lambda keeps each table it has opened, to search or to write.
  const opened = new Map<string, Promise<lancedb.Table>>();
  const writers = new Map<string, Promise<IndexWriter>>();
  const open = async (mailbox: string): Promise<lancedb.Table | undefined> => {
    const cached = opened.get(mailbox);
    if (cached !== undefined) return cached;
    const db = await connection;
    if (!(await db.tableNames()).includes(mailbox)) return undefined;
    const table = db.openTable(mailbox);
    opened.set(mailbox, table);
    table.catch(() => opened.delete(mailbox));
    return table;
  };
  // A table dropped and made again since it was opened fails, and so does a version that compaction
  // pruned while it was read, so a read that fails opens the table again and reads once more.
  const reading = async <T>(mailbox: string, none: T, read: (table: lancedb.Table) => Promise<T>): Promise<T> => {
    const table = await open(mailbox);
    if (table === undefined) return none;
    try {
      return await read(table);
    } catch {
      opened.delete(mailbox);
      const again = await open(mailbox);
      return again === undefined ? none : read(again);
    }
  };
  return {
    writer(mailbox) {
      const cached = writers.get(mailbox);
      if (cached !== undefined) return cached;
      const writer = (async () => {
        const db = await connection;
        const table = await db.createEmptyTable(mailbox, schema, { existOk: true });
        const existing = new Set((await table.listIndices()).flatMap((index) => index.columns));
        for (const [column, index] of indexes) if (!existing.has(column)) await table.createIndex(column, { config: index() });
        return new LanceWriter(table, options.embedder, options.vectorIndexFrom ?? vectorIndexFrom);
      })();
      writers.set(mailbox, writer);
      writer.catch(() => writers.delete(mailbox));
      return writer;
    },
    async drop(mailbox) {
      opened.delete(mailbox);
      writers.delete(mailbox);
      const db = await connection;
      if ((await db.tableNames()).includes(mailbox)) await db.dropTable(mailbox);
    },
    search: (mailbox, asked) => reading(mailbox, [], (table) => search(table, options.embedder, asked)),
    async texts(mailbox, messages) {
      if (messages.length === 0) return new Map();
      const rows: { id: string; text_en: string; text_sv: string }[] = await reading(mailbox, [], (table) =>
        table
          .query()
          .where(`id IN ${set(messages)}`)
          .select(["id", "text_en", "text_sv"])
          .toArray(),
      );
      return new Map(rows.map((row) => [row.id, row.text_en || row.text_sv]));
    },
  };
}

class LanceWriter implements IndexWriter {
  private readonly table: lancedb.Table;
  private readonly embedder: Embedder;
  private readonly vectorIndexFrom: number;

  constructor(table: lancedb.Table, embedder: Embedder, vectorIndexFrom: number) {
    this.table = table;
    this.embedder = embedder;
    this.vectorIndexFrom = vectorIndexFrom;
  }

  async put(messages: IndexedMessage[]): Promise<void> {
    if (messages.length === 0) return;
    const vectors = await this.embedder.embed(messages.map(embeddedText));
    await this.table
      .mergeInsert("id")
      .whenMatchedUpdateAll()
      .whenNotMatchedInsertAll()
      .execute(messages.map((message, at) => row(message, vectors[at]!)));
  }

  // Threads with the same labels and read state change in one update. Values as SQL, since LanceDB
  // can't turn an empty list into one.
  async relabel(threads: IndexedThread[]): Promise<void> {
    const alike = new Map<string, IndexedThread[]>();
    for (const thread of threads) {
      const key = JSON.stringify([thread.labels, thread.unread]);
      alike.set(key, [...(alike.get(key) ?? []), thread]);
    }
    for (const group of alike.values()) {
      const [{ labels, unread }] = group as [IndexedThread];
      await this.table.update({ where: `thread IN ${set(group.map(({ id }) => id))}`, valuesSql: { labels: list(labels), unread: String(unread) } });
    }
  }

  async removeThreads(threads: string[]): Promise<void> {
    if (threads.length === 0) return;
    await this.table.delete(`thread IN ${set(threads)}`);
  }

  async maintain(): Promise<void> {
    await this.table.optimize({ cleanupOlderThan: new Date(Date.now() - versionsKept) });
    // IVF trains its partitions on the vectors there are, so it trains again as the mailbox doubles.
    const trained = await this.vectorIndex();
    const rows = await this.table.countRows();
    if (rows >= this.vectorIndexFrom && (trained === undefined || rows >= 2 * trained.rows)) await this.indexVectors(rows, trained);
  }

  // A deleted row stays in its data file until compaction rewrites the file, which LanceDB does
  // only past 10% of its rows deleted, and never for a file its indexes cover while newer ones
  // aren't. So every row is written again, unchanged, which leaves no row in the old files, and the
  // full-text indexes, which hold words, are built again from the rows there are. So is the vector
  // index, since a message's vector counts as its text, and optimize() would keep the old one's
  // files, with every removed message's codes, beside a new part for the rows written again. On
  // the spike's 100k Titan vectors, on local disk, IVF_RQ builds in 0.9 s on 16 cores, and in 5.8 s
  // at about 600 MB on one, as the indexer has (#62). Below
  // vectorIndexFrom messages it is dropped. Pruning then takes every version before, the files only
  // they have, and those a failed write left. The one writer is this one, so no other write can be
  // in progress.
  async compact(): Promise<void> {
    await this.table.update({ where: "true", valuesSql: { unread: "unread" } });
    for (const [column, index] of indexes) if (searchedColumns.includes(column)) await this.table.createIndex(column, { config: index(), replace: true });
    const trained = await this.vectorIndex();
    const rows = await this.table.countRows();
    if (rows >= this.vectorIndexFrom) await this.indexVectors(rows, trained);
    else if (trained !== undefined) await this.table.dropIndex(trained.name);
    await this.table.optimize({ cleanupOlderThan: new Date(), deleteUnverified: true });
  }

  /** The vector index, if there is one, and how many messages it was trained on, which its name says. */
  private async vectorIndex(): Promise<{ name: string; rows: number } | undefined> {
    const index = (await this.table.listIndices()).find(({ columns }) => columns.includes("vector"));
    return index === undefined ? undefined : { name: index.name, rows: Number(/^vector_(\d+)$/.exec(index.name)?.[1] ?? 0) };
  }

  /** Trains a vector index on the rows there are, then drops the one before it, so searches always have one. */
  private async indexVectors(rows: number, before: { name: string } | undefined): Promise<void> {
    const name = `vector_${rows}`;
    await this.table.createIndex("vector", { config: vectorIndex(), name, replace: true });
    if (before !== undefined && before.name !== name) await this.table.dropIndex(before.name);
  }
}

async function search(table: lancedb.Table, embedder: Embedder, { terms, filters, sort, limit }: Search): Promise<SearchHit[]> {
  const where = predicate(filters);
  const matching = fullTextQuery(terms);
  const filtered = <Q extends lancedb.Query | lancedb.VectorQuery>(query: Q): Q => (where === undefined ? query : (query.where(where) as Q));
  if (matching === undefined) {
    const query = table.query().orderBy({ columnName: "received", ascending: false, nullsFirst: false }).select(columns).limit(limit);
    return hitsOf(await filtered(query).toArray());
  }
  // A full-text search takes the best before it sorts, so newest first picks from many of them.
  const pool = sort === "newest" ? Math.max(limit, newestPool) : limit;
  const byWords = filtered(table.query().fullTextSearch(matching).select([...columns, "_score"]).limit(pool)).toArray();
  // A phrase or subject: must hold in every message found, so the words alone find them.
  if (terms.some((term) => term.phrase || term.in === "subject")) return ordered(sort, hitsOf(await byWords), limit);
  const byMeaning = embedder.embed([terms.map(({ text }) => text).join(" ")]).then(([meaning]) =>
    filtered(
      table
        .query()
        .nearestTo(meaning!)
        .column("vector")
        .distanceType("cosine")
        .refineFactor(refineFactor)
        .select([...columns, "_distance"])
        .limit(Math.min(limit, meaningPool)),
    ).toArray(),
  );
  // LanceDB 0.39.0 applies a distance range to the index's rough distances, before refining, which
  // loses near messages, so the far are left out here.
  const [words, nearest] = await Promise.all([byWords, byMeaning]);
  const meanings = (nearest as Row[]).filter((row) => row._distance! <= furthestMeaning);
  if (sort === "newest") return ordered(sort, [...new Map([...hitsOf(words), ...hitsOf(meanings)].map((hit) => [hit.message, hit])).values()], limit);
  return fused(hitsOf(words), hitsOf(meanings)).slice(0, limit);
}

const columns = ["id", "thread", "received"];

interface Row {
  id: string;
  thread: string;
  received: number | Date;
  _score?: number;
  _distance?: number;
}

/** The rows as hits, in their order, scored so that higher ranks higher. */
const hitsOf = (rows: Row[]): SearchHit[] =>
  rows.map((row) => ({
    message: row.id,
    thread: row.thread,
    score: row._score ?? (row._distance === undefined ? 0 : 1 - row._distance),
    receivedAt: new Date(row.received),
  }));

/** The hits in the search's order, at most its limit. */
const ordered = (sort: Search["sort"], hits: SearchHit[], limit: number) =>
  (sort === "newest" ? [...hits].sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime()) : hits).slice(0, limit);

/**
 * Reciprocal rank fusion of the best by words and the best by meaning: each message scores one
 * over k plus its rank in each, so one both rank high comes first, and one only its meaning finds
 * can still come before words found further down.
 *
 * It runs here because LanceDB 0.39.0's hybrid search scales each side's distances and scores to
 * between 0 and 1 before its reranker sees them, so a reranker can't leave out the far meanings,
 * and a hybrid search whose distance range leaves no rows fails. The two searches run at once,
 * as LanceDB runs a hybrid search's.
 */
function fused(...rankings: SearchHit[][]): SearchHit[] {
  const scores = new Map<string, SearchHit>();
  for (const ranking of rankings) {
    ranking.forEach((hit, rank) => {
      const found = scores.get(hit.message) ?? { ...hit, score: 0 };
      found.score += 1 / (fusionK + rank + 1);
      scores.set(hit.message, found);
    });
  }
  return [...scores.values()].sort((a, b) => b.score - a.score);
}

function fullTextQuery(terms: SearchTerm[]): lancedb.FullTextQuery | undefined {
  const must = terms.map((term) => {
    const columns = term.in === "subject" ? subjectColumns : searchedColumns;
    if (!term.phrase) {
      const word = new lancedb.MultiMatchQuery(term.text, columns, { operator: lancedb.Operator.And });
      const others = definiteForms(term.text).map((form) => new lancedb.MultiMatchQuery(form, columns.filter((column) => column.endsWith("_sv"))));
      return others.length === 0 ? word : new lancedb.BooleanQuery([word, ...others].map((query) => [lancedb.Occur.Should, query]));
    }
    return new lancedb.BooleanQuery(columns.map((column) => [lancedb.Occur.Should, new lancedb.PhraseQuery(term.text, column)]));
  });
  if (must.length <= 1) return must[0];
  return new lancedb.BooleanQuery(must.map((query) => [lancedb.Occur.Must, query]));
}

function predicate(filters: SearchFilters): string | undefined {
  const clauses: string[] = [];
  for (const part of filters.from ?? []) clauses.push(`strpos(sender, ${literal(part.toLowerCase())}) > 0`);
  for (const part of filters.to ?? []) clauses.push(`strpos(recipients, ${literal(part.toLowerCase())}) > 0`);
  const { include, exclude } = filters.labels ?? {};
  const state: string[] = [];
  if (include?.length) state.push(`array_has_all(labels, ${list(include)})`);
  if (exclude?.length) state.push(`NOT array_has_any(labels, ${list(exclude)})`);
  if (filters.unread !== undefined) state.push(`unread = ${filters.unread}`);
  if (state.length > 0) clauses.push(filters.threads?.exempt?.length ? `(${state.join(" AND ")} OR thread IN ${set(filters.threads.exempt)})` : state.join(" AND "));
  if (filters.hasAttachment !== undefined) clauses.push(`has_attachment = ${filters.hasAttachment}`);
  if (filters.received?.from) clauses.push(`received >= ${timestamp(filters.received.from)}`);
  if (filters.received?.to) clauses.push(`received < ${timestamp(filters.received.to)}`);
  if (filters.threads?.include) clauses.push(filters.threads.include.length === 0 ? "false" : `thread IN ${set(filters.threads.include)}`);
  if (filters.threads?.exclude?.length) clauses.push(`thread NOT IN ${set(filters.threads.exclude)}`);
  return clauses.length > 0 ? clauses.join(" AND ") : undefined;
}

function row(message: IndexedMessage, vector: Float32Array) {
  const swedish = messageLanguage(message) === "Swedish";
  const person = ({ name, address }: components["schemas"]["EmailAddress"]) => (name === undefined ? address : `${name} <${address}>`);
  return {
    id: message.id,
    thread: message.thread,
    received: message.receivedAt,
    sender: person(message.from).toLowerCase(),
    recipients: message.recipients.map(person).join("\n").toLowerCase(),
    people: [message.from, ...message.recipients].map(person).join("\n"),
    attachments: message.attachments.join("\n"),
    has_attachment: message.hasAttachment,
    labels: message.labels,
    unread: message.unread,
    subject_en: swedish ? "" : message.subject,
    text_en: swedish ? "" : message.text,
    subject_sv: swedish ? message.subject : "",
    text_sv: swedish ? message.text : "",
    vector: Array.from(vector),
  };
}

const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
const set = (values: string[]) => `(${values.map(literal).join(", ")})`;
const list = (values: string[]) => `make_array(${values.map(literal).join(", ")})`;
const timestamp = (date: Date) => `TIMESTAMP ${literal(date.toISOString().replace("Z", ""))}`;
