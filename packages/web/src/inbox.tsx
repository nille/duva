// A view's threads, newest first, a page at a time, laid on one sheet like the index of a bundle of
// proofs: the Inbox, a label's, Sent, All mail, Spam or Trash. Unread threads carry the pencil's mark, and
// the human picks threads to organize several at once.
import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import type { DuvaClient } from "@duva/client";
import type { components } from "@duva/openapi";
import type { Connection as ConnectionState } from "./feed.ts";
import { useDates } from "./dates.ts";
import { Connection, nameOf, Time } from "./mail-parts.tsx";
import { type Done, type Label, type Labelled, labelRefusal, OrganizeActions, ownLabelsOf, type Place } from "./organize.tsx";
import { useBeside, useViewTitle, ViewMain, ViewTitle } from "./panes.tsx";
import { useThreadKeys } from "./shortcuts.tsx";
import { strings } from "./strings.ts";
import { type ThreadsView, threadHref, titleOf } from "./views.tsx";

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
 * a way to undo it, and `onDone` hears each new thing they do. Only the Inbox says when Duva last
 * checked for mail, on a phone, where there is no status strip, and every view says when it couldn't.
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
  view: ThreadsView;
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
  useViewTitle(strings.title(title, unread));

  const { open } = useBeside();
  const threads = listing.status === "listed" ? listing.threads : noThreads;
  const picking = usePicking(threads);
  const place: Place = "label" in view ? { label: view.label } : { all: true };

  // Threads that leave the view are no longer picked, and those that stay are, so labelling can go on.
  const organized = (what: Done, moved: boolean) => {
    if (moved) picking.clear();
    onDone(what);
    void load({ arrivals: false });
  };

  const list = useRef<HTMLOListElement>(null);
  useThreadKeys({ list, client, mailbox, threads, picked: picking.picked, place, onDone: organized, onSignedOut });

  const ownLabel = label === undefined ? undefined : labels.find((each) => each.id === label && !each.builtIn);

  return (
    <ViewMain className="desk" aria-busy={listing.status === "loading"}>
      <div className="desk-head">
        {ownLabel === undefined ? (
          <ViewTitle tabIndex={-1} className="view-title">
            {title}
          </ViewTitle>
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
              picking.clear();
              setListing({ status: "listed", threads: [], pages: 1, fresh: new Set() });
              onDone({ message: strings.trash.emptied });
            }}
            onSignedOut={onSignedOut}
          />
        )}
        {(connection?.ok === false || ("label" in view && view.label === "inbox")) && <Connection state={connection} unreachable={strings.connection.mailUnreachable} />}
      </div>
      <p className="visually-hidden" role="status">
        {announcement}
      </p>
      <DoneLine done={done} onDone={onDone} onUndone={() => void load({ arrivals: false })} />
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
        <Empty client={client} view={view} mailbox={mailbox} agent={agent} />
      ) : (
        <div className="index">
          <IndexTools picking={picking} more={listing.next !== undefined}>
            <OrganizeActions client={client} mailbox={mailbox} threads={picking.picked} labels={labels} place={place} onDone={organized} onSignedOut={onSignedOut} />
          </IndexTools>
          <ol className="threads" aria-label={strings.inbox.threads} ref={list}>
            {listing.threads.map((thread) => (
              <ThreadRow
                key={thread.id}
                thread={thread}
                // A row names the thread's own labels, but not the one the view lists.
                labels={ownLabelsOf(thread, labels)
                  .filter((each) => !("label" in view) || each.id !== view.label)
                  .map(({ name }) => name)}
                href={threadHref(thread.id, view, base)}
                snippet={thread.snippet}
                fresh={listing.fresh.has(thread.id)}
                open={thread.id === open}
                selected={picking.selected.has(thread.id)}
                onToggle={() => picking.toggle(thread.id)}
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
    </ViewMain>
  );
}

const noThreads: ThreadSummary[] = [];

/** The threads of a list the human picked, to organize several at once. Threads that leave the list are no longer picked. */
export function usePicking<Thread extends Labelled>(threads: Thread[]) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const listed = new Set(threads.map(({ id }) => id));
    setSelected((current) => (Array.from(current).every((id) => listed.has(id)) ? current : new Set(Array.from(current).filter((id) => listed.has(id)))));
  }, [threads]);
  const picked = threads.filter(({ id }) => selected.has(id));
  return {
    selected,
    picked,
    all: threads.length > 0 && picked.length === threads.length,
    some: picked.length > 0 && picked.length < threads.length,
    toggle: (id: string) =>
      setSelected((current) => {
        const next = new Set(current);
        if (!next.delete(id)) next.add(id);
        return next;
      }),
    toggleAll: () => setSelected(picked.length === threads.length ? new Set() : new Set(threads.map(({ id }) => id))),
    clear: () => setSelected(new Set()),
  };
}

/**
 * The toolbar heading a list's sheet: a checkbox that picks every thread shown, and once any is
 * picked, how many, with the actions. While more threads than those shown follow, it says that
 * picking all picks only those shown.
 */
