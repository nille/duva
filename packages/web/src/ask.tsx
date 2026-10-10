// Ask Coo, in the reading pane: the human's one conversation with Coo, their mailbox agent, asked
// from one of their mailboxes or, with several, from All mailboxes (ADR-0033). Each turn goes to the conversation Lambda on the web app's own domain,
// which streams back what the agent says as it writes it, and each thing it does as it does it, with
// links to the threads and drafts it touched. A send it asks for waits in Approvals. When the
// everyday model hands a turn to the harder one, the turn says so and why, and its last answer can
// be asked again of the harder model, to think harder (#132).
import { type FormEvent, type KeyboardEvent, useCallback, useEffect, useId, useRef, useState } from "react";
import type { DuvaClient } from "@duva/client";
import type { components, ConversationEvent } from "@duva/openapi";
import { useDates } from "./dates.ts";
import { activityHref } from "./activity.tsx";
import { ActorMark } from "./mail-parts.tsx";
import { agentHref } from "./alerts.tsx";
import { mailboxHref } from "./mailboxes.tsx";
import { type Config, postTurn } from "./session.ts";
import { strings } from "./strings.ts";
import { threadHref } from "./views.tsx";

type Mailbox = components["schemas"]["Mailbox"];
type Agent = components["schemas"]["Agent"];
type Turn = components["schemas"]["ConversationTurn"];
type Action = components["schemas"]["AgentAction"];
type Settings = components["schemas"]["AgentSettings"];

type Read = { status: "loading" } | { status: "failed" } | { status: "read"; agent: Agent; settings?: Settings; turns: Turn[] };

/** The agent's turn while it is under way: what it said and did so far, and the handover, if any. */
interface Running {
  text: string;
  actions: Action[];
  handover?: components["schemas"]["Handover"];
}

const copy = strings.ask;

