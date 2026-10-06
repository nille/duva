// The Addresses sheet in Settings, for admins: each mailbox in the organization as a line with its
// owner and default address, which opens into its addresses, across every domain, each made the
// default or removed there, and a field to add another. A mailbox without an address says so, and
// an owner's mailboxes say which of theirs each is. What a change did is said in its address's row,
// or in place of the row it removed. Creating a mailbox for any human or agent closes the sheet, and
// the People sheet opens it with the owner chosen.
import { useCallback, useEffect, useRef, useState } from "react";
import type { DuvaClient } from "@duva/client";
import type { components } from "@duva/openapi";
import { ChevronIcon } from "./setting-parts.tsx";
import { type Answer, attempt, byOwner, byText, change, isAgents, type Mailboxes, ownerName } from "./setup.ts";
import { strings } from "./strings.ts";

type Mailbox = components["schemas"]["Mailbox"];
type Actor = components["schemas"]["Actor"];

/** An actor a mailbox can be created for: their name, a human's address or an agent's, and what the form calls them. */
interface Owner {
  id: string;
  kind: Actor["kind"];
  name: string;
  label: string;
}

type Read = { status: "loading" } | { status: "failed"; message: string } | { status: "read"; listed: Mailboxes; domains: string[]; owners: Owner[] };

/** The owner the People sheet asked to give a mailbox to, once each time it asks. */
export interface Giving {
  owner: string;
  asked: number;
}

const copy = strings.addresses;

/**
 * The sheet. `changes` counts the changes to the organization's setup made on any sheet, and the
 * sheet reads again on each. `onChange` says it made one. `giving` brings the form to create a
 * mailbox into view, with its owner chosen.
 */
export function AddressesSheet({
  client,
  changes,
  giving,
  onChange,
  onSignedOut,
}: {
  client: DuvaClient;
  changes: number;
  giving?: Giving;
  onChange: () => void;
  onSignedOut: () => void;
}) {
  const [read, setRead] = useState<Read>({ status: "loading" });
  // The mailbox just created, opened so what was done is said in its line.
  const [created, setCreated] = useState<{ id: string; said: string }>();

  // Read again after a change, the sheet stays as it is while it does, so the open line stays open.
  const load = useCallback(
    async (again = false) => {
      if (!again) setRead({ status: "loading" });
      const [mailboxes, domains, humans, agents] = await Promise.all([
        attempt(client.GET("/organization/mailboxes")),
        attempt(client.GET("/domains")),
        attempt(client.GET("/humans")),
        attempt(client.GET("/organization/agents")),
      ]);
      const answers = [mailboxes, domains, humans, agents];
      if (answers.some(({ response }) => response?.status === 401)) return onSignedOut();
      const unread = answers.find(({ data }) => data === undefined);
      if (unread !== undefined) {
        if (!again) setRead({ status: "failed", message: unread.response === undefined ? copy.unreachable : copy.failed(unread.response.status) });
        return;
      }
      setRead({
        status: "read",
        listed: mailboxes.data!,
        domains: domains.data!.domains.filter(({ kind }) => kind === "standalone").map(({ domain }) => domain),
        // Humans by address, then agents by name, each agent with its sponsor, since two can share a name.
        owners: [
          ...humans.data!.humans.map(({ id, email }) => ({ id, kind: "human" as const, name: email, label: email })).sort((a, b) => byText(a.name, b.name)),
          ...agents
            .data!.agents.map(({ id, name, sponsor }) => ({ id, kind: "agent" as const, name, label: copy.agentWithSponsor(name, humans.data!.humans.find((human) => human.id === sponsor)?.email) }))
            .sort((a, b) => a.label.localeCompare(b.label)),
        ],
      });
    },
    [client, onSignedOut],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (changes > 0) void load(true);
  }, [changes, load]);

  return (
    <section className="settings" aria-labelledby="address-settings" aria-busy={read.status === "loading"}>
      <div className="settings-head">
        <h2 id="address-settings">{copy.title}</h2>
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
        read.status === "read" &&
        byOwner(read.listed).map((mailbox, _, all) => {
          // An owner with several mailboxes, as a human handed another's has, says which of theirs each is.
          const owners = all.filter(({ owner }) => owner === mailbox.owner);
          return (
            <MailboxLine
              key={mailbox.id}
              client={client}
              mailbox={mailbox}
              owner={ownerName(mailbox, read.listed)}
              agent={isAgents(mailbox, read.listed)}
              place={owners.length > 1 ? { at: owners.indexOf(mailbox) + 1, of: owners.length } : undefined}
              domains={read.domains}
              created={created?.id === mailbox.id ? created.said : undefined}
              onChanged={onChange}
              onSignedOut={onSignedOut}
            />
          );
        })
      )}
      {read.status === "read" && (
        <CreateMailbox
          client={client}
          owners={read.owners}
          domains={read.domains}
          giving={giving}
          onCreated={(mailbox, owner) => {
            setCreated({ id: mailbox.id, said: copy.created(owner, mailbox.defaultAddress ?? mailbox.addresses.join(", ")) });
            onChange();
          }}
          onSignedOut={onSignedOut}
        />
      )}
    </section>
  );
}

