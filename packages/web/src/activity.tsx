// An agent's activity, for its sponsor: a summary of each of the last 30 days, newest first, each
// opening into the day's timeline, where every entry says who did what and links to its thread.
// Days run in the human's time zone, or the browser's until they choose one.
import { useCallback, useEffect, useState } from "react";
import type { DuvaClient } from "@duva/client";
import type { components } from "@duva/openapi";
import { useDates } from "./dates.ts";
import { SkeletonIndex } from "./inbox.tsx";
import { strings } from "./strings.ts";
import { BackIcon } from "./thread.tsx";
import { threadHref } from "./views.tsx";

type ActivitySummary = components["schemas"]["ActivitySummary"];
type ActivityEntry = components["schemas"]["ActivityEntry"];

/** The kinds a summary counts, each a column. */
const kinds = ["sent", "approved", "rejected", "received", "organized", "screened", "alerts"] as const satisfies readonly (keyof ActivitySummary & keyof typeof strings.activity.kinds & keyof typeof strings.activity.counts)[];

/** Where the agent's activity is in the web app, or the day's timeline there. */
export const activityHref = (agent: string, day?: string) => `#/agents/${encodeURIComponent(agent)}${day === undefined ? "" : `/${day}`}`;

/** The time zone days run in: the human's, or the browser's until they choose one. */
const zoneOf = (timeZone: string | undefined) => timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

type Read<T> = { status: "loading" } | { status: "failed"; message: string } | { status: "read"; read: T };

/** Why Duva gave nothing, as the page says it. */
const failure = (response: Response | undefined) => (response === undefined ? strings.activity.unreachable : strings.activity.failed(response.status));

/** A day as YYYY-MM-DD, named as the human reads dates: its weekday and its date. */
function useDayName() {
  const { date } = useDates();
  return useCallback(
    (day: string) => {
      const [year, month, ofMonth] = day.split("-").map(Number) as [number, number, number];
      const local = new Date(year, month - 1, ofMonth);
      return `${local.toLocaleDateString(undefined, { weekday: "long" })}, ${date(local, true)}`;
    },
    [date],
  );
}

/** The agent's summaries for the last 30 days, `name` being the agent's name if the human sponsors it. */
export function AgentActivity({ client, agent, name = strings.galley.anAgent, timeZone, onSignedOut }: { client: DuvaClient; agent: string; name?: string; timeZone?: string; onSignedOut: () => void }) {
  const [read, setRead] = useState<Read<{ timeZone: string; days: ActivitySummary[] }>>({ status: "loading" });
  const dayName = useDayName();
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
          <div className="day day-columns" aria-hidden="true">
            <span className="day-name">{copy.day}</span>
            {kinds.map((kind) => (
              <span className="day-count" key={kind}>
                {copy.kinds[kind]}
              </span>
            ))}
          </div>
          <ol className="days-list" aria-label={copy.days}>
            {read.read.days.map((summary) => {
              const counted = kinds.filter((kind) => summary[kind] > 0).map((kind) => copy.counts[kind](summary[kind]));
              return (
                <li key={summary.day}>
                  <a className={counted.length === 0 ? "day day-quiet" : "day"} href={activityHref(agent, summary.day)} aria-label={copy.dayLabel(dayName(summary.day), copy.counted(counted))}>
                    <span className="day-name">{dayName(summary.day)}</span>
                    {kinds.map((kind) => (
                      <span className={summary[kind] > 0 ? "day-count day-count-some" : "day-count"} key={kind}>
                        {summary[kind]}
                      </span>
                    ))}
                    <span className="day-said">{counted.length === 0 ? copy.nothing : counted.join(", ")}</span>
                  </a>
                </li>
              );
            })}
          </ol>
        </section>
      )}
    </main>
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

/** A thread an entry links to: its subject once read, or that it is gone. */
type Linked = { subject: string } | { gone: true } | undefined;

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
          if (data !== undefined) setThreads((current) => new Map([...current, [key, { subject: data.subject }]]));
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
              return (
                <li className="entry" key={`${mailbox ?? "organization"}/${change.position}`}>
                  <time className="entry-time" dateTime={change.at}>
                    {clock(new Date(change.at), zone)}
                  </time>
                  <span className="entry-said">{copy.entry(change, who(actor), name)}</span>
                  {mailbox !== undefined && thread !== undefined && (
                    <span className="entry-thread">
                      {linked !== undefined && "gone" in linked ? (
                        <span className="entry-gone">{copy.threadGone}</span>
                      ) : (
                        <a href={threadHref(thread, { label: "inbox" }, mailbox === mine ? "#/" : `#/mailboxes/${encodeURIComponent(mailbox)}/`)}>
                          {linked === undefined ? copy.openThread : linked.subject || copy.noSubject}
                        </a>
                      )}
                    </span>
                  )}
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
