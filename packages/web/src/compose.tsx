// The composer: a draft as a live sheet, laid like a letter, with its header fields on the name
// column and the text in the proof face. Duva saves it as the human writes, and a human's send
// from their own mailbox goes out at once, so the sheet's foot says how the send went. A reply
// opens in its thread, under the message it answers, and a draft opened on its own has a page.
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { DuvaClient } from "@duva/client";
import type { components } from "@duva/openapi";
import { useDates } from "./dates.ts";
import { Attachments } from "./mail-parts.tsx";
import { SendNow } from "./send-now.tsx";
import { strings } from "./strings.ts";

type Draft = components["schemas"]["Draft"];
type Mailbox = components["schemas"]["Mailbox"];
type NewDraft = components["schemas"]["NewDraft"];

/** How long the composer waits after the last keystroke before it saves. */
const saveDelay = 800;

/** How long the composer keeps reading a send that is on its way, and how long before it says the human can leave. */
const followSendFor = 120_000;
const leaveAfter = 30_000;

/** The fields the human types in, as they typed them, and the address they chose to send from. */
type Fields = { from: string; to: string; cc: string; bcc: string; subject: string; text: string };
type ListField = "to" | "cc" | "bcc";
const listFields: ListField[] = ["to", "cc", "bcc"];

/** Starts a draft in the mailbox, a reply or a forward as the body says, and answers its ID, or undefined if Duva couldn't. */
export async function startDraft(client: DuvaClient, mailbox: string, body: NewDraft, onSignedOut: () => void): Promise<string | undefined> {
  const { data, response } = await client.POST("/mailboxes/{mailbox}/drafts", { params: { path: { mailbox } }, body }).catch(() => ({ data: undefined, response: undefined }));
  if (response?.status === 401) onSignedOut();
  return data?.id;
}

/** What a composer in a thread tells the thread: that its send went out, or that it was deleted. */
export interface InThread {
  onSent: () => void;
  onClosed: () => void;
}

/** The addresses in a field, as the human separated them. */
const addressesIn = (field: string) => field.split(/[\s,;]+/).filter(Boolean);

/** Whether the text is one email address, as Duva's API checks it. */
const isEmailAddress = (text: string) => /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/.test(text);

const fieldsOf = (draft: Draft): Fields => ({
  from: draft.from,
  to: draft.to.map(({ address }) => address).join(", "),
  cc: draft.cc.map(({ address }) => address).join(", "),
  bcc: draft.bcc.map(({ address }) => address).join(", "),
  subject: draft.subject,
  text: draft.text,
});

type Loading = { status: "loading" } | { status: "failed"; message: string; gone?: boolean } | { status: "ready" };
type Saving = { status: "idle" } | { status: "saving" } | { status: "saved"; at: Date } | { status: "failed" };
type Problem = { message: string; field?: ListField };

/**
 * The draft with the ID in the mailbox, or a new message if there is no ID yet, which becomes a
 * draft once there is something to save. `agentNames` names the agents the human sponsors by ID, so a
 * draft an agent saved last says so. `version` counts the changes to the mailbox the app has
 * seen, so the composer learns how its send went. It never overwrites what the human typed. With
 * `inThread`, it is a sheet at the foot of the thread it answers, which it tells when it is done.
 */
