// Secrets (ADR-0039, #162), a page of Settings: the logins, cards and other values the human keeps
// for Coo to use while it browses, which Coo never sees. Each is a line by its name, saying its kind
// and last four characters and, for a card, its limits, which opens into its limits, Reveal, Rename,
// Replace, its history and Delete. Revealing asks Duva to mail a sign-in code first, and shows the
// value only until the human hides it or leaves. Adding closes the sheet after a seam.
import { type FormEvent, type ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import type { DuvaClient } from "@duva/client";
import type { components } from "@duva/openapi";
import { useDates } from "./dates.ts";
import { ChevronIcon } from "./setting-parts.tsx";
import { change } from "./setup.ts";
import { strings } from "./strings.ts";

type Secret = components["schemas"]["Secret"];
type SecretKind = components["schemas"]["SecretKind"];
type Use = components["schemas"]["SecretUseEntry"];
type Revealed = components["schemas"]["RevealedSecret"];

const copy = strings.settings.secrets;
const kinds: SecretKind[] = ["login", "card", "other"];

/** The fields each kind is given in, as the add and replace forms ask for them. */
const fieldsOf: Record<SecretKind, { name: "username" | "password" | "totpSeed" | "number" | "expiry" | "cvc" | "cardholder" | "value"; secret?: boolean; hint?: string; placeholder?: string; optional?: boolean; numeric?: boolean }[]> = {
  login: [{ name: "username" }, { name: "password", secret: true }, { name: "totpSeed", secret: true, hint: copy.totpSeedHint, optional: true }],
  card: [{ name: "number", secret: true, numeric: true }, { name: "expiry", placeholder: copy.expiryPlaceholder }, { name: "cvc", secret: true, numeric: true }, { name: "cardholder", optional: true }],
  other: [{ name: "value", secret: true }],
};

type Listed = { status: "loading" } | { status: "failed"; message: string } | { status: "read"; secrets: Secret[] };

/** The page: each secret as a line, then Add a secret. `onChange` hears of each change, which the index says. */
export function SecretsPage({ client, email, onChange, onSignedOut }: { client: DuvaClient; email: string; onChange: () => void; onSignedOut: () => void }) {
  const [listed, setListed] = useState<Listed>({ status: "loading" });
  const [said, setSaid] = useState("");
  const [added, setAdded] = useState<string>();

  const load = useCallback(async () => {
    const { data, response } = await client.GET("/secrets").catch(() => ({ data: undefined, response: undefined }));
    if (response?.status === 401) return onSignedOut();
    setListed(data === undefined ? { status: "failed", message: response === undefined ? copy.unreachable : copy.failed(response.status) } : { status: "read", secrets: data.secrets });
  }, [client, onSignedOut]);
  useEffect(() => {
    void load();
  }, [load]);
  const changed = (words: string) => {
    setSaid(words);
    onChange();
    void load();
  };

  return (
    <section className="settings secrets" aria-labelledby="secrets-title" aria-busy={listed.status === "loading"}>
      <div className="settings-head">
        <h2 id="secrets-title">{copy.title}</h2>
        <p>{copy.lead}</p>
      </div>
      <p role="status" className="setting-done">
        {said}
      </p>
      {listed.status === "failed" && (
        <div className="notice notice-alert failed-listing" role="alert">
          <p>{listed.message}</p>
          <button type="button" className="button button-small" onClick={() => void load()}>
            {strings.inbox.retry}
          </button>
        </div>
      )}
      {listed.status === "read" && (
        <>
          {listed.secrets.length === 0 && <p className="secrets-none">{copy.none}</p>}
          {listed.secrets.map((secret) => (
            <SecretLine key={secret.id} client={client} email={email} secret={secret} opened={added === secret.id} onChanged={changed} onSignedOut={onSignedOut} />
          ))}
          <AddSecret
            client={client}
            onAdded={(secret) => {
              setAdded(secret.id);
              changed(copy.added(secret.name));
            }}
            onSignedOut={onSignedOut}
          />
        </>
      )}
    </section>
  );
}

/** What a secret's line says under its name: its kind and last four, and how a card pays. */
function summaryOf(secret: Secret): { text: string; unlimited: boolean } {
  const kind = secret.kind === "login" ? copy.summary.login(secret.lastFour, secret.oneTimeCodes === true) : secret.kind === "card" ? copy.summary.card(secret.lastFour) : copy.summary.other(secret.lastFour);
  if (secret.kind !== "card") return { text: kind, unlimited: false };
  const { limits } = secret;
  return limits === undefined ? { text: kind, unlimited: true } : { text: `${kind}, ${copy.limitsSummary(limits.perPayment, limits.perMonth, limits.currency)}`, unlimited: false };
}

function SecretLine({
  client,
  email,
  secret,
  opened,
  onChanged,
  onSignedOut,
}: {
  client: DuvaClient;
  email: string;
  secret: Secret;
  /** Whether it was just added, so it opens. */
  opened: boolean;
  onChanged: (said: string) => void;
  onSignedOut: () => void;
}) {
  const details = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(opened);
  // Each reveal is a use, so the history reads again after one.
  const [reveals, setReveals] = useState(0);
  useEffect(() => {
    if (opened && details.current !== null) details.current.open = true;
  }, [opened]);
  const id = useId();
  const heading = `${id}-name`;
  const { text, unlimited } = summaryOf(secret);
  return (
    <details className="setting-line secret-line" name="secrets" ref={details} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        <div className="line-summary">
          <h3 id={heading}>{secret.name}</h3>
          <p className="line-summary-text">
            {text}
            {unlimited && (
              <>
                {", "}
                <span className="secret-unlimited">{copy.noLimits}</span>
              </>
            )}
          </p>
        </div>
        <ChevronIcon />
      </summary>
      {open && (
        <div className="setting" role="group" aria-labelledby={heading}>
          {secret.kind === "card" && <Limits client={client} secret={secret} onChanged={onChanged} onSignedOut={onSignedOut} />}
          <Reveal client={client} email={email} secret={secret} onRevealed={() => setReveals((count) => count + 1)} onSignedOut={onSignedOut} />
          <Rename client={client} secret={secret} onChanged={onChanged} onSignedOut={onSignedOut} />
          <Replace client={client} secret={secret} onChanged={onChanged} onSignedOut={onSignedOut} />
          <History client={client} secret={secret} reveals={reveals} onSignedOut={onSignedOut} />
          <Delete client={client} secret={secret} onChanged={onChanged} onSignedOut={onSignedOut} />
        </div>
      )}
    </details>
  );
}

/** A part of a secret's line: its name, what it does, and its form. */
function Part({ title, lead, children }: { title: string; lead?: string; children: ReactNode }) {
  const id = useId();
  return (
    <div className="setting-part" role="group" aria-labelledby={id}>
      <h4 id={id}>{title}</h4>
      {lead !== undefined && <p className="setting-lead">{lead}</p>}
      {children}
    </div>
  );
}

/** What went wrong with a change, said where it was asked. */
const Failure = ({ message }: { message?: string }) =>
  message === undefined ? null : (
    <p className="notice notice-alert" role="alert">
      {message}
    </p>
  );

/** A card's limits as three short fields side by side, with what it paid this month, Save and Clear. */
function Limits({ client, secret, onChanged, onSignedOut }: { client: DuvaClient; secret: Secret; onChanged: (said: string) => void; onSignedOut: () => void }) {
  const [currency, setCurrency] = useState(secret.limits?.currency ?? "");
  const [perPayment, setPerPayment] = useState(secret.limits?.perPayment ?? "");
  const [perMonth, setPerMonth] = useState(secret.limits?.perMonth ?? "");
  const [failed, setFailed] = useState<string>();
  const [busy, setBusy] = useState(false);
  const save = async (body: { currency: string | null; perPayment: string | null; perMonth: string | null }, said: string) => {
    setBusy(true);
    setFailed(undefined);
    const answer = await change(client.PATCH("/secrets/{secret}", { params: { path: { secret: secret.id } }, body }), onSignedOut);
    setBusy(false);
    if (answer === undefined) return;
    if ("failed" in answer) return setFailed(answer.failed);
    onChanged(said);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void save({ currency: currency.trim().toUpperCase(), perPayment: perPayment.trim(), perMonth: perMonth.trim() }, copy.limitsSaved);
  };
  return (
    <Part title={copy.limits} lead={copy.limitsLead}>
      <form className="secret-limits" onSubmit={submit}>
        <div className="secret-limit-fields">
          <label className="setting-field secret-currency">
            <span>{copy.currency}</span>
            <input type="text" autoCapitalize="characters" spellCheck={false} maxLength={3} placeholder="SEK" value={currency} onChange={(event) => setCurrency(event.target.value)} />
          </label>
          <label className="setting-field secret-amount">
            <span>{copy.perPayment}</span>
            <input type="text" inputMode="decimal" spellCheck={false} placeholder="500.00" value={perPayment} onChange={(event) => setPerPayment(event.target.value)} />
          </label>
          <label className="setting-field secret-amount">
            <span>{copy.perMonth}</span>
            <input type="text" inputMode="decimal" spellCheck={false} placeholder="2000.00" value={perMonth} onChange={(event) => setPerMonth(event.target.value)} />
          </label>
        </div>
        {secret.limits !== undefined && <p className="hint secret-spent">{copy.spent(secret.limits.spentThisMonth, secret.limits.currency)}</p>}
        <div className="setting-foot">
          <button type="submit" className="button button-primary" disabled={busy || currency.trim() === "" || perPayment.trim() === "" || perMonth.trim() === ""}>
            {copy.saveLimits}
          </button>
          {secret.limits !== undefined && (
            <button type="button" className="button button-quiet" disabled={busy} onClick={() => void save({ currency: null, perPayment: null, perMonth: null }, copy.limitsCleared)}>
              {copy.clearLimits}
            </button>
          )}
        </div>
        <Failure message={failed} />
      </form>
    </Part>
  );
}

type Revealing = { status: "idle" } | { status: "sending" } | { status: "asked"; to: string } | { status: "checking"; to: string } | { status: "shown"; revealed: Revealed };

/**
 * Reveal: Duva mails a sign-in code, then the code shows the secret's parts, each raised as a field
 * that can't be typed in, until Hide or the page is left.
 */
function Reveal({ client, email, secret, onRevealed, onSignedOut }: { client: DuvaClient; email: string; secret: Secret; onRevealed: () => void; onSignedOut: () => void }) {
  const [state, setState] = useState<Revealing>({ status: "idle" });
  const [code, setCode] = useState("");
  const [failed, setFailed] = useState<string>();
  const path = { path: { secret: secret.id } };
  const send = async () => {
    setState({ status: "sending" });
    setFailed(undefined);
    const answer = await change(client.POST("/secrets/{secret}/reveal", { params: path, body: {} }), onSignedOut);
    if (answer === undefined) return;
    if ("failed" in answer) return setState({ status: "idle" }), setFailed(answer.failed);
    setCode("");
    setState({ status: "asked", to: "sentTo" in answer.data ? answer.data.sentTo : email });
  };
  const check = async (event: FormEvent) => {
    event.preventDefault();
    if (state.status !== "asked") return;
    setState({ status: "checking", to: state.to });
    setFailed(undefined);
    const answer = await change(client.POST("/secrets/{secret}/reveal", { params: path, body: { code: code.trim() } }), onSignedOut);
    if (answer === undefined) return;
    // A code is tried once, so a wrong one asks for another.
    if ("failed" in answer) return setState({ status: "idle" }), setFailed(answer.failed);
    if (!("kind" in answer.data)) return setState({ status: "idle" });
    setCode("");
    setState({ status: "shown", revealed: answer.data });
    onRevealed();
  };
  const codeId = useId();
  return (
    <Part title={copy.reveal} lead={copy.revealLead}>
      {(state.status === "idle" || state.status === "sending") && (
        <div className="setting-foot">
          <button type="button" className="button" disabled={state.status === "sending"} onClick={() => void send()}>
            {state.status === "sending" ? copy.sendingCode : copy.sendCode}
          </button>
        </div>
      )}
      {(state.status === "asked" || state.status === "checking") && (
        <form className="secret-code" onSubmit={(event) => void check(event)}>
          <p className="setting-note" role="status">
            {copy.codeSent(state.to)}
          </p>
          <div className="secret-code-row">
            <label className="setting-field" htmlFor={codeId}>
              <span>{copy.code}</span>
            </label>
            <input
              id={codeId}
              className="secret-code-field"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              spellCheck={false}
              autoFocus
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
            <button type="submit" className="button button-primary" disabled={state.status === "checking" || code.trim() === ""}>
              {copy.show}
            </button>
          </div>
        </form>
      )}
      {state.status === "shown" && (
        <div className="secret-revealed">
          <dl className="dns-fields secret-revealed-parts">
            {(Object.keys(copy.revealedParts) as (keyof typeof copy.revealedParts)[]).flatMap((part) => {
              const value = state.revealed[part];
              return value === undefined
                ? []
                : [
                    <dt key={`${part}-name`}>{copy.revealedParts[part]}</dt>,
                    <dd key={`${part}-value`}>
                      <span className="dns-text">{value}</span>
                    </dd>,
                  ];
            })}
          </dl>
          <p className="hint">{copy.shown}</p>
          <div className="setting-foot">
            <button type="button" className="button button-quiet" onClick={() => setState({ status: "idle" })}>
              {copy.hide}
            </button>
          </div>
        </div>
      )}
      <Failure message={failed} />
    </Part>
  );
}

function Rename({ client, secret, onChanged, onSignedOut }: { client: DuvaClient; secret: Secret; onChanged: (said: string) => void; onSignedOut: () => void }) {
  const [name, setName] = useState(secret.name);
  const [failed, setFailed] = useState<string>();
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setFailed(undefined);
    const answer = await change(client.PATCH("/secrets/{secret}", { params: { path: { secret: secret.id } }, body: { name: name.trim() } }), onSignedOut);
    setBusy(false);
    if (answer === undefined) return;
    if ("failed" in answer) return setFailed(answer.failed);
    onChanged(copy.renamed(answer.data.name));
  };
  return (
    <Part title={copy.rename}>
      <form className="address-add-row" onSubmit={(event) => void submit(event)}>
        <label className="visually-hidden" htmlFor={`rename-${secret.id}`}>
          {copy.name}
        </label>
        <input id={`rename-${secret.id}`} type="text" maxLength={60} value={name} onChange={(event) => setName(event.target.value)} />
        <button type="submit" className="button" disabled={busy || name.trim() === "" || name.trim() === secret.name}>
          {copy.rename}
        </button>
      </form>
      <Failure message={failed} />
    </Part>
  );
}

