// A thread, read: each message a sheet on the desk, oldest first, set in the proof face. Opening
// the thread marks it read, for everyone who reads the mailbox. Each message can be replied to or
// forwarded, and its attachments downloaded.
import { useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import type { DuvaClient } from "@duva/client";
import type { components } from "@duva/openapi";
import { startDraft } from "./compose.tsx";
import { PreferencesContext } from "./dates.ts";
import { DesignedBody } from "./designed.tsx";
import { Addresses, Attachments, Field, nameOf, Time } from "./mail-parts.tsx";
import { type Done, type Label, OrganizeActions, ownLabelsOf } from "./organize.tsx";
import { strings } from "./strings.ts";

type Thread = components["schemas"]["Thread"];
type Message = components["schemas"]["Message"];
type Mailbox = components["schemas"]["Mailbox"];
type MailView = components["schemas"]["MailView"];

/** What a letter's foot starts: a reply, a reply to all, or a forward. */
type Start = "reply" | "replyAll" | "forward";

type Reading = { status: "loading" } | { status: "failed"; message: string; gone?: boolean } | { status: "read"; thread: Thread; fresh: Set<string> };

/** How many quoted lines in a row are shown before they fold. */
const quoteShown = 3;

/**
 * The thread with the ID in the mailbox, the human's own or, with the agent's name, an agent's
 * they sponsor, where the human has no replies. `agentNames` names the agents they sponsor by ID,
 * for the messages those agents sent. `version` counts the changes to the mailbox the app has
 * seen, so the thread is read again when it grows, and replies that arrive while it's open show.
 * `back` is the view it was opened from, named `backTo`, where archiving, Spam, Trash and restoring
 * return to, telling `onDone` what was done.
 */
export function ThreadView({
  client,
  mailbox,
  id,
  me,
  agent,
  agentNames,
  labels,
  back,
  backTo,
  version,
  onDone,
  onSignedOut,
}: {
  client: DuvaClient;
  mailbox: Mailbox;
  id: string;
  me: string;
  agent?: string;
  agentNames: ReadonlyMap<string, string>;
  labels: Label[];
  back: string;
  backTo: string;
  version: number;
  onDone: (done: Done) => void;
  onSignedOut: () => void;
}) {
  const [reading, setReading] = useState<Reading>({ status: "loading" });
  const [marking, setMarking] = useState<"idle" | "busy" | "failed" | "readFailed">("idle");
  // The draft being started, by its message and what it is, or whether starting one failed.
  const [replying, setReplying] = useState<{ message: string; start: Start } | "failed">();
  // The attachment on its way, by its message and place, or whether getting one failed.
  const [downloading, setDownloading] = useState<{ message: string; index: number } | "failed">();
  const leaving = useRef(false);
  // Every request to mark the thread read still on its way, which marking it unread waits for, so the human's choice lands last.
  const markingRead = useRef<Promise<unknown>>(Promise.resolve());
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
      const read = client.POST("/mailboxes/{mailbox}/threads/read", { params: { path: { mailbox: mailbox.id } }, body: { threads: [id] } }).catch(() => ({ response: undefined }));
      markingRead.current = Promise.all([markingRead.current, read]);
      const { response: marked } = await read;
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
    await markingRead.current;
    const { response } = await client.POST("/mailboxes/{mailbox}/threads/unread", { params: { path: { mailbox: mailbox.id } }, body: { threads: [id] } }).catch(() => ({ response: undefined }));
    if (response?.status === 401) return onSignedOut();
    if (!response?.ok) {
      leaving.current = false;
      return setMarking("failed");
    }
    location.hash = back;
  };

  const organized = (done: Done, moved: boolean) => {
    if (moved) {
      leaving.current = true;
      // What was done is said in the view the human returns to.
      location.hash = back;
      onDone(done);
    } else {
      onDone(done);
      void load();
    }
  };

  const reply = async (message: Message, start: Start) => {
    setReplying({ message: message.id, start });
    const body = start === "forward" ? { forwards: message.id } : { answers: message.id, ...(start === "replyAll" && { replyAll: true }) };
    const started = await startDraft(client, mailbox.id, body, onSignedOut);
    if (!started) setReplying("failed");
  };

  // Duva gives a link that works for a few minutes, and the browser saves what it leads to.
  const download = async (message: Message, index: number) => {
    setDownloading({ message: message.id, index });
    const { data, response } = await client
      .GET("/mailboxes/{mailbox}/messages/{message}/attachments/{attachment}", { params: { path: { mailbox: mailbox.id, message: message.id, attachment: index } } })
      .catch(() => ({ data: undefined, response: undefined }));
    if (response?.status === 401) return onSignedOut();
    if (data === undefined) return setDownloading("failed");
    setDownloading(undefined);
    const link = document.createElement("a");
    link.href = data.url;
    link.click();
  };

  return (
    <main className="desk desk-reading" aria-busy={reading.status === "loading"}>
      <p className="back">
        <a href={back}>
          <BackIcon />
          {backTo}
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
            <div className="reading-actions" role="toolbar" aria-label={strings.organize.threadToolbar}>
              <OrganizeActions client={client} mailbox={mailbox} threads={[reading.thread]} labels={labels} place={{ thread: true }} onDone={organized} onSignedOut={onSignedOut} />
              <button type="button" className="button button-small" disabled={marking === "busy"} onClick={() => void markUnread()}>
                {marking === "busy" ? strings.thread.markingUnread : strings.thread.markUnread}
              </button>
            </div>
          </div>
          <ThreadLabels thread={reading.thread} labels={labels} />
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
          {downloading === "failed" && (
            <p className="notice notice-alert" role="alert">
              {strings.thread.downloadFailed}
            </p>
          )}
          <ol className="letters" aria-label={strings.thread.messages}>
            {reading.thread.messages.map((message) => (
              <li key={message.id}>
                <Letter
                  message={message}
                  me={me}
                  agentNames={agentNames}
                  owner={agent === undefined ? undefined : { id: mailbox.owner, name: agent }}
                  fresh={reading.fresh.has(message.id)}
                  starting={typeof replying === "object" && replying.message === message.id ? replying.start : undefined}
                  busy={typeof replying === "object"}
                  onReply={agent === undefined ? (start) => void reply(message, start) : undefined}
                  downloading={typeof downloading === "object" && downloading.message === message.id ? downloading.index : undefined}
                  onDownload={(index) => void download(message, index)}
                />
              </li>
            ))}
          </ol>
        </>
      )}
    </main>
  );
}

