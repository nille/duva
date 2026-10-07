// The Alerts view: what the agents a sponsor answers for need them for, newest first, as rows in the
// list column, with the alert chosen open in the reading pane beside them. Each alert names its agent
// and what happened, and opens the message it is about, or the agent's line in Settings. A pause
// opens the agent's line at Pause, and while the agent is paused, its sends held in Approvals. Unseen
// alerts carry a red dot, and urgent ones are marked in red. Marking one seen, or following where it
// leads, counts it no more in the bar. Each alert's controls are named for its agent and what
// happened, so they tell it apart from the others.
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { DuvaClient } from "@duva/client";
import type { components } from "@duva/openapi";
import { ActorMark, Time } from "./mail-parts.tsx";
import { mailboxHref } from "./mailboxes.tsx";
import { strings } from "./strings.ts";
import { BackIcon } from "./thread.tsx";

type Alert = components["schemas"]["Alert"];
type Mailbox = components["schemas"]["Mailbox"];

type AlertKind = Alert["kind"];

// What an alert about a pause opens: the agent's line at Pause, and the sends its pause holds.
const pauses = new Set<AlertKind>(["pausedBy", "autoPaused", "keyUsedWhilePaused"]);

type Listing = { status: "loading" } | { status: "failed"; message: string } | { status: "listed"; alerts: Alert[]; next?: string; more: "idle" | "loading" | "failed" };

/** Set as an alert leads to the held sends, so Approvals opens on them. */
export const heldAsked = { current: false };

/** Where the agent's line is in Settings, open. */
export const agentHref = (agent: string) => `#/settings/agents/${encodeURIComponent(agent)}`;

/**
 * The view. `mailboxes` are those the human reads, to open what an alert is about, and `agents` the
 * IDs of the agents they still sponsor. `version` grows when a new alert arrives, and `onUnseen`
 * hears how many are unseen after the human marks some seen.
 */