function MailboxLine({
  client,
  mailbox,
  owner,
  agent,
  place,
  domains,
  created,
  onChanged,
  onSignedOut,
}: {
  client: DuvaClient;
  mailbox: Mailbox;
  owner: string;
  agent: boolean;
  /** Which of its owner's mailboxes it is, when they have several. */
  place?: { at: number; of: number };
  domains: string[];
  /** What creating the mailbox did, when it was just created here, so its line opens and says so. */
  created?: string;
  onChanged: () => void;
  onSignedOut: () => void;
}) {
  const details = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (created !== undefined && details.current !== null) details.current.open = true;
  }, [created]);
  // What the last change did, said in the row of the address it was about, or where that row was.
  const [done, setDone] = useState<{ address: string; said: string; at: number }>();
  const heading = `mailbox-${mailbox.id}`;
  const addresses = mailbox.addresses;
  const summary = mailbox.defaultAddress === undefined ? copy.none : copy.summary(mailbox.defaultAddress, addresses.length - 1);
  const changed = (address: string, said: string) => {
    setDone({ address, said, at: Math.max(0, addresses.indexOf(address)) });
    onChanged();
  };
  const rows: { address: string; gone?: boolean }[] = addresses.map((address) => ({ address }));
  if (done !== undefined && !addresses.includes(done.address)) rows.splice(Math.min(done.at, rows.length), 0, { address: done.address, gone: true });
  return (
    <details className="setting-line" name="mailboxes" ref={details}>
      <summary>
        <div className="line-summary">
          <h3 id={heading}>{owner}</h3>
          <p className="line-summary-text">{copy.line(agent, summary, place)}</p>
        </div>
        <ChevronIcon />
      </summary>
      <div className="setting" role="group" aria-labelledby={heading}>
        {created !== undefined && done === undefined && (
          <p className="setting-note" role="status">
            {created}
          </p>
        )}
        {rows.length === 0 ? (
          <p className="setting-note">{copy.none}</p>
        ) : (
          <>
            <ul className="mailbox-addresses" aria-label={copy.listName(owner)}>
              {rows.map(({ address, gone }) =>
                gone ? (
                  <li key={`gone-${address}`} className="mailbox-address-row person-gone">
                    <p role="status">{done!.said}</p>
                  </li>
                ) : (
                  <AddressRow
                    key={address}
                    client={client}
                    mailbox={mailbox}
                    address={address}
                    said={done?.address === address ? done.said : undefined}
                    onChanged={(said) => changed(address, said)}
                    onSignedOut={onSignedOut}
                  />
                ),
              )}
            </ul>
            {addresses.length > 0 && <p className="hint">{copy.defaultHint}</p>}
          </>
        )}
        {addresses.length === 0 && rows.length > 0 && <p className="setting-note">{copy.none}</p>}
        <AddAddress client={client} mailbox={mailbox} domains={domains} onAdded={(address) => changed(address, copy.added(address))} onSignedOut={onSignedOut} />
      </div>
    </details>
  );
}

type RowState = { status: "idle" | "confirming" | "busy" } | { status: "failed"; message: string };

