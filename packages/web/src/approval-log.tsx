// The approval log on Approvals: the sponsor's decisions on their agents' sends, newest first, as
// rows in the list column, each tagged with how it went, and the one chosen open in the reading
// pane. There it offers what the decision still allows: Undo during the undo window, Send after all
// for a rejection whose draft is as the agent asked it, and Write a correction for mail that went
// out, which can't be called back.
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { DuvaClient } from "@duva/client";
import type { components } from "@duva/openapi";
import { approvalChanges, type Connection as ConnectionState, type Follow } from "./feed.ts";
import { ActorMark, Addresses, Connection, Field, Time } from "./mail-parts.tsx";
import { strings } from "./strings.ts";
import { BackIcon } from "./thread.tsx";

type Entry = components["schemas"]["ApprovalLogEntry"];
type Approval = components["schemas"]["Approval"];

/** The log's rows as read, and where the next page starts, if there is one. */
type Read = { status: "reading" } | { status: "failed" } | { status: "read"; entries: Entry[]; next?: string };

/**
 * The log of the sponsor whose ID is `me`. `own` are the mailboxes of their own, which a
 * correction goes from, if they have one. `toggle` switches back to what waits.
 */
export function ApprovalLog({
  client,
  me,
  own,
  connection,
  follow,
  toggle,
  onSignedOut,
}: {
  client: DuvaClient;
  me: string;
  own: ReadonlySet<string> | undefined;
  connection: ConnectionState;
  follow: Follow;
  toggle: React.ReactNode;
  onSignedOut: () => void;
}) {
  const [read, setRead] = useState<Read>({ status: "reading" });
  const [older, setOlder] = useState<"idle" | "reading">("idle");
  const [chosen, setChosen] = useState<string>();
  const [reading, setReading] = useState(false);
  const pages = useRef(1);
  const count = useRef(0);

  /** Reads the log again, as many pages as are shown, so a decision that changed shows how it stands now. */
  const refresh = useCallback(async () => {
    const mine = ++count.current;
    const entries: Entry[] = [];
    let after: string | undefined;
    for (let page = 0; page < pages.current; page++) {
      const { data, response } = await client.GET("/approvals/log", { params: { query: after === undefined ? {} : { after } } }).catch(() => ({ data: undefined, response: undefined }));
      if (mine !== count.current) return;
      if (response?.status === 401) return onSignedOut();
      if (data === undefined) return setRead((current) => (current.status === "read" ? current : { status: "failed" }));
      entries.push(...data.entries);
      after = data.next;
      if (after === undefined) break;
    }
    setRead({ status: "read", entries, ...(after !== undefined && { next: after }) });
  }, [client, onSignedOut]);

  useEffect(() => {
    void refresh();
    const unfollow = follow(async (changes) => {
      if (changes.some(({ change }) => approvalChanges.has(change.type))) await refresh();
    });
    return () => {
      count.current++;
      unfollow();
    };
  }, [follow, refresh]);

  const showOlder = async () => {
    if (read.status !== "read" || read.next === undefined) return;
    setOlder("reading");
    pages.current++;
    await refresh();
    setOlder("idle");
  };

  const entries = read.status === "read" ? read.entries : [];
  const open = entries.find((entry) => entry.approval === chosen) ?? entries[0];
  const paneId = useId();
  const pane = useRef<HTMLDivElement>(null);
  const queue = useRef<HTMLOListElement>(null);
  const [focusing, setFocusing] = useState<"pane" | "row">();
  useEffect(() => {
    if (focusing === undefined) return;
    setFocusing(undefined);
    const target = focusing === "pane" ? pane.current?.querySelector<HTMLElement>(":scope > article h2") : queue.current?.querySelector<HTMLElement>('[aria-current="true"]');
    if (target === null || target === undefined) return;
    if (focusing === "pane") target.tabIndex = -1;
    target.focus();
  }, [focusing]);
  const copy = strings.log;

  const head = (
    <div className="desk-head queue-head">
      <h1>{strings.approvals.title}</h1>
      <Connection state={connection} />
    </div>
  );
  if (read.status !== "read" || entries.length === 0) {
    return (
      <main className="desk" aria-busy={read.status === "reading"}>
        {head}
        {toggle}
        {read.status === "failed" ? (
          <p className="notice notice-alert" role="alert">
            {copy.readFailed}
          </p>
        ) : read.status === "read" ? (
          <section className="empty" aria-labelledby="log-empty">
            <h2 id="log-empty">{copy.empty}</h2>
            <p>{copy.emptyLead}</p>
          </section>
        ) : null}
      </main>
    );
  }
  return (
    <main className={reading ? "queue-view queue-view-reading" : "queue-view"}>
      <div className="queue">
        {head}
        {toggle}
        <p className="queue-lead">{copy.lead}</p>
        <ol className="queue-rows" aria-label={copy.title} ref={queue}>
          {entries.map((entry) => (
            <li key={entry.approval}>
              <LogRow
                entry={entry}
                current={entry.approval === open?.approval}
                paneId={paneId}
                onChoose={() => {
                  setChosen(entry.approval);
                  setReading(true);
                  setFocusing("pane");
                }}
              />
            </li>
          ))}
        </ol>
        {read.next !== undefined && (
          <p className="queue-more">
            <button type="button" className="button button-quiet button-small" onClick={() => void showOlder()} disabled={older === "reading"}>
              {older === "reading" ? copy.loading : copy.more}
            </button>
          </p>
        )}
      </div>
      <div className="queue-read" id={paneId} ref={pane}>
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
        {open !== undefined && <LogEntry key={open.approval} entry={open} me={me} own={own} client={client} onChanged={refresh} onSignedOut={onSignedOut} />}
      </div>
    </main>
  );
}

