// HTML mail, shown as its sender designed it, on the reader's paper in a frame of its own (ADR-0017).
// Duva's API has already removed its scripts, handlers, forms and known trackers. The frame is
// defence in depth: its sandbox never allows scripts, and its own policy refuses them, so nothing
// in the mail runs, whatever the sanitizer misses. It shares the page's origin, which without
// scripts gives the mail nothing, so the page can read how tall the mail is and fit the frame to it.
import { useEffect, useMemo, useRef, useState } from "react";
import { strings } from "./strings.ts";

/** Images and fonts load from anywhere, and stylesheets over https, and nothing else does. */
const policy = ["default-src 'none'", "script-src 'none'", "img-src * data:", "font-src * data:", "style-src https: 'unsafe-inline'"].join("; ");

/**
 * The paper the mail lies on, the reader's grey and Ink, before its own styles, which come after
 * and win. Mail without styles is set in the page's mono, as text mail is, from the faces the page
 * has loaded, since a frame doesn't share them.
 */
function paper(): string {
  const page = getComputedStyle(document.documentElement);
  const token = (name: string, otherwise: string) => page.getPropertyValue(name).trim() || otherwise;
  const faces = [...document.styleSheets]
    .flatMap((sheet) => [...sheet.cssRules])
    .filter((rule) => rule instanceof CSSFontFaceRule && rule.style.getPropertyValue("font-family").includes("JetBrains Mono"))
    .map((rule) => rule.cssText);
  return `${faces.join(" ")} html { color-scheme: light; background: ${token("--read", "#f8f8f6")}; color: ${token("--ink", "#161616")}; } body { margin: 0; font: 0.875rem / 1.7 ${token("--mono", "monospace")}; font-variant-ligatures: contextual common-ligatures; overflow-wrap: break-word; }`;
}

/** Where a quote the mail cites starts: Gmail's, and Apple Mail's and Thunderbird's. */
const cited = ".gmail_quote, blockquote[type=cite]";

/** Marks the quote that folds, by an attribute the mail's own can't be taken for. */
const folded = "data-duva-folded";

/**
 * The frame's document for the HTML, and whether it has a quote at its end that can fold. Links
 * open in a new tab that can't reach the page, and neither they nor images say where they came from.
 * A link that would lead into Duva leads nowhere.
 */
function documentFor(html: string): { srcdoc: string; folds: boolean } {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const head = [
    Object.assign(doc.createElement("meta"), { httpEquiv: "Content-Security-Policy", content: policy }),
    Object.assign(doc.createElement("meta"), { name: "referrer", content: "no-referrer" }),
    Object.assign(doc.createElement("meta"), { name: "color-scheme", content: "light" }),
    Object.assign(doc.createElement("base"), { target: "_blank" }),
    Object.assign(doc.createElement("style"), { textContent: paper() }),
  ];
  doc.head.prepend(...head);
  for (const link of doc.body.querySelectorAll("a[href]")) {
    // A link without a scheme of its own would lead into Duva, in a tab outside the sandbox.
    if (!/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(link.getAttribute("href")!.trim())) link.removeAttribute("href");
    link.setAttribute("target", "_blank");
    link.setAttribute("rel", "noopener noreferrer");
  }
  for (const marked of doc.querySelectorAll(`[${folded}]`)) marked.removeAttribute(folded);
  // A quote folds only when nothing the sender wrote follows it. A reply written between quotes shows as written.
  const quote = doc.body.querySelector(cited);
  let folds = false;
  if (quote !== null) {
    const after = doc.createRange();
    after.setStartAfter(quote);
    after.setEnd(doc.body, doc.body.childNodes.length);
    const rest = after.cloneContents();
    folds = rest.textContent?.trim() === "" && rest.querySelector("img") === null;
    if (folds) quote.setAttribute(folded, "");
  }
  return { srcdoc: `<!doctype html>${doc.documentElement.outerHTML}`, folds };
}

/**
 * The message's HTML in its frame, as tall as the mail, with a quote at its end folded behind
 * "Show quoted text". `title` names the frame for a screen reader.
 */
export function DesignedBody({ html, title }: { html: string; title: string }) {
  // The HTML as it was when it came on screen. Each read of the thread gives new links to the
  // message's own images, and taking them would load the whole frame again.
  const [shown] = useState(html);
  const { srcdoc, folds } = useMemo(() => documentFor(shown), [shown]);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const [mail, setMail] = useState<Document>();

  // The frame first holds an empty document, then the mail's, which has its policy, once it is parsed.
  useEffect(() => {
    let waiting = requestAnimationFrame(function check() {
      const doc = frame.current?.contentDocument;
      if (doc?.readyState !== "loading" && doc?.querySelector('meta[http-equiv="Content-Security-Policy"]')) setMail(doc);
      else waiting = requestAnimationFrame(check);
    });
    return () => cancelAnimationFrame(waiting);
  }, []);

  // The frame follows the mail's size as its images and fonts load, and as the sheet's width changes.
  useEffect(() => {
    const element = frame.current;
    if (mail === undefined || element === null) return;
    const root = mail.documentElement;
    const fit = () => {
      // Mail laid out wider than the sheet, as newsletters are on a phone, shrinks to fit it.
      root.style.removeProperty("zoom");
      if (root.scrollWidth > root.clientWidth) root.style.setProperty("zoom", String(root.clientWidth / root.scrollWidth));
      // Measured with no height of its own, the mail is as tall as what it holds, even when its styles fill the frame.
      element.style.height = "0";
      element.style.height = `${root.scrollHeight}px`;
    };
    const observer = new ResizeObserver(fit);
    observer.observe(root);
    observer.observe(mail.body);
    element.addEventListener("load", fit);
    fit();
    return () => {
      observer.disconnect();
      element.removeEventListener("load", fit);
    };
  }, [mail]);

  useEffect(() => {
    const quote = mail?.querySelector<HTMLElement>(`[${folded}]`);
    if (quote) quote.style.setProperty("display", quoteOpen ? "" : "none", quoteOpen ? "" : "important");
  }, [mail, quoteOpen]);

  return (
    <div className="letter-designed">
      <iframe ref={frame} title={title} sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" srcDoc={srcdoc} />
      {folds && (
        <button type="button" className="link quote-toggle" aria-expanded={quoteOpen} onClick={() => setQuoteOpen(!quoteOpen)}>
          {quoteOpen ? strings.thread.hideQuoted : strings.thread.showQuoted}
        </button>
      )}
    </div>
  );
}