/** One of the mailbox's addresses: the default one marked, any other made the default, and removing it, which asks once in place. */
function AddressRow({
  client,
  mailbox,
  address,
  said,
  onChanged,
  onSignedOut,
}: {
  client: DuvaClient;
  mailbox: Mailbox;
  address: string;
  /** What the last change to the address did, if it was the last one changed. */
  said?: string;
  onChanged: (said: string) => void;
  onSignedOut: () => void;
}) {
  const [state, setState] = useState<RowState>({ status: "idle" });
  const isDefault = mailbox.defaultAddress === address;
  // Removing the default address makes the earliest other one the default.
  const next = mailbox.addresses.find((each) => each !== address);

  const act = async (call: Promise<Answer<unknown>>, said: string) => {
    setState({ status: "busy" });
    const answer = await change(call, onSignedOut);
    if (answer === undefined) return;
    if ("failed" in answer) return setState({ status: "failed", message: answer.failed });
    setState({ status: "idle" });
    onChanged(said);
  };
  const makeDefault = () => act(client.PATCH("/mailboxes/{mailbox}", { params: { path: { mailbox: mailbox.id } }, body: { defaultAddress: address } }), copy.defaultChosen(address));
  const remove = () => act(client.DELETE("/addresses/{address}", { params: { path: { address } } }), copy.removed(address));

  return (
    <li className="mailbox-address-row">
      <div className="mailbox-address-line">
        <span className="mailbox-address-name">{address}</span>
        {isDefault ? (
          <span className="label-name">{copy.default}</span>
        ) : (
          <button type="button" className="button button-small" aria-label={copy.makeDefaultOf(address)} disabled={state.status === "busy"} onClick={() => void makeDefault()}>
            {copy.makeDefault}
          </button>
        )}
        {state.status !== "confirming" && (
          <button type="button" className="button button-small button-quiet" aria-label={copy.removeWho(address)} disabled={state.status === "busy"} onClick={() => setState({ status: "confirming" })}>
            {copy.remove}
          </button>
        )}
      </div>
      {state.status === "confirming" && (
        <div className="confirm" role="group" aria-label={copy.removeWho(address)}>
          <p>
            {copy.removeAsk(address)} {next === undefined ? copy.removeAskLast : isDefault ? copy.removeAskDefault(next) : ""}
          </p>
          <div className="confirm-choices">
            <button type="button" className="button button-small button-reject" onClick={() => void remove()}>
              {copy.remove}
            </button>
            {/* The asking button is gone, so the question takes the focus, on its safe answer. */}
            <button type="button" className="button button-small button-quiet" autoFocus onClick={() => setState({ status: "idle" })}>
              {copy.cancel}
            </button>
          </div>
        </div>
      )}
      {said !== undefined && state.status !== "confirming" && (
        <p className="person-said" role="status">
          {said}
        </p>
      )}
      {state.status === "failed" && (
        <p className="notice notice-alert" role="alert">
          {state.message}
        </p>
      )}
    </li>
  );
}

/** A field for another address, on any of the organization's standalone domains. */
function AddAddress({ client, mailbox, domains, onAdded, onSignedOut }: { client: DuvaClient; mailbox: Mailbox; domains: string[]; onAdded: (address: string) => void; onSignedOut: () => void }) {
  const [address, setAddress] = useState("");
  const [state, setState] = useState<{ status: "idle" | "adding" } | { status: "failed"; message: string }>({ status: "idle" });
  const id = `new-address-${mailbox.id}`;
  const add = async () => {
    setState({ status: "adding" });
    const answer = await change(client.POST("/addresses", { body: { address: address.trim(), mailbox: mailbox.id } }), onSignedOut);
    if (answer === undefined) return;
    if ("failed" in answer) return setState({ status: "failed", message: answer.failed });
    setState({ status: "idle" });
    setAddress("");
    onAdded(answer.data.address);
  };
  return (
    <form
      className="address-add"
      onSubmit={(event) => {
        event.preventDefault();
        void add();
      }}
    >
      <label htmlFor={id}>{copy.newAddress}</label>
      <div className="address-add-row">
        <input
          id={id}
          type="text"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          placeholder={copy.placeholder(domains[0])}
          aria-describedby={`${id}-hint`}
          aria-invalid={state.status === "failed"}
          value={address}
          onChange={(event) => {
            setAddress(event.target.value);
            if (state.status === "failed") setState({ status: "idle" });
          }}
        />
        <button type="submit" className="button button-primary" disabled={address.trim() === "" || state.status === "adding"}>
          {state.status === "adding" ? copy.adding : copy.add}
        </button>
      </div>
      {state.status === "failed" ? (
        <p id={`${id}-hint`} className="field-error" role="alert">
          {state.message}
        </p>
      ) : (
        <p id={`${id}-hint`} className="hint">
          {copy.newAddressHint(domains)}
        </p>
      )}
    </form>
  );
}

