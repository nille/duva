// A thread, read in the reading pane: its tools along the top, the subject, then each message as a
// letter on the plane, oldest first, parted from the one before by a seam. Read and older messages
// fold to a line each, and the thread opens at the first unread one, or the newest. Opening the
// thread marks it read, for everyone who reads the mailbox. The newest message can be replied to or
// forwarded, in the composer raised at the thread's foot, and attachments downloaded. Opened from a
// search, it shows the message that matched.
import { type ReactNode, type Ref, useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import type { DuvaClient } from "@duva/client";
import type { components } from "@duva/openapi";
import { Composer, startDraft } from "./compose.tsx";
import { PreferencesContext, useDates } from "./dates.ts";
import { DesignedBody } from "./designed.tsx";
import { HeadersSheet } from "./headers.tsx";
import { Addresses, Attachments, Field, nameOf, SenderMark, Time } from "./mail-parts.tsx";
import { changeFor, type Done, type Label, organize, OrganizeActions, ownLabelsOf, SessionEnded } from "./organize.tsx";
import { now, useReadMarks } from "./read-marks.ts";
import { useSenderLink } from "./sender.tsx";
import { useShortcuts } from "./shortcuts.tsx";
import { strings } from "./strings.ts";
import { ThreadTasks } from "./tasks.tsx";

type Thread = components["schemas"]["Thread"];
type Message = components["schemas"]["Message"];
type Mailbox = components["schemas"]["Mailbox"];
type MailView = components["schemas"]["MailView"];

/** What the thread's foot starts: a reply, a reply to all, or a forward. */
type Start = "reply" | "replyAll" | "forward";

/** Whether the message went to more than one recipient, so it offers Reply all. */
const toSeveral = (message: Message) => message.to.length + message.cc.length > 1;

type Reading = { status: "loading" } | { status: "failed"; message: string; gone?: boolean } | { status: "read"; thread: Thread; fresh: Set<string> };

/** How many quoted lines in a row are shown before they fold. */
const quoteShown = 3;

/** How far the sender's own date may be from when a message arrived before the letter shows it too. */
const datedApart = 15 * 60_000;

/**
 * The messages of an unread thread that the human hasn't read, as far as the thread can tell: Duva
 * keeps one unread mark for the whole thread, so they are taken to be those that arrived after the
 * mailbox last sent in it.
 */
export function unreadIn(thread: Thread): string[] {
  if (!thread.unread) return [];
  const since = thread.messages.findLastIndex((message) => message.sentBy !== undefined);
  return thread.messages.slice(since + 1).map(({ id }) => id);
}

/** A subject without the Re: and Fwd: a reply or forward puts before it, in any of the usual languages. */
const bareSubject = (subject: string) =>
  subject
    .replace(/^(\s*(re|fwd?|fw|sv|vs|aw|wg|antw|vb|r)\s*(\[\d+\])?\s*:\s*)+/i, "")
    .trim()
    .toLowerCase();

/**
 * The thread with the ID in the human's mailbox. `agentNames` names the agents they sponsor by ID,
 * for the messages those agents sent. `version` counts the changes to the mailbox the app has
 * seen, so the thread is read again when it grows, and replies that arrive while it's open show.
 * `back` is the view it was opened from, named `backTo`, where archiving, Spam, Trash and restoring
 * return to, telling `onDone` what was done. `matched` is the message a search found, which the
 * thread opens at, marked for a moment.
 */
export function ThreadView({
  client,
  mailbox,
  id,
  matched,
  me,
  agentNames,
  labels,
  back,
  backTo,
  version,
  onDone,
  onSignedOut,
}: {
  client: DuvaClient;
  /** The mailbox, with the groups its owner can send as, when the list of mailboxes gave them. */
  mailbox: Mailbox & { groups?: string[] };
  id: string;
  matched?: string;
  me: string;
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
  // The messages shown open besides the newest: those unread when the thread opened, the one a
  // search found, those that arrived while it's open, and those the human opened.
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  // The message the thread opens at: the one a search found, the first unread one, or the newest.
  const [openAt, setOpenAt] = useState<string>();
  // The draft at the thread's foot, by what it is, while it's started and once it's there, or whether starting one failed.
  const [replying, setReplying] = useState<{ start: Start; draft?: string } | "failed">();
  // The attachment on its way, by its message and place, or whether getting one failed.
  const [downloading, setDownloading] = useState<{ message: string; index: number } | "failed">();
  // Whether the phone's action bar shows the rest of the thread's actions.
  const [more, setMore] = useState(false);
  // The message whose headers are open in their sheet, if one's are.
  const [headersOf, setHeadersOf] = useState<string>();
  const leaving = useRef(false);
  // Every request to mark the thread read still on its way, which marking it unread waits for, so the human's choice lands last.
  const markingRead = useRef<Promise<unknown>>(Promise.resolve());
  const readingRef = useRef(reading);
  readingRef.current = reading;

  const { saw, mark } = useReadMarks();
  const load = useCallback(async () => {
    const at = now();
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
        message: response === undefined ? strings.thread.unreachable : response.status === 404 ? strings.thread.gone : strings.thread.failed,
      });
    }
    const known = before.status === "read" ? new Set(before.thread.messages.map((message) => message.id)) : undefined;
    // What the human sent from here is no news to them.
    const fresh = known === undefined ? [] : data.messages.filter((message) => !known.has(message.id) && message.sentBy !== me).map((message) => message.id);
    if (known === undefined) {
      const unread = unreadIn(data);
      const found = data.messages.some((message) => message.id === matched) ? matched : undefined;
      setOpened(new Set([...unread, ...(found === undefined ? [] : [found])]));
      setOpenAt(found ?? unread[0] ?? data.messages.at(-1)?.id);
    } else if (fresh.length > 0) {
      setOpened((current) => new Set([...current, ...fresh]));
    }
    setReading({ status: "read", thread: data, fresh: new Set(fresh) });
    saw(mailbox.id, data, at);
    // Reading the thread on screen marks it read, also when a reply arrives while it's open, until the human marks it unread.
    if (data.unread && !leaving.current) {
      // The list and the counts show it read at once, and unread again if Duva refuses the mark.
      const read = mark(mailbox.id, id, false, () =>
        client.POST("/mailboxes/{mailbox}/threads/read", { params: { path: { mailbox: mailbox.id } }, body: { threads: [id] } }).catch(() => ({ response: undefined })),
      );
      markingRead.current = Promise.all([markingRead.current, read]);
      const { response: marked } = await read;
      if (marked?.status === 401) return onSignedOut();
      setMarking(marked?.ok ? "idle" : "readFailed");
    }
  }, [client, mailbox.id, id, matched, me, saw, mark, onSignedOut]);

  useEffect(() => {
    void load();
  }, [load, version]);

  const titleRef = useRef<HTMLHeadingElement>(null);
  const subject = reading.status === "read" ? reading.thread.subject || strings.thread.noSubject : undefined;
  useEffect(() => {
    if (subject !== undefined) document.title = strings.title(subject);
  }, [subject]);
  // The thread opens at the message a search found, focused and marked for a moment, or further
  // down at its first unread message or its newest. At its first message, the web app focuses its
  // subject, as every view's title.
  const loaded = reading.status === "read";
  const openAtRef = useRef<HTMLElement>(null);
  const [marked, setMarked] = useState(false);
  useEffect(() => {
    if (!loaded) return;
    const letter = openAtRef.current;
    const first = readingRef.current.status === "read" ? readingRef.current.thread.messages[0]?.id : undefined;
    if (letter === null || (openAt === first && openAt !== matched)) return;
    letter.focus({ preventScroll: true });
    // A letter already in the upper part of the screen is read where it is, under the subject.
    if (letter.getBoundingClientRect().top > innerHeight * 0.4) letter.scrollIntoView({ block: "start" });
    if (openAt !== matched) return;
    setMarked(true);
    const unmark = setTimeout(() => setMarked(false), 2_000);
    return () => clearTimeout(unmark);
    // Only once, when the thread first shows.
  }, [loaded]);

  const markUnread = async () => {
    setMarking("busy");
    leaving.current = true;
    // The list and the counts show it unread at once, though the request waits for the marks read still on their way.
    const { response } = await mark(mailbox.id, id, true, async () => {
      await markingRead.current;
      return client.POST("/mailboxes/{mailbox}/threads/unread", { params: { path: { mailbox: mailbox.id } }, body: { threads: [id] } }).catch(() => ({ response: undefined }));
    });
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

  // Archiving and Trash from the phone's action bar, as the thread's toolbar does them.
  const [moving, setMoving] = useState<"idle" | "busy" | "failed">("idle");
  const move = async (thread: Thread, change: { add?: string[]; remove?: string[] }, message: (count: number) => string) => {
    setMoving("busy");
    try {
      const done = await organize(client, mailbox.id, [thread], change, message);
      if (done === undefined) return setMoving("failed");
      setMoving("idle");
      organized(done, true);
    } catch (error) {
      if (!(error instanceof SessionEnded)) throw error;
      setMoving("idle");
      onSignedOut();
    }
  };

  const reply = async (message: Message, start: Start) => {
    setReplying({ start });
    setMore(false);
    if (readingRef.current.status === "read") before.current = readingRef.current.thread.messages.length;
    const body = start === "forward" ? { forwards: message.id } : { answers: message.id, ...(start === "replyAll" && { replyAll: true }) };
    const draft = await startDraft(client, mailbox.id, body, onSignedOut);
    setReplying(draft === undefined ? "failed" : { start, draft });
  };

  // Once the reply went out, the thread reads again, and focus goes to the reply once it is there.
  // A letter opened from its slug takes focus too, since the slug it was opened from is gone.
  const lettersRef = useRef<HTMLOListElement>(null);
  const focusAfter = useRef<{ messages: number } | { message: string }>(undefined);
  // How many messages the thread had when the reply started, so the reply is known when it arrives, whichever read brings it.
  const before = useRef(0);
  const replied = useCallback(() => {
    focusAfter.current = { messages: before.current };
    setReplying(undefined);
    void load();
  }, [load]);
  const open = (message: string) => {
    focusAfter.current = { message };
    setOpened((current) => new Set([...current, message]));
  };
  // A reply deleted gives the focus back to Reply.
  const focusReply = useRef(false);
  const replyRef = useRef<HTMLButtonElement>(null);
  const closed = useCallback(() => {
    focusReply.current = true;
    setReplying(undefined);
  }, []);
  useEffect(() => {
    if (focusReply.current && replying === undefined) {
      focusReply.current = false;
      replyRef.current?.focus();
    }
    const after = focusAfter.current;
    if (after === undefined || reading.status !== "read") return;
    const messages = reading.thread.messages;
    const message = "message" in after ? after.message : messages.length > after.messages ? messages.at(-1)!.id : undefined;
    const letter = message === undefined ? null : lettersRef.current?.querySelector<HTMLElement>(`article[data-message="${CSS.escape(message)}"]`);
    if (letter == null) return;
    focusAfter.current = undefined;
    letter.focus({ preventScroll: true });
    letter.scrollIntoView({ block: "nearest" });
  }, [reading, replying, opened]);

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

  // Escape closes More, and gives focus back to it.
  const actionsId = useId();
  const moreRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!more) return;
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMore(false);
      moreRef.current?.focus();
    };
    addEventListener("keydown", close);
    return () => removeEventListener("keydown", close);
  }, [more]);

  // A key's cap shows, and its control says it, only while the human's shortcuts are on.
  const keys = useContext(PreferencesContext).keyboardShortcuts !== "off";
  const key = (pressed: string) => (keys ? pressed : undefined);
  const thread = reading.status === "read" ? reading.thread : undefined;
  const newest = thread?.messages.at(-1);
  const composing = typeof replying === "object" && replying.draft !== undefined;
  // Archiving and Trash at the thread's foot, where the thread's toolbar offers them.
  const moveFor = (action: "archive" | "trash") => {
    const what = thread === undefined ? undefined : changeFor(action, [thread], { thread: true });
    return thread === undefined || what === undefined ? undefined : () => void move(thread, what.change, what.message);
  };
  const archive = moveFor("archive");
  const trash = moveFor("trash");
  const busy = moving === "busy";

  // Spam is offered where the thread is neither in Spam nor in Trash, as its toolbar offers it.
  const spam =
    thread === undefined || thread.labels.includes("spam") || thread.labels.includes("trash") ? undefined : () => void move(thread, { add: ["spam"] }, strings.organize.spammed);

  // r, a and f start what Reply, Reply all and Forward start, while the newest message offers them
  // and no reply is under way, e, # and ! do what Archive, Trash and Mark as spam do, while no move
  // is, Shift+U marks the thread unread, and u goes back to the list, as Escape does.
  const answerable = !composing && typeof replying !== "object" ? newest : undefined;
  const startOn = (start: Start, offered = true) => (answerable === undefined || !offered ? undefined : () => void reply(answerable, start));
  useShortcuts({
    r: startOn("reply"),
    a: startOn("replyAll", answerable !== undefined && toSeveral(answerable)),
    f: startOn("forward"),
    e: busy ? undefined : archive,
    "#": busy ? undefined : trash,
    "!": busy ? undefined : spam,
    U: thread === undefined || marking === "busy" ? undefined : () => void markUnread(),
    u: () => (location.hash = back),
  });

  return (
    <main className={composing ? "desk desk-reading thread-composing" : "desk desk-reading"} aria-busy={reading.status === "loading"}>
      <div className="reading-tools">
        <p className="back">
          <a href={back} aria-keyshortcuts={key("u")}>
            <BackIcon />
            {keys && <kbd aria-hidden="true">u</kbd>}
            <span className="back-name">{backTo}</span>
          </a>
        </p>
        {thread !== undefined && (
          <div id={actionsId} className={more ? "reading-actions reading-actions-open" : "reading-actions"} role="toolbar" aria-label={strings.organize.threadToolbar}>
            <OrganizeActions client={client} mailbox={mailbox} threads={[thread]} labels={labels} place={{ thread: true }} keys={keys} onDone={organized} onSignedOut={onSignedOut} />
            <button type="button" className="button button-small" aria-keyshortcuts={key("Shift+U")} disabled={marking === "busy"} onClick={() => void markUnread()}>
              {keys && <kbd aria-hidden="true">⇧U</kbd>}
              {marking === "busy" ? strings.thread.markingUnread : strings.thread.markUnread}
            </button>
            {more && newest !== undefined && (
              <span className="reading-actions-replies">
                <ReplyButtons message={newest} replying={replying} keys={keys} onReply={(start) => void reply(newest, start)} />
              </span>
            )}
          </div>
        )}
        {keys && (
          <p className="reading-keys" aria-hidden="true">
            <kbd>j</kbd>
            <kbd>k</kbd>
            {strings.thread.nextPrevious}
          </p>
        )}
      </div>
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
            <div className="reading-meta">
              <p>{strings.thread.count(reading.thread.messages.length)}</p>
              <ThreadLabels thread={reading.thread} labels={labels} />
              <SetAside thread={reading.thread} />
            </div>
          </div>
          <ThreadTasks tasks={reading.thread.tasks} />
          {(marking === "failed" || marking === "readFailed") && (
            <p className="notice notice-alert" role="alert">
              {marking === "failed" ? strings.thread.markFailed : strings.thread.markReadFailed}
            </p>
          )}
          {downloading === "failed" && (
            <p className="notice notice-alert" role="alert">
              {strings.thread.downloadFailed}
            </p>
          )}
          <ol ref={lettersRef} className="letters" aria-label={strings.thread.messages}>
            {reading.thread.messages.map((message) => {
              const isNewest = message === newest;
              const letterRef = message.id === openAt ? openAtRef : undefined;
              const props = {
                message,
                ref: letterRef,
                me,
                agentNames,
                groups: mailbox.groups ?? [],
              };
              return (
                <li key={message.id}>
                  {isNewest || opened.has(message.id) ? (
                    <Letter
                      {...props}
                      marked={marked && message.id === matched}
                      threadSubject={reading.thread.subject}
                      fresh={reading.fresh.has(message.id)}
                      downloading={typeof downloading === "object" && downloading.message === message.id ? downloading.index : undefined}
                      onDownload={(index) => void download(message, index)}
                      onShowHeaders={() => setHeadersOf(message.id)}
                    >
                      {isNewest && !composing && (
                        <div className="letter-actions">
                          <ReplyButtons message={message} replying={replying} keys={keys} firstRef={replyRef} onReply={(start) => void reply(message, start)} />
                        </div>
                      )}
                    </Letter>
                  ) : (
                    <FoldedLetter {...props} onOpen={() => open(message.id)} />
                  )}
                </li>
              );
            })}
          </ol>
          {replying === "failed" && (
            <p className="notice notice-alert thread-foot" role="alert">
              {strings.compose.startFailed}
            </p>
          )}
          {composing && (
            <div className="thread-foot">
              <Composer
                  key={replying.draft}
                  client={client}
                  mailbox={mailbox}
                  id={replying.draft}
                  agentNames={agentNames}
                  version={version}
                  inThread={{ onSent: replied, onClosed: closed }}
                  onSignedOut={onSignedOut}
                />
            </div>
          )}
          {headersOf !== undefined && <HeadersSheet client={client} mailbox={mailbox.id} message={headersOf} onClose={() => setHeadersOf(undefined)} onSignedOut={onSignedOut} />}
          {!composing && (
            <div className="thread-bar" role="toolbar" aria-label={strings.thread.bar}>
              {newest !== undefined && (
                <button type="button" className="button button-small button-primary" disabled={typeof replying === "object"} onClick={() => void reply(newest, "reply")}>
                  <ReplyIcon />
                  {typeof replying === "object" && replying.start === "reply" ? strings.thread.starting : strings.thread.reply}
                </button>
              )}
              {archive !== undefined && (
                <button type="button" className="button button-small" disabled={busy} onClick={archive}>
                  <ArchiveIcon />
                  {strings.organize.archive}
                </button>
              )}
              {trash !== undefined && (
                <button type="button" className="button button-small" aria-label={strings.organize.trash} disabled={busy} onClick={trash}>
                  <TrashIcon />
                  {strings.thread.trashShort}
                </button>
              )}
              <button ref={moreRef} type="button" className="button button-small thread-bar-more" aria-expanded={more} aria-controls={actionsId} onClick={() => setMore(!more)}>
                <MoreIcon />
                {strings.thread.more}
              </button>
              {moving === "failed" && (
                <p className="notice notice-alert thread-bar-failed" role="alert">
                  {strings.organize.failed}
                </p>
              )}
            </div>
          )}
        </>
      )}
    </main>
  );
}

