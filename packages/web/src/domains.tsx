// The Domains sheet in Settings, for admins: each of the organization's domains as a line saying its
// kind, whether SES has verified it and how many of its records DNS lacks, in Alert Red when mail
// can't arrive, which opens into the DNS records to add, each with its status and copy buttons, then
// where sign-in codes come from, the catch-all and removing it. Adding a domain comes last. Duva
// shows the records and checks them, but changes no one's DNS (ADR-0018).
import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import type { DuvaClient } from "@duva/client";
import type { components } from "@duva/openapi";
import { CheckIcon, CopyButton, type Field, moveCopyFocus } from "./dns-parts.tsx";
import { DomainLogoPart } from "./logos.tsx";
import { ChevronIcon, Choice } from "./setting-parts.tsx";
import { attempt, byOwner, change, ownerName } from "./setup.ts";
import { strings } from "./strings.ts";

type Domain = components["schemas"]["Domain"];
type DnsRecord = components["schemas"]["DnsRecord"];
type DomainRemoval = components["schemas"]["DomainRemoval"];
type Mailbox = components["schemas"]["Mailbox"];
type Actor = components["schemas"]["Actor"];
type Group = components["schemas"]["Group"];

/** The organization's domains, and the mailboxes and groups a catch-all can be. */
interface Organization {
  domains: Domain[];
  mailboxes: Mailbox[];
  owners: Actor[];
  groups: Group[];
}

type Read = { status: "loading" } | { status: "failed"; message: string } | { status: "read"; organization: Organization };

const copy = strings.domains;

/**
 * The sheet. `changes` counts the changes to the organization's setup made on any sheet, and the
 * sheet reads again on each. `onChange` says it made one.
 */
export function DomainsSheet({ client, changes, onChange, onSignedOut }: { client: DuvaClient; changes: number; onChange: () => void; onSignedOut: () => void }) {
  const [read, setRead] = useState<Read>({ status: "loading" });
  // The domain just added, opened so its records show.
  const [opened, setOpened] = useState<string>();
  const [done, setDone] = useState("");

  // Read again after a change, the sheet stays as it is while it does, so open lines stay open.
  const load = useCallback(
    async (again = false) => {
      if (!again) setRead({ status: "loading" });
      const answers = await Promise.all([attempt(client.GET("/domains")), attempt(client.GET("/organization/mailboxes")), attempt(client.GET("/groups"))]);
      if (answers.some(({ response }) => response?.status === 401)) return onSignedOut();
      const unread = answers.find(({ data }) => data === undefined);
      if (unread !== undefined) {
        if (!again) setRead({ status: "failed", message: unread.response === undefined ? copy.unreachable : copy.failed(unread.response.status) });
        return;
      }
      const [domains, mailboxes, groups] = answers as [Required<(typeof answers)[0]>, Required<(typeof answers)[1]>, Required<(typeof answers)[2]>];
      setRead({ status: "read", organization: { domains: domains.data.domains, mailboxes: mailboxes.data.mailboxes, owners: mailboxes.data.owners, groups: groups.data.groups } });
    },
    [client, onSignedOut],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (changes > 0) void load(true);
  }, [changes, load]);

  const changed = (said: string) => {
    setDone(said);
    onChange();
  };

  return (
    <section className="settings" aria-labelledby="domain-settings" aria-busy={read.status === "loading"}>
      <div className="settings-head">
        <h2 id="domain-settings">{copy.title}</h2>
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
            <p role="status" className="setting-done">
              {done}
            </p>
            {read.organization.domains.map((domain) => (
              <DomainLine
                key={domain.domain}
                client={client}
                domain={domain}
                organization={read.organization}
                open={opened === domain.domain}
                onChecked={(checked) =>
                  setRead((current) =>
                    current.status !== "read"
                      ? current
                      : { status: "read", organization: { ...current.organization, domains: current.organization.domains.map((each) => (each.domain === checked.domain ? checked : each)) } },
                  )
                }
                onChanged={changed}
                onSignedOut={onSignedOut}
              />
            ))}
            <AddDomain
              client={client}
              standalone={read.organization.domains.filter(({ kind }) => kind === "standalone").map(({ domain }) => domain)}
              onAdded={(domain) => {
                setOpened(domain);
                changed(copy.added(domain));
              }}
              onSignedOut={onSignedOut}
            />
          </>
        )
      )}
    </section>
  );
}

