// The Agents sheet in Settings: for each agent the human sponsors, whether it is paused, whether it
// is an admin, its sends waiting for its send limits, and its settings: its sponsor access to their
// mailbox, the switches for approval and the disclosure's visible line, and its send limits up to
// the organization's caps. Each agent is a line saying whether it is paused or an admin, its access
// and approval and what waits, which opens into a link to its activity, its parts and its form, one
// at a time. A human who sponsors no agents never sees it.
import { useCallback, useEffect, useRef, useState } from "react";
import type { DuvaClient } from "@duva/client";
import type { components } from "@duva/openapi";
import { activityHref } from "./activity.tsx";
import { useDates } from "./dates.ts";
import type { AgentMailbox } from "./mailboxes.tsx";
import { SendNow } from "./send-now.tsx";
import { ChevronIcon, wholeNumber } from "./setting-parts.tsx";
import { strings } from "./strings.ts";

type Agent = components["schemas"]["Agent"];
type AgentSettings = components["schemas"]["AgentSettings"];
type Draft = components["schemas"]["Draft"];
type Mailbox = components["schemas"]["Mailbox"];
type SponsorAccess = AgentSettings["sponsorAccess"];
type Switch = Exclude<keyof AgentSettings, "sponsorAccess" | "sendsPerHour" | "newRecipientsPerDay">;
type Limit = "sendsPerHour" | "newRecipientsPerDay";

/** The organization's caps on each limit. */
type Caps = Record<Limit, number>;
/** A send of the agent's that waits for its send limits, and the mailbox its draft is in. */
type Waiting = { mailbox: string; draft: Draft };

type Read =
  | { status: "loading" }
  | { status: "failed"; message: string }
  | { status: "read"; caps: Caps; names: ReadonlyMap<string, string>; agents: { agent: Agent; settings: AgentSettings; waiting: Waiting[] }[] };
type Saving = { status: "idle" } | { status: "saving" } | { status: "saved"; lowered: boolean } | { status: "failed"; message: string };

const accesses: SponsorAccess[] = ["none", "read", "full"];

/**
 * The sheet, with a line for each agent the human sponsors that opens into its parts and form. `me`
 * is the human's ID and `email` their address, `admin` whether they are an admin, `mailboxes` their
 * own and their agents', once listed, and `open` the agent whose line opens first, if any.
 * `onChange` hears when an agent's pause or its sends waiting for its send limits may have changed.
 */
