// The Approvals view: what waits for the signed-in sponsor, as a queue of rows in the list column,
// with the one chosen open in the reading pane beside it. Only sends wait here. A send lies there as
// a galley proof, the agent's draft set beside the message it answers, to send as is, edit and send,
// or reject. Agents send only as their sponsor, from the sponsor's mailbox, and each shows the
// disclosure's line as the sponsor's switch leaves it. The sends to decide come first. After them
// come the sends already approved that haven't gone out: those waiting for their agent's send
// limit, and those held while their agent is paused. Chips show one kind at a time.
import { useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { DuvaClient } from "@duva/client";
import type { components } from "@duva/openapi";
import { agentHref, heldAsked } from "./alerts.tsx";
import { ApprovalLog, UndoButton } from "./approval-log.tsx";
import { PreferencesContext } from "./dates.ts";
import { approvalChanges, type Change, type Connection as ConnectionState, type Follow, SignedOut } from "./feed.ts";
import { ActorMark, Addresses, Attachments, Connection, Field, Time } from "./mail-parts.tsx";
import { SendNow } from "./send-now.tsx";
import { useShortcuts } from "./shortcuts.tsx";
import { strings } from "./strings.ts";
import { BackIcon } from "./thread.tsx";

type Approval = components["schemas"]["Approval"];
type SendStatus = components["schemas"]["SendStatus"];
type Message = components["schemas"]["Message"];
type EmailAddress = components["schemas"]["EmailAddress"];
type AgentSettings = components["schemas"]["AgentSettings"];
type Draft = components["schemas"]["Draft"];
type Agent = components["schemas"]["Agent"];

/** An approval the view shows: waiting, or decided while the page was open. */
interface Entry {
  approval: Approval;
  /** Set once the approval is decided, by this page or elsewhere. */
  decision?: Decision;
  /** Whether it arrived after the page loaded, and the sponsor hasn't had it on screen yet. */
  fresh?: boolean;
}

/** A decision this page made says until when it can be undone, if it can. */
type Decision = { by: "you"; how: "sent" | "edited" | "rejected"; note?: string; undoUntil?: string } | { by: "elsewhere" };

/** Where a decided approval's draft stands, or "unknown" if Duva couldn't say. */
type Outcome = SendStatus | "none" | "unknown";

// A send in these states can still change, so the view keeps checking it.
const settling = new Set<SendStatus["state"]>(["waiting", "approved", "waitingForLimit", "sending"]);

// Pausing holds an agent's approved sends, and unpausing lets them go.
const pauseChanges = new Set<Change["type"]>(["agentPaused", "agentUnpaused"]);

/** A send approved that hasn't gone out, in the mailbox it waits in, by the agent that wrote it. */
interface Approved {
  mailbox: string;
  draft: Draft;
  /** None when the sponsor edited it, so it no longer says which agent wrote it. */
  agent?: Agent;
}

/** Each read of a list counts itself, so only the latest one shows, and none once the page has gone. */
async function latest<T>(count: { current: number }, read: Promise<T>): Promise<{ value: T } | undefined> {
  const mine = ++count.current;
  const value = await read;
  return mine === count.current ? { value } : undefined;
}

/** A read Duva couldn't answer reads as nothing. */
const quietly = <T,>(call: Promise<T>) => call.catch(() => ({ data: undefined }));

/** The sends approved that haven't gone out, of each agent the sponsor answers for, oldest first. */
async function readApproved(client: DuvaClient, me: string): Promise<Approved[] | undefined> {
  const [{ data: agents }, { data: mailboxes }] = await Promise.all([quietly(client.GET("/agents")), quietly(client.GET("/mailboxes"))]);
  if (agents === undefined || mailboxes === undefined) return undefined;
  const byId = new Map(agents.agents.map((agent) => [agent.id, agent]));
  // An agent's sends wait in the sponsor's mailboxes, where it sends as them.
  const searched = mailboxes.mailboxes.filter((mailbox) => mailbox.owner === me);
  const drafts = await Promise.all(
    searched.map(async (mailbox) => {
      const { data } = await quietly(client.GET("/mailboxes/{mailbox}/drafts", { params: { path: { mailbox: mailbox.id } } }));
      return (data?.drafts ?? []).flatMap((draft) => {
        const agent = byId.get(draft.updatedBy ?? "");
        const state = draft.send?.state;
        // Only an agent's send waits for a limit, so one the sponsor edited stays, though unnamed.
        const approved = state === "waitingForLimit" || (state === "approved" && agent?.paused !== undefined);
        return approved ? [{ mailbox: mailbox.id, draft, agent }] : [];
      });
    }),
  );
  // Drafts list newest first, and they go out oldest first.
  return drafts.flat().sort((a, b) => a.draft.updatedAt.localeCompare(b.draft.updatedAt));
}

/** The approvals waiting for the sponsor, whose ID is `me` and whose email address is `sponsor`. */
export function Approvals({
  client,
  me,
  sponsor,
  connection,
  follow,
  onSignedOut,
}: {
  client: DuvaClient;
  me: string;
  sponsor: string;
  connection: ConnectionState;
  follow: Follow;
  onSignedOut: () => void;
}) {
  const [entries, setEntries] = useState<Entry[] | undefined>();
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const [agents, setAgents] = useState<Record<string, string>>({});
  // The sponsor's own mailboxes, where their agents send as them, once listed.
  const [own, setOwn] = useState<ReadonlySet<string>>();
  const ownRef = useRef(own);
  ownRef.current = own;
  // Each agent's settings, as last read, whose switches say whether its sends carry the line.
  const [settings, setSettings] = useState<Record<string, AgentSettings>>({});
  // The sends approved that haven't gone out, once read.
  const [approved, setApproved] = useState<Approved[]>();
  // Those sent now from this page, which keep saying so after they leave the list.
  const [sentNow, setSentNow] = useState<Approved[]>([]);
  // The kind the chips show, the row chosen, and whether it was opened to read, which on a phone
  // and a narrow window takes the column from the queue.
  // An alert that leads to the held sends opens Approvals on them.
  const [kind, setKind] = useState<Kind | "all">(() => (heldAsked.current ? "held" : "all"));
  useEffect(() => {
    heldAsked.current = false;
  }, []);
  const [chosen, setChosen] = useState<string>();
  const [reading, setReading] = useState(false);
  // Whether the list column holds what waits, or the log of decisions.
  const [list, setList] = useState<"waiting" | "log">("waiting");
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const outcomesRef = useRef(outcomes);
  outcomesRef.current = outcomes;
  const agentsRef = useRef(agents);
  agentsRef.current = agents;
  // How many times each list was read, so only the latest reading shows.
  const approvedRead = useRef(0);

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
    const [{ data }, { data: mailboxes }] = await Promise.all([client.GET("/agents"), client.GET("/mailboxes")]);
    if (data !== undefined) setAgents(Object.fromEntries(data.agents.map((agent) => [agent.id, agent.name])));
    if (mailboxes !== undefined) setOwn(new Set(mailboxes.mailboxes.filter((mailbox) => mailbox.owner === me).map((mailbox) => mailbox.id)));
  }, [client, me]);

  // The settings are read again with each new list, so a switch changed meanwhile shows.
  const loadSettings = useCallback(
    async (ids: string[]) => {
      const read = await Promise.all(
        ids.map(async (agent) => [agent, (await client.GET("/agents/{agent}/settings", { params: { path: { agent } } }).catch(() => ({ data: undefined }))).data] as const),
      );
      setSettings((current) => ({ ...current, ...Object.fromEntries(read.flatMap(([agent, data]) => (data === undefined ? [] : [[agent, data]]))) }));
    },
    [client],
  );

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
      if (ownRef.current === undefined || data.approvals.some((approval) => !(approval.agent in agentsRef.current))) await loadAgents();
      await loadSettings([...new Set(data.approvals.map((approval) => approval.agent))]);
    },
    [client, loadAgents, loadSettings],
  );

  // A list Duva can't give now shows none, and is read again with the next change.
  const loadApproved = useCallback(async () => {
    const read = await latest(approvedRead, readApproved(client, me));
    if (read !== undefined) setApproved(read.value ?? []);
  }, [client, me]);

  // List the approvals, then again when a request or decision shows up in the change feeds, and
  // check the sends of decided ones. A list that couldn't be read is tried again with the next read of the feeds.
  useEffect(() => {
    let stopped = false;
    refresh(true).catch((error: unknown) => {
      if (!stopped && error instanceof SignedOut) onSignedOut();
    });
    void loadApproved();
    const unfollow = follow(async (changes) => {
      const touched = changes.some(({ change }) => approvalChanges.has(change.type));
      if (touched || changes.some(({ change }) => pauseChanges.has(change.type))) void loadApproved();
      if (entriesRef.current === undefined || touched) await refresh(entriesRef.current === undefined);
      if (!touched) return;
      for (const entry of entriesRef.current ?? []) {
        const outcome = outcomesRef.current[entry.approval.id];
        if (entry.decision !== undefined && (typeof outcome !== "object" || settling.has(outcome.state))) void loadOutcome(entry.approval);
      }
    });
    return () => {
      stopped = true;
      approvedRead.current++;
      unfollow();
    };
  }, [follow, refresh, loadOutcome, loadApproved, onSignedOut]);

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

  // An approval undone during its undo window waits again, so its galley opens where its slip lay.
  const undone = useCallback((approval: Approval) => {
    outcomesRead.current.delete(approval.id);
    setOutcomes(({ [approval.id]: _, ...rest }) => rest);
    const update = () => setEntries((current) => current?.map((entry) => (entry.approval.id === approval.id ? { approval: { ...entry.approval, ...approval }, fresh: false } : entry)));
    if (document.startViewTransition === undefined) return update();
    document.startViewTransition(() => flushSync(update));
  }, []);

  // The sends to decide come first, newest first, then the sends approved that haven't gone out:
  // those waiting for the send limit, then those held.
  const newest = <T extends { askedAt: string }>(list: T[]) => [...list].sort((a, b) => b.askedAt.localeCompare(a.askedAt));
  // A send whose slip lies on the page already says how it stands there.
  const slipped = new Set(entries?.map((entry) => entry.approval.id));
  const unslipped = (approved ?? []).filter(({ draft }) => draft.send?.approval === undefined || !slipped.has(draft.send.approval));
  const forLimit = [...unslipped.filter(({ agent, draft }) => agent?.paused === undefined && !sentNow.some((sent) => sent.draft.id === draft.id)), ...sentNow].sort((a, b) =>
    a.draft.updatedAt.localeCompare(b.draft.updatedAt),
  );
  const pausedAgents = new Map(unslipped.flatMap(({ agent }) => (agent?.paused !== undefined ? [[agent.id, agent] as const] : [])));
  const items: Item[] = [
    ...newest((entries ?? []).map((entry) => ({ askedAt: entry.approval.askedAt, entry }))).map(({ entry }) => ({ kind: "send" as const, key: `send-${entry.approval.id}`, entry })),
    ...forLimit.map((send) => ({ kind: "held" as const, key: `held-${send.draft.id}`, send })),
    ...[...pausedAgents.values()].flatMap((agent) => unslipped.filter((send) => send.agent?.id === agent.id).map((send) => ({ kind: "held" as const, key: `held-${send.draft.id}`, send, pause: agent }))),
  ];
  const waiting = entries?.filter((entry) => entry.decision === undefined).length ?? 0;
  const loaded = entries !== undefined && approved !== undefined;

  // The chips offer only the kinds there are, and All shows them all.
  const kinds = new Set(items.map(({ kind }) => kind));
  const shownKind = kind !== "all" && kinds.has(kind) ? kind : "all";
  const shown = items.filter((item) => shownKind === "all" || item.kind === shownKind);
  // The one open in the reading pane: the one chosen, or the first that waits for a decision. It
  // stays open as others arrive above it, until it leaves the list.
  const open = shown.find((item) => item.key === chosen) ?? shown.find(undecided) ?? shown[0];
  useEffect(() => {
    if (open !== undefined && open.key !== chosen) setChosen(open.key);
  }, [open, chosen]);
  const paneId = useId();
  const pane = useRef<HTMLDivElement>(null);
  const queue = useRef<HTMLOListElement>(null);
  // Choosing a row moves the focus to what it opened, and coming back moves it to the row.
  const [focusing, setFocusing] = useState<"pane" | "row">();
  useEffect(() => {
    if (focusing === undefined) return;
    setFocusing(undefined);
    const target =
      focusing === "pane"
        ? pane.current?.querySelector<HTMLElement>(":scope > article:not([hidden]) h2, :scope > section:not([hidden]) h2")
        : queue.current?.querySelector<HTMLElement>('[aria-current="true"]');
    if (target === null || target === undefined) return;
    if (focusing === "pane") target.tabIndex = -1;
    target.focus();
  }, [focusing]);
  // A request decided while another lies open says so aloud, as its slip would if it lay open.
  const [said, setSaid] = useState("");
  const decidedKeys = useRef(new Set<string>());
  const newlyDecided = items.filter((item) => rowOf(item, agents, outcomes).state !== undefined && !decidedKeys.current.has(item.key));
  useEffect(() => {
    const unseen = newlyDecided.filter((item) => item.key !== open?.key);
    for (const item of newlyDecided) decidedKeys.current.add(item.key);
    if (unseen.length === 0) return;
    setSaid(
      unseen
        .map((item) => {
          const { state, agent, subject } = rowOf(item, agents, outcomes);
          return `${state!.headline} ${agent} ${subject}.`;
        })
        .join(" "),
    );
  });
  const choose = (key: string) => {
    setChosen(key);
    setReading(true);
    setFocusing("pane");
  };

  const toggle = (
    <div className="queue-chips queue-lists" role="group" aria-label={strings.approvals.lists}>
      {(["waiting", "log"] as const).map((each) => (
        <button key={each} type="button" className="chip" aria-pressed={list === each} onClick={() => setList(each)}>
          {each === "waiting" ? strings.approvals.waitingList : strings.approvals.logList}
        </button>
      ))}
    </div>
  );
  if (list === "log") {
    return <ApprovalLog client={client} me={me} own={own} connection={connection} follow={follow} toggle={toggle} onSignedOut={onSignedOut} />;
  }
  if (!loaded || items.length === 0) {
    return (
      <main className="desk" aria-busy={!loaded}>
        <div className="desk-head">
          <h1>{strings.approvals.title}</h1>
          <Connection state={connection} />
        </div>
        {toggle}
        {loaded ? <Empty /> : <SkeletonQueue />}
      </main>
    );
  }
  return (
    <main className={reading ? "queue-view queue-view-reading" : "queue-view"}>
      <div className="queue">
        <div className="desk-head queue-head">
          <h1>{strings.approvals.title}</h1>
          {waiting > 0 && <p className="count">{strings.approvals.waiting(waiting)}</p>}
          <Connection state={connection} />
        </div>
        {toggle}
        {kinds.size > 1 && (
          <div className="queue-chips" role="group" aria-label={strings.approvals.show}>
            {(["all", ...order.filter((each) => kinds.has(each))] as const).map((each) => (
              <button key={each} type="button" className="chip" aria-pressed={shownKind === each} onClick={() => setKind(each)}>
                {strings.approvals.chips[each]}
              </button>
            ))}
          </div>
        )}
        <ol className="queue-rows" aria-label={strings.approvals.title} ref={queue}>
          {shown.map((item) => (
            <li key={item.key}>
              <Row item={item} agents={agents} outcomes={outcomes} current={item.key === open?.key} paneId={paneId} onChoose={() => choose(item.key)} />
            </li>
          ))}
        </ol>
        <p className="visually-hidden" aria-live="polite">
          {said}
        </p>
        {waiting === 0 && <p className="all-done">{kinds.has("held") ? strings.approvals.noneToDecide : strings.approvals.noneWaiting}.</p>}
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
          {strings.approvals.back}
        </button>
        {items.map((item) => {
          const shownHere = item.key === open?.key;
          if (item.kind === "held") {
            return (
              <HeldSend
                key={item.key}
                shown={shownHere}
                send={item.send}
                pause={item.pause}
                sent={sentNow.some((sent) => sent.draft.id === item.send.draft.id)}
                client={client}
                onSent={() => setSentNow((current) => (current.some((sent) => sent.draft.id === item.send.draft.id) ? current : [...current, item.send]))}
                onSignedOut={onSignedOut}
              />
            );
          }
          const { entry } = item;
          return (
            <Galley
              key={item.key}
              shown={shownHere}
              entry={entry}
              agent={agents[entry.approval.agent] ?? strings.galley.anAgent}
              sponsor={sponsor}
              line={settings[entry.approval.agent]?.disclosureLineAsSponsor ?? true}
              outcome={outcomes[entry.approval.id]}
              client={client}
              onDecided={decided}
              onUndone={undone}
              onSeen={seen}
              onSignedOut={onSignedOut}
            />
          );
        })}
      </div>
    </main>
  );
}