/** Reply, Reply all when the message has more than one recipient, and Forward, each saying while its draft is being started, with its key's cap. */
function ReplyButtons({
  message,
  replying,
  keys,
  firstRef,
  onReply,
}: {
  message: Message;
  replying: { start: Start; draft?: string } | "failed" | undefined;
  /** Whether the human's shortcuts are on, so each button shows its key's cap and says its key. */
  keys: boolean;
  firstRef?: Ref<HTMLButtonElement>;
  onReply: (start: Start) => void;
}) {
  const starting = typeof replying === "object" ? replying.start : undefined;
  const busy = starting !== undefined;
  return (
    <>
      <button ref={firstRef} type="button" className="button button-primary" aria-keyshortcuts={keys ? "r" : undefined} disabled={busy} onClick={() => onReply("reply")}>
        <ReplyIcon />
        {starting === "reply" ? strings.thread.starting : strings.thread.reply}
        {keys && <kbd aria-hidden="true">r</kbd>}
      </button>
      {toSeveral(message) && (
        <button type="button" className="button" aria-keyshortcuts={keys ? "a" : undefined} disabled={busy} onClick={() => onReply("replyAll")}>
          <ReplyAllIcon />
          {starting === "replyAll" ? strings.thread.starting : strings.thread.replyAll}
          {keys && <kbd aria-hidden="true">a</kbd>}
        </button>
      )}
      <button type="button" className="button" aria-keyshortcuts={keys ? "f" : undefined} disabled={busy} onClick={() => onReply("forward")}>
        <ForwardIcon />
        {starting === "forward" ? strings.thread.starting : strings.thread.forward}
        {keys && <kbd aria-hidden="true">f</kbd>}
      </button>
    </>
  );
}