/** The fields of the kind, each empty at first, so a form takes only what was typed. */
function KindFields({ kind, values, onValue, prefix }: { kind: SecretKind; values: Record<string, string>; onValue: (name: string, value: string) => void; prefix: string }) {
  return (
    <div className={`secret-fields secret-fields-${kind}`}>
      {fieldsOf[kind].map(({ name, secret, hint, placeholder, numeric }) => (
        <label key={name} className={`setting-field secret-field-${name}`}>
          <span>{copy[name]}</span>
          <input
            id={`${prefix}-${name}`}
            type={secret === true && name !== "number" && name !== "cvc" ? "password" : "text"}
            autoComplete="off"
            data-1p-ignore=""
            spellCheck={false}
            autoCapitalize="none"
            inputMode={numeric === true ? "numeric" : undefined}
            placeholder={placeholder}
            aria-describedby={hint === undefined ? undefined : `${prefix}-${name}-hint`}
            value={values[name] ?? ""}
            onChange={(event) => onValue(name, event.target.value)}
          />
          {hint !== undefined && (
            <span id={`${prefix}-${name}-hint`} className="hint">
              {hint}
            </span>
          )}
        </label>
      ))}
    </div>
  );
}

/** What of the fields was typed, trimmed, as the API takes them. */
const typed = (kind: SecretKind, values: Record<string, string>) =>
  Object.fromEntries(fieldsOf[kind].flatMap(({ name }) => (values[name] === undefined || values[name].trim() === "" ? [] : [[name, name === "password" ? values[name] : values[name].trim()]])));

