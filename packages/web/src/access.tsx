// An agent's access request, opened from the link duva login --agent prints: what it asks for and
// where it asked from, with the code to check against the one the agent shows. The human chooses its
// name, which of their mailboxes it works in, its access and whether its sends wait for them, then
// approves, which makes them its sponsor, or declines.
import { useCallback, useEffect, useId, useState } from "react";
import type { DuvaClient } from "@duva/client";
import type { components } from "@duva/openapi";
import { agentHref } from "./alerts.tsx";
import { useDates } from "./dates.ts";
import { ActorMark } from "./mail-parts.tsx";
import { strings } from "./strings.ts";

type AccessRequest = components["schemas"]["AccessRequest"];
type Agent = components["schemas"]["Agent"];

/** The access a human gives, where sending is on their behalf, with the disclosure's visible line, or as them, without it. */
export type Access = "read" | "organize" | "draft" | "onBehalf" | "asYou";
const accesses: Access[] = ["read", "organize", "draft", "onBehalf", "asYou"];

type Read =
  | { status: "loading" }
  | { status: "failed"; message: string; again: boolean }
  | { status: "read"; request: AccessRequest }
  | { status: "approved"; agent: Agent }
  | { status: "declined"; name: string };

/** The request with the code, for the human at `email`. `onApproved` hears of the agent approving created. */
export function AccessRequestView({ client, code, email, onApproved, onSignedOut }: { client: DuvaClient; code: string; email: string; onApproved: () => void; onSignedOut: () => void }) {
  const [read, setRead] = useState<Read>({ status: "loading" });
  const copy = strings.access;

  const load = useCallback(async () => {
    setRead({ status: "loading" });
    const { data, response } = await client.GET("/access-requests/{code}", { params: { path: { code } } }).catch(() => ({ data: undefined, response: undefined }));
    if (response?.status === 401) return onSignedOut();
    if (data !== undefined) return setRead({ status: "read", request: data });
    setRead({ status: "failed", ...failure(response?.status) });
  }, [client, code, onSignedOut]);

  useEffect(() => {
    void load();
  }, [load]);

  const title = useId();
  return (
    <main className="desk settings-page access-page" aria-busy={read.status === "loading"}>
      <section className="settings access" aria-labelledby={title}>
        {read.status === "loading" ? (
          <div className="settings-head">
            <h1 id={title} tabIndex={-1}>
              {copy.loading}
            </h1>
          </div>
        ) : read.status === "failed" ? (
          <>
            <div className="settings-head">
              <h1 id={title} tabIndex={-1}>
                {copy.unusable}
              </h1>
            </div>
            <div className="notice notice-alert" role="alert">
              <p>{read.message}</p>
              {read.again && (
                <button type="button" className="button button-small" onClick={() => void load()}>
                  {strings.inbox.retry}
                </button>
              )}
            </div>
          </>
        ) : read.status === "approved" ? (
          <div className="settings-head">
            <h1 id={title} tabIndex={-1}>
              {copy.approved(read.agent.name)}
            </h1>
            <p>{copy.approvedLead}</p>
            <p>
              <a href={agentHref(read.agent.id)}>{copy.toAgent(read.agent.name)}</a>
            </p>
          </div>
        ) : read.status === "declined" ? (
          <div className="settings-head">
            <h1 id={title} tabIndex={-1}>
              {copy.declined(read.name)}
            </h1>
            <p>{copy.declinedLead}</p>
          </div>
        ) : (
          <RequestForm
            client={client}
            request={read.request}
            email={email}
            title={title}
            onApproved={(agent) => {
              setRead({ status: "approved", agent });
              onApproved();
            }}
            onDeclined={() => setRead({ status: "declined", name: read.request.name })}
            onSignedOut={onSignedOut}
          />
        )}
      </section>
    </main>
  );
}

/** What the page says when Duva answered the status, or couldn't be reached, and whether trying again may help. */
function failure(status: number | undefined): { message: string; again: boolean } {
  const copy = strings.access;
  if (status === 404) return { message: copy.gone, again: false };
  if (status === 429) return { message: copy.tooMany, again: false };
  if (status === 403) return { message: copy.notYours, again: false };
  return { message: status === undefined ? copy.unreachable : copy.failed(status), again: true };
}

