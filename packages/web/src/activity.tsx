// An agent's activity, for its sponsor: a summary of each of the last 30 days, newest first, each
// opening into the day's timeline, where every entry says who did what and links to its thread.
// Days run in the human's time zone, or the browser's until they choose one.
import { Fragment, useCallback, useEffect, useState } from "react";
import type { DuvaClient } from "@duva/client";
import type { components } from "@duva/openapi";
import { useDates } from "./dates.ts";
import { SkeletonIndex } from "./inbox.tsx";
import { ChevronIcon } from "./setting-parts.tsx";
import { type EntryMessage, strings } from "./strings.ts";
import { BackIcon } from "./thread.tsx";
import { threadHref } from "./views.tsx";

type ActivitySummary = components["schemas"]["ActivitySummary"];
type ActivityEntry = components["schemas"]["ActivityEntry"];

/** The kinds a summary counts, in the order a day says them. */
const kinds = ["sent", "approved", "rejected", "received", "organized", "screened", "alerts"] as const satisfies readonly (keyof ActivitySummary & keyof typeof strings.activity.counts)[];

/** A row of the days: a day of its own, or a run of days with nothing counted, folded into one. */
type Run = { day: ActivitySummary } | { quiet: ActivitySummary[] };

const isQuiet = (summary: ActivitySummary) => kinds.every((kind) => summary[kind] === 0);

/** The days, newest first, with each run of two or more days with nothing counted folded into one row. */
function runsOf(days: ActivitySummary[]): Run[] {
  const runs: Run[] = [];
  for (const summary of days) {
    const last = runs.at(-1);
    if (!isQuiet(summary)) runs.push({ day: summary });
    else if (last !== undefined && "quiet" in last) last.quiet.push(summary);
    else runs.push({ quiet: [summary] });
  }
  return runs.map((run) => ("quiet" in run && run.quiet.length === 1 ? { day: run.quiet[0]! } : run));
}

/** Where the agent's activity is in the web app, or the day's timeline there. */
export const activityHref = (agent: string, day?: string) => `#/agents/${encodeURIComponent(agent)}${day === undefined ? "" : `/${day}`}`;

/** The time zone days run in: the human's, or the browser's until they choose one. */
const zoneOf = (timeZone: string | undefined) => timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

type Read<T> = { status: "loading" } | { status: "failed"; message: string } | { status: "read"; read: T };

/** Why Duva gave nothing, as the page says it. */
const failure = (response: Response | undefined) => (response === undefined ? strings.activity.unreachable : strings.activity.failed(response.status));

/** A day as YYYY-MM-DD, as a date at its start in the browser's time zone, for naming it. */
const localDay = (day: string) => {
  const [year, month, ofMonth] = day.split("-").map(Number) as [number, number, number];
  return new Date(year, month - 1, ofMonth);
};

/** A day as YYYY-MM-DD, named as the human reads dates: its weekday and its date. */
function useDayName() {
  const { date } = useDates();
  return useCallback(
    (day: string) => {
      const local = localDay(day);
      return `${local.toLocaleDateString(undefined, { weekday: "long" })}, ${date(local, true)}`;
    },
    [date],
  );
}

/** The agent's summaries for the last 30 days, `name` being the agent's name if the human sponsors it. */
export function AgentActivity({ client, agent, name = strings.galley.anAgent, timeZone, onSignedOut }: { client: DuvaClient; agent: string; name?: string; timeZone?: string; onSignedOut: () => void }) {
  const [read, setRead] = useState<Read<{ timeZone: string; days: ActivitySummary[] }>>({ status: "loading" });
  const copy = strings.activity;

  const load = useCallback(async () => {
    setRead({ status: "loading" });
    const { data, response } = await client
      .GET("/agents/{agent}/activity", { params: { path: { agent }, query: { timeZone: zoneOf(timeZone) } } })
      .catch(() => ({ data: undefined, response: undefined }));
    if (response?.status === 401) return onSignedOut();
    setRead(data === undefined ? { status: "failed", message: failure(response) } : { status: "read", read: data });
  }, [client, agent, timeZone, onSignedOut]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    document.title = strings.title(copy.title(name));
  }, [copy, name]);

  return (
    <main className="desk activity" aria-busy={read.status === "loading"}>
      <div className="desk-head activity-head">
        <h1 tabIndex={-1} className="view-title">{copy.title(name)}</h1>
        <p className="activity-lead">{copy.lead(read.status === "read" ? read.read.timeZone : zoneOf(timeZone))}</p>
      </div>
      {read.status === "loading" ? (
        <SkeletonIndex />
      ) : read.status === "failed" ? (
        <Failed message={read.message} onRetry={() => void load()} />
      ) : (
        <section className="index days" aria-labelledby="days-label">
          <h2 className="visually-hidden" id="days-label">
            {copy.days}
          </h2>
          <ol className="days-list" aria-label={copy.days}>
            {runsOf(read.read.days).map((run) =>
              "day" in run ? (
                <li key={run.day.day}>
                  <Day agent={agent} summary={run.day} />
                </li>
              ) : (
                <QuietDays key={run.quiet[0]!.day} agent={agent} days={run.quiet} />
              ),
            )}
          </ol>
        </section>
      )}
    </main>
  );
}