/** What the queue lists: a send to decide, or a send approved that hasn't gone out. */
type Item = { kind: "send"; key: string; entry: Entry } | { kind: "held"; key: string; send: Approved; pause?: Agent };

type Kind = Item["kind"];

/** The kinds, in the order the queue lists them. */
const order: Kind[] = ["send", "held"];

const undecided = (item: Item) => item.kind === "send" && item.entry.decision === undefined;

/** What a row says of its item: who, when, the subject, its recipients, and what a decided one became. */
function rowOf(item: Item, agents: Record<string, string>, outcomes: Record<string, Outcome>) {
  const anAgent = strings.galley.anAgent;
  if (item.kind === "send") {
    const { approval, decision, fresh } = item.entry;
    const agent = agents[approval.agent] ?? anAgent;
    return { agent, at: approval.askedAt, subject: approval.draft.subject || strings.galley.noSubject, to: approval.draft.to, state: decision && slipOf(approval, agent, decision, outcomes[approval.id]), fresh };
  }
  const { agent, draft } = item.send;
  return { agent: agent?.name ?? anAgent, at: draft.updatedAt, subject: draft.subject || strings.galley.noSubject, to: draft.to, state: undefined, fresh: false };
}

/**
 * A row of the queue: the agent by its diamond, the kind, when, and the subject with its
 * recipients, or what a decided one became. Choosing it opens it in the reading pane.
 */
