// What a search's q says: words and "quoted phrases", and the filters from:, to:, subject:, label:,
// has:attachment, is:unread, before: and after:. A filter's value can be quoted too, as in
// label:"Travel plans". Everything given must hold.
import type { SearchTerm } from "./search-engine.ts";

export interface ParsedSearch {
  terms: SearchTerm[];
  from: string[];
  to: string[];
  /** Label names as given, which the mailbox's labels resolve. */
  labels: string[];
  unread: boolean;
  hasAttachment: boolean;
  /** Received on or after the start of this day, in UTC. */
  after?: Date;
  /** Received before the start of this day, in UTC. */
  before?: Date;
}

/**
 * Each filter by name, with an example of it, and what it adds to the search: nothing, or the
 * words of a refusal.
 */
const filters: Record<string, { example: string; add(parsed: ParsedSearch, value: string, quoted: boolean): string | undefined }> = {
  from: { example: "from:ada", add: (parsed, value) => void parsed.from.push(value) },
  to: { example: "to:grace@example.com", add: (parsed, value) => void parsed.to.push(value) },
  subject: { example: "subject:invoice", add: (parsed, value, quoted) => void (hasWords(value) && parsed.terms.push({ text: value, phrase: quoted, in: "subject" })) },
  label: { example: "label:receipts", add: (parsed, value) => void parsed.labels.push(value) },
  has: {
    example: "has:attachment",
    add(parsed, value) {
      if (value.toLowerCase() !== "attachment") return `has:${value} isn't a filter. Use has:attachment.`;
      parsed.hasAttachment = true;
    },
  },
  is: {
    example: "is:unread",
    add(parsed, value) {
      if (value.toLowerCase() !== "unread") return `is:${value} isn't a filter. Use is:unread.`;
      parsed.unread = true;
    },
  },
  before: {
    example: "before:2026-10-01",
    add(parsed, value) {
      const day = dayOf(value);
      if (day === undefined) return `before:${value} isn't a date. Give it as YYYY-MM-DD, as in before:2026-10-01.`;
      if (parsed.before === undefined || day < parsed.before) parsed.before = day;
    },
  },
  after: {
    example: "after:2026-09-01",
    add(parsed, value) {
      const day = dayOf(value);
      if (day === undefined) return `after:${value} isn't a date. Give it as YYYY-MM-DD, as in after:2026-09-01.`;
      if (parsed.after === undefined || day > parsed.after) parsed.after = day;
    },
  },
};

/** The filters a search understands, as a refusal lists them. */
const filterNames = "from:, to:, subject:, label:, has:attachment, is:unread, before: or after:";

/** What the q says, or the words of a refusal saying what is wrong with it. */
export function parseSearch(q: string): ParsedSearch | { refused: string } {
  const parsed: ParsedSearch = { terms: [], from: [], to: [], labels: [], unread: false, hasAttachment: false };
  let filtered = false;
  for (const { filter, value, quoted } of tokens(q)) {
    if (filter === undefined) {
      // A word with no letters or digits, like "-", has nothing to match.
      if (hasWords(value)) parsed.terms.push({ text: value, phrase: quoted, in: "anywhere" });
      continue;
    }
    filtered = true;
    const known = filters[filter.toLowerCase()];
    if (known === undefined) return { refused: `${filter}: isn't a filter. Use ${filterNames}, or put the words in quotes to search for them as they are.` };
    if (value === "") return { refused: `${filter}: needs a value, as in ${known.example}.` };
    const refused = known.add(parsed, value, quoted);
    if (refused !== undefined) return { refused };
  }
  if (parsed.terms.length === 0 && !filtered) return { refused: "Give words to search for, or a filter such as from:ada." };
  return parsed;
}

const hasWords = (text: string) => /[\p{L}\p{N}]/u.test(text);

/** The start of the day in UTC, if the text is a date as YYYY-MM-DD. */
function dayOf(text: string): Date | undefined {
  if (!/^\d{4}-\d\d-\d\d$/.test(text)) return undefined;
  const day = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== text ? undefined : day;
}

/**
 * The q's parts, split at white space outside quotes: a word, a "quoted phrase", or a filter's
 * name and value, which can be quoted. A quote that isn't closed runs to the end.
 */
function tokens(q: string): { filter?: string; value: string; quoted: boolean }[] {
  const found: { filter?: string; value: string; quoted: boolean }[] = [];
  const pattern = /\s*(?:([A-Za-z]+):)?(?:"([^"]*)"?|(\S+))?/gy;
  for (let match = pattern.exec(q); match !== null && match[0] !== ""; match = pattern.exec(q)) {
    const [, filter, quoted, bare] = match;
    if (filter === undefined && quoted === undefined && bare === undefined) continue;
    found.push({ filter, value: (quoted ?? bare ?? "").trim(), quoted: quoted !== undefined });
  }
  return found;
}
