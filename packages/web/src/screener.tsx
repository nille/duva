// The Screener, where mail from a mailbox's first-time senders waits: each sender, by their mark,
// with their mail, newest first, and where their mail goes from here: the Inbox, the Feed, the
// Paper Trail or nowhere at once, or more on their sheet, as a label or everyone at their domain.
// Screened senders lists the decisions by where they send mail, each opening its sheet.
import { useCallback, useEffect, useId, useState } from "react";
import type { DuvaClient } from "@duva/client";
import type { components } from "@duva/openapi";
import type { Connection as ConnectionState } from "./feed.ts";
import { Connection, SenderMark, Time } from "./mail-parts.tsx";
import type { Done, Label } from "./organize.tsx";
import { useBeside, useViewTitle, ViewMain, ViewTitle } from "./panes.tsx";
import { decideDelivery } from "./sender.tsx";
import { strings } from "./strings.ts";
import { hrefOf, pathOf, screenedSendersPath, senderHref } from "./views.tsx";

type Mailbox = components["schemas"]["Mailbox"];
type Screener = components["schemas"]["Screener"];
type WaitingSender = components["schemas"]["WaitingSender"];
type ScreenedSender = components["schemas"]["ScreenedSender"];
type Delivery = components["schemas"]["Delivery"];

/** The mailbox's Screener as the web app last read it. */
export type ScreenerRead = { status: "loading" } | { status: "failed"; message: string } | { status: "read"; screener: Screener };

/** The address or domain a mailbox decided on. */
const valueOf = (sender: ScreenedSender) => sender.address ?? sender.domain ?? "";

/** Reads the mailbox's Screener as the web app keeps it, or calls `onSignedOut` and answers undefined if the session has ended. */
export async function readScreener(client: DuvaClient, mailbox: string, onSignedOut: () => void): Promise<ScreenerRead | undefined> {
  const { data, response } = await client.GET("/mailboxes/{mailbox}/screener", { params: { path: { mailbox } } }).catch(() => ({ data: undefined, response: undefined }));
  if (response?.status === 401) {
    onSignedOut();
    return undefined;
  }
  if (data === undefined) return { status: "failed", message: response === undefined ? strings.screener.unreachable : strings.screener.failed(response.status) };
  return { status: "read", screener: data };
}

/** The deliveries a waiting sender's line offers at once. A label, or everyone at their domain, is chosen on their sheet. */
const atOnce: Delivery[] = ["inbox", "feed", "paperTrail", "nowhere"];

/**
 * The Screener of the human's mailbox whose Inbox is at `base`, as the web app last read it. `done` is what the human
 * last did here, and `onDone` hears each decision, after which the Screener is read again. The head
 * speaks of the connection only when Duva can't be reached.
 */