function Row({
  item,
  agents,
  outcomes,
  current,
  paneId,
  onChoose,
}: {
  item: Item;
  agents: Record<string, string>;
  outcomes: Record<string, Outcome>;
  current: boolean;
  paneId: string;
  onChoose: () => void;
}) {
  const copy = strings.approvals;
  const to = (list: EmailAddress[]) => copy.to(list.map(({ address }) => address).join(", "));
  const row = rowOf(item, agents, outcomes);
  const { agent, at, subject, state, fresh } = row;
  const line = "to" in row && row.to !== undefined ? to(row.to) : undefined;
  const why = item.kind === "held" ? (item.pause === undefined ? copy.limitTitle : copy.heldTitle(item.pause.name)) : undefined;
  const classes = ["queue-row", undecided(item) && "queue-row-waiting", state !== undefined && "queue-row-decided"].filter(Boolean).join(" ");
  return (
    <button type="button" className={classes} aria-current={current ? "true" : undefined} aria-controls={paneId} onClick={onChoose}>
      <span className="queue-who">
        <ActorMark kind="agent" />
        {agent}
      </span>
      <span className={`queue-kind queue-kind-${item.kind}`}>{copy.kinds[item.kind]}</span>
      <span className="queue-time">
        <Time at={at} short />
      </span>
      <span className="queue-line">
        {fresh && <span className="mark-new">{strings.galley.isNew}</span>}
        <b>{subject}</b> {state !== undefined ? <span className={`queue-state queue-state-${state.tone}`}>{state.headline}</span> : line}
        {why !== undefined && <span className="queue-why">{why}</span>}
      </span>
    </button>
  );
}