export function Alerts({
  client,
  mailboxes,
  mine,
  agents,
  version,
  onUnseen,
  onSignedOut,
}: {
  client: DuvaClient;
  mailboxes: readonly Mailbox[];
  mine?: string;
  agents: ReadonlySet<string>;
  version: number;
  onUnseen: (count: number) => void;
  onSignedOut: () => void;
}) {
  const [listing, setListing] = useState<Listing>({ status: "loading" });
  const [problem, setProblem] = useState<string>();
  // The agents paused now, whose held sends Approvals lists.
  const [paused, setPaused] = useState<ReadonlySet<string>>(new Set());
  const id = useId();
  const copy = strings.alerts;
  // The alert chosen, and whether it was opened to read, which on a phone and a narrow window takes
  // the column from the list.
  const [chosen, setChosen] = useState<string>();
  const [reading, setReading] = useState(false);
  const [focusing, setFocusing] = useState<"pane" | "row">();
  const pane = useRef<HTMLDivElement>(null);
  const rows = useRef<HTMLOListElement>(null);

  const page = useCallback(
    async (after?: string) => {
      const { data, response } = await client.GET("/alerts", { params: { query: { after } } }).catch(() => ({ data: undefined, response: undefined }));
      if (response?.status === 401) {
        onSignedOut();
        return undefined;
      }
      return data ?? { failed: response === undefined ? copy.unreachable : copy.failed(response.status) };
    },
    [client, onSignedOut, copy],
  );

  // The first page is read again when a new alert arrives, so the newest shows at the top.
  useEffect(() => {
    let current = true;
    void page().then((answer) => {
      if (!current || answer === undefined) return;
      if ("failed" in answer) return setListing((listed) => (listed.status === "listed" ? listed : { status: "failed", message: answer.failed }));
      // Pages read with More alerts stay, under the first page as it is now.
      setListing((listed) => {
        if (listed.status !== "listed") return { status: "listed", alerts: answer.alerts, next: answer.next, more: "idle" };
        const first = new Set(answer.alerts.map(({ id }) => id));
        const older = listed.alerts.filter(({ id }) => !first.has(id));
        return { status: "listed", alerts: [...answer.alerts, ...older], next: older.length > 0 ? listed.next : answer.next, more: "idle" };
      });
    });
    void client
      .GET("/agents")
      .then(({ data }) => current && data !== undefined && setPaused(new Set(data.agents.filter((agent) => agent.paused !== undefined).map((agent) => agent.id))))
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [client, page, version]);

  const unseen = listing.status === "listed" ? listing.alerts.filter((alert) => !alert.seen).length : 0;
  useEffect(() => {
    document.title = strings.title(copy.title, unseen);
  }, [unseen, copy]);

  const more = async () => {
    if (listing.status !== "listed" || listing.next === undefined) return;
    setListing({ ...listing, more: "loading" });
    const answer = await page(listing.next);
    if (answer === undefined) return;
    setListing((listed) =>
      listed.status !== "listed" ? listed : "failed" in answer ? { ...listed, more: "failed" } : { status: "listed", alerts: [...listed.alerts, ...answer.alerts.filter((alert) => !listed.alerts.some(({ id }) => id === alert.id))], next: answer.next, more: "idle" },
    );
  };

  /** Marks the alerts seen, a hundred at a time, and says so at once. */
  const see = async (ids: string[]) => {
    if (ids.length === 0) return;
    setProblem(undefined);
    const marked = new Set(ids);
    setListing((listed) => (listed.status === "listed" ? { ...listed, alerts: listed.alerts.map((alert) => (marked.has(alert.id) ? { ...alert, seen: true } : alert)) } : listed));
    for (let start = 0; start < ids.length; start += 100) {
      const { data, response } = await client.POST("/alerts/seen", { body: { alerts: ids.slice(start, start + 100) } }).catch(() => ({ data: undefined, response: undefined }));
      if (response?.status === 401) return onSignedOut();
      if (data === undefined) return setProblem(copy.seeFailed);
      onUnseen(data.unseen);
    }
  };

  const linksOf = (alert: Alert): { href: string; name: string }[] => {
    const mailbox = mailboxes.find(({ id }) => id === alert.mailbox);
    if (mailbox !== undefined && alert.thread !== undefined) {
      const message = alert.message === undefined ? "" : `?message=${encodeURIComponent(alert.message)}`;
      return [{ href: `${mailboxHref(mailbox, mailbox.id === mine)}threads/${encodeURIComponent(alert.thread)}${message}`, name: copy.openMessage }];
    }
    // The mailboxes are the human's own, so the draft opens wherever it is among them.
    if (mailbox !== undefined && alert.draft !== undefined) return [{ href: `#/drafts/${encodeURIComponent(alert.draft)}`, name: copy.openDraft }];
    if (!agents.has(alert.agent)) return [];
    if (!pauses.has(alert.kind)) return [{ href: agentHref(alert.agent), name: copy.openAgent(alert.agentName) }];
    return [...(paused.has(alert.agent) ? [{ href: "#/approvals", name: copy.heldSends }] : []), { href: agentHref(alert.agent), name: copy.openAtPause(alert.agentName) }];
  };

  const alerts = listing.status === "listed" ? listing.alerts : [];
  // The one open in the reading pane: the one chosen, or the newest unseen. It stays open as others arrive above it.
  const open = alerts.find((alert) => alert.id === chosen) ?? alerts.find((alert) => !alert.seen) ?? alerts[0];
  useEffect(() => {
    if (open !== undefined && open.id !== chosen) setChosen(open.id);
  }, [open, chosen]);
  // Choosing a row moves the focus to the alert it opened, and coming back moves it to the row.
  useEffect(() => {
    if (focusing === undefined) return;
    setFocusing(undefined);
    const target = focusing === "pane" ? pane.current?.querySelector<HTMLElement>("article h2") : rows.current?.querySelector<HTMLElement>('[aria-current="true"]');
    if (target === null || target === undefined) return;
    if (focusing === "pane") target.tabIndex = -1;
    target.focus();
  }, [focusing]);

  const head = (
    <div className="desk-head queue-head">
      <h1>{copy.title}</h1>
      {unseen > 0 && <p className="count">{copy.unseen(unseen)}</p>}
      {unseen > 0 && (
        <button type="button" className="button button-quiet button-small desk-head-action" onClick={() => void see(alerts.filter((alert) => !alert.seen).map(({ id }) => id))}>
          {copy.markAllSeen}
        </button>
      )}
    </div>
  );
  const problemNotice = problem !== undefined && (
    <p className="notice notice-alert alerts-problem" role="alert">
      {problem}
    </p>
  );
  if (listing.status !== "listed" || listing.alerts.length === 0) {
    return (
      <main className="desk" aria-busy={listing.status === "loading"}>
        {head}
        {problemNotice}
        {listing.status === "loading" ? null : listing.status === "failed" ? (
          <div className="notice notice-alert failed-listing" role="alert">
            <p>{listing.message}</p>
            <button type="button" className="button button-small" onClick={() => location.reload()}>
              {strings.inbox.retry}
            </button>
          </div>
        ) : (
          <section className="empty" aria-labelledby="empty-title">
            <h2 id="empty-title">{copy.emptyTitle}</h2>
            <p>{copy.emptyLead}</p>
          </section>
        )}
      </main>
    );
  }

  const index = alerts.findIndex((alert) => alert === open);
  const at = `${id}-open`;
  const about = `${at}-agent ${at}-kind ${at}-what`;
  const links = open === undefined ? [] : linksOf(open);
  return (
    <main className={reading ? "queue-view queue-view-reading" : "queue-view"}>
      <div className="queue">
        {head}
        {problemNotice}
        <ol className="queue-rows alert-list" aria-label={copy.title} ref={rows}>
          {alerts.map((alert, each) => {
            const classes = ["queue-row", "alert-row", !alert.seen && "alert-unseen", alert.urgent && "alert-urgent"].filter(Boolean).join(" ");
            return (
              <li key={alert.id}>
                <button
                  type="button"
                  className={classes}
                  aria-current={each === index ? "true" : undefined}
                  aria-controls={`${id}-pane`}
                  onClick={() => {
                    setChosen(alert.id);
                    setReading(true);
                    setFocusing("pane");
                  }}
                >
                  <span className="queue-who">
                    <span className="alert-mark" aria-hidden="true" />
                    <ActorMark kind="agent" agent={alert.agent} />
                    {alert.agentName}
                  </span>
                  <span className="queue-kind alert-kind">{copy.kinds[alert.kind]}</span>
                  <span className="queue-time">
                    <Time at={alert.at} short />
                  </span>
                  <span className="queue-line">
                    {alert.urgent && <span className="urgent-mark">{copy.urgent}</span>} {alert.what}
                  </span>
                  {!alert.seen && <span className="visually-hidden">{copy.unseenMark}</span>}
                </button>
              </li>
            );
          })}
        </ol>
        {listing.next !== undefined && (
          <div className="index-foot">
            <button type="button" className="button" disabled={listing.more === "loading"} onClick={() => void more()}>
              {listing.more === "loading" ? strings.loading : copy.more}
            </button>
          </div>
        )}
      </div>
      <div className="queue-read" id={`${id}-pane`} ref={pane}>
        <button
          type="button"
          className="button button-quiet button-small queue-back"
          onClick={() => {
            setReading(false);
            setFocusing("row");
          }}
        >
          <BackIcon />
          {copy.back}
        </button>
        {open !== undefined && (
          <article key={open.id} className={["alert", !open.seen && "alert-unseen", open.urgent && "alert-urgent"].filter(Boolean).join(" ")} aria-labelledby={`${at}-title`}>
            <header className="galley-head">
              <h2 id={`${at}-title`}>
                <span className="galley-asks" id={`${at}-agent`}>
                  <ActorMark kind="agent" agent={open.agent} />
                  {open.agentName}
                </span>{" "}
                <span className="galley-subject" id={`${at}-kind`}>
                  {copy.kinds[open.kind]}
                </span>
              </h2>
              <p className="galley-meta">
                {open.urgent && <span className="urgent-mark">{copy.urgent}</span>}
                {!open.seen && <span className="alert-seen-state">{copy.unseenMark}</span>}
                <Time at={open.at} />
              </p>
            </header>
            <p className="alert-what" id={`${at}-what`}>
              {open.what}
            </p>
            {(links.length > 0 || !open.seen) && (
              <div className="alert-actions">
                {links.map((link, each) => (
                  <a
                    key={link.href}
                    id={`${at}-link-${each}`}
                    className={each === 0 ? "button button-primary" : "button"}
                    href={link.href}
                    aria-labelledby={`${at}-link-${each} ${about}`}
                    onClick={() => {
                      if (link.href === "#/approvals") heldAsked.current = true;
                      if (!open.seen) void see([open.id]);
                    }}
                  >
                    {link.name}
                  </a>
                ))}
                {!open.seen && (
                  <button type="button" id={`${at}-seen`} className="button button-quiet" aria-labelledby={`${at}-seen ${about}`} onClick={() => void see([open.id])}>
                    {copy.markSeen}
                  </button>
                )}
              </div>
            )}
          </article>
        )}
      </div>
    </main>
  );
}
