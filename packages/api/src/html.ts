// Serving a message's HTML (ADR-0017). It is made safe to show each time it is served, so the
// stored message stays as it came and a newer tracker list reaches old mail too: only elements and
// attributes known to be harmless are kept, which leaves out scripts, event handlers, forms,
// frames, objects and `javascript:` links, and known trackers are removed and listed.
import sanitizeHtml from "sanitize-html";
import { knownTrackers, listedNames } from "./trackers.ts";

/** The HTML as Duva serves it, and the trackers removed from it. */
export interface ServedHtml {
  html: string;
  removedTrackers: string[];
}

const trackerPatterns = knownTrackers.flatMap(([service, patterns]) => patterns.map((pattern) => [service, new RegExp(pattern, "i")] as const));

/**
 * The patterns of the services MailTrackerBlocker also looks for in CSS, where any image's URL can
 * be. Only these, as its other patterns would find ordinary background images there.
 */
const cssTrackerPatterns = ["Email on Acid", "Litmus", "Escalent", "G-Lock Analytics"].map((service) => [service, new RegExp(knownTrackers.find(([each]) => each === service)![1][0]!, "i")] as const);

/** What a removed image that no tracker pattern names is listed as. */
const hiddenImage = "a hidden image";

/** Whether the length, as an attribute or a CSS value gives it, is nothing, or 1 pixel. */
function atMostOnePixel(length: string): boolean {
  const value = length.replace(/!important/i, "").trim().toLowerCase();
  return /^(0+(\.0*)?|\.0+)([a-z%]+)?$/.test(value) || /^0*1(\.0*)?(px)?$/.test(value);
}

