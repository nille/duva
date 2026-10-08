// An agent's activity, for its sponsor: one list of its events, newest first, across days, each
// opening into everything recorded on it, with links to the threads, drafts and senders it touched.
// On a desk the events lie in the list column, under a heading for each date, and the open event
// beside them. Chips under the list's head choose the kinds of event shown, and the address keeps
// them. Dates and times are in the human's time zone, or the browser's until they choose one.
import { type ReactNode, type RefObject, useCallback, useEffect, useRef, useState } from "react";
import type { DuvaClient } from "@duva/client";
import type { components } from "@duva/openapi";
import { useDates } from "./dates.ts";
import { SkeletonIndex } from "./inbox.tsx";
import { openBeside } from "./panes.tsx";
import { restBeforeOpen, sideBySide, useShortcuts } from "./shortcuts.tsx";
import { strings } from "./strings.ts";
import { BackIcon } from "./thread.tsx";
import { senderHref, threadHref } from "./views.tsx";

type AgentEvent = components["schemas"]["AgentEvent"];
type Detail = components["schemas"]["AgentEventDetail"];
type Kind = components["schemas"]["AgentEventKind"];

/** The kinds a chip chooses, in the order the chips show. Setup has no chip, so it shows under All alone. */
export const chipKinds = ["conversations", "tasks", "draftsAndSends", "approvals", "organizing", "screening", "unsubscribes", "pausesAndLimits", "alerts"] as const satisfies readonly Kind[];
type ChipKind = (typeof chipKinds)[number];

/** Which events show: those of the kinds chosen, or of any kind if none is, and only those that failed if `failed`. */
export interface Filter {
  kinds: ChipKind[];
  failed: boolean;
}

export const allEvents: Filter = { kinds: [], failed: false };

/** The filter an address's query keeps, as `kinds=tasks,alerts&failed=true`. */
export function filterOf(query: string): Filter {
  const asked = new URLSearchParams(query);
  const kinds = (asked.get("kinds") ?? "").split(",");
  return { kinds: chipKinds.filter((kind) => kinds.includes(kind)), failed: asked.get("failed") === "true" };
}

/** The query that keeps the filter in the address, empty for all events. */
const queryOf = ({ kinds, failed }: Filter) => {
  const query = [...(kinds.length > 0 ? [`kinds=${kinds.join(",")}`] : []), ...(failed ? ["failed=true"] : [])].join("&");
  return query === "" ? "" : `?${query}`;
};

/** Where the agent's activity is in the web app, with the event open, and the events the filter chooses. */
export const activityHref = (agent: string, event?: string, filter: Filter = allEvents) =>
  `#/agents/${encodeURIComponent(agent)}${event === undefined ? "" : `/${encodeURIComponent(event)}`}${queryOf(filter)}`;

/** The time zone dates are in: the human's, or the browser's until they choose one. */
const zoneOf = (timeZone: string | undefined) => timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

type Read<T> = { status: "loading" } | { status: "failed"; message: string } | { status: "read"; read: T };

/** Why Duva gave nothing, as the page says it. */
const failure = (response: Response | undefined) => (response === undefined ? strings.activity.unreachable : strings.activity.failed(response.status));

/** The date of the time in the time zone, as YYYY-MM-DD. */
const dateIn = (at: string, timeZone: string) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));

/** How an event's date and time read: its weekday and date, and its time, in the time zone. */
function useWhen(timeZone: string) {
  const { date, clock } = useDates();
  return useCallback(
    (at: string) => {
      const [year, month, ofMonth] = dateIn(at, timeZone).split("-").map(Number) as [number, number, number];
      const local = new Date(year, month - 1, ofMonth);
      return { day: `${local.toLocaleDateString(undefined, { weekday: "long" })}, ${date(local, true)}`, time: clock(new Date(at), timeZone) };
    },
    [date, clock, timeZone],
  );
}

/** Where a mailbox's Inbox is: at the root for the human's own first mailbox, `mine`, else under its ID. */
const baseOf = (mailbox: string, mine: string | undefined) => (mailbox === mine ? "#/" : `#/mailboxes/${encodeURIComponent(mailbox)}/`);

/** How an event's line is marked: failed, and waiting for the human. */
const marksOf = ({ failed, needsYou }: Pick<AgentEvent, "failed" | "needsYou">) => [...(failed ? [strings.activity.failedMark] : []), ...(needsYou ? [strings.activity.needsYouMark] : [])];

