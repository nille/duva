/// <reference path="./snowball-stemmers.d.ts" />
// A search result's snippet: the part of the matching message's text where the search's words
// stand, on one line without URLs or long tokens, with each place they match highlighted. A word
// matches another form of itself as the index stems it, so "invoices" lights up "invoice",
// "fakturor" "faktura", and in Danish text "regningerne" "regning".
import snowball from "snowball-stemmers";
import { readableLine } from "./readable-line.ts";
import type { SearchTerm } from "./search-engine.ts";
import { languages, messageLanguage } from "./languages.ts";
import { definiteForms } from "./swedish.ts";

export interface Snippet {
  text: string;
  /** Where each match is in the text, as offsets in UTF-16 code units, the end exclusive. */
  highlights: { start: number; end: number }[];
}

/** How long a snippet is at most, before its ellipses, as a thread's is. */
const snippetLength = 200;

/** How much of the text before the first match a snippet shows, at most. */
const leadLength = 60;

const stemmers = [snowball.newStemmer("english"), snowball.newStemmer("swedish"), snowball.newStemmer("danish")];

/** What a word is compared by: itself in lower case, and its stems in English, folded, and Swedish, and in Danish text Danish. */
const formsOf = (danish: boolean) => (word: string) => {
  const lower = word.toLowerCase();
  const folded = lower.normalize("NFD").replace(/\p{M}/gu, "");
  return [lower, stemmers[0]!.stem(folded), stemmers[1]!.stem(lower), ...(danish ? [stemmers[2]!.stem(lower)] : [])];
};

const sameWord = (a: string[], b: string[]) => a.some((form, index) => form === b[index]);

/**
 * The snippet of the text for the terms: from a little before the first match, or from the
 * start if nothing matches, with the matches of every term searched anywhere highlighted.
 */
export function snippetFor(text: string, terms: SearchTerm[]): Snippet {
  const line = readableLine(text);
  // Danish text is stemmed as Danish too, where an index has it; any other is never filed as Danish.
  const language = messageLanguage({ subject: "", text }, languages);
  const forms = formsOf(language === "Danish");
  const words = [...line.matchAll(/[\p{L}\p{N}]+/gu)].map((match) => ({ start: match.index, end: match.index + match[0].length, forms: forms(match[0]) }));
  const matched: { start: number; end: number }[] = [];
  const swedish = language === "Swedish";
  for (const term of terms.filter((each) => each.in === "anywhere")) {
    // In Swedish text a word matches its other definite form too, as the index does, and a phrase only as written.
    const wanted = [...term.text.matchAll(/[\p{L}\p{N}]+/gu)].map(([word]) => [word, ...(term.phrase || !swedish ? [] : definiteForms(word))].map(forms));
    if (wanted.length === 0) continue;
    // A phrase matches where its words stand together, and a word with several parts, like an address, too.
    for (let at = 0; at + wanted.length <= words.length; at++) {
      if (wanted.every((alternatives, offset) => alternatives.some((forms) => sameWord(words[at + offset]!.forms, forms)))) {
        matched.push({ start: words[at]!.start, end: words[at + wanted.length - 1]!.end });
      }
    }
  }
  const highlights = merged(matched);
  const first = highlights[0]?.start ?? 0;
  let start = Math.max(0, first - leadLength);
  // Start at a word, not inside one.
  if (start > 0) start = words.find((word) => word.end > start)?.start ?? start;
  let end = Math.min(line.length, start + snippetLength);
  if (end < line.length) end = Math.max(...words.filter((word) => word.end <= end).map((word) => word.end), start);
  const lead = start > 0 ? "…" : "";
  const shown = `${lead}${line.slice(start, end).trim()}${end < line.length ? "…" : ""}`;
  const shift = lead.length - start;
  return {
    text: shown,
    highlights: highlights.filter((each) => each.start >= start && each.end <= end).map((each) => ({ start: each.start + shift, end: each.end + shift })),
  };
}

/** The ranges in order, with those that overlap or touch made one. */
function merged(ranges: { start: number; end: number }[]): { start: number; end: number }[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const out: { start: number; end: number }[] = [];
  for (const range of sorted) {
    const last = out.at(-1);
    if (last !== undefined && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else out.push({ ...range });
  }
  return out;
}
