// A view's threads, newest first, a page at a time, laid on one sheet like the index of a bundle of
// proofs: the Inbox, a label's, Sent, All mail, Spam or Trash. Unread threads carry the pencil's mark, and
// the human picks threads to organize several at once.
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { DuvaClient } from "@duva/client";
import type { components } from "@duva/openapi";
import type { Connection as ConnectionState } from "./feed.ts";
import { Connection, day, nameOf, Time } from "./mail-parts.tsx";
import { type Done, type Label, labelRefusal, OrganizeActions, ownLabelsOf } from "./organize.tsx";
import { strings } from "./strings.ts";
import { pathOf, titleOf, type View } from "./views.tsx";

type ThreadSummary = components["schemas"]["ThreadSummary"];
type ThreadList = components["schemas"]["ThreadList"];
type Mailbox = components["schemas"]["Mailbox"];

/** How many threads a page of a view lists. */
export const pageSize = 25;

type Listing =
  | { status: "loading" }
  | { status: "failed"; message: string }
  | { status: "listed"; threads: ThreadSummary[]; next?: string; pages: number; fresh: Set<string> };

/** A failure the human can act on: the session ended, or Duva couldn't list the threads. */
class ListingFailed extends Error {}

/**
 * The view's threads, in the human's own mailbox or, with the agent's name, an agent's they
 * sponsor, whose Inbox is at `base` in the web app. `version` counts the changes to the mailbox the
 * app has seen, so the listing reads its pages again when it changes. `done` is what the human last did, said at the head with
 * a way to undo it, and `onDone` hears each new thing they do.
 */