/**
 * The agent's activity: its events, `open` being the one open beside them, of the kinds the filter
 * chooses. `name` is the agent's name if the human sponsors it, and `mine` the human's first own
 * mailbox, whose threads open at the root.
 */
export function AgentEvents({
  client,
  agent,
  name = strings.galley.anAgent,
  open,
  filter,
  mine,
  timeZone,
  onSignedOut,
}: {
  client: DuvaClient;
  agent: string;
  name?: string;
  open?: string;
  filter: Filter;
  mine?: string;
  timeZone?: string;
  onSignedOut: () => void;
}) {
  const copy = strings.activity;
  const zone = zoneOf(timeZone);
  const when = useWhen(zone);
  const [read, setRead] = useState<Read<{ events: AgentEvent[]; next?: string }>>({ status: "loading" });
  const [more, setMore] = useState<{ status: "idle" | "loading" } | { status: "failed"; message: string }>({ status: "idle" });
  const list = useRef<HTMLDivElement>(null);
  const filterKey = queryOf(filter);
  // Only the latest read counts, as the chips change while a page is read.
  const asked = useRef(0);

  const page = useCallback(
    async (after?: string) => {
      const { kinds, failed } = filterOf(filterKey.slice(1));
      const query = { ...(kinds.length > 0 && { kinds }), ...(failed && { failed: true }), ...(after !== undefined && { after }) };
      const { data, response } = await client.GET("/agents/{agent}/events", { params: { path: { agent }, query } }).catch(() => ({ data: undefined, response: undefined }));
      if (response?.status === 401) onSignedOut();
      return { data, response };
    },
    [client, agent, filterKey, onSignedOut],
  );
  const load = useCallback(async () => {
    const reading = ++asked.current;
    setRead({ status: "loading" });
    setMore({ status: "idle" });
    const { data, response } = await page();
    if (reading !== asked.current || response?.status === 401) return;
    setRead(data === undefined ? { status: "failed", message: failure(response) } : { status: "read", read: data });
  }, [page]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (open === undefined) document.title = strings.title(copy.title(name));
  }, [open, copy, name]);

  const showMore = async () => {
    if (read.status !== "read" || read.read.next === undefined) return;
    const reading = asked.current;
    setMore({ status: "loading" });
    const { data, response } = await page(read.read.next);
    if (reading !== asked.current || response?.status === 401) return;
    if (data === undefined) return setMore({ status: "failed", message: failure(response) });
    setMore({ status: "idle" });
    setRead({ status: "read", read: { events: [...read.read.events, ...data.events], ...(data.next !== undefined && { next: data.next }) } });
  };

  const choose = (next: Filter) => {
    location.hash = activityHref(agent, open, next);
  };
  const toggle = (kind: ChipKind) => choose({ ...filter, kinds: filter.kinds.includes(kind) ? filter.kinds.filter((each) => each !== kind) : chipKinds.filter((each) => each === kind || filter.kinds.includes(each)) });
  const filtered = filter.kinds.length > 0 || filter.failed;

  useEventKeys(list, open === undefined ? undefined : () => (location.hash = activityHref(agent, undefined, filter)));

  // Alone the events are the page's main content, titled at its first level, and beside an open event a region headed one level down.
  const beside = open !== undefined;
  const Title = beside ? "h2" : "h1";
  const DateHeading = beside ? "h3" : "h2";
  const days: { day: string; events: AgentEvent[] }[] = [];
  for (const event of read.status === "read" ? read.read.events : []) {
    const { day } = when(event.at);
    if (days.at(-1)?.day === day) days.at(-1)!.events.push(event);
    else days.push({ day, events: [event] });
  }
  return (
    <div className={beside ? "activity-desk activity-desk-open" : "activity-desk"}>
      <div ref={list} className="activity-events" role={beside ? "region" : "main"} aria-labelledby="activity-title" aria-busy={read.status === "loading"}>
        <div className="activity-head">
          <Title tabIndex={-1} id="activity-title" className="view-title">
            {copy.title(name)}
          </Title>
          <p className="activity-lead">{copy.lead(zone)}</p>
        </div>
        <div className="queue-chips activity-chips" role="group" aria-label={copy.filters}>
          <button type="button" className="chip" aria-pressed={!filtered} onClick={() => choose(allEvents)}>
            {copy.all}
          </button>
          {chipKinds.map((kind) => (
            <button key={kind} type="button" className="chip" aria-pressed={filter.kinds.includes(kind)} onClick={() => toggle(kind)}>
              {copy.kinds[kind]}
            </button>
          ))}
          <button type="button" className="chip chip-failures" aria-pressed={filter.failed} onClick={() => choose({ ...filter, failed: !filter.failed })}>
            {copy.failures}
          </button>
        </div>
        {read.status === "loading" ? (
          <SkeletonIndex />
        ) : read.status === "failed" ? (
          <Failed message={read.message} onRetry={() => void load()} />
        ) : read.read.events.length === 0 ? (
          <section className="empty activity-empty" aria-labelledby="activity-empty-title">
            <DateHeading id="activity-empty-title">{filtered ? copy.noneChosen : copy.empty}</DateHeading>
            <p>{filtered ? copy.noneChosenLead : copy.emptyLead(name)}</p>
            {filtered && (
              <button type="button" className="button button-small" onClick={() => choose(allEvents)}>
                {copy.showAll}
              </button>
            )}
          </section>
        ) : (
          <section className="events" aria-label={copy.events}>
            {days.map(({ day, events }, at) => (
              <section key={day} className="event-day" aria-labelledby={`event-date-${at}`}>
                <DateHeading id={`event-date-${at}`} className="event-date">
                  {day}
                </DateHeading>
                <ol className="event-list">
                  {events.map((event) => {
                    const { time } = when(event.at);
                    const marks = marksOf(event);
                    return (
                      <li key={event.id} data-event={event.id}>
                        <a
                          className={`event${event.failed ? " event-failed" : ""}${event.needsYou ? " event-needs-you" : ""}`}
                          href={activityHref(agent, event.id, filter)}
                          aria-current={event.id === open ? "true" : undefined}
                          aria-label={copy.eventLabel(`${day}, ${time}`, event.summary, marks)}
                        >
                          <time className="event-time" dateTime={event.at}>
                            {time}
                          </time>
                          <span className="event-said">{event.summary}</span>
                          {marks.length > 0 && (
                            <span className="event-marks">
                              {event.failed && <span className="event-mark event-mark-failed">{copy.failedMark}</span>}
                              {event.needsYou && <span className="event-mark event-mark-call">{copy.needsYouMark}</span>}
                            </span>
                          )}
                        </a>
                      </li>
                    );
                  })}
                </ol>
              </section>
            ))}
            {read.read.next !== undefined && (
              <div className="index-foot">
                <button type="button" className="button" onClick={() => void showMore()} disabled={more.status === "loading"}>
                  {more.status === "loading" ? copy.loadingMore : copy.more}
                </button>
              </div>
            )}
            {more.status === "failed" && (
              <p className="notice notice-alert" role="alert">
                {more.message}
              </p>
            )}
          </section>
        )}
      </div>
      {open === undefined ? (
        <section className="reader-empty activity-reader" aria-labelledby="activity-reader-title">
          <h2 id="activity-reader-title">{copy.pickTitle}</h2>
          <p>{copy.pickLead(name)}</p>
        </section>
      ) : (
        <OpenEvent key={open} client={client} agent={agent} name={name} event={open} filter={filter} mine={mine} zone={zone} onSignedOut={onSignedOut} />
      )}
    </div>
  );
}

