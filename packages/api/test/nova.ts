// A stand-in for Nova Lite's translations of searches: what Nova answered for each search's words
// the tests translate into each language, recorded once from Bedrock, as titan.ts records Titan's
// vectors. Words no one recorded have no translation, so their search is their own words alone.
//
// To record what a test translates, run it with DUVA_RECORD_EMBEDDINGS=1 and AWS_PROFILE set to the
// test account, which records Titan's vectors too: each search's words not yet recorded in a
// language are translated by Nova Lite in eu-north-1 and added to nova-translations.json, keyed by
// the language and the words, with "" when they are in that language already.
import { readFileSync, writeFileSync } from "node:fs";
import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { novaTranslator, type Translator } from "../src/translation.ts";

const file = new URL("./nova-translations.json", import.meta.url);

const read = (): Record<string, string> => JSON.parse(readFileSync(file, "utf8"));

export function recordedNova(): Translator {
  const recordings = read();
  const nova = process.env.DUVA_RECORD_EMBEDDINGS === "1" ? novaTranslator(new BedrockRuntimeClient({ region: "eu-north-1" })) : undefined;
  return {
    async translate(words, into) {
      const key = `${into}: ${words}`;
      if (nova !== undefined && recordings[key] === undefined) {
        const translated = (await nova.translate(words, into)) ?? "";
        const all = { ...read(), [key]: translated };
        recordings[key] = translated;
        writeFileSync(file, `${JSON.stringify(Object.fromEntries(Object.entries(all).sort(([a], [b]) => (a < b ? -1 : 1))), null, 1)}\n`);
      }
      return recordings[key] || undefined;
    },
  };
}