/** A row of the log: the agent by its diamond, how it went as a tag, when it was decided, then the subject and its recipients. */
function LogRow({ entry, current, paneId, onChoose }: { entry: Entry; current: boolean; paneId: string; onChoose: () => void }) {
  return (
    <button type="button" className="queue-row queue-row-decided" aria-current={current ? "true" : undefined} aria-controls={paneId} onClick={onChoose}>
      <span className="queue-who">
        <ActorMark kind="agent" />
        {entry.agentName || strings.galley.anAgent}
      </span>
      <span className={`queue-kind queue-outcome queue-outcome-${entry.outcome}`}>{strings.log.outcomes[entry.outcome]}</span>
      <span className="queue-time">
        <Time at={entry.decidedAt} short />
      </span>
      <span className="queue-line">
        <b>{entry.subject || strings.galley.noSubject}</b> {strings.log.to([...entry.to, ...entry.cc].map(({ address }) => address).join(", "))}
      </span>
    </button>
  );
}

/** What a decision's tone is, as its slip's mark says it. */
const toneOf = (outcome: Entry["outcome"]) => (outcome === "sent" ? "sent" : outcome === "rejected" ? "rejected" : outcome === "approved" ? "pending" : "failed");

/** A decision, open in the reading pane: who decided what and when, how it went, and what it still allows. */
function LogEntry({ entry, me, own, client, onChanged, onSignedOut }: { entry: Entry; me: string; own: ReadonlySet<string> | undefined; client: DuvaClient; onChanged: () => Promise<void>; onSignedOut: () => void }) {
  const copy = strings.log;
  const titleId = useId();
  const agent = entry.agentName || strings.galley.anAgent;
  const by = entry.decidedBy === me ? copy.you : copy.someone;
  const [busy, setBusy] = useState<"sending" | "correcting">();
  const [problem, setProblem] = useState<string>();
  const said =
    entry.outcome === "approved"
      ? entry.reversal === "undo"
        ? copy.undoable
        : copy.approved(agent)
      : entry.outcome === "sent"
        ? copy.sent
        : entry.outcome === "failed"
          ? copy.failed(agent)
          : entry.outcome === "unclear"
            ? copy.unclear
            : copy.rejected(agent);

  /** Makes the call, and reads the log again once it is done, or says why it couldn't be. */
  const act = async (kind: "sending" | "correcting", call: () => Promise<{ response: Response; error?: { message: string } }>) => {
    if (busy !== undefined) return;
    setBusy(kind);
    setProblem(undefined);
    try {
      const { response, error } = await call();
      if (response.status === 401) return onSignedOut();
      if (!response.ok) setProblem(response.status === 409 ? copy.changedMeanwhile : (error?.message ?? copy.decideFailed(response.status)));
      await onChanged();
    } catch {
      setProblem(copy.unreachable);
    }
    setBusy(undefined);
  };
  const sendAfterAll = () => act("sending", () => client.POST("/approvals/{approval}/send", { params: { path: { approval: entry.approval } } }));
  // Mail the agent sent as the sponsor lies in their own mailbox, where the correction replies to it
  // in its thread, to all its recipients. Mail from a mailbox no longer theirs, as one an agent owned
  // before agents owned none, gets a new message from the sponsor's, to the same recipients. Either
  // opens as a draft, to be written.
  const asSponsor = own?.has(entry.mailbox) === true;
  const from = asSponsor ? entry.mailbox : own === undefined ? undefined : [...own][0];
  const correct = () => {
    if (from === undefined) return;
    const subject = /^re:/i.test(entry.subject) ? entry.subject : `Re: ${entry.subject}`;
    const body =
      asSponsor && entry.message !== undefined
        ? { answers: entry.message, replyAll: true }
        : { to: entry.to.map(({ address }) => address), cc: entry.cc.map(({ address }) => address), subject, text: "" };
    return act("correcting", async () => {
      const answer = await client.POST("/mailboxes/{mailbox}/drafts", { params: { path: { mailbox: from } }, body });
      if (answer.data !== undefined) location.hash = `#/mailboxes/${encodeURIComponent(from)}/drafts/${encodeURIComponent(answer.data.id)}`;
      return answer;
    });
  };

  return (
    <article className={`galley log-entry log-entry-${toneOf(entry.outcome)}`} aria-labelledby={titleId}>
      <header className="galley-head">
        <h2 id={titleId}>
          <span className="galley-asks">
            <ActorMark kind="agent" />
            {copy.headline(entry.outcome, by)} {agent}
          </span>{" "}
          <span className="galley-subject">{entry.subject || strings.galley.noSubject}</span>
        </h2>
        <p className="galley-meta">
          <span className={`queue-kind queue-outcome queue-outcome-${entry.outcome}`}>{copy.outcomes[entry.outcome]}</span>
          <Time at={entry.decidedAt} format={(time) => copy.decidedAt(time)} />
        </p>
      </header>
      <dl className="galley-fields log-fields">
        <Field label={strings.galley.to}>
          <Addresses list={entry.to} />
        </Field>
        {entry.cc.length > 0 && (
          <Field label={copy.cc}>
            <Addresses list={entry.cc} />
          </Field>
        )}
      </dl>
      <p className="log-said">{said}</p>
      {entry.note !== undefined && <p className="slip-note">{copy.note(entry.note)}</p>}
      {entry.reason !== undefined && <p className="slip-detail">{copy.reason(entry.reason)}</p>}
      {entry.outcome === "rejected" && <p className="log-hint">{entry.reversal === "sendAfterAll" ? copy.afterAll(agent) : copy.movedOn(agent)}</p>}
      {problem !== undefined && (
        <p className="notice notice-alert" role="alert">
          {problem}
        </p>
      )}
      <footer className="decision">
        <div className="actions">
          {entry.reversal === "undo" && entry.undoUntil !== undefined && (
            <UndoButton client={client} approval={entry.approval} until={entry.undoUntil} onUndone={() => void onChanged()} onSignedOut={onSignedOut} />
          )}
          {entry.reversal === "sendAfterAll" && (
            <button type="button" className="button button-call" onClick={() => void sendAfterAll()} disabled={busy !== undefined}>
              {busy === "sending" ? copy.sendingAfterAll : copy.sendAfterAll}
            </button>
          )}
          {entry.reversal === "correction" && (
            <button type="button" className="button button-primary" onClick={() => void correct()} disabled={busy !== undefined || from === undefined} aria-describedby={from === undefined ? `${titleId}-no-mailbox` : undefined}>
              {busy === "correcting" ? copy.correcting : copy.correction}
            </button>
          )}
          {entry.thread !== undefined && entry.mailbox !== undefined && (
            <a className="button button-quiet" href={`#/mailboxes/${encodeURIComponent(entry.mailbox)}/threads/${encodeURIComponent(entry.thread)}`}>
              {copy.openThread}
            </a>
          )}
        </div>
        {entry.reversal === "correction" && from === undefined && (
          <p className="hint" id={`${titleId}-no-mailbox`}>
            {copy.noMailbox}
          </p>
        )}
      </footer>
    </article>
  );
}

