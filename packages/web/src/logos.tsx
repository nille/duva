// The organization's own BIMI logos (ADR-0026): a domain's Logo part on the Domains sheet, for
// admins, with its preview, its record, its mark certificate and the mailboxes' own logos on the
// domain, and the My logo sheet on You, where a human sets their mailbox's own logo and sees the
// records to ask an admin for. Duva shows the records and checks them, but changes no one's DNS.
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { DuvaClient } from "@duva/client";
import type { components } from "@duva/openapi";
import { CheckIcon, CopyButton, type Field, moveCopyFocus } from "./dns-parts.tsx";
import { attempt, change } from "./setup.ts";
import { strings } from "./strings.ts";

type DomainLogo = components["schemas"]["DomainLogo"];
type MailboxLogo = components["schemas"]["MailboxLogo"];
type BimiRecord = components["schemas"]["BimiRecord"];
type HostedLogo = components["schemas"]["HostedLogo"];
type Mailbox = components["schemas"]["Mailbox"];
type Actor = components["schemas"]["Actor"];

const copy = strings.ownLogos;

/** An actor as the sheets name it: a human by their address, an agent by its name. */
const nameOf = (actor: Actor) => (actor.kind === "human" ? actor.email : actor.name);

type Read<Logo> = { status: "loading" } | { status: "failed"; message: string } | { status: "read"; logo: Logo };

/** What the last change said: done, or why it failed. */
type Said = { done: string } | { failed: string } | undefined;

/** Reads the logo with the call, again whenever `load` is called, keeping what shows while it reads again. */
function useLogo<Logo>(read: () => Promise<{ data?: Logo; response?: Response }>, onSignedOut: () => void, enabled = true) {
  const [state, setState] = useState<Read<Logo>>({ status: "loading" });
  const load = useCallback(
    async (again = false) => {
      if (!again) setState({ status: "loading" });
      const { data, response } = await attempt(read());
      if (response?.status === 401) return onSignedOut();
      if (data !== undefined) return setState({ status: "read", logo: data });
      if (!again) setState({ status: "failed", message: response === undefined ? copy.unreachable : copy.failed(response.status) });
    },
    [read, onSignedOut],
  );
  useEffect(() => {
    if (enabled) void load();
  }, [enabled, load]);
  return { state, setState, load };
}

