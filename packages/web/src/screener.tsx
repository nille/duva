// The Screener, where mail from a mailbox's first-time senders waits: each sender with their mail,
// newest first, to let in or block by their address or, except at public mail providers, everyone at
// their domain. Screened senders lists the decisions, to flip or remove them.
import { useCallback, useEffect, useId, useState } from "react";
import type { DuvaClient } from "@duva/client";
import { type components, isPublicMailProvider } from "@duva/openapi";
import type { Connection as ConnectionState } from "./feed.ts";
import { Connection, Time } from "./mail-parts.tsx";
import type { Done } from "./organize.tsx";
import { strings } from "./strings.ts";
import { hrefOf, pathOf, screenedSendersPath } from "./views.tsx";

type Mailbox = components["schemas"]["Mailbox"];
type Screener = components["schemas"]["Screener"];
type WaitingSender = components["schemas"]["WaitingSender"];
type ScreenedSender = components["schemas"]["ScreenedSender"];
type ScreeningDecision = components["schemas"]["ScreeningDecision"];
type Decision = components["schemas"]["ScreeningDecisionKind"];
type Unsubscribe = components["schemas"]["Unsubscribe"];

/** The mailbox's Screener as the web app last read it. */
export type ScreenerRead = { status: "loading" } | { status: "failed"; message: string } | { status: "read"; screener: Screener };

/** An address, or a domain for everyone there. */
type Sender = { address: string } | { domain: string };

/** The address or domain a mailbox decided on. */
const senderOf = (sender: ScreenedSender): Sender => (sender.address !== undefined ? { address: sender.address } : { domain: sender.domain ?? "" });

/** The address or the domain itself. */
const valueOf = (sender: Sender) => ("address" in sender ? sender.address : sender.domain);

/** What saving a decision came to: what to say it did, or why it failed. */
type Saved = { done: Done } | { failed: string };

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

/** Lets the sender in or blocks them, and answers what to say it did. */
async function decide(client: DuvaClient, mailbox: string, decision: Decision, sender: Sender, onSignedOut: () => void): Promise<Saved | undefined> {
  const params = { path: { mailbox } };
  const { data, response } = await (decision === "letIn"
    ? client.POST("/mailboxes/{mailbox}/screener/let-in", { params, body: sender })
    : client.POST("/mailboxes/{mailbox}/screener/block", { params, body: sender })
  ).catch(() => ({ data: undefined, response: undefined }));
  if (response?.status === 401) {
    onSignedOut();
    return undefined;
  }
  if (data === undefined) return { failed: response === undefined ? strings.screener.decideUnreachable : strings.screener.decideFailed(response.status) };
  return { done: { message: decisionSaid(decision, data) } };
}

/** What a decision did: who it is on, the threads it moved, and for a block how unsubscribing went. */
function decisionSaid(decision: Decision, { sender, threads, unsubscribe }: ScreeningDecision): string {
  const who = strings.screener.who(sender);
  if (decision === "letIn") return strings.screener.letInDone(who, threads.length);
  return [strings.screener.blockDone(who, threads.length), unsubscribe && unsubscribeSaid(unsubscribe)].filter(Boolean).join(" ");
}

function unsubscribeSaid({ outcome, reason, status }: Unsubscribe): string {
  const copy = strings.screener.unsubscribe;
  if (outcome === "unsubscribed") return copy.unsubscribed;
  switch (reason) {
    case "noMail":
    case "spam":
    case "noOneClick":
    case "notSigned":
      return copy[reason];
    case "notAllowed":
    case "notPublic":
    case "unreachable":
    case "timedOut":
    case "tooManyRedirects":
      return copy.failed(copy[reason]);
    case "refused":
      return copy.failed(copy.refused(status));
    case undefined:
      return outcome === "failed" ? copy.failed(copy.refused(status)) : copy.noOneClick;
  }
}

/**
 * The Screener of the mailbox whose Inbox is at `base`, as the web app last read it, in the
 * human's own mailbox or, with the agent's name, an agent's they sponsor. `done` is what the human
 * last did here, and `onDone` hears each decision, after which the Screener is read again. The head
 * speaks of the connection only when Duva can't be reached.
 */
