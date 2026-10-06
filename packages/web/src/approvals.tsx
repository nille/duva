// The Approvals view: the sends waiting for the signed-in sponsor, each laid out like a galley proof,
// with the agent's draft set beside the message it answers, to send as is, edit and send, or reject.
// Each says whether the agent sends as the sponsor, from their mailbox, or from its own, and shows
// the disclosure's line as the sponsor's switch for that place leaves it. Beside them wait the setup
// changes the sponsor's agent admins ask for, each with the call it made and what it would do, to
// approve or reject with a note. The sends come first, since they are where an agent speaks. Under
// them lie the sends already approved that haven't gone out: those waiting for their agent's send
// limit, and those held while their agent is paused.
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { DuvaClient } from "@duva/client";
import type { components, Operation, OperationId } from "@duva/openapi";
import { agentHref } from "./alerts.tsx";
import { approvalChanges, type Change, type Connection as ConnectionState, type Follow, setupChanges, SignedOut } from "./feed.ts";
import { Addresses, Attachments, Connection, Field, Time } from "./mail-parts.tsx";
import { SendNow } from "./send-now.tsx";
import { strings } from "./strings.ts";

type Approval = components["schemas"]["Approval"];
type SendStatus = components["schemas"]["SendStatus"];
type Message = components["schemas"]["Message"];
type EmailAddress = components["schemas"]["EmailAddress"];
type AgentSettings = components["schemas"]["AgentSettings"];
type SetupApproval = components["schemas"]["SetupApproval"];
type SetupResult = components["schemas"]["SetupResult"];
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

type Decision = { by: "you"; how: "sent" | "edited" | "rejected"; note?: string } | { by: "elsewhere" };

/** A setup approval the view shows: waiting, or decided while the page was open. */
interface SetupEntry {
  setup: SetupApproval;
  /** Set once it is decided, by this page or elsewhere, where it says what became of it once read. */
  decision?: SetupDecision;
  fresh?: boolean;
}

type SetupDecision = { by: "you"; how: "approved"; result?: SetupResult } | { by: "you"; how: "rejected"; note: string } | { by: "elsewhere"; read?: SetupApproval };

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
  /** None when the sponsor edited it in their own mailbox, so it no longer says which agent wrote it. */
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

/** What the IDs in a setup change's call are: a mailbox by its owner and address, an actor by name. */
type SetupNames = ReadonlyMap<string, string>;

/** The sends approved that haven't gone out, of each agent the sponsor answers for, oldest first. */
async function readApproved(client: DuvaClient, me: string): Promise<Approved[] | undefined> {
  const [{ data: agents }, { data: mailboxes }] = await Promise.all([quietly(client.GET("/agents")), quietly(client.GET("/mailboxes"))]);
  if (agents === undefined || mailboxes === undefined) return undefined;
  const byId = new Map(agents.agents.map((agent) => [agent.id, agent]));
  // An agent's sends wait in its own mailboxes, and in the sponsor's when it sends as them.
  const searched = mailboxes.mailboxes.filter((mailbox) => mailbox.owner === me || byId.has(mailbox.owner));
  const drafts = await Promise.all(
    searched.map(async (mailbox) => {
      const { data } = await quietly(client.GET("/mailboxes/{mailbox}/drafts", { params: { path: { mailbox: mailbox.id } } }));
      return (data?.drafts ?? []).flatMap((draft) => {
        const agent = byId.get(mailbox.owner === me ? (draft.updatedBy ?? "") : mailbox.owner);
        const state = draft.send?.state;
        // Only an agent's send waits for a limit, so one the sponsor edited stays, though unnamed.
        const approved = (state === "waitingForLimit" && (agent !== undefined || mailbox.owner === me)) || (state === "approved" && agent?.paused !== undefined);
        return approved ? [{ mailbox: mailbox.id, draft, agent }] : [];
      });
    }),
  );
  // Drafts list newest first, and they go out oldest first.
  return drafts.flat().sort((a, b) => a.draft.updatedAt.localeCompare(b.draft.updatedAt));
}

