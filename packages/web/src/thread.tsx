// A thread, read: each message a sheet on the desk, oldest first, set in the proof face. Opening
// the thread marks it read, for everyone who reads the mailbox. Each message can be replied to.
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { DuvaClient } from "@duva/client";
import type { components } from "@duva/openapi";
import { startDraft } from "./compose.tsx";
import { Addresses, Field, nameOf, Time } from "./mail-parts.tsx";
import { size, strings } from "./strings.ts";

type Thread = components["schemas"]["Thread"];
type Message = components["schemas"]["Message"];
type Mailbox = components["schemas"]["Mailbox"];

type Reading = { status: "loading" } | { status: "failed"; message: string; gone?: boolean } | { status: "read"; thread: Thread; fresh: Set<string> };

/** How many quoted lines in a row are shown before they fold. */
const quoteShown = 3;

/**
 * The thread with the ID in the mailbox whose Inbox is at `base`, the human's own or, with the
 * agent's name, an agent's they sponsor. `version` counts the changes to the mailbox the app has
 * seen, so the thread is read again when it grows, and replies that arrive while it's open show.
 */
export function ThreadView({
  client,
  mailbox,
  base,
  id,
  me,
  agent,
  version,
  onSignedOut,
}: {
  client: DuvaClient;
  mailbox: Mailbox;
  base: string;
  id: string;
  me: string;
  agent?: string;
  version: number;
  onSignedOut: () => void;
}) {
  const [reading, setReading] = useState<Reading>({ status: "loading" });
  const [marking, setMarking] = useState<"idle" | "busy" | "failed" | "readFailed">("idle");
  // The reply being started, by its message and whether it goes to all, or whether starting one failed.
  const [replying, setReplying] = useState<{ message: string; all: boolean } | "failed">();
  const leaving = useRef(false);
  const readingRef = useRef(reading);
  readingRef.current = reading;

  const load = useCallback(async () => {
    const { data, response } = await client
      .GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { mailbox: mailbox.id, thread: id } } })
      .catch(() => ({ data: undefined, response: undefined }));
    if (response?.status === 401) return onSignedOut();
    const before = readingRef.current;
    if (data === undefined) {
      // A thread on screen stays there when a later read fails.
      if (before.status === "read" && response?.status !== 404) return;
      return setReading({
        status: "failed",
        gone: response?.status === 404,
        message: response === undefined ? strings.thread.unreachable : response.status === 404 ? strings.thread.gone : strings.thread.failed(response.status),
      });
    }
    const known = before.status === "read" ? new Set(before.thread.messages.map((message) => message.id)) : undefined;
    setReading({ status: "read", thread: data, fresh: new Set(known === undefined ? [] : data.messages.filter((message) => !known.has(message.id)).map((message) => message.id)) });
    // Reading the thread on screen marks it read, also when a reply arrives while it's open, until the human marks it unread.
    if (data.unread && !leaving.current) {
      const { response: marked } = await client.POST("/mailboxes/{mailbox}/threads/read", { params: { path: { mailbox: mailbox.id } }, body: { threads: [id] } }).catch(() => ({ response: undefined }));
      if (marked?.status === 401) return onSignedOut();
      setMarking(marked?.ok ? "idle" : "readFailed");
    }
  }, [client, mailbox.id, id, onSignedOut]);

  useEffect(() => {
    void load();
  }, [load, version]);

  const titleRef = useRef<HTMLHeadingElement>(null);
  const subject = reading.status === "read" ? reading.thread.subject || strings.thread.noSubject : undefined;
  useEffect(() => {
    if (subject !== undefined) document.title = strings.title(subject);
  }, [subject]);
  // The thread opens with its subject focused, so a screen reader starts there.
  const loaded = reading.status === "read";
  useEffect(() => {
    if (loaded) titleRef.current?.focus();
  }, [loaded]);

  const markUnread = async () => {
    setMarking("busy");
    leaving.current = true;
    const { response } = await client.POST("/mailboxes/{mailbox}/threads/unread", { params: { path: { mailbox: mailbox.id } }, body: { threads: [id] } }).catch(() => ({ response: undefined }));
    if (response?.status === 401) return onSignedOut();
    if (!response?.ok) {
      leaving.current = false;
      return setMarking("failed");
    }
    location.hash = base;
  };

  const reply = async (message: Message, all: boolean) => {
    setReplying({ message: message.id, all });
    const started = await startDraft(client, mailbox.id, { answers: message.id, ...(all && { replyAll: true }) }, onSignedOut);
    if (!started) setReplying("failed");
  };

  return (
    <main className="desk desk-reading" aria-busy={reading.status === "loading"}>
      <p className="back">
        <a href={base}>
          <BackIcon />
          {agent === undefined ? strings.thread.back : strings.inbox.agentTitle(agent)}
        </a>
      </p>
      {reading.status === "loading" ? (
        <div className="letter letter-skeleton" aria-hidden="true">
          <span className="line" style={{ width: "40%" }} />
          <span className="line" style={{ width: "75%" }} />
          <span className="line" style={{ width: "65%" }} />
        </div>
      ) : reading.status === "failed" ? (
        <div className="notice notice-alert failed-listing" role="alert">
          <p>{reading.message}</p>
          {!reading.gone && (
            <button type="button" className="button button-small" onClick={() => void load()}>
              {strings.inbox.retry}
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="reading-head">
            <h1 ref={titleRef} tabIndex={-1} className="view-title reading-title">
              {subject}
            </h1>
            <div className="reading-actions">
              <button type="button" className="button button-small" disabled={marking === "busy"} onClick={() => void markUnread()}>
                {marking === "busy" ? strings.thread.markingUnread : strings.thread.markUnread}
              </button>
            </div>
          </div>
          {(marking === "failed" || marking === "readFailed") && (
            <p className="notice notice-alert" role="alert">
              {marking === "failed" ? strings.thread.markFailed : strings.thread.markReadFailed}
            </p>
          )}
          {replying === "failed" && (
            <p className="notice notice-alert" role="alert">
              {strings.compose.startFailed}
            </p>
          )}
          <ol className="letters" aria-label={strings.thread.messages}>
            {reading.thread.messages.map((message) => (
              <li key={message.id}>
                <Letter
                  message={message}
                  me={me}
                  agent={agent}
                  fresh={reading.fresh.has(message.id)}
                  starting={typeof replying === "object" && replying.message === message.id ? replying.all : undefined}
                  busy={typeof replying === "object"}
                  onReply={agent === undefined ? (all) => void reply(message, all) : undefined}
                />
              </li>
            ))}
          </ol>
        </>
      )}
    </main>
  );
}

/**
 * A message as a sheet. `starting` says which reply to it is being started, if one is: to all or
 * not. Without `onReply`, as in an agent's mailbox, where only the agent drafts, it has no replies.
 */
function Letter({
  message,
  me,
  agent,
  fresh,
  starting,
  busy,
  onReply,
}: {
  message: Message;
  me: string;
  agent?: string;
  fresh: boolean;
  starting?: boolean;
  busy: boolean;
  onReply?: (all: boolean) => void;
}) {
  const titleId = useId();
  const sent =
    message.sentBy === undefined ? undefined : message.sentBy === me ? strings.thread.sentByYou : agent === undefined ? strings.thread.sentFromMailbox : strings.thread.sentBy(agent);
  return (
    <article className={fresh ? "letter letter-fresh" : sent ? "letter letter-sent" : "letter"} aria-labelledby={titleId}>
      <header className="letter-head">
        <h2 className="letter-from" id={titleId}>
          {nameOf(message.from)}
          {message.from.name && <span className="address">{message.from.address}</span>}
        </h2>
        <p className="letter-meta">
          {fresh && <span className="mark-new">{strings.thread.isNew}</span>}
          {sent && <span className="letter-sent-mark">{sent}</span>}
          <Time at={message.date} />
        </p>
      </header>
      <dl className="letter-fields">
        <Field label={strings.thread.to}>
          <Addresses list={message.to} />
        </Field>
        {message.cc.length > 0 && (
          <Field label={strings.thread.cc}>
            <Addresses list={message.cc} />
          </Field>
        )}
        {message.bcc !== undefined && (
          <Field label={strings.thread.bcc}>
            <Addresses list={message.bcc} />
          </Field>
        )}
        <Field label={strings.thread.subject}>
          <span className="letter-subject">{message.subject || strings.thread.noSubject}</span>
        </Field>
      </dl>
      {message.approval !== undefined && <p className="letter-note">{approvalNote(message.approval, me)}</p>}
      {message.plusTag !== undefined && <p className="letter-note">{strings.thread.plusTag(message.recipient, message.plusTag)}</p>}
      <Body text={message.text} />
      {message.attachments.length > 0 && (
        <section className="letter-attachments" aria-label={strings.thread.attachments}>
          <ul>
            {message.attachments.map((attachment, index) => (
              <li key={index}>
                <ClipIcon />
                <span className="attachment-name">{attachment.name ?? strings.thread.unnamed}</span>{" "}
                <span className="attachment-meta">{strings.thread.attachment(attachment.type, size(attachment.size))}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {onReply !== undefined && (
      <div className="letter-actions">
        <button type="button" className="button button-small" disabled={busy} onClick={() => onReply(false)}>
          <ReplyIcon />
          {starting === false ? strings.thread.starting : strings.thread.reply}
        </button>
        {message.to.length + message.cc.length > 1 && (
          <button type="button" className="button button-small" disabled={busy} onClick={() => onReply(true)}>
            <ReplyAllIcon />
            {starting === true ? strings.thread.starting : strings.thread.replyAll}
          </button>
        )}
      </div>
      )}
    </article>
  );
}

/** Who approved an agent's message before it went out, and what they changed. */
function approvalNote({ approver, edits }: NonNullable<Message["approval"]>, me: string): string {
  if (approver !== me) return strings.thread.approvedBySponsor;
  const changed = (["to", "subject", "text"] as const).filter((field) => edits?.[field] !== undefined).map((field) => strings.galley.fieldNames[field]);
  return changed.length === 0 ? strings.thread.approvedAsIs : strings.thread.approvedEdited(changed);
}

const ReplyIcon = () => (
  <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M6.5 4 2.5 8l4 4M2.5 8h6.5a4.5 4.5 0 0 1 4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const ReplyAllIcon = () => (
  <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M8 4 4 8l4 4M4.5 4 .8 8l3.7 4M4 8h5.5a4.5 4.5 0 0 1 4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** A run of the text: what the sender wrote, or lines they quoted. */
type Run = { quoted: boolean; lines: string[] };

/** The text in runs of written and quoted lines, so long quotes can fold. */
function runsOf(text: string): Run[] {
  const runs: Run[] = [];
  for (const line of text.split("\n")) {
    const quoted = line.trimStart().startsWith(">");
    const last = runs.at(-1);
    if (last?.quoted === quoted) last.lines.push(line);
    else runs.push({ quoted, lines: [line] });
  }
  return runs;
}

function Body({ text }: { text: string }) {
  return (
    <div className="body letter-body" lang="">
      {runsOf(text).map((run, index, runs) => {
        const lines = run.lines.join("\n") + (index < runs.length - 1 ? "\n" : "");
        return run.quoted && run.lines.length > quoteShown ? <FoldedQuote key={index} text={lines} /> : <span key={index}>{lines}</span>;
      })}
    </div>
  );
}

function FoldedQuote({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="quote">
      <button type="button" className="link quote-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        {open ? strings.thread.hideQuoted : strings.thread.showQuoted}
      </button>
      <span id={id} className="quote-text" hidden={!open}>
        {text}
      </span>
    </span>
  );
}

const BackIcon = () => (
  <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M10 3.5 5.5 8l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const ClipIcon = () => (
  <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
    <path
      d="M10.5 5.5 6.2 9.8a1.2 1.2 0 0 0 1.7 1.7l4.6-4.6a2.6 2.6 0 0 0-3.7-3.7L4.2 7.8a4 4 0 0 0 5.7 5.7l3.6-3.6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
