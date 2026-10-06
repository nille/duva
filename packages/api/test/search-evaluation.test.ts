// Search by meaning across Swedish, English and Danish, on #67's evaluation set: the search module
// through its interface, with Titan's vectors and Nova Lite's translations as recorded, and mail
// indexed in all three. The numbers here are the shipped rows of the table in lancedb-search.ts,
// which spikes/search/harness/cutoffs.ts measures for every setting.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { type Language, languages } from "../src/languages.ts";
import { lanceSearch } from "../src/lancedb-search.ts";
import type { SearchEngine, SearchTerm } from "../src/search-engine.ts";
import { messagesFound } from "../src/searching.ts";
import { recordedNova } from "./nova.ts";
import { evaluationMailbox, measured } from "./search-evaluation.ts";
import { recordedTitan } from "./titan.ts";

const directory = mkdtempSync(join(tmpdir(), "duva-evaluation-"));
const engine: SearchEngine = lanceSearch({ uri: directory, embedder: recordedTitan(), translator: recordedNova() });
const mailbox = "evaluation";
beforeAll(async () => (await engine.writer(mailbox, languages)).put(evaluationMailbox));
afterAll(() => rmSync(directory, { recursive: true, force: true }));

const words = (text: string): SearchTerm[] => text.split(" ").map((word) => ({ text: word, phrase: false, in: "anywhere" }));
// The search Lambda asks for every message found, as many as messagesFound, and pages them.
const topFive = async (text: string, translateInto: Language[]) =>
  (await engine.search(mailbox, { terms: words(text), filters: {}, sort: "relevance", limit: messagesFound, translateInto })).slice(0, 5).map(({ message }) => message);
const measuredInto = (translateInto: Language[]) => measured(({ text }) => topFive(text, translateInto));

test("a translated search finds the mail in the other languages that its words alone miss", async () => {
  expect(await topFive("kvitto", [])).not.toContain("receipt-coffee");
  expect(await topFive("kvitto", languages)).toEqual(expect.arrayContaining(["kvitto-apotek", "receipt-coffee", "receipt-app"]));
  expect(await topFive("wine tasting", languages)).toContain("vinprovning-inbjudan");
  expect(await topFive("resa till Lissabon", [])).not.toContain("lisbon-booking");
  // The booking itself, "Atlantica itinerary ARN-LIS", says too little for its meaning to reach it from another language's words.
  expect(await topFive("resa till Lissabon", languages)).toEqual(expect.arrayContaining(["lisbon-checkin", "lissabon-hotell", "lissabon-tog"]));
  expect(await topFive("husleje", [])).not.toContain("lease-renewal");
  expect(await topFive("husleje", languages)).toEqual(expect.arrayContaining(["husleje", "lease-renewal"]));
});

test("on the evaluation set, translation finds more in every pair of languages, with few more unrelated results", async () => {
  const untranslated = { "da-da": 1, "da-en": 0.21, "da-sv": 0.39, "en-da": 0.14, "en-en": 0.72, "en-sv": 0.49, "sv-da": 0.58, "sv-en": 0.22, "sv-sv": 0.67, unrelated: 0.4 };
  expect(await measuredInto([])).toEqual(untranslated);
  expect(await measuredInto(["English", "Swedish"])).toEqual({ ...untranslated, "da-en": 0.63, "da-sv": 0.61, "en-da": 0.43, "en-sv": 0.72, "sv-en": 0.68, unrelated: 0.39 });
  expect(await measuredInto(languages)).toEqual({ ...untranslated, "da-en": 0.63, "da-sv": 0.61, "en-da": 0.71, "en-sv": 0.72, "sv-da": 0.92, "sv-en": 0.68, unrelated: 0.47 });
});
