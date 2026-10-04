// The Approvals view: the sends waiting for the signed-in sponsor, each laid out like a galley proof,
// with the agent's draft set beside the message it answers, to send as is, edit and send, or reject.
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { DuvaClient } from "@duva/client";
import type { components } from "@duva/openapi";
import { approvalChanges, type Connection as ConnectionState, type Follow, SignedOut } from "./feed.ts";
import { Addresses, clock, Connection, Field, Time } from "./mail-parts.tsx";
import { strings } from "./strings.ts";

type Approval = components["schemas"]["Approval"];
type SendStatus = components["schemas"]["SendStatus"];
type Message = components["schemas"]["Message"];
type EmailAddress = components["schemas"]["EmailAddress"];

/** An approval the view shows: waiting, or decided while the page was open. */
interface Entry {
  approval: Approval;
  /** Set once the approval is decided, by this page or elsewhere. */
  decision?: Decision;
  /** Whether it arrived after the page loaded, and the sponsor hasn't had it on screen yet. */
  fresh?: boolean;
}

type Decision = { by: "you"; how: "sent" | "edited" | "rejected"; note?: string } | { by: "elsewhere" };

/** Where a decided approval's draft stands, or "unknown" if Duva couldn't say. */
type Outcome = SendStatus | "none" | "unknown";

// A send in these states can still change, so the view keeps checking it.
const settling = new Set<SendStatus["state"]>(["waiting", "approved", "sending"]);

