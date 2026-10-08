// The Feed read as a stream: newsletters newest first, each message open in full, one under the
// next in a single column, the way a paper is read. Each says its subject, which opens its thread,
// and who sent it, which opens their sheet, and leaves out whom it was to, which is the mailbox. It takes the whole plane while nothing is open from it.
// Reading the stream marks what it shows read, and what was unread carries "New" while it is open.
import { useCallback, useEffect, useRef, useState } from "react";
import type { DuvaClient } from "@duva/client";
import type { components } from "@duva/openapi";
import type { Done, Label } from "./organize.tsx";
import { LabelPrompt } from "./tasks.tsx";
import { ViewMain, ViewTitle, useViewTitle } from "./panes.tsx";
import { strings } from "./strings.ts";
import { now, useReadMarks } from "./read-marks.ts";
import { Letter, unreadIn } from "./thread.tsx";
import { threadHref, type ThreadsView } from "./views.tsx";

type Mailbox = components["schemas"]["Mailbox"];
type Thread = components["schemas"]["Thread"];
type Message = components["schemas"]["Message"];

/** How many threads the stream reads at a time. */
const threadsRead = 20;
/** How many threads Duva marks read in one request at most. */
const threadsMarkedAtOnce = 100;

type Reading = { status: "loading" } | { status: "failed"; message: string } | { status: "read"; messages: { message: Message; thread: Thread }[]; next?: string };

/** The Feed of the mailbox whose Inbox is at `base`, read again whenever `version` grows. */
export function FeedStream({
  client,
  mailbox,
  base,
  me,
  agentNames,
  version,
  prompt,
  onDone,
  onSignedOut,
}: {
  client: DuvaClient;
  mailbox: Mailbox & { groups?: string[] };
  base: string;
  me: string;
  agentNames: ReadonlyMap<string, string>;
  version: number;
  /** The Feed as a label, with its prompt, in the human's own mailbox, whose mailbox agent its prompt gives tasks. */
  prompt?: Label;
  onDone: (done: Done) => void;
  onSignedOut: () => void;
}) {
  const [reading, setReading] = useState<Reading>({ status: "loading" });
  const [pages, setPages] = useState(1);
  const [failedDownload, setFailedDownload] = useState(false);
  // The messages that were unread when the stream showed them.
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const view: ThreadsView = { label: "feed" };
  useViewTitle(strings.title(strings.views.feed));
  const { saw, mark } = useReadMarks();

  // Only the latest read counts, so an older one that answers late changes nothing.
  const reads = useRef(0);
  const load = useCallback(async () => {
    const read = ++reads.current;
    const at = now();
    const threads: Thread[] = [];
    let after: string | undefined;
    for (let page = 0; page < pages; page++) {
      const { data, response } = await client
        .GET("/mailboxes/{mailbox}/threads", { params: { path: { mailbox: mailbox.id }, query: { label: "feed", limit: threadsRead, ...(after !== undefined && { after }) } } })
        .catch(() => ({ data: undefined, response: undefined }));
      if (response?.status === 401) return onSignedOut();
      if (read !== reads.current) return;
      if (data === undefined) return setReading({ status: "failed", message: response === undefined ? strings.feed.unreachable : strings.feed.failed(response.status) });
      const opened = await Promise.all(
        data.threads.map(async ({ id }) => (await client.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { mailbox: mailbox.id, thread: id } } }).catch(() => ({ data: undefined }))).data),
      );
      threads.push(...opened.filter((thread) => thread !== undefined));
      after = data.next;
      if (after === undefined) break;
    }
    const messages = threads.flatMap((thread) => thread.messages.map((message) => ({ message, thread }))).sort((a, b) => b.message.receivedAt.localeCompare(a.message.receivedAt));
    if (read !== reads.current) return;
    setReading({ status: "read", messages, next: after });
    for (const thread of threads) saw(mailbox.id, thread, at);
    const unread = threads.filter((thread) => thread.unread);
    if (unread.length === 0) return;
    setFresh((current) => new Set([...current, ...unread.flatMap(unreadIn)]));
    // The list and the counts show them read at once, and unread again if Duva refuses the mark.
    for (let start = 0; start < unread.length; start += threadsMarkedAtOnce) {
      const ids = unread.slice(start, start + threadsMarkedAtOnce).map(({ id }) => id);
      const sent = client.POST("/mailboxes/{mailbox}/threads/read", { params: { path: { mailbox: mailbox.id } }, body: { threads: ids } }).catch(() => ({ response: undefined }));
      const [answer] = await Promise.all(ids.map((id) => mark(mailbox.id, id, false, () => sent)));
      if (answer?.response?.status === 401) return onSignedOut();
    }
  }, [client, mailbox.id, pages, saw, mark, onSignedOut]);
  useEffect(() => {
    void load();
  }, [load, version]);

  const download = async (message: Message, index: number) => {
    const { data, response } = await client
      .GET("/mailboxes/{mailbox}/messages/{message}/attachments/{attachment}", { params: { path: { mailbox: mailbox.id, message: message.id, attachment: index } } })
      .catch(() => ({ data: undefined, response: undefined }));
    if (response?.status === 401) return onSignedOut();
    setFailedDownload(data === undefined);
    if (data === undefined) return;
    const link = document.createElement("a");
    link.href = data.url;
    link.click();
  };

  return (
    <ViewMain className="desk stream" aria-busy={reading.status === "loading"}>
      <div className="desk-head">
        <ViewTitle tabIndex={-1} className="view-title">
          {strings.views.feed}
        </ViewTitle>
        <p className="stream-order">{strings.feed.stream}</p>
      </div>
      {prompt !== undefined && <LabelPrompt client={client} mailbox={mailbox.id} label={prompt} onDone={onDone} onSignedOut={onSignedOut} />}
      {failedDownload && (
        <p className="notice notice-alert" role="alert">
          {strings.thread.downloadFailed}
        </p>
      )}
      {reading.status === "loading" ? (
        <div className="letter letter-skeleton" aria-hidden="true">
          <span className="line" style={{ width: "40%" }} />
          <span className="line" style={{ width: "75%" }} />
        </div>
      ) : reading.status === "failed" ? (
        <div className="notice notice-alert failed-listing" role="alert">
          <p>{reading.message}</p>
          <button type="button" className="button button-small" onClick={() => void load()}>
            {strings.inbox.retry}
          </button>
        </div>
      ) : reading.messages.length === 0 ? (
        <section className="empty" aria-labelledby="empty-title">
          <h2 id="empty-title">{strings.views.empty.feed.title}</h2>
          <p>{strings.views.empty.feed.lead}</p>
        </section>
      ) : (
        <>
          <ol className="stream-items" aria-label={strings.views.feed}>
            {reading.messages.map(({ message, thread }) => (
              <li key={message.id} className="stream-item">
                <p className="stream-subject">
                  <a href={threadHref(thread.id, view, base)}>{message.subject || strings.thread.noSubject}</a>
                </p>
                <Letter message={message} me={me} agentNames={agentNames} groups={mailbox.groups ?? []} threadSubject={message.subject} fresh={fresh.has(message.id)} onDownload={(index) => void download(message, index)} />
              </li>
            ))}
          </ol>
          {reading.next !== undefined && (
            <p className="stream-more">
              <button type="button" className="button button-small" onClick={() => setPages((count) => count + 1)}>
                {strings.feed.more}
              </button>
            </p>
          )}
        </>
      )}
    </ViewMain>
  );
}
