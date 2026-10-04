// LanceDB behind the search module: one table per mailbox, in a directory on
// local disk or under an S3 prefix. Commits on S3 rely on its conditional
// writes, so there is no external commit store (no s3+ddb:// URI).
import * as lancedb from "@lancedb/lancedb";
import { Bool, Field, FixedSizeList, Float32, List, Schema, TimestampMillisecond, Utf8 } from "apache-arrow";
import type { MailboxSearch, Message, SearchEngine, SearchFilters, SearchHit, SearchQuery } from "./search.ts";
import { titanEmbedder, type Embedder } from "./titan.ts";

export interface LanceSearchOptions {
  // A local directory, or s3://bucket/prefix.
  uri: string;
  // Passed to LanceDB's object store, like region and credentials for S3.
  storageOptions?: Record<string, string>;
  // Titan Text Embeddings V2 at 1,024 dimensions unless the harness passes
  // its own, to count what embedding costs.
  embedder?: Embedder;
  // Vector queries compare the query with every vector instead of using the
  // vector index, to measure one against the other.
  flatVectorSearch?: boolean;
  // Holds the index and metadata caches. LanceDB's own defaults are 6 GB and
  // 1 GB, more than a Lambda has, so a Lambda sizes them to its memory.
  session?: lancedb.Session;
}

// A full-text index stems for one language, so each message's subject and
// text go to the columns of the language it is written in, and the other
// language's columns stay empty. A query searches all four, and each column
// stems the query its own way, so "fakturor" finds "fakturan" next to
// "invoices" finding "invoice".
const textColumns = ["subject_en", "text_en", "subject_sv", "text_sv"];

function schema(dimensions: number) {
  const strings = () => new List(new Field("item", new Utf8(), true));
  return new Schema([
    new Field("id", new Utf8(), false),
    new Field("thread", new Utf8(), false),
    new Field("sender", new Utf8(), false),
    new Field("recipients", strings(), false),
    new Field("date", new TimestampMillisecond(), false),
    new Field("labels", strings(), false),
    new Field("has_attachment", new Bool(), false),
    ...textColumns.map((column) => new Field(column, new Utf8(), false)),
    new Field("vector", new FixedSizeList(dimensions, new Field("item", new Float32(), true)), false),
  ]);
}

// Positions make phrase queries possible, and stop words stay so that a phrase
// like "out of office" keeps its every word. The language must be written as
// LanceDB's enum spells it: in 0.39.0 any other spelling, "english" included,
// panics in native code and aborts the process (lancedb/lancedb#4367).
// Swedish keeps å, ä and ö, which are letters of their own there: folding
// them would make "får" (gets) and "far" (father) one word.
// An Index can be used once, so each table gets new ones.
const fullTextIndex = (language: Language) => () =>
  lancedb.Index.fts({
    withPosition: true,
    removeStopWords: false,
    stem: true,
    language,
    lowercase: true,
    asciiFolding: language === "English",
  });

const indexes: [column: string, index: () => lancedb.Index][] = [
  ["subject_en", fullTextIndex("English")],
  ["text_en", fullTextIndex("English")],
  ["subject_sv", fullTextIndex("Swedish")],
  ["text_sv", fullTextIndex("Swedish")],
  ["date", lancedb.Index.btree],
  ["sender", lancedb.Index.btree],
  ["has_attachment", lancedb.Index.bitmap],
  ["labels", lancedb.Index.labelList],
];

// IVF_PQ trains on the table's vectors, so it waits until there are enough of
// them. Until then, and for rows added since it was built, vector queries
// compare every vector, which is exact.
const vectorIndexMinRows = 10_000;
const vectorIndex = () => lancedb.Index.ivfPq({ distanceType: "cosine" });

// One vector per message, from its subject and the start of its body. Titan
// refuses an empty text, so a message with neither embeds as a placeholder.
const embeddedTextLength = 2_000;
const embeddingText = (m: Message) => `${m.subject}\n\n${m.text.slice(0, embeddedTextLength)}`.trim() || "(empty)";

