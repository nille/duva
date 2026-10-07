// A sender's sheet, in the reading pane: who they are, how many threads the mailbox has from them,
// where their mail goes now, and the choice of where it goes from here, their delivery, for their
// address or, except at public mail providers, everyone at their domain. Nowhere erases what the
// mailbox has from them, so it asks once more, saying it can't be undone.
import { createContext, useCallback, useContext, useEffect, useId, useState } from "react";
import type { DuvaClient } from "@duva/client";
import { type components, isPublicMailProvider } from "@duva/openapi";
import { ActorMark } from "./mail-parts.tsx";
import type { Done, Label } from "./organize.tsx";
import { strings } from "./strings.ts";
import { BackIcon } from "./thread.tsx";

type Mailbox = components["schemas"]["Mailbox"];
type SenderSheet = components["schemas"]["SenderSheet"];
type Delivery = components["schemas"]["Delivery"];
type ScreeningDecision = components["schemas"]["ScreeningDecision"];
type Unsubscribe = components["schemas"]["Unsubscribe"];

/** The address of a sender's sheet, for the address in the letter, or undefined where no sheet opens. */
export const SenderLinkContext = createContext<((address: string) => string) | undefined>(undefined);

/** The address of the sheet of the sender with the address, in the mailbox open, if a sheet opens there. */
export const useSenderLink = () => useContext(SenderLinkContext);

/** The deliveries a human chooses from, in the order the sheet lists them. */
export const deliveries: Delivery[] = ["inbox", "feed", "paperTrail", "label", "nowhere"];

/** An address, or a domain for everyone there. */
export type Sender = { address: string } | { domain: string };

const valueOf = (sender: Sender) => ("address" in sender ? sender.address : sender.domain);

/** What saving a delivery came to: what to say it did, or why it failed. */
export type Saved = { done: Done } | { failed: string };

/**
 * Decides where mail from the address or domain goes in the mailbox, and answers what to say it
 * did, or calls `onSignedOut` and answers undefined if the session has ended.
 */
export async function decideDelivery(
  client: DuvaClient,
  { mailbox, sender, delivery, label, labels, onSignedOut }: { mailbox: string; sender: Sender; delivery: Delivery; label?: string; labels: Label[]; onSignedOut: () => void },
): Promise<Saved | undefined> {
  const { data, response } = await client
    .PUT("/mailboxes/{mailbox}/senders/{sender}", { params: { path: { mailbox, sender: valueOf(sender) } }, body: { delivery, ...(label !== undefined && { label }) } })
    .catch(() => ({ data: undefined, response: undefined }));
  if (response?.status === 401) {
    onSignedOut();
    return undefined;
  }
  if (data === undefined) {
    if (response === undefined) return { failed: strings.sender.saveUnreachable };
    return { failed: response.status === 403 && delivery === "nowhere" ? strings.sender.nowhereRefused : strings.sender.saveFailed(response.status) };
  }
  return { done: { message: savedSaid(data, labels) } };
}

/** What a decision did: who it is on, where their mail goes, the threads it moved or erases, and for nowhere how unsubscribing went. */
function savedSaid({ sender, threads, erasing, unsubscribe }: ScreeningDecision, labels: Label[]): string {
  const who = strings.screener.who(sender);
  const copy = strings.sender;
  if (sender.delivery === "nowhere") return [copy.savedNowhere(who, erasing ?? 0), unsubscribe && unsubscribeSaid(unsubscribe)].filter(Boolean).join(" ");
  const to = sender.delivery === "label" ? copy.places.label(labels.find(({ id }) => id === sender.label)?.name ?? strings.views.unknownLabel) : copy.places[sender.delivery];
  return copy.saved(who, to, threads.length);
}

function unsubscribeSaid({ outcome, reason, status }: Unsubscribe): string {
  const copy = strings.screener.unsubscribe;
  if (outcome === "unsubscribed") return copy.unsubscribed;
  switch (reason) {
    case "noMail":
    case "spam":
    case "noOneClick":
    case "notSigned":
      return copy[reason];
    case "notAllowed":
    case "notPublic":
    case "unreachable":
    case "timedOut":
    case "tooManyRedirects":
      return copy.failed(copy[reason]);
    case "refused":
      return copy.failed(copy.refused(status));
    case undefined:
      return outcome === "failed" ? copy.failed(copy.refused(status)) : copy.noOneClick;
  }
}

type Reading = { status: "loading" } | { status: "failed"; message: string } | { status: "read"; sheet: SenderSheet; domain?: SenderSheet };

/**
 * The sheet of the sender, an address or a domain for everyone there, in the mailbox, opened from the view at `back`, named
 * `backTo`. `labels` are the mailbox's, to file their mail under one of its own. `version` counts
 * the changes to the mailbox the app has seen, so the sheet is read again when it grows. `onDone`
 * hears what saving did.
 */
