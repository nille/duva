// The People sheet in Settings, for admins: each human as a line saying whether they're an admin and
// how many mailboxes and agents they have, which opens into whether they're an admin, their
// mailboxes, the agents they sponsor, each removed there, and removing the human, which says what
// happens to each of their mailboxes and lists the agents that go with them (ADR-0020). A human
// without a mailbox is given one on the Addresses sheet; agents own none. Adding a human comes last. What a
// change did is said where it happened, in place of what it removed.
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { DuvaClient } from "@duva/client";
import type { components } from "@duva/openapi";
import { ChevronIcon, Choice } from "./setting-parts.tsx";
import { attempt, byText, change, ownersOrder } from "./setup.ts";
import { size, strings } from "./strings.ts";

type Human = components["schemas"]["Human"];
type Agent = components["schemas"]["Agent"];
type Mailbox = components["schemas"]["Mailbox"];
type HumanRemoval = components["schemas"]["HumanRemoval"];

/** The organization's humans, its agents and its mailboxes. */
interface People {
  humans: Human[];
  agents: Agent[];
  mailboxes: Mailbox[];
}

type Read = { status: "loading" } | { status: "failed"; message: string } | { status: "read"; people: People };

const copy = strings.people;

/** The actor's mailboxes, in the order the Addresses sheet numbers them too. */
const mailboxesOf = (owner: string, mailboxes: Mailbox[]) => mailboxes.filter((mailbox) => mailbox.owner === owner).sort(ownersOrder);

/** What a mailbox goes by: its default address, or its place among its owner's when it has none, so two never look the same. */
const mailboxName = (mailbox: Mailbox, ofOwner: Mailbox[]) => mailbox.defaultAddress ?? copy.mailboxWithout(ofOwner.indexOf(mailbox) + 1);

/**
 * The sheet. `me` is the signed-in admin's address. `changes` counts the changes to the
 * organization's setup made on any sheet, and the sheet reads again on each. `onChange` says it made
 * one. `onGiveMailbox` asks the Addresses sheet to create a mailbox for the human.
 */
export function PeopleSheet({
  client,
  me,
  changes,
  onChange,
  onGiveMailbox,
  onSignedOut,
}: {
  client: DuvaClient;
  me: string;
  changes: number;
  onChange: () => void;
  onGiveMailbox: (owner: string) => void;
  onSignedOut: () => void;
}) {
  const [read, setRead] = useState<Read>({ status: "loading" });
  // The humans removed here, each said in place of their line.
  const [gone, setGone] = useState<{ email: string; said: string }[]>([]);
  // The human just added, opened so what was done is said in their line.
  const [added, setAdded] = useState<string>();

  // Read again after a change, the sheet stays as it is while it does, so open lines stay open.
  const load = useCallback(
    async (again = false) => {
      if (!again) setRead({ status: "loading" });
      const answers = await Promise.all([attempt(client.GET("/humans")), attempt(client.GET("/organization/agents")), attempt(client.GET("/organization/mailboxes"))]);
      if (answers.some(({ response }) => response?.status === 401)) return onSignedOut();
      const unread = answers.find(({ data }) => data === undefined);
      if (unread !== undefined) {
        if (!again) setRead({ status: "failed", message: unread.response === undefined ? copy.unreachable : copy.failed(unread.response.status) });
        return;
      }
      const [humans, agents, mailboxes] = answers as [Required<(typeof answers)[0]>, Required<(typeof answers)[1]>, Required<(typeof answers)[2]>];
      setRead({ status: "read", people: { humans: humans.data.humans, agents: agents.data.agents, mailboxes: mailboxes.data.mailboxes } });
    },
    [client, onSignedOut],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (changes > 0) void load(true);
  }, [changes, load]);

  const lines: { email: string; human?: Human; said?: string }[] =
    read.status !== "read"
      ? []
      : [
          ...read.people.humans.map((human) => ({ email: human.email, human })),
          ...gone.filter(({ email }) => !read.people.humans.some((human) => human.email === email)).map(({ email, said }) => ({ email, said })),
        ].sort((a, b) => byText(a.email, b.email));

  return (
    <section className="settings" aria-labelledby="people-settings" aria-busy={read.status === "loading"}>
      <div className="settings-head">
        <h2 id="people-settings">{copy.title}</h2>
        <p>{copy.lead}</p>
      </div>
      {read.status === "failed" ? (
        <div className="setting">
          <div className="notice notice-alert" role="alert">
            <p>{read.message}</p>
            <button type="button" className="button button-small" onClick={() => void load()}>
              {strings.inbox.retry}
            </button>
          </div>
        </div>
      ) : (
        read.status === "read" && (
          <>
            {lines.map((line) =>
              line.human !== undefined ? (
                <HumanLine
                  key={line.email}
                  client={client}
                  human={line.human}
                  people={read.people}
                  me={line.email === me}
                  added={added === line.email}
                  onChanged={onChange}
                  onGiveMailbox={onGiveMailbox}
                  onRemoved={(said) => {
                    setGone((current) => [...current.filter(({ email }) => email !== line.email), { email: line.email, said }]);
                    onChange();
                  }}
                  onSignedOut={onSignedOut}
                />
              ) : (
                <p key={line.email} className="setting-line setting-gone" role="status">
                  {line.said}
                </p>
              ),
            )}
            <AddHuman
              client={client}
              onAdded={(email) => {
                setAdded(email);
                setGone((current) => current.filter((each) => each.email !== email));
                onChange();
              }}
              onSignedOut={onSignedOut}
            />
          </>
        )
      )}
    </section>
  );
}