/** Names for the mailboxes and actors of the organization, which only an admin can list. A list Duva can't give names nothing. */
async function readSetupNames(client: DuvaClient, me: string): Promise<SetupNames> {
  const [{ data: mailboxes }, { data: humans }, { data: agents }] = await Promise.all([
    quietly(client.GET("/organization/mailboxes")),
    quietly(client.GET("/humans")),
    quietly(client.GET("/organization/agents")),
  ]);
  const actors = new Map<string, string>([
    ...(humans?.humans ?? []).map((human) => [human.id, human.email] as const),
    ...(agents?.agents ?? []).map((agent) => [agent.id, agent.name] as const),
    ...(mailboxes?.owners ?? []).map((owner) => [owner.id, owner.kind === "agent" ? owner.name : owner.email] as const),
  ]);
  const copy = strings.setupGalley;
  const named = (mailbox: { owner: string; defaultAddress?: string }) => {
    const address = mailbox.defaultAddress ?? copy.noAddress;
    if (mailbox.owner === me) return copy.yourMailbox(address);
    return copy.mailboxOf(actors.get(mailbox.owner) ?? strings.galley.anAgent, address);
  };
  return new Map([...actors, ...(mailboxes?.mailboxes ?? []).map((mailbox) => [mailbox.id, named(mailbox)] as const)]);
}

/** The words of a CLI command, joined as typed. */
type Joined<Words extends readonly string[]> = Words extends readonly [infer First extends string, ...infer Rest extends readonly string[]]
  ? Rest extends readonly [] ? First : `${First} ${Joined<Rest>}`
  : never;

/**
 * The CLI command for each call an agent admin's setup change can be, as a sponsor would type it.
 * The contract's own commands type each one, so a command renamed there fails to typecheck here.
 */