export function SenderSheetView({
  client,
  mailbox,
  sender,
  labels,
  back,
  backTo,
  version,
  onDone,
  onSignedOut,
}: {
  client: DuvaClient;
  mailbox: Mailbox;
  sender: string;
  labels: Label[];
  back: string;
  backTo: string;
  version: number;
  onDone: (done: Done) => void;
  onSignedOut: () => void;
}) {
  const [reading, setReading] = useState<Reading>({ status: "loading" });
  // What saving last did, said on the sheet, since the list beside it says nothing while it is open.
  const [saved, setSaved] = useState<string>();
  const address = sender.includes("@") ? sender : undefined;
  const domain = sender.slice(sender.lastIndexOf("@") + 1).toLowerCase();
  const domainChoosable = !isPublicMailProvider(domain);

  const load = useCallback(async () => {
    const get = (sender: string) => client.GET("/mailboxes/{mailbox}/senders/{sender}", { params: { path: { mailbox: mailbox.id, sender } } }).catch(() => ({ data: undefined, response: undefined }));
    const [own, atDomain] = await Promise.all([get(sender), address !== undefined && domainChoosable ? get(domain) : Promise.resolve(undefined)]);
    if (own.response?.status === 401) return onSignedOut();
    if (own.data === undefined) return setReading({ status: "failed", message: own.response === undefined ? strings.sender.unreachable : strings.sender.failed(own.response.status) });
    setReading({ status: "read", sheet: own.data, domain: atDomain?.data });
  }, [client, mailbox.id, sender, address, domain, domainChoosable, onSignedOut]);
  useEffect(() => {
    void load();
  }, [load, version]);

  const sheet = reading.status === "read" ? reading.sheet : undefined;
  const name = address === undefined ? strings.sender.everyoneAt(domain) : (sheet?.name ?? address);
  useEffect(() => {
    document.title = strings.title(strings.sender.open(name));
  }, [name]);

  return (
    <main className="desk desk-reading sender" aria-busy={reading.status === "loading"}>
      <div className="reading-tools">
        <p className="back">
          <a href={back}>
            <BackIcon />
            <span className="back-name">{backTo}</span>
          </a>
        </p>
      </div>
      <div className="reading-head sender-head">
        <h1 tabIndex={-1} className="view-title reading-title">
          {address !== undefined && <ActorMark kind="human" />}
          <span>{name}</span>
        </h1>
        <div className="reading-meta">
          {address !== undefined && name !== address && <p className="sender-address">{address}</p>}
          {sheet !== undefined && <p>{address === undefined ? strings.sender.domainThreads(sheet.threads) : strings.sender.threads(sheet.threads)}</p>}
        </div>
      </div>
      <p className="done-line sender-saved" role="status">
        {saved !== undefined && <span>{saved}</span>}
      </p>
      {reading.status === "loading" ? (
        <div className="letter letter-skeleton" aria-hidden="true">
          <span className="line" style={{ width: "40%" }} />
          <span className="line" style={{ width: "65%" }} />
        </div>
      ) : reading.status === "failed" ? (
        <div className="notice notice-alert failed-listing" role="alert">
          <p>{reading.message}</p>
          <button type="button" className="button button-small" onClick={() => void load()}>
            {strings.inbox.retry}
          </button>
        </div>
      ) : (
        <DeliveryForm
          // A sheet read again after saving starts from where the mail goes then.
          key={`${reading.sheet.decided?.decidedAt ?? ""}`}
          client={client}
          mailbox={mailbox}
          sheet={reading.sheet}
          domainSheet={reading.domain}
          address={address}
          domain={domainChoosable ? domain : undefined}
          labels={labels}
          onSaved={(done) => {
            setSaved(done.message);
            onDone(done);
            void load();
          }}
          onSignedOut={onSignedOut}
        />
      )}
    </main>
  );
}

/** Where the sheet says their mail goes now. */
function goesToSaid(sheet: SenderSheet, labels: Label[]): string {
  const copy = strings.sender.goesTo;
  if (sheet.goesTo === "label") return copy.label(labels.find(({ id }) => id === sheet.label)?.name ?? strings.views.unknownLabel);
  return copy[sheet.goesTo];
}

