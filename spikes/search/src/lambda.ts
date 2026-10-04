// The spike's Lambda: answers one search on one mailbox, and says how long the
// search took inside the handler, whether it was this environment's first on
// the mailbox, and how much its caches hold. The table lives under SEARCH_URI.
import { Session } from "@lancedb/lancedb";
import { lanceSearch } from "./lancedb-search.ts";
import type { MailboxSearch, SearchFilters, SearchQuery } from "./search.ts";
import { titanEmbedder } from "./titan.ts";

// The query as JSON carries it, with dates as ISO strings.
export interface SearchEvent {
  mailbox: string;
  // Vector queries compare every vector instead of using the vector index.
  flatVectorSearch?: boolean;
  // Starts over with empty caches and no open mailboxes, as if this warm
  // environment had never searched this mailbox.
  forgetMailboxes?: boolean;
  query: Omit<SearchQuery, "filters"> & {
    filters?: Omit<SearchFilters, "date"> & { date?: { from?: string; to?: string } };
  };
}

if (!process.env.SEARCH_URI) throw new Error("Set SEARCH_URI to the tables' location.");
const uri = process.env.SEARCH_URI;
const storageOptions = { region: process.env.AWS_REGION ?? "eu-north-1" };

// A quarter of the function's memory for the index cache and a sixteenth for
// the metadata cache, which leaves room for a flat scan's vectors.
const memoryBytes = BigInt(process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE ?? "1769") * 1024n * 1024n;
const cacheBytes = { index: memoryBytes / 4n, metadata: memoryBytes / 16n };

// Both engines share one session, so their caches are one. Forgetting the
// mailboxes keeps the embedder and its connections to Bedrock.
const embedder = titanEmbedder();
function engines() {
  const session = new Session(cacheBytes.index, cacheBytes.metadata);
  return {
    session,
    indexed: lanceSearch({ uri, storageOptions, session, embedder }),
    flat: lanceSearch({ uri, storageOptions, session, embedder, flatVectorSearch: true }),
  };
}

let engine = engines();
// A warm environment keeps each mailbox it has opened.
let mailboxes = new Map<string, Promise<MailboxSearch>>();

export async function handler(event: SearchEvent) {
  const started = performance.now();
  if (event.forgetMailboxes) {
    engine = engines();
    mailboxes = new Map();
  }
  const mode = event.flatVectorSearch ? "flat" : "indexed";
  const key = `${mode}:${event.mailbox}`;
  let mailbox = mailboxes.get(key);
  const firstOnMailbox = !mailbox;
  if (!mailbox) {
    mailbox = engine[mode].mailbox(event.mailbox);
    mailboxes.set(key, mailbox);
  }
  const hits = await (await mailbox).search(withDates(event.query));
  return { hits, searchMs: performance.now() - started, firstOnMailbox, cachedBytes: Number(engine.session.sizeBytes()) };
}

function withDates({ filters, ...query }: SearchEvent["query"]): SearchQuery {
  const date = filters?.date;
  const toDate = (iso?: string) => (iso ? new Date(iso) : undefined);
  return { ...query, filters: filters && { ...filters, date: date && { from: toDate(date.from), to: toDate(date.to) } } };
}