/** The logo as receivers show it, in a square and in a circle. Shown from its SVG, so a browser's copy of an earlier logo at the URL never stands in. */
function LogoPreview({ logo, name }: { logo: HostedLogo; name: string }) {
  const source = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(logo.svg)}`;
  return (
    <div className="logo-preview">
      <img src={source} alt={copy.alt(name)} className="logo-preview-square" />
      <img src={source} alt="" className="logo-preview-circle" />
    </div>
  );
}

/** A button that opens a file the human chooses, and hands over its text. */
function FileButton({ label, accept, disabled, onText }: { label: string; accept: string; disabled: boolean; onText: (text: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className="button button-small" disabled={disabled} onClick={() => input.current?.click()}>
        {label}
      </button>
      <input
        ref={input}
        type="file"
        accept={accept}
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          // The same file can be chosen again.
          event.target.value = "";
          if (file !== undefined) void file.text().then(onText);
        }}
      />
    </>
  );
}

/** BIMI records, each with its status and buttons that copy its name and value, which are one stop in the Tab order. */
function BimiRecords({ records }: { records: { label: string; record: BimiRecord }[] }) {
  const [tabStop, setTabStop] = useState<{ at: number; field: Field }>({ at: 0, field: "name" });
  const keysHint = useId();
  return (
    <>
      <ul className="dns-records" onKeyDown={moveCopyFocus}>
        {records.map(({ label, record }, index) => {
          const stop = Math.min(tabStop.at, records.length - 1) === index ? tabStop.field : undefined;
          return (
            <li key={record.name} className="dns-record" aria-label={strings.domains.record(label, "TXT")}>
              <div className="dns-record-head">
                <span className="dns-purpose">
                  {label} <span className="dns-type">TXT</span>
                </span>
                <span className={`dns-status dns-${record.status === "matches" ? "verified" : record.status}`}>
                  {record.status === "matches" && <CheckIcon />}
                  {copy.status[record.status]}
                </span>
              </div>
              <dl className="dns-fields">
                <dt>{strings.domains.name}</dt>
                <dd>
                  <span className="dns-text">{record.name}</span>
                  <CopyButton text={record.name} tabStop={stop === "name"} keysHint={keysHint} onFocus={() => setTabStop({ at: index, field: "name" })} />
                </dd>
                <dt>{strings.domains.value}</dt>
                <dd>
                  <span className="dns-text">{record.value}</span>
                  <CopyButton text={record.value} tabStop={stop === "value"} keysHint={keysHint} onFocus={() => setTabStop({ at: index, field: "value" })} />
                </dd>
              </dl>
              {record.found !== undefined && <p className="hint">{strings.domains.foundInstead(record.found)}</p>}
            </li>
          );
        })}
      </ul>
      <p id={keysHint} className="hint dns-keys">
        {strings.domains.copyKeys}
      </p>
    </>
  );
}

/** What the last change said, as a status or an alert. */
function Saying({ said }: { said: Said }) {
  return (
    <>
      <p role="status" className="setting-saved">
        {said !== undefined && "done" in said ? said.done : ""}
      </p>
      {said !== undefined && "failed" in said && (
        <p className="notice notice-alert" role="alert">
          {said.failed}
        </p>
      )}
    </>
  );
}

/**
 * The Logo part of an opened domain: the DMARC warning while the domain doesn't enforce it, the
 * logo's preview with uploading and removing it, its record, its mark certificate, and each
 * mailbox's own logo on the domain. It reads the logo once the domain's line first opens.
 */
export function DomainLogoPart({
  client,
  domain,
  opened,
  onSignedOut,
}: {
  client: DuvaClient;
  domain: string;
  /** Whether the domain's line is open. */
  opened: boolean;
  onSignedOut: () => void;
}) {
  const path = { params: { path: { domain } } };
  const read = useCallback(() => client.GET("/domains/{domain}/logo", { params: { path: { domain } } }), [client, domain]);
  // Once opened, the line keeps what it read.
  const [shown, setShown] = useState(opened);
  useEffect(() => {
    if (opened) setShown(true);
  }, [opened]);
  const { state, setState, load } = useLogo(read, onSignedOut, shown);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<Said>();
  const [certificateUrl, setCertificateUrl] = useState("");
  const heading = `logo-${domain}`;

  const run = async (call: Promise<{ data?: unknown; error?: { message?: string }; response?: Response }>, done: string) => {
    setBusy(true);
    setSaid(undefined);
    const answer = await change<DomainLogo>(call as Promise<{ data?: DomainLogo; response?: Response }>, onSignedOut);
    setBusy(false);
    if (answer === undefined) return;
    if ("failed" in answer) return setSaid({ failed: answer.failed });
    setState({ status: "read", logo: answer.data });
    setSaid({ done });
    setCertificateUrl("");
  };

  return (
    <section className="setting-part logo-part" aria-labelledby={heading} aria-busy={state.status === "loading"}>
      <h4 id={heading}>{copy.title}</h4>
      <p className="setting-lead">{copy.lead(domain)}</p>
      {state.status === "failed" && (
        <div className="notice notice-alert" role="alert">
          <p>{state.message}</p>
          <button type="button" className="button button-small" onClick={() => void load()}>
            {strings.inbox.retry}
          </button>
        </div>
      )}
      {state.status === "read" && (
        <>
          {!state.logo.dmarcEnforced && <p className="notice notice-call">{copy.dmarc(domain)}</p>}
          {state.logo.logo === undefined ? <p className="hint">{copy.none}</p> : <LogoPreview logo={state.logo.logo} name={domain} />}
          <div className="setting-foot">
            <FileButton
              label={state.logo.logo === undefined ? copy.upload : copy.replace}
              accept=".svg,image/svg+xml"
              disabled={busy}
              onText={(svg) => void run(client.PUT("/domains/{domain}/logo", { ...path, body: { svg } }), copy.set)}
            />
            {state.logo.logo !== undefined && (
              <button type="button" className="button button-small button-quiet" disabled={busy} onClick={() => void run(client.DELETE("/domains/{domain}/logo", path), copy.removed)}>
                {copy.remove}
              </button>
            )}
            <Saying said={said} />
          </div>
          <p className="hint">{copy.uploadHint}</p>
          {state.logo.record !== undefined && (
            <>
              <p className="setting-lead">{copy.recordLead}</p>
              <BimiRecords records={[{ label: copy.record, record: state.logo.record }]} />
              <div>
                <button type="button" className="button button-small" disabled={busy} onClick={() => void load(true)}>
                  {strings.domains.checkAgain}
                </button>
              </div>
            </>
          )}
          {state.logo.logo !== undefined && (
            <div className="logo-subpart">
              <h5>{copy.certificate}</h5>
              <p className="setting-lead">{copy.certificateLead}</p>
              {state.logo.certificate !== undefined ? (
                <>
                  <p className="setting-lead">{state.logo.certificate.hosted ? copy.certificateHosted(state.logo.certificate.url) : copy.certificateAt(state.logo.certificate.url)}</p>
                  <div>
                    <button
                      type="button"
                      className="button button-small button-quiet"
                      disabled={busy}
                      onClick={() => void run(client.DELETE("/domains/{domain}/logo/certificate", path), copy.certificateRemoved)}
                    >
                      {copy.removeCertificate}
                    </button>
                  </div>
                </>
              ) : (
                <form
                  className="logo-certificate"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void run(client.PUT("/domains/{domain}/logo/certificate", { ...path, body: { url: certificateUrl.trim() } }), copy.attached);
                  }}
                >
                  <label className="setting-field">
                    <span>{copy.certificateUrl}</span>
                    <input type="url" value={certificateUrl} placeholder="https://" spellCheck={false} onChange={(event) => setCertificateUrl(event.target.value)} />
                  </label>
                  <div className="setting-foot">
                    <button type="submit" className="button button-small" disabled={busy || certificateUrl.trim() === ""}>
                      {copy.attach}
                    </button>
                    <FileButton
                      label={copy.uploadPem}
                      accept=".pem,.crt,application/pem-certificate-chain,application/x-pem-file"
                      disabled={busy}
                      onText={(pem) => void run(client.PUT("/domains/{domain}/logo/certificate", { ...path, body: { pem } }), copy.attached)}
                    />
                  </div>
                </form>
              )}
            </div>
          )}
          {state.logo.selectors.length > 0 && (
            <div className="logo-subpart">
              <h5>{copy.selectors}</h5>
              <p className="setting-lead">{copy.selectorsLead}</p>
              <BimiRecords records={state.logo.selectors.map(({ owner, selector, record }) => ({ label: copy.selectorRecord(nameOf(owner), selector), record }))} />
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** The My logo sheet on You: the human's own logo for each of their own mailboxes. */
export function MyLogoSheet({ client, mailboxes, onSignedOut }: { client: DuvaClient; mailboxes: Mailbox[]; onSignedOut: () => void }) {
  if (mailboxes.length === 0) return null;
  return (
    <section className="settings" aria-labelledby="my-logo">
      <div className="settings-head">
        <h2 id="my-logo">{copy.mine}</h2>
        <p>{copy.mineLead}</p>
      </div>
      {mailboxes.map((mailbox) => (
        <MailboxLogoPart key={mailbox.id} client={client} mailbox={mailbox} titled={mailboxes.length > 1} onSignedOut={onSignedOut} />
      ))}
    </section>
  );
}

/** One mailbox's own logo: its preview with uploading and removing it, then the records to ask an admin for. */
function MailboxLogoPart({ client, mailbox, titled, onSignedOut }: { client: DuvaClient; mailbox: Mailbox; titled: boolean; onSignedOut: () => void }) {
  const path = { params: { path: { mailbox: mailbox.id } } };
  const read = useCallback(() => client.GET("/mailboxes/{mailbox}/logo", { params: { path: { mailbox: mailbox.id } } }), [client, mailbox.id]);
  const { state, setState, load } = useLogo<MailboxLogo>(read, onSignedOut);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<Said>();
  const name = mailbox.defaultAddress ?? copy.mine;

  const run = async (call: Promise<{ data?: MailboxLogo; error?: { message?: string }; response?: Response }>, done: string) => {
    setBusy(true);
    setSaid(undefined);
    const answer = await change<MailboxLogo>(call, onSignedOut);
    setBusy(false);
    if (answer === undefined) return;
    if ("failed" in answer) return setSaid({ failed: answer.failed });
    setState({ status: "read", logo: answer.data });
    setSaid({ done });
  };

  return (
    <div className="setting" aria-busy={state.status === "loading"} {...(titled && { role: "group", "aria-label": copy.mineOn(name) })}>
      {titled && <h3 className="logo-mailbox">{copy.mineOn(name)}</h3>}
      {state.status === "failed" && (
        <div className="notice notice-alert" role="alert">
          <p>{state.message}</p>
          <button type="button" className="button button-small" onClick={() => void load()}>
            {strings.inbox.retry}
          </button>
        </div>
      )}
      {state.status === "read" && (
        <div className="setting-part">
          {state.logo.logo === undefined ? <p className="hint">{copy.none}</p> : <LogoPreview logo={state.logo.logo} name={name} />}
          <div className="setting-foot">
            <FileButton
              label={state.logo.logo === undefined ? copy.upload : copy.replace}
              accept=".svg,image/svg+xml"
              disabled={busy}
              onText={(svg) => void run(client.PUT("/mailboxes/{mailbox}/logo", { ...path, body: { svg } }), copy.set)}
            />
            {state.logo.logo !== undefined && (
              <button type="button" className="button button-small button-quiet" disabled={busy} onClick={() => void run(client.DELETE("/mailboxes/{mailbox}/logo", path), copy.removed)}>
                {copy.remove}
              </button>
            )}
            <Saying said={said} />
          </div>
          <p className="hint">{copy.uploadHint}</p>
          {state.logo.records.length > 0 && (
            <>
              <p className="setting-lead">{copy.ask(state.logo.records.length)}</p>
              <BimiRecords records={state.logo.records.map((record) => ({ label: copy.domainRecord(record.name.slice(record.name.indexOf("._bimi.") + "._bimi.".length)), record }))} />
              <div>
                <button type="button" className="button button-small" disabled={busy} onClick={() => void load(true)}>
                  {strings.domains.checkAgain}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