export function AgentSettingsSheet({
  client,
  me,
  email,
  admin,
  mailboxes,
  open,
  onChange,
  onSignedOut,
}: {
  client: DuvaClient;
  me: string;
  email: string;
  admin: boolean;
  mailboxes: { mine?: Mailbox; agents: AgentMailbox[] } | undefined;
  open?: string;
  onChange?: () => void;
  onSignedOut: () => void;
}) {
  const [read, setRead] = useState<Read>({ status: "loading" });
  // The mailboxes are listed anew with each render, so the sheet reads again only when they are others.
  const listed = useRef(mailboxes);
  listed.current = mailboxes;
  const searchedKey = mailboxes === undefined ? undefined : [mailboxes.mine?.id, ...mailboxes.agents.map(({ mailbox }) => mailbox.id)].join();

  // An agent's sends wait in its own mailboxes, and in the human's when it sends as them. A list Duva can't give now shows none.
  const readWaiting = useCallback(async (): Promise<(agent: string) => Waiting[]> => {
    const mailboxes = listed.current;
    const searched = mailboxes === undefined ? [] : [...(mailboxes.mine === undefined ? [] : [mailboxes.mine]), ...mailboxes.agents.map(({ mailbox }) => mailbox)];
    const drafts = await Promise.all(
      searched.map(async (mailbox) => {
        const { data } = await client.GET("/mailboxes/{mailbox}/drafts", { params: { path: { mailbox: mailbox.id } } }).catch(() => ({ data: undefined }));
        return (data?.drafts ?? []).filter((draft) => draft.send?.state === "waitingForLimit").map((draft) => ({ mailbox, draft }));
      }),
    );
    return (agent) =>
      drafts
        .flat()
        .filter(({ mailbox, draft }) => (mailbox.owner === me ? draft.updatedBy === agent : mailbox.owner === agent))
        .map(({ mailbox, draft }) => ({ mailbox: mailbox.id, draft }));
  }, [client, me]);

  const load = useCallback(async () => {
    const mailboxes = listed.current;
    if (searchedKey === undefined || mailboxes === undefined) return;
    setRead({ status: "loading" });
    const failed = (response: Response | undefined) =>
      setRead({ status: "failed", message: response === undefined ? strings.agentSettings.unreachable : strings.agentSettings.failed(response.status) });
    const quietly = <T,>(call: Promise<T>) => call.catch(() => ({ data: undefined, response: undefined }));
    const [agentList, organization, humans] = await Promise.all([
      quietly(client.GET("/agents")),
      quietly(client.GET("/organization/settings")),
      // Only admins list the humans, so only they see which admin paused an agent.
      admin ? quietly(client.GET("/humans")) : Promise.resolve({ data: undefined, response: undefined }),
    ]);
    if (agentList.response?.status === 401 || organization.response?.status === 401) return onSignedOut();
    if (agentList.data === undefined) return failed(agentList.response);
    if (organization.data === undefined) return failed(organization.response);
    const agents = [...agentList.data.agents].sort((a, b) => a.name.localeCompare(b.name));
    const each = await Promise.all(agents.map((agent) => quietly(client.GET("/agents/{agent}/settings", { params: { path: { agent: agent.id } } }))));
    if (each.some(({ response }) => response?.status === 401)) return onSignedOut();
    const unread = each.find(({ data }) => data === undefined);
    if (unread !== undefined) return failed(unread.response);
    const waitingFor = await readWaiting();
    const names = new Map<string, string>([...(humans.data?.humans.map((human) => [human.id, human.email] as const) ?? []), ...agents.map((agent) => [agent.id, agent.name] as const)]);
    const caps = { sendsPerHour: organization.data.agentSendsPerHourCap, newRecipientsPerDay: organization.data.agentNewRecipientsPerDayCap };
    setRead({ status: "read", caps, names, agents: agents.map((agent, index) => ({ agent, settings: each[index]!.data!, waiting: waitingFor(agent.id) })) });
  }, [client, admin, searchedKey, readWaiting, onSignedOut]);

  useEffect(() => {
    void load();
  }, [load]);

  if (read.status === "read" && read.agents.length === 0) return null;
  const copy = strings.agentSettings;
  // The sheet's title shows while its agents are read, so the page it is on has a heading to take the focus.
  return (
    <section className="settings" aria-labelledby="agent-settings">
      <div className="settings-head">
        <h2 id="agent-settings">{copy.title}</h2>
        <p>{copy.lead}</p>
      </div>
      {read.status === "loading" ? null : read.status === "failed" ? (
        <div className="setting">
          <div className="notice notice-alert" role="alert">
            <p>{read.message}</p>
            <button type="button" className="button button-small" onClick={() => void load()}>
              {strings.inbox.retry}
            </button>
          </div>
        </div>
      ) : (
        read.agents.map(({ agent, settings, waiting }) => (
          <AgentForm
            key={agent.id}
            client={client}
            agent={agent}
            saved={settings}
            waiting={waiting}
            caps={read.caps}
            whoPaused={(by) => (by === me ? copy.pause.you : by === "duva" ? copy.pause.duva : (read.names.get(by) ?? copy.pause.anAdmin))}
            email={email}
            admin={admin}
            open={open === agent.id}
            readWaiting={async () => (await readWaiting())(agent.id)}
            onChange={onChange}
            onSignedOut={onSignedOut}
          />
        ))
      )}
    </section>
  );
}

/**
 * An agent's line, and what it opens into. `admin` is whether the sponsor is an admin, and
 * `readWaiting` reads the agent's sends waiting for its send limits again, as after its pause.
 */