/** When the thread set aside comes back, or that it came back and when it was set aside. */
function SetAside({ thread }: { thread: Thread }) {
  const { when, day } = useDates();
  if (thread.reminder !== undefined) return <p className="reading-remind">{strings.remind.threadUntil(when(new Date(thread.reminder.at)))}</p>;
  if (thread.back !== undefined) return <p className="reading-remind reading-back">{strings.remind.threadBack(day(new Date(thread.back.setAsideAt)))}</p>;
  return null;
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

/** Who sent the message from the mailbox, if anyone did: the human, an agent they sponsor by name, or another member as a group. */
function sentMarkOf(message: Message, me: string, agentNames: ReadonlyMap<string, string>, groups: string[]): string | undefined {
  const agent = message.sentBy === undefined ? undefined : agentNames.get(message.sentBy);
  // A message sent from the mailbox as a group says which (ADR-0019).
  const from = message.from.address.toLowerCase();
  const as = message.sentBy !== undefined && groups.includes(from) ? from : undefined;
  return message.sentAs !== undefined
    ? strings.thread.sentBy(message.sentAs.name, message.sentAs.group)
    : message.sentBy === undefined
      ? undefined
      : message.sentBy === me
        ? strings.thread.sentByYou(as)
        : agent === undefined
          ? strings.thread.sentFromMailbox
          : strings.thread.sentBy(agent, as);
}

/** Who sent the message, by shape: an agent, as Duva knows it or as one the human sponsors, or else a human, as anyone writing from outside is. */
function actorOf(message: Message, agentNames: ReadonlyMap<string, string>): "human" | "agent" {
  if (message.fromAgent) return "agent";
  return message.sentAs === undefined && message.sentBy !== undefined && agentNames.has(message.sentBy) ? "agent" : "human";
}

/** The props a letter takes, open or folded. */
interface LetterProps {
  message: Message;
  /** The letter's sheet, for the message the thread opens at, or the newest. */
  ref?: Ref<HTMLElement>;
  me: string;
  agentNames: ReadonlyMap<string, string>;
  /** The groups the mailbox's owner can send as, so a message sent as one says so. */
  groups: string[];
}

/** The start of what a message says, on one line, without what it quotes. */
const snippetOf = (text: string) =>
  text
    .split("\n")
    .filter((line) => !line.trimStart().startsWith(">"))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);