function DomainLine({
  client,
  domain,
  organization,
  open,
  onChecked,
  onChanged,
  onSignedOut,
}: {
  client: DuvaClient;
  domain: Domain;
  organization: Organization;
  open: boolean;
  /** Hears of the domain as Duva checked it again. */
  onChecked: (domain: Domain) => void;
  /** Hears that the organization's domains changed, and what to say of it. */
  onChanged: (said: string) => void;
  onSignedOut: () => void;
}) {
  const details = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (open && details.current !== null) details.current.open = true;
  }, [open]);
  // The logo is read once the line first opens, since each read looks its records up in DNS.
  const [opened, setOpened] = useState(open);
  const heading = `domain-${domain.domain}`;
  const summary = summaryOf(domain, organization);
  const aliases = organization.domains.filter(({ aliasOf }) => aliasOf === domain.domain).map(({ domain }) => domain);
  const signInDomain = organization.domains.find(({ signIn }) => signIn)?.domain;

  return (
    <details className="setting-line" name="domains" ref={details} onToggle={(event) => setOpened(event.currentTarget.open)}>
      <summary>
        <div className="line-summary">
          <h3 id={heading}>{domain.domain}</h3>
          <p className={domain.ses.verified && !summary.receiving ? "line-summary-text line-summary-alert" : "line-summary-text"}>{summary.text}</p>
        </div>
        <ChevronIcon />
      </summary>
      <div className="setting" role="group" aria-labelledby={heading}>
        <Records client={client} domain={domain} onChecked={onChecked} onSignedOut={onSignedOut} />
        <DomainLogoPart client={client} domain={domain.domain} opened={opened} onSignedOut={onSignedOut} />
        <Part title={copy.signIn}>
          <SignIn client={client} domain={domain} current={signInDomain} onChanged={onChanged} onSignedOut={onSignedOut} />
        </Part>
        <Part title={copy.catchAll}>
          {domain.kind === "alias" ? (
            <p className="setting-lead">{copy.catchAllAlias(domain.aliasOf ?? "")}</p>
          ) : (
            <CatchAll client={client} domain={domain} aliases={aliases} organization={organization} onChanged={onChanged} onSignedOut={onSignedOut} />
          )}
        </Part>
        <Remove client={client} domain={domain} organization={organization} onChanged={onChanged} onSignedOut={onSignedOut} />
      </div>
    </details>
  );
}

/**
 * The domain's line: its kind, whether SES has verified it, how many of its records DNS lacks, and
 * whether it sends sign-in codes or has a catch-all, with whether mail can arrive. SES never verifies
 * the receiving record, so mail can arrive once DNS has it.
 */
function summaryOf(domain: Domain, organization: Organization): { text: string; receiving: boolean } {
  const catchAll = domain.catchAll;
  const target =
    catchAll === undefined
      ? undefined
      : catchAll.group !== undefined
        ? catchAll.group
        : (() => {
            const mailbox = organization.mailboxes.find(({ id }) => id === catchAll.mailbox);
            return mailbox === undefined ? undefined : ownerName(mailbox, organization);
          })();
  const missing = domain.records.filter(({ status }) => status === "missing").length;
  const receiving = !domain.records.some(({ purpose, status }) => purpose === "receiving" && status === "missing");
  const text = copy.summary([
    domain.kind === "alias" ? copy.aliasOf(domain.aliasOf ?? "") : copy.standalone,
    !domain.ses.verified ? copy.waiting : receiving ? copy.verified : copy.verifiedForSending,
    ...(missing > 0 ? [copy.missing(missing, receiving)] : []),
    ...(domain.signIn ? [copy.signsIn] : []),
    ...(target !== undefined ? [copy.catchAllTo(target)] : []),
  ]);
  return { text, receiving };
}

/** A part of an opened domain: its name as a Title, then what it holds. */
function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="setting-part" aria-label={title}>
      <h4>{title}</h4>
      {children}
    </section>
  );
}

/**
 * The DNS records the domain needs, each with its status and copy buttons, and checking them again.
 * The copy buttons are one stop in the Tab order, the last one focused, and the arrow keys, Home and
 * End move between them.
 */