export function ScreenerView({
  client,
  mailbox,
  base,
  read,
  labels,
  connection,
  done,
  onDone,
  onRetry,
  onSignedOut,
}: {
  client: DuvaClient;
  mailbox: Mailbox;
  base: string;
  read: ScreenerRead;
  labels: Label[];
  connection: ConnectionState;
  done: Done | undefined;
  onDone: (done: Done) => void;
  onRetry: () => void;
  onSignedOut: () => void;
}) {
  const title = strings.screener.title;
  // Mail waiting here calls for no attention, so the tab's title counts nothing.
  useViewTitle(strings.title(title));
  const { open } = useBeside();
  const screener = read.status === "read" ? read.screener : undefined;

  return (
    <ViewMain className="desk" aria-busy={read.status === "loading"}>
      <div className="desk-head">
        <ViewTitle tabIndex={-1} className="view-title">
          {title}
        </ViewTitle>
        {connection?.ok === false && <Connection state={connection} unreachable={strings.connection.mailUnreachable} />}
      </div>
      <div className="screener-lead">
        <p>{strings.screener.lead}</p>
        {screener !== undefined && !screener.on && (
          <p className="screener-off">
            {strings.screener.off} <a href="#/settings/screener">{strings.screener.switchOn}</a>
          </p>
        )}
        {screener !== undefined && (
          <p className="screener-screened">
            <a href={`${base}${screenedSendersPath}`}>{strings.screener.screened}</a>
            <span>{strings.screener.screenedCounts(screener.decided)}</span>
          </p>
        )}
      </div>
      <div className="done-line" role="status">
        {done !== undefined && <span>{done.message}</span>}
      </div>
      {read.status === "loading" ? null : read.status === "failed" ? (
        <div className="notice notice-alert failed-listing" role="alert">
          <p>{read.message}</p>
          <button type="button" className="button button-small" onClick={onRetry}>
            {strings.inbox.retry}
          </button>
        </div>
      ) : read.screener.senders.length === 0 ? (
        <section className="empty" aria-labelledby="empty-title">
          <h2 id="empty-title">{strings.screener.emptyTitle}</h2>
          <p>{strings.screener.emptyLead}</p>
        </section>
      ) : (
        <ol className="waiting" aria-label={strings.screener.senders}>
          {read.screener.senders.map((sender) => (
            <Waiting key={sender.address} client={client} mailbox={mailbox} base={base} sender={sender} labels={labels} open={open} onDone={onDone} onSignedOut={onSignedOut} />
          ))}
        </ol>
      )}
    </ViewMain>
  );
}

/**
 * A waiting sender: who they are, their mail, and where their mail goes from here, chosen at once,
 * nowhere only once asked in place, or on their sheet.
 */