/** Where their mail goes now, and the choice of where it goes from here, saved once the human says. */
function DeliveryForm({
  client,
  mailbox,
  sheet,
  domainSheet,
  address,
  domain,
  labels,
  onSaved,
  onSignedOut,
}: {
  client: DuvaClient;
  mailbox: Mailbox;
  sheet: SenderSheet;
  domainSheet?: SenderSheet;
  /** Their address, or undefined on a domain's sheet, which decides for everyone there. */
  address: string | undefined;
  /** Their domain, unless it is a public mail provider's, where no decision covers everyone. */
  domain?: string;
  labels: Label[];
  onSaved: (done: Done) => void;
  onSignedOut: () => void;
}) {
  const own = labels.filter((label) => !label.builtIn);
  const decided = sheet.decided;
  const byDomain = decided?.domain !== undefined;
  const [scope, setScope] = useState<"address" | "domain">(byDomain || address === undefined ? "domain" : "address");
  const current = decided === undefined ? undefined : { delivery: decided.delivery, label: decided.label };
  const [delivery, setDelivery] = useState<Delivery>(current?.delivery ?? "inbox");
  const [label, setLabel] = useState<string | undefined>(current?.label ?? own[0]?.id);
  const [asking, setAsking] = useState(false);
  const [state, setState] = useState<{ status: "idle" | "saving" } | { status: "failed"; message: string }>({ status: "idle" });
  const id = useId();
  const copy = strings.sender;

  // What the scope chosen decides on now, which saving replaces.
  const scoped = address === undefined ? decided : scope === "domain" ? domainSheet?.decided : decided?.address !== undefined ? decided : undefined;
  const unchanged = scoped !== undefined && scoped.delivery === delivery && (delivery !== "label" || scoped.label === label);
  const leavingNowhere = scoped?.delivery === "nowhere" && delivery !== "nowhere";
  const erasing = scope === "domain" ? (domainSheet?.threads ?? sheet.threads) : sheet.threads;

  const save = async () => {
    setState({ status: "saving" });
    const saved = await decideDelivery(client, {
      mailbox: mailbox.id,
      sender: address === undefined || (scope === "domain" && domain !== undefined) ? { domain: domain ?? "" } : { address },
      delivery,
      ...(delivery === "label" && { label }),
      labels,
      onSignedOut,
    });
    if (saved === undefined) return;
    if ("failed" in saved) return setState({ status: "failed", message: saved.failed });
    setAsking(false);
    setState({ status: "idle" });
    onSaved(saved.done);
  };

  return (
    <form
      className="setting sender-form"
      aria-labelledby={`${id}-now`}
      onSubmit={(event) => {
        event.preventDefault();
        if (delivery === "nowhere") setAsking(true);
        else void save();
      }}
    >
      <p className="sender-now" id={`${id}-now`}>
        <span className="sender-now-label">{copy.now}</span>
        <span className={`sender-now-place sender-now-${sheet.goesTo}`}>{goesToSaid(sheet, labels)}</span>
        {byDomain && address !== undefined && <span className="hint">{copy.nowByDomain(decided!.domain!)}</span>}
      </p>
      {domain !== undefined && address !== undefined && (
        <fieldset>
          <legend>{copy.scope}</legend>
          <div className="switch">
            {(["address", "domain"] as const).map((each) => (
              <label key={each}>
                <input type="radio" name={`${id}-scope`} checked={scope === each} onChange={() => setScope(each)} />
                <span>{each === "address" ? copy.thisAddress(address) : copy.everyoneAt(domain)}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <fieldset>
        <legend>{copy.choose}</legend>
        {deliveries.map((each) => (
          <label className={each === "nowhere" ? "choice choice-nowhere" : "choice"} key={each}>
            <input type="radio" name={`${id}-delivery`} checked={delivery === each} disabled={each === "label" && own.length === 0} onChange={() => setDelivery(each)} />
            <span className="choice-text">
              <span className="choice-name">{copy.choices[each].name}</span>
              <span className="hint">{each === "label" && own.length === 0 ? copy.noLabels : copy.choices[each].hint}</span>
            </span>
          </label>
        ))}
        {delivery === "label" && own.length > 0 && (
          <div className="field sender-label">
            <label htmlFor={`${id}-label`}>{copy.whichLabel}</label>
            <select id={`${id}-label`} value={label} onChange={(event) => setLabel(event.target.value)}>
              {own.map((each) => (
                <option key={each.id} value={each.id}>
                  {each.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {delivery !== "nowhere" && <p className="setting-note">{leavingNowhere ? copy.leaveNowhere : copy.moves}</p>}
      </fieldset>
      {asking ? (
        <div className="confirm sender-confirm" role="group" aria-label={copy.nowhereConfirm}>
          <p>{copy.nowhereAsk(erasing)}</p>
          <div className="confirm-choices">
            <button type="button" className="button button-call" disabled={state.status === "saving"} onClick={() => void save()}>
              {state.status === "saving" ? copy.saving : copy.nowhereConfirm}
            </button>
            <button
              type="button"
              className="button button-quiet"
              onClick={() => {
                setAsking(false);
                setState({ status: "idle" });
              }}
            >
              {copy.cancel}
            </button>
          </div>
        </div>
      ) : (
        <div className="setting-foot">
          <button type="submit" className="button button-primary" disabled={unchanged || state.status === "saving" || (delivery === "label" && label === undefined)}>
            {state.status === "saving" ? copy.saving : copy.save}
          </button>
        </div>
      )}
      {state.status === "failed" && (
        <p className="notice notice-alert" role="alert">
          {state.message}
        </p>
      )}
    </form>
  );
}