export function ThreadIndex({
  client,
  mailbox,
  base,
  agent,
  view,
  labels,
  version,
  connection,
  done,
  onDone,
  onSignedOut,
}: {
  client: DuvaClient;
  mailbox: Mailbox;
  base: string;
  agent?: string;
  view: View;
  labels: Label[];
  version: number;
  connection: ConnectionState;
  done: Done | undefined;
  onDone: (done: Done | undefined) => void;
  onSignedOut: () => void;
}) {
  const [listing, setListing] = useState<Listing>({ status: "loading" });
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const listingRef = useRef(listing);
  listingRef.current = listing;
  const title = titleOf(view, labels, agent);
  const label = "label" in view ? view.label : undefined;

  const page = useCallback(
    async (after?: string): Promise<ThreadList> => {
      const query = { limit: pageSize, after };
      const path = { mailbox: mailbox.id };
      const { data, response } = await (label !== undefined
        ? client.GET("/mailboxes/{mailbox}/threads", { params: { path, query: { ...query, label } } })
        : "sent" in view
          ? client.GET("/mailboxes/{mailbox}/sent", { params: { path, query } })
          : client.GET("/mailboxes/{mailbox}/all-mail", { params: { path, query } })
      ).catch(() => ({ data: undefined, response: undefined }));
      if (response?.status === 401) {
        onSignedOut();
        throw new ListingFailed();
      }
      if (data === undefined) throw new ListingFailed(response === undefined ? strings.inbox.unreachable : strings.inbox.failed(response.status));
      return data;
    },
    // The view's kind, not the object, so a new route to the same view reads nothing again.
    [client, mailbox.id, label, "sent" in view, onSignedOut],
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
      // Threads that left the view are no longer picked.
      const listed = new Set(threads.map(({ id }) => id));
      setSelected((current) => (Array.from(current).every((id) => listed.has(id)) ? current : new Set(Array.from(current).filter((id) => listed.has(id)))));
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

  // Sent lists what was written from the mailbox, so it counts nothing unread.
  const unread = listing.status === "listed" && !("sent" in view) ? listing.threads.filter((thread) => thread.unread).length : 0;
  useEffect(() => {
    document.title = strings.title(unread > 0 ? `${title} (${unread})` : title);
  }, [title, unread]);

  const threads = listing.status === "listed" ? listing.threads : [];
  const picked = threads.filter(({ id }) => selected.has(id));
  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  // Threads that leave the view are no longer picked, and those that stay are, so labelling can go on.
  const organized = (what: Done, moved: boolean) => {
    if (moved) setSelected(new Set());
    onDone(what);
    void load({ arrivals: false });
  };

  const [undoing, setUndoing] = useState(false);
  const undo = async () => {
    if (done?.undo === undefined || undoing) return;
    setUndoing(true);
    const undone = await done.undo().catch(() => false);
    setUndoing(false);
    onDone(undone ? { message: strings.organize.undone } : { message: strings.organize.undoFailed });
    void load({ arrivals: false });
  };

  const ownLabel = label === undefined ? undefined : labels.find((each) => each.id === label && !each.builtIn);

  return (
    <main className="desk" aria-busy={listing.status === "loading"}>
      <div className="desk-head">
        {ownLabel === undefined ? (
          <h1 tabIndex={-1} className="view-title">
            {title}
          </h1>
        ) : (
          <LabelHead client={client} mailbox={mailbox} base={base} label={ownLabel} onDone={onDone} onSignedOut={onSignedOut} />
        )}
        {listing.status === "listed" && unread > 0 && <p className="count">{strings.inbox.unread(unread, listing.next !== undefined)}</p>}
        {label === "trash" && threads.length > 0 && (
          <EmptyTrash
            client={client}
            mailbox={mailbox}
            onEmptied={() => {
              // The eraser erases them right after Duva answers, and the change feed says when each is gone.
              setSelected(new Set());
              setListing({ status: "listed", threads: [], pages: 1, fresh: new Set() });
              onDone({ message: strings.trash.emptied });
            }}
            onSignedOut={onSignedOut}
          />
        )}
        <p className="mailbox-address">{mailbox.defaultAddress}</p>
        <Connection state={connection} unreachable={strings.connection.mailUnreachable} />
      </div>
      <p className="visually-hidden" role="status">
        {announcement}
      </p>
      <div className="done-line" role="status">
        {done !== undefined && (
          <>
            <span>{done.message}</span>
            {done.undo !== undefined && (
              <button type="button" className="link" disabled={undoing} onClick={() => void undo()}>
                {strings.organize.undo}
              </button>
            )}
          </>
        )}
      </div>
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
        <Empty view={view} mailbox={mailbox} agent={agent} />
      ) : (
        <div className="index">
          <div className="index-tools" role="toolbar" aria-label={strings.organize.toolbar}>
            <label className="pick pick-all">
              <input
                type="checkbox"
                checked={picked.length === threads.length}
                ref={(input) => {
                  if (input) input.indeterminate = picked.length > 0 && picked.length < threads.length;
                }}
                onChange={() => setSelected(picked.length === threads.length ? new Set() : new Set(threads.map(({ id }) => id)))}
              />
              <span className={picked.length > 0 ? "pick-count" : "visually-hidden"}>{picked.length > 0 ? strings.organize.selected(picked.length) : strings.organize.selectAll}</span>
            </label>
            {picked.length > 0 && (
              <div className="index-actions">
                <OrganizeActions client={client} mailbox={mailbox} threads={picked} labels={labels} place={"label" in view ? { label: view.label } : { all: true }} onDone={organized} onSignedOut={onSignedOut} />
              </div>
            )}
          </div>
          <ol className="threads" aria-label={strings.inbox.threads}>
            {listing.threads.map((thread) => (
              <ThreadRow
                key={thread.id}
                thread={thread}
                labels={labels}
                view={view}
                href={`${base}threads/${encodeURIComponent(thread.id)}?from=${encodeURIComponent(pathOf(view))}`}
                fresh={listing.fresh.has(thread.id)}
                selected={selected.has(thread.id)}
                onToggle={() => toggle(thread.id)}
              />
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

/** What an empty view says, in its own words. */
function Empty({ view, mailbox, agent }: { view: View; mailbox: Mailbox; agent?: string }) {
  const copy =
    "all" in view
      ? strings.views.empty.all
      : "sent" in view
        ? agent === undefined
          ? { title: strings.sent.emptyTitle, lead: strings.sent.emptyLead }
          : { title: strings.sent.agentEmptyTitle(agent), lead: strings.sent.agentEmptyLead(agent) }
        : view.label === "inbox"
        ? { title: agent === undefined ? strings.inbox.emptyTitle : strings.inbox.agentEmptyTitle(agent), lead: strings.inbox.emptyLead(mailbox.defaultAddress) }
        : view.label === "spam"
          ? strings.views.empty.spam
          : view.label === "trash"
            ? strings.views.empty.trash
            : strings.views.empty.label;
  return (
    <section className="empty" aria-labelledby="empty-title">
      <h2 id="empty-title">{copy.title}</h2>
      <p>{copy.lead}</p>
    </section>
  );
}

/** Emptying Trash, which erases its threads for good, once the human confirms it in place. */
function EmptyTrash({ client, mailbox, onEmptied, onSignedOut }: { client: DuvaClient; mailbox: Mailbox; onEmptied: () => void; onSignedOut: () => void }) {
  const [state, setState] = useState<{ status: "shown" | "confirming" | "busy" } | { status: "failed"; message: string }>({ status: "shown" });

  const empty = async () => {
    setState({ status: "busy" });
    const { data, response } = await client.POST("/mailboxes/{mailbox}/trash/empty", { params: { path: { mailbox: mailbox.id } } }).catch(() => ({ data: undefined, response: undefined }));
    if (response?.status === 401) return onSignedOut();
    if (data === undefined) return setState({ status: "failed", message: response === undefined ? strings.trash.unreachable : strings.trash.failed(response.status) });
    setState({ status: "shown" });
    onEmptied();
  };

  return (
    <div className="label-tools">
      {state.status === "shown" ? (
        <button type="button" className="button button-small button-quiet" onClick={() => setState({ status: "confirming" })}>
          {strings.trash.empty}
        </button>
      ) : (
        <div className="confirm" role="group" aria-label={strings.trash.empty}>
          <p>{strings.trash.confirm}</p>
          <button type="button" className="button button-small button-reject" disabled={state.status === "busy"} onClick={() => void empty()}>
            {state.status === "busy" ? strings.trash.erasing : strings.trash.erase}
          </button>
          <button type="button" className="button button-small button-quiet" onClick={() => setState({ status: "shown" })}>
            {strings.trash.cancel}
          </button>
        </div>
      )}
      {state.status === "failed" && (
        <p className="field-error" role="alert">
          {state.message}
        </p>
      )}
    </div>
  );
}

/** The head of one of the human's own labels: its name, and renaming or deleting it in place. */
function LabelHead({
  client,
  mailbox,
  base,
  label,
  onDone,
  onSignedOut,
}: {
  client: DuvaClient;
  mailbox: Mailbox;
  base: string;
  label: Label;
  onDone: (done: Done) => void;
  onSignedOut: () => void;
}) {
  const [mode, setMode] = useState<"shown" | "renaming" | "deleting">("shown");
  const [name, setName] = useState(label.name);
  const [state, setState] = useState<{ status: "idle" | "busy" } | { status: "failed"; message: string }>({ status: "idle" });
  const fieldId = useId();
  const errorId = useId();
  const path = { mailbox: mailbox.id, label: label.id };

  const rename = async () => {
    if (name.trim() === "") return setState({ status: "failed", message: strings.labelForm.missing });
    setState({ status: "busy" });
    const { data, response } = await client
      .PATCH("/mailboxes/{mailbox}/labels/{label}", { params: { path }, body: { name: name.trim() } })
      .catch(() => ({ data: undefined, response: undefined }));
    if (response?.status === 401) return onSignedOut();
    if (data === undefined) return setState({ status: "failed", message: labelRefusal(response?.status, name.trim()) });
    setState({ status: "idle" });
    setMode("shown");
    onDone({ message: strings.labelForm.renamed(data.name) });
  };

  const remove = async () => {
    setState({ status: "busy" });
    const { data, response } = await client.DELETE("/mailboxes/{mailbox}/labels/{label}", { params: { path } }).catch(() => ({ data: undefined, response: undefined }));
    if (response?.status === 401) return onSignedOut();
    if (data === undefined) return setState({ status: "failed", message: response === undefined ? strings.labelForm.unreachable : strings.labelForm.failed(response.status) });
    location.hash = base;
    onDone({ message: strings.labelForm.deleted(label.name) });
  };

  if (mode === "renaming") {
    return (
      <form
        className="label-form label-rename"
        onSubmit={(event) => {
          event.preventDefault();
          void rename();
        }}
      >
        <h1 className="visually-hidden">{label.name}</h1>
        <label htmlFor={fieldId}>{strings.labelForm.renameLabel(label.name)}</label>
        <div className="label-form-row">
          <input
            id={fieldId}
            type="text"
            value={name}
            maxLength={100}
            autoComplete="off"
            autoFocus
            aria-invalid={state.status === "failed"}
            aria-describedby={state.status === "failed" ? errorId : undefined}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setMode("shown");
            }}
          />
          <button type="submit" className="button button-small" disabled={state.status === "busy"}>
            {strings.labelForm.save}
          </button>
          <button type="button" className="button button-small button-quiet" onClick={() => setMode("shown")}>
            {strings.labelForm.cancel}
          </button>
        </div>
        {state.status === "failed" && (
          <p className="field-error" id={errorId} role="alert">
            {state.message}
          </p>
        )}
      </form>
    );
  }

  return (
    <>
      <h1 tabIndex={-1} className="view-title">
        {label.name}
      </h1>
      <div className="label-tools">
        {mode === "deleting" ? (
          <div className="confirm" role="group" aria-label={strings.labelForm.deleteLabel}>
            <p>{strings.labelForm.confirmDelete(label.name)}</p>
            <button type="button" className="button button-small button-reject" disabled={state.status === "busy"} onClick={() => void remove()}>
              {state.status === "busy" ? strings.labelForm.deleting : strings.labelForm.deleteLabel}
            </button>
            <button type="button" className="button button-small button-quiet" onClick={() => setMode("shown")}>
              {strings.labelForm.cancel}
            </button>
          </div>
        ) : (
          <>
            <button
              type="button"
              className="button button-small button-quiet"
              onClick={() => {
                setName(label.name);
                setState({ status: "idle" });
                setMode("renaming");
              }}
            >
              {strings.labelForm.rename}
            </button>
            <button type="button" className="button button-small button-quiet" onClick={() => setMode("deleting")}>
              {strings.labelForm.deleteLabel}
            </button>
          </>
        )}
        {state.status === "failed" && mode === "deleting" && (
          <p className="field-error" role="alert">
            {state.message}
          </p>
        )}
      </div>
    </>
  );
}

function ThreadRow({
  thread,
  labels,
  view,
  href,
  fresh,
  selected,
  onToggle,
}: {
  thread: ThreadSummary;
  labels: Label[];
  view: View;
  href: string;
  fresh: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  const snippetId = useId();
  const sender = nameOf(thread.from);
  const subject = thread.subject || strings.thread.noSubject;
  // A row names the thread's own labels, but not the one the view lists.
  const named = ownLabelsOf(thread, labels).filter((each) => !("label" in view) || each.id !== view.label);
  const label = [
    thread.unread && strings.inbox.unreadMark,
    sender,
    subject,
    thread.messages > 1 && strings.inbox.messages(thread.messages),
    named.length > 0 && strings.inbox.labelled(named.map(({ name }) => name)),
    day(new Date(thread.latestAt)),
  ]
    .filter(Boolean)
    .join(", ");
  const classes = ["thread-row", fresh && "thread-fresh", selected && "thread-picked"].filter(Boolean).join(" ");
  return (
    <li className={classes}>
      <label className="pick">
        <input type="checkbox" checked={selected} onChange={onToggle} />
        <span className="visually-hidden">{strings.organize.select(subject)}</span>
      </label>
      <a
        className={thread.unread ? "thread thread-unread" : "thread"}
        href={href}
        aria-label={label}
        aria-describedby={snippetId}
      >
        <span className="thread-mark" aria-hidden="true" />
        <span className="thread-sender">
          <span className="thread-sender-name">{sender}</span>
          {thread.messages > 1 && <span className="thread-count">{thread.messages}</span>}
        </span>
        <span className="thread-text">
          <span className="thread-subject">{subject}</span>
          {named.map((each) => (
            <span key={each.id} className="label-name" aria-hidden="true">
              {each.name}
            </span>
          ))}
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