function Records({ client, domain, onChecked, onSignedOut }: { client: DuvaClient; domain: Domain; onChecked: (domain: Domain) => void; onSignedOut: () => void }) {
  const [checking, setChecking] = useState<{ status: "idle" | "checking" | "checked" } | { status: "failed"; message: string }>({ status: "idle" });
  // Which copy button is the stop: the record's index, and whether it copies the name or the value.
  const [tabStop, setTabStop] = useState<{ at: number; field: Field }>({ at: 0, field: "name" });
  const keysHint = useId();
  const check = async () => {
    setChecking({ status: "checking" });
    const answer = await change(client.GET("/domains/{domain}", { params: { path: { domain: domain.domain } } }), onSignedOut);
    if (answer === undefined) return;
    if ("failed" in answer) return setChecking({ status: "failed", message: answer.failed });
    setChecking({ status: "checked" });
    onChecked(answer.data);
  };
  return (
    <Part title={copy.records}>
      <p className="setting-lead">{domain.ses.verified ? copy.recordsVerifiedLead : copy.recordsLead}</p>
      <ul className="dns-records" onKeyDown={moveCopyFocus}>
        {domain.records.map((record, index) => (
          <RecordLine
            key={`${record.purpose} ${record.type} ${record.name} ${record.value}`}
            record={record}
            tabStop={Math.min(tabStop.at, domain.records.length - 1) === index ? tabStop.field : undefined}
            keysHint={keysHint}
            onFocus={(field) => setTabStop({ at: index, field })}
          />
        ))}
      </ul>
      <p id={keysHint} className="hint dns-keys">
        {copy.copyKeys}
      </p>
      <div className="setting-foot">
        <button type="button" className="button button-small" disabled={checking.status === "checking"} onClick={() => void check()}>
          {checking.status === "checking" ? copy.checking : copy.checkAgain}
        </button>
        <p role="status" className="setting-saved">
          {checking.status === "checked" ? copy.checked : ""}
        </p>
      </div>
      {checking.status === "failed" && (
        <p className="notice notice-alert" role="alert">
          {checking.message}
        </p>
      )}
    </Part>
  );
}

/**
 * A record, with a copy button for its name and one for its value. `tabStop` says which of them is
 * the records' stop in the Tab order, if either, and `keysHint` names the hint on moving between them.
 */
function RecordLine({ record, tabStop, keysHint, onFocus }: { record: DnsRecord; tabStop?: Field; keysHint: string; onFocus: (field: Field) => void }) {
  const purpose = copy.purpose[record.purpose];
  return (
    <li className="dns-record" aria-label={copy.record(purpose, record.type)}>
      <div className="dns-record-head">
        <span className="dns-purpose">
          {purpose} <span className="dns-type">{record.type}</span>
        </span>
        <span className={`dns-status dns-${record.status}`}>
          {record.status === "verified" && <CheckIcon />}
          {copy.status[record.status]}
        </span>
      </div>
      <dl className="dns-fields">
        <dt>{copy.name}</dt>
        <dd>
          <span className="dns-text">{record.name}</span>
          <CopyButton text={record.name} tabStop={tabStop === "name"} keysHint={keysHint} onFocus={() => onFocus("name")} />
        </dd>
        <dt>{copy.value}</dt>
        <dd>
          <span className="dns-text">{record.value}</span>
          <CopyButton text={record.value} tabStop={tabStop === "value"} keysHint={keysHint} onFocus={() => onFocus("value")} />
        </dd>
      </dl>
      {record.found !== undefined && <p className="hint">{copy.foundInstead(record.found)}</p>}
    </li>
  );
}

/** Where sign-in codes come from, and sending them from this domain once SES has verified it. */
function SignIn({
  client,
  domain,
  current,
  onChanged,
  onSignedOut,
}: {
  client: DuvaClient;
  domain: Domain;
  current?: string;
  onChanged: (said: string) => void;
  onSignedOut: () => void;
}) {
  const [state, setState] = useState<{ status: "idle" | "busy" } | { status: "failed"; message: string }>({ status: "idle" });
  if (domain.signIn) return <p className="setting-lead">{copy.signInHere(domain.domain)}</p>;
  if (!domain.ses.verified) return <p className="setting-lead">{copy.signInWaiting(domain.domain)}</p>;
  const choose = async () => {
    setState({ status: "busy" });
    const answer = await change(client.PATCH("/domains/{domain}", { params: { path: { domain: domain.domain } }, body: { signIn: true } }), onSignedOut);
    if (answer === undefined) return;
    if ("failed" in answer) return setState({ status: "failed", message: answer.failed });
    setState({ status: "idle" });
    onChanged(copy.signInChosen(domain.domain));
  };
  return (
    <>
      {current !== undefined && <p className="setting-lead">{copy.signInElsewhere(current)}</p>}
      <div>
        <button type="button" className="button button-small" disabled={state.status === "busy"} onClick={() => void choose()}>
          {copy.sendSignIn(domain.domain)}
        </button>
      </div>
      {state.status === "failed" && (
        <p className="notice notice-alert" role="alert">
          {state.message}
        </p>
      )}
    </>
  );
}

