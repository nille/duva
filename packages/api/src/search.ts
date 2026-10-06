// Searching a mailbox (ADR-0007): the API reads the q, resolves its labels, and asks the search
// Lambda, which answers from the mailbox's index. Each thread found is then checked as it is now,
// so a thread erased, or whose labels or read state changed since the index caught up, is shown
// as it is, and left out if it no longer matches.
import type { components } from "@duva/openapi";
import { type OperationHandler, refusal } from "./api.ts";
import { mailboxFor } from "./access.ts";
import { changedSinceIndexed } from "./indexing.ts";
import { labelNamed } from "./labels.ts";
import { screener, spam, type StoredSummary, summaryOf, threadSummary, trash } from "./mail.ts";
import type { SearchFilters } from "./search-engine.ts";
import { parseSearch } from "./search-query.ts";
import type { SearchRequest } from "./searching.ts";

type SearchResult = components["schemas"]["SearchResult"];

/** How many threads a page lists unless the call says. */
const resultsPerPage = 20;

/** How many threads a page lists at most. */
const maxResultsPerPage = 100;

/** How many results past the page's end get a snippet too, for those a check leaves out. */
const spareSnippets = 10;

export const searchMailbox: OperationHandler = async (event, deployment, actor) => {
  const mailbox = await mailboxFor(event, deployment, actor!, "read");
  if ("statusCode" in mailbox) return mailbox;
  const asked = event.queryStringParameters ?? {};
  const parsed = parseSearch(asked.q ?? "");
  if ("refused" in parsed) return refusal(400, parsed.refused);
  const sort = asked.sort ?? "relevance";
  if (sort !== "relevance" && sort !== "newest") return refusal(400, `${JSON.stringify(sort)} isn't a sort. Give sort as relevance or newest.`);
  const limit = asked.limit ?? String(resultsPerPage);
  if (!/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > maxResultsPerPage) {
    return refusal(400, `${JSON.stringify(limit)} isn't a limit Duva takes. Give limit as a whole number from 1 to ${maxResultsPerPage}.`);
  }
  const from = asked.after === undefined ? 0 : offsetOf(asked.after);
  if (from === undefined) return refusal(400, `${JSON.stringify(asked.after)} isn't where a page starts. Give after as the next of the page before, or leave it out for the first page.`);

  const labels: string[] = [];
  for (const name of parsed.labels) {
    const label = await labelNamed(deployment.table, mailbox.id, name);
    if (label === undefined) return refusal(400, `The mailbox has no label ${JSON.stringify(name)}. List its labels to see their names.`);
    labels.push(label);
  }
  // Spam, Trash and the Screener stay out unless the search asks for Spam or Trash.
  const exclude = labels.includes(spam) || labels.includes(trash) ? [] : [spam, trash, screener];
  const filters: SearchRequest["search"]["filters"] = {
    ...(parsed.from.length > 0 && { from: parsed.from }),
    ...(parsed.to.length > 0 && { to: parsed.to }),
    labels: { include: labels, exclude },
    ...(parsed.unread && { unread: true }),
    ...(parsed.hasAttachment && { hasAttachment: true }),
    ...((parsed.after !== undefined || parsed.before !== undefined) && { received: { from: parsed.after?.toISOString(), to: parsed.before?.toISOString() } }),
  };
  const { results } = await deployment.searcher({
    mailbox: mailbox.id,
    search: { terms: parsed.terms, filters, sort },
    changed: await changedSinceIndexed(deployment.table, mailbox.id),
    snippets: { from, count: Number(limit) + spareSnippets },
  });

  // The threads are read a page at a time, until the page is full or the results run out.
  const page: SearchResult[] = [];
  let at = from;
  while (page.length < Number(limit) && at < results.length) {
    const batch = results.slice(at, at + Number(limit) - page.length);
    const summaries = await Promise.all(batch.map(({ thread }) => threadSummary(deployment.table, mailbox.id, thread)));
    for (const [index, { message, snippet }] of batch.entries()) {
      const summary = summaries[index];
      if (summary === undefined || !stillMatches(summary, filters)) continue;
      page.push({ thread: summaryOf(summary), message, snippet: snippet?.text ?? summary.snippet, highlights: snippet?.highlights ?? [] });
    }
    at += batch.length;
  }
  return {
    statusCode: 200,
    body: { results: page, ...(at < results.length && { next: cursorAt(at) }) } satisfies components["schemas"]["SearchResults"],
  };
};

/** Whether the thread, as it is now, has the labels and read state the filters ask. */
function stillMatches(summary: StoredSummary, { labels, unread }: Pick<SearchFilters, "labels" | "unread">): boolean {
  if (!(labels?.include ?? []).every((label) => summary.labels.includes(label))) return false;
  if ((labels?.exclude ?? []).some((label) => summary.labels.includes(label))) return false;
  return unread === undefined || summary.unread === unread;
}

const cursorAt = (offset: number) => Buffer.from(`results#${offset}`).toString("base64url");

function offsetOf(cursor: string): number | undefined {
  const match = /^results#(\d+)$/.exec(Buffer.from(cursor, "base64url").toString());
  return match === null ? undefined : Number(match[1]);
}
