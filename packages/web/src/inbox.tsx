// The Inbox: a mailbox's threads with the Inbox label, newest first, a page at a time, laid on one
// sheet like the index of a bundle of proofs. Unread threads carry the pencil's mark.
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { DuvaClient } from "@duva/client";
import type { components } from "@duva/openapi";
import type { Connection as ConnectionState } from "./feed.ts";
import { Connection, day, nameOf, Time } from "./mail-parts.tsx";
import { strings } from "./strings.ts";

type ThreadSummary = components["schemas"]["ThreadSummary"];
type Mailbox = components["schemas"]["Mailbox"];

/** How many threads a page of the Inbox lists. */
export const pageSize = 25;

type Listing =
  | { status: "loading" }
  | { status: "failed"; message: string }
  | { status: "listed"; threads: ThreadSummary[]; next?: string; pages: number; fresh: Set<string> };

/** A failure the human can act on: the session ended, or Duva couldn't list the threads. */
class ListingFailed extends Error {}

/**
 * The mailbox's Inbox, the human's own or, with the agent's name, an agent's they sponsor, at
 * `base` in the web app. `version` counts the changes to the mailbox the app has seen, so the
 * listing reads its pages again when it grows.
 */
export function Inbox({
  client,
  mailbox,
  base,
  agent,
  version,
  connection,
  onSignedOut,
}: {
  client: DuvaClient;
  mailbox: Mailbox;
  base: string;
  agent?: string;
  version: number;
  connection: ConnectionState;
  onSignedOut: () => void;
}) {
  const [listing, setListing] = useState<Listing>({ status: "loading" });
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const listingRef = useRef(listing);
  listingRef.current = listing;

  const page = useCallback(
    async (after?: string) => {
      const { data, response } = await client
        .GET("/mailboxes/{mailbox}/threads", { params: { path: { mailbox: mailbox.id }, query: { limit: pageSize, after } } })
        .catch(() => ({ data: undefined, response: undefined }));
      if (response?.status === 401) {
        onSignedOut();
        throw new ListingFailed();
      }
      if (data === undefined) throw new ListingFailed(response === undefined ? strings.inbox.unreachable : strings.inbox.failed(response.status));
      return data;
    },
    [client, mailbox.id, onSignedOut],
  );

  // How many pages the human asked to see, and which read is the latest, so an older one that ends later is dropped.
  const wanted = useRef(1);
  const generation = useRef(0);

  /**
   * Reads the pages wanted, from the first, so new threads join at the top and read state is
   * current. Threads that weren't shown and are newer than the last one shown have arrived since.
   * Answers false if this read failed, and true if it listed the threads or a later read took over.
   */
  const load = useCallback(
    async ({ arrivals }: { arrivals: boolean }) => {
      const mine = ++generation.current;
      const threads: ThreadSummary[] = [];
      let next: string | undefined;
      let read = 0;
      try {
        do {
          const answer = await page(next);
          threads.push(...answer.threads);
          next = answer.next;
          read++;
        } while (read < wanted.current && next !== undefined);
      } catch (error) {
        if (mine !== generation.current) return true;
        if (!(error instanceof ListingFailed) || error.message === "") return false;
        // A listing on screen stays there, and the connection line says when Duva can't be reached.
        if (listingRef.current.status === "listed") setAnnouncement(error.message);
        else setListing({ status: "failed", message: error.message });
        return false;
      }
      if (mine !== generation.current) return true;
      const before = listingRef.current;
      const shown = before.status === "listed" ? before.threads : [];
      const known = new Set(shown.map(({ id }) => id));
      const oldest = shown.at(-1)?.latestAt ?? "";
      const arrived = before.status === "listed" && arrivals ? threads.filter(({ id, latestAt }) => !known.has(id) && latestAt >= oldest).map(({ id }) => id) : [];
      if (arrived.length > 0) setAnnouncement(strings.inbox.arrived(arrived.length));
      setListing({ status: "listed", threads, next, pages: read, fresh: new Set(arrived) });
      return true;
    },
    [page],
  );

  useEffect(() => {
    void load({ arrivals: true });
  }, [load, version]);

  const older = async () => {
    if (listing.status !== "listed" || listing.next === undefined) return;
    wanted.current = listing.pages + 1;
    setLoadingOlder(true);
    // If the page can't be read, later reads keep to the pages shown.
    if (!(await load({ arrivals: false }))) wanted.current = listing.pages;
    setLoadingOlder(false);
  };

  const unread = listing.status === "listed" ? listing.threads.filter((thread) => thread.unread).length : 0;
  const title = agent === undefined ? strings.inbox.title : strings.inbox.agentTitle(agent);
  useEffect(() => {
    document.title = strings.title(unread > 0 ? `${title} (${unread})` : title);
  }, [title, unread]);

  return (
    <main className="desk" aria-busy={listing.status === "loading"}>
      <div className="desk-head">
        <h1 tabIndex={-1} className="view-title">
          {title}
        </h1>
        {listing.status === "listed" && unread > 0 && <p className="count">{strings.inbox.unread(unread, listing.next !== undefined)}</p>}
        <p className="mailbox-address">{mailbox.defaultAddress}</p>
        <Connection state={connection} unreachable={strings.connection.mailUnreachable} />
      </div>
      <p className="visually-hidden" role="status">
        {announcement}
      </p>
      {listing.status === "loading" ? (
        <SkeletonIndex />
      ) : listing.status === "failed" ? (
        <div className="notice notice-alert failed-listing" role="alert">
          <p>{listing.message}</p>
          <button type="button" className="button button-small" onClick={() => void load({ arrivals: false })}>
            {strings.inbox.retry}
          </button>
        </div>
      ) : listing.threads.length === 0 ? (
        <section className="empty" aria-labelledby="empty-title">
          <h2 id="empty-title">{agent === undefined ? strings.inbox.emptyTitle : strings.inbox.agentEmptyTitle(agent)}</h2>
          <p>{strings.inbox.emptyLead(mailbox.defaultAddress)}</p>
        </section>
      ) : (
        <div className="index">
          <ol className="threads" aria-label={strings.inbox.threads}>
            {listing.threads.map((thread) => (
              <ThreadRow key={thread.id} thread={thread} href={`${base}threads/${encodeURIComponent(thread.id)}`} fresh={listing.fresh.has(thread.id)} />
            ))}
          </ol>
          {listing.next !== undefined && (
            <div className="index-foot">
              <button type="button" className="button" disabled={loadingOlder} onClick={() => void older()}>
                {loadingOlder ? strings.inbox.loadingOlder : strings.inbox.older}
              </button>
            </div>
          )}
        </div>
      )}
    </main>
  );
}

