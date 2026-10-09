// Searching a mailbox (ADR-0007): the API reads the q, resolves its labels, and asks the search
// Lambda, which answers from the mailbox's index. Each thread found is then checked as it is now,
// so a thread erased, or whose labels or read state changed since the index caught up, is shown
// as it is, and left out if it no longer matches.
import type { components } from "@duva/openapi";
import { type OperationHandler, refusal } from "./api.ts";
import type { Deployment } from "./deployment.ts";
import { mailboxFor } from "./access.ts";
import { changedSinceIndexed } from "./indexing.ts";
import { labelNamed } from "./labels.ts";
import { organizationSettings } from "./organization.ts";
import { screener, spam, type StoredSummary, summaryOf, threadSummary, trash } from "./mail.ts";
import type { SearchFilters } from "./search-engine.ts";
import { type ParsedSearch, parseSearch } from "./search-query.ts";
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
  const asked = searchAsked(event);
  if ("statusCode" in asked) return asked;
  const from = asked.after === undefined ? 0 : offsetOf(asked.after);
  if (from === undefined) return pageRefused(asked.after!);
  const found = await foundIn(deployment, mailbox.id, { ...asked, from });
  if ("missing" in found) return refusal(400, `The mailbox has no label ${JSON.stringify(found.missing)}. List its labels to see their names.`);
  const { results, end, total } = found;
  return {
    statusCode: 200,
    body: { results: results.map(({ result }) => result), ...(end < total && { next: cursorAt(end) }) } satisfies components["schemas"]["SearchResults"],
  };
};

/** A search as the call asks for it, or the refusal if it asks for one Duva doesn't take. */
export function searchAsked(event: Parameters<OperationHandler>[0]): { parsed: ParsedSearch; sort: "relevance" | "newest"; limit: number; after?: string } | ReturnType<typeof refusal> {
  const asked = event.queryStringParameters ?? {};
  const parsed = parseSearch(asked.q ?? "");
  if ("refused" in parsed) return refusal(400, parsed.refused);
  const sort = asked.sort ?? "relevance";
  if (sort !== "relevance" && sort !== "newest") return refusal(400, `${JSON.stringify(sort)} isn't a sort. Give sort as relevance or newest.`);
  const limit = asked.limit ?? String(resultsPerPage);
  if (!/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > maxResultsPerPage) {
    return refusal(400, `${JSON.stringify(limit)} isn't a limit Duva takes. Give limit as a whole number from 1 to ${maxResultsPerPage}.`);
  }
  return { parsed, sort, limit: Number(limit), ...(asked.after !== undefined && { after: asked.after }) };
}

export const pageRefused = (after: string) => refusal(400, `${JSON.stringify(after)} isn't where a page starts. Give after as the next of the page before, or leave it out for the first page.`);

/**
 * The threads the mailbox's index finds, from the result at `from`, at most `limit` of them, each
 * as it is now with the place after it in the results, where reading the results stopped, and how
 * many there are. Gives the name of a label the search asks for that the mailbox hasn't instead.
 */
export async function foundIn(
  deployment: Deployment,
  mailbox: string,
  { parsed, sort, limit, from }: { parsed: ParsedSearch; sort: "relevance" | "newest"; limit: number; from: number },
): Promise<{ results: { result: SearchResult; summary: StoredSummary; next: number }[]; end: number; total: number } | { missing: string }> {
  const labels: string[] = [];
  for (const name of parsed.labels) {
    const label = await labelNamed(deployment.table, mailbox, name);
    if (label === undefined) return { missing: name };
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
  const [changed, { settings }] = await Promise.all([changedSinceIndexed(deployment.table, mailbox), organizationSettings(deployment.table)]);
  const { results } = await deployment.searcher({
    mailbox,
    // A search is translated into the organization's search languages, if it has two or more (#67).
    search: { terms: parsed.terms, filters, sort, translateInto: settings.searchLanguages.length > 1 ? settings.searchLanguages : [] },
    changed,
    snippets: { from, count: limit + spareSnippets },
  });

  // The threads are read a page at a time, until the page is full or the results run out.
  const page: { result: SearchResult; summary: StoredSummary; next: number }[] = [];
  let at = from;
  while (page.length < limit && at < results.length) {
    const batch = results.slice(at, at + limit - page.length);
    const summaries = await Promise.all(batch.map(({ thread }) => threadSummary(deployment.table, mailbox, thread)));
    for (const [index, { message, snippet }] of batch.entries()) {
      const summary = summaries[index];
      if (summary === undefined || !stillMatches(summary, filters)) continue;
      page.push({ result: { thread: summaryOf(summary), message, snippet: snippet?.text ?? summary.snippet, highlights: snippet?.highlights ?? [] }, summary, next: at + index + 1 });
    }
    at += batch.length;
  }
  return { results: page, end: at, total: results.length };
}

/** Whether the thread, as it is now, has the labels and read state the filters ask. */
function stillMatches(summary: StoredSummary, { labels, unread }: Pick<SearchFilters, "labels" | "unread">): boolean {
  if (!(labels?.include ?? []).every((label) => summary.labels.includes(label))) return false;
  if ((labels?.exclude ?? []).some((label) => summary.labels.includes(label))) return false;
  return unread === undefined || summary.unread === unread;
}

export const cursorAt = (offset: number) => Buffer.from(`results#${offset}`).toString("base64url");

export function offsetOf(cursor: string): number | undefined {
  const match = /^results#(\d+)$/.exec(Buffer.from(cursor, "base64url").toString());
  return match === null ? undefined : Number(match[1]);
}
