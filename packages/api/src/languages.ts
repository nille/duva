// The languages search knows (#67). English and Swedish mail is always indexed in its own language,
// as before there was a choice. Another language on the organization's list, like Danish, is too,
// and each search is translated into every language on the list. A few more can follow: each needs
// its common words here, and a stemmer LanceDB has by that name. The same words, with those short
// requests are made of, tell Coo which language its human asked in (#188).

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
  const counts = wordsIn(`${message.subject} ${message.text}`, indexed, (language) => [commonWords[language]]);
  let found: Language = "English";
  for (const [language, count] of counts) if (count > counts.get(found)!) found = language;
  return found;
}

/** How many of each language's words, as `words` gives them, the text has. */
function wordsIn(text: string, among: Language[], words: (language: Language) => Set<string>[]): Map<Language, number> {
  const counts = new Map(among.map((language) => [language, 0]));
  for (const word of text.toLowerCase().split(/[^\p{L}]+/u)) {
    for (const language of among) for (const set of words(language)) if (set.has(word)) counts.set(language, counts.get(language)! + 1);
  }
  return counts;
}

// The words short requests to Coo are made of, beside the common words, which come from long mail:
// none a card's or a site's name may hold, as visa, Swedish for show, does Visa.
const askingWords: Record<Language, Set<string>> = {
  English: new Set("what how why when where which who did do does has had my me can could would should please was were there any all many much new since today use buy pay paid send find tell".split(" ")),
  // None Danish or Norwegian shares, as betalt, so their words name no Swedish.
  Swedish: new Set("vad hur varför när vilken vilka vem mitt mina skulle snälla finns fanns någon några något många nytt sedan idag igår alla köp köpa betala skicka hitta berätta".split(" ")),
  Danish: new Set("hvad hvordan hvorfor hvornår hvor hvilken hvilke hvem mit mine dig skulle venligst nogen nogle alle køb købe betal betalt find fortæl".split(" ")),
};

/**
 * The language of those given that a human's words are in, as Coo is told it (#188): the one whose
 * common and asking words they have more of than of any other's, and that make up a fair share of
 * all their words, so a language not given, with a few look-alikes as German's "was", names none.
 * What came after a signature's or a disclosure's line, a mail's "Subject:", links and addresses don't count.
 */
export function wordsLanguage(text: string, among: Language[]): Language | undefined {
  const written = text.split(/^(?:-- ?$|Sent (?:by|from) )/m)[0]!.replace(/^Subject:/m, " ").replace(/\S+@\S+|https?:\/\/\S+/g, " ");
  const all = written.toLowerCase().split(/[^\p{L}]+/u).filter((word) => word !== "").length;
  const [first, second] = [...wordsIn(written, among, (language) => [commonWords[language], askingWords[language]])].sort(([, a], [, b]) => b - a);
  return first !== undefined && first[1] > 0 && first[1] >= 0.3 * all && (second === undefined || first[1] > second[1]) ? first[0] : undefined;
}
