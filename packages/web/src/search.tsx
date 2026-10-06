// Searching the open mailbox: a box in the bar, which `/` puts the cursor in, with a menu that builds
// the filters into what is typed, and the results, best match or newest first, a page at a time, each
// a thread with the words highlighted in its snippet. Opening one goes to the message that matched.
import { type FormEvent, type ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import type { DuvaClient } from "@duva/client";
import type { components } from "@duva/openapi";
import { SkeletonIndex, ThreadLine } from "./inbox.tsx";
import { type Label, ownLabelsOf } from "./organize.tsx";
import { strings } from "./strings.ts";
import { hrefOf, type SearchView, threadHref } from "./views.tsx";

type Mailbox = components["schemas"]["Mailbox"];
type SearchResult = components["schemas"]["SearchResult"];

/** The filters the menu builds, each as the search box has it. */
interface Filters {
  from: string;
  to: string;
  label: string;
  attachment: boolean;
  unread: boolean;
  /** Days as YYYY-MM-DD. */
  after: string;
  before: string;
}

/**
 * What is typed, split into the filters the menu builds, the first of each, and the rest as typed.
 * It splits as Duva does: at white space outside quotes, a filter's value quoted or not.
 */
function filtersOf(q: string): { rest: string; filters: Filters } {
  const filters: Filters = { from: "", to: "", label: "", attachment: false, unread: false, after: "", before: "" };
  const rest: string[] = [];
  const taken = new Set<string>();
  const pattern = /\s*((?:([A-Za-z]+):)?(?:"([^"]*)"?|(\S+))?)/gy;
  for (let match = pattern.exec(q); match !== null && match[0] !== ""; match = pattern.exec(q)) {
    const [, raw = "", given, quoted, bare] = match;
    if (raw === "") continue;
    const filter = given?.toLowerCase();
    const value = (quoted ?? bare ?? "").trim();
    const take = (name: string, fill: () => void) => {
      if (taken.has(name) || value === "") return false;
      taken.add(name);
      fill();
      return true;
    };
    const filled =
      filter === "from" || filter === "to" || filter === "label" || filter === "after" || filter === "before"
        ? take(filter, () => (filters[filter] = value))
        : filter === "has" && value.toLowerCase() === "attachment"
          ? take(filter, () => (filters.attachment = true))
          : filter === "is" && value.toLowerCase() === "unread" && take(filter, () => (filters.unread = true));
    if (!filled) rest.push(raw);
  }
  return { rest: rest.join(" "), filters };
}

/** What to search for: the rest as typed, then the filters, in the order the menu lists them. */
function withFilters(rest: string, filters: Filters): string {
  const quote = (value: string) => (/[\s"]/.test(value) ? `"${value.replaceAll('"', "")}"` : value);
  return [
    rest.trim(),
    filters.from.trim() && `from:${quote(filters.from.trim())}`,
    filters.to.trim() && `to:${quote(filters.to.trim())}`,
    filters.label && `label:${quote(filters.label)}`,
    filters.attachment && "has:attachment",
    filters.unread && "is:unread",
    filters.after && `after:${filters.after}`,
    filters.before && `before:${filters.before}`,
  ]
    .filter(Boolean)
    .join(" ");
}

/** When each mailbox's search was last warmed, so focusing the box again soon sends nothing. */
const warmed = new Map<string, number>();

/** How long a warmed search Lambda is taken to stay warm. Lambda keeps an idle one for some minutes. */
const warmFor = 60_000;

/**
 * Starts the search Lambda and opens the mailbox's index before the human's first search, which then
 * starts fast. ADR-0007 kept a warm-up for when the cold target fails, but spec #60 asks for one when
 * the box gets focus. It asks for the Inbox's newest thread, a search as cheap as any, since Duva
 * searches nothing without words or a filter.
 */
function warm(client: DuvaClient, mailbox: string) {
  const now = Date.now();
  if (now - (warmed.get(mailbox) ?? 0) < warmFor) return;
  warmed.set(mailbox, now);
  void client.GET("/mailboxes/{mailbox}/search", { params: { path: { mailbox }, query: { q: "label:inbox", limit: 1 } } }).catch(() => undefined);
}

/**
 * The bar's search box, for the mailbox whose Inbox is at `base`, the human's own or, with the
 * agent's name, an agent's they sponsor. `current` is the search open now, or the one the thread
 * shown was opened from, which the box shows. `labels` are the mailbox's, for the filter menu.
 */
export function SearchBox({ client, mailbox, base, agent, labels, current }: { client: DuvaClient; mailbox: Mailbox; base: string; agent?: string; labels: Label[]; current?: SearchView["search"] }) {
  const [value, setValue] = useState(current?.q ?? "");
  // The filters chosen in the menu while it is open.
  const [chosen, setChosen] = useState<Filters>();
  const box = useRef<HTMLInputElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const wrapper = useRef<HTMLFormElement>(null);
  const panelId = useId();
  const shown = current?.q;
  useEffect(() => setValue(shown ?? ""), [shown]);

  // `/` puts the cursor in the box from anywhere but a field, as in other mail apps.
  useEffect(() => {
    const pressed = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return;
      if (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable]")) return;
      event.preventDefault();
      box.current?.focus();
    };
    document.addEventListener("keydown", pressed);
    return () => document.removeEventListener("keydown", pressed);
  }, []);

  const open = chosen !== undefined;
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setChosen(undefined);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  const close = () => {
    setChosen(undefined);
    button.current?.focus();
  };

  // With the menu open, the search is what is typed with the menu's filters in place of those typed.
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const q = (chosen === undefined ? value : withFilters(filtersOf(value).rest, chosen)).trim();
    if (q === "") return;
    setValue(q);
    setChosen(undefined);
    location.hash = hrefOf({ search: { q, sort: "relevance" } }, base);
  };

  // A label typed that the mailbox doesn't have stays among the choices, so Duva can say so.
  const choices = [...labels.map(({ name }) => name), ...(chosen !== undefined && chosen.label !== "" && !labels.some(({ name }) => name === chosen.label) ? [chosen.label] : [])];
  const choose = (change: Partial<Filters>) => setChosen((current) => (current === undefined ? current : { ...current, ...change }));
  return (
    <form
      ref={wrapper}
      role="search"
      className="search"
      onSubmit={submit}
      onKeyDown={(event) => {
        if (event.key === "Escape" && chosen !== undefined) {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    >
      <span className="search-field">
        <SearchIcon />
        <input
          ref={box}
          type="search"
          aria-label={strings.search.box(agent)}
          placeholder={strings.search.box(agent)}
          value={value}
          autoComplete="off"
          enterKeyHint="search"
          onChange={(event) => setValue(event.target.value)}
          onFocus={() => warm(client, mailbox.id)}
        />
      </span>
      <button
        ref={button}
        type="button"
        className="button button-small button-quiet search-filters"
        aria-expanded={chosen !== undefined}
        aria-controls={panelId}
        onClick={() => (chosen === undefined ? setChosen(filtersOf(value).filters) : setChosen(undefined))}
      >
        <FiltersIcon />
        {strings.search.filters}
      </button>
      {chosen !== undefined && (
        <div className="picker-panel search-panel" id={panelId} role="group" aria-label={strings.search.filters}>
          <FilterField label={strings.search.from} hint={strings.search.nameOrAddress} value={chosen.from} onChange={(from) => choose({ from })} autoFocus />
          <FilterField label={strings.search.to} hint={strings.search.nameOrAddress} value={chosen.to} onChange={(to) => choose({ to })} />
          <FilterLabel label={strings.search.label}>
            {(id) => (
              <select id={id} value={chosen.label} onChange={(event) => choose({ label: event.target.value })}>
                <option value="">{strings.search.anyLabel}</option>
                {choices.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            )}
          </FilterLabel>
          <div className="search-dates">
            <FilterLabel label={strings.search.after}>{(id) => <input id={id} type="date" value={chosen.after} onChange={(event) => choose({ after: event.target.value })} />}</FilterLabel>
            <FilterLabel label={strings.search.before}>{(id) => <input id={id} type="date" value={chosen.before} onChange={(event) => choose({ before: event.target.value })} />}</FilterLabel>
          </div>
          <label className="search-check">
            <input type="checkbox" checked={chosen.attachment} onChange={(event) => choose({ attachment: event.target.checked })} />
            {strings.search.attachment}
          </label>
          <label className="search-check">
            <input type="checkbox" checked={chosen.unread} onChange={(event) => choose({ unread: event.target.checked })} />
            {strings.search.unread}
          </label>
          <div className="search-panel-actions">
            <button type="submit" className="button button-small button-primary">
              {strings.search.search}
            </button>
            <button type="button" className="button button-small button-quiet" onClick={close}>
              {strings.search.cancel}
            </button>
          </div>
        </div>
      )}
    </form>
  );
}

function FilterLabel({ label, hint, children }: { label: string; hint?: string; children: (id: string, hintId?: string) => ReactNode }) {
  const id = useId();
  const hintId = useId();
  return (
    <div className="search-filter">
      <label htmlFor={id}>{label}</label>
      {children(id, hint === undefined ? undefined : hintId)}
      {hint !== undefined && (
        <p className="hint" id={hintId}>
          {hint}
        </p>
      )}
    </div>
  );
}

function FilterField({ label, hint, value, onChange, autoFocus }: { label: string; hint: string; value: string; onChange: (value: string) => void; autoFocus?: boolean }) {
  return (
    <FilterLabel label={label} hint={hint}>
      {(id, hintId) => <input id={id} type="text" value={value} autoComplete="off" autoFocus={autoFocus} aria-describedby={hintId} onChange={(event) => onChange(event.target.value)} />}
    </FilterLabel>
  );
}

/** How many threads a page of results lists, as Duva lists unless asked. */
const pageSize = 20;

type Finding =
  | { status: "loading" }
  | { status: "failed"; message: string; refused: boolean }
  | { status: "found"; results: SearchResult[]; next?: string };

/**
 * A search's results in the mailbox whose Inbox is at `base`, the human's own or, with the agent's
 * name, an agent's they sponsor. Duva's words show when it refuses the search, as for a filter it
 * doesn't know.
 */
export function SearchResults({
  client,
  mailbox,
  base,
  view,
  labels,
  onSignedOut,
}: {
  client: DuvaClient;
  mailbox: Mailbox;
  base: string;
  view: SearchView;
  labels: Label[];
  onSignedOut: () => void;
}) {
  const [finding, setFinding] = useState<Finding>({ status: "loading" });
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState<string>();
  const { q, sort } = view.search;

  /** A page of results, or the words to show if there is none. */
  const page = useCallback(
    async (after?: string): Promise<{ results: SearchResult[]; next?: string } | { message: string; refused: boolean } | undefined> => {
      const { data, error, response } = await client
        .GET("/mailboxes/{mailbox}/search", { params: { path: { mailbox: mailbox.id }, query: { q, sort, limit: pageSize, after } } })
        .catch(() => ({ data: undefined, error: undefined, response: undefined }));
      if (response?.status === 401) {
        onSignedOut();
        return undefined;
      }
      if (data !== undefined) return data;
      if (response?.status === 400 && error !== undefined && "message" in error) return { message: error.message, refused: true };
      return { message: response === undefined ? strings.search.unreachable : strings.search.failed(response.status), refused: false };
    },
    [client, mailbox.id, q, sort, onSignedOut],
  );

  const load = useCallback(async () => {
    setFinding({ status: "loading" });
    const answer = await page();
    if (answer === undefined) return;
    setFinding("results" in answer ? { status: "found", ...answer } : { status: "failed", ...answer });
  }, [page]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    document.title = strings.title(q);
  }, [q]);

  const more = async () => {
    if (finding.status !== "found" || finding.next === undefined) return;
    setLoadingMore(true);
    setMoreFailed(undefined);
    const answer = await page(finding.next);
    setLoadingMore(false);
    if (answer === undefined) return;
    if (!("results" in answer)) return setMoreFailed(answer.message);
    // A thread already shown, whose place changed since the page before, isn't listed twice.
    const shown = new Set(finding.results.map(({ thread }) => thread.id));
    setFinding({ status: "found", results: [...finding.results, ...answer.results.filter(({ thread }) => !shown.has(thread.id))], next: answer.next });
  };

  const sortLink = (to: SearchView["search"]["sort"], name: string) => (
    <a href={hrefOf({ search: { q, sort: to } }, base)} aria-current={sort === to ? "page" : undefined}>
      {name}
    </a>
  );

  return (
    <main className="desk" aria-busy={finding.status === "loading"}>
      <div className="desk-head">
        <h1 tabIndex={-1} className="view-title">
          {strings.search.title}
        </h1>
        <p className="search-words">{strings.search.words(q)}</p>
        <nav className="sort" aria-label={strings.search.sort}>
          {sortLink("relevance", strings.search.relevance)}
          {sortLink("newest", strings.search.newest)}
        </nav>
        <p className="mailbox-address">{strings.mailboxes.address(mailbox)}</p>
      </div>
      <p className="visually-hidden" role="status">
        {finding.status === "found" ? (finding.results.length > 0 ? strings.search.found(finding.results.length, finding.next !== undefined) : strings.search.emptyTitle) : ""}
      </p>
      {finding.status === "loading" ? (
        <SkeletonIndex />
      ) : finding.status === "failed" ? (
        <div className="notice notice-alert failed-listing" role="alert">
          <p>{finding.message}</p>
          {!finding.refused && (
            <button type="button" className="button button-small" onClick={() => void load()}>
              {strings.inbox.retry}
            </button>
          )}
        </div>
      ) : finding.results.length === 0 ? (
        <section className="empty" aria-labelledby="empty-title">
          <h2 id="empty-title">{strings.search.emptyTitle}</h2>
          <p>{strings.search.emptyLead(q)}</p>
        </section>
      ) : (
        <div className="index">
          <ol className="threads" aria-label={strings.search.results}>
            {finding.results.map((result) => (
              <ResultRow
                key={result.thread.id}
                result={result}
                labels={labels}
                href={threadHref(result.thread.id, view, base, result.message)}
              />
            ))}
          </ol>
          {finding.next !== undefined && (
            <div className="index-foot">
              {moreFailed !== undefined && (
                <p className="field-error" role="alert">
                  {moreFailed}
                </p>
              )}
              <button type="button" className="button" disabled={loadingMore} onClick={() => void more()}>
                {loadingMore ? strings.search.loadingMore : strings.search.more}
              </button>
            </div>
          )}
        </div>
      )}
    </main>
  );
}

/** A thread found, as a line of the index, with the snippet of the message that matched and the words in it marked. */
function ResultRow({ result, labels, href }: { result: SearchResult; labels: Label[]; href: string }) {
  const { thread } = result;
  // Spam and Trash are searched only when asked, and then a result says it is there.
  const named = [
    ...(thread.labels.includes("spam") ? [strings.views.spam] : []),
    ...(thread.labels.includes("trash") ? [strings.views.trash] : []),
    ...ownLabelsOf(thread, labels).map(({ name }) => name),
  ];
  return (
    <li className="result">
      <ThreadLine thread={thread} labels={named} href={href} snippet={result.snippet === "" ? "" : <Highlighted text={result.snippet} highlights={result.highlights} />} />
    </li>
  );
}

/** The text with each highlight marked. Highlights count UTF-16 code units, as a JavaScript string does. */
function Highlighted({ text, highlights }: { text: string; highlights: SearchResult["highlights"] }) {
  const parts: ReactNode[] = [];
  let at = 0;
  for (const { start, end } of highlights) {
    if (start < at || end <= start || end > text.length) continue;
    parts.push(text.slice(at, start), <mark key={start}>{text.slice(start, end)}</mark>);
    at = end;
  }
  parts.push(text.slice(at));
  return <>{parts}</>;
}

const SearchIcon = () => (
  <svg className="icon search-icon" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M7 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM10.6 10.6 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

const FiltersIcon = () => (
  <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M2.5 4.5h11M4.5 8h7M6.5 11.5h3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);