export function AskAgent({
  client,
  config,
  mailbox,
  own,
  base,
  back,
  backTo,
  onAsking,
  onSignedOut,
}: {
  client: DuvaClient;
  config: Config;
  /** The mailbox Coo is asked from, or none for All mailboxes. */
  mailbox?: Mailbox;
  /** The human's own mailboxes, in the order the web app lists them. */
  own: Mailbox[];
  /** Where the Inbox of the mailbox it is asked from is, or the first's. */
  base: string;
  /** Where the list beside it is, and its name. */
  back: string;
  backTo: string;
  /** Told as a turn starts, true, and as it ends, false, so Coo bobs its head while it works. */
  onAsking?: (asking: boolean) => void;
  onSignedOut: () => void;
}) {
  const [read, setRead] = useState<Read>({ status: "loading" });
  const [words, setWords] = useState("");
  const [running, setRunning] = useState<Running>();
  const [refused, setRefused] = useState<string>();
  const [clearing, setClearing] = useState(false);
  // What a screen reader hears once a turn ends, since every word as it streams would be too much.
  const [announced, setAnnounced] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const fieldId = useId();
  const hintId = useId();
  const titleId = useId();
  const { clock } = useDates();

  const load = useCallback(async () => {
    setRead({ status: "loading" });
    const { data, response } = await client.GET("/mailbox-agent").catch(() => ({ data: undefined, response: undefined }));
    if (response?.status === 401) return onSignedOut();
    if (data === undefined) return setRead({ status: "failed" });
    setRead({ status: "read", agent: data.agent, turns: data.turns });
    // What the agent may do is said in its head, once its settings are read.
    const { data: settings } = await client.GET("/agents/{agent}/settings", { params: { path: { agent: data.agent.id } } }).catch(() => ({ data: undefined }));
    if (settings !== undefined) setRead((current) => (current.status === "read" ? { ...current, settings } : current));
  }, [client, onSignedOut]);

  useEffect(() => {
    void load();
  }, [load]);

  // The newest of the conversation stays in sight while the agent writes.
  const turnCount = read.status === "read" ? read.turns.length : 0;
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [turnCount, running?.text, running?.actions.length]);

  // A turn already shown, as the one thinking harder answers again, keeps its place.
  const add = (turn: Turn) =>
    setRead((current) =>
      current.status !== "read" ? current : { ...current, turns: current.turns.some(({ id }) => id === turn.id) ? current.turns.map((each) => (each.id === turn.id ? turn : each)) : [...current.turns, turn] },
    );

  /** Asks the agent the words, or with `harder`, the harder model to answer the last turn again. */
  async function ask(asked: string, { harder = false } = {}) {
    if ((asked === "" && !harder) || running !== undefined) return;
    setRefused(undefined);
    if (!harder) setWords("");
    setRunning({ text: "", actions: [] });
    setAnnounced(copy.working);
    onAsking?.(true);
    try {
      // Thinking harder asks from where the turn it answers again was asked.
      const response = await postTurn(config, harder ? { harder } : { ...(mailbox !== undefined && { mailbox: mailbox.id }), words: asked });
      if (response === undefined || response.status === 401) return onSignedOut();
      if (!response.ok || response.body === null) {
        const { message } = (await response.json().catch(() => ({}))) as { message?: string };
        setRefused(message ?? copy.failed);
        if (!harder) setWords(asked);
        return;
      }
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let pending = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        pending += value;
        const lines = pending.split("\n");
        pending = lines.pop() ?? "";
        for (const line of lines) {
          // An empty line only keeps the stream going while the agent thinks.
          if (line.trim() === "") continue;
          const event = JSON.parse(line) as ConversationEvent;
          if (event.type === "turn") add(event.turn);
          else if (event.type === "text") setRunning((current) => current && { ...current, text: current.text + event.text });
          else if (event.type === "action") setRunning((current) => current && { ...current, actions: [...current.actions, event.action] });
          else if (event.type === "handedOver") setRunning((current) => current && { ...current, handover: event.handover });
          else {
            add(event.turn);
            setAnnounced(`${copy.answered}: ${event.turn.text}`);
          }
        }
      }
    } catch {
      setRefused(copy.unreachable);
      if (!harder) setWords(asked);
    } finally {
      onAsking?.(false);
      setRunning(undefined);
      field.current?.focus();
    }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void ask(words.trim());
  };
  // Enter asks, as in a chat. Shift+Enter starts a new line.
  const keyed = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void ask(words.trim());
  };

  async function clear() {
    setClearing(true);
    const { data, response } = await client.DELETE("/mailbox-agent/conversation").catch(() => ({ data: undefined, response: undefined }));
    setClearing(false);
    if (response?.status === 401) return onSignedOut();
    if (data !== undefined) setRead((current) => (current.status === "read" ? { ...current, turns: [] } : current));
    setRefused(data === undefined ? copy.unreachable : undefined);
    field.current?.focus();
  }

  const several = own.length > 1;
  const addressOf = (each: Mailbox) => each.defaultAddress ?? each.addresses[0] ?? each.id;
  // Each thing Coo touched is linked in the mailbox it was in.
  const baseOf = (id: string | undefined) => {
    const found = own.find((each) => each.id === id);
    return found === undefined ? base : mailboxHref(found, !several);
  };
  // With several mailboxes, each turn says where it was asked.
  const askedIn = (turn: Turn) => {
    if (!several) return undefined;
    if (turn.mailbox === undefined) return copy.askedIn(copy.allMailboxes);
    const found = own.find(({ id }) => id === turn.mailbox);
    return found === undefined ? undefined : copy.askedIn(addressOf(found));
  };
  const approval = read.status === "read" ? read.settings?.approvalAsSponsor !== false : true;
  const turns = read.status === "read" ? read.turns : [];

  return (
    <main className="desk desk-reading ask" aria-labelledby={titleId} aria-busy={read.status === "loading"}>
      <div className="reading-tools">
        <p className="back">
          <a href={back}>
            <BackIcon />
            <span className="back-name">{backTo}</span>
          </a>
        </p>
      </div>
      <header className="reading-head ask-head">
        <h1 id={titleId} className="reading-title">
          {copy.title}
        </h1>
        <div className="reading-meta ask-meta">
          <p className="ask-agent">
            <ActorMark kind="coo" />
            <span>
              {copy.agent}. {mailbox === undefined ? copy.whereAll : copy.where(addressOf(mailbox))}
            </span>
          </p>
          {several && (
            <nav className="ask-scope" aria-label={copy.scope}>
              <span className="ask-scope-label" aria-hidden="true">
                {copy.scope}
              </span>
              <ul>
                <li>
                  <a className="chip" href="#/agent" aria-current={mailbox === undefined ? "page" : undefined}>
                    {copy.allMailboxes}
                  </a>
                </li>
                {own.map((each) => (
                  <li key={each.id}>
                    <a className="chip" href={`${mailboxHref(each, false)}agent`} aria-current={mailbox?.id === each.id ? "page" : undefined}>
                      {addressOf(each)}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          )}
          {read.status === "read" && read.settings !== undefined && (
            <p className="ask-can">{read.settings.sponsorAccess === "send" ? copy.can.send(approval) : copy.can[read.settings.sponsorAccess]}</p>
          )}
          {read.status === "read" && (
            <p className="ask-links">
              <a href={activityHref(read.agent.id)}>{copy.activity}</a>
              <a href={agentHref(read.agent.id)}>{copy.settings}</a>
              {turns.length > 0 && (
                <button type="button" className="button button-quiet button-small" disabled={clearing || running !== undefined} onClick={() => void clear()}>
                  {clearing ? copy.clearing : copy.clear}
                </button>
              )}
            </p>
          )}
        </div>
      </header>

      {read.status === "failed" ? (
        <div className="notice notice-alert" role="alert">
          <p>{copy.loadFailed}</p>
          <button type="button" className="button button-small" onClick={() => void load()}>
            {copy.retry}
          </button>
        </div>
      ) : read.status === "loading" ? null : turns.length === 0 && running === undefined ? (
        <section className="ask-empty" aria-labelledby={`${titleId}-empty`}>
          <h2 id={`${titleId}-empty`}>{copy.emptyTitle}</h2>
          <p>{mailbox === undefined && several ? copy.emptyLeadAll : copy.emptyLead}</p>
          <ul className="ask-suggestions" aria-label={copy.suggestion}>
            {copy.suggestions.map((suggestion) => (
              <li key={suggestion}>
                <button type="button" className="chip" onClick={() => void ask(suggestion)}>
                  {suggestion}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <ol className="ask-turns">
          {turns.map((turn, index) => (
            <TurnShown
              key={turn.id}
              turn={turn}
              baseOf={baseOf}
              askedIn={askedIn(turn)}
              approval={approval}
              time={clock(new Date(turn.at))}
              onHarder={index === turns.length - 1 && turn.from === "agent" && turn.harder !== true && running === undefined ? () => void ask("", { harder: true }) : undefined}
            />
          ))}
          {running !== undefined && (
            <li className="ask-turn ask-turn-agent ask-turn-running" aria-label={copy.working}>
              <p className="ask-who">
                <ActorMark kind="coo" />
                <span className="ask-name">{copy.agent}</span>
                <span className="ask-time">{copy.thinking}</span>
              </p>
              {running.handover !== undefined && <Handover handover={running.handover} />}
              <Steps actions={running.actions} baseOf={baseOf} approval={approval} />
              <p className="ask-text">
                {running.text}
                <span className="ask-caret" aria-hidden="true" />
              </p>
            </li>
          )}
        </ol>
      )}
      <div ref={end} className="ask-end" />

      {read.status === "read" && (
        <form className="ask-form" onSubmit={submit}>
          {refused !== undefined && (
            <p className="notice notice-alert ask-refused" role="alert">
              {refused}
            </p>
          )}
          <label htmlFor={fieldId} className="visually-hidden">
            {copy.field}
          </label>
          <div className="ask-field">
            <textarea
              ref={field}
              id={fieldId}
              rows={2}
              value={words}
              placeholder={copy.placeholder}
              aria-describedby={hintId}
              onChange={(event) => setWords(event.target.value)}
              onKeyDown={keyed}
            />
            <button type="submit" className="button button-primary" disabled={running !== undefined || words.trim() === ""}>
              {copy.send}
            </button>
          </div>
          <p id={hintId} className="ask-hint">
            {copy.hint}
          </p>
        </form>
      )}
      <p className="visually-hidden" aria-live="polite">
        {announced}
      </p>
    </main>
  );
}

/**
 * A turn of the conversation: who took it and when, what the agent did, and what was said, and of
 * the agent's, the model that took it over and why. The last answer offers to think harder.
 */
function TurnShown({
  turn,
  baseOf,
  askedIn,
  approval,
  time,
  onHarder,
}: {
  turn: Turn;
  baseOf: (mailbox: string | undefined) => string;
  /** Where the human asked it, said when they have several mailboxes. */
  askedIn?: string;
  approval: boolean;
  time: string;
  onHarder?: () => void;
}) {
  const human = turn.from === "human";
  return (
    <li className={human ? "ask-turn ask-turn-human" : "ask-turn ask-turn-agent"}>
      <p className="ask-who">
        <ActorMark kind={human ? "human" : "coo"} />
        <span className="ask-name">{human ? copy.you : copy.agent}</span>
        <time className="ask-time" dateTime={turn.at}>
          {time}
        </time>
        {human && askedIn !== undefined && <span className="ask-where">{askedIn}</span>}
      </p>
      {turn.harder === true && turn.model !== undefined && <p className="ask-handover">{copy.thoughtHarder(copy.models[turn.model])}</p>}
      {turn.handover !== undefined && <Handover handover={turn.handover} />}
      {!human && <Steps actions={turn.actions} baseOf={baseOf} approval={approval} />}
      {turn.text !== "" && <p className="ask-text">{turn.text}</p>}
      {turn.firstMemory === true && (
        <p className="ask-memory">
          <MemoryIcon />
          <span>
            {copy.firstMemory} <a href="#/settings/memory">{copy.firstMemoryLink}</a>
          </span>
        </p>
      )}
      {turn.outcome === "capReached" && <p className="notice ask-stopped">{copy.capReached}</p>}
      {turn.outcome === "failed" && (
        <p className="notice notice-alert ask-stopped" role="status">
          {copy.failed}
        </p>
      )}
      {onHarder !== undefined && (
        <p className="ask-again">
          <button type="button" className="button button-quiet button-small" onClick={onHarder}>
            {copy.harder}
          </button>
          <span className="ask-again-hint">{copy.harderHint}</span>
        </p>
      )}
    </li>
  );
}

/** Which model took the turn over, and why. */
const Handover = ({ handover }: { handover: components["schemas"]["Handover"] }) => (
  <p className="ask-handover">{copy.handedOver(copy.models[handover.to], copy.handoverWhy[handover.reason], handover.why)}</p>
);

/** What the agent did in a turn, a line each, with links to the threads and drafts it touched. */
function Steps({ actions, baseOf, approval }: { actions: Action[]; baseOf: (mailbox: string | undefined) => string; approval: boolean }) {
  if (actions.length === 0) return null;
  return (
    <ol className="ask-steps" aria-label={copy.steps}>
      {actions.map((action, index) => (
        <li key={index} className={action.ok ? "ask-step" : "ask-step ask-step-refused"}>
          <StepIcon ok={action.ok} />
          <span className="ask-step-what">
            <Step action={action} base={baseOf(action.mailbox)} approval={approval} />
          </span>
        </li>
      ))}
    </ol>
  );
}

function Step({ action, base, approval }: { action: Action; base: string; approval: boolean }) {
  const phrase = copy.actions[action.operation] ?? action.what;
  if (!action.ok) return <>{`${phrase}. ${copy.refusedStep(action.message ?? "")}`}</>;
  const [thread, ...more] = action.threads ?? [];
  if (action.draft !== undefined) {
    return (
      <>
        {phrase} <a href={`${base}drafts/${encodeURIComponent(action.draft)}`}>{copy.open.draft}</a>
        {(action.operation === "sendDraft" || action.operation === "sendAllMailboxesDraft") && approval && (
          <>
            {". "}
            <a href="#/approvals" className="ask-waits">
              {copy.open.approvals}
            </a>
          </>
        )}
      </>
    );
  }
  if (thread === undefined) return <>{action.operation === "keepMemory" ? copy.keptTold : phrase}</>;
  return (
    <>
      {phrase} <a href={threadHref(thread, { label: "inbox" }, base)}>{more.length === 0 ? copy.open.thread : copy.open.threads(more.length + 1)}</a>
    </>
  );
}

/** A memory kept: a knot in a thread, as one ties to remember. */
const MemoryIcon = () => (
  <svg className="icon ask-memory-icon" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M2 11.5c2.5 0 3.6-1.4 4.4-3.2C7.3 6.2 8.3 4.5 10 4.5c1.4 0 2.3 1 2.3 2.2 0 1.5-1.4 2.4-3 2.4-1.8 0-2.6-1.3-2.9-2.6M8.6 9.4c.9 1.4 2.4 2.1 5.4 2.1" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const StepIcon = ({ ok }: { ok: boolean }) => (
  <svg className="icon ask-step-icon" viewBox="0 0 16 16" aria-hidden="true">
    <path d={ok ? "M3.5 8.5 6.5 11.5 12.5 4.5" : "M4.5 4.5l7 7M11.5 4.5l-7 7"} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const BackIcon = () => (
  <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M10 3.5 5.5 8l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
