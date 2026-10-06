// The Alerts view: what the agents a sponsor answers for need them for, newest first, on one sheet.
// Each alert names its agent and what happened, and opens the message it is about, or the agent's
// line in Settings. Unseen alerts carry the pencil's dot, and urgent ones that are unseen lie on
// Alert Wash. Marking one seen, or opening it, counts it no more in the bar.
import { useCallback, useEffect, useState } from "react";
import type { DuvaClient } from "@duva/client";
import type { components } from "@duva/openapi";
import { Time } from "./mail-parts.tsx";
import { mailboxHref } from "./mailboxes.tsx";
import { strings } from "./strings.ts";

type Alert = components["schemas"]["Alert"];
type Mailbox = components["schemas"]["Mailbox"];

type Listing = { status: "loading" } | { status: "failed"; message: string } | { status: "listed"; alerts: Alert[]; next?: string; more: "idle" | "loading" | "failed" };

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
  const copy = strings.alerts;

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
    return () => {
      current = false;
    };
  }, [page, version]);

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

  const hrefOf = (alert: Alert): { href: string; name: string } | undefined => {
    const mailbox = mailboxes.find(({ id }) => id === alert.mailbox);
    if (mailbox !== undefined && alert.thread !== undefined) {
      const message = alert.message === undefined ? "" : `?message=${encodeURIComponent(alert.message)}`;
      return { href: `${mailboxHref(mailbox, mailbox.id === mine)}threads/${encodeURIComponent(alert.thread)}${message}`, name: copy.openMessage };
    }
    // Only a mailbox's owner writes there, so only the human's own drafts open.
    if (mailbox !== undefined && mailbox.id === mine && alert.draft !== undefined) return { href: `#/drafts/${encodeURIComponent(alert.draft)}`, name: copy.openDraft };
    return agents.has(alert.agent) ? { href: agentHref(alert.agent), name: copy.openAgent(alert.agentName) } : undefined;
  };

  return (
    <main className="desk" aria-busy={listing.status === "loading"}>
      <div className="desk-head">
        <h1>{copy.title}</h1>
        {unseen > 0 && <p className="count">{copy.unseen(unseen)}</p>}
        {unseen > 0 && (
          <button type="button" className="button button-quiet button-small desk-head-action" onClick={() => void see(listing.status === "listed" ? listing.alerts.filter((alert) => !alert.seen).map(({ id }) => id) : [])}>
            {copy.markAllSeen}
          </button>
        )}
      </div>
      {problem !== undefined && (
        <p className="notice notice-alert alerts-problem" role="alert">
          {problem}
        </p>
      )}
      {listing.status === "loading" ? null : listing.status === "failed" ? (
        <div className="notice notice-alert failed-listing" role="alert">
          <p>{listing.message}</p>
          <button type="button" className="button button-small" onClick={() => location.reload()}>
            {strings.inbox.retry}
          </button>
        </div>
      ) : listing.alerts.length === 0 ? (
        <section className="empty" aria-labelledby="empty-title">
          <h2 id="empty-title">{copy.emptyTitle}</h2>
          <p>{copy.emptyLead}</p>
        </section>
      ) : (
        <div className="index alerts">
          <ol className="alert-list" aria-label={copy.title}>
            {listing.alerts.map((alert) => {
              const link = hrefOf(alert);
              const classes = ["alert", !alert.seen && "alert-unseen", alert.urgent && "alert-urgent"].filter(Boolean).join(" ");
              return (
                <li key={alert.id} className={classes}>
                  <span className="alert-mark" aria-hidden="true" />
                  <div className="alert-body">
                    <p className="alert-head">
                      <span className="alert-agent">{alert.agentName}</span>
                      <span className="alert-kind">{copy.kinds[alert.kind]}</span>
                      {alert.urgent && <span className="urgent-mark">{copy.urgent}</span>}
                    </p>
                    <p className="alert-what">{alert.what}</p>
                    {(link !== undefined || !alert.seen) && (
                      <div className="alert-actions">
                        {link !== undefined && (
                          <a href={link.href} onClick={() => !alert.seen && void see([alert.id])}>
                            {link.name}
                          </a>
                        )}
                        {!alert.seen && (
                          <button type="button" className="button button-quiet button-small" onClick={() => void see([alert.id])}>
                            {copy.markSeen}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  <span className="alert-date">
                    <Time at={alert.at} short />
                  </span>
                  {!alert.seen && <span className="visually-hidden">{copy.unseenMark}</span>}
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
      )}
    </main>
  );
}