// Embedding a batch and writing it, so a large add holds a batch of vectors
// in memory at a time.
const batchSize = 2_000;

// RRF with LanceDB's default k of 60.
const reranker = lancedb.rerankers.RRFReranker.create();

export function lanceSearch(options: LanceSearchOptions): SearchEngine {
  const connection = lancedb.connect(options.uri, {
    storageOptions: options.storageOptions,
    // Zero means every read checks for other writers' commits.
    readConsistencyInterval: 0,
    session: options.session,
  });
  const embedder = options.embedder ?? titanEmbedder();
  return {
    async mailbox(mailboxId) {
      const db = await connection;
      const table = await db.createEmptyTable(mailboxId, schema(embedder.dimensions), { existOk: true });
      return new LanceMailbox(table, embedder, options.flatVectorSearch ?? false);
    },
  };
}

class LanceMailbox implements MailboxSearch {
  private readonly table: lancedb.Table;
  private readonly embedder: Embedder;
  private readonly flatVectorSearch: boolean;

  constructor(table: lancedb.Table, embedder: Embedder, flatVectorSearch: boolean) {
    this.table = table;
    this.embedder = embedder;
    this.flatVectorSearch = flatVectorSearch;
  }

  async add(messages: Message[]): Promise<void> {
    if (messages.length === 0) return;
    for (let start = 0; start < messages.length; start += batchSize) {
      const batch = messages.slice(start, start + batchSize);
      const vectors = await this.embedder.embed(batch.map(embeddingText));
      await this.table.add(batch.map((m, i) => row(m, vectors[i]!)));
    }
    await this.createMissingIndexes();
  }

  async remove(messageIds: string[]): Promise<void> {
    if (messageIds.length === 0) return;
    await this.table.delete(`id IN (${messageIds.map(literal).join(", ")})`);
  }

  async changeLabels(messageId: string, labels: string[]): Promise<void> {
    await this.table.update({ where: `id = ${literal(messageId)}`, values: { labels } });
  }

  // Words or a phrase alone search the full-text index, and a meaning alone
  // the vectors. Both together are a hybrid search: each finds its best
  // messages and RRF merges the two rankings. Filters apply before each.
  async search(query: SearchQuery): Promise<SearchHit[]> {
    const terms = fullTextQuery(query);
    const meaning = query.meaning?.trim();
    if (!terms && !meaning) throw new Error("A search needs words, a phrase or a meaning.");
    const where = predicate(query.filters);
    let search: lancedb.Query | lancedb.VectorQuery = this.table.query();
    if (terms) search = search.fullTextSearch(terms);
    if (meaning) {
      const [vector] = await this.embedder.embed([meaning]);
      let vectorSearch = search.nearestTo(vector!).column("vector").distanceType("cosine");
      if (this.flatVectorSearch) vectorSearch = vectorSearch.bypassVectorIndex();
      if (terms) vectorSearch = vectorSearch.rerank(await reranker);
      search = vectorSearch;
    }
    // Naming the score column keeps LanceDB from warning that it adds it
    // unasked. A hybrid search runs two queries under one selection, so
    // naming either one's score fails the other.
    const scores = terms && meaning ? [] : [terms ? "_score" : "_distance"];
    search = search.select(["id", ...scores]).limit(query.limit);
    if (where) search = search.where(where);
    const rows: ({ id: string } & Scores)[] = await search.toArray();
    return rows.map((r) => ({ messageId: r.id, score: score(r) }));
  }

  // Rows added after an index was built are still searched, by a flat scan,
  // until optimize() adds them to it.
  private async createMissingIndexes(): Promise<void> {
    const existing = new Set((await this.table.listIndices()).flatMap((i) => i.columns));
    for (const [column, config] of indexes) {
      if (!existing.has(column)) await this.table.createIndex(column, { config: config() });
    }
    if (!existing.has("vector") && (await this.table.countRows()) >= vectorIndexMinRows) {
      await this.table.createIndex("vector", { config: vectorIndex() });
    }
  }
}

