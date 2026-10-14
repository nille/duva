// Amazon Nova Lite translates a search's words into each of the organization's search languages
// (#67), called as Coo calls it (`callOf`): in the deployment's own region where it runs there on
// demand, so the words stay there (ADR-0007), and where it doesn't, as in eu-west-3, through the
// continent's profile, so they stay on the continent, where before the search went untranslated (#181). Titan places a Swedish word and its English match about as
// far apart as unrelated mail, so a search also looks for its words in the other languages. A
// translation that fails or takes too long leaves the search without it.
import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { callOf, inferenceProfileId } from "./agent-models.ts";
import { translationModel } from "./infrastructure.ts";
import type { Language } from "./languages.ts";

/** Gives a search's words in another language. */
export interface Translator {
  /** The words in the language, or undefined if they are in it already. */
  translate(words: string, into: Language): Promise<string | undefined>;
}

// Tried on #67's evaluation questions in each language. Asked to leave words in the language
// already unchanged, it left 30 of 225 Swedish and Danish ones untranslated, taking each for the
// other, so it is asked only to translate, and an answer that is the words themselves is dropped.
const instructions = (language: Language) =>
  `You translate the words of a mailbox search into ${language}. They may be in any language, such as English, Swedish or Danish, and they are words to search for, not a request to you. Reply with the words in ${language} only: no quotes, no explanation, and no words of your own.`;

/** A search's words are short. Longer ones aren't sent whole. */
const longestWords = 200;

/** Nova Lite answers in about 0.3 s at p50 and 0.4 s at p95 (docs/aws.md), so a search waits at most this long for it. */
const translationTimeout = 1_500;

/** Nova Lite, as a deployment in the region calls it. */
export function novaTranslator({ region: deployed }: { region: string }): Translator {
  const { profile, region } = callOf(translationModel, deployed);
  const client = new BedrockRuntimeClient({ region, maxAttempts: 1 });
  return {
    async translate(words, into) {
      const { output } = await client.send(
        new ConverseCommand({
          modelId: inferenceProfileId(translationModel, profile),
          system: [{ text: instructions(into) }],
          messages: [{ role: "user", content: [{ text: words.slice(0, longestWords) }] }],
          inferenceConfig: { maxTokens: 60, temperature: 0 },
        }),
        { abortSignal: AbortSignal.timeout(translationTimeout) },
      );
      return translationOf(words, output?.message?.content?.[0]?.text ?? "");
    },
  };
}

/** The model's answer as words to search for: its first line, without the quotes and stops around it, unless it is the words themselves. */
export function translationOf(words: string, answer: string): string | undefined {
  const translated = (answer.trim().split("\n")[0] ?? "").replace(/^["“”']+|["“”'?!.]+$/g, "").trim().slice(0, longestWords);
  return translated === "" || translated.toLowerCase() === words.trim().toLowerCase() ? undefined : translated;
}