function ThreadRow({ thread, href, fresh }: { thread: ThreadSummary; href: string; fresh: boolean }) {
  const snippetId = useId();
  const sender = nameOf(thread.from);
  const subject = thread.subject || strings.thread.noSubject;
  const label = [thread.unread && strings.inbox.unreadMark, sender, subject, thread.messages > 1 && strings.inbox.messages(thread.messages), day(new Date(thread.latestAt))]
    .filter(Boolean)
    .join(", ");
  return (
    <li className={fresh ? "thread-row thread-fresh" : "thread-row"}>
      <a className={thread.unread ? "thread thread-unread" : "thread"} href={href} aria-label={label} aria-describedby={snippetId}>
        <span className="thread-mark" aria-hidden="true" />
        <span className="thread-sender">
          <span className="thread-sender-name">{sender}</span>
          {thread.messages > 1 && <span className="thread-count">{thread.messages}</span>}
        </span>
        <span className="thread-text">
          <span className="thread-subject">{subject}</span>
          {thread.snippet !== "" && (
            <span className="thread-snippet" id={snippetId} lang="">
              {thread.snippet}
            </span>
          )}
        </span>
        <span className="thread-date">
          <Time at={thread.latestAt} short />
        </span>
      </a>
    </li>
  );
}

function SkeletonIndex() {
  return (
    <div className="index index-skeleton" aria-hidden="true">
      {[0, 1, 2, 3].map((row) => (
        <div className="thread" key={row}>
          <span className="line" style={{ width: "60%" }} />
          <span className="line" style={{ width: `${70 - row * 9}%` }} />
          <span className="line" style={{ width: "3rem" }} />
        </div>
      ))}
    </div>
  );
}
