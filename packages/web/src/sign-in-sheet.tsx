// Signing in, a sheet on the You page of Settings (ADR-0041): the human's passkeys, which managed
// login registers and Duva lists and removes with their own session, and their recovery address,
// which changes once they follow the link mailed to the new one.
import { useCallback, useEffect, useId, useState } from "react";
import type { DuvaClient } from "@duva/client";
import type { components } from "@duva/openapi";
import { useDates } from "./dates.ts";
import { addPasskey, loadConfig, passkeyAdded, signedInByLink } from "./session.ts";
import { attempt, change } from "./setup.ts";
import { strings } from "./strings.ts";

type Passkey = components["schemas"]["Passkey"];

const copy = strings.settings.signIn;

export function SignInSheet({ client, email, recoveryAddress, onSignedOut }: { client: DuvaClient; email: string; recoveryAddress: string | undefined; onSignedOut: () => void }) {
  return (
    <section className="settings sign-in-sheet" aria-labelledby="sign-in-sheet">
      <div className="settings-head">
        <h2 id="sign-in-sheet">{copy.title}</h2>
        <p>{copy.lead(email)}</p>
      </div>
      <Passkeys client={client} email={email} onSignedOut={onSignedOut} />
      <RecoveryAddress client={client} current={recoveryAddress} onSignedOut={onSignedOut} />
    </section>
  );
}

function Passkeys({ client, email, onSignedOut }: { client: DuvaClient; email: string; onSignedOut: () => void }) {
  const { date } = useDates();
  const [passkeys, setPasskeys] = useState<Passkey[]>();
  const [problem, setProblem] = useState<string>();
  // Said once, as the human comes back from managed login, or arrives by a sign-in link without a passkey.
  const [said, setSaid] = useState<string | undefined>(() => (passkeyAdded() ? copy.added : undefined));
  const [busy, setBusy] = useState(false);
  const heading = useId();

  const read = useCallback(async () => {
    const { data, error, response } = await attempt(client.GET("/passkeys"));
    if (response?.status === 401) return onSignedOut();
    if (data !== undefined) return setPasskeys(data.passkeys);
    setProblem(response === undefined ? copy.unreachable : (error?.message ?? copy.failed(response.status)));
  }, [client, onSignedOut]);
  useEffect(() => {
    void read();
  }, [read]);

  const remove = async (passkey: Passkey, name: string) => {
    setBusy(true);
    const answer = await change(client.DELETE("/passkeys/{passkey}", { params: { path: { passkey: passkey.id } } }), onSignedOut);
    setBusy(false);
    if (answer === undefined) return;
    if ("failed" in answer) return setProblem(answer.failed);
    setPasskeys(answer.data.passkeys);
    setSaid(copy.removed(name));
  };

  return (
    <div className="setting-part" role="group" aria-labelledby={heading}>
      <h3 id={heading} className="setting-title">
        {copy.passkeys}
      </h3>
      <p className="setting-lead">{copy.passkeysLead}</p>
      {passkeys !== undefined && passkeys.length === 0 && signedInByLink() && said === undefined && <p className="notice notice-call">{copy.byLink(email)}</p>}
      {passkeys !== undefined &&
        (passkeys.length === 0 ? (
          <p className="setting-lead">{copy.noPasskeys}</p>
        ) : (
          <ul className="person-list" aria-label={copy.passkeys}>
            {passkeys.map((passkey) => {
              const name = passkey.name ?? copy.passkey;
              const added = date(new Date(passkey.createdAt), true);
              return (
                <li key={passkey.id} className="person-row">
                  <div className="person-line">
                    <span className="person-name">{name}</span>
                    <span className="hint">{copy.addedOn(added)}</span>
                    <button type="button" className="button button-small button-quiet" disabled={busy} aria-label={copy.removeWho(name, added)} onClick={() => void remove(passkey, name)}>
                      {copy.remove}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        ))}
      {problem !== undefined && (
        <p className="notice notice-alert" role="alert">
          {problem}
        </p>
      )}
      <div className="setting-foot">
        <button type="button" className="button button-small" onClick={() => void loadConfig().then(addPasskey)}>
          {copy.add}
        </button>
        <p role="status" className="setting-saved">
          {said ?? ""}
        </p>
      </div>
    </div>
  );
}

function RecoveryAddress({ client, current, onSignedOut }: { client: DuvaClient; current: string | undefined; onSignedOut: () => void }) {
  const [address, setAddress] = useState("");
  const [state, setState] = useState<{ status: "idle" | "sending" } | { status: "sent"; to: string } | { status: "failed"; message: string }>({ status: "idle" });
  const heading = useId();
  const field = useId();
  const send = async () => {
    setState({ status: "sending" });
    const answer = await change(client.PUT("/recovery-address", { body: { address: address.trim() } }), onSignedOut);
    if (answer === undefined) return;
    if ("failed" in answer) return setState({ status: "failed", message: answer.failed });
    setState({ status: "sent", to: answer.data.to });
    setAddress("");
  };
  return (
    <form
      className="setting-part"
      aria-labelledby={heading}
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <h3 id={heading} className="setting-title">
        {copy.recovery}
      </h3>
      <p className="setting-lead">{copy.recoveryLead}</p>
      {current === undefined ? <p className="notice notice-call">{copy.noRecovery}</p> : <p className="recovery-address">{current}</p>}
      <label className="setting-field" htmlFor={field}>
        <span>{copy.newRecovery}</span>
      </label>
      <div className="address-add-row">
        <input
          id={field}
          type="email"
          autoCapitalize="none"
          spellCheck={false}
          aria-invalid={state.status === "failed"}
          aria-describedby={state.status === "failed" ? `${field}-error` : undefined}
          value={address}
          onChange={(event) => {
            setAddress(event.target.value);
            if (state.status === "failed") setState({ status: "idle" });
          }}
        />
        <button type="submit" className="button button-small" disabled={address.trim() === "" || state.status === "sending"}>
          {state.status === "sending" ? copy.sending : copy.send}
        </button>
      </div>
      {state.status === "failed" && (
        <p id={`${field}-error`} className="field-error" role="alert">
          {state.message}
        </p>
      )}
      <p role="status" className="setting-saved">
        {state.status === "sent" ? copy.linkSent(state.to) : ""}
      </p>
    </form>
  );
}
