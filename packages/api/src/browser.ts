// The isolated browser the mailbox agent unsubscribes in (ADR-0031): AgentCore Browser in a
// deployment, a stand-in over the tests' stand-in internet in tests. Each session is a fresh
// browser with no cookies and nothing of Duva's in it, and ends when the attempt does. The agent
// sees each page as its text and its numbered elements, and acts on them by number.

/** An element of a page the agent may act on. */
export interface PageElement {
  /** Its number on the page, which the agent acts on it by. */
  index: number;
  kind: "field" | "checkbox" | "radio" | "select" | "button" | "link";
  /** What it says: its label, its text, or failing those its name. */
  label: string;
  /** For a field, its input type, as email or text. */
  type?: string;
  /** For a field, what it holds. */
  value?: string;
  /** For a checkbox or a radio button, whether it is checked. */
  checked?: boolean;
  /** For a select, its options' texts. */
  options?: string[];
}

/** A page as the agent sees it. */
export interface PageView {
  url: string;
  title: string;
  /** Its visible text, at most a few thousand characters. */
  text: string;
  elements: PageElement[];
}

/** A session of the browser, on one page at a time. Each action answers the page as it is after. */
export interface BrowserSession {
  open(url: string): Promise<PageView>;
  /** Types the value into the field. */
  fill(index: number, value: string): Promise<PageView>;
  /** Checks or unchecks a checkbox, checks a radio button, or picks a select's option by its text. */
  choose(index: number, option?: string): Promise<PageView>;
  /** Clicks the button or the link, and waits for the page it leads to. */
  click(index: number): Promise<PageView>;
  close(): Promise<void>;
}

/** Starts a session of a fresh browser. */
export type Browser = () => Promise<BrowserSession>;

/** The most of a page's text the agent reads, in characters. */
export const pageTextAtMost = 6000;

/** The page as the model reads it: where it is, its text, and its elements by number. */
export function describePage({ url, title, text, elements }: PageView): string {
  const element = ({ index, kind, label, type, value, checked, options }: PageElement) =>
    [
      `[${index}] ${kind}${type === undefined ? "" : ` (${type})`} "${label}"`,
      ...(value !== undefined && value !== "" ? [`holding "${value}"`] : []),
      ...(checked === undefined ? [] : [checked ? "checked" : "not checked"]),
      ...(options === undefined ? [] : [`options: ${options.map((option) => `"${option}"`).join(", ")}`]),
    ].join(", ");
  return [`URL: ${url}`, `Title: ${title}`, "Text:", text.slice(0, pageTextAtMost), "Elements:", ...(elements.length === 0 ? ["none"] : elements.map(element))].join("\n");
}
