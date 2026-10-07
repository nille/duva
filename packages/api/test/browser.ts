// A stand-in for AgentCore Browser: a browser over the stand-in internet that reads a page's HTML
// as the page script does in a real one, its text and its numbered elements, and fills in and
// submits its forms as a browser would, without scripts or cookies. So a test's web server sees
// what the agent sent, and answers it with the page it leads to.
import { Parser } from "htmlparser2";
import type { BrowserSession, PageElement, PageView } from "../src/browser.ts";
import { type Network, sendPublic } from "../src/internet.ts";
import { pageTextAtMost } from "../src/browser.ts";

/** A form's control as parsed, with what it submits. */
interface Control extends PageElement {
  name?: string;
  /** For a checkbox, a radio button or a button, what it submits; for a select, its options' values. */
  submits?: string;
  values?: string[];
  form?: number;
  href?: string;
  hidden?: boolean;
}

interface Page {
  url: string;
  title: string;
  text: string;
  controls: Control[];
  forms: { action: string; method: string }[];
}

/** How many redirects one request follows. */
const redirectsFollowed = 5;

/** Sessions of the stand-in browser, each of them fresh, and the URLs each opened, in order. */
export function standInBrowser(network: Network) {
  const visited: string[] = [];
  const start = async (): Promise<BrowserSession> => {
    let page: Page | undefined;
    const go = async (url: URL, method = "GET", body?: string): Promise<PageView> => {
      for (let redirects = 0; ; redirects++) {
        visited.push(url.href);
        const answer = await sendPublic(network, url, {
          method: method as "GET",
          schemes: ["http:", "https:"],
          headers: { "user-agent": "Mozilla/5.0 (stand-in browser)", ...(body !== undefined && { "content-type": "application/x-www-form-urlencoded" }) },
          ...(body !== undefined && { body }),
          maxBytes: 1_000_000,
          signal: AbortSignal.timeout(5_000),
        });
        if (typeof answer === "string") throw new Error(`The browser refused ${url.href}: ${answer}`);
        if ([301, 302, 303, 307, 308].includes(answer.status) && answer.location !== undefined && redirects < redirectsFollowed) {
          if (answer.status !== 307 && answer.status !== 308) {
            method = "GET";
            body = undefined;
          }
          url = new URL(answer.location, url);
          continue;
        }
        page = parsePage(url.href, new TextDecoder().decode(answer.body));
        return viewOf(page);
      }
    };
    const control = (index: number) => {
      const found = page?.controls.find((each) => !each.hidden && each.index === index);
      if (found === undefined) throw new Error(`The page has no element ${index}.`);
      return found;
    };
    return {
      open: (url) => go(new URL(url)),
      async fill(index, value) {
        control(index).value = value;
        return viewOf(page!);
      },
      async choose(index, option) {
        const chosen = control(index);
        if (chosen.kind === "checkbox") chosen.checked = !chosen.checked;
        else if (chosen.kind === "radio") {
          for (const each of page!.controls) if (each.kind === "radio" && each.name === chosen.name && each.form === chosen.form) each.checked = false;
          chosen.checked = true;
        } else if (chosen.kind === "select") {
          const at = chosen.options?.indexOf(option ?? "") ?? -1;
          if (at < 0) throw new Error("The select has no such option.");
          chosen.value = chosen.values![at];
        }
        return viewOf(page!);
      },
      async click(index) {
        const clicked = control(index);
        if (clicked.kind === "link") return go(new URL(clicked.href!, page!.url));
        if (clicked.form === undefined) return viewOf(page!);
        const form = page!.forms[clicked.form]!;
        const fields = new URLSearchParams();
        for (const each of page!.controls) {
          if (each.form !== clicked.form || each.name === undefined) continue;
          if (each.kind === "checkbox" || each.kind === "radio") {
            if (each.checked) fields.append(each.name, each.submits ?? "on");
          } else if (each.kind === "button") {
            if (each === clicked) fields.append(each.name, each.submits ?? "");
          } else fields.append(each.name, each.value ?? "");
        }
        const action = new URL(form.action || page!.url, page!.url);
        if (form.method === "POST") return go(action, "POST", fields.toString());
        action.search = fields.toString();
        return go(action);
      },
      async close() {},
    };
  };
  return { start, visited };
}

const viewOf = ({ url, title, text, controls }: Page): PageView => ({
  url,
  title,
  text,
  elements: controls.filter(({ hidden }) => !hidden).map(({ index, kind, label, type, value, checked, options }) => ({ index, kind, label, ...(type !== undefined && { type }), ...(value !== undefined && kind === "field" && { value }), ...(checked !== undefined && { checked }), ...(options !== undefined && { options }) })),
});

