// The languages search knows (#67). English and Swedish mail is always indexed in its own language,
// as before there was a choice. Another language on the organization's list, like Danish, is too,
// and each search is translated into every language on the list. A few more can follow: each needs
// its common words here, and a stemmer LanceDB has by that name.

/** A language as LanceDB's full-text index spells it, which is also how the contract does. */
export type Language = "English" | "Swedish" | "Danish";

/** The languages search knows, in the order indexes and lists give them. */
export const languages: Language[] = ["English", "Swedish", "Danish"];

/** The organization's search languages until an admin changes them. */
export const defaultSearchLanguages: Language[] = ["English", "Swedish"];

/** The languages mail is indexed in, given the organization's search languages: English, Swedish, and any other on the list. */
export const indexedLanguages = (searchLanguages: Language[]): Language[] => languages.filter((language) => defaultSearchLanguages.includes(language) || searchLanguages.includes(language));

// Each language's most common words, which a message in it has more of than of another's. Danish and
// Swedish share many, so it is the words they don't share that tell them apart.
const commonWords: Record<Language, Set<string>> = {
  English: new Set("the and to of is that for on with it you we this be are have not from at by your will".split(" ")),
  Swedish: new Set("och att det är som för på med en ett av till den har inte jag du vi om så kan från hej vill ska här".split(" ")),
  Danish: new Set("og at det er som for på med en et af til den har ikke jeg du vi om så kan fra hej vil skal her mig også".split(" ")),
};

/**
 * The language of those indexed that the message is in: the one whose common words it has most of.
 * Mail is English unless it is clearly another, so the English stemmer is the default, and short
 * mail without any of these words is stemmed as English.
 */
export function messageLanguage(message: { subject: string; text: string }, indexed: Language[] = defaultSearchLanguages): Language {
  const counts = new Map(indexed.map((language) => [language, 0]));
  for (const word of `${message.subject} ${message.text}`.toLowerCase().split(/[^\p{L}]+/u)) {
    for (const language of indexed) if (commonWords[language].has(word)) counts.set(language, counts.get(language)! + 1);
  }
  let found: Language = "English";
  for (const [language, count] of counts) if (count > counts.get(found)!) found = language;
  return found;
}