/** A read or older message folded to a line, as a slug: who sent it, the start of what it says, and when it arrived. It opens on click or Enter. */
function FoldedLetter({ message, ref, me, agentNames, groups, onOpen }: LetterProps & { onOpen: () => void }) {
  const fromId = useId();
  const sent = sentMarkOf(message, me, agentNames, groups);
  return (
    <article ref={ref} className="letter letter-folded" tabIndex={ref === undefined ? undefined : -1} aria-labelledby={fromId}>
      <h2 className="letter-slug-title">
        <button type="button" className="letter-slug" aria-expanded={false} onClick={onOpen}>
          <SenderMark kind={actorOf(message, agentNames)} agent={message.sentBy} logo={message.logo} name={nameOf(message.from)} />
          <span className="letter-slug-from" id={fromId}>
            {nameOf(message.from)}
          </span>
          {sent && <span className="letter-slug-mark">{sent}</span>}
          <span className="letter-slug-snippet" lang="">
            {snippetOf(message.text)}
          </span>
          <span className="letter-slug-date">
            <Time at={message.receivedAt} short />
          </span>
        </button>
      </h2>
    </article>
  );
}

/**
 * A message as a sheet, saying who sent it from the mailbox, if anyone did: the human, or an agent
 * they sponsor, named. Its subject shows only when it differs from the thread's. `downloading` says
 * which of its attachments is on its way, if one is.
 */