function AgentForm({
  client,
  agent: first,
  saved: firstSaved,
  waiting: firstWaiting,
  caps,
  whoPaused,
  email,
  admin,
  open,
  readWaiting,
  onChange,
  onSignedOut,
}: {
  client: DuvaClient;
  agent: Agent;
  saved: AgentSettings;
  waiting: Waiting[];
  caps: Caps;
  whoPaused: (by: string) => string;
  email: string;
  admin: boolean;
  open: boolean;
  readWaiting: () => Promise<Waiting[]>;
  onChange?: () => void;
  onSignedOut: () => void;
}) {
  const [agent, setAgent] = useState(first);
  const [waiting, setWaiting] = useState(firstWaiting);
  const [saved, setSaved] = useState(firstSaved);
  const [chosen, setChosen] = useState(firstSaved);
  // The limits as typed, which may not be numbers Duva takes yet.
  const [typed, setTyped] = useState<Record<Limit, string>>({ sendsPerHour: String(firstSaved.sendsPerHour), newRecipientsPerDay: String(firstSaved.newRecipientsPerDay) });
  const [saving, setSaving] = useState<Saving>({ status: "idle" });
  // The sends Send now sent from here, which wait no more.
  const [sentNow, setSentNow] = useState<ReadonlySet<string>>(new Set());
  const stillWaiting = waiting.filter(({ draft }) => !sentNow.has(draft.id)).length;
  const copy = strings.agentSettings;
  const heading = `agent-${agent.id}`;
  const changed = (Object.keys(chosen) as (keyof AgentSettings)[]).filter((key) => chosen[key] !== saved[key]);
  const invalid = (["sendsPerHour", "newRecipientsPerDay"] as const).some((limit) => wholeNumber(typed[limit], caps[limit]) === undefined);
  // Only full access lets an agent send as its sponsor, so only lowering it withdraws what waits.
  const lowers = saved.sponsorAccess === "full" && chosen.sponsorAccess !== "full";

  // The line an alert or the index opens comes open, in view, and takes the focus from the sheet's title.
  const details = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (!open || details.current === null) return;
    details.current.open = true;
    details.current.scrollIntoView({ block: "start" });
    details.current.querySelector("summary")?.focus({ preventScroll: true });
  }, [open]);

  const save = async () => {
    setSaving({ status: "saving" });
    const body = Object.fromEntries(changed.map((key) => [key, chosen[key]]));
    const { data, response } = await client
      .PATCH("/agents/{agent}/settings", { params: { path: { agent: agent.id } }, body })
      .catch(() => ({ data: undefined, response: undefined }));
    if (response?.status === 401) return onSignedOut();
    if (data === undefined) {
      const message = response === undefined ? copy.saveUnreachable : response.status === 409 ? copy.noMailbox : strings.settings.saveFailed(response.status);
      return setSaving({ status: "failed", message });
    }
    setSaved(data);
    setChosen(data);
    setTyped({ sendsPerHour: String(data.sendsPerHour), newRecipientsPerDay: String(data.newRecipientsPerDay) });
    setSaving({ status: "saved", lowered: lowers });
    // Higher limits let sends that waited go out.
    if (changed.includes("sendsPerHour") || changed.includes("newRecipientsPerDay")) void reread({ settle: true });
  };

  // What waits is read again once the agent's pause or limits changed, since sends go out by themselves then.
  // The sender takes them a moment after Duva answers, so when they may go, they are read twice more while
  // any still wait. Only the latest reading shows, and none once the line is gone.
  const reading = useRef(0);
  useEffect(() => () => void (reading.current += 1), []);
  const reread = async ({ settle }: { settle: boolean }) => {
    const mine = ++reading.current;
    for (const after of settle ? [0, 2_000, 6_000] : [0]) {
      if (after > 0) await new Promise((resolve) => setTimeout(resolve, after));
      if (reading.current !== mine) return;
      const fresh = await readWaiting();
      if (reading.current !== mine) return;
      setWaiting(fresh);
      setSentNow(new Set());
      onChange?.();
      if (fresh.length === 0) return;
    }
  };

  const choose = (changes: Partial<AgentSettings>) => {
    setChosen((current) => ({ ...current, ...changes }));
    setSaving({ status: "idle" });
  };

  const toggle = (key: Switch, name: string, hint: string) => (
    <label className="choice" key={key}>
      <input type="checkbox" checked={chosen[key]} onChange={(event) => choose({ [key]: event.target.checked })} />
      <span className="choice-text">
        <span className="choice-name">{name}</span>
        <span className="hint">{hint}</span>
      </span>
    </label>
  );

  const limitField = (limit: Limit, label: string, hint?: string) => {
    const id = `${heading}-${limit}`;
    const valid = wholeNumber(typed[limit], caps[limit]) !== undefined;
    return (
      <div className="limit">
        <label htmlFor={id} className="limit-name">
          {label}
        </label>
        <input
          id={id}
          type="text"
          inputMode="numeric"
          aria-describedby={`${id}-hint`}
          aria-invalid={!valid}
          value={typed[limit]}
          onChange={(event) => {
            const text = event.target.value;
            setTyped((current) => ({ ...current, [limit]: text }));
            const value = wholeNumber(text, caps[limit]);
            if (value !== undefined) choose({ [limit]: value });
            else setSaving({ status: "idle" });
          }}
        />
        <p id={`${id}-hint`} className={valid ? "hint" : "field-error"}>
          {valid ? [hint, copy.limits.upTo(caps[limit])].filter(Boolean).join(" ") : copy.limits.invalid(caps[limit])}
        </p>
      </div>
    );
  };

  // Details that share a name are open one at a time. A closed one keeps its form, and what was chosen there.
  return (
    <details className="agent-setting" name="agents" ref={details}>
      <summary>
        <div className="agent-summary">
          <div className="agent-summary-head">
            <h3 id={heading}>{agent.name}</h3>
            {agent.paused !== undefined && (
              <span className="line-mark">
                <PauseIcon />
                {copy.pause.mark}
              </span>
            )}
            {agent.admin && (
              <span className="line-mark">
                <KeyIcon />
                {copy.admin.mark}
              </span>
            )}
          </div>
          {agent.paused !== undefined && <PausedLine paused={agent.paused} who={whoPaused(agent.paused.by)} />}
          <p className="agent-summary-line">{summaryOf(saved, agent.admin)}</p>
          {stillWaiting > 0 && <p className="agent-summary-line">{copy.waiting.count(stillWaiting)}</p>}
        </div>
        <ChevronIcon />
      </summary>
      <p className="agent-activity">
        <a href={activityHref(agent.id)}>{strings.activity.title(agent.name)}</a>
      </p>
      <div className="agent-parts">
        <PausePart
          client={client}
          agent={agent}
          onChanged={(changed) => {
            setAgent(changed);
            void reread({ settle: changed.paused === undefined });
          }}
          onSignedOut={onSignedOut}
        />
        <AdminPart client={client} agent={agent} sponsorIsAdmin={admin} onChanged={setAgent} onSignedOut={onSignedOut} />
        {waiting.length > 0 && (
          <WaitingPart
            client={client}
            agent={agent}
            waiting={waiting}
            onSent={(draft) => {
              setSentNow((current) => new Set([...current, draft]));
              onChange?.();
            }}
            onSignedOut={onSignedOut}
          />
        )}
      </div>
      <form
        className="setting"
        aria-labelledby={heading}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <fieldset>
          <legend>{copy.access.legend}</legend>
          <p className="setting-lead">{copy.access.lead}</p>
          {accesses.map((access) => (
            <label className="choice" key={access}>
              <input type="radio" name={`${heading}-access`} checked={chosen.sponsorAccess === access} onChange={() => choose({ sponsorAccess: access })} />
              <span className="choice-text">
                <span className="choice-name">{copy.access[access]}</span>
                <span className="hint">{copy.access.hints[access]}</span>
              </span>
            </label>
          ))}
          {lowers && <p className="setting-note">{copy.access.lowering}</p>}
        </fieldset>
        <fieldset>
          <legend>{copy.asSponsor.legend}</legend>
          {toggle("approvalAsSponsor", copy.asSponsor.approval, copy.asSponsor.approvalHint)}
          {toggle("disclosureLineAsSponsor", copy.line, copy.lineHint(agent.name, email))}
        </fieldset>
        <fieldset>
          <legend>{copy.ownMailbox.legend}</legend>
          {toggle("approvalForOwnMailbox", copy.ownMailbox.approval, copy.ownMailbox.approvalHint)}
          {toggle("disclosureLineForOwnMailbox", copy.line, copy.lineHint(agent.name, email))}
        </fieldset>
        {agent.admin && (
          <fieldset>
            <legend>{copy.setup.legend}</legend>
            {toggle("approvalForSetup", copy.setup.approval, copy.setup.approvalHint)}
          </fieldset>
        )}
        <fieldset>
          <legend>{copy.limits.legend}</legend>
          <p className="setting-lead">{copy.limits.lead}</p>
          <div className="limits">
            {limitField("sendsPerHour", copy.limits.perHour)}
            {limitField("newRecipientsPerDay", copy.limits.newPerDay, copy.limits.newPerDayHint)}
          </div>
        </fieldset>
        <div className="setting-foot">
          <button type="submit" className="button button-primary" disabled={changed.length === 0 || invalid || saving.status === "saving"}>
            {saving.status === "saving" ? strings.settings.saving : strings.settings.save}
          </button>
          <p role="status" className="setting-saved">
            {saving.status === "saved" ? (saving.lowered ? copy.savedLowered : copy.saved) : ""}
          </p>
        </div>
        {saving.status === "failed" && (
          <p className="notice notice-alert" role="alert">
            {saving.message}
          </p>
        )}
      </form>
    </details>
  );
}