/** The whole seconds left until the time, counting down, never under 0. */
function useSecondsLeft(until: string): number {
  const left = () => Math.max(0, Math.ceil((Date.parse(until) - Date.now()) / 1000));
  const [seconds, setSeconds] = useState(left);
  useEffect(() => {
    setSeconds(left());
    const timer = setInterval(() => setSeconds(left()), 250);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [until]);
  return seconds;
}

/**
 * Undo for an approved send during its undo window, with the seconds left beside it, gone once
 * the window is over. Undoing puts the approval back among those that wait, which `onUndone` gets.
 */
export function UndoButton({
  client,
  approval,
  until,
  onUndone,
  onSignedOut,
}: {
  client: DuvaClient;
  approval: string;
  until: string;
  onUndone: (approval: Approval) => void;
  onSignedOut: () => void;
}) {
  const left = useSecondsLeft(until);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  const leftId = useId();
  const undo = async () => {
    setBusy(true);
    setProblem(undefined);
    try {
      const { data, response, error } = await client.POST("/approvals/{approval}/undo", { params: { path: { approval } } });
      if (response.status === 401) return onSignedOut();
      if (data !== undefined) return onUndone(data);
      setProblem(response.status === 409 ? strings.undo.tooLate : (error?.message ?? strings.log.decideFailed(response.status)));
    } catch {
      setProblem(strings.log.unreachable);
    }
    setBusy(false);
  };
  if (left === 0 && problem === undefined) return null;
  return (
    <div className="undo">
      {left > 0 && (
        <>
          <button type="button" className="button" onClick={() => void undo()} disabled={busy} aria-describedby={leftId}>
            <UndoIcon />
            {busy ? strings.undo.undoing : strings.undo.undo}
          </button>
          <span className="undo-left" id={leftId}>
            {strings.undo.left(left)}
          </span>
        </>
      )}
      {problem !== undefined && (
        <p className="notice notice-alert" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}

const UndoIcon = () => (
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
    <path d="M5.5 3.5 2.5 6.5l3 3M2.75 6.5H10a3.5 3.5 0 0 1 0 7H7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