/**
 * A send approved that hasn't gone out, in the reading pane: why it waits, its subject and
 * recipients, and its text. One waiting for the send limit can go now. One held while its agent is
 * paused links to the agent's line at Pause.
 */
function HeldSend({
  shown,
  send: { mailbox, draft, agent },
  pause,
  sent,
  client,
  onSent,
  onSignedOut,
}: {
  shown: boolean;
  send: Approved;
  pause?: Agent;
  sent: boolean;
  client: DuvaClient;
  onSent: () => void;
  onSignedOut: () => void;
}) {
  const id = useId();
  const copy = strings.approvals;
  return (
    <section className="galley galley-held" aria-labelledby={`${id}-title`} hidden={!shown}>
      <header className="galley-head">
        <h2 id={`${id}-title`}>
          <span className="galley-asks">
            <ActorMark kind="agent" />
            {pause === undefined ? copy.limitTitle : copy.heldTitle(pause.name)}
          </span>{" "}
          <span className="galley-subject" id={`${id}-subject`}>
            {draft.subject || strings.galley.noSubject}
          </span>
        </h2>
        <p className="galley-meta">
          {pause === undefined && <span className="galley-agent">{agent?.name ?? strings.galley.anAgent}</span>}
          <Time at={draft.updatedAt} />
        </p>
      </header>
      <p className="galley-lead">{pause === undefined ? copy.limitLead : copy.heldLead(pause.name)}</p>
      <div className="galley-cols galley-cols-single">
        <section className="galley-copy galley-draft" aria-labelledby={`${id}-draft`}>
          <h3 className="galley-label" id={`${id}-draft`}>
            {strings.galley.draft(agent?.name ?? strings.galley.anAgent)}
          </h3>
          <dl className="galley-fields">
            <Field label={strings.galley.from}>{draft.from}</Field>
            <Field label={strings.galley.to}>
              <Addresses list={draft.to} />
            </Field>
            <Field label={strings.galley.subject}>{draft.subject || strings.galley.noSubject}</Field>
          </dl>
          <div className="body" lang="">
            {draft.text}
          </div>
        </section>
      </div>
      <footer className="decision">
        <div className="actions">
          {pause !== undefined ? (
            <a className="button" href={agentHref(pause.id)}>
              {strings.alerts.openAtPause(pause.name)}
            </a>
          ) : (
            <SendNow client={client} mailbox={mailbox} draft={draft.id} labelledBy={`${id}-subject`} done={sent} onSent={(went) => went !== undefined && onSent()} onSignedOut={onSignedOut} />
          )}
        </div>
      </footer>
    </section>
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

function SkeletonQueue() {
  return (
    <div className="queue-skeleton" aria-hidden="true">
      {[62, 48, 70].map((width, row) => (
        <div className="queue-skeleton-row" key={row}>
          <span className="line" style={{ width: "9rem" }} />
          <span className="line" style={{ width: `${width}%` }} />
        </div>
      ))}
    </div>
  );
}


type Mode = "reading" | "editing" | "rejecting";

interface GalleyProps {
  /** Whether it is the one open in the reading pane. The others keep what the sponsor began there. */
  shown: boolean;
  entry: Entry;
  agent: string;
  sponsor: string;
  /** Whether the send carries the disclosure's visible line, which it does until the agent's settings are read. */
  line: boolean;
  outcome: Outcome | undefined;
  client: DuvaClient;
  onDecided: (approval: Approval, decision: Decision) => void;
  onUndone: (approval: Approval) => void;
  onSeen: (id: string) => void;
  onSignedOut: () => void;
}

function Galley({ shown, entry, agent, sponsor, line, outcome, client, onDecided, onUndone, onSeen, onSignedOut }: GalleyProps) {
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
  const keys = useContext(PreferencesContext).keyboardShortcuts === "on";

  useSeenOnScreen(ref, fresh === true && shown, approval.id, onSeen);

  const decide = async (kind: "sending" | "rejecting", call: () => Promise<{ response: Response; error?: { message: string }; data?: Approval }>, decision: Decision) => {
    if (busy !== undefined) return;
    setBusy(kind);
    setProblem(undefined);
    try {
      const { response, error, data } = await call();
      // Busy no longer once decided, so a send undone opens ready to decide again.
      setBusy(undefined);
      if (response.ok) return onDecided(approval, decision.by === "you" && data?.undoUntil !== undefined ? { ...decision, undoUntil: data.undoUntil } : decision);
      if (response.status === 409) return onDecided(approval, { by: "elsewhere" });
      if (response.status === 401) return onSignedOut();
      setProblem(response.status === 404 ? strings.decide.gone : response.status === 403 ? strings.decide.notYours : (error?.message ?? strings.decide.failed(response.status)));
    } catch {
      setProblem(strings.decide.unreachable);
    }
    setBusy(undefined);
  };
  const path = { params: { path: { approval: approval.id } } };
  const sendAsIs = () => decide("sending", () => client.POST("/approvals/{approval}/send", path), { by: "you", how: "sent" });
  // s sends the draft open in the reading pane as written, as Send does.
  useShortcuts({ s: shown && decision === undefined && mode === "reading" ? () => ref.current?.checkVisibility() && void sendAsIs() : undefined });

  if (decision !== undefined) {
    // A send that waits for the agent's limits can go now, past them.
    const waits = typeof outcome === "object" && outcome.approval === approval.id && outcome.state === "waitingForLimit";
    return (
      <DecidedSlip shown={shown} approval={approval} agent={agent} decision={decision} outcome={outcome}>
        {waits && <SendNow client={client} mailbox={approval.mailbox} draft={draft.id} onSignedOut={onSignedOut} />}
        {decision.by === "you" && decision.undoUntil !== undefined && (
          <UndoButton client={client} approval={approval.id} until={decision.undoUntil} onUndone={onUndone} onSignedOut={onSignedOut} />
        )}
      </DecidedSlip>
    );
  }

  const switchTo = (next: Mode) => {
    setProblem(undefined);
    setNoteRefused(0);
    setMode(next);
  };
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
    <article className={fresh ? "galley galley-fresh" : "galley"} aria-labelledby={titleId} ref={ref} hidden={!shown} style={{ viewTransitionName: shown ? transitionName(approval) : undefined }}>
      <header className="galley-head">
        <h2 id={titleId}>
          <span className="galley-asks">
            <ActorMark kind="agent" />
            {strings.galley.asks(agent)}
          </span>{" "}
          <span className="galley-subject">{draft.subject || strings.galley.noSubject}</span>
        </h2>
        <p className="galley-meta">
          {fresh && <span className="mark-new">{strings.galley.isNew}</span>}
          <span className="galley-from galley-from-sponsor">{strings.galley.asYou(draft.from)}</span>
          <Time at={approval.askedAt} format={(time) => strings.galley.askedAt(time)} />
        </p>
      </header>

      <div className={original === undefined ? "galley-cols galley-cols-single" : "galley-cols"}>
        {original !== undefined ? (
          <Original message={original} />
        ) : (
          <p className="galley-note">{draft.forwards !== undefined ? strings.galley.forward : draft.answers === undefined ? strings.galley.noOriginal : strings.galley.originalGone}</p>
        )}

        <section className={editing ? "galley-copy galley-draft galley-draft-editing" : "galley-copy galley-draft"} aria-labelledby={`${titleId}-proof`}>
          <h3 className="galley-label" id={`${titleId}-proof`}>
            <ActorMark kind={editing ? "human" : "agent"} />
            {editing ? strings.galley.yourVersion : strings.galley.draft(agent)}
          </h3>
          {editing ? (
            <EditFields to={[to, setTo]} subject={[subject, setSubject]} text={[text, setText]} />
          ) : (
            <>
              <dl className="galley-fields">
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
                <Disclosure agent={agent} sponsor={sponsor} line={line} />
                {draft.attachments !== undefined && draft.attachments.length > 0 && <Attachments list={draft.attachments} />}
              </div>
            </>
          )}
          {editing && <Disclosure agent={agent} sponsor={sponsor} line={line} />}
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
              <button type="button" className="button button-call" onClick={sendAsIs} disabled={busy !== undefined} aria-keyshortcuts={keys ? "s" : undefined}>
                <SendIcon />
                {busy === "sending" ? strings.decide.sending : strings.decide.send}
                {keys && <kbd aria-hidden="true">s</kbd>}
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
              <button type="button" className="button button-call" onClick={sendEdited} disabled={busy !== undefined}>
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

/** A new request keeps its mark until it has been on screen for a moment. */
function useSeenOnScreen(ref: React.RefObject<HTMLElement | null>, fresh: boolean, id: string, onSeen: (id: string) => void) {
  useEffect(() => {
    if (!fresh || ref.current === null) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new IntersectionObserver(([seen]) => {
      clearTimeout(timer);
      if (seen?.isIntersecting) timer = setTimeout(() => onSeen(id), 1500);
    }, { threshold: 0.4 });
    observer.observe(ref.current);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [ref, fresh, id, onSeen]);
}

/** The message the draft answers, as it arrived. Long ones fold, so the draft stays in reach. */
function Original({ message }: { message: Message }) {
  const long = message.text.split("\n").length > 14 || message.text.length > 900;
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  return (
    <section className="galley-copy galley-original" aria-labelledby={`${bodyId}-label`}>
      <h3 className="galley-label" id={`${bodyId}-label`}>
        {strings.galley.original}
      </h3>
      <dl className="galley-fields">
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

/** The line Duva adds to the message, as recipients get it, or that it adds none, as the sponsor chose. */
function Disclosure({ agent, sponsor, line }: { agent: string; sponsor: string; line: boolean }) {
  return (
    <p className="disclosure">
      {line && <span className="disclosure-line">{strings.galley.disclosure(agent, sponsor)}</span>}
      <span className="disclosure-note">{line ? strings.galley.disclosureNote : strings.galley.noDisclosureLine(agent)}</span>
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

/** What a decided approval's slip says: its headline, and how the send went in its tone. */
function slipOf(approval: Approval, agent: string, decision: Decision, outcome: Outcome | undefined) {
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
  return { headline, ...describe(outcome, approval, agent, decision) };
}

/** A decided approval, folded to one slip: what was decided, and how the send went. */
function DecidedSlip({
  shown,
  approval,
  agent,
  decision,
  outcome,
  children,
}: {
  shown: boolean;
  approval: Approval;
  agent: string;
  decision: Decision;
  outcome: Outcome | undefined;
  children?: React.ReactNode;
}) {
  const result = slipOf(approval, agent, decision, outcome);
  return (
    <article className={`slip galley-slip slip-${result.tone}`} aria-live="polite" hidden={!shown} style={{ viewTransitionName: shown ? transitionName(approval) : undefined }}>
      <StateIcon tone={result.tone} />
      <div>
        <h2 className="slip-head">
          {result.headline} <span className="slip-agent">{agent}</span> <span className="slip-subject">{approval.draft.subject || strings.galley.noSubject}</span>
        </h2>
        <p className="slip-result">{result.text}</p>
        {result.detail !== undefined && <p className="slip-detail">{result.detail}</p>}
        {decision.by === "you" && decision.note !== undefined && <p className="slip-note">{strings.outcome.note(decision.note)}</p>}
        {children}
      </div>
    </article>
  );
}

const transitionName = (approval: Approval) => `approval-${approval.id.replace(/[^\w-]/g, "")}`;

type Tone = "pending" | "sent" | "done" | "rejected" | "failed";

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
      return { tone: "pending", text: strings.outcome.approved };
    case "approved":
      return { tone: "pending", text: outcome.undoUntil !== undefined && Date.parse(outcome.undoUntil) > Date.now() ? strings.outcome.undoWindow : strings.outcome.approved };
    case "waitingForLimit":
      return { tone: "pending", text: strings.outcome.waitingForLimit(agent) };
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
    done: <path d="m5 8.2 2 2 4-4.4" />,
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