/** A catch-all's choice in the select: none, a mailbox by its ID, or a group by its address. */
const choiceOf = (catchAll: Domain["catchAll"]) => (catchAll?.mailbox !== undefined ? `mailbox:${catchAll.mailbox}` : catchAll?.group !== undefined ? `group:${catchAll.group}` : "");

function CatchAll({
  client,
  domain,
  aliases,
  organization,
  onChanged,
  onSignedOut,
}: {
  client: DuvaClient;
  domain: Domain;
  aliases: string[];
  organization: Organization;
  onChanged: (said: string) => void;
  onSignedOut: () => void;
}) {
  const saved = choiceOf(domain.catchAll);
  const [chosen, setChosen] = useState(saved);
  // What another change saved, such as deleting the mailbox, replaces what was chosen.
  useEffect(() => setChosen(saved), [saved]);
  const [state, setState] = useState<{ status: "idle" | "saving" | "saved" } | { status: "failed"; message: string }>({ status: "idle" });
  const id = `catch-all-${domain.domain}`;
  const save = async () => {
    setState({ status: "saving" });
    const path = { path: { domain: domain.domain } };
    const [kind, target] = [chosen.slice(0, chosen.indexOf(":")), chosen.slice(chosen.indexOf(":") + 1)];
    const answer = await change<Domain>(
      chosen === "" ? client.DELETE("/domains/{domain}/catch-all", { params: path }) : client.PUT("/domains/{domain}/catch-all", { params: path, body: kind === "mailbox" ? { mailbox: target } : { group: target } }),
      onSignedOut,
    );
    if (answer === undefined) return;
    if ("failed" in answer) return setState({ status: "failed", message: answer.failed });
    setState({ status: "saved" });
    onChanged("");
  };
  return (
    <form
      className="catch-all"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <label htmlFor={id} className="setting-lead">
        {copy.catchAllLead(domain.domain, aliases)}
      </label>
      <select
        id={id}
        value={chosen}
        onChange={(event) => {
          setChosen(event.target.value);
          setState({ status: "idle" });
        }}
      >
        <option value="">{copy.catchAllNone}</option>
        <optgroup label={copy.catchAllMailboxes}>
          {byOwner(organization).map((mailbox) => (
            <option key={mailbox.id} value={`mailbox:${mailbox.id}`}>
              {copy.catchAllMailbox(ownerName(mailbox, organization), mailbox.defaultAddress)}
            </option>
          ))}
        </optgroup>
        {organization.groups.length > 0 && (
          <optgroup label={copy.catchAllGroups}>
            {organization.groups.map((group) => (
              <option key={group.address} value={`group:${group.address}`}>
                {group.address}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      <div className="setting-foot">
        <button type="submit" className="button button-primary" disabled={chosen === saved || state.status === "saving"}>
          {state.status === "saving" ? strings.settings.saving : strings.settings.save}
        </button>
        <p role="status" className="setting-saved">
          {state.status === "saved" ? copy.catchAllSaved : ""}
        </p>
      </div>
      {state.status === "failed" && (
        <p className="notice notice-alert" role="alert">
          {state.message}
        </p>
      )}
    </form>
  );
}

type Removing = { status: "idle" | "asking" } | { status: "confirming"; removal: DomainRemoval } | { status: "removing"; removal: DomainRemoval } | { status: "failed"; message: string };

/**
 * Removing the domain, which asks once in place, listing what goes with it as a dry run says: its
 * alias domains, the addresses that stop getting mail and the mailboxes left without one.
 */
function Remove({ client, domain, organization, onChanged, onSignedOut }: { client: DuvaClient; domain: Domain; organization: Organization; onChanged: (said: string) => void; onSignedOut: () => void }) {
  const [state, setState] = useState<Removing>({ status: "idle" });
  const path = { path: { domain: domain.domain } };
  const named = (id: string) => {
    const mailbox = organization.mailboxes.find((each) => each.id === id);
    return mailbox === undefined ? id : ownerName(mailbox, organization);
  };

  const remove = async (dryRun: boolean) => {
    const removal = state.status === "confirming" ? state.removal : undefined;
    setState(removal === undefined ? { status: "asking" } : { status: "removing", removal });
    const answer = await change(client.POST("/domains/{domain}/remove", { params: path, body: { dryRun } }), onSignedOut);
    if (answer === undefined) return;
    if ("failed" in answer) return setState({ status: "failed", message: answer.failed });
    if (dryRun) return setState({ status: "confirming", removal: answer.data });
    onChanged(copy.removed(answer.data.domains));
  };

  if (state.status === "confirming" || state.status === "removing") {
    const { removal } = state;
    return (
      <div className="confirm domain-remove" role="group" aria-label={copy.remove}>
        <p>{copy.removeAsk(removal.domains)}</p>
        {removal.addresses.length === 0 ? (
          <p>{copy.removeNoAddresses}</p>
        ) : (
          <>
            <p>{copy.removeAddresses}</p>
            <ul className="removed-addresses">
              {removal.addresses.map(({ address, mailbox, group }) => (
                <li key={address}>
                  <span className="removed-address">{address}</span>
                  {group === true ? null : mailbox !== undefined && <span className="hint">{named(mailbox)}</span>}
                </li>
              ))}
            </ul>
          </>
        )}
        {removal.mailboxesLeftWithoutAddress.length > 0 && <p className="setting-note">{copy.removeLeftWithout(removal.mailboxesLeftWithoutAddress.map(named))}</p>}
        <div className="confirm-choices">
          <button type="button" className="button button-small button-reject" disabled={state.status === "removing"} onClick={() => void remove(false)}>
            {copy.removeConfirm}
          </button>
          {/* The asking button is gone, so the question takes the focus, on its safe answer. */}
          <button type="button" className="button button-small button-quiet" autoFocus onClick={() => setState({ status: "idle" })}>
            {copy.cancel}
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="domain-remove">
      <div>
        <button type="button" className="button button-small button-quiet" disabled={state.status === "asking"} onClick={() => void remove(true)}>
          {copy.remove}
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

/** Adding a domain, standalone or as an alias of one of the standalone domains. */
function AddDomain({ client, standalone, onAdded, onSignedOut }: { client: DuvaClient; standalone: string[]; onAdded: (domain: string) => void; onSignedOut: () => void }) {
  const [name, setName] = useState("");
  const [alias, setAlias] = useState(false);
  const [chosenAliasOf, setAliasOf] = useState(standalone[0] ?? "");
  // A standalone domain removed since it was chosen gives way to the first one left.
  const aliasOf = standalone.includes(chosenAliasOf) ? chosenAliasOf : (standalone[0] ?? "");
  const [state, setState] = useState<{ status: "idle" | "adding" } | { status: "failed"; message: string }>({ status: "idle" });
  const add = async () => {
    setState({ status: "adding" });
    const answer = await change(client.POST("/domains", { body: { domain: name.trim(), ...(alias && { aliasOf }) } }), onSignedOut);
    if (answer === undefined) return;
    if ("failed" in answer) return setState({ status: "failed", message: answer.failed });
    setState({ status: "idle" });
    setName("");
    setAlias(false);
    onAdded(answer.data.domain);
  };
  return (
    <form
      className="setting setting-add"
      aria-labelledby="add-domain"
      onSubmit={(event) => {
        event.preventDefault();
        void add();
      }}
    >
      <div className="setting-part">
        <h3 id="add-domain">{copy.add}</h3>
        <p className="setting-lead">{copy.addLead}</p>
      </div>
      <label className="setting-field">
        <span>{copy.domain}</span>
        <input type="text" value={name} placeholder={copy.namePlaceholder} autoCapitalize="none" spellCheck={false} onChange={(event) => setName(event.target.value)} />
      </label>
      <div className="choices-short">
        <Choice name="domain-kind" checked={!alias} onChoose={() => setAlias(false)} label={copy.kindStandalone} hint={copy.kindStandaloneHint} />
        <Choice name="domain-kind" checked={alias} onChoose={() => setAlias(true)} label={copy.kindAlias} hint={copy.kindAliasHint} />
      </div>
      {alias && (
        <label className="setting-field">
          <span>{copy.mirrors}</span>
          <select value={aliasOf} onChange={(event) => setAliasOf(event.target.value)}>
            {standalone.map((domain) => (
              <option key={domain} value={domain}>
                {domain}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="setting-foot">
        <button type="submit" className="button button-primary" disabled={name.trim() === "" || state.status === "adding"}>
          {state.status === "adding" ? copy.adding : copy.addButton}
        </button>
      </div>
      {state.status === "failed" && (
        <p className="notice notice-alert" role="alert">
          {state.message}
        </p>
      )}
    </form>
  );
}