/**
 * The keys of the events: j and k move the focus to the next and previous event, which a screen
 * reader reads. On a desk the event then opens beside the list once the focus rests on it for
 * `restBeforeOpen` with no other key pressed, the focus staying in the list. While the list is out
 * of sight, as when an event takes a phone's screen, the keys aren't its. Escape closes the open
 * event, with `onClose`.
 */
function useEventKeys(list: RefObject<HTMLElement | null>, onClose?: () => void) {
  const resting = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    const ended = () => clearTimeout(resting.current);
    document.addEventListener("keydown", ended, { capture: true });
    document.addEventListener("pointerdown", ended, { capture: true });
    addEventListener("hashchange", ended);
    return () => {
      ended();
      document.removeEventListener("keydown", ended, { capture: true });
      document.removeEventListener("pointerdown", ended, { capture: true });
      removeEventListener("hashchange", ended);
    };
  }, []);
  const move = (step: 1 | -1) => {
    if (list.current?.checkVisibility() !== true) return;
    const links = Array.from(list.current.querySelectorAll<HTMLAnchorElement>("a.event"));
    if (links.length === 0) return;
    const focused = links.indexOf(document.activeElement as HTMLAnchorElement);
    // From outside the list, the first key goes to the open event, or the first.
    const at = focused !== -1 ? Math.min(Math.max(focused + step, 0), links.length - 1) : Math.max(links.findIndex((link) => link.getAttribute("aria-current") === "true"), 0);
    const link = links[at]!;
    link.focus();
    if (!sideBySide()) return;
    resting.current = setTimeout(() => {
      if (document.activeElement === link && link.hash !== location.hash) openBeside(link.hash);
    }, restBeforeOpen);
  };
  useShortcuts({ j: () => move(1), k: () => move(-1), Escape: onClose });
}

