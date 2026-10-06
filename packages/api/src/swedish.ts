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
