// The isolated browser the mailbox agent browses in (ADR-0031, ADR-0038): AgentCore Browser in a
// deployment, a stand-in over the tests' stand-in internet in tests. Each session is a browser with
// nothing of Duva's in it, which ends when the run does: a fresh one with no cookies to unsubscribe
// in, or for Coo's own browsing, one with its human's profile, where the sites it logged in to keep
// it logged in. It never downloads a file. The agent sees each page as its text and its numbered
// elements, and acts on them by number.

/** An element of a page the agent may act on. */
export interface PageElement {
  /** Its number on the page, which the agent acts on it by. */
  index: number;
  kind: "field" | "checkbox" | "radio" | "select" | "button" | "link";
  /** What it says: its label, its text, or failing those its name. */
  label: string;
  /** For a field, its input type, as email or text. */
  type?: string;
  /** For a field, what its autocomplete attribute says it takes, as cc-number or current-password. */
  autocomplete?: string;
  /** For a link, whether it downloads what it leads to, as its download attribute says. */
  download?: boolean;
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
  /** The hosts of the page's frames, as a payment provider's card fields are in one. */
  frames?: string[];
  /** Whether the browser refused a download the last action started, as it refuses every one. */
  downloadRefused?: boolean;
}

/** A session of the browser, on one page at a time. Each action answers the page as it is after. */
export interface BrowserSession {
  open(url: string): Promise<PageView>;
  /** Types the value into the field. */
  fill(index: number, value: string): Promise<PageView>;
  /**
   * Types the value into the field as a keyboard does, through the browser, so no script Duva
   * evaluates in the page carries it, as for a secret's part (ADR-0039).
   */
  typeIn(index: number, value: string): Promise<PageView>;
  /** Checks or unchecks a checkbox, checks a radio button, or picks a select's option by its text. */
  choose(index: number, option?: string): Promise<PageView>;
  /** Clicks the button or the link, and waits for the page it leads to. */
  click(index: number): Promise<PageView>;
  /** Submits the form the element is in, as pressing Enter in it does, and waits for the page it leads to. */
  submit(index: number): Promise<PageView>;
  /** Reads the page as it is now. */
  read(): Promise<PageView>;
  /** Ends the session, keeping what it holds in its profile, if it has one. */
  close(): Promise<void>;
}

/**
 * Starts a session of the browser: with the profile of the name, created if it is the first, or
 * without one, a fresh browser.
 */
export type Browser = (options?: { profile?: string }) => Promise<BrowserSession>;

/**
 * What a second of a browsing session costs at most, in US dollars: a vCPU busy and 1.5 GB held
 * the whole time, at $0.0895 per vCPU-hour and $0.00945 per GB-hour (AgentCore's pricing in
 * eu-north-1, ADR-0038). A session bills less, since it idles while the model thinks.
 */
export const browserSecondCost = (0.0895 + 1.5 * 0.00945) / 3600;

/** The most of a page's text the agent reads, in characters. */
export const pageTextAtMost = 6000;

/** The page as the model reads it: where it is, its text, and its elements by number. */
export function describePage({ url, title, text, elements }: PageView): string {
  const element = ({ index, kind, label, type, value, checked, options, download }: PageElement) =>
    [
      `[${index}] ${kind}${type === undefined ? "" : ` (${type})`} "${label}"${download === true ? " (downloads a file)" : ""}`,
      ...(value !== undefined && value !== "" ? [`holding "${value}"`] : []),
      ...(checked === undefined ? [] : [checked ? "checked" : "not checked"]),
      ...(options === undefined ? [] : [`options: ${options.map((option) => `"${option}"`).join(", ")}`]),
    ].join(", ");
  return [`URL: ${url}`, `Title: ${title}`, "Text:", text.slice(0, pageTextAtMost), "Elements:", ...(elements.length === 0 ? ["none"] : elements.map(element))].join("\n");
}
