// SVG Tiny Portable/Secure, the SVG profile BIMI logos are drawn in (draft-svg-tiny-ps-abrotman):
// shapes, gradients and text only, with no scripts, no animation, no images and nothing
// referenced from elsewhere. Duva takes a logo only if it is SVG Tiny PS, then writes it out again
// with nothing but the elements and attributes it read, so no comment, processing instruction,
// DOCTYPE or entity of the sender's reaches anyone.
import { Parser } from "htmlparser2";

/** How long a logo may be, in bytes, as the profile recommends. */
export const longestLogo = 32 * 1024;

const svgNamespace = "http://www.w3.org/2000/svg";
const xlinkNamespace = "http://www.w3.org/1999/xlink";

/** The elements the profile allows that Duva keeps. */
const kept = new Set([
  "svg",
  "g",
  "defs",
  "title",
  "desc",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "solidColor",
  "linearGradient",
  "radialGradient",
  "stop",
  "use",
  "switch",
  "text",
  "tspan",
  "textArea",
  "tbreak",
]);

/** The elements the profile allows that say nothing to whoever sees the logo, which Duva leaves out with what is in them. */
const left = new Set(["metadata"]);

/**
 * The logo, written out again, if it is SVG Tiny PS: a root svg in SVG's namespace, with
 * baseProfile tiny-ps and version 1.2, no x or y, and a title, holding only the profile's
 * elements, with no event handlers and no reference outside itself. Undefined otherwise.
 */
export function tinyPsLogo(bytes: Uint8Array): string | undefined {
  if (bytes.length > longestLogo) return undefined;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
  const out: string[] = [];
  const open: string[] = [];
  let leaving = 0;
  let roots = 0;
  let titled = false;
  let valid = true;
  const refuse = () => void (valid = false);
  const parser = new Parser(
    {
      onopentag(name, attributes) {
        if (leaving > 0 || left.has(name)) return void leaving++;
        if (!kept.has(name)) return refuse();
        if (open.length === 0) {
          roots++;
          const root = name === "svg" && attributes.xmlns === svgNamespace && attributes.baseProfile?.toLowerCase() === "tiny-ps" && attributes.version === "1.2";
          if (!root || "x" in attributes || "y" in attributes) return refuse();
        }
        if (name === "title" && open.length === 1) titled = true;
        const written: string[] = [];
        for (const [attribute, value] of Object.entries(attributes)) {
          const kept = keptAttribute(attribute, value);
          if (kept === "refused") return refuse();
          if (kept) written.push(` ${attribute}="${escaped(value)}"`);
        }
        open.push(name);
        out.push(`<${name}${written.join("")}>`);
      },
      ontext(data) {
        if (leaving === 0 && open.length > 0) out.push(escaped(data));
        else if (data.trim() !== "" && leaving === 0) refuse();
      },
      onclosetag(name) {
        if (leaving > 0) return void leaving--;
        if (open.pop() !== name) return refuse();
        out.push(`</${name}>`);
      },
      oncdatastart: refuse,
    },
    { xmlMode: true, decodeEntities: true },
  );
  parser.end(text);
  return valid && roots === 1 && open.length === 0 && titled ? `<?xml version="1.0" encoding="UTF-8"?>\n${out.join("")}` : undefined;
}

/**
 * Whether the attribute is written out again: not an event handler, nor in another namespace than
 * XLink's and XML's, or "refused" when it references something outside the logo.
 */
function keptAttribute(name: string, value: string): boolean | "refused" {
  if (/^on/i.test(name)) return "refused";
  if (name === "href" || name === "xlink:href") return value.trim().startsWith("#") ? true : "refused";
  // Anything that could fetch or run: a url() that isn't to the logo's own parts, an import, a script.
  if (/url\s*\(\s*['"]?\s*[^#\s'"]|@import|javascript:|expression\s*\(/i.test(value)) return "refused";
  // CSS escapes could spell any of those.
  if (name === "style" && value.includes("\\")) return "refused";
  if (name === "xmlns") return value === svgNamespace;
  if (name === "xmlns:xlink") return value === xlinkNamespace;
  if (name.startsWith("xml:")) return true;
  return !name.includes(":");
}

const escaped = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
