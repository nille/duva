// LanceDB behind the search module: one table per mailbox, named by its ID, in a directory on local
// disk or under an S3 prefix. Commits on S3 rely on its conditional writes, so there is no
// external commit store. The search spike (#2) measured what is set here.
import * as lancedb from "@lancedb/lancedb";
import { Bool, Field, List, Schema, TimestampMillisecond, Utf8 } from "apache-arrow";
import type { components } from "@duva/openapi";
import type { IndexedMessage, IndexedThread, IndexWriter, SearchEngine, SearchFilters, SearchHit, Search, SearchTerm } from "./search-engine.ts";

export interface LanceSearchOptions {
  /** A local directory, or s3://bucket/prefix. */
  uri: string;
  /** Passed to LanceDB's object store, like the region for S3. */
  storageOptions?: Record<string, string>;
  /** Holds the index and metadata caches, which a Lambda sizes to its memory. */
  session?: lancedb.Session;
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
]);

type Language = "English" | "Swedish";

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
        return new LanceWriter(table);
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
    search: (mailbox, asked) => reading(mailbox, [], (table) => search(table, asked)),
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

  constructor(table: lancedb.Table) {
    this.table = table;
  }

  async put(messages: IndexedMessage[]): Promise<void> {
    if (messages.length === 0) return;
    await this.table.mergeInsert("id").whenMatchedUpdateAll().whenNotMatchedInsertAll().execute(messages.map(row));
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
  }

  // A deleted row stays in its data file until compaction rewrites the file, which LanceDB does
  // only past 10% of its rows deleted, and never for a file its indexes cover while newer ones
  // aren't. So every row is written again, unchanged, which leaves no row in the old files, and the
  // full-text indexes, which hold words, are built again from the rows there are. Pruning then takes
  // every version before, the files only they have, and those a failed write left. The one writer
  // is this one, so no other write can be in progress.
  async compact(): Promise<void> {
    await this.table.update({ where: "true", valuesSql: { unread: "unread" } });
    for (const [column, index] of indexes) if (searchedColumns.includes(column)) await this.table.createIndex(column, { config: index(), replace: true });
    await this.table.optimize({ cleanupOlderThan: new Date(), deleteUnverified: true });
  }
}

async function search(table: lancedb.Table, { terms, filters, sort, limit }: Search): Promise<SearchHit[]> {
  const where = predicate(filters);
  const matching = fullTextQuery(terms);
  let query = table.query();
  if (matching === undefined) {
    query = query.orderBy({ columnName: "received", ascending: false, nullsFirst: false });
  } else {
    query = query.fullTextSearch(matching);
  }
  if (where !== undefined) query = query.where(where);
  query = query.select(["id", "thread", "received", ...(matching === undefined ? [] : ["_score"])]);
  // A full-text search takes the best before it sorts, so newest first picks from many of them.
  query = query.limit(matching !== undefined && sort === "newest" ? Math.max(limit, newestPool) : limit);
  const rows: { id: string; thread: string; received: number | Date; _score?: number }[] = await query.toArray();
  const hits = rows.map((row) => ({ message: row.id, thread: row.thread, score: row._score ?? 0, receivedAt: new Date(row.received) }));
  if (matching !== undefined && sort === "newest") hits.sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime());
  return hits.slice(0, limit);
}

function fullTextQuery(terms: SearchTerm[]): lancedb.FullTextQuery | undefined {
  const must = terms.map((term) => {
    const columns = term.in === "subject" ? subjectColumns : searchedColumns;
    if (!term.phrase) return new lancedb.MultiMatchQuery(term.text, columns, { operator: lancedb.Operator.And });
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
  if (include?.length) clauses.push(`array_has_all(labels, ${list(include)})`);
  if (exclude?.length) clauses.push(`NOT array_has_any(labels, ${list(exclude)})`);
  if (filters.unread !== undefined) clauses.push(`unread = ${filters.unread}`);
  if (filters.hasAttachment !== undefined) clauses.push(`has_attachment = ${filters.hasAttachment}`);
  if (filters.received?.from) clauses.push(`received >= ${timestamp(filters.received.from)}`);
  if (filters.received?.to) clauses.push(`received < ${timestamp(filters.received.to)}`);
  if (filters.threads?.include) clauses.push(filters.threads.include.length === 0 ? "false" : `thread IN ${set(filters.threads.include)}`);
  if (filters.threads?.exclude?.length) clauses.push(`thread NOT IN ${set(filters.threads.exclude)}`);
  return clauses.length > 0 ? clauses.join(" AND ") : undefined;
}

function row(message: IndexedMessage) {
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
  };
}

// Swedish when its most common words outnumber English's. Mail is English unless it is clearly
// Swedish, so the English stemmer is the default. Short Swedish mail without any of these words is
// stemmed as English.
const swedishWords = new Set("och att det är som för på med en ett av till den har inte jag du vi om så kan från hej vill ska här".split(" "));
const englishWords = new Set("the and to of is that for on with it you we this be are have not from at by your will".split(" "));

/** The language the message is indexed in. */
export function messageLanguage(message: Pick<IndexedMessage, "subject" | "text">): Language {
  let swedish = 0;
  let english = 0;
  for (const word of `${message.subject} ${message.text}`.toLowerCase().split(/[^\p{L}]+/u)) {
    if (swedishWords.has(word)) swedish++;
    else if (englishWords.has(word)) english++;
  }
  return swedish > english ? "Swedish" : "English";
}

const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
const set = (values: string[]) => `(${values.map(literal).join(", ")})`;
const list = (values: string[]) => `make_array(${values.map(literal).join(", ")})`;
const timestamp = (date: Date) => `TIMESTAMP ${literal(date.toISOString().replace("Z", ""))}`;