export function IndexTools({ picking, more, children }: { picking: ReturnType<typeof usePicking>; more: boolean; children: ReactNode }) {
  const count = picking.picked.length;
  return (
    <div className="index-tools" role="toolbar" aria-label={strings.organize.toolbar}>
      <label className="pick pick-all">
        <input
          type="checkbox"
          checked={picking.all}
          ref={(input) => {
            if (input) input.indeterminate = picking.some;
          }}
          onChange={picking.toggleAll}
        />
        <span className="visually-hidden">{strings.organize.selectAll}</span>
        {count > 0 && <span className="pick-count">{picking.all && more ? strings.organize.selectedShown(count) : strings.organize.selected(count)}</span>}
      </label>
      {count > 0 && <div className="index-actions">{children}</div>}
    </div>
  );
}

/** What the human last did to the list, said above its sheet, with a way to undo it, after which `onUndone` reads the list again. */
export function DoneLine({ done, onDone, onUndone }: { done: Done | undefined; onDone: (done: Done) => void; onUndone: () => void }) {
  const [undoing, setUndoing] = useState(false);
  const undo = async () => {
    if (done?.undo === undefined || undoing) return;
    setUndoing(true);
    const undone = await done.undo().catch(() => false);
    setUndoing(false);
    onDone(undone ? { message: strings.organize.undone } : { message: strings.organize.undoFailed });
    onUndone();
  };
  return (
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
  );
}

/** What an empty view says, in its own words. Spam and Trash say how long they keep a thread, as the organization's settings do. */
function Empty({ client, view, mailbox, agent }: { client: DuvaClient; view: ThreadsView; mailbox: Mailbox; agent?: string }) {
  const kept = "label" in view && (view.label === "spam" || view.label === "trash");
  const [retentionDays, setRetentionDays] = useState<number>();
  useEffect(() => {
    if (!kept) return;
    let current = true;
    void client
      .GET("/organization/settings")
      .then(({ data }) => current && setRetentionDays(data?.retentionDays))
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [client, kept]);
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
          ? { title: strings.views.empty.spam.title, lead: strings.views.empty.spam.lead(retentionDays) }
          : view.label === "trash"
            ? { title: strings.views.empty.trash.title, lead: strings.views.empty.trash.lead(retentionDays) }
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
        <ViewTitle className="visually-hidden">{label.name}</ViewTitle>
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
      <ViewTitle tabIndex={-1} className="view-title">
        {label.name}
      </ViewTitle>
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

/** A line of a list, with the checkbox that picks its thread, outside the line's link. */
export function ThreadRow({
  thread,
  labels,
  href,
  snippet,
  fresh = false,
  open = false,
  selected,
  onToggle,
}: {
  thread: ThreadSummary;
  labels: string[];
  href: string;
  snippet: ReactNode;
  fresh?: boolean;
  /** Whether the thread is open beside the list. */
  open?: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  const classes = ["thread-row", fresh && "thread-fresh", selected && "thread-picked"].filter(Boolean).join(" ");
  return (
    <li className={classes} data-thread={thread.id}>
      <label className="pick">
        <input type="checkbox" checked={selected} onChange={onToggle} />
        <span className="visually-hidden">{strings.organize.select(thread.subject || strings.thread.noSubject)}</span>
      </label>
      <ThreadLine thread={thread} labels={labels} href={href} snippet={snippet} open={open} />
    </li>
  );
}

/**
 * A thread as a line of the index, a link to it: the pencil's dot when unread, the sender, the
 * subject with the labels named, the snippet, and the date. A search's results give a snippet of
 * their own, with the words found marked.
 */
export function ThreadLine({ thread, labels, href, snippet, open = false }: { thread: ThreadSummary; labels: string[]; href: string; snippet: ReactNode; open?: boolean }) {
  const snippetId = useId();
  const { day } = useDates();
  const sender = nameOf(thread.from);
  const subject = thread.subject || strings.thread.noSubject;
  const label = [
    thread.unread && strings.inbox.unreadMark,
    sender,
    subject,
    thread.messages > 1 && strings.inbox.messages(thread.messages),
    thread.groups !== undefined && strings.inbox.toGroups(thread.groups),
    labels.length > 0 && strings.inbox.labelled(labels),
    day(new Date(thread.latestAt)),
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <a className={thread.unread ? "thread thread-unread" : "thread"} href={href} aria-label={label} aria-describedby={snippet === "" ? undefined : snippetId} aria-current={open ? "true" : undefined}>
      <span className="thread-mark" aria-hidden="true" />
      <span className="thread-sender">
        <span className="thread-sender-name">{sender}</span>
        {thread.messages > 1 && <span className="thread-count">{thread.messages}</span>}
      </span>
      <span className="thread-text">
        <span className="thread-line-head">
          <span className="thread-subject">{subject}</span>
          {thread.groups?.map((group) => (
            <span key={group} className="group-mark" aria-hidden="true">
              <GroupIcon />
              {group}
            </span>
          ))}
          {labels.map((name) => (
            <span key={name} className="label-name" aria-hidden="true">
              {name}
            </span>
          ))}
        </span>
        {snippet !== "" && (
          <span className="thread-snippet" id={snippetId} lang="">
            {snippet}
          </span>
        )}
      </span>
      <span className="thread-date">
        <Time at={thread.latestAt} short />
      </span>
    </a>
  );
}

/** Two people, for mail that came through a group. */
const GroupIcon = () => (
  <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
    <path
      d="M6 7.5a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5ZM2 13c0-2.2 1.8-3.75 4-3.75S10 10.8 10 13M10.5 3.2a2.25 2.25 0 0 1 0 4.1M11.5 9.4c1.5.4 2.5 1.8 2.5 3.6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export function SkeletonIndex() {
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