function Replace({ client, secret, onChanged, onSignedOut }: { client: DuvaClient; secret: Secret; onChanged: (said: string) => void; onSignedOut: () => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState<string>();
  const [busy, setBusy] = useState(false);
  const given = typed(secret.kind, values);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setFailed(undefined);
    const answer = await change(client.PATCH("/secrets/{secret}", { params: { path: { secret: secret.id } }, body: given }), onSignedOut);
    setBusy(false);
    if (answer === undefined) return;
    if ("failed" in answer) return setFailed(answer.failed);
    setValues({});
    onChanged(copy.replaced);
  };
  return (
    <Part title={copy.replace} lead={copy.replaceLead}>
      <form className="secret-replace" onSubmit={(event) => void submit(event)}>
        <KindFields kind={secret.kind} values={values} prefix={`replace-${secret.id}`} onValue={(name, value) => setValues((current) => ({ ...current, [name]: value }))} />
        <div className="setting-foot">
          <button type="submit" className="button" disabled={busy || Object.keys(given).length === 0}>
            {copy.replace}
          </button>
        </div>
        <Failure message={failed} />
      </form>
    </Part>
  );
}

/** Every use of the secret, newest first: when, what, where and in which run. */
function History({ client, secret, reveals, onSignedOut }: { client: DuvaClient; secret: Secret; reveals: number; onSignedOut: () => void }) {
  const dates = useDates();
  const [uses, setUses] = useState<Use[]>();
  useEffect(() => {
    let current = true;
    void client
      .GET("/secrets/{secret}", { params: { path: { secret: secret.id } } })
      .then(({ data, response }) => {
        if (response.status === 401) return onSignedOut();
        if (current && data !== undefined) setUses(data.uses);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [client, secret, reveals, onSignedOut]);
  const said = ({ kind, part, site = "", amount = "", currency = "" }: Use) =>
    kind === "revealed" ? copy.use.revealed : kind === "paid" ? copy.use.paid(amount, currency, site) : kind === "waited" ? copy.use.waited(amount, currency, site) : copy.use.filled(copy.parts[part ?? "value"], site);
  return (
    <Part title={copy.history}>
      {uses !== undefined && uses.length === 0 && <p className="setting-lead">{copy.noHistory}</p>}
      {uses !== undefined && uses.length > 0 && (
        <ol className="secret-uses">
          {uses.map((use, index) => (
            <li key={`${use.at}-${index}`} className="secret-use">
              <time dateTime={use.at} title={dates.full(new Date(use.at))}>
                {dates.date(new Date(use.at), true)}
              </time>
              <span>
                {said(use)}
                {use.run !== undefined && <span className="secret-use-run"> {use.run.task === undefined ? copy.inAsk : copy.inTask}</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
    </Part>
  );
}

function Delete({ client, secret, onChanged, onSignedOut }: { client: DuvaClient; secret: Secret; onChanged: (said: string) => void; onSignedOut: () => void }) {
  const [asking, setAsking] = useState(false);
  const [failed, setFailed] = useState<string>();
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    setBusy(true);
    setFailed(undefined);
    const answer = await change(client.DELETE("/secrets/{secret}", { params: { path: { secret: secret.id } } }), onSignedOut);
    setBusy(false);
    if (answer === undefined) return;
    if ("failed" in answer) return setFailed(answer.failed);
    onChanged(copy.deleted(secret.name));
  };
  return (
    <div className="person-remove">
      {asking ? (
        <div className="confirm" role="group" aria-label={copy.delete}>
          <p>{copy.deleteAsk(secret.name)}</p>
          <div className="confirm-choices">
            <button type="button" className="button button-small button-reject" disabled={busy} onClick={() => void remove()}>
              {copy.delete}
            </button>
            <button type="button" className="button button-small button-quiet" autoFocus onClick={() => setAsking(false)}>
              {copy.cancel}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="button button-small button-quiet" onClick={() => setAsking(true)}>
          {copy.delete}
        </button>
      )}
      <Failure message={failed} />
    </div>
  );
}

/** Add a secret: its kind as keys side by side, its name, its kind's fields, and a card's limits. */
function AddSecret({ client, onAdded, onSignedOut }: { client: DuvaClient; onAdded: (secret: Secret) => void; onSignedOut: () => void }) {
  const [kind, setKind] = useState<SecretKind>("login");
  const [name, setName] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [limits, setLimits] = useState({ currency: "", perPayment: "", perMonth: "" });
  const [failed, setFailed] = useState<string>();
  const [busy, setBusy] = useState(false);
  const limited = kind === "card" && Object.values(limits).some((value) => value.trim() !== "");
  const ready = name.trim() !== "" && fieldsOf[kind].every(({ name: field, optional }) => optional === true || (values[field] ?? "").trim() !== "");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setFailed(undefined);
    const body = {
      kind,
      name: name.trim(),
      ...typed(kind, values),
      ...(limited && { currency: limits.currency.trim().toUpperCase(), perPayment: limits.perPayment.trim(), perMonth: limits.perMonth.trim() }),
    };
    const answer = await change(client.POST("/secrets", { body }), onSignedOut);
    setBusy(false);
    if (answer === undefined) return;
    if ("failed" in answer) return setFailed(answer.failed);
    setName("");
    setValues({});
    setLimits({ currency: "", perPayment: "", perMonth: "" });
    onAdded(answer.data);
  };
  const kindHint = useId();
  return (
    <form className="setting setting-add secret-add" aria-labelledby="add-secret" onSubmit={(event) => void submit(event)}>
      <div className="setting-part">
        <h3 id="add-secret">{copy.add}</h3>
        <p className="setting-lead">{copy.addLead}</p>
      </div>
      <fieldset className="secret-kind">
        <legend>{copy.kind}</legend>
        <div className="switch" aria-describedby={kindHint}>
          {kinds.map((each) => (
            <label key={each}>
              <input type="radio" name="secret-kind" checked={kind === each} onChange={() => (setKind(each), setValues({}))} />
              <span>{copy.kinds[each]}</span>
            </label>
          ))}
        </div>
        <p id={kindHint} className="hint">
          {copy.kindHints[kind]}
        </p>
      </fieldset>
      <label className="setting-field">
        <span>{copy.name}</span>
        <input type="text" maxLength={60} placeholder={copy.namePlaceholder[kind]} value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <KindFields kind={kind} values={values} prefix="add-secret" onValue={(field, value) => setValues((current) => ({ ...current, [field]: value }))} />
      {kind === "card" && (
        <fieldset className="secret-add-limits">
          <legend>{copy.limits}</legend>
          <p className="setting-lead">{copy.limitsLead}</p>
          <div className="secret-limit-fields">
            <label className="setting-field secret-currency">
              <span>{copy.currency}</span>
              <input type="text" autoCapitalize="characters" spellCheck={false} maxLength={3} placeholder="SEK" value={limits.currency} onChange={(event) => setLimits({ ...limits, currency: event.target.value })} />
            </label>
            <label className="setting-field secret-amount">
              <span>{copy.perPayment}</span>
              <input type="text" inputMode="decimal" spellCheck={false} placeholder="500.00" value={limits.perPayment} onChange={(event) => setLimits({ ...limits, perPayment: event.target.value })} />
            </label>
            <label className="setting-field secret-amount">
              <span>{copy.perMonth}</span>
              <input type="text" inputMode="decimal" spellCheck={false} placeholder="2000.00" value={limits.perMonth} onChange={(event) => setLimits({ ...limits, perMonth: event.target.value })} />
            </label>
          </div>
          <p className="hint">{copy.limitsHint}</p>
        </fieldset>
      )}
      <div className="setting-foot">
        <button type="submit" className="button button-primary" disabled={busy || !ready}>
          {busy ? copy.adding : copy.add}
        </button>
      </div>
      <Failure message={failed} />
    </form>
  );
}