export function Letter({
  message,
  ref,
  marked = false,
  me,
  agentNames,
  groups,
  threadSubject,
  fresh,
  downloading,
  onDownload,
  onShowHeaders,
  children,
}: LetterProps & {
  marked?: boolean;
  threadSubject: string;
  fresh: boolean;
  downloading?: number;
  onDownload: (index: number) => void;
  /** Opens the message's headers, which its menu offers when given. */
  onShowHeaders?: () => void;
  /** What the letter ends in, as the newest's replies. */
  children?: ReactNode;
}) {
  const titleId = useId();
  const senderLink = useSenderLink();
  // A message with HTML shows as the human prefers until they switch it.
  const { mailView } = useContext(PreferencesContext);
  const [switched, setSwitched] = useState<MailView>();
  const view = message.html === undefined ? "text" : (switched ?? mailView);
  const sent = sentMarkOf(message, me, agentNames, groups);
  const actor = actorOf(message, agentNames);
  // The letter shows when the message arrived, as the lists do, and the sender's own date too when it's far from that.
  const dated = Math.abs(new Date(message.date).getTime() - new Date(message.receivedAt).getTime()) > datedApart;
  return (
    <article
      ref={ref}
      className={["letter", fresh ? "letter-fresh" : sent && "letter-sent", sent && actor === "agent" && "letter-by-agent", marked && "letter-matched"].filter(Boolean).join(" ")}
      data-message={message.id}
      tabIndex={-1}
      aria-labelledby={titleId}
    >
      <header className="letter-head">
        <SenderMark kind={actor} agent={message.sentBy} logo={message.logo} name={nameOf(message.from)} />
        <h2 className="letter-from" id={titleId}>
          {senderLink === undefined || message.sentBy !== undefined ? (
            <From from={message.from} />
          ) : (
            // Who sent it opens their sheet, where the human decides where their mail goes.
            <button type="button" className="letter-sender" onClick={() => (location.hash = senderLink(message.from.address))}>
              <From from={message.from} />
            </button>
          )}
        </h2>
        <p className="letter-meta">
          {fresh && <span className="mark-new">{strings.thread.isNew}</span>}
          {sent && <span className="letter-sent-mark">{sent}</span>}
          <Time at={message.receivedAt} />
          {dated && (
            <span className="letter-dated">
              <Time at={message.date} format={strings.thread.dated} />
            </span>
          )}
        </p>
        {onShowHeaders !== undefined && <LetterMenu onShowHeaders={onShowHeaders} />}
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
        {bareSubject(message.subject) !== bareSubject(threadSubject) && (
          <Field label={strings.thread.subject}>
            <span className="letter-subject">{message.subject || strings.thread.noSubject}</span>
          </Field>
        )}
      </dl>
      {message.approval !== undefined && <p className="letter-note">{approvalNote(message.approval, me)}</p>}
      {message.group !== undefined && <p className="letter-note">{strings.thread.toGroup(message.group)}</p>}
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
      {children}
    </article>
  );
}