/** Where the thread is: Spam or Trash, and the human's own labels on it. */
function ThreadLabels({ thread, labels }: { thread: Thread; labels: Label[] }) {
  const names = [
    ...(thread.labels.includes("spam") ? [strings.views.spam] : []),
    ...(thread.labels.includes("trash") ? [strings.views.trash] : []),
    ...ownLabelsOf(thread, labels).map(({ name }) => name),
  ];
  if (names.length === 0) return null;
  return (
    <ul className="reading-labels" aria-label={strings.thread.labels}>
      {names.map((name) => (
        <li key={name} className="label-name">
          {name}
        </li>
      ))}
    </ul>
  );
}

/**
 * A message as a sheet, saying who sent it from the mailbox, if anyone did: the human, or an agent
 * they sponsor, named. `starting` says which draft from it is being started, if one is. Without
 * `onReply`, as in an agent's mailbox, where only the agent drafts, it has no replies or forward.
 * `downloading` says which of its attachments is on its way, if one is.
 */
function Letter({
  message,
  me,
  agentNames,
  owner,
  fresh,
  starting,
  busy,
  onReply,
  downloading,
  onDownload,
}: {
  message: Message;
  me: string;
  agentNames: ReadonlyMap<string, string>;
  /** In an agent's mailbox, the agent, by the name the mailbox list gave it, for when its name isn't among `agentNames`. */
  owner?: { id: string; name: string };
  fresh: boolean;
  starting?: Start;
  busy: boolean;
  onReply?: (start: Start) => void;
  downloading?: number;
  onDownload: (index: number) => void;
}) {
  const titleId = useId();
  // A message with HTML shows as the human prefers until they switch it.
  const { mailView } = useContext(PreferencesContext);
  const [switched, setSwitched] = useState<MailView>();
  const view = message.html === undefined ? "text" : (switched ?? mailView);
  const agent = message.sentBy === undefined ? undefined : (agentNames.get(message.sentBy) ?? (message.sentBy === owner?.id ? owner.name : undefined));
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
      {view === "html" ? <DesignedBody html={message.html!} title={strings.thread.designed(nameOf(message.from))} /> : <Body text={message.text} />}
      {message.html !== undefined && (
        <p className="letter-view">
          {view === "html" && message.removedTrackers !== undefined && message.removedTrackers.length > 0 && (
            <span className="letter-trackers">{strings.thread.removedTrackers(message.removedTrackers)}</span>
          )}
          <button type="button" className="link" onClick={() => setSwitched(view === "html" ? "text" : "html")}>
            {view === "html" ? strings.thread.showAsText : strings.thread.showAsDesigned}
          </button>
        </p>
      )}
      {message.attachments.length > 0 && <Attachments list={message.attachments} onDownload={onDownload} downloading={downloading} />}
      {onReply !== undefined && (
        <div className="letter-actions">
          <button type="button" className="button button-small" disabled={busy} onClick={() => onReply("reply")}>
            <ReplyIcon />
            {starting === "reply" ? strings.thread.starting : strings.thread.reply}
          </button>
          {message.to.length + message.cc.length > 1 && (
            <button type="button" className="button button-small" disabled={busy} onClick={() => onReply("replyAll")}>
              <ReplyAllIcon />
              {starting === "replyAll" ? strings.thread.starting : strings.thread.replyAll}
            </button>
          )}
          <button type="button" className="button button-small" disabled={busy} onClick={() => onReply("forward")}>
            <ForwardIcon />
            {starting === "forward" ? strings.thread.starting : strings.thread.forward}
          </button>
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

const ForwardIcon = () => (
  <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M9.5 4 13.5 8l-4 4M13.5 8H7a4.5 4.5 0 0 0-4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
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