export function ScreenerView({
  client,
  mailbox,
  base,
  agent,
  read,
  connection,
  done,
  onDone,
  onRetry,
  onSignedOut,
}: {
  client: DuvaClient;
  mailbox: Mailbox;
  base: string;
  agent?: string;
  read: ScreenerRead;
  connection: ConnectionState;
  done: Done | undefined;
  onDone: (done: Done) => void;
  onRetry: () => void;
  onSignedOut: () => void;
}) {
  const title = agent === undefined ? strings.screener.title : strings.screener.agentTitle(agent);
  // Mail waiting here calls for no attention, so the tab's title counts nothing.
  useEffect(() => {
    document.title = strings.title(title);
  }, [title]);
  const screener = read.status === "read" ? read.screener : undefined;

  return (
    <main className="desk" aria-busy={read.status === "loading"}>
      <div className="desk-head">
        <h1 tabIndex={-1} className="view-title">
          {title}
        </h1>
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
            <span>{strings.screener.screenedCounts(screener.letIn, screener.blocked)}</span>
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
            <Waiting key={sender.address} client={client} mailbox={mailbox} base={base} sender={sender} onDone={onDone} onSignedOut={onSignedOut} />
          ))}
        </ol>
      )}
    </main>
  );
}

/** A waiting sender: who they are, their mail, and letting them in or blocking them, asked once in place for an address or a domain. */
function Waiting({
  client,
  mailbox,
  base,
  sender,
  onDone,
  onSignedOut,
}: {
  client: DuvaClient;
  mailbox: Mailbox;
  base: string;
  sender: WaitingSender;
  onDone: (done: Done) => void;
  onSignedOut: () => void;
}) {
  const [asking, setAsking] = useState<Decision>();
  const [state, setState] = useState<{ status: "idle" | "busy" } | { status: "failed"; message: string }>({ status: "idle" });
  const headingId = useId();
  const name = sender.name || sender.address;
  const domain = sender.address.slice(sender.address.lastIndexOf("@") + 1).toLowerCase();
  const from = encodeURIComponent(pathOf({ screener: true }));

  const save = async (decision: Decision, target: Sender) => {
    setState({ status: "busy" });
    const saved = await decide(client, mailbox.id, decision, target, onSignedOut);
    if (saved === undefined) return;
    if ("failed" in saved) return setState({ status: "failed", message: saved.failed });
    // The sender leaves the Screener once it is read again, and stays busy until then, so nothing is decided twice.
    setAsking(undefined);
    onDone(saved.done);
  };

  return (
    <li className="waiting-sender" aria-labelledby={headingId}>
      <div className="waiting-head">
        <h2 id={headingId}>{name}</h2>
        {name !== sender.address && <span className="waiting-address">{sender.address}</span>}
      </div>
      <ol className="waiting-threads" aria-label={strings.screener.mailFrom(name)}>
        {sender.threads.map((thread) => (
          <li key={thread.id}>
            <a className="waiting-thread" href={`${base}threads/${encodeURIComponent(thread.id)}?from=${from}`}>
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
        {asking === undefined ? (
          <>
            <button type="button" className="button button-small" disabled={state.status === "busy"} onClick={() => setAsking("letIn")}>
              {strings.screener.letIn}
            </button>
            <button type="button" className="button button-small" disabled={state.status === "busy"} onClick={() => setAsking("block")}>
              {strings.screener.block}
            </button>
          </>
        ) : (
          <div className="confirm" role="group" aria-label={asking === "letIn" ? strings.screener.letInWho(name) : strings.screener.blockWho(name)}>
            <p>{asking === "letIn" ? strings.screener.letInAsk : strings.screener.blockAsk}</p>
            <div className="confirm-choices">
              <button type="button" className="button button-small" disabled={state.status === "busy"} onClick={() => void save(asking, { address: sender.address })}>
                {strings.screener.thisAddress}
              </button>
              {!isPublicMailProvider(domain) && (
                <button type="button" className="button button-small" disabled={state.status === "busy"} onClick={() => void save(asking, { domain })}>
                  {strings.screener.everyoneAt(domain)}
                </button>
              )}
              <button
                type="button"
                className="button button-small button-quiet"
                onClick={() => {
                  setAsking(undefined);
                  setState({ status: "idle" });
                }}
              >
                {strings.screener.cancel}
              </button>
            </div>
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

/**
 * The senders the mailbox let in and blocked, each newest first, to flip or remove. `version`
 * counts the changes to the mailbox the app has seen, so the list is read again when it grows.
 * `me` is the human's ID and `agentNames` names the agents they sponsor, to say who decided.
 */
export function ScreenedSenders({
  client,
  mailbox,
  base,
  agent,
  me,
  agentNames,
  version,
  done,
  onDone,
  onSignedOut,
}: {
  client: DuvaClient;
  mailbox: Mailbox;
  base: string;
  agent?: string;
  me: string;
  agentNames: ReadonlyMap<string, string>;
  version: number;
  done: Done | undefined;
  onDone: (done: Done) => void;
  onSignedOut: () => void;
}) {
  const [listed, setListed] = useState<Listed>({ status: "loading" });
  const [query, setQuery] = useState("");
  const findId = useId();
  const title = agent === undefined ? strings.screened.title : strings.screened.agentTitle(agent);
  useEffect(() => {
    document.title = strings.title(title);
  }, [title]);

  const load = useCallback(async () => {
    const { data, response } = await client.GET("/mailboxes/{mailbox}/screener/senders", { params: { path: { mailbox: mailbox.id } } }).catch(() => ({ data: undefined, response: undefined }));
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
  const shown = listed.status === "listed" ? listed.senders.filter((sender) => valueOf(senderOf(sender)).includes(wanted)) : [];
  const group = (decision: Decision) => {
    const senders = shown.filter((sender) => sender.decision === decision);
    const name = decision === "letIn" ? strings.screened.letIn : strings.screened.blocked;
    return (
      <section className="screened-group" aria-labelledby={`screened-${decision}`}>
        <h2 id={`screened-${decision}`}>{name}</h2>
        {senders.length === 0 ? (
          <p className="hint">{wanted !== "" ? strings.screened.noneFound : decision === "letIn" ? strings.screened.noneLetIn : strings.screened.noneBlocked}</p>
        ) : (
          <ul className="screened" aria-label={name}>
            {senders.map((sender) => (
              <Screened
                key={valueOf(senderOf(sender))}
                client={client}
                mailbox={mailbox}
                sender={sender}
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
    <main className="desk" aria-busy={listed.status === "loading"}>
      <p className="back">
        <a href={hrefOf({ screener: true }, base)}>{strings.screened.back}</a>
      </p>
      <div className="desk-head">
        <h1 tabIndex={-1} className="view-title">
          {title}
        </h1>
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
            {group("block")}
            {group("letIn")}
          </div>
        )
      )}
    </main>
  );
}

/** A screened sender: who, the decision, when and by whom, then flipping it or removing it, a block only once asked in place. */
function Screened({
  client,
  mailbox,
  sender,
  by,
  onDone,
  onSignedOut,
}: {
  client: DuvaClient;
  mailbox: Mailbox;
  sender: ScreenedSender;
  by: string | undefined;
  onDone: (done: Done) => void;
  onSignedOut: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const [state, setState] = useState<{ status: "idle" | "busy" } | { status: "failed"; message: string }>({ status: "idle" });
  const target = senderOf(sender);
  const who = strings.screener.who(sender);
  const flipped: Decision = sender.decision === "letIn" ? "block" : "letIn";

  const flip = async () => {
    setState({ status: "busy" });
    const saved = await decide(client, mailbox.id, flipped, target, onSignedOut);
    if (saved === undefined) return;
    if ("failed" in saved) return setState({ status: "failed", message: saved.failed });
    setState({ status: "idle" });
    onDone(saved.done);
  };

  const remove = async () => {
    setState({ status: "busy" });
    const { data, response } = await client
      .DELETE("/mailboxes/{mailbox}/screener/senders/{sender}", { params: { path: { mailbox: mailbox.id, sender: valueOf(target) } } })
      .catch(() => ({ data: undefined, response: undefined }));
    if (response?.status === 401) return onSignedOut();
    if (data === undefined) return setState({ status: "failed", message: response === undefined ? strings.screener.decideUnreachable : strings.screener.decideFailed(response.status) });
    setState({ status: "idle" });
    setAsking(false);
    onDone({ message: sender.decision === "block" ? strings.screened.removedBlock(who, data.threads.length) : strings.screened.removedLetIn(who) });
  };

  return (
    <li className="screened-sender">
      <div className="screened-who">
        <span className="screened-name">{sender.address ?? strings.screened.everyoneAt(sender.domain ?? "")}</span>
        <span className="hint">
          {strings.screened.decided(sender.decision)} <Time at={sender.decidedAt} short />
          {by !== undefined && ` ${strings.screened.by(by)}`}
        </span>
      </div>
      {asking ? (
        <div className="confirm" role="group" aria-label={strings.screened.removeBlock}>
          <p>{strings.screened.removeAsk(who)}</p>
          <div className="confirm-choices">
            <button type="button" className="button button-small" disabled={state.status === "busy"} onClick={() => void remove()}>
              {strings.screened.removeBlock}
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
        <div className="screened-actions">
          <button type="button" className="button button-small" disabled={state.status === "busy"} onClick={() => void flip()}>
            {flipped === "letIn" ? strings.screener.letIn : strings.screener.block}
          </button>
          <button
            type="button"
            className="button button-small button-quiet"
            disabled={state.status === "busy"}
            onClick={() => (sender.decision === "block" ? setAsking(true) : void remove())}
          >
            {strings.screened.remove}
          </button>
        </div>
      )}
      {state.status === "failed" && (
        <p className="field-error" role="alert">
          {state.message}
        </p>
      )}
    </li>
  );
}