export function Approvals({
  client,
  sponsor,
  connection,
  follow,
  onSignedOut,
}: {
  client: DuvaClient;
  sponsor: string;
  connection: ConnectionState;
  follow: Follow;
  onSignedOut: () => void;
}) {
  const [entries, setEntries] = useState<Entry[] | undefined>();
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const [agents, setAgents] = useState<Record<string, string>>({});
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const outcomesRef = useRef(outcomes);
  outcomesRef.current = outcomes;
  const agentsRef = useRef(agents);
  agentsRef.current = agents;

  const loadOutcome = useCallback(
    async (approval: Approval) => {
      const { data, response } = await client
        .GET("/mailboxes/{mailbox}/drafts/{draft}", { params: { path: { mailbox: approval.mailbox, draft: approval.draft.id } } })
        .catch(() => ({ data: undefined, response: undefined }));
      if (response?.status === 401) return onSignedOut();
      setOutcomes((current) => ({ ...current, [approval.id]: data === undefined ? "unknown" : (data.send ?? "none") }));
    },
    [client, onSignedOut],
  );

  const loadAgents = useCallback(async () => {
    const { data } = await client.GET("/agents");
    if (data !== undefined) setAgents(Object.fromEntries(data.agents.map((agent) => [agent.id, agent.name])));
  }, [client]);

  /** Lists the waiting approvals again. One that left the list without a decision here was decided elsewhere. */
  const refresh = useCallback(
    async (first: boolean) => {
      const { data, response } = await client.GET("/approvals");
      if (response.status === 401) throw new SignedOut();
      if (data === undefined) throw new Error(`Duva answered ${response.status} listing approvals.`);
      const waiting = new Map(data.approvals.map((approval) => [approval.id, approval]));
      setEntries((current = []) => {
        const known = new Set(current.map((entry) => entry.approval.id));
        const kept = current.map((entry) => (entry.decision === undefined && !waiting.has(entry.approval.id) ? { ...entry, decision: { by: "elsewhere" as const } } : entry));
        const arrived = data.approvals.filter((approval) => !known.has(approval.id)).map((approval) => ({ approval, fresh: !first }));
        return [...arrived, ...kept].sort((a, b) => b.approval.askedAt.localeCompare(a.approval.askedAt));
      });
      if (data.approvals.some((approval) => !(approval.agent in agentsRef.current))) await loadAgents();
    },
    [client, loadAgents],
  );

  // List the approvals, then again when a request or decision shows up in the change feeds, and
  // check the sends of decided ones. A list that couldn't be read is tried again with the next read of the feeds.
  useEffect(() => {
    let stopped = false;
    refresh(true).catch((error: unknown) => {
      if (!stopped && error instanceof SignedOut) onSignedOut();
    });
    const unfollow = follow(async (changes) => {
      const touched = changes.some(({ change }) => approvalChanges.has(change.type));
      if (entriesRef.current === undefined || touched) await refresh(entriesRef.current === undefined);
      if (!touched) return;
      for (const entry of entriesRef.current ?? []) {
        const outcome = outcomesRef.current[entry.approval.id];
        if (entry.decision !== undefined && (typeof outcome !== "object" || settling.has(outcome.state))) void loadOutcome(entry.approval);
      }
    });
    return () => {
      stopped = true;
      unfollow();
    };
  }, [follow, refresh, loadOutcome, onSignedOut]);

  // A decided approval shows how its send went, so read its draft once it's decided.
  const outcomesRead = useRef(new Set<string>());
  useEffect(() => {
    for (const entry of entries ?? []) {
      if (entry.decision === undefined || outcomesRead.current.has(entry.approval.id)) continue;
      outcomesRead.current.add(entry.approval.id);
      void loadOutcome(entry.approval);
    }
  }, [entries, loadOutcome]);

  // The proof folds into its slip, where the browser can animate it.
  const decided = useCallback((approval: Approval, decision: Decision) => {
    const update = () => setEntries((current) => current?.map((entry) => (entry.approval.id === approval.id ? { ...entry, decision, fresh: false } : entry)));
    if (document.startViewTransition === undefined) return update();
    document.startViewTransition(() => flushSync(update));
  }, []);
  const seen = useCallback((id: string) => setEntries((current) => current?.map((entry) => (entry.approval.id === id ? { ...entry, fresh: false } : entry))), []);

  const waiting = entries?.filter((entry) => entry.decision === undefined).length ?? 0;
  return (
    <main className="desk" aria-busy={entries === undefined}>
      <div className="desk-head">
        <h1>{strings.approvals.title}</h1>
        {entries !== undefined && waiting > 0 && <p className="count">{strings.approvals.waiting(waiting)}</p>}
        <Connection state={connection} />
      </div>
      {entries === undefined ? (
        <SkeletonGalley />
      ) : entries.length === 0 ? (
        <Empty />
      ) : (
        <ol className="galleys" aria-label={strings.approvals.title}>
          {entries.map((entry) => (
            <li key={entry.approval.id}>
              <Galley
                entry={entry}
                agent={agents[entry.approval.agent] ?? strings.galley.anAgent}
                sponsor={sponsor}
                outcome={outcomes[entry.approval.id]}
                client={client}
                onDecided={decided}
                onSeen={seen}
                onSignedOut={onSignedOut}
              />
            </li>
          ))}
        </ol>
      )}
      {entries !== undefined && entries.length > 0 && waiting === 0 && <p className="all-done">{strings.approvals.noneWaiting}.</p>}
    </main>
  );
}

function Empty() {
  return (
    <section className="empty" aria-labelledby="empty-title">
      <h2 id="empty-title">{strings.approvals.noneWaiting}</h2>
      <p>{strings.approvals.emptyLead}</p>
      <p className="quiet">{strings.approvals.emptyPolling}</p>
    </section>
  );
}

