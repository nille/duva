// A stand-in for AgentCore Browser: a browser over the stand-in internet that reads a page's HTML
// as the page script does in a real one, its text and its numbered elements, and fills in and
// submits its forms as a browser would, without scripts. A session with a profile keeps cookies,
// by host, and saves them back to the profile as it ends, as AgentCore's profiles do; a session
// without one starts with none. It refuses every download, as the browser's policy does, staying
// on its page. So a test's web server sees what the agent sent, and answers it with the page it
// leads to.
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
  frames: string[];
}

/** How many redirects one request follows. */
const redirectsFollowed = 5;

/** Cookies by host, each by name. */
type Cookies = Map<string, Map<string, string>>;

const copied = (cookies: Cookies): Cookies => new Map([...cookies].map(([host, each]) => [host, new Map(each)]));

/**
 * Sessions of the stand-in browser, the URLs each opened, in order, and its profiles by name:
 * those created, and what each saved.
 */
export function standInBrowser(network: Network) {
  const visited: string[] = [];
  const profiles = new Map<string, Cookies>();
  const start = async ({ profile }: { profile?: string } = {}): Promise<BrowserSession> => {
    if (profile !== undefined && !profiles.has(profile)) profiles.set(profile, new Map());
    const cookies = copied(profile === undefined ? new Map() : profiles.get(profile)!);
    let page: Page | undefined;
    const go = async (url: URL, method = "GET", body?: string): Promise<PageView> => {
      for (let redirects = 0; ; redirects++) {
        visited.push(url.href);
        const sent = [...(cookies.get(url.hostname) ?? [])].map(([name, value]) => `${name}=${value}`).join("; ");
        const answer = await sendPublic(network, url, {
          method: method as "GET",
          schemes: ["http:", "https:"],
          headers: { "user-agent": "Mozilla/5.0 (stand-in browser)", ...(body !== undefined && { "content-type": "application/x-www-form-urlencoded" }), ...(sent !== "" && { cookie: sent }) },
          ...(body !== undefined && { body }),
          maxBytes: 1_000_000,
          signal: AbortSignal.timeout(5_000),
        });
        if (typeof answer === "string") throw new Error(`The browser refused ${url.href}: ${answer}`);
        const setCookie = answer.headers?.["set-cookie"] ?? [];
        for (const line of Array.isArray(setCookie) ? setCookie : [setCookie]) {
          const [pair = "", ...attributes] = line.split(";");
          const [name = "", ...value] = pair.trim().split("=");
          if (!cookies.has(url.hostname)) cookies.set(url.hostname, new Map());
          if (attributes.some((attribute) => /^\s*max-age\s*=\s*0\s*$/i.test(attribute))) cookies.get(url.hostname)!.delete(name);
          else cookies.get(url.hostname)!.set(name, value.join("="));
        }
        // A file, by its type or as an attachment, is a download, which the policy refuses: the page stays.
        const type = String(answer.headers?.["content-type"] ?? "text/html");
        if (/attachment/i.test(String(answer.headers?.["content-disposition"] ?? "")) || !/^text\/(html|plain)/i.test(type)) {
          if (page === undefined) throw new Error(`The browser refused to download ${url.href}.`);
          return { ...viewOf(page), downloadRefused: true };
        }
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
      // Keys typed land in the field as a script's value does here, since the stand-in runs no scripts.
      async typeIn(index, value) {
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
        return submitted(clicked);
      },
      async submit(index) {
        return submitted(control(index));
      },
      read: async () => viewOf(page!),
      async close() {
        if (profile !== undefined && profiles.has(profile)) profiles.set(profile, copied(cookies));
      },
    };
    // The form the control is in, submitted: by the control, if it is a button, as a click on it does.
    async function submitted(clicked: Control): Promise<PageView> {
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
    }
  };
  return { start, visited, profiles };
}

const viewOf = ({ url, title, text, controls, frames }: Page): PageView => ({
  url,
  title,
  text,
  elements: controls
    .filter(({ hidden }) => !hidden)
    .map(({ index, kind, label, type, value, checked, options, autocomplete, download }) => ({
      index,
      kind,
      label,
      ...(type !== undefined && { type }),
      ...(value !== undefined && kind === "field" && { value }),
      ...(checked !== undefined && { checked }),
      ...(options !== undefined && { options }),
      ...(autocomplete !== undefined && { autocomplete }),
      ...(download === true && { download }),
    })),
  ...(frames.length > 0 && { frames }),
});

/** The page as a browser without scripts shows it. */
function parsePage(url: string, html: string): Page {
  const controls: Control[] = [];
  const forms: Page["forms"] = [];
  const frames: string[] = [];
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
        if (name === "iframe" && attributes.src !== undefined) frames.push(new URL(attributes.src, url).hostname);
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
          else Object.assign(add({ kind: "field", label: named, type: type || "text", name: attributes.name, value: attributes.value ?? "", ...(attributes.autocomplete !== undefined && { autocomplete: attributes.autocomplete.toLowerCase() }) }), { id: attributes.id });
        }
        if (name === "textarea") add({ kind: "field", label: named, type: "textarea", name: attributes.name, value: "" });
        if (name === "button") reading = { ...reading, control: add({ kind: "button", label: "", name: attributes.name, submits: attributes.value }) };
        if (name === "a" && attributes.href !== undefined) reading = { ...reading, control: add({ kind: "link", label: "", href: attributes.href, ...("download" in attributes && { download: true }) }) };
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
  return { url, title: words(title), text: text.split("\n").map(words).filter(Boolean).join("\n").slice(0, pageTextAtMost), controls, forms, frames };
}