function Waiting({
  client,
  mailbox,
  base,
  sender,
  labels,
  open,
  onDone,
  onSignedOut,
}: {
  client: DuvaClient;
  mailbox: Mailbox;
  base: string;
  sender: WaitingSender;
  labels: Label[];
  /** The thread open beside the Screener, whose line it marks. */
  open?: string;
  onDone: (done: Done) => void;
  onSignedOut: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const [state, setState] = useState<{ status: "idle" | "busy" } | { status: "failed"; message: string }>({ status: "idle" });
  const headingId = useId();
  const name = sender.name || sender.address;
  const from = pathOf({ screener: true });
  const copy = strings.sender.choices;

  const save = async (delivery: Delivery) => {
    setState({ status: "busy" });
    const saved = await decideDelivery(client, { mailbox: mailbox.id, sender: { address: sender.address.toLowerCase() }, delivery, labels, onSignedOut });
    if (saved === undefined) return;
    if ("failed" in saved) return setState({ status: "failed", message: saved.failed });
    // The sender leaves the Screener once it is read again, and stays busy until then, so nothing is decided twice.
    setAsking(false);
    onDone(saved.done);
  };

  return (
    <li className="waiting-sender" aria-labelledby={headingId}>
      <div className="waiting-head">
        <SenderMark kind="human" logo={sender.threads.find((thread) => thread.logo !== undefined)?.logo} name={name} />
        <h2 id={headingId}>{name}</h2>
        {name !== sender.address && <span className="waiting-address">{sender.address}</span>}
      </div>
      <ol className="waiting-threads" aria-label={strings.screener.mailFrom(name)}>
        {sender.threads.map((thread) => (
          <li key={thread.id}>
            <a className="waiting-thread" href={`${base}threads/${encodeURIComponent(thread.id)}?from=${encodeURIComponent(from)}`} aria-current={thread.id === open ? "true" : undefined}>
              <span className="waiting-subject">{thread.subject || strings.thread.noSubject}</span>
              {thread.snippet !== "" && (
                <span className="waiting-snippet" lang="">
                  {thread.snippet}
                </span>
              )}
              <span className="waiting-date">
                <Time at={thread.latestAt} short />
              </span>
            </a>
          </li>
        ))}
      </ol>
      <div className="waiting-actions">
        {asking ? (
          <div className="confirm" role="group" aria-label={strings.sender.nowhereConfirm}>
            <p>{strings.screener.nowhereAsk(sender.threads.length)}</p>
            <div className="confirm-choices">
              <button type="button" className="button button-small button-call" disabled={state.status === "busy"} onClick={() => void save("nowhere")}>
                {strings.sender.nowhereConfirm}
              </button>
              <button
                type="button"
                className="button button-small button-quiet"
                onClick={() => {
                  setAsking(false);
                  setState({ status: "idle" });
                }}
              >
                {strings.screener.cancel}
              </button>
            </div>
          </div>
        ) : (
          <div className="waiting-choices" role="group" aria-label={strings.screener.sendTo(name)}>
            {atOnce.map((delivery) => (
              <button
                key={delivery}
                type="button"
                className={delivery === "inbox" ? "button button-small button-primary" : "button button-small"}
                disabled={state.status === "busy"}
                onClick={() => (delivery === "nowhere" ? setAsking(true) : void save(delivery))}
              >
                {copy[delivery].name}
              </button>
            ))}
            <a className="button button-small button-quiet" href={senderHref(sender.address.toLowerCase(), from, base)} aria-label={strings.screener.moreFor(name)}>
              {strings.screener.more}
            </a>
          </div>
        )}
        {state.status === "failed" && (
          <p className="field-error" role="alert">
            {state.message}
          </p>
        )}
      </div>
    </li>
  );
}

type Listed = { status: "loading" } | { status: "failed"; message: string } | { status: "listed"; senders: ScreenedSender[] };

/** The deliveries the screened senders are grouped by, in the order the list shows them. */
const groups: Delivery[] = ["inbox", "feed", "paperTrail", "label", "nowhere"];

/**
 * The senders the mailbox decided on, grouped by where their mail goes, each newest first, to open
 * on their sheet or remove. `version` counts the changes to the mailbox the app has seen, so the
 * list is read again when it grows. `me` is the human's ID and `agentNames` names the agents they
 * sponsor, to say who decided. `open` is the sender whose sheet lies beside it.
 */
export function ScreenedSenders({
  client,
  mailbox,
  base,
  me,
  agentNames,
  labels,
  version,
  open,
  done,
  onDone,
  onSignedOut,
}: {
  client: DuvaClient;
  mailbox: Mailbox;
  base: string;
  me: string;
  agentNames: ReadonlyMap<string, string>;
  labels: Label[];
  version: number;
  open?: string;
  done: Done | undefined;
  onDone: (done: Done) => void;
  onSignedOut: () => void;
}) {
  const [listed, setListed] = useState<Listed>({ status: "loading" });
  const [query, setQuery] = useState("");
  const findId = useId();
  const title = strings.screened.title;
  useViewTitle(strings.title(title));

  const load = useCallback(async () => {
    const { data, response } = await client.GET("/mailboxes/{mailbox}/senders", { params: { path: { mailbox: mailbox.id } } }).catch(() => ({ data: undefined, response: undefined }));
    if (response?.status === 401) return onSignedOut();
    if (data === undefined) return setListed({ status: "failed", message: response === undefined ? strings.screened.unreachable : strings.screened.failed(response.status) });
    setListed({ status: "listed", senders: data.senders });
  }, [client, mailbox.id, onSignedOut]);
  useEffect(() => {
    void load();
  }, [load, version]);

  const changed = (what: Done) => {
    onDone(what);
    void load();
  };

  const wanted = query.trim().toLowerCase();
  const shown = listed.status === "listed" ? listed.senders.filter((sender) => valueOf(sender).includes(wanted)) : [];
  const group = (delivery: Delivery) => {
    const senders = shown.filter((sender) => sender.delivery === delivery);
    const name = strings.screened.groups[delivery];
    return (
      <section className="screened-group" aria-labelledby={`screened-${delivery}`} key={delivery}>
        <h2 id={`screened-${delivery}`}>{name}</h2>
        {senders.length === 0 ? (
          <p className="hint">{wanted !== "" ? strings.screened.noneFound : strings.screened.none}</p>
        ) : (
          <ul className="screened" aria-label={name}>
            {senders.map((sender) => (
              <Screened
                key={valueOf(sender)}
                client={client}
                mailbox={mailbox}
                sender={sender}
                href={senderHref(valueOf(sender), screenedSendersPath, base)}
                open={open === valueOf(sender)}
                place={sender.delivery === "label" ? labels.find(({ id }) => id === sender.label)?.name : undefined}
                by={sender.actor === undefined ? undefined : sender.actor === me ? strings.screened.you : agentNames.get(sender.actor)}
                onDone={changed}
                onSignedOut={onSignedOut}
              />
            ))}
          </ul>
        )}
      </section>
    );
  };

  return (
    <ViewMain className="desk" aria-busy={listed.status === "loading"}>
      <p className="back">
        <a href={hrefOf({ screener: true }, base)}>{strings.screened.back}</a>
      </p>
      <div className="desk-head">
        <ViewTitle tabIndex={-1} className="view-title">
          {title}
        </ViewTitle>
      </div>
      <div className="screener-lead">
        <p>{strings.screened.lead}</p>
      </div>
      <div className="done-line" role="status">
        {done !== undefined && <span>{done.message}</span>}
      </div>
      {listed.status === "failed" ? (
        <div className="notice notice-alert failed-listing" role="alert">
          <p>{listed.message}</p>
          <button type="button" className="button button-small" onClick={() => void load()}>
            {strings.inbox.retry}
          </button>
        </div>
      ) : (
        listed.status === "listed" && (
          <div className="screened-sheet">
            <div className="screened-find">
              <label htmlFor={findId}>{strings.screened.find}</label>
              <input id={findId} type="search" value={query} autoComplete="off" onChange={(event) => setQuery(event.target.value)} />
            </div>
            {groups.map(group)}
          </div>
        )
      )}
    </ViewMain>
  );
}

/** A screened sender: who, opening their sheet, the label their mail is filed under, when and by whom it was decided, then removing it. */
function Screened({
  client,
  mailbox,
  sender,
  href,
  open,
  place,
  by,
  onDone,
  onSignedOut,
}: {
  client: DuvaClient;
  mailbox: Mailbox;
  sender: ScreenedSender;
  href: string;
  open: boolean;
  place: string | undefined;
  by: string | undefined;
  onDone: (done: Done) => void;
  onSignedOut: () => void;
}) {
  const [state, setState] = useState<{ status: "idle" | "busy" } | { status: "failed"; message: string }>({ status: "idle" });
  const who = strings.screener.who(sender);

  const remove = async () => {
    setState({ status: "busy" });
    const { data, response } = await client
      .DELETE("/mailboxes/{mailbox}/senders/{sender}", { params: { path: { mailbox: mailbox.id, sender: valueOf(sender) } } })
      .catch(() => ({ data: undefined, response: undefined }));
    if (response?.status === 401) return onSignedOut();
    if (data === undefined) return setState({ status: "failed", message: response === undefined ? strings.screener.decideUnreachable : strings.screener.decideFailed(response.status) });
    setState({ status: "idle" });
    onDone({ message: strings.screened.removed(who, data.threads.length) });
  };

  return (
    <li className="screened-sender">
      <div className="screened-who">
        <a className="screened-name" href={href} aria-current={open ? "true" : undefined}>
          {sender.address ?? strings.screened.everyoneAt(sender.domain ?? "")}
        </a>
        <span className="hint">
          {place !== undefined && `${place}. `}
          {strings.screened.decided} <Time at={sender.decidedAt} short />
          {by !== undefined && ` ${strings.screened.by(by)}`}
        </span>
      </div>
      <div className="screened-actions">
        <button type="button" className="button button-small button-quiet" disabled={state.status === "busy"} onClick={() => void remove()}>
          {strings.screened.remove}
        </button>
      </div>
      {state.status === "failed" && (
        <p className="field-error" role="alert">
          {state.message}
        </p>
      )}
    </li>
  );
}