const commands: { [Id in OperationId]?: `duva ${Joined<Extract<Operation, { operationId: Id }>["command"]>}` } = {
  addAddress: "duva addresses add",
  removeAddress: "duva addresses remove",
  createMailbox: "duva mailboxes create",
  changeMailbox: "duva mailboxes change",
  createGroup: "duva groups create",
  changeGroup: "duva groups change",
  deleteGroup: "duva groups delete",
  addDomain: "duva domains add",
  changeDomain: "duva domains change",
  removeDomain: "duva domains remove",
  setCatchAll: "duva domains set-catch-all",
  clearCatchAll: "duva domains clear-catch-all",
  addHuman: "duva humans add",
  pauseAgent: "duva agents pause",
  changeOrganizationSettings: "duva organization change-settings",
};

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
  const [setups, setSetups] = useState<SetupEntry[]>([]);
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const [agents, setAgents] = useState<Record<string, string>>({});
  // The sponsor's own mailboxes, where an agent sends as them, once listed.
  const [own, setOwn] = useState<ReadonlySet<string>>();
  const ownRef = useRef(own);
  ownRef.current = own;
  // Each agent's settings, as last read, whose switches say whether its sends carry the line.
  const [settings, setSettings] = useState<Record<string, AgentSettings>>({});
  // The sends approved that haven't gone out, once read, and what the IDs in setup changes are.
  const [approved, setApproved] = useState<Approved[]>();
  const [setupNames, setSetupNames] = useState<SetupNames>(new Map());
  // Those sent now from this page, which keep saying so after they leave the list.
  const [sentNow, setSentNow] = useState<Approved[]>([]);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const outcomesRef = useRef(outcomes);
  outcomesRef.current = outcomes;
  const agentsRef = useRef(agents);
  agentsRef.current = agents;
  // How many times each list was read, so only the latest reading shows.
  const approvedRead = useRef(0);
  const namesRead = useRef(0);

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
      const setupsWaiting = new Map(data.setupApprovals.map((setup) => [setup.id, setup]));
      setSetups((current) => {
        const known = new Set(current.map((entry) => entry.setup.id));
        // A waiting one keeps the preview Duva gives now, which approving may have changed.
        const kept = current.map((entry) =>
          entry.decision !== undefined ? entry : setupsWaiting.has(entry.setup.id) ? { ...entry, setup: setupsWaiting.get(entry.setup.id)! } : { ...entry, decision: { by: "elsewhere" as const } },
        );
        const arrived = data.setupApprovals.filter((setup) => !known.has(setup.id)).map((setup) => ({ setup, fresh: !first }));
        return [...arrived, ...kept];
      });
      setEntries((current = []) => {
        const known = new Set(current.map((entry) => entry.approval.id));
        const kept = current.map((entry) => (entry.decision === undefined && !waiting.has(entry.approval.id) ? { ...entry, decision: { by: "elsewhere" as const } } : entry));
        const arrived = data.approvals.filter((approval) => !known.has(approval.id)).map((approval) => ({ approval, fresh: !first }));
        return [...arrived, ...kept].sort((a, b) => b.approval.askedAt.localeCompare(a.approval.askedAt));
      });
      if (ownRef.current === undefined || [...data.approvals, ...data.setupApprovals].some((approval) => !(approval.agent in agentsRef.current))) await loadAgents();
      await Promise.all([
        loadSettings([...new Set(data.approvals.map((approval) => approval.agent))]),
        data.setupApprovals.length > 0 && latest(namesRead, readSetupNames(client, me)).then((read) => read !== undefined && setSetupNames(read.value)),
      ]);
    },
    [client, me, loadAgents, loadSettings],
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
    const unfollow = follow(async (changes, organization) => {
      const touched = changes.some(({ change }) => approvalChanges.has(change.type)) || organization.some((change) => setupChanges.has(change.type));
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
      namesRead.current++;
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

  const setupDecided = useCallback((setup: SetupApproval, decision: SetupDecision) => {
    const update = () => setSetups((current) => current.map((entry) => (entry.setup.id === setup.id ? { ...entry, decision, fresh: false } : entry)));
    if (document.startViewTransition === undefined) return update();
    document.startViewTransition(() => flushSync(update));
  }, []);
  const setupSeen = useCallback((id: string) => setSetups((current) => current.map((entry) => (entry.setup.id === id ? { ...entry, fresh: false } : entry))), []);
  const setupChanged = useCallback((setup: SetupApproval) => setSetups((current) => current.map((entry) => (entry.setup.id === setup.id ? { ...entry, setup } : entry))), []);

  // One decided elsewhere says what became of it once it's read.
  const setupsRead = useRef(new Set<string>());
  useEffect(() => {
    for (const { setup, decision } of setups) {
      if (decision?.by !== "elsewhere" || setupsRead.current.has(setup.id)) continue;
      setupsRead.current.add(setup.id);
      void client
        .GET("/setup-approvals/{approval}", { params: { path: { approval: setup.id } } })
        .then(({ data }) => data !== undefined && setSetups((current) => current.map((entry) => (entry.setup.id === setup.id ? { ...entry, decision: { by: "elsewhere", read: data } } : entry))))
        .catch(() => undefined);
    }
  }, [client, setups]);

  // The sends come first, where an agent speaks, then the setup changes, each newest first.
  const newest = <T extends { askedAt: string }>(list: T[]) => [...list].sort((a, b) => b.askedAt.localeCompare(a.askedAt));
  const items = [...newest((entries ?? []).map((entry) => ({ askedAt: entry.approval.askedAt, entry }))), ...newest(setups.map((setup) => ({ askedAt: setup.setup.askedAt, setup })))];
  const waiting = (entries?.filter((entry) => entry.decision === undefined).length ?? 0) + setups.filter((entry) => entry.decision === undefined).length;
  // A send whose slip lies on the page already says how it stands there.
  const slipped = new Set(entries?.map((entry) => entry.approval.id));
  const unslipped = (approved ?? []).filter(({ draft }) => draft.send?.approval === undefined || !slipped.has(draft.send.approval));
  const forLimit = [...unslipped.filter(({ agent, draft }) => agent?.paused === undefined && !sentNow.some((sent) => sent.draft.id === draft.id)), ...sentNow].sort((a, b) =>
    a.draft.updatedAt.localeCompare(b.draft.updatedAt),
  );
  const pausedAgents = new Map(unslipped.flatMap(({ agent }) => (agent?.paused !== undefined ? [[agent.id, agent] as const] : [])));
  const held = [...pausedAgents.values()].map((agent) => ({ agent, sends: unslipped.filter((send) => send.agent?.id === agent.id) }));
  const anyApproved = forLimit.length > 0 || held.length > 0;
  return (
    <main className="desk" aria-busy={entries === undefined}>
      <div className="desk-head">
        <h1>{strings.approvals.title}</h1>
        {entries !== undefined && waiting > 0 && <p className="count">{strings.approvals.waiting(waiting)}</p>}
        <Connection state={connection} />
      </div>
      {entries === undefined || approved === undefined ? (
        <SkeletonGalley />
      ) : items.length === 0 && !anyApproved ? (
        <Empty />
      ) : items.length === 0 ? null : (
        <ol className="galleys" aria-label={strings.approvals.title}>
          {items.map((item) => {
            if ("setup" in item) {
              const { setup } = item;
              return (
                <li key={setup.setup.id}>
                  <SetupGalley
                    entry={setup}
                    agent={agents[setup.setup.agent] ?? strings.galley.anAgent}
                    names={setupNames}
                    client={client}
                    onDecided={setupDecided}
                    onChanged={setupChanged}
                    onSeen={setupSeen}
                    onSignedOut={onSignedOut}
                  />
                </li>
              );
            }
            const { entry } = item;
            const asSponsor = own?.has(entry.approval.mailbox);
            return (
              <li key={entry.approval.id}>
                <Galley
                  entry={entry}
                  agent={agents[entry.approval.agent] ?? strings.galley.anAgent}
                  sponsor={sponsor}
                  asSponsor={asSponsor}
                  line={lineFor(settings[entry.approval.agent], asSponsor)}
                  outcome={outcomes[entry.approval.id]}
                  client={client}
                  onDecided={decided}
                  onSeen={seen}
                  onSignedOut={onSignedOut}
                />
              </li>
            );
          })}
        </ol>
      )}
      {entries !== undefined && approved !== undefined && waiting === 0 && (items.length > 0 || anyApproved) && (
        <p className={items.length > 0 ? "all-done" : "all-done all-done-first"}>{anyApproved ? strings.approvals.noneToDecide : strings.approvals.noneWaiting}.</p>
      )}
      {entries !== undefined && forLimit.length > 0 && (
        <ApprovedSends title={strings.approvals.limitTitle} lead={strings.approvals.limitLead} sends={forLimit} client={client} onSent={(send) => setSentNow((current) => [...current, send])} onSignedOut={onSignedOut} />
      )}
      {entries !== undefined &&
        held.map(({ agent, sends }) => (
          <ApprovedSends key={agent.id} title={strings.approvals.heldTitle(agent.name)} lead={strings.approvals.heldLead(agent.name)} sends={sends} pause={agent} client={client} onSignedOut={onSignedOut} />
        ))}
    </main>
  );
}

/**
 * Sends approved that haven't gone out, on one sheet: each send's subject in the serif and its
 * recipients. Those waiting for the send limit name their agent and can go now. Those held while
 * their agent is paused are one agent's, with a link to its line at Pause.
 */
function ApprovedSends({
  title,
  lead,
  sends,
  pause,
  client,
  onSent,
  onSignedOut,
}: {
  title: string;
  lead: string;
  sends: Approved[];
  pause?: Agent;
  client: DuvaClient;
  onSent?: (send: Approved) => void;
  onSignedOut: () => void;
}) {
  const id = useId();
  return (
    <section className="approved" aria-labelledby={`${id}-title`}>
      <div className="approved-head">
        <h2 id={`${id}-title`}>{title}</h2>
        <p className="approved-lead">{lead}</p>
        {pause !== undefined && (
          <a className="approved-pause" href={agentHref(pause.id)}>
            {strings.alerts.openAtPause(pause.name)}
          </a>
        )}
      </div>
      <ul className="approved-sends">
        {sends.map(({ mailbox, draft, agent }, index) => (
          <li key={draft.id} className="approved-send">
            <div className="approved-send-text">
              {pause === undefined && <p className="approved-send-agent">{agent?.name ?? strings.galley.anAgent}</p>}
              <p className="approved-send-subject" id={`${id}-${index}`}>
                {draft.subject || strings.galley.noSubject}
              </p>
              <p className="approved-send-to">{strings.approvals.to(draft.to.map((address) => address.address).join(", "))}</p>
            </div>
            {pause === undefined && <SendNow client={client} mailbox={mailbox} draft={draft.id} labelledBy={`${id}-${index}`} onSent={() => onSent?.(sends[index]!)} onSignedOut={onSignedOut} />}
          </li>
        ))}
      </ul>
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

/**
 * Whether the agent's send carries the disclosure's line, by its sponsor's switch for where it
 * sends from. Until both are known, it's shown with the line, which every switch starts with.
 */
function lineFor(settings: AgentSettings | undefined, asSponsor: boolean | undefined): boolean {
  if (settings === undefined || asSponsor === undefined) return true;
  return asSponsor ? settings.disclosureLineAsSponsor : settings.disclosureLineForOwnMailbox;
}

interface GalleyProps {
  entry: Entry;
  agent: string;
  sponsor: string;
  /** Whether the agent sends as the sponsor, from the sponsor's own mailbox, or undefined until that is known. */
  asSponsor: boolean | undefined;
  /** Whether the send carries the disclosure's visible line. */
  line: boolean;
  outcome: Outcome | undefined;
  client: DuvaClient;
  onDecided: (approval: Approval, decision: Decision) => void;
  onSeen: (id: string) => void;
  onSignedOut: () => void;
}

function Galley({ entry, agent, sponsor, asSponsor, line, outcome, client, onDecided, onSeen, onSignedOut }: GalleyProps) {
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

  if (decision !== undefined) {
    // A send that waits for the agent's limits can go now, past them.
    const waits = typeof outcome === "object" && outcome.approval === approval.id && outcome.state === "waitingForLimit";
    return (
      <DecidedSlip approval={approval} agent={agent} decision={decision} outcome={outcome}>
        {waits && <SendNow client={client} mailbox={approval.mailbox} draft={draft.id} onSignedOut={onSignedOut} />}
      </DecidedSlip>
    );
  }

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
        {asSponsor !== undefined && (
          <p className={asSponsor ? "slug-from slug-from-sponsor" : "slug-from"}>{asSponsor ? strings.galley.asYou(draft.from) : strings.galley.fromOwnMailbox(draft.from)}</p>
        )}
        <p className="slug-meta">
          {fresh && <span className="mark-new">{strings.galley.isNew}</span>}
          <Time at={approval.askedAt} format={(time) => strings.galley.askedAt(time)} />
        </p>
      </header>

      <div className={original === undefined ? "sheet sheet-single" : "sheet"}>
        {original !== undefined ? (
          <Original message={original} />
        ) : (
          <p className="copy copy-note">{draft.forwards !== undefined ? strings.galley.forward : draft.answers === undefined ? strings.galley.noOriginal : strings.galley.originalGone}</p>
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

/** A decided approval, folded to one slip: what was decided, and how the send went. */
function DecidedSlip({ approval, agent, decision, outcome, children }: { approval: Approval; agent: string; decision: Decision; outcome: Outcome | undefined; children?: React.ReactNode }) {
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
          {headline} <span className="slip-agent">{agent}</span> <span className="slip-subject">{approval.draft.subject || strings.galley.noSubject}</span>
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
const setupTransitionName = (setup: SetupApproval) => `setup-${setup.id.replace(/[^\w-]/g, "")}`;

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
    case "approved":
      return { tone: "pending", text: strings.outcome.approved };
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

interface SetupGalleyProps {
  entry: SetupEntry;
  agent: string;
  names: SetupNames;
  client: DuvaClient;
  onDecided: (setup: SetupApproval, decision: SetupDecision) => void;
  /** Duva worked out a new preview, as when the setup changed since the agent asked. */
  onChanged: (setup: SetupApproval) => void;
  onSeen: (id: string) => void;
  onSignedOut: () => void;
}

/**
 * A setup change an agent admin asks for, as a proof: the call it made, beside what Duva works out
 * the change would do, with the decision under them.
 */
function SetupGalley({ entry, agent, names, client, onDecided, onChanged, onSeen, onSignedOut }: SetupGalleyProps) {
  const { setup, decision, fresh } = entry;
  const titleId = useId();
  const problemId = useId();
  const [rejecting, setRejecting] = useState(false);
  const [busy, setBusy] = useState<"approving" | "rejecting" | undefined>();
  const [problem, setProblem] = useState<string | undefined>();
  const [note, setNote] = useState("");
  const [noteRefused, setNoteRefused] = useState(0);
  const ref = useRef<HTMLElement>(null);
  const copy = strings.setupGalley;

  useEffect(() => {
    if (!fresh || ref.current === null) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new IntersectionObserver(([seen]) => {
      clearTimeout(timer);
      if (seen?.isIntersecting) timer = setTimeout(() => onSeen(setup.id), 1500);
    }, { threshold: 0.4 });
    observer.observe(ref.current);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [fresh, setup.id, onSeen]);

  if (decision !== undefined) return <SetupSlip setup={setup} agent={agent} decision={decision} />;

  const path = { params: { path: { approval: setup.id } } };
  /** What a refused decision means: decided elsewhere, a new preview to read, or Duva's reason. */
  const refused = async (response: Response, error: { message: string } | undefined) => {
    if (response.status === 401) return onSignedOut();
    if (response.status === 404) return setProblem(strings.decide.gone);
    if (response.status === 403) return setProblem(strings.decide.notYours);
    if (response.status !== 409) return setProblem(error?.message ?? strings.decide.failed(response.status));
    const { data: now } = await client.GET("/setup-approvals/{approval}", path).catch(() => ({ data: undefined }));
    if (now !== undefined && now.state !== "pending") return onDecided(setup, { by: "elsewhere", read: now });
    if (now !== undefined && now.preview.join("\n") !== setup.preview.join("\n")) {
      onChanged(now);
      return setProblem(copy.previewChanged(agent));
    }
    setProblem(error?.message ?? strings.decide.failed(response.status));
  };
  const decide = async (kind: "approving" | "rejecting", call: () => Promise<{ data?: SetupApproval; response: Response; error?: { message: string } }>, decision: (data: SetupApproval) => SetupDecision) => {
    if (busy !== undefined) return;
    setBusy(kind);
    setProblem(undefined);
    try {
      const { data, response, error } = await call();
      if (data !== undefined) return onDecided(setup, decision(data));
      await refused(response, error);
    } catch {
      setProblem(strings.decide.unreachable);
    }
    setBusy(undefined);
  };
  const approve = () => decide("approving", () => client.POST("/setup-approvals/{approval}/approve", path), (data) => ({ by: "you", how: "approved", ...(data.result !== undefined && { result: data.result }) }));
  const reject = () => {
    if (note.trim() === "") {
      setNoteRefused((count) => count + 1);
      return setProblem(strings.decide.noteMissing(agent));
    }
    return decide("rejecting", () => client.POST("/setup-approvals/{approval}/reject", { ...path, body: { note: note.trim() } }), () => ({ by: "you", how: "rejected", note: note.trim() }));
  };
  // A body's fields come in no set order, so they show by name, after the path's.
  const byName = (fields: object) => Object.entries(fields).sort(([a], [b]) => a.localeCompare(b));
  const fields = [...byName(setup.operation.path ?? {}), ...byName(setup.operation.body ?? {})];

  return (
    <article className={fresh ? "galley galley-setup galley-fresh" : "galley galley-setup"} aria-labelledby={titleId} ref={ref} style={{ viewTransitionName: setupTransitionName(setup) }}>
      <header className="slug">
        <h2 id={titleId}>
          {copy.asks(agent)}
          {setup.preview[0] !== undefined && <> <span className="slug-subject slug-subject-setup">{setup.preview[0]}</span></>}
        </h2>
        <p className="slug-meta">
          {fresh && <span className="mark-new">{strings.galley.isNew}</span>}
          <Time at={setup.askedAt} format={(time) => strings.galley.askedAt(time)} />
        </p>
      </header>
      <div className="sheet sheet-setup">
        <section className="copy original setup-call" aria-labelledby={`${titleId}-call`}>
          <h3 className="copy-label" id={`${titleId}-call`}>
            {copy.call}
          </h3>
          <dl className="fields setup-fields">
            <Field label={copy.command}>
              <code>{commands[setup.operation.operationId as OperationId] ?? setup.operation.operationId}</code>
            </Field>
            {fields.map(([name, value]) => (
              <Field key={name} label={name}>
                <CallValue value={value} names={names} />
              </Field>
            ))}
          </dl>
        </section>
        <section className="copy proof setup-preview" aria-labelledby={`${titleId}-preview`}>
          <h3 className="copy-label" id={`${titleId}-preview`}>
            {copy.preview}
          </h3>
          <ul className="preview">
            {setup.preview.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
          <p className="hint">{copy.previewHint(agent)}</p>
        </section>
      </div>
      <footer className="decision">
        {rejecting && <RejectNote agent={agent} note={[note, setNote]} refused={noteRefused} errorId={problemId} />}
        {problem !== undefined && (
          <p className="notice notice-alert" role="alert" id={problemId}>
            {problem}
          </p>
        )}
        <div className="actions">
          {rejecting ? (
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
                  setRejecting(false);
                }}
              >
                {strings.decide.cancel}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="button button-primary" onClick={approve} disabled={busy !== undefined}>
                {busy === "approving" ? copy.approving : copy.approve}
              </button>
              <button
                type="button"
                className="button button-quiet"
                disabled={busy !== undefined}
                onClick={() => {
                  setProblem(undefined);
                  setNoteRefused(0);
                  setRejecting(true);
                }}
              >
                {strings.decide.reject}
              </button>
            </>
          )}
        </div>
      </footer>
    </article>
  );
}

/** A value in the call: an ID by what it is, with the ID under it, a list a line each, or the value as it came. */
function CallValue({ value, names }: { value: unknown; names: SetupNames }) {
  if (Array.isArray(value)) {
    return (
      <ul className="setup-values">
        {value.map((each, index) => (
          <li key={index}>
            <CallValue value={each} names={names} />
          </li>
        ))}
      </ul>
    );
  }
  const name = typeof value === "string" ? names.get(value) : undefined;
  if (name !== undefined) {
    return (
      <>
        <span className="setup-name">{name}</span>
        <code className="setup-id">{value as string}</code>
      </>
    );
  }
  return <code>{typeof value === "string" ? value : JSON.stringify(value)}</code>;
}

/** A decided setup change, folded to one slip: what was decided, and what became of it. */
function SetupSlip({ setup, agent, decision }: { setup: SetupApproval; agent: string; decision: SetupDecision }) {
  const copy = strings.setupGalley;
  const read = decision.by === "elsewhere" ? decision.read : undefined;
  const failed = decision.by === "you" && decision.how === "approved" && decision.result !== undefined && decision.result.status >= 400;
  const { headline, tone, text } =
    decision.by === "you"
      ? decision.how === "approved"
        ? failed
          ? { headline: copy.approved, tone: "failed" as const, text: copy.notMade(messageOf(decision.result!.body)) }
          : { headline: copy.approved, tone: "done" as const, text: copy.made(agent) }
        : { headline: strings.outcome.rejected, tone: "rejected" as const, text: copy.unchanged(agent) }
      : read?.state === "withdrawn"
        ? { headline: strings.outcome.withdrawnHead, tone: "rejected" as const, text: copy.withdrawn(agent) }
        : read?.state === "approved"
          ? { headline: strings.outcome.elsewhere, tone: "done" as const, text: copy.made(agent) }
          : read?.state === "rejected"
            ? { headline: strings.outcome.elsewhere, tone: "rejected" as const, text: copy.unchanged(agent) }
            : { headline: strings.outcome.noLongerWaiting, tone: "pending" as const, text: strings.outcome.checking };
  return (
    <article className={`slip slip-${tone}`} aria-live="polite" style={{ viewTransitionName: setupTransitionName(setup) }}>
      <StateIcon tone={tone} />
      <div>
        <h2 className="slip-head">
          {headline} <span className="slip-subject slip-subject-setup">{copy.slipSubject(agent)}</span>
        </h2>
        <p className="slip-result">{text}</p>
        <p className="slip-detail">{setup.preview.join(" ")}</p>
        {decision.by === "you" && decision.how === "rejected" && <p className="slip-note">{strings.outcome.note(decision.note)}</p>}
        {read?.note !== undefined && <p className="slip-note">{strings.outcome.noteFrom(read.note)}</p>}
      </div>
    </article>
  );
}

/** The message in a refusal's body, or the body as it came. */
const messageOf = (body: unknown) => (typeof body === "object" && body !== null && "message" in body && typeof body.message === "string" ? body.message : JSON.stringify(body));

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