function RequestForm({
  client,
  request,
  email,
  title,
  onApproved,
  onDeclined,
  onSignedOut,
}: {
  client: DuvaClient;
  request: AccessRequest;
  email: string;
  title: string;
  onApproved: (agent: Agent) => void;
  onDeclined: () => void;
  onSignedOut: () => void;
}) {
  const copy = strings.access;
  const { when } = useDates();
  const [name, setName] = useState(request.name);
  const [mailboxes, setMailboxes] = useState<ReadonlySet<string>>(new Set(request.mailboxes.filter(({ asked }) => asked).map(({ mailbox }) => mailbox.id)));
  const [access, setAccess] = useState<Access>(request.wants === "send" ? "onBehalf" : request.wants);
  const [approval, setApproval] = useState(true);
  const [busy, setBusy] = useState<"approving" | "declining">();
  const [problem, setProblem] = useState<string>();
  const sends = access === "onBehalf" || access === "asYou";
  const named = name.trim();

  const decide = async (decision: "approve" | "decline") => {
    setBusy(decision === "approve" ? "approving" : "declining");
    setProblem(undefined);
    const path = { params: { path: { code: request.code } } };
    const answer = await (decision === "approve"
      ? client.POST("/access-requests/{code}/approve", {
          ...path,
          body: {
            name: named,
            sponsorAccess: sends ? "send" : (access as "read" | "organize" | "draft"),
            sponsorMailboxes: [...mailboxes],
            approvalAsSponsor: approval,
            disclosureLineAsSponsor: access !== "asYou",
          },
        })
      : client.POST("/access-requests/{code}/decline", path)
    ).catch(() => ({ data: undefined, response: undefined }));
    setBusy(undefined);
    if (answer.response?.status === 401) return onSignedOut();
    if (answer.data !== undefined) return "kind" in answer.data ? onApproved(answer.data) : onDeclined();
    const status = answer.response?.status;
    setProblem(status === 404 || status === 409 ? copy.gone : failure(status).message);
  };

  return (
    <>
      <div className="settings-head">
        <h1 id={title} tabIndex={-1} className="access-title">
          <ActorMark kind="agent" />
          {copy.title(request.name)}
        </h1>
        <p>{copy.lead}</p>
      </div>
      <dl className="access-facts">
        <div>
          <dt>{copy.code}</dt>
          <dd className="access-code">{request.code}</dd>
        </div>
        <div>
          <dt>{copy.from}</dt>
          <dd>{request.from.host === undefined ? request.from.address : copy.fromHost(request.from.address, request.from.host)}</dd>
        </div>
        <div>
          <dt>{copy.expires}</dt>
          <dd>{when(new Date(request.expiresAt))}</dd>
        </div>
      </dl>
      <form
        className="setting"
        aria-labelledby={title}
        onSubmit={(event) => {
          event.preventDefault();
          void decide("approve");
        }}
      >
        <fieldset>
          <legend>{copy.nameLegend}</legend>
          <label className="setting-field">
            <span className="visually-hidden">{copy.nameLegend}</span>
            <input type="text" autoComplete="off" maxLength={64} value={name} onChange={(event) => setName(event.target.value)} />
          </label>
        </fieldset>
        <fieldset>
          <legend>{copy.mailboxes}</legend>
          <p className="setting-lead">{request.mailboxes.length === 0 ? copy.noMailboxes : copy.mailboxesLead}</p>
          {request.mailboxes.map(({ mailbox, asked }) => (
            <label className="choice" key={mailbox.id}>
              <input
                type="checkbox"
                checked={mailboxes.has(mailbox.id)}
                onChange={(event) => {
                  const chosen = new Set(mailboxes);
                  if (event.target.checked) chosen.add(mailbox.id);
                  else chosen.delete(mailbox.id);
                  setMailboxes(chosen);
                }}
              />
              <span className="choice-text">
                <span className="choice-name">{strings.mailboxes.address(mailbox)}</span>
                <span className="hint">{asked ? copy.asked : copy.notAsked}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>{copy.accessLegend}</legend>
          <p className="setting-lead">{copy.accessLead(request.wants)}</p>
          {accesses.map((each) => (
            <label className="choice" key={each}>
              <input type="radio" name={`${title}-access`} checked={access === each} onChange={() => setAccess(each)} />
              <span className="choice-text">
                <span className="choice-name">{copy.accesses[each]}</span>
                <span className="hint">{each === "onBehalf" ? copy.hints.onBehalf(named || request.name, email) : copy.hints[each]}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {/* Approval and the line apply once it may send, now or after its sponsor raises its access. */}
        <fieldset>
          <legend>{copy.sendsLegend}</legend>
          {!sends && <p className="setting-lead">{copy.cantSend}</p>}
          <label className="choice">
            <input type="checkbox" checked={approval} onChange={(event) => setApproval(event.target.checked)} />
            <span className="choice-text">
              <span className="choice-name">{copy.approval}</span>
              <span className="hint">{copy.approvalHint}</span>
            </span>
          </label>
          <p className="setting-lead">{access === "asYou" ? copy.noLine : copy.line(named || request.name, email)}</p>
        </fieldset>
        <div className="setting-foot access-foot">
          <button type="submit" className="button button-call" disabled={busy !== undefined || named === ""}>
            {busy === "approving" ? copy.approving : copy.approve}
          </button>
          <button type="button" className="button button-quiet" disabled={busy !== undefined} onClick={() => void decide("decline")}>
            {busy === "declining" ? copy.declining : copy.decline}
          </button>
        </div>
        {problem !== undefined && (
          <p className="notice notice-alert" role="alert">
            {problem}
          </p>
        )}
      </form>
    </>
  );
}