/**
 * Creating a mailbox for a human or an agent, with its first address. The People sheet's `giving`
 * chooses the owner and puts the cursor in the address field.
 */
function CreateMailbox({
  client,
  owners,
  domains,
  giving,
  onCreated,
  onSignedOut,
}: {
  client: DuvaClient;
  owners: Owner[];
  domains: string[];
  giving?: Giving;
  onCreated: (mailbox: Mailbox, owner: string) => void;
  onSignedOut: () => void;
}) {
  const [owner, setOwner] = useState("");
  const [address, setAddress] = useState("");
  const [state, setState] = useState<{ status: "idle" | "creating" } | { status: "failed"; message: string }>({ status: "idle" });
  const form = useRef<HTMLFormElement>(null);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (giving === undefined) return;
    setOwner(giving.owner);
    setState({ status: "idle" });
    form.current?.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    field.current?.focus({ preventScroll: true });
  }, [giving]);

  const create = async () => {
    setState({ status: "creating" });
    const answer = await change(client.POST("/mailboxes", { body: { owner, address: address.trim() } }), onSignedOut);
    if (answer === undefined) return;
    if ("failed" in answer) return setState({ status: "failed", message: answer.failed });
    setState({ status: "idle" });
    setOwner("");
    setAddress("");
    onCreated(answer.data, owners.find(({ id }) => id === owner)?.name ?? owner);
  };
  const named = (kind: Actor["kind"]) =>
    owners
      .filter((each) => each.kind === kind)
      .map(({ id, label }) => (
        <option key={id} value={id}>
          {label}
        </option>
      ));
  return (
    <form
      ref={form}
      className="setting setting-add"
      aria-labelledby="create-mailbox"
      onSubmit={(event) => {
        event.preventDefault();
        void create();
      }}
    >
      <div className="setting-part">
        <h3 id="create-mailbox">{copy.create}</h3>
        <p className="setting-lead">{copy.createLead}</p>
      </div>
      <label className="setting-field">
        <span>{copy.owner}</span>
        <select value={owner} onChange={(event) => setOwner(event.target.value)}>
          <option value="" disabled>
            {copy.chooseOwner}
          </option>
          <optgroup label={copy.humans}>{named("human")}</optgroup>
          {owners.some(({ kind }) => kind === "agent") && <optgroup label={copy.agents}>{named("agent")}</optgroup>}
        </select>
      </label>
      <label className="setting-field">
        <span>{copy.address}</span>
        <input
          ref={field}
          type="text"
          inputMode="email"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder={copy.placeholder(domains[0])}
          aria-describedby="create-mailbox-hint"
          aria-invalid={state.status === "failed"}
          value={address}
          onChange={(event) => {
            setAddress(event.target.value);
            if (state.status === "failed") setState({ status: "idle" });
          }}
        />
      </label>
      {state.status === "failed" ? (
        <p id="create-mailbox-hint" className="field-error" role="alert">
          {state.message}
        </p>
      ) : (
        <p id="create-mailbox-hint" className="hint">
          {copy.newAddressHint(domains)}
        </p>
      )}
      <div className="setting-foot">
        <button type="submit" className="button button-primary" disabled={owner === "" || address.trim() === "" || state.status === "creating"}>
          {state.status === "creating" ? copy.creating : copy.createButton}
        </button>
      </div>
    </form>
  );
}
