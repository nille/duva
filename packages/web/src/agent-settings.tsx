// The Agents sheet in Settings: for each agent the human sponsors, its sponsor access to their
// mailbox and the switches for approval and the disclosure's visible line. Each agent is a line
// saying its access and approval, which opens into its form, one at a time. A human who sponsors no
// agents never sees it.
import { useCallback, useEffect, useState } from "react";
import type { DuvaClient } from "@duva/client";
import type { components } from "@duva/openapi";
import { ChevronIcon } from "./setting-parts.tsx";
import { strings } from "./strings.ts";

type Agent = components["schemas"]["Agent"];
type AgentSettings = components["schemas"]["AgentSettings"];
type SponsorAccess = AgentSettings["sponsorAccess"];
type Switch = Exclude<keyof AgentSettings, "sponsorAccess">;

type Read = { status: "loading" } | { status: "failed"; message: string } | { status: "read"; agents: { agent: Agent; settings: AgentSettings }[] };
type Saving = { status: "idle" } | { status: "saving" } | { status: "saved"; lowered: boolean } | { status: "failed"; message: string };

const accesses: SponsorAccess[] = ["none", "read", "full"];

/** The sheet, with a line for each agent the human sponsors that opens into its form, `email` being the human's address. */
export function AgentSettingsSheet({ client, email, onSignedOut }: { client: DuvaClient; email: string; onSignedOut: () => void }) {
  const [read, setRead] = useState<Read>({ status: "loading" });

  const load = useCallback(async () => {
    setRead({ status: "loading" });
    const failed = (response: Response | undefined) =>
      setRead({ status: "failed", message: response === undefined ? strings.agentSettings.unreachable : strings.agentSettings.failed(response.status) });
    const listed = await client.GET("/agents").catch(() => ({ data: undefined, response: undefined }));
    if (listed.response?.status === 401) return onSignedOut();
    if (listed.data === undefined) return failed(listed.response);
    const agents = [...listed.data.agents].sort((a, b) => a.name.localeCompare(b.name));
    const each = await Promise.all(
      agents.map((agent) => client.GET("/agents/{agent}/settings", { params: { path: { agent: agent.id } } }).catch(() => ({ data: undefined, response: undefined }))),
    );
    if (each.some(({ response }) => response?.status === 401)) return onSignedOut();
    const unread = each.find(({ data }) => data === undefined);
    if (unread !== undefined) return failed(unread.response);
    setRead({ status: "read", agents: agents.map((agent, index) => ({ agent, settings: each[index]!.data! })) });
  }, [client, onSignedOut]);

  useEffect(() => {
    void load();
  }, [load]);

  if (read.status === "loading" || (read.status === "read" && read.agents.length === 0)) return null;
  const copy = strings.agentSettings;
  return (
    <section className="settings" aria-labelledby="agent-settings">
      <div className="settings-head">
        <h2 id="agent-settings">{copy.title}</h2>
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
        read.agents.map(({ agent, settings }) => <AgentForm key={agent.id} client={client} agent={agent} saved={settings} email={email} onSignedOut={onSignedOut} />)
      )}
    </section>
  );
}

function AgentForm({ client, agent, saved: first, email, onSignedOut }: { client: DuvaClient; agent: Agent; saved: AgentSettings; email: string; onSignedOut: () => void }) {
  const [saved, setSaved] = useState(first);
  const [chosen, setChosen] = useState(first);
  const [saving, setSaving] = useState<Saving>({ status: "idle" });
  const copy = strings.agentSettings;
  const heading = `agent-${agent.id}`;
  const changed = (Object.keys(chosen) as (keyof AgentSettings)[]).filter((key) => chosen[key] !== saved[key]);
  // Only full access lets an agent send as its sponsor, so only lowering it withdraws what waits.
  const lowers = saved.sponsorAccess === "full" && chosen.sponsorAccess !== "full";

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
    setSaving({ status: "saved", lowered: lowers });
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

  // Details that share a name are open one at a time. A closed one keeps its form, and what was chosen there.
  return (
    <details className="agent-setting" name="agents">
      <summary>
        <div className="agent-summary">
          <h3 id={heading}>{agent.name}</h3>
          <p className="agent-summary-line">{summaryOf(saved)}</p>
        </div>
        <ChevronIcon />
      </summary>
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
        <div className="setting-foot">
          <button type="submit" className="button button-primary" disabled={changed.length === 0 || saving.status === "saving"}>
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

/**
 * The agent's line: its access, and whether its sends wait for approval. Only an agent with full
 * access sends as its sponsor, so only then does that switch count.
 */
function summaryOf(settings: AgentSettings): string {
  const copy = strings.agentSettings.summary;
  const own = settings.approvalForOwnMailbox;
  const asSponsor = settings.sponsorAccess === "full" ? settings.approvalAsSponsor : own;
  const approval = own && asSponsor ? copy.allWait : !own && !asSponsor ? copy.noneWait : own ? copy.ownWait : copy.asSponsorWait;
  return `${copy.access[settings.sponsorAccess]} ${approval}`;
}