/** The page as a browser without scripts shows it. */
function parsePage(url: string, html: string): Page {
  const controls: Control[] = [];
  const forms: Page["forms"] = [];
  const labels = new Map<string, string>();
  let title = "";
  let text = "";
  let form: number | undefined;
  let skipping = 0;
  let inTitle = false;
  // The element whose text is being read: a label, a button, a link, an option or a select's.
  let reading: { control?: Control; label?: { for?: string; text: string; controls: Control[] } } = {};
  const words = (value: string) => value.replace(/\s+/g, " ").trim();
  let option: { value?: string; text: string } | undefined;
  let select: Control | undefined;
  const add = (control: Omit<Control, "index">) => {
    // Only what shows is numbered, as the page script numbers it.
    const index = control.hidden ? 0 : controls.filter(({ hidden }) => !hidden).length + 1;
    const added = { ...control, index, ...(form !== undefined && { form }) } as Control;
    controls.push(added);
    reading.label?.controls.push(added);
    return added;
  };
  const parser = new Parser(
    {
      onopentag(name, attributes) {
        if (name === "script" || name === "style") skipping++;
        if (name === "title") inTitle = true;
        if (name === "form") {
          forms.push({ action: attributes.action ?? "", method: (attributes.method ?? "get").toUpperCase() });
          form = forms.length - 1;
        }
        if (name === "label") reading = { label: { for: attributes.for, text: "", controls: [] } };
        const type = (attributes.type ?? "").toLowerCase();
        const named = attributes["aria-label"] ?? attributes.placeholder ?? attributes.name ?? "";
        if (name === "input") {
          if (type === "hidden") add({ kind: "field", label: "", name: attributes.name, value: attributes.value ?? "", hidden: true });
          else if (type === "checkbox" || type === "radio") Object.assign(add({ kind: type, label: named, name: attributes.name, submits: attributes.value, checked: "checked" in attributes }), { id: attributes.id });
          else if (["submit", "button", "image", "reset"].includes(type)) add({ kind: "button", label: attributes.value ?? named, name: attributes.name, submits: attributes.value });
          else Object.assign(add({ kind: "field", label: named, type: type || "text", name: attributes.name, value: attributes.value ?? "" }), { id: attributes.id });
        }
        if (name === "textarea") add({ kind: "field", label: named, type: "textarea", name: attributes.name, value: "" });
        if (name === "button") reading = { ...reading, control: add({ kind: "button", label: "", name: attributes.name, submits: attributes.value }) };
        if (name === "a" && attributes.href !== undefined) reading = { ...reading, control: add({ kind: "link", label: "", href: attributes.href }) };
        if (name === "select") select = add({ kind: "select", label: named, name: attributes.name, options: [], values: [] });
        if (name === "option") option = { value: attributes.value, text: "" };
      },
      ontext(data) {
        if (skipping > 0) return;
        if (inTitle) title += data;
        else text += data;
        if (reading.control !== undefined) reading.control.label += data;
        if (reading.label !== undefined) reading.label.text += data;
        if (option !== undefined) option.text += data;
      },
      onclosetag(name) {
        if (name === "script" || name === "style") skipping--;
        if (name === "title") inTitle = false;
        if (name === "form") form = undefined;
        if (["p", "div", "h1", "h2", "h3", "li", "br", "form", "label"].includes(name)) text += "\n";
        if ((name === "button" || name === "a") && reading.control !== undefined) {
          reading.control.label = words(reading.control.label);
          reading = { ...reading, control: undefined };
        }
        if (name === "label" && reading.label !== undefined) {
          const label = words(reading.label.text);
          if (reading.label.for !== undefined) labels.set(reading.label.for, label);
          for (const each of reading.label.controls) if (each.kind !== "button" && each.kind !== "link") each.label = label;
          reading = {};
        }
        if (name === "option" && option !== undefined && select !== undefined) {
          select.options!.push(words(option.text));
          select.values!.push(option.value ?? words(option.text));
          select.value ??= select.values![0];
          option = undefined;
        }
        if (name === "select") select = undefined;
      },
    },
    { decodeEntities: true },
  );
  parser.write(html);
  parser.end();
  // A label naming its control by ID may come after it.
  for (const each of controls) {
    const id = (each as Control & { id?: string }).id;
    if (id !== undefined && labels.has(id)) each.label = labels.get(id)!;
    delete (each as Control & { id?: string }).id;
  }
  return { url, title: words(title), text: text.split("\n").map(words).filter(Boolean).join("\n").slice(0, pageTextAtMost), controls, forms };
}