/**
 * The message's menu, a quiet key at the letter's head that opens Show headers. Escape or a click
 * elsewhere closes it, and picking gives the focus back to its key, where the sheet returns it.
 */
function LetterMenu({ onShowHeaders }: { onShowHeaders: () => void }) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const wrapper = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    first.current?.focus();
    const away = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  return (
    <div
      ref={wrapper}
      className="picker letter-menu"
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          close();
        }
      }}
      onBlur={(event) => {
        if (open && !wrapper.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={button}
        type="button"
        className="button button-small button-quiet letter-menu-button"
        aria-label={strings.thread.messageMenu}
        aria-haspopup="menu"
        // Said only while open, as a menu button may, so the letter has no other control that reads as folded.
        aria-expanded={open || undefined}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen(!open)}
      >
        <MoreIcon />
      </button>
      {open && (
        <div className="picker-panel letter-menu-panel" id={menuId} role="menu" aria-label={strings.thread.messageMenu}>
          <button
            ref={first}
            type="button"
            role="menuitem"
            className="letter-menu-item"
            onClick={() => {
              close();
              onShowHeaders();
            }}
          >
            {strings.thread.showHeaders}
          </button>
        </div>
      )}
    </div>
  );
}

/** Who sent a message: their name, then their address, or the address alone. */
const From = ({ from }: { from: Message["from"] }) => (
  <>
    {nameOf(from)}
    {from.name && (
      <>
        {" "}
        <span className="address">{from.address}</span>
      </>
    )}
  </>
);

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

const ArchiveIcon = () => (
  <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M2.5 3.5h11v3h-11zM3.5 6.5v6h9v-6M6.5 9h3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const TrashIcon = () => (
  <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M2.5 4.5h11M6 4.5V3h4v1.5M4 4.5l.7 8.5h6.6l.7-8.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const MoreIcon = () => (
  <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M3.5 8h.01M8 8h.01M12.5 8h.01" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
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

export const BackIcon = () => (
  <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M10 3.5 5.5 8l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