/** Whether the image is hidden by its attributes or style, or 0 or 1 pixel wide or high. */
function isHidden(attributes: Record<string, string>): boolean {
  if ("hidden" in attributes) return true;
  if ([attributes.width, attributes.height].some((length) => length !== undefined && atMostOnePixel(length))) return true;
  return (attributes.style ?? "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(";")
    .some((declaration) => {
      const [property = "", value = ""] = declaration.split(":").map((part) => part.trim().toLowerCase());
      if (property === "display") return value.startsWith("none");
      if (property === "visibility") return /^(hidden|collapse)\b/.test(value);
      if (property === "opacity") return Number.parseFloat(value) === 0;
      return ["width", "height", "max-width", "max-height"].includes(property) && atMostOnePixel(value);
    });
}

const isOwnPart = (url: string) => /^\s*cid:/i.test(url);

/** The Content-ID a `cid:` URL refers to, without its angle brackets (RFC 2392). */
function contentIdOf(url: string): string {
  const id = url.trim().slice(4);
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
}

/** The Content-IDs the HTML's `cid:` URLs refer to, without their angle brackets. */
export const contentIdsIn = (html: string) => [...new Set([...html.matchAll(/cid:[^"'\s)>]+/gi)].map(([url]) => contentIdOf(url)))];

/** A URL that runs something, or is data other than an image. */
const isUnsafe = (url: string) => /^\s*(javascript|vbscript):|^\s*data:(?!image\/)/i.test(url);

/** The URLs in the CSS's url() values, in double quotes, single quotes or none, with any parentheses they hold. */
const cssUrl = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^"'\s()]*(?:\([^"'\s()]*\)[^"'\s()]*)*))\s*\)/gi;

/**
 * The HTML made safe to show, with known trackers removed. Each `cid:` URL leads where `linkTo`
 * says the part with that Content-ID can be had, or is dropped if it can't.
 */
export function serveHtml(html: string, linkTo: (contentId: string) => string | undefined): ServedHtml {
  const removedTrackers: string[] = [];
  // An image of the message's own is no tracker, however small.
  const ownImages = new Set<string>();
  /** The service of the first known tracker the URL leads to, listed as removed, if it leads to one. */
  const trackerRemoved = (url: string, patterns = trackerPatterns) => {
    const service = patterns.find(([, pattern]) => pattern.test(url))?.[0];
    if (service !== undefined) removedTrackers.push(listedNames[service] ?? service);
    return service;
  };
  /** The URL with a `cid:` URL leading to its part, or undefined if it can't be had. */
  const resolved = (url: string) => (isOwnPart(url) ? linkTo(contentIdOf(url)) : url);
  /** The CSS with each URL that runs something or is a known tracker gone, and its `cid:` URLs resolved. */
  const cleanCss = (css: string) =>
    css
      .replace(cssUrl, (value, ...quoted: (string | undefined)[]) => {
        const url = quoted.slice(0, 3).find((each) => each !== undefined) ?? "";
        const link = resolved(url);
        if (link === undefined || isUnsafe(link) || trackerRemoved(link, cssTrackerPatterns) !== undefined) return "none";
        return link === url ? value : `url("${link}")`;
      })
      // A URL that runs something has no business in CSS, even where it isn't one a browser would read.
      .replace(/(javascript|vbscript)\s*:/gi, "");
  // htmlparser2 ends a style element's CSS at the first </style, as this does.
  const withCleanStyles = html.replace(/(<style\b[^>]*>)([\s\S]*?)(?=<\/style)/gi, (_, start: string, css: string) => start + cleanCss(css));
  // @types/sanitize-html doesn't know allowedEmptyAttributes yet.
  const options: sanitizeHtml.IOptions & { allowedEmptyAttributes: string[] } = {
    allowedTags: [...sanitizeHtml.defaults.allowedTags, "img", "style", "link", "font", "center", "big", "strike", "tt"],
    allowVulnerableTags: true,
    // A style is the sender's design, kept as written but for the URLs cleanCss removes.
    parseStyleAttributes: false,
    nonTextTags: ["script", "style", "textarea", "option", "xmp", "title", "button", "select"],
    allowedAttributes: {
      "*": ["style", "class", "id", "dir", "lang", "title", "align", "valign", "width", "height", "bgcolor", "background", "border", "color", "nowrap", "hidden", "role", "aria-*"],
      a: ["href", "name", "target"],
      img: ["src", "srcset", "alt", "hspace", "vspace"],
      link: ["rel", "href", "media", "type"],
      font: ["face", "size"],
      table: ["cellpadding", "cellspacing", "frame", "rules", "summary"],
      td: ["colspan", "rowspan", "abbr", "headers", "scope"],
      th: ["colspan", "rowspan", "abbr", "headers", "scope"],
      col: ["span"],
      colgroup: ["span"],
      ol: ["start", "type", "reversed"],
      ul: ["type"],
      li: ["value", "type"],
    },
    allowedEmptyAttributes: ["alt", "hidden", "nowrap"],
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesByTag: { img: ["http", "https", "data"], link: ["http", "https"] },
    transformTags: {
      body: "div",
      img: (tagName, { src, srcset, ...others }) => {
        const link = src === undefined ? undefined : resolved(src);
        if (src !== undefined && isOwnPart(src) && link !== undefined) ownImages.add(link);
        const keepsSource = link !== undefined && !isUnsafe(link);
        const keepsSet = srcset !== undefined && !/data:(?!image\/)/i.test(srcset);
        return { tagName, attribs: { ...(keepsSource && { src: link }), ...(keepsSet && { srcset }), ...others } };
      },
      "*": (tagName, { background, style, ...others }) => {
        const link = background === undefined ? undefined : resolved(background);
        const keepsBackground = link !== undefined && trackerRemoved(link, cssTrackerPatterns) === undefined;
        return { tagName, attribs: { ...(keepsBackground && { background: link }), ...(style !== undefined && { style: cleanCss(style) }), ...others } };
      },
    },
    exclusiveFilter: ({ tag, attribs }) => {
      // A link is kept only to load a stylesheet, for the fonts most newsletters load that way.
      if (tag === "link") return !/\bstylesheet\b/i.test(attribs.rel ?? "") || attribs.href === undefined;
      if (tag !== "img" || ownImages.has(attribs.src ?? "")) return false;
      const urls = [attribs.src ?? "", ...(attribs.srcset ?? "").split(",").map((candidate) => candidate.trim().split(/\s+/)[0] ?? "")].filter((url) => url !== "");
      if (urls.some((url) => trackerRemoved(url) !== undefined)) return true;
      if (!isHidden(attribs)) return false;
      removedTrackers.push(hiddenImage);
      return true;
    },
  };
  const served = sanitizeHtml(withCleanStyles, options);
  return { html: served.trim(), removedTrackers };
}
