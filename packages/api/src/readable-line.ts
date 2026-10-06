// A message's text as a snippet reads it: on one line, without quoted lines, and without the
// URLs and long tokens newsletters put in their text parts, so the words around them show.

/** A URL in matching angle brackets, square brackets or parentheses, or a bare one without the punctuation after it, with the space before. */
const url = /\s*(?:<\s*https?:\/\/[^\s>]*\s*>|\[\s*https?:\/\/[^\s\]]*\s*\]|\(\s*https?:\/\/[^\s)]*\s*\)|https?:\/\/\S*[^\s.,;:!?)\]>'"])/giu;

/** A run of 24 or more characters without spaces. */
const longRun = /\S{24,}/gu;

/**
 * A long run that still reads: words or numbers, a word perhaps ending in a number, joined by
 * hyphens, dots, slashes and the like, as a Swedish compound, an address or an order number is.
 */
const readableRun = /^[\p{P}+]*(?:[\p{L}\p{M}]+\p{N}*|\p{N}+)(?:[-'’.@/_+#:,]+(?:[\p{L}\p{M}]+\p{N}*|\p{N}+))*\p{P}*$/u;

export function readableLine(text: string): string {
  return text
    .split("\n")
    .filter((each) => !each.trimStart().startsWith(">"))
    .join(" ")
    .replace(url, "")
    .replace(longRun, (run) => (readableRun.test(run) ? run : " "))
    .replace(/\s+/g, " ")
    .trim();
}