function HumanLine({
  client,
  human,
  people,
  me,
  added,
  onChanged,
  onGiveMailbox,
  onRemoved,
  onSignedOut,
}: {
  client: DuvaClient;
  human: Human;
  people: People;
  me: boolean;
  /** Whether the human was just added here, so their line opens and says so. */
  added: boolean;
  onChanged: () => void;
  onGiveMailbox: (owner: string) => void;
  /** Hears that the human was removed, and what to say of it. */
  onRemoved: (said: string) => void;
  onSignedOut: () => void;
}) {
  const details = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (added && details.current !== null) details.current.open = true;
  }, [added]);
  const heading = `human-${human.id}`;
  const mailboxes = mailboxesOf(human.id, people.mailboxes);
  // A human's mailbox agent goes with them, so the sheet lists the agents they brought themselves.
  const agents = people.agents.filter(({ sponsor, mailboxAgent }) => sponsor === human.id && !mailboxAgent).sort((a, b) => a.name.localeCompare(b.name));
  const lastAdmin = human.admin && !people.humans.some(({ id, admin }) => admin && id !== human.id);
  const summary = copy.summary([...(me ? [copy.you] : []), ...(human.admin ? [copy.admin] : []), copy.mailboxes(mailboxes.length), copy.agents(agents.length), ...(human.linkedSize ? [copy.linked(size(human.linkedSize))] : [])]);

  return (
    <details className="setting-line" name="people" ref={details}>
      <summary>
        <div className="line-summary">
          <h3 id={heading}>{human.email}</h3>
          <p className="line-summary-text">{summary}</p>
        </div>
        <ChevronIcon />
      </summary>
      <div className="setting" role="group" aria-labelledby={heading}>
        {added && (
          <p className="setting-note" role="status">
            {copy.added(human.email)}
          </p>
        )}
        <AdminPart client={client} human={human} lastAdmin={lastAdmin} onChanged={onChanged} onSignedOut={onSignedOut} />
        <div className="setting-part">
          <h4>{copy.mailboxesTitle}</h4>
          {mailboxes.length === 0 ? (
            <div className="setting-foot">
              <p className="setting-lead">{copy.noMailbox}</p>
              <button type="button" className="button button-small" aria-label={copy.giveMailboxWho(human.email)} onClick={() => onGiveMailbox(human.id)}>
                {copy.giveMailbox}
              </button>
            </div>
          ) : (
            <ul className="person-list" aria-label={copy.mailboxesOf(human.email)}>
              {mailboxes.map((mailbox) => (
                <li key={mailbox.id} className="person-row">
                  <span className="person-name">{mailboxName(mailbox, mailboxes)}</span>
                  {mailbox.addresses.length > 1 && <span className="hint">{copy.moreAddresses(mailbox.addresses.length - 1)}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
        <AgentsPart client={client} human={human} agents={agents} onChanged={onChanged} onSignedOut={onSignedOut} />
        {lastAdmin ? null : <RemoveHuman client={client} human={human} people={people} onRemoved={onRemoved} onSignedOut={onSignedOut} />}
      </div>
    </details>
  );
}

type Acting = { status: "idle" | "busy" } | { status: "failed"; message: string } | { status: "done"; said: string };

/** Whether the human is an admin, made one or not beside it, except that the last admin stays one. */
function AdminPart({ client, human, lastAdmin, onChanged, onSignedOut }: { client: DuvaClient; human: Human; lastAdmin: boolean; onChanged: () => void; onSignedOut: () => void }) {
  const [state, setState] = useState<Acting>({ status: "idle" });
  const heading = useId();
  const set = async (admin: boolean) => {
    setState({ status: "busy" });
    const answer = await change(client.PATCH("/humans/{human}", { params: { path: { human: human.id } }, body: { admin } }), onSignedOut);
    if (answer === undefined) return;
    if ("failed" in answer) return setState({ status: "failed", message: answer.failed });
    setState({ status: "done", said: admin ? copy.madeAdmin(human.email) : copy.tookAdmin(human.email) });
    onChanged();
  };
  return (
    <div className="setting-part" role="group" aria-labelledby={heading}>
      <h4 id={heading}>{copy.admin}</h4>
      <p className="setting-lead">{copy.adminLead}</p>
      {lastAdmin ? (
        <p className="setting-note">{copy.lastAdmin}</p>
      ) : (
        <div className="setting-foot">
          <button type="button" className="button button-small" disabled={state.status === "busy"} onClick={() => void set(!human.admin)}>
            {human.admin ? copy.takeAdmin : copy.makeAdmin}
          </button>
          <p role="status" className="setting-saved">
            {state.status === "done" ? state.said : ""}
          </p>
        </div>
      )}
      {state.status === "failed" && (
        <p className="notice notice-alert" role="alert">
          {state.message}
        </p>
      )}
    </div>
  );
}

/** The agents the human sponsors, and removing each, which asks once in place. */
function AgentsPart({
  client,
  human,
  agents,
  onChanged,
  onSignedOut,
}: {
  client: DuvaClient;
  human: Human;
  agents: Agent[];
  onChanged: () => void;
  onSignedOut: () => void;
}) {
  // The agents removed here, each said in place of its row.
  const [gone, setGone] = useState<{ id: string; name: string }[]>([]);
  const rows: { id: string; name: string; agent?: Agent }[] = [...agents.map((agent) => ({ id: agent.id, name: agent.name, agent })), ...gone.filter(({ id }) => !agents.some((agent) => agent.id === id))].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  return (
    <div className="setting-part">
      <h4>{copy.agentsTitle}</h4>
      {rows.length === 0 ? (
        <p className="setting-lead">{copy.noAgents}</p>
      ) : (
        <ul className="person-list" aria-label={copy.agentsOf(human.email)}>
          {rows.map((row) =>
            row.agent !== undefined ? (
              <AgentRow
                key={row.id}
                client={client}
                agent={row.agent}
                onRemoved={() => {
                  setGone((current) => [...current, { id: row.id, name: row.name }]);
                  onChanged();
                }}
                onSignedOut={onSignedOut}
              />
            ) : (
              <li key={row.id} className="person-row person-gone">
                <p role="status">{copy.removedAgent(row.name)}</p>
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}

type Removing = { status: "idle" | "confirming" | "removing" } | { status: "failed"; message: string };

function AgentRow({
  client,
  agent,
  onRemoved,
  onSignedOut,
}: {
  client: DuvaClient;
  agent: Agent;
  onRemoved: () => void;
  onSignedOut: () => void;
}) {
  const [state, setState] = useState<Removing>({ status: "idle" });
  const remove = async () => {
    setState({ status: "removing" });
    const answer = await change(client.DELETE("/agents/{agent}", { params: { path: { agent: agent.id } } }), onSignedOut);
    if (answer === undefined) return;
    if ("failed" in answer) return setState({ status: "failed", message: answer.failed });
    onRemoved();
  };
  return (
    <li className="person-row">
      <div className="person-line">
        <span className="person-name">{agent.name}</span>
        {agent.paused !== undefined && <span className="label-name">{copy.paused}</span>}
        {state.status !== "confirming" && state.status !== "removing" && (
          <button type="button" className="button button-small button-quiet" aria-label={copy.removeAgentWho(agent.name)} onClick={() => setState({ status: "confirming" })}>
            {copy.remove}
          </button>
        )}
      </div>
      {(state.status === "confirming" || state.status === "removing") && (
        <div className="confirm" role="group" aria-label={copy.removeAgentWho(agent.name)}>
          <p>{copy.removeAgentAsk(agent.name)}</p>
          <div className="confirm-choices">
            <button type="button" className="button button-small button-reject" disabled={state.status === "removing"} onClick={() => void remove()}>
              {copy.removeAgent}
            </button>
            {/* The asking button is gone, so the question takes the focus, on its safe answer. */}
            <button type="button" className="button button-small button-quiet" autoFocus onClick={() => setState({ status: "idle" })}>
              {copy.cancel}
            </button>
          </div>
        </div>
      )}
      {state.status === "failed" && (
        <p className="notice notice-alert" role="alert">
          {state.message}
        </p>
      )}
    </li>
  );
}

type Fate = "handOver" | "delete";
type HumanRemoving = { status: "idle" | "asking" } | { status: "confirming" | "removing"; removal: HumanRemoval } | { status: "failed"; message: string };

/**
 * Removing the human, which asks once in place, from what a dry run says goes with them: what
 * happens to each of their mailboxes, handed over to another human or deleted, and their agents,
 * removed with their mailboxes.
 */
function RemoveHuman({ client, human, people, onRemoved, onSignedOut }: { client: DuvaClient; human: Human; people: People; onRemoved: (said: string) => void; onSignedOut: () => void }) {
  const [state, setState] = useState<HumanRemoving>({ status: "idle" });
  const others = people.humans.filter(({ id }) => id !== human.id).sort((a, b) => byText(a.email, b.email));
  const [handTo, setHandTo] = useState(others[0]?.id ?? "");
  const [fates, setFates] = useState<Record<string, Fate>>({});
  const path = { path: { human: human.id } };
  // A mailbox is handed over unless the admin says otherwise, or there is no one to hand it to.
  const fateOf = (mailbox: Mailbox): Fate => (others.length === 0 ? "delete" : (fates[mailbox.id] ?? "handOver"));
  const receiver = others.find(({ id }) => id === handTo) ?? others[0];

  const ask = async () => {
    setState({ status: "asking" });
    const answer = await change(client.POST("/humans/{human}/remove", { params: path, body: { dryRun: true } }), onSignedOut);
    if (answer === undefined) return;
    if ("failed" in answer) return setState({ status: "failed", message: answer.failed });
    setState({ status: "confirming", removal: answer.data });
  };

  const remove = async (removal: HumanRemoval) => {
    setState({ status: "removing", removal });
    const handOver = removal.mailboxes.filter((mailbox) => fateOf(mailbox) === "handOver");
    const deleted = removal.mailboxes.filter((mailbox) => fateOf(mailbox) === "delete");
    const body = { handOver: handOver.map(({ id }) => id), delete: deleted.map(({ id }) => id), ...(handOver.length > 0 && receiver !== undefined && { handTo: receiver.id }) };
    const answer = await change(client.POST("/humans/{human}/remove", { params: path, body }), onSignedOut);
    if (answer === undefined) return;
    if ("failed" in answer) return setState({ status: "failed", message: answer.failed });
    onRemoved(
      copy.removedHuman(
        human.email,
        receiver?.email,
        handOver.map((mailbox) => mailboxName(mailbox, mailboxesOf(human.id, removal.mailboxes))),
      ),
    );
  };

  if (state.status === "confirming" || state.status === "removing") {
    const removal = { ...state.removal, mailboxes: mailboxesOf(human.id, state.removal.mailboxes) };
    const handedOver = removal.mailboxes.filter((mailbox) => fateOf(mailbox) === "handOver");
    const deleted = removal.mailboxes.filter((mailbox) => fateOf(mailbox) === "delete");
    // A human's mailbox agent goes with them, so only the agents they brought themselves are named.
    const agents = removal.agents.filter(({ mailboxAgent }) => !mailboxAgent).map(({ name }) => name);
    return (
      <div className="confirm person-remove" role="group" aria-label={copy.removeHumanWho(human.email)}>
        <p>{copy.removeHumanAsk(human.email)}</p>
        {removal.mailboxes.length > 0 &&
          (others.length === 0 ? (
            <p>{copy.noOneToHandTo}</p>
          ) : (
            <>
              <p>{copy.removeMailboxesLead}</p>
              {removal.mailboxes.map((mailbox) => (
                <fieldset key={mailbox.id} className="mailbox-fate">
                  <legend>{mailboxName(mailbox, removal.mailboxes)}</legend>
                  <div className="choices-short">
                    {(["handOver", "delete"] as const).map((fate) => (
                      <Choice
                        key={fate}
                        name={`fate-${mailbox.id}`}
                        checked={fateOf(mailbox) === fate}
                        onChoose={() => setFates((current) => ({ ...current, [mailbox.id]: fate }))}
                        label={fate === "handOver" ? copy.handOver : copy.deleteMailbox}
                        hint={fate === "handOver" ? copy.handOverHint : copy.deleteMailboxHint}
                      />
                    ))}
                  </div>
                </fieldset>
              ))}
              {handedOver.length > 0 && (
                <label className="setting-field">
                  <span>{copy.handTo}</span>
                  <select value={receiver?.id} onChange={(event) => setHandTo(event.target.value)}>
                    {others.map((other) => (
                      <option key={other.id} value={other.id}>
                        {other.email}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </>
          ))}
        {deleted.length > 0 && <p className="setting-note">{copy.erased(deleted.map((mailbox) => mailboxName(mailbox, removal.mailboxes)))}</p>}
        {agents.length > 0 && <p className="setting-note">{copy.agentsGo(agents)}</p>}
        <div className="confirm-choices">
          <button type="button" className="button button-small button-reject" disabled={state.status === "removing"} onClick={() => void remove(removal)}>
            {copy.removeHumanWho(human.email)}
          </button>
          {/* The asking button is gone, so the question takes the focus, on its safe answer. */}
          <button
            type="button"
            className="button button-small button-quiet"
            autoFocus
            onClick={() => {
              setState({ status: "idle" });
              setFates({});
            }}
          >
            {copy.cancel}
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="person-remove">
      <div>
        <button type="button" className="button button-small button-quiet" disabled={state.status === "asking"} onClick={() => void ask()}>
          {copy.removeHuman}
        </button>
      </div>
      {state.status === "failed" && (
        <p className="notice notice-alert" role="alert">
          {state.message}
        </p>
      )}
    </div>
  );
}

/** Adding a human by the address they sign in with. Their line opens and says it was done. */
function AddHuman({ client, onAdded, onSignedOut }: { client: DuvaClient; onAdded: (email: string) => void; onSignedOut: () => void }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<{ status: "idle" | "adding" } | { status: "failed"; message: string }>({ status: "idle" });
  const add = async () => {
    setState({ status: "adding" });
    const answer = await change(client.POST("/humans", { body: { email: email.trim() } }), onSignedOut);
    if (answer === undefined) return;
    if ("failed" in answer) return setState({ status: "failed", message: answer.failed });
    setState({ status: "idle" });
    setEmail("");
    onAdded(answer.data.email);
  };
  return (
    <form
      className="setting setting-add"
      aria-labelledby="add-human"
      onSubmit={(event) => {
        event.preventDefault();
        void add();
      }}
    >
      <div className="setting-part">
        <h3 id="add-human">{copy.add}</h3>
        <p className="setting-lead">{copy.addLead}</p>
      </div>
      <label className="setting-field">
        <span>{copy.email}</span>
        <input
          type="text"
          inputMode="email"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder={copy.emailPlaceholder}
          aria-invalid={state.status === "failed"}
          aria-describedby={state.status === "failed" ? "add-human-error" : undefined}
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            if (state.status === "failed") setState({ status: "idle" });
          }}
        />
      </label>
      {state.status === "failed" && (
        <p id="add-human-error" className="field-error" role="alert">
          {state.message}
        </p>
      )}
      <div className="setting-foot">
        <button type="submit" className="button button-primary" disabled={email.trim() === "" || state.status === "adding"}>
          {state.status === "adding" ? copy.adding : copy.addButton}
        </button>
      </div>
    </form>
  );
}
