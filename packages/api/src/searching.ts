// The search Lambda: runs a search in a mailbox's index and gives the threads it found, in order,
// each with the message that matched best and a snippet of that message's text. Only the API
// invokes it, through IAM, and the API decides who may search what and checks each thread as it is.
import { InvokeCommand, type LambdaClient } from "@aws-sdk/client-lambda";
import type { SearchEngine, SearchFilters, SearchHit, Search } from "./search-engine.ts";
import { type Snippet, snippetFor } from "./snippets.ts";

/** How many messages a search finds at most, and so how far its results can be paged. */
export const messagesFound = 1_000;

/** A search as the API asks it, as JSON carries it, with the times of its date filter as ISO strings. */
export interface SearchRequest {
  mailbox: string;
  search: Omit<Search, "filters" | "limit"> & { filters: Omit<SearchFilters, "received"> & { received?: { from?: string; to?: string } } };
  /**
   * Threads whose labels or read state may have changed since the index caught up. The label and
   * read state filters leave none of them out, so the API checks those against the thread itself.
   */
  changed: string[];
  /** Which of the results get a snippet: from the first one, as many as the count. */
  snippets: { from: number; count: number };
}

export interface SearchResponse {
  results: { thread: string; message: string; snippet?: Snippet }[];
}

/** Runs a search. */
export type Searcher = (request: SearchRequest) => Promise<SearchResponse>;

/** The search Lambda's handler. */
export function createSearcher(engine: SearchEngine): Searcher {
  return async ({ mailbox, search: asked, changed, snippets }) => {
    const { from, to } = asked.filters.received ?? {};
    const filters: SearchFilters = { ...asked.filters, received: { from: from === undefined ? undefined : new Date(from), to: to === undefined ? undefined : new Date(to) } };
    const search: Search = { ...asked, filters, limit: messagesFound };
    let hits: SearchHit[];
    if (changed.length === 0) hits = await engine.search(mailbox, search);
    else {
      const { labels: _labels, unread: _unread, ...unlabelled } = filters;
      const [others, these] = await Promise.all([
        engine.search(mailbox, { ...search, filters: { ...filters, threads: { exclude: changed } } }),
        engine.search(mailbox, { ...search, filters: { ...unlabelled, threads: { include: changed } } }),
      ]);
      const byScore = search.terms.length > 0 && search.sort === "relevance";
      hits = [...others, ...these].sort((a, b) => (byScore ? b.score - a.score : b.receivedAt.getTime() - a.receivedAt.getTime())).slice(0, messagesFound);
    }
    // A thread ranks by its best message, which is the one it shows.
    const best = new Map<string, string>();
    for (const hit of hits) if (!best.has(hit.thread)) best.set(hit.thread, hit.message);
    const results: SearchResponse["results"] = [...best].map(([thread, message]) => ({ thread, message }));
    const snippeted = results.slice(snippets.from, snippets.from + snippets.count);
    const texts = await engine.texts(mailbox, snippeted.map(({ message }) => message));
    for (const result of snippeted) {
      const text = texts.get(result.message);
      if (text !== undefined) result.snippet = snippetFor(text, search.terms);
    }
    return { results };
  };
}

/** The search Lambda, invoked by the API through IAM, which waits for its answer. */
export function lambdaSearcher(lambda: LambdaClient, functionName: string): Searcher {
  return async (request) => {
    const { Payload, FunctionError } = await lambda.send(new InvokeCommand({ FunctionName: functionName, Payload: JSON.stringify(request) }));
    const answer = new TextDecoder().decode(Payload);
    if (FunctionError !== undefined) throw new Error(`The search Lambda failed: ${answer}`);
    return JSON.parse(answer) as SearchResponse;
  };
}
