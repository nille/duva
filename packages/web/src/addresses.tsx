// The Addresses sheet in Settings, for admins: each mailbox in the organization as a line with its
// owner and default address, which opens into its addresses, across every domain, each made the
// default or removed there, and a field to add another. A mailbox without an address says so.
import { useCallback, useEffect, useState } from "react";
import type { DuvaClient } from "@duva/client";
import type { components } from "@duva/openapi";
import { ChevronIcon } from "./setting-parts.tsx";
import { type Answer, attempt, byOwner, change, isAgents, type Mailboxes, ownerName } from "./setup.ts";
import { strings } from "./strings.ts";

type Mailbox = components["schemas"]["Mailbox"];

type Read = { status: "loading" } | { status: "failed"; message: string } | { status: "read"; listed: Mailboxes; domains: string[] };

const copy = strings.addresses;

/**
 * The sheet. `changes` counts the changes to the organization's setup made on any sheet, and the
 * sheet reads again on each. `onChange` says it made one.
 */
export function AddressesSheet({ client, changes, onChange, onSignedOut }: { client: DuvaClient; changes: number; onChange: () => void; onSignedOut: () => void }) {
  const [read, setRead] = useState<Read>({ status: "loading" });

  // Read again after a change, the sheet stays as it is while it does, so the open line stays open.
  const load = useCallback(
    async (again = false) => {
      if (!again) setRead({ status: "loading" });
      const [mailboxes, domains] = await Promise.all([attempt(client.GET("/organization/mailboxes")), attempt(client.GET("/domains"))]);
      if (mailboxes.response?.status === 401 || domains.response?.status === 401) return onSignedOut();
      const unread = [mailboxes, domains].find(({ data }) => data === undefined);
      if (unread !== undefined) {
        if (!again) setRead({ status: "failed", message: unread.response === undefined ? copy.unreachable : copy.failed(unread.response.status) });
        return;
      }
      setRead({
        status: "read",
        listed: mailboxes.data!,
        domains: domains.data!.domains.filter(({ kind }) => kind === "standalone").map(({ domain }) => domain),
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
        byOwner(read.listed).map((mailbox) => (
          <MailboxLine
            key={mailbox.id}
            client={client}
            mailbox={mailbox}
            owner={ownerName(mailbox, read.listed)}
            agent={isAgents(mailbox, read.listed)}
            domains={read.domains}
            onChanged={onChange}
            onSignedOut={onSignedOut}
          />
        ))
      )}
    </section>
  );
}

function MailboxLine({
  client,
  mailbox,
  owner,
  agent,
  domains,
  onChanged,
  onSignedOut,
}: {
  client: DuvaClient;
  mailbox: Mailbox;
  owner: string;
  agent: boolean;
  domains: string[];
  onChanged: () => void;
  onSignedOut: () => void;
}) {
  const [done, setDone] = useState("");
  const heading = `mailbox-${mailbox.id}`;
  const addresses = mailbox.addresses;
  const summary = mailbox.defaultAddress === undefined ? copy.none : copy.summary(mailbox.defaultAddress, addresses.length - 1);
  const changed = (said: string) => {
    setDone(said);
    onChanged();
  };
  return (
    <details className="setting-line" name="mailboxes">
      <summary>
        <div className="line-summary">
          <h3 id={heading}>{owner}</h3>
          <p className="line-summary-text">{copy.line(agent, summary)}</p>
        </div>
        <ChevronIcon />
      </summary>
      <div className="setting" role="group" aria-labelledby={heading}>
        {addresses.length === 0 ? (
          <p className="setting-note">{copy.none}</p>
        ) : (
          <>
            <ul className="mailbox-addresses" aria-label={copy.listName(owner)}>
              {addresses.map((address) => (
                <AddressRow
                  key={address}
                  client={client}
                  mailbox={mailbox}
                  address={address}
                  onChanged={changed}
                  onSignedOut={onSignedOut}
                />
              ))}
            </ul>
            <p className="hint">{copy.defaultHint}</p>
          </>
        )}
        <AddAddress client={client} mailbox={mailbox} domains={domains} onAdded={(address) => changed(copy.added(address))} onSignedOut={onSignedOut} />
        <p role="status" className="setting-saved">
          {done}
        </p>
      </div>
    </details>
  );
}

type RowState = { status: "idle" | "confirming" | "busy" } | { status: "failed"; message: string };

/** One of the mailbox's addresses: the default one marked, any other made the default, and removing it, which asks once in place. */
function AddressRow({ client, mailbox, address, onChanged, onSignedOut }: { client: DuvaClient; mailbox: Mailbox; address: string; onChanged: (said: string) => void; onSignedOut: () => void }) {
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