function Failed({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="notice notice-alert failed-listing" role="alert">
      <p>{message}</p>
      <button type="button" className="button button-small" onClick={onRetry}>
        {strings.inbox.retry}
      </button>
    </div>
  );
}

/** How many of the threads a turn of Ask Coo touched the open event links to, before saying how many more. */
const threadsLinked = 5;

/** A thread an event links to: its subject once read, or that it is gone. */
type Linked = { subject: string } | { gone: true } | undefined;

/** A fact recorded on the open event, as a term and what it says. */
type Fact = { term: string; said: ReactNode };

/**
 * The open event: what happened, when, and everything recorded on it, with links to the threads,
 * drafts and senders it touched. Each thread's subject is read to name its link.
 */
function OpenEvent({
  client,
  agent,
  name,
  event,
  filter,
  mine,
  zone,
  onSignedOut,
}: {
  client: DuvaClient;
  agent: string;
  name: string;
  event: string;
  filter: Filter;
  mine?: string;
  zone: string;
  onSignedOut: () => void;
}) {
  const copy = strings.activity;
  const when = useWhen(zone);
  const [read, setRead] = useState<Read<Detail> | { status: "gone" }>({ status: "loading" });
  const [threads, setThreads] = useState<ReadonlyMap<string, Linked>>(new Map());

  const load = useCallback(async () => {
    setRead({ status: "loading" });
    const { data, response } = await client.GET("/agents/{agent}/events/{event}", { params: { path: { agent, event } } }).catch(() => ({ data: undefined, response: undefined }));
    if (response?.status === 401) return onSignedOut();
    setRead(data !== undefined ? { status: "read", read: data } : response?.status === 404 ? { status: "gone" } : { status: "failed", message: failure(response) });
  }, [client, agent, event, onSignedOut]);
  useEffect(() => {
    void load();
  }, [load]);

  const detail = read.status === "read" ? read.read : undefined;
  useEffect(() => {
    document.title = strings.title(detail?.summary ?? copy.title(name));
  }, [detail, copy, name]);

  // Each thread is read once, for its subject.
  const change = detail?.change as Record<string, unknown> | undefined;
  const turn = detail?.change?.type === "conversationTurn" ? detail.change : undefined;
  const touched = detail?.mailbox === undefined ? [] : [...new Set([...(detail.thread === undefined ? [] : [detail.thread]), ...(turn?.threads.slice(0, threadsLinked) ?? [])])];
  const touchedKey = touched.join(" ");
  useEffect(() => {
    if (detail?.mailbox === undefined || touchedKey === "") return;
    const mailbox = detail.mailbox;
    for (const thread of touchedKey.split(" ")) {
      void client
        .GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { mailbox, thread } } })
        .then(({ data, response }) => {
          if (response.status === 401) return onSignedOut();
          if (data !== undefined) setThreads((current) => new Map([...current, [thread, { subject: data.subject }]]));
          else if (response.status === 404) setThreads((current) => new Map([...current, [thread, { gone: true }]]));
        })
        .catch(() => undefined);
    }
  }, [client, detail?.mailbox, touchedKey, onSignedOut]);

  const facts: Fact[] = [];
  if (detail !== undefined) {
    const base = detail.mailbox === undefined ? undefined : baseOf(detail.mailbox, mine);
    const threadLink = (thread: string) => {
      const linked = threads.get(thread);
      if (linked !== undefined && "gone" in linked) return <span className="event-gone">{copy.detail.threadGone}</span>;
      return <a href={threadHref(thread, { label: "inbox" }, base!)}>{linked === undefined ? copy.detail.openThread : linked.subject || copy.detail.noSubject}</a>;
    };
    const draftLinks = (drafts: string[]) => (
      <ul className="event-links">
        {drafts.map((draft, at) => (
          <li key={draft}>
            <a href={`${base}drafts/${encodeURIComponent(draft)}`}>{copy.detail.openDraft(at + 1, drafts.length)}</a>
          </li>
        ))}
      </ul>
    );
    if (turn !== undefined) {
      if (turn.asked !== undefined) facts.push({ term: copy.detail.asked, said: `“${turn.asked}”` });
      if (base !== undefined && turn.threads.length > 0) {
        const more = turn.threads.length - threadsLinked;
        facts.push({
          term: copy.detail.threads,
          said: (
            <ul className="event-links">
              {turn.threads.slice(0, threadsLinked).map((thread) => (
                <li key={thread}>{threadLink(thread)}</li>
              ))}
              {more > 0 && <li className="event-gone">{copy.detail.moreThreads(more)}</li>}
            </ul>
          ),
        });
      }
      if (base !== undefined && turn.drafts.length > 0) facts.push({ term: copy.detail.drafts, said: draftLinks(turn.drafts) });
      facts.push({ term: copy.detail.models, said: turn.models.map((model) => strings.ask.models[model]).join(", then ") });
      if (turn.handover !== undefined) facts.push({ term: copy.detail.handover, said: copy.detail.handoverTo(strings.ask.models[turn.handover.to], strings.ask.handoverWhy[turn.handover.reason]) });
      facts.push({ term: copy.detail.cost, said: copy.detail.cents(turn.cost) });
    } else {
      if (base !== undefined && detail.thread !== undefined) facts.push({ term: copy.detail.thread, said: threadLink(detail.thread) });
      // A draft sent or deleted is gone, so only a draft that may still be one is linked.
      const draft = change?.draft;
      if (base !== undefined && typeof draft === "string" && detail.type !== "messageSent" && detail.type !== "draftDeleted" && detail.type !== "sendFailed") facts.push({ term: copy.detail.draft, said: draftLinks([draft]) });
      const address = change?.address;
      const domain = change?.domain;
      if (typeof address === "string") facts.push({ term: copy.detail.sender, said: base === undefined ? address : <a href={senderHref(address.toLowerCase(), "", base)}>{address}</a> });
      else if (typeof domain === "string") facts.push({ term: copy.detail.sender, said: domain });
      if (detail.change?.type === "agentHandedOver") facts.push({ term: copy.detail.handover, said: copy.detail.handoverTo(strings.ask.models[detail.change.handover.to], strings.ask.handoverWhy[detail.change.handover.reason]) });
    }
    const why =
      detail.change?.type === "sendFailed"
        ? detail.change.reason
        : detail.change?.type === "feedbackReceived"
          ? detail.change.feedback.reason
          : detail.change?.type === "unsubscribeAttempted" && detail.change.reason !== undefined
            ? detail.change.method === "bounce"
              ? strings.sender.unsubscribe.whyNotBounced(name, detail.change.reason, detail.change.detail)
              : (detail.change.detail ?? copy.detail.unsubscribeWhy[detail.change.reason])
            : undefined;
    if (why !== undefined) facts.push({ term: copy.detail.failure, said: why });
    if (typeof change?.note === "string") facts.push({ term: copy.detail.note, said: change.note });
    if (detail.alert !== undefined) facts.push({ term: copy.detail.alert, said: <a href="#/alerts">{copy.detail.openAlerts}</a> });
  }

  const { day, time } = detail === undefined ? { day: "", time: "" } : when(detail.at);
  return (
    <main className="activity-event" aria-busy={read.status === "loading"}>
      <p className="back">
        <a href={activityHref(agent, undefined, filter)}>
          <BackIcon />
          {copy.title(name)}
        </a>
      </p>
      {read.status === "loading" ? (
        <SkeletonIndex />
      ) : read.status === "failed" ? (
        <Failed message={read.message} onRetry={() => void load()} />
      ) : read.status === "gone" ? (
        <section className="empty" aria-labelledby="event-gone-title">
          <h1 id="event-gone-title" tabIndex={-1}>
            {copy.gone}
          </h1>
        </section>
      ) : (
        <article className="event-open" aria-labelledby="event-title">
          <header className="activity-head">
            <p className="event-when">
              <time dateTime={read.read.at}>
                {day}, {time}
              </time>
              {read.read.failed && <span className="event-mark event-mark-failed">{copy.failedMark}</span>}
              {read.read.needsYou && <span className="event-mark event-mark-call">{copy.needsYouMark}</span>}
            </p>
            <h1 tabIndex={-1} id="event-title" className="view-title">
              {read.read.summary}
            </h1>
          </header>
          {facts.length > 0 && (
            <dl className="event-facts" aria-label={copy.detail.facts}>
              {facts.map(({ term, said }) => (
                <div key={term} className="event-fact">
                  <dt>{term}</dt>
                  <dd>{said}</dd>
                </div>
              ))}
            </dl>
          )}
        </article>
      )}
    </main>
  );
}
