// LanceDB behind the search module: one table per mailbox, in a directory on
// local disk or under an S3 prefix. Commits on S3 rely on its conditional
// writes, so there is no external commit store (no s3+ddb:// URI).
import * as lancedb from "@lancedb/lancedb";
import { Bool, Field, List, Schema, TimestampMillisecond, Utf8 } from "apache-arrow";
import type { MailboxSearch, Message, SearchEngine, SearchFilters, SearchHit, SearchQuery } from "./search.ts";

export interface LanceSearchOptions {
  // A local directory, or s3://bucket/prefix.
  uri: string;
  // Passed to LanceDB's object store, like region and credentials for S3.
  storageOptions?: Record<string, string>;
}

const schema = new Schema([
  new Field("id", new Utf8(), false),
  new Field("thread", new Utf8(), false),
  new Field("sender", new Utf8(), false),
  new Field("recipients", new List(new Field("item", new Utf8(), true)), false),
  new Field("subject", new Utf8(), false),
  new Field("date", new TimestampMillisecond(), false),
  new Field("labels", new List(new Field("item", new Utf8(), true)), false),
  new Field("has_attachment", new Bool(), false),
  new Field("text", new Utf8(), false),
]);

const textColumns = ["subject", "text"];

// Positions make phrase queries possible, and stop words stay so that a phrase
// like "out of office" keeps its every word. The language must be written as
// LanceDB's enum spells it: in 0.39.0 any other spelling, "english" included,
// panics in native code and aborts the process (lancedb/lancedb#4367).
// An Index can be used once, so each table gets new ones.
const fullTextIndex = () =>
  lancedb.Index.fts({
    withPosition: true,
    removeStopWords: false,
    stem: true,
    language: "English",
    lowercase: true,
    asciiFolding: true,
  });

const indexes: [column: string, index: () => lancedb.Index][] = [
  ["subject", fullTextIndex],
  ["text", fullTextIndex],
  ["date", lancedb.Index.btree],
  ["sender", lancedb.Index.btree],
  ["has_attachment", lancedb.Index.bitmap],
  ["labels", lancedb.Index.labelList],
];

export function lanceSearch(options: LanceSearchOptions): SearchEngine {
  const connection = lancedb.connect(options.uri, {
    storageOptions: options.storageOptions,
    // Zero means every read checks for other writers' commits.
    readConsistencyInterval: 0,
  });
  return {
    async mailbox(mailboxId) {
      const db = await connection;
      const table = await db.createEmptyTable(mailboxId, schema, { existOk: true });
      return new LanceMailbox(table);
    },
  };
}

class LanceMailbox implements MailboxSearch {
  private readonly table: lancedb.Table;

  constructor(table: lancedb.Table) {
    this.table = table;
  }

  async add(messages: Message[]): Promise<void> {
    if (messages.length === 0) return;
    await this.table.add(messages.map(row));
    await this.createMissingIndexes();
  }

  async remove(messageIds: string[]): Promise<void> {
    if (messageIds.length === 0) return;
    await this.table.delete(`id IN (${messageIds.map(literal).join(", ")})`);
  }

  async changeLabels(messageId: string, labels: string[]): Promise<void> {
    await this.table.update({ where: `id = ${literal(messageId)}`, values: { labels } });
  }

  async search(query: SearchQuery): Promise<SearchHit[]> {
    if (query.meaning !== undefined) throw new Error("Search by meaning isn't built yet.");
    const terms = fullTextQuery(query);
    if (!terms) throw new Error("A search needs words, a phrase or a meaning.");
    let search = this.table.query().fullTextSearch(terms).select(["id", "_score"]).limit(query.limit);
    const where = predicate(query.filters);
    if (where) search = search.where(where);
    const rows = await search.toArray();
    return rows.map((r: { id: string; _score: number }) => ({ messageId: r.id, score: r._score }));
  }

  // Rows added after an index was built are still searched, by a flat scan,
  // until optimize() adds them to it.
  private async createMissingIndexes(): Promise<void> {
    const existing = new Set((await this.table.listIndices()).flatMap((i) => i.columns));
    for (const [column, config] of indexes) {
      if (!existing.has(column)) await this.table.createIndex(column, { config: config() });
    }
  }
}

function row(message: Message) {
  return {
    id: message.id,
    thread: message.thread,
    sender: message.sender,
    recipients: message.recipients,
    subject: message.subject,
    date: message.date,
    labels: message.labels,
    has_attachment: message.hasAttachment,
    text: message.text,
  };
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