/** A day as a line of the index, linking to its timeline: its name, then what was counted, the numbers in a heavier hand. */
function Day({ agent, summary }: { agent: string; summary: ActivitySummary }) {
  const dayName = useDayName();
  const copy = strings.activity;
  const counted = kinds.filter((kind) => summary[kind] > 0);
  return (
    <a className={counted.length === 0 ? "day day-quiet" : "day"} href={activityHref(agent, summary.day)} aria-label={copy.dayLabel(dayName(summary.day), copy.counted(counted.map((kind) => copy.counts[kind](summary[kind]))))}>
      <span className="day-name">{dayName(summary.day)}</span>
      <span className="day-said">
        {counted.length === 0
          ? copy.nothing
          : counted.map((kind, at) => {
              // Each count is said with its number first, which is set apart.
              const said = copy.counts[kind](summary[kind]);
              const number = String(summary[kind]);
              return (
                <Fragment key={kind}>
                  {at > 0 && ", "}
                  <span className="day-count">
                    <span className="day-number">{number}</span>
                    {said.slice(number.length)}
                  </span>
                </Fragment>
              );
            })}
      </span>
    </a>
  );
}

/** A run of days with nothing counted, as one row that opens into the days, since a day can hold what isn't counted. */
function QuietDays({ agent, days }: { agent: string; days: ActivitySummary[] }) {
  const [open, setOpen] = useState(false);
  const { date } = useDates();
  const copy = strings.activity;
  const from = date(localDay(days.at(-1)!.day), true);
  const to = date(localDay(days[0]!.day), true);
  return (
    <li className="quiet-days">
      <button type="button" className="day day-fold" aria-expanded={open} aria-label={copy.quietLabel(from, to)} onClick={() => setOpen(!open)}>
        <span className="day-name">{copy.quietDays(from, to)}</span>
        <span className="day-said">{copy.nothing}</span>
        <ChevronIcon />
      </button>
      {open && (
        <ol className="days-list days-folded">
          {days.map((summary) => (
            <li key={summary.day}>
              <Day agent={agent} summary={summary} />
            </li>
          ))}
        </ol>
      )}
    </li>
  );
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

/** A thread an entry links to: its subject and its messages once read, or that it is gone. */
type Linked = { subject: string; messages: ReadonlyMap<string, EntryMessage> } | { gone: true } | undefined;

/** How an entry names someone on a message: by name, or by address without one. */
const named = ({ name, address }: { name?: string; address: string }) => name ?? address;

/**
 * One day of the agent's timeline, a page at a time. `me` is the human, and `mine` their own
 * mailbox, whose threads open there. Each thread's subject is read once, to name the entry's link.
 */
export function AgentDay({
  client,
  agent,
  day,
  name = strings.galley.anAgent,
  me,
  mine,
  timeZone,
  onSignedOut,
}: {
  client: DuvaClient;
  agent: string;
  day: string;
  name?: string;
  me: string;
  mine?: string;
  timeZone?: string;
  onSignedOut: () => void;
}) {
  const [read, setRead] = useState<Read<{ timeZone: string; entries: ActivityEntry[]; next?: string }>>({ status: "loading" });
  const [more, setMore] = useState<{ status: "idle" | "loading" } | { status: "failed"; message: string }>({ status: "idle" });
  const [threads, setThreads] = useState<ReadonlyMap<string, Linked>>(new Map());
  const { clock } = useDates();
  const dayName = useDayName();
  const copy = strings.activity;

  const page = useCallback(
    async (after?: string) => {
      const { data, response } = await client
        .GET("/agents/{agent}/activity/{day}", { params: { path: { agent, day }, query: { timeZone: zoneOf(timeZone), ...(after !== undefined && { after }) } } })
        .catch(() => ({ data: undefined, response: undefined }));
      if (response?.status === 401) onSignedOut();
      return { data, response };
    },
    [client, agent, day, timeZone, onSignedOut],
  );
  const load = useCallback(async () => {
    setRead({ status: "loading" });
    const { data, response } = await page();
    if (response?.status === 401) return;
    setRead(data === undefined ? { status: "failed", message: failure(response) } : { status: "read", read: data });
  }, [page]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    document.title = strings.title(dayName(day));
  }, [day, dayName]);

  const showMore = async () => {
    if (read.status !== "read" || read.read.next === undefined) return;
    setMore({ status: "loading" });
    const { data, response } = await page(read.read.next);
    if (response?.status === 401) return;
    if (data === undefined) return setMore({ status: "failed", message: failure(response) });
    setMore({ status: "idle" });
    setRead({ status: "read", read: { ...data, entries: [...read.read.entries, ...data.entries] } });
  };

  // Each thread is read once, for its subject, however many entries are about it.
  const entries = read.status === "read" ? read.read.entries : [];
  useEffect(() => {
    const unread = [...new Set(entries.flatMap(({ mailbox, thread }) => (mailbox === undefined || thread === undefined ? [] : [`${mailbox}/${thread}`])))].filter((key) => !threads.has(key));
    if (unread.length === 0) return;
    setThreads((current) => new Map([...current, ...unread.map((key) => [key, undefined] as const)]));
    for (const key of unread) {
      const [mailbox, thread] = key.split("/") as [string, string];
      void client
        .GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { mailbox, thread } } })
        .then(({ data, response }) => {
          if (response.status === 401) return onSignedOut();
          if (data !== undefined) {
            const messages = new Map(data.messages.map((message) => [message.id, { from: named(message.from), to: message.to.map(named), recipient: message.recipient }] as const));
            setThreads((current) => new Map([...current, [key, { subject: data.subject, messages }]]));
          }
          else if (response.status === 404) setThreads((current) => new Map([...current, [key, { gone: true }]]));
        })
        .catch(() => undefined);
    }
  }, [client, entries, threads, onSignedOut]);

  const who = (actor: string | undefined) => (actor === agent ? name : actor === me ? copy.you : actor === "duva" ? copy.duva : copy.someone);
  const zone = read.status === "read" ? read.read.timeZone : zoneOf(timeZone);
  return (
    <main className="desk activity" aria-busy={read.status === "loading"}>
      <p className="back">
        <a href={activityHref(agent)}>
          <BackIcon />
          {copy.title(name)}
        </a>
      </p>
      <div className="desk-head activity-head">
        <h1 tabIndex={-1} className="view-title">{dayName(day)}</h1>
        <p className="activity-lead">{copy.dayLead(name, zone)}</p>
      </div>
      {read.status === "loading" ? (
        <SkeletonIndex />
      ) : read.status === "failed" ? (
        <Failed message={read.message} onRetry={() => void load()} />
      ) : read.read.entries.length === 0 ? (
        <section className="empty" aria-labelledby="empty-title">
          <h2 id="empty-title">{copy.empty}</h2>
        </section>
      ) : (
        <section className="index timeline" aria-label={copy.timeline}>
          <ol className="timeline-list" aria-label={copy.timeline}>
            {read.read.entries.map(({ mailbox, thread, change }) => {
              const actor = "actor" in change ? change.actor : undefined;
              const linked = mailbox === undefined || thread === undefined ? undefined : threads.get(`${mailbox}/${thread}`);
              const message = linked !== undefined && "messages" in linked && "message" in change ? linked.messages.get(change.message) : undefined;
              const [by, rest] = copy.entry(change, who(actor), name, message);
              const time = clock(new Date(change.at), zone);
              return (
                <li className="entry" key={`${mailbox ?? "organization"}/${change.position}`}>
                  <time className="entry-time" dateTime={change.at}>
                    {time}
                  </time>
                  <p className="entry-line">
                    <span className="entry-said">
                      <strong className="entry-by">{by}</strong>
                      {rest}
                    </span>
                    {mailbox !== undefined && thread !== undefined && (
                      <>
                        {" "}
                        <span className="entry-thread">
                          {linked !== undefined && "gone" in linked ? (
                            <span className="entry-gone">{copy.threadGone}</span>
                          ) : (
                            <a
                              href={threadHref(thread, { label: "inbox" }, mailbox === mine ? "#/" : `#/mailboxes/${encodeURIComponent(mailbox)}/`)}
                              aria-label={copy.threadLabel(linked === undefined ? copy.openThread : linked.subject || copy.noSubject, time, by + rest)}
                            >
                              {linked === undefined ? copy.openThread : linked.subject || copy.noSubject}
                            </a>
                          )}
                        </span>
                      </>
                    )}
                  </p>
                </li>
              );
            })}
          </ol>
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
    </main>
  );
}