export function Composer({
  client,
  mailbox,
  id: given,
  agentNames,
  base = "#/",
  version,
  inThread,
  onSignedOut,
}: {
  client: DuvaClient;
  /** The mailbox, with the groups its owner can send as, when the list of mailboxes gave them. */
  mailbox: Mailbox & { groups?: string[] };
  /** Where the mailbox's views are, so the draft's address, and the links to its thread and Drafts, name it. */
  base?: string;
  id?: string;
  agentNames: ReadonlyMap<string, string>;
  version: number;
  inThread?: InThread;
  onSignedOut: () => void;
}) {
  const { clock } = useDates();
  const [loading, setLoading] = useState<Loading>(given === undefined ? { status: "ready" } : { status: "loading" });
  const [draft, setDraft] = useState<Draft>();
  const [fields, setFields] = useState<Fields>({ from: mailbox.defaultAddress ?? "", to: "", cc: "", bcc: "", subject: "", text: "" });
  const [copies, setCopies] = useState(false);
  const [saving, setSaving] = useState<Saving>({ status: "idle" });
  const [problem, setProblem] = useState<Problem>();
  const [busy, setBusy] = useState<"sending" | "deleting">();
  const formId = useId();

  const id = useRef(given);
  const fieldsRef = useRef(fields);
  fieldsRef.current = fields;
  // What the draft holds as Duva last saved it, so a save sends only what changed since.
  const stored = useRef<Fields>(fields);
  // Saves run one after another, so the first one's draft is the one every later save changes.
  const queue = useRef<Promise<boolean>>(Promise.resolve(true));
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Whether the fields hold the draft yet. Later reads only learn how its send went.
  const filled = useRef(given === undefined);
  // Counts what Duva answered about the draft, so a read that comes back after a newer answer is dropped.
  const answered = useRef(0);
  // Whether the human sent the draft from this composer, so it moves on once the send went out.
  const sentHere = useRef(false);

  const read = useCallback(async () => {
    if (id.current === undefined) return;
    const asked = ++answered.current;
    const { data, response } = await client
      .GET("/mailboxes/{mailbox}/drafts/{draft}", { params: { path: { mailbox: mailbox.id, draft: id.current } } })
      .catch(() => ({ data: undefined, response: undefined }));
    if (asked !== answered.current) return;
    if (response?.status === 401) return onSignedOut();
    if (data === undefined) {
      // A draft on screen stays there when a later read fails.
      if (filled.current && response?.status !== 404) return;
      const gone = response?.status === 404;
      setLoading({ status: "failed", gone, message: gone ? strings.compose.gone : response === undefined ? strings.compose.unreachable : strings.compose.loadFailed });
      return;
    }
    setDraft(data);
    if (!filled.current) {
      filled.current = true;
      const loaded = fieldsOf(data);
      stored.current = loaded;
      setFields(loaded);
      if (loaded.cc !== "" || loaded.bcc !== "") setCopies(true);
    }
    setLoading({ status: "ready" });
  }, [client, mailbox.id, onSignedOut]);

  useEffect(() => {
    void read();
  }, [read, version]);

  /** Saves what changed since the last save, leaving out any list with something that isn't an address. Answers whether all of it was saved. */
  const save = useCallback(() => {
    clearTimeout(timer.current);
    queue.current = queue.current.then(async () => {
      const now = fieldsRef.current;
      const wrong = listFields.flatMap((field) => {
        const bad = addressesIn(now[field]).find((address) => !isEmailAddress(address));
        return bad === undefined ? [] : [{ field, bad }];
      });
      setProblem((current) => (wrong.length > 0 ? { field: wrong[0]!.field, message: strings.compose.notAddress(wrong[0]!.bad) } : current?.field === undefined ? current : undefined));
      const changed: components["schemas"]["DraftChanges"] = {};
      const differs = (field: keyof Fields) => now[field] !== stored.current[field] && !wrong.some((each) => each.field === field);
      for (const field of listFields) if (differs(field)) changed[field] = addressesIn(now[field]);
      if (differs("from")) changed.from = now.from;
      if (differs("subject")) changed.subject = now.subject;
      if (differs("text")) changed.text = now.text;
      if (Object.keys(changed).length === 0) return wrong.length === 0;
      setSaving({ status: "saving" });
      const answer =
        id.current === undefined
          ? await client.POST("/mailboxes/{mailbox}/drafts", { params: { path: { mailbox: mailbox.id } }, body: changed }).catch(() => undefined)
          : await client.PATCH("/mailboxes/{mailbox}/drafts/{draft}", { params: { path: { mailbox: mailbox.id, draft: id.current } }, body: changed }).catch(() => undefined);
      if (answer?.response.status === 401) {
        onSignedOut();
        return false;
      }
      if (answer?.data === undefined) {
        setSaving({ status: "failed" });
        return false;
      }
      if (id.current === undefined) {
        id.current = answer.data.id;
        // The address now names the draft, so a reload or the back button returns to it.
        history.replaceState(null, "", `${base}drafts/${encodeURIComponent(answer.data.id)}`);
      }
      stored.current = { ...stored.current, ...Object.fromEntries(Object.keys(changed).map((field) => [field, now[field as keyof Fields]])) };
      answered.current++;
      setDraft(answer.data);
      setSaving({ status: "saved", at: new Date() });
      return wrong.length === 0;
    });
    return queue.current;
  }, [client, mailbox.id, base, onSignedOut]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const change = (field: keyof Fields) => (event: { target: { value: string } }) => {
    setFields((current) => ({ ...current, [field]: event.target.value }));
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), saveDelay);
  };

  /** Chooses the address to send from, saved at once, since nothing more is typed in it. */
  const chooseFrom = (from: string) => {
    const next = { ...fieldsRef.current, from };
    fieldsRef.current = next;
    setFields(next);
    void save();
  };
  // The draft can go from any of the mailbox's addresses or its owner's groups, and from the address a reply or forward started from.
  const groups = mailbox.groups ?? [];
  const fromChoices = [...new Set([...mailbox.addresses, ...(draft === undefined || groups.includes(draft.from) ? [] : [draft.from])])];
  const asGroup = groups.includes(fields.from);

  const state = draft?.send?.state;
  // The agent that saved the draft last, if one did. Once the human saves it, it's theirs.
  const agent = draft?.updatedBy === undefined ? undefined : agentNames.get(draft.updatedBy);
  const locked = state === "approved" || state === "waitingForLimit" || state === "sending" || state === "sent" || state === "unclear" || busy !== undefined;

  const send = async () => {
    setBusy("sending");
    setProblem(undefined);
    const saved = await save();
    if (!saved || id.current === undefined) {
      setBusy(undefined);
      if (id.current === undefined && saved) setProblem({ message: strings.compose.noRecipient, field: "to" });
      return;
    }
    const params = { params: { path: { mailbox: mailbox.id, draft: id.current } } };
    const { data, error, response } = await client.POST("/mailboxes/{mailbox}/drafts/{draft}/send", params).catch(() => ({ data: undefined, error: undefined, response: undefined }));
    setBusy(undefined);
    if (response?.status === 401) return onSignedOut();
    if (response?.status === 400) return setProblem({ message: strings.compose.noRecipient, field: "to" });
    if (data === undefined) return setProblem({ message: response === undefined ? strings.compose.unreachable : (error?.message ?? strings.compose.sendFailed) });
    sentHere.current = true;
    answered.current++;
    setDraft(data);
    // Duva sends a human's draft at once, so how it went is soon there to read.
    await read();
  };

  const remove = async () => {
    clearTimeout(timer.current);
    setBusy("deleting");
    await queue.current;
    const closed = () => (inThread === undefined ? (location.hash = `${base}drafts`) : inThread.onClosed());
    if (id.current === undefined) return closed();
    const { response } = await client
      .DELETE("/mailboxes/{mailbox}/drafts/{draft}", { params: { path: { mailbox: mailbox.id, draft: id.current } } })
      .catch(() => ({ response: undefined }));
    if (response?.status === 401) return onSignedOut();
    setBusy(undefined);
    if (!response?.ok && response?.status !== 404) return setProblem({ message: strings.compose.deleteFailed });
    closed();
  };

  // A send on its way is read again soon, then less often, for two minutes, and again when the tab
  // comes back, so the composer learns it went out even when no change to the mailbox says so.
  const [slow, setSlow] = useState(false);
  const onItsWay = state === "approved" || state === "sending";
  useEffect(() => {
    setSlow(false);
    if (!onItsWay) return;
    const since = Date.now();
    let wait = 1_000;
    let timer: ReturnType<typeof setTimeout>;
    const next = () => {
      if (Date.now() - since >= followSendFor) return;
      timer = setTimeout(() => {
        void read();
        wait = Math.min(wait * 2, 5_000);
        next();
      }, wait);
    };
    next();
    const leave = setTimeout(() => setSlow(true), leaveAfter);
    const shown = () => {
      if (document.visibilityState === "visible") void read();
    };
    document.addEventListener("visibilitychange", shown);
    return () => {
      clearTimeout(timer);
      clearTimeout(leave);
      document.removeEventListener("visibilitychange", shown);
    };
  }, [onItsWay, read]);

  // Once a send from here went out, a reply returns to its thread with the message in it, and a new message leaves its slip.
  const answers = draft?.answers ?? draft?.forwards;
  const thread = answers === undefined ? undefined : draft?.thread;
  const sentNow = state === "sent" && sentHere.current;
  const inThreadRef = useRef(inThread);
  inThreadRef.current = inThread;
  useEffect(() => {
    if (!sentNow) return;
    if (inThreadRef.current !== undefined) inThreadRef.current.onSent();
    else if (thread !== undefined) location.hash = `${base}threads/${encodeURIComponent(thread)}`;
  }, [sentNow, thread, base]);

  const title =
    draft?.answers !== undefined ? strings.compose.reply : draft?.forwards !== undefined ? strings.compose.forward : given === undefined ? strings.compose.newMessage : strings.compose.draft;
  useEffect(() => {
    if (inThread === undefined) document.title = strings.title(title);
  }, [title, inThread]);

  const titleRef = useRef<HTMLHeadingElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const toRef = useRef<HTMLInputElement>(null);
  const ready = loading.status === "ready";
  const sheetRef = useRef<HTMLFormElement>(null);
  // In a thread the sheet comes into view with the cursor where the human writes next: the text of
  // a reply, or To of a forward. On a page of its own, the web app focuses its title.
  const forward = draft?.forwards !== undefined;
  const nested = inThread !== undefined;
  useEffect(() => {
    if (!ready || !nested) return;
    (forward ? toRef : textRef).current?.focus({ preventScroll: true });
    sheetRef.current?.scrollIntoView({ block: "nearest" });
  }, [ready, nested, forward]);

  if (loading.status !== "ready") {
    const waiting =
      loading.status === "loading" ? (
        <div className="letter letter-skeleton" aria-hidden="true">
          <span className="line" style={{ width: "40%" }} />
          <span className="line" style={{ width: "75%" }} />
          <span className="line" style={{ width: "65%" }} />
        </div>
      ) : (
        <div className="notice notice-alert failed-listing" role="alert">
          <p>{loading.message}</p>
          {!loading.gone && (
            <button type="button" className="button button-small" onClick={() => void read()}>
              {strings.inbox.retry}
            </button>
          )}
        </div>
      );
    if (inThread !== undefined) return <div aria-busy={loading.status === "loading"}>{waiting}</div>;
    return (
      <main className="desk desk-reading" aria-busy={loading.status === "loading"}>
        <Back draft={draft} base={base} />
        {waiting}
      </main>
    );
  }

  // A new message that went out leaves a slip in place of its sheet, saying where it went.
  if (sentNow && inThread === undefined && answers === undefined && draft !== undefined) {
    return (
      <main className="desk desk-reading">
        <Back draft={draft} base={base} />
        <h1 ref={titleRef} tabIndex={-1} className="view-title compose-title">
          {title}
        </h1>
        <SentSlip draft={draft} base={base} />
      </main>
    );
  }

  const hintId = `${formId}-hint`;
  const problemId = `${formId}-problem`;
  const field = (name: ListField, label: string, hint?: string) => (
    <div className="compose-field">
      <label htmlFor={`${formId}-${name}`}>{label}</label>
      <input
        id={`${formId}-${name}`}
        ref={name === "to" ? toRef : undefined}
        type="text"
        inputMode="email"
        autoComplete="email"
        autoCapitalize="off"
        spellCheck={false}
        value={fields[name]}
        readOnly={locked}
        aria-invalid={problem?.field === name ? true : undefined}
        aria-describedby={[problem?.field === name && problemId, hint].filter(Boolean).join(" ") || undefined}
        onChange={change(name)}
        onBlur={() => void save()}
      />
    </div>
  );

  const saved = (
    <p className="compose-saved" role="status">
      {saving.status === "saving" ? strings.compose.saving : agent !== undefined ? strings.compose.savedBy(agent) : saving.status === "saved" ? strings.compose.saved(clock(saving.at)) : ""}
    </p>
  );
  const sheet = (
    <form
      ref={sheetRef}
      className={inThread === undefined ? "letter compose" : "letter compose compose-in-thread"}
      aria-labelledby={`${formId}-title`}
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      {inThread !== undefined && (
        <div className="compose-head">
          <h2 id={`${formId}-title`} className="compose-heading">
            {title}
          </h2>
          {saved}
        </div>
      )}
      <div className="compose-fields">
        {groups.length === 0 && fromChoices.length <= 1 ? (
          <div className="compose-field">
            <span className="compose-label">{strings.compose.from}</span>
            <span className="compose-from">{draft?.from ?? mailbox.defaultAddress}</span>
          </div>
        ) : (
          <div className="compose-field">
            <label htmlFor={`${formId}-from`}>{strings.compose.from}</label>
            <div className="compose-from-choice">
              <select
                id={`${formId}-from`}
                value={fields.from}
                disabled={locked}
                aria-describedby={asGroup ? `${formId}-from-hint` : undefined}
                onChange={(event) => chooseFrom(event.target.value)}
              >
                {fromChoices.map((address) => (
                  <option key={address} value={address}>
                    {address}
                  </option>
                ))}
                {groups.length > 0 && (
                  <optgroup label={strings.compose.asGroup}>
                    {groups.map((group) => (
                      <option key={group} value={group}>
                        {group}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              {asGroup && (
                <p className="hint" id={`${formId}-from-hint`}>
                  {strings.compose.asGroupHint}
                </p>
              )}
            </div>
          </div>
        )}
        {field("to", strings.compose.to, hintId)}
        {copies ? (
          <>
            {(!locked || fields.cc !== "") && field("cc", strings.compose.cc)}
            {(!locked || fields.bcc !== "") && field("bcc", strings.compose.bcc, `${formId}-bcc-hint`)}
          </>
        ) : (
          !locked && (
            <div className="compose-field">
              <span />
              <button type="button" className="link compose-copies" onClick={() => setCopies(true)}>
                {strings.compose.addCopies}
              </button>
            </div>
          )
        )}
        <p className="visually-hidden" id={hintId}>
          {strings.compose.toHint}
        </p>
        {copies && (
          <p className="visually-hidden" id={`${formId}-bcc-hint`}>
            {strings.compose.bccHint}
          </p>
        )}
        <div className="compose-field">
          <label htmlFor={`${formId}-subject`}>{strings.compose.subject}</label>
          <input id={`${formId}-subject`} type="text" className="compose-subject" value={fields.subject} readOnly={locked} onChange={change("subject")} onBlur={() => void save()} />
        </div>
      </div>
      <label htmlFor={`${formId}-text`} className="visually-hidden">
        {strings.compose.message}
      </label>
      <textarea ref={textRef} id={`${formId}-text`} className="compose-body" rows={12} value={fields.text} readOnly={locked} onChange={change("text")} onBlur={() => void save()} lang="" />
      {draft?.attachments !== undefined && draft.attachments.length > 0 && <Attachments list={draft.attachments} />}

      {problem !== undefined && (
        <p className="notice notice-alert" role="alert" id={problemId}>
          {problem.message}
        </p>
      )}
      {saving.status === "failed" && (
        <p className="notice notice-alert" role="alert">
          {strings.compose.saveFailed}
        </p>
      )}
      <Outcome draft={draft} agent={agent} slow={slow} base={base} sendNow={(draft) => <SendNow client={client} mailbox={mailbox.id} draft={draft} onSent={(sent) => sent !== undefined && setDraft(sent)} onSignedOut={onSignedOut} />} />
      {state !== "sent" && state !== "unclear" && state !== "waitingForLimit" && (
        <div className="compose-actions actions">
          <button type="submit" className="button button-primary" disabled={locked}>
            {busy === "sending" || state === "approved" || state === "sending" ? strings.compose.sending : state === "failed" ? strings.compose.sendAgain : strings.compose.send}
          </button>
          <button type="button" className="button button-quiet" disabled={locked} onClick={() => void remove()}>
            {busy === "deleting" ? strings.compose.deleting : strings.compose.delete}
          </button>
        </div>
      )}
    </form>
  );
  if (inThread !== undefined) return sheet;
  return (
    <main className="desk desk-reading">
      <Back draft={draft} base={base} />
      <div className="reading-head">
        <h1 ref={titleRef} id={`${formId}-title`} tabIndex={-1} className="view-title compose-title">
          {title}
        </h1>
        {saved}
      </div>
      {sheet}
    </main>
  );
}

/** Where the composer leads back to: the thread a reply answers, or the drafts. */
function Back({ draft, base }: { draft?: Draft; base: string }) {
  const thread = draft?.thread;
  return (
    <p className="back">
      <a href={thread === undefined ? `${base}drafts` : `${base}threads/${encodeURIComponent(thread)}`}>
        <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M10 3.5 5.5 8l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {thread === undefined ? strings.compose.backToDrafts : strings.compose.backToThread}
      </a>
    </p>
  );
}

/**
 * How the draft's send went, under the sheet. A send of `agent`'s that waits for its send limits
 * offers `sendNow`, which only the agent's sponsor, the mailbox's owner, can do.
 */
function Outcome({ draft, agent, slow, base, sendNow }: { draft?: Draft; agent?: string; slow: boolean; base: string; sendNow: (draft: string) => React.ReactNode }) {
  const send = draft?.send;
  if (send === undefined) return null;
  switch (send.state) {
    case "approved":
    case "sending":
      return (
        <div className="compose-outcome compose-on-its-way" role="status">
          <p>{strings.compose.sending}</p>
          {slow && <p className="compose-slow">{strings.compose.canLeave}</p>}
        </div>
      );
    case "waitingForLimit":
      return (
        <div className="compose-outcome compose-waiting">
          <p role="status">{strings.compose.waitingForLimit(agent)}</p>
          {sendNow(draft!.id)}
        </div>
      );
    case "sent":
      return (
        <div className="compose-outcome compose-sent" role="status">
          <SentIcon />
          <p>{strings.compose.sent}</p>
          {send.thread !== undefined && <a href={`${base}threads/${encodeURIComponent(send.thread)}`}>{strings.compose.openThread}</a>}
        </div>
      );
    case "failed":
      return (
        <div className="notice notice-alert" role="alert">
          <p>{strings.compose.refused}</p>
          {send.reason !== undefined && <p className="compose-reason">{strings.compose.serviceSaid(send.reason)}</p>}
        </div>
      );
    case "unclear":
      return (
        <p className="notice notice-alert" role="alert">
          {strings.compose.unclear}
        </p>
      );
    default:
      return null;
  }
}

/** A new message that went out, folded to a slip: the check, who it went to and its subject, and its thread. */
function SentSlip({ draft, base }: { draft: Draft; base: string }) {
  const recipients = [...draft.to, ...draft.cc, ...draft.bcc].map(({ name, address }) => name || address);
  const thread = draft.send?.thread;
  return (
    <div className="slip slip-sent compose-slip" role="status">
      <svg className="slip-icon" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <path d="m5 8.2 2 2 4-4.4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div>
        <p className="slip-head">{strings.compose.sentTo(recipients)}</p>
        <p className="slip-subject">{draft.subject || strings.thread.noSubject}</p>
        {thread !== undefined && (
          <p className="slip-result">
            <a href={`${base}threads/${encodeURIComponent(thread)}`}>{strings.compose.openThread}</a>
          </p>
        )}
      </div>
    </div>
  );
}

const SentIcon = () => (
  <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
    <path d="m3.5 8.5 3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