// What each mode scores by: BM25 for words, cosine distance for a meaning,
// and RRF's merged score for both.
interface Scores {
  _score?: number;
  _distance?: number;
  _relevance_score?: number;
}

// Higher is better in every mode.
function score(r: Scores): number {
  if (r._relevance_score !== undefined) return r._relevance_score;
  if (r._distance !== undefined) return 1 - r._distance;
  return r._score!;
}

function row(message: Message, vector: Float32Array) {
  const swedish = messageLanguage(message) === "Swedish";
  return {
    id: message.id,
    thread: message.thread,
    sender: message.sender,
    recipients: message.recipients,
    date: message.date,
    labels: message.labels,
    has_attachment: message.hasAttachment,
    subject_en: swedish ? "" : message.subject,
    text_en: swedish ? "" : message.text,
    subject_sv: swedish ? message.subject : "",
    text_sv: swedish ? message.text : "",
    vector: Array.from(vector),
  };
}

// Swedish when its most common words outnumber English's. Mail is English
// unless it is clearly Swedish, so the English stemmer is the default. Short
// Swedish mail without any of these words is stemmed as English.
const swedishWords = new Set("och att det är som för på med en ett av till den har inte jag du vi om så kan från hej vill ska här".split(" "));
const englishWords = new Set("the and to of is that for on with it you we this be are have not from at by your will".split(" "));

type Language = "English" | "Swedish";

export function messageLanguage(message: Pick<Message, "subject" | "text">): Language {
  let swedish = 0;
  let english = 0;
  for (const word of `${message.subject} ${message.text}`.toLowerCase().split(/[^\p{L}]+/u)) {
    if (swedishWords.has(word)) swedish++;
    else if (englishWords.has(word)) english++;
  }
  return swedish > english ? "Swedish" : "English";
}

function fullTextQuery(query: SearchQuery): lancedb.FullTextQuery | undefined {
  const must: lancedb.FullTextQuery[] = [];
  for (const word of query.words?.split(/\s+/).filter(Boolean) ?? []) {
    must.push(new lancedb.MultiMatchQuery(word, textColumns));
  }
  if (query.phrase?.trim()) {
    const phrase = query.phrase.trim();
    must.push(
      new lancedb.BooleanQuery(
        textColumns.map((column) => [lancedb.Occur.Should, new lancedb.PhraseQuery(phrase, column)]),
      ),
    );
  }
  if (must.length <= 1) return must[0];
  return new lancedb.BooleanQuery(must.map((q) => [lancedb.Occur.Must, q]));
}

function predicate(filters: SearchFilters | undefined): string | undefined {
  if (!filters) return undefined;
  const clauses: string[] = [];
  const { include, exclude } = filters.labels ?? {};
  if (include?.length) clauses.push(`array_has_all(labels, ${list(include)})`);
  if (exclude?.length) clauses.push(`NOT array_has_any(labels, ${list(exclude)})`);
  if (filters.sender !== undefined) clauses.push(`sender = ${literal(filters.sender)}`);
  if (filters.date?.from) clauses.push(`date >= ${timestamp(filters.date.from)}`);
  if (filters.date?.to) clauses.push(`date < ${timestamp(filters.date.to)}`);
  if (filters.hasAttachment !== undefined) clauses.push(`has_attachment = ${filters.hasAttachment}`);
  return clauses.length ? clauses.join(" AND ") : undefined;
}

function literal(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function list(values: string[]): string {
  return `make_array(${values.map(literal).join(", ")})`;
}

function timestamp(date: Date): string {
  return `TIMESTAMP ${literal(date.toISOString().replace("Z", ""))}`;
}