/** Who paused the agent and since when, and why if Duva did. */
function PausedLine({ paused, who }: { paused: NonNullable<Agent["paused"]>; who: string }) {
  const { when } = useDates();
  return <p className="paused-line">{[strings.agentSettings.pause.by(who, when(new Date(paused.at))), paused.reason].filter(Boolean).join(" ")}</p>;
}

/** Pause or Unpause, with what each does. Its answer is the agent as it is then. */
function PausePart({ client, agent, onChanged, onSignedOut }: { client: DuvaClient; agent: Agent; onChanged: (agent: Agent) => void; onSignedOut: () => void }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  const copy = strings.agentSettings.pause;
  const paused = agent.paused !== undefined;
  const id = `pause-${agent.id}`;

  const change = async () => {
    setBusy(true);
    setProblem(undefined);
    const path = { params: { path: { agent: agent.id } } };
    const { data, response } = await (paused ? client.POST("/agents/{agent}/unpause", path) : client.POST("/agents/{agent}/pause", path)).catch(() => ({ data: undefined, response: undefined }));
    setBusy(false);
    if (response?.status === 401) return onSignedOut();
    // A human's pause takes effect at once, so its answer is the agent.
    if (data !== undefined && "kind" in data) return onChanged(data);
    setProblem(response === undefined ? copy.unreachable : copy.failed(response.status));
  };

  return (
    <section className="setting-part pause-part" aria-labelledby={id}>
      <h4 id={id}>{copy.title}</h4>
      <div className="pause-row">
        <p className="setting-lead">{paused ? copy.held : copy.running}</p>
        <button type="button" className="button button-small" disabled={busy} onClick={() => void change()}>
          {busy ? (paused ? copy.unpausing : copy.pausing) : paused ? copy.unpause : copy.pause}
        </button>
      </div>
      {problem !== undefined && (
        <p className="notice notice-alert" role="alert">
          {problem}
        </p>
      )}
    </section>
  );
}

