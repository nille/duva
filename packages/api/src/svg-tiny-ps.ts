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

/** The elements whose text is read or shown, where space counts. */
const spoken = new Set(["title", "desc", "text", "tspan", "textArea"]);

/** How long an uploaded logo may be before Duva converts it, in bytes. */
export const longestUpload = 256 * 1024;

/** An element of an uploaded logo, as Duva read it. */
interface Element {
  name: string;
  attributes: Record<string, string>;
  children: (Element | string)[];
}

/** What an element that SVG Tiny PS doesn't allow asks of whoever uploads the logo. */
const remedies: Record<string, string> = {
  style: "Export it with presentation attributes in place of CSS, and upload it again.",
  image: "SVG Tiny PS can't hold a picture, so use a logo drawn in shapes.",
  script: "Remove its script, and upload it again.",
};

/**
 * The organization's own logo, uploaded as an SVG, as SVG Tiny PS: kept byte for byte if it is
 * square SVG Tiny PS already, so a mark certificate issued for it still matches, and otherwise converted:
 * square, with the profile's root attributes and a title, the `title` given if it has none,
 * without what says nothing to whoever sees it, such as metadata, an editor's own elements and
 * attributes, comments and event handlers. A logo with anything else the profile doesn't allow, or
 * that is too long as SVG Tiny PS, is refused, saying why.
 */
export function convertedLogo(text: string, title: string): { svg: string } | { refused: string } {
  const notSvg = { refused: "That isn't an SVG file. Duva takes a logo as SVG, since SVG Tiny PS can't hold a picture such as a PNG or a JPEG. Export your logo as SVG, and upload that." };
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > longestUpload) return { refused: `The logo is over ${longestUpload / 1024} KB. Export it as a simpler SVG, and upload that.` };
  // A DOCTYPE could define entities that the check doesn't expand and a browser would.
  const tinyPs = !text.includes("<!") && tinyPsLogo(bytes) !== undefined;

  const roots: Element[] = [];
  const open: Element[] = [];
  let leaving = 0;
  let refused: string | undefined;
  const refuse = (why: string) => void (refused ??= why);
  const parser = new Parser(
    {
      onopentag(name, attributes) {
        // An editor's own elements, like sodipodi:namedview, and metadata say nothing to whoever sees the logo.
        if (leaving > 0 || name.includes(":") || left.has(name)) return void leaving++;
        if (open.length === 0 && name !== "svg") return refuse(notSvg.refused);
        if (!kept.has(name)) return refuse(`The logo has a <${name}> element, which SVG Tiny PS doesn't allow. ${remedies[name] ?? "Export it again without one, and upload it again."}`);
        const element: Element = { name, attributes: {}, children: [] };
        for (const [attribute, value] of Object.entries(attributes)) {
          // Event handlers never run in a logo, so they go.
          if (/^on/i.test(attribute)) continue;
          const kept = keptAttribute(attribute, value);
          if (kept === "refused") return refuse(`The logo's ${attribute} refers to something outside it, ${JSON.stringify(value.slice(0, 80))}, which SVG Tiny PS doesn't allow. Export it with everything it shows inside it.`);
          if (kept) element.attributes[attribute] = value;
        }
        (open.at(-1)?.children ?? roots).push(element);
        open.push(element);
      },
      ontext(data) {
        // Space between elements says nothing, and space in text is kept.
        if (leaving === 0 && (data.trim() !== "" || spoken.has(open.at(-1)?.name ?? ""))) open.at(-1)?.children.push(data);
      },
      onclosetag(name) {
        if (leaving > 0) return void leaving--;
        if (open.at(-1)?.name === name) open.pop();
      },
    },
    { xmlMode: true, decodeEntities: true },
  );
  parser.end(text);
  if (refused !== undefined) return { refused };
  const [root] = roots;
  if (root === undefined || roots.length > 1) return notSvg;

  const box = viewBoxOf(root.attributes);
  if (box === undefined) return { refused: "The logo doesn't say its size. Give its svg element a viewBox, and upload it again." };
  if (tinyPs && box.width === box.height) return { svg: text };
  // Receivers show the logo in a square, or a circle, so a logo of another shape is centred in one.
  const side = Math.max(box.width, box.height);
  const number = (value: number) => String(Number(value.toFixed(3)));
  const { x: _x, y: _y, width: _width, height: _height, viewBox: _viewBox, preserveAspectRatio: _preserve, version: _version, baseProfile: _profile, ...others } = root.attributes;
  root.attributes = {
    xmlns: svgNamespace,
    version: "1.2",
    baseProfile: "tiny-ps",
    viewBox: [box.x - (side - box.width) / 2, box.y - (side - box.height) / 2, side, side].map(number).join(" "),
    ...others,
  };
  const titled = root.children.some((child) => typeof child !== "string" && child.name === "title" && child.children.join("").trim() !== "");
  if (!titled) {
    root.children = root.children.filter((child) => typeof child === "string" || child.name !== "title");
    root.children.unshift({ name: "title", attributes: {}, children: [title] });
  }

  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n${written(root)}\n`;
  const length = new TextEncoder().encode(svg).length;
  if (length > longestLogo) {
    return { refused: `The logo is ${Math.ceil(length / 1024)} KB as SVG Tiny PS, and BIMI allows ${longestLogo / 1024} KB. Simplify it, or export it with fewer decimals, and upload it again.` };
  }
  // What the conversion writes passes the check received logos pass.
  if (tinyPsLogo(new TextEncoder().encode(svg)) === undefined) return { refused: "Duva couldn't convert the logo to SVG Tiny PS. Export it again as a plain SVG, and upload that." };
  return { svg };
}

/** The element's viewBox, or one from its width and height, or undefined if it has neither, or an empty one. */
function viewBoxOf(attributes: Record<string, string>): { x: number; y: number; width: number; height: number } | undefined {
  const numbers = (attributes.viewBox ?? "").trim().split(/[\s,]+/).map(Number);
  if (numbers.length === 4 && numbers.every(Number.isFinite)) {
    const [x, y, width, height] = numbers as [number, number, number, number];
    return width > 0 && height > 0 ? { x, y, width, height } : undefined;
  }
  const length = (value: string | undefined) => (value !== undefined && /^\s*[\d.]+\s*(px)?\s*$/.test(value) ? Number.parseFloat(value) : Number.NaN);
  const [width, height] = [length(attributes.width), length(attributes.height)];
  return width > 0 && height > 0 ? { x: 0, y: 0, width, height } : undefined;
}

const written = (node: Element | string): string =>
  typeof node === "string"
    ? escaped(node)
    : `<${node.name}${Object.entries(node.attributes)
        .map(([name, value]) => ` ${name}="${escaped(value)}"`)
        .join("")}>${node.children.map(written).join("")}</${node.name}>`;