function SkeletonGalley() {
  return (
    <div className="galley galley-skeleton" aria-hidden="true">
      <div className="slug">
        <span className="line" style={{ width: "14rem" }} />
      </div>
      <div className="sheet">
        {[0, 1].map((column) => (
          <div className="copy" key={column}>
            {[70, 55, 80, 40, 90, 85, 60].map((width, line) => (
              <span className="line" key={line} style={{ width: `${width}%` }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

type Mode = "reading" | "editing" | "rejecting";

interface GalleyProps {
  entry: Entry;
  agent: string;
  sponsor: string;
  outcome: Outcome | undefined;
  client: DuvaClient;
  onDecided: (approval: Approval, decision: Decision) => void;
  onSeen: (id: string) => void;
  onSignedOut: () => void;
}

function Galley({ entry, agent, sponsor, outcome, client, onDecided, onSeen, onSignedOut }: GalleyProps) {
  const { approval, decision, fresh } = entry;
  const { draft, original } = approval;
  const titleId = useId();
  const problemId = useId();
  const [mode, setMode] = useState<Mode>("reading");
  const [busy, setBusy] = useState<"sending" | "rejecting" | undefined>();
  const [problem, setProblem] = useState<string | undefined>();
  const [to, setTo] = useState(typed(draft.to));
  const [subject, setSubject] = useState(draft.subject);
  const [text, setText] = useState(draft.text);
  const [note, setNote] = useState("");
  // Counts refusals of an empty note, so each one sends focus back to it.
  const [noteRefused, setNoteRefused] = useState(0);
  const ref = useRef<HTMLElement>(null);

  // A new request keeps its mark until it has been on screen for a moment.
  useEffect(() => {
    if (!fresh || ref.current === null) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new IntersectionObserver(([seen]) => {
      clearTimeout(timer);
      if (seen?.isIntersecting) timer = setTimeout(() => onSeen(approval.id), 1500);
    }, { threshold: 0.4 });
    observer.observe(ref.current);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [fresh, approval.id, onSeen]);

  if (decision !== undefined) return <DecidedSlip approval={approval} agent={agent} decision={decision} outcome={outcome} />;

  const decide = async (kind: "sending" | "rejecting", call: () => Promise<{ response: Response; error?: { message: string } }>, decision: Decision) => {
    if (busy !== undefined) return;
    setBusy(kind);
    setProblem(undefined);
    try {
      const { response, error } = await call();
      if (response.ok) return onDecided(approval, decision);
      if (response.status === 409) return onDecided(approval, { by: "elsewhere" });
      if (response.status === 401) return onSignedOut();
      setProblem(response.status === 404 ? strings.decide.gone : response.status === 403 ? strings.decide.notYours : (error?.message ?? strings.decide.failed(response.status)));
    } catch {
      setProblem(strings.decide.unreachable);
    }
    setBusy(undefined);
  };
  const path = { params: { path: { approval: approval.id } } };
  const switchTo = (next: Mode) => {
    setProblem(undefined);
    setNoteRefused(0);
    setMode(next);
  };

  const sendAsIs = () => decide("sending", () => client.POST("/approvals/{approval}/send", path), { by: "you", how: "sent" });
  const sendEdited = () => {
    const changed = changedFields(draft, { to, subject, text });
    const edits = {
      ...(changed.includes("to") && { to: addresses(to) }),
      ...(changed.includes("subject") && { subject }),
      ...(changed.includes("text") && { text }),
    };
    const edited = changed.length > 0;
    return decide("sending", () => client.POST("/approvals/{approval}/send", { ...path, body: edits }), { by: "you", how: edited ? "edited" : "sent" });
  };
  const reject = () => {
    if (note.trim() === "") {
      setNoteRefused((count) => count + 1);
      return setProblem(strings.decide.noteMissing(agent));
    }
    return decide("rejecting", () => client.POST("/approvals/{approval}/reject", { ...path, body: { note: note.trim() } }), { by: "you", how: "rejected", note: note.trim() });
  };

  const editing = mode === "editing";
  const changes = editing ? changedFields(draft, { to, subject, text }) : [];
  return (
    <article className={fresh ? "galley galley-fresh" : "galley"} aria-labelledby={titleId} ref={ref} style={{ viewTransitionName: transitionName(approval) }}>
      <header className="slug">
        <h2 id={titleId}>
          {strings.galley.asks(agent)}{" "}
          <span className="slug-subject">{draft.subject || strings.galley.noSubject}</span>
        </h2>
        <p className="slug-meta">
          {fresh && <span className="mark-new">{strings.galley.isNew}</span>}
          <Time at={approval.askedAt} format={(time) => strings.galley.askedAt(time)} />
        </p>
      </header>

      <div className={original === undefined ? "sheet sheet-single" : "sheet"}>
        {original !== undefined ? (
          <Original message={original} />
        ) : (
          <p className="copy copy-note">{draft.answers === undefined ? strings.galley.noOriginal : strings.galley.originalGone}</p>
        )}

        <section className={editing ? "copy proof proof-editing" : "copy proof"} aria-labelledby={`${titleId}-proof`}>
          <h3 className="copy-label" id={`${titleId}-proof`}>{editing ? strings.galley.yourVersion : strings.galley.draft(agent)}</h3>
          {editing ? (
            <EditFields to={[to, setTo]} subject={[subject, setSubject]} text={[text, setText]} />
          ) : (
            <>
              <dl className="fields">
                <Field label={strings.galley.from}>{draft.from}</Field>
                <Field label={strings.galley.to}>
                  <Addresses list={draft.to} />
                  {draft.cc.length > 0 && (
                    <p className="cc">
                      {strings.galley.cc} <Addresses list={draft.cc} />
                    </p>
                  )}
                  {draft.bcc.length > 0 && (
                    <p className="cc">
                      {strings.galley.bcc} <Addresses list={draft.bcc} />
                    </p>
                  )}
                </Field>
                <Field label={strings.galley.subject}>{draft.subject || strings.galley.noSubject}</Field>
                <Field label={strings.galley.date}>{strings.galley.whenSent}</Field>
              </dl>
              <div>
                <div className="body" lang="">
                  {draft.text}
                </div>
                <Disclosure agent={agent} sponsor={sponsor} />
              </div>
            </>
          )}
          {editing && <Disclosure agent={agent} sponsor={sponsor} />}
        </section>
      </div>

      <footer className="decision">
        {editing && (
          <p className={changes.length > 0 ? "changes changes-made" : "changes"} aria-live="polite">
            {strings.galley.changed(changes.map((field) => strings.galley.fieldNames[field]))}
          </p>
        )}
        {mode === "rejecting" && <RejectNote agent={agent} note={[note, setNote]} refused={noteRefused} errorId={problemId} />}
        {problem !== undefined && (
          <p className="notice notice-alert" role="alert" id={problemId}>
            {problem}
          </p>
        )}
        <div className="actions">
          {mode === "reading" && (
            <>
              <button type="button" className="button button-primary" onClick={sendAsIs} disabled={busy !== undefined}>
                <SendIcon />
                {busy === "sending" ? strings.decide.sending : strings.decide.send}
              </button>
              <button type="button" className="button" onClick={() => switchTo("editing")} disabled={busy !== undefined}>
                {strings.decide.edit}
              </button>
              <button type="button" className="button button-quiet" onClick={() => switchTo("rejecting")} disabled={busy !== undefined}>
                {strings.decide.reject}
              </button>
            </>
          )}
          {mode === "editing" && (
            <>
              <button type="button" className="button button-primary" onClick={sendEdited} disabled={busy !== undefined}>
                <SendIcon />
                {busy === "sending" ? strings.decide.sending : strings.decide.sendEdited}
              </button>
              <button
                type="button"
                className="button button-quiet"
                disabled={busy !== undefined}
                onClick={() => {
                  setTo(typed(draft.to));
                  setSubject(draft.subject);
                  setText(draft.text);
                  setProblem(undefined);
                  setMode("reading");
                }}
              >
                {strings.decide.cancel}
              </button>
            </>
          )}
          {mode === "rejecting" && (
            <>
              <button type="button" className="button button-reject" onClick={reject} disabled={busy !== undefined}>
                {busy === "rejecting" ? strings.decide.rejecting : strings.decide.rejectWith}
              </button>
              <button
                type="button"
                className="button button-quiet"
                disabled={busy !== undefined}
                onClick={() => {
                  setProblem(undefined);
                  setMode("reading");
                }}
              >
                {strings.decide.cancel}
              </button>
            </>
          )}
        </div>
      </footer>
    </article>
  );
}

/** The message the draft answers, as it arrived. Long ones fold, so the draft stays in reach. */
function Original({ message }: { message: Message }) {
  const long = message.text.split("\n").length > 14 || message.text.length > 900;
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  return (
    <section className="copy original" aria-labelledby={`${bodyId}-label`}>
      <h3 className="copy-label" id={`${bodyId}-label`}>{strings.galley.original}</h3>
      <dl className="fields">
        <Field label={strings.galley.from}>
          <Addresses list={[message.from]} />
        </Field>
        <Field label={strings.galley.to}>
          <Addresses list={message.to} />
          {message.cc.length > 0 && (
            <p className="cc">
              {strings.galley.cc} <Addresses list={message.cc} />
            </p>
          )}
        </Field>
        <Field label={strings.galley.subject}>{message.subject || strings.galley.noSubject}</Field>
        <Field label={strings.galley.date}>
          <Time at={message.date} />
        </Field>
      </dl>
      <div>
        <div id={bodyId} className={long && !open ? "body body-folded" : "body"} lang="">
          {message.text}
        </div>
        {long && (
          <button type="button" className="link" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(!open)}>
            {open ? strings.galley.showLess : strings.galley.showAll}
          </button>
        )}
        {message.attachments.length > 0 && <p className="quiet attachments">{strings.galley.attachments(message.attachments.length)}</p>}
      </div>
    </section>
  );
}

/** The line Duva adds to every message an agent sends, as recipients get it. */
function Disclosure({ agent, sponsor }: { agent: string; sponsor: string }) {
  return (
    <p className="disclosure">
      <span className="disclosure-line">{strings.galley.disclosure(agent, sponsor)}</span>
      <span className="disclosure-note">{strings.galley.disclosureNote}</span>
    </p>
  );
}

function EditFields({ to, subject, text }: { to: [string, (v: string) => void]; subject: [string, (v: string) => void]; text: [string, (v: string) => void] }) {
  const id = useId();
  return (
    <div className="edit">
      <label htmlFor={`${id}-to`}>{strings.galley.to}</label>
      <div>
        <input id={`${id}-to`} type="text" inputMode="email" autoComplete="off" spellCheck={false} value={to[0]} onChange={(event) => to[1](event.target.value)} aria-describedby={`${id}-to-hint`} />
        <p className="hint" id={`${id}-to-hint`}>
          {strings.decide.toHint}
        </p>
      </div>
      <label htmlFor={`${id}-subject`}>{strings.galley.subject}</label>
      <input id={`${id}-subject`} type="text" maxLength={998} value={subject[0]} onChange={(event) => subject[1](event.target.value)} />
      <textarea
        className="edit-body"
        aria-label={strings.galley.yourVersion}
        maxLength={50000}
        value={text[0]}
        rows={Math.min(24, Math.max(8, text[0].split("\n").length + 2))}
        onChange={(event) => text[1](event.target.value)}
        autoFocus
      />
    </div>
  );
}

/** The fields the sponsor changed in their version, by the names the API takes them under. */
function changedFields(draft: Approval["draft"], mine: { to: string; subject: string; text: string }): ("to" | "subject" | "text")[] {
  return [
    ...(addresses(mine.to).join(",") !== addresses(typed(draft.to)).join(",") ? (["to"] as const) : []),
    ...(mine.subject !== draft.subject ? (["subject"] as const) : []),
    ...(mine.text !== draft.text ? (["text"] as const) : []),
  ];
}

/** The addresses in what the sponsor typed, separated by commas, taking the address out of "Name <address>". */
const addresses = (field: string) =>
  field
    .split(/[,;]/)
    .map((part) => (/<([^>]*)>/.exec(part)?.[1] ?? part).trim())
    .filter((address) => address !== "");

const typed = (list: EmailAddress[]) => list.map((address) => address.address).join(", ");

function RejectNote({ agent, note, refused, errorId }: { agent: string; note: [string, (v: string) => void]; refused: number; errorId: string }) {
  const id = useId();
  const ref = useRef<HTMLTextAreaElement>(null);
  // Back to the note when it was refused, so the sponsor can write it.
  useEffect(() => {
    if (refused > 0) ref.current?.focus();
  }, [refused]);
  return (
    <div className="reject-note">
      <label htmlFor={id}>{strings.decide.note(agent)}</label>
      <textarea
        id={id}
        ref={ref}
        rows={3}
        maxLength={2000}
        value={note[0]}
        onChange={(event) => note[1](event.target.value)}
        aria-invalid={refused > 0 && note[0].trim() === ""}
        aria-describedby={refused > 0 ? `${id}-hint ${errorId}` : `${id}-hint`}
        autoFocus
      />
      <p className="hint" id={`${id}-hint`}>
        {strings.decide.noteHint(agent)}
      </p>
    </div>
  );
}

/** A decided approval, folded to one slip: what was decided, and how the send went. */
function DecidedSlip({ approval, agent, decision, outcome }: { approval: Approval; agent: string; decision: Decision; outcome: Outcome | undefined }) {
  // What became of an approval that left the list shows only in its draft: decided elsewhere, or withdrawn.
  const own = typeof outcome === "object" && outcome.approval === approval.id ? outcome : undefined;
  const headline =
    own?.state === "withdrawn"
      ? strings.outcome.withdrawnHead
      : decision.by === "elsewhere"
        ? own === undefined
          ? strings.outcome.noLongerWaiting
          : strings.outcome.elsewhere
        : decision.how === "sent"
        ? strings.outcome.sentAsIs
        : decision.how === "edited"
          ? strings.outcome.sentEdited
          : strings.outcome.rejected;
  const result = describe(outcome, approval, agent, decision);
  return (
    <article className={`slip slip-${result.tone}`} aria-live="polite" style={{ viewTransitionName: transitionName(approval) }}>
      <StateIcon tone={result.tone} />
      <div>
        <h2 className="slip-head">
          {headline}{" "}
          <span className="slip-subject">
            {agent}, {approval.draft.subject || strings.galley.noSubject}
          </span>
        </h2>
        <p className="slip-result">{result.text}</p>
        {result.detail !== undefined && <p className="slip-detail">{result.detail}</p>}
        {decision.by === "you" && decision.note !== undefined && <p className="slip-note">{strings.outcome.note(decision.note)}</p>}
      </div>
    </article>
  );
}

const transitionName = (approval: Approval) => `approval-${approval.id.replace(/[^\w-]/g, "")}`;

type Tone = "pending" | "sent" | "rejected" | "failed";

function describe(outcome: Outcome | undefined, approval: Approval, agent: string, decision: Decision): { tone: Tone; text: string; detail?: string } {
  if (outcome === undefined) return { tone: "pending", text: strings.outcome.checking };
  if (outcome === "unknown" || outcome === "none") return { tone: "pending", text: strings.outcome.unknown };
  // The agent may have revised the draft and asked again since; this approval's part is over.
  if (outcome.approval !== approval.id) {
    return decision.by === "you" && decision.how === "rejected"
      ? { tone: "rejected", text: strings.outcome.askedAgain(agent) }
      : { tone: "pending", text: strings.outcome.askedAgain(agent) };
  }
  switch (outcome.state) {
    case "waiting":
    case "approved":
      return { tone: "pending", text: strings.outcome.approved };
    case "sending":
      return { tone: "pending", text: strings.outcome.sending };
    case "sent":
      return { tone: "sent", text: strings.outcome.sent };
    case "failed":
      return { tone: "failed", text: strings.outcome.failed(agent), ...(outcome.reason && { detail: strings.outcome.sesSaid(outcome.reason) }) };
    case "unclear":
      return { tone: "failed", text: strings.outcome.unclear };
    case "withdrawn":
      return { tone: "rejected", text: strings.outcome.withdrawn(agent) };
    case "rejected":
      return {
        tone: "rejected",
        text: decision.by === "elsewhere" && outcome.note !== undefined ? `${strings.outcome.rejectedElsewhere(agent)} ${strings.outcome.noteFrom(outcome.note)}` : strings.outcome.rejectedElsewhere(agent),
      };
  }
}

const SendIcon = () => (
  <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M2 8h9M8 4.5 11.5 8 8 11.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M14 3v10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

function StateIcon({ tone }: { tone: Tone }) {
  const paths: Record<Tone, React.ReactNode> = {
    pending: <path d="M8 4.5V8l2.5 1.5" />,
    sent: <path d="m5 8.2 2 2 4-4.4" />,
    rejected: <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" />,
    failed: <path d="M8 4.5v4.2M8 11.2v.3" />,
  };
  return (
    <svg className="slip-icon" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        {paths[tone]}
      </g>
    </svg>
  );
}