/**
 * Make it an admin, or take that away, with what being one means. Only an admin makes an agent one,
 * and any sponsor takes it away. Its answer is the agent as it is then.
 */
function AdminPart({
  client,
  agent,
  sponsorIsAdmin,
  onChanged,
  onSignedOut,
}: {
  client: DuvaClient;
  agent: Agent;
  sponsorIsAdmin: boolean;
  onChanged: (agent: Agent) => void;
  onSignedOut: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  const copy = strings.agentSettings.admin;
  const id = `admin-${agent.id}`;
  const offered = agent.admin || sponsorIsAdmin;

  const change = async () => {
    setBusy(true);
    setProblem(undefined);
    const { data, response } = await client
      .PATCH("/agents/{agent}", { params: { path: { agent: agent.id } }, body: { admin: !agent.admin } })
      .catch(() => ({ data: undefined, response: undefined }));
    setBusy(false);
    if (response?.status === 401) return onSignedOut();
    if (data !== undefined) return onChanged(data);
    setProblem(response === undefined ? copy.unreachable : copy.failed(response.status));
  };

  return (
    <section className="setting-part" aria-labelledby={id}>
      <h4 id={id}>{copy.title}</h4>
      <div className="pause-row">
        <p className="setting-lead">{agent.admin ? copy.is : sponsorIsAdmin ? copy.isNot : copy.onlyAdmins}</p>
        {offered && (
          <button type="button" className="button button-small" disabled={busy} onClick={() => void change()}>
            {busy ? (agent.admin ? copy.takingAway : copy.making) : agent.admin ? copy.takeAway : copy.make}
          </button>
        )}
      </div>
      {problem !== undefined && (
        <p className="notice notice-alert" role="alert">
          {problem}
        </p>
      )}
    </section>
  );
}

/**
 * The agent's sends that wait for its send limits, oldest first, each with Send now. While the agent
 * is paused they are held, so Send now is disabled, saying why. `onSent` hears of each draft that
 * waits no more, sent now or gone meanwhile.
 */
function WaitingPart({ client, agent, waiting, onSent, onSignedOut }: { client: DuvaClient; agent: Agent; waiting: Waiting[]; onSent: (draft: string) => void; onSignedOut: () => void }) {
  const copy = strings.agentSettings.waiting;
  const id = `waiting-${agent.id}`;
  const lead = `${id}-lead`;
  const paused = agent.paused !== undefined;
  const oldestFirst = [...waiting].sort((a, b) => a.draft.updatedAt.localeCompare(b.draft.updatedAt));
  return (
    <section className="setting-part" aria-labelledby={id}>
      <h4 id={id}>{copy.title}</h4>
      <p className="setting-lead" id={lead}>
        {paused ? copy.held(agent.name) : copy.lead}
      </p>
      <ul className="waiting-sends">
        {oldestFirst.map(({ mailbox, draft }) => (
          <li key={draft.id} className="waiting-send">
            <div className="waiting-send-text">
              <p className="waiting-send-subject">{draft.subject || copy.noSubject}</p>
              <p className="waiting-send-to">{copy.to(draft.to.map(({ address }) => address).join(", "))}</p>
            </div>
            {paused ? (
              <div className="send-now">
                <button type="button" className="button button-small" disabled aria-describedby={lead}>
                  {strings.sendNow.send}
                </button>
              </div>
            ) : (
              <SendNow client={client} mailbox={mailbox} draft={draft.id} onSent={() => onSent(draft.id)} onSignedOut={onSignedOut} />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

// A key, for the setup an agent admin may change.
const KeyIcon = () => (
  <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M7.5 8a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0ZM7.5 8h6M11.5 8v2M13.5 8v2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const PauseIcon = () => (
  <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M6 4v8M10 4v8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

/**
 * The agent's line: its access, and whether its sends wait for approval, and for an admin its setup
 * changes too. Only an agent with full access sends as its sponsor, so only then does that switch count.
 */
function summaryOf(settings: AgentSettings, admin: boolean): string {
  const copy = strings.agentSettings.summary;
  const own = settings.approvalForOwnMailbox;
  const asSponsor = settings.sponsorAccess === "full" ? settings.approvalAsSponsor : own;
  const sends = own && asSponsor ? "all" : !own && !asSponsor ? "none" : own ? "own" : "asSponsor";
  const approval =
    admin && sends === "all" && settings.approvalForSetup
      ? copy.allAndSetupWait
      : [{ all: copy.allWait, none: copy.noneWait, own: copy.ownWait, asSponsor: copy.asSponsorWait }[sends], ...(admin ? [settings.approvalForSetup ? copy.setupWaits : copy.setupGoes] : [])].join(" ");
  return `${copy.access[settings.sponsorAccess]} ${approval}`;
}
