// The spike's Lambda: answers one search on one mailbox, and says how long the
// search took inside the handler. The table lives under SEARCH_URI.
import { lanceSearch } from "./lancedb-search.ts";
import type { MailboxSearch, SearchFilters, SearchQuery } from "./search.ts";

// The query as JSON carries it, with dates as ISO strings.
export interface SearchEvent {
  mailbox: string;
  query: Omit<SearchQuery, "filters"> & {
    filters?: Omit<SearchFilters, "date"> & { date?: { from?: string; to?: string } };
  };
}

const uri = process.env.SEARCH_URI;
if (!uri) throw new Error("Set SEARCH_URI to the tables' location.");
const engine = lanceSearch({ uri, storageOptions: { region: process.env.AWS_REGION ?? "eu-north-1" } });

// A warm environment keeps each mailbox it has opened.
const mailboxes = new Map<string, Promise<MailboxSearch>>();

export async function handler(event: SearchEvent) {
  const started = performance.now();
  let mailbox = mailboxes.get(event.mailbox);
  if (!mailbox) {
    mailbox = engine.mailbox(event.mailbox);
    mailboxes.set(event.mailbox, mailbox);
  }
  const hits = await (await mailbox).search(withDates(event.query));
  return { hits, searchMs: performance.now() - started };
}

function withDates({ filters, ...query }: SearchEvent["query"]): SearchQuery {
  const date = filters?.date;
  const toDate = (iso?: string) => (iso ? new Date(iso) : undefined);
  return { ...query, filters: filters && { ...filters, date: date && { from: toDate(date.from), to: toDate(date.to) } } };
}
