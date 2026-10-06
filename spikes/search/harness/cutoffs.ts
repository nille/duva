// #67's harness: how far a search by meaning may reach, and what translating it adds, measured on
// the evaluation set in packages/api/test/search-evaluation.ts with the Titan vectors and Nova Lite
// translations its test recorded, so it needs no AWS. Each question is searched as Duva searches:
// its words through the search module, and the 20 nearest by meaning that a setting keeps, then
// the same for each translation, all fused by RRF. Meaning is ranked here by an exact cosine, as
// the module does below 1,000 messages, so each setting is one line, and the module's own search
// is the test's, which gives the same numbers for the settings it ships.
//
//   node harness/cutoffs.ts     into results/67-cutoffs.json
//
// A pair is a question and a message it asks for, by the question's language and the message's,
// as "sv-en" for a Swedish question asking for English mail. Recall is the share of pairs in the
// top 5, and unrelated the hits in the top 5 on another subject, per question.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Language, languages } from "../../../packages/api/src/languages.ts";
import { lanceSearch } from "../../../packages/api/src/lancedb-search.ts";
import type { SearchTerm } from "../../../packages/api/src/search-engine.ts";
import { evaluationMailbox, languageOf, measured, type Question, questions } from "../../../packages/api/test/search-evaluation.ts";
import { recordedTitan } from "../../../packages/api/test/titan.ts";

const root = new URL("..", import.meta.url).pathname;
const translations: Record<string, string> = JSON.parse(readFileSync(new URL("../../../packages/api/test/nova-translations.json", import.meta.url), "utf8"));
const titan = recordedTitan();
const language = languageOf;

// The words alone: an engine whose vectors are random, which the cutoff of every setting leaves out.
const random = { embed: async (texts: string[]) => texts.map(() => unit(Float32Array.from({ length: 1024 }, () => Math.random() - 0.5))) };
const directory = mkdtempSync(join(tmpdir(), "duva-cutoffs-"));
const engine = lanceSearch({ uri: directory, embedder: random });
await (await engine.writer("evaluation", languages)).put(evaluationMailbox);
const vectors = await titan.embed(evaluationMailbox.map(({ subject, text }) => `${subject}\n\n${text.slice(0, 2_000)}`.trim()));

const words = (text: string): SearchTerm[] => text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).map((word) => ({ text: word, phrase: false, in: "anywhere" }));
const byWords = async (text: string) => (await engine.search("evaluation", { terms: words(text), filters: {}, sort: "relevance", limit: 1_000 })).map(({ message }) => message);
interface Near {
  id: string;
  distance: number;
}
async function nearest(text: string): Promise<Near[]> {
  const [query] = await titan.embed([text]);
  return evaluationMailbox
    .map(({ id }, at) => ({ id, distance: 1 - vectors[at]!.reduce((sum, value, k) => sum + value * query![k]!, 0) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 20);
}

const searched = await Promise.all(
  questions.map(async (question) => ({
    question,
    words: await byWords(question.text),
    near: await nearest(question.text),
    translated: Object.fromEntries(
      await Promise.all(
        languages.flatMap((into) => {
          const other = translations[`${into}: ${question.text}`];
          return other ? [(async () => [into, { words: await byWords(other), near: await nearest(other) }] as const)()] : [];
        }),
      ),
    ) as Partial<Record<Language, { words: string[]; near: Near[] }>>,
  })),
);

/** Which of the 20 nearest a setting keeps, given the question, whose language only the language-pair settings know. */
type Keep = (near: Near[], question: Question) => Near[];
const within = (furthest: number): Keep => (near) => near.filter(({ distance }) => distance <= furthest);
const nearBest = (furthest: number, behind: number): Keep => (near) => near.filter(({ distance }) => distance <= furthest && distance <= near[0]!.distance + behind);
const nearBestInLanguage = (furthest: number, behind: number): Keep => (near) => {
  const best = new Map<Language, number>();
  for (const { id, distance } of near) if (!best.has(language.get(id)!)) best.set(language.get(id)!, distance);
  return near.filter(({ id, distance }) => distance <= furthest && distance <= best.get(language.get(id)!)! + behind);
};
const byPair = (same: number, cross: number): Keep => (near, question) => near.filter(({ id, distance }) => distance <= (language.get(id) === question.language ? same : cross));

interface Setting {
  setting: string;
  keep: Keep;
  /** The search languages it is translated into, and how far a translation's meaning reaches. */
  translated?: { into: Language[]; keep: Keep };
}
const englishAndSwedish: Language[] = ["English", "Swedish"];
const settings: Setting[] = [
  { setting: "within 0.8 (#62)", keep: within(0.8) },
  { setting: "within 0.85", keep: within(0.85) },
  { setting: "within 0.9", keep: within(0.9) },
  { setting: "within 0.9 and 0.05 of the nearest", keep: nearBest(0.9, 0.05) },
  { setting: "within 0.9 and 0.1 of the nearest", keep: nearBest(0.9, 0.1) },
  { setting: "within 0.9 and 0.05 of the nearest in its language", keep: nearBestInLanguage(0.9, 0.05) },
  { setting: "by language pair, same 0.8 and cross 0.85", keep: byPair(0.8, 0.85) },
  { setting: "by language pair, same 0.8 and cross 0.9", keep: byPair(0.8, 0.9) },
  { setting: "within 0.8, translated into English and Swedish, within 0.8", keep: within(0.8), translated: { into: englishAndSwedish, keep: within(0.8) } },
  { setting: "within 0.8, translated into English and Swedish, within 0.75 (#67)", keep: within(0.8), translated: { into: englishAndSwedish, keep: within(0.75) } },
  { setting: "within 0.8, translated into all three, within 0.8", keep: within(0.8), translated: { into: languages, keep: within(0.8) } },
  { setting: "within 0.8, translated into all three, within 0.78", keep: within(0.8), translated: { into: languages, keep: within(0.78) } },
  { setting: "within 0.8, translated into all three, within 0.75 (#67)", keep: within(0.8), translated: { into: languages, keep: within(0.75) } },
  { setting: "within 0.8, translated into all three, by their words alone", keep: within(0.8), translated: { into: languages, keep: () => [] } },
];

function fused(...rankings: string[][]): string[] {
  const scores = new Map<string, number>();
  for (const ranking of rankings) ranking.forEach((id, rank) => scores.set(id, (scores.get(id) ?? 0) + 1 / (60 + rank + 1)));
  return [...scores].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

const results = [];
for (const { setting, keep, translated } of settings) {
  const topFive = async (question: Question) => {
    const { words, near, translated: translations } = searched.find((each) => each.question === question)!;
    const rankings = [words, keep(near, question).map(({ id }) => id)];
    for (const into of translated?.into ?? []) {
      const other = translations[into];
      if (other !== undefined) rankings.push(other.words, translated!.keep(other.near, question).map(({ id }) => id));
    }
    return fused(...rankings).slice(0, 5);
  };
  results.push({ setting, ...(await measured(topFive)) });
}

rmSync(directory, { recursive: true, force: true });
writeFileSync(join(root, "results/67-cutoffs.json"), `${JSON.stringify({ messages: evaluationMailbox.length, questions: questions.length, results }, null, 2)}\n`);
console.table(results);

function unit(vector: Float32Array): Float32Array {
  const length = Math.hypot(...vector);
  return vector.map((value) => value / length);
}
