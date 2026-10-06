// Swedish next to English in search: the language a message is indexed in, and the definite forms
// Snowball's Swedish stemmer leaves apart.

export type Language = "English" | "Swedish";

// Swedish when its most common words outnumber English's. Mail is English unless it is clearly
// Swedish, so the English stemmer is the default. Short Swedish mail without any of these words is
// stemmed as English.
const swedishWords = new Set("och att det är som för på med en ett av till den har inte jag du vi om så kan från hej vill ska här".split(" "));
const englishWords = new Set("the and to of is that for on with it you we this be are have not from at by your will".split(" "));

/** The language the message is indexed in. */
export function messageLanguage(message: { subject: string; text: string }): Language {
  let swedish = 0;
  let english = 0;
  for (const word of `${message.subject} ${message.text}`.toLowerCase().split(/[^\p{L}]+/u)) {
    if (swedishWords.has(word)) swedish++;
    else if (englishWords.has(word)) english++;
  }
  return swedish > english ? "Swedish" : "English";
}

// Snowball's Swedish stemmer takes a noun's "-a" off but leaves its definite "-an" on, so "faktura"
// stems to "faktur" and "fakturan" stays "fakturan", and neither would find the other (#62). So a
// search for a word ending in one also looks for the other, in the Swedish columns, and highlights it.

/** The word's other Swedish form, definite or indefinite, if it is a word that can have one. */
export function definiteForms(word: string): string[] {
  const lower = word.toLowerCase();
  if (lower.length < 3 || !/^\p{L}+$/u.test(lower)) return [];
  if (lower.endsWith("an")) return [lower.slice(0, -1)];
  if (lower.endsWith("a")) return [`${lower}n`];
  return [];
}
