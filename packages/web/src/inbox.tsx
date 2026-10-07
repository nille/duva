// A view's threads, newest first, a page at a time, in the list column: the Inbox, a label's, Sent,
// All mail, Spam or Trash, or Remind me's, the soonest back first. Each row says who sent it by their
// mark, unread threads carry the orange dot, a thread back from Remind me carries its Back mark, and
// a thread an agent's send waits in says it waits for the human. Chips show a view's unread
// threads or those with a label, the Inbox says when new senders wait in the Screener, and the human
// picks threads to organize several at once.
import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import type { DuvaClient } from "@duva/client";
import type { components } from "@duva/openapi";
import type { Connection as ConnectionState } from "./feed.ts";
import { useDates } from "./dates.ts";
import { ActorMark, Connection, nameOf, SenderMark, Time } from "./mail-parts.tsx";
import { Cap, ClockIcon, type Done, type Label, type Labelled, labelRefusal, OrganizeActions, ownLabelsOf, type Place, useKeyed } from "./organize.tsx";
import { useBeside, useListCount, useViewTitle, ViewMain, ViewTitle } from "./panes.tsx";
import { useShortcuts, useThreadKeys } from "./shortcuts.tsx";
import { LabelPrompt, promptedBuiltIns } from "./tasks.tsx";
import { strings } from "./strings.ts";
import { hrefOf, type SearchView, type ThreadsView, threadHref, titleOf } from "./views.tsx";

type ThreadSummary = components["schemas"]["ThreadSummary"];
type ThreadList = components["schemas"]["ThreadList"];
type Mailbox = components["schemas"]["Mailbox"];

/** What the web app knows of who sent a list's threads, beyond what each says, and which of them wait for the human. */
export interface Marks {
  /** The addresses Duva's own mail comes from. */
  duva: ReadonlySet<string>;
  /** The threads an agent's send waits in for the human to approve, by ID. */
  waiting: ReadonlyMap<string, Waiting>;
}

/** An agent's send that waits in a thread for the human to approve: the agent's name, and whether it replies or forwards. */
export interface Waiting {
  agent: string;
  forward: boolean;
}

const noMarks: Marks = { duva: new Set(), waiting: new Map() };

/** Who sent the thread's first message: an agent, as Duva knows it, Duva itself, or someone. */
const actorOf = (thread: ThreadSummary, marks: Marks) => (thread.fromAgent ? "agent" : marks.duva.has(thread.from.address.toLowerCase()) ? "duva" : "human");

/** How many threads a page of a view lists. */
export const pageSize = 25;

type Listing =
  | { status: "loading" }
  | { status: "failed"; message: string }
  | { status: "listed"; threads: ThreadSummary[]; next?: string; pages: number; fresh: Set<string> };

/** A failure the human can act on: the session ended, or Duva couldn't list the threads. */
class ListingFailed extends Error {}

/**
 * The view's threads, in the human's mailbox whose Inbox is at `base` in the web app. `version` counts the changes to the mailbox the
 * app has seen, so the listing reads its pages again when it changes. `done` is what the human last did, said at the head with
 * a way to undo it, and `onDone` hears each new thing they do. Only the Inbox says when Duva last
 * checked for mail, on a phone, where there is no status strip, and every view says when it couldn't.
 * `marks` says who sent each thread and which wait for the human.
 */
export function ThreadIndex({
  client,
  mailbox,
  base,
  view,
  labels,
  version,
  connection,
  marks = noMarks,
  screener = 0,
  done,
  onDone,
  onSignedOut,
}: {
  client: DuvaClient;
  mailbox: Mailbox;
  base: string;
  view: ThreadsView;
  labels: Label[];
  version: number;
  connection: ConnectionState;
  marks?: Marks;
  /** How many new senders wait in the mailbox's Screener, which the Inbox says at its top. */
  screener?: number;
  done: Done | undefined;
  onDone: (done: Done | undefined) => void;
  onSignedOut: () => void;
}) {
  const [listing, setListing] = useState<Listing>({ status: "loading" });
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const listingRef = useRef(listing);
  listingRef.current = listing;
  const title = titleOf(view, labels);
  const label = "label" in view ? view.label : undefined;

  const page = useCallback(
    async (after?: string): Promise<ThreadList> => {
      const query = { limit: pageSize, after };
      const path = { mailbox: mailbox.id };
      const { data, response } = await (label !== undefined
        ? client.GET("/mailboxes/{mailbox}/threads", { params: { path, query: { ...query, label } } })
        : "sent" in view
          ? client.GET("/mailboxes/{mailbox}/sent", { params: { path, query } })
          : "reminders" in view
            ? client.GET("/mailboxes/{mailbox}/reminders", { params: { path, query } })
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
    [client, mailbox.id, label, "sent" in view, "reminders" in view, onSignedOut],
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
      // A thread back from Remind me lists at when it came back, so it arrives as new mail does.
      const placeOf = ({ latestAt, back }: ThreadSummary) => (back !== undefined && back.at > latestAt ? back.at : latestAt);
      const oldest = shown.at(-1) === undefined ? "" : placeOf(shown.at(-1)!);
      const arrived = before.status === "listed" && arrivals ? threads.filter((thread) => !known.has(thread.id) && placeOf(thread) >= oldest).map(({ id }) => id) : [];
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

  // The whole list counts its own unread threads. Past the threads shown, Duva's count for a label,
  // the Inbox's among them, says how many; All mail has none. Sent counts nothing unread.
  const unread =
    listing.status !== "listed" || "sent" in view
      ? 0
        : listing.next === undefined
          ? listing.threads.filter((thread) => thread.unread).length
        : "label" in view
          ? (labels.find(({ id }) => id === view.label)?.unread ?? 0)
          : 0;
  useViewTitle(strings.title(title, unread));
  useListCount(unread);

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
  useThreadKeys({
    list,
    client,
    mailbox,
    threads,
    picked: picking.picked,
    place,
    onPick: picking.toggle,
    onLabels: picking.askLabels,
    onRemind: picking.askRemind,
    onDone: organized,
    onSignedOut,
  });

  const ownLabel = label === undefined ? undefined : labels.find((each) => each.id === label && !each.builtIn);
  const prompted = label === undefined ? undefined : labels.find((each) => each.id === label && (!each.builtIn || promptedBuiltIns.includes(each.id)));

  return (
    <ViewMain className="desk" aria-busy={listing.status === "loading"}>
      <div className="desk-head list-head">
        {ownLabel === undefined ? (
          <ViewTitle tabIndex={-1} className="view-title">
            {title}
          </ViewTitle>
        ) : (
          <LabelHead client={client} mailbox={mailbox} base={base} label={ownLabel} onDone={onDone} onSignedOut={onSignedOut} />
        )}
        {unread > 0 && <p className="count">{strings.inbox.unread(unread)}</p>}
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
        {connection?.ok === false && <Connection state={connection} unreachable={strings.connection.mailUnreachable} />}
      </div>
      {prompted !== undefined && <LabelPrompt key={prompted.id} client={client} mailbox={mailbox.id} label={prompted} onDone={onDone} onSignedOut={onSignedOut} />}
      {"label" in view && view.label === "inbox" && screener > 0 && <ScreenerWaiting count={screener} href={hrefOf({ screener: true }, base)} />}
      <p className="visually-hidden" role="status">
        {announcement}
      </p>
      <DoneLine done={done} onDone={onDone} onUndone={() => void load({ arrivals: false })} />
      <ListLine
        picking={listing.status === "listed" && listing.threads.length > 0 ? picking : undefined}
        more={listing.status === "listed" && listing.next !== undefined}
        chips={scopeOf(view) !== undefined && <ListChips base={base} scope={scopeOf(view)!} labels={labels} />}
      >
        <OrganizeActions
          client={client}
          mailbox={mailbox}
          threads={picking.picked}
          labels={labels}
          place={place}
          labelsAsked={picking.labelsAsked}
          remindAsked={picking.remindAsked}
          onDone={organized}
          onSignedOut={onSignedOut}
        />
      </ListLine>
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
        <Empty client={client} view={view} mailbox={mailbox} />
      ) : (
        <div className="index">
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
                marks={marks}
                comesBack={"reminders" in view}
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

/**
 * The threads of a list the human picked, to organize several at once. Threads that leave the list
 * are no longer picked. `labelsAsked` counts the times l asked for the labels of those picked, from
 * when the first was picked, and `askLabels` asks again, as `remindAsked` and `askRemind` do for b and Remind me.
 */
export function usePicking<Thread extends Labelled>(threads: Thread[]) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [labelsAsked, setLabelsAsked] = useState(0);
  const [remindAsked, setRemindAsked] = useState(0);
  useEffect(() => {
    const listed = new Set(threads.map(({ id }) => id));
    setSelected((current) => (Array.from(current).every((id) => listed.has(id)) ? current : new Set(Array.from(current).filter((id) => listed.has(id)))));
  }, [threads]);
  const picked = threads.filter(({ id }) => selected.has(id));
  // The labels' buttons go with the last thread picked, so asking for them starts over with the next.
  useEffect(() => {
    if (picked.length > 0) return;
    setLabelsAsked(0);
    setRemindAsked(0);
  }, [picked.length]);
  return {
    selected,
    picked,
    labelsAsked,
    askLabels: () => setLabelsAsked((current) => current + 1),
    remindAsked,
    askRemind: () => setRemindAsked((current) => current + 1),
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
 * The line heading a list's rows: the toolbar with a checkbox that picks every thread shown, while
 * there are rows, then the chips, if the list takes them. Once any thread is picked, the toolbar
 * says how many, with the actions in the chips' place. While more threads than those shown follow,
 * it says that picking all picks only those shown.
 */
export function ListLine({ picking, more, chips, children }: { picking?: ReturnType<typeof usePicking>; more: boolean; chips?: ReactNode; children: ReactNode }) {
  const count = picking?.picked.length ?? 0;
  if (picking === undefined && !chips) return null;
  return (
    <div className="list-line">
      {picking !== undefined && (
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
      )}
      {count === 0 && chips}
    </div>
  );
}

/** What the human last did to the list, said above its rows, with a way to undo it, which z does too, after which `onUndone` reads the list again. */
export function DoneLine({ done, onDone, onUndone }: { done: Done | undefined; onDone: (done: Done) => void; onUndone: () => void }) {
  const [undoing, setUndoing] = useState(false);
  const keyed = useKeyed();
  const undo = async () => {
    if (done?.undo === undefined || undoing) return;
    setUndoing(true);
    const undone = await done.undo().catch(() => false);
    setUndoing(false);
    onDone(undone ? { message: strings.organize.undone } : { message: strings.organize.undoFailed });
    onUndone();
  };
  useShortcuts({ z: done?.undo === undefined ? undefined : () => void undo() });
  return (
    <div className="done-line" role="status">
      {done !== undefined && (
        <>
          <span>{done.message}</span>
          {done.undo !== undefined && (
            <button type="button" className="link" disabled={undoing} aria-keyshortcuts={keyed("z")} onClick={() => void undo()}>
              {strings.organize.undo}
              <Cap name={keyed("z")} />
            </button>
          )}
        </>
      )}
    </div>
  );
}

/** What an empty view says, in its own words. Spam and Trash say how long they keep a thread, as the organization's settings do. */
function Empty({ client, view, mailbox }: { client: DuvaClient; view: ThreadsView; mailbox: Mailbox }) {
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
      : "reminders" in view
        ? strings.views.empty.reminders
      : "sent" in view
        ? { title: strings.sent.emptyTitle, lead: strings.sent.emptyLead }
        : view.label === "inbox"
        ? { title: strings.inbox.emptyTitle, lead: strings.inbox.emptyLead(mailbox.defaultAddress) }
        : view.label === "spam"
          ? { title: strings.views.empty.spam.title, lead: strings.views.empty.spam.lead(retentionDays) }
          : view.label === "trash"
            ? { title: strings.views.empty.trash.title, lead: strings.views.empty.trash.lead(retentionDays) }
            : view.label === "feed" || view.label === "paperTrail"
              ? strings.views.empty[view.label]
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
  marks = noMarks,
  comesBack = false,
  fresh = false,
  open = false,
  selected,
  onToggle,
}: {
  thread: ThreadSummary;
  labels: string[];
  href: string;
  snippet: ReactNode;
  marks?: Marks;
  /** Whether the row says when the thread comes back, as Remind me lists it, in place of when its mail arrived. */
  comesBack?: boolean;
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
      <ThreadLine thread={thread} labels={labels} href={href} snippet={snippet} marks={marks} comesBack={comesBack} open={open} />
    </li>
  );
}

/**
 * A thread as a line of the list, a link to it: the orange dot when unread, who sent it by their
 * mark and name, the groups and labels it carries, and the date, then its subject and snippet on
 * one line, after "Waiting for you" and the agent's name when an agent's send waits in it, or the
 * Back mark and when it was set aside once it came back from Remind me. With `comesBack`, the date
 * is when the thread comes back. A search's results give a snippet of their own, with the words found marked.
 */
export function ThreadLine({
  thread,
  labels,
  href,
  snippet,
  marks = noMarks,
  comesBack = false,
  open = false,
}: {
  thread: ThreadSummary;
  labels: string[];
  href: string;
  snippet: ReactNode;
  marks?: Marks;
  comesBack?: boolean;
  open?: boolean;
}) {
  const snippetId = useId();
  const { day, when } = useDates();
  const back = thread.back;
  const returns = comesBack && thread.reminder !== undefined ? new Date(thread.reminder.at) : undefined;
  const sender = nameOf(thread.from);
  const actor = actorOf(thread, marks);
  const subject = thread.subject || strings.thread.noSubject;
  const waiting = marks.waiting.get(thread.id);
  const label = [
    thread.unread && strings.inbox.unreadMark,
    actor === "agent" ? strings.inbox.agentSender(sender) : thread.logo?.verified ? strings.inbox.verifiedSender(sender) : sender,
    subject,
    waiting !== undefined && strings.inbox.waitsFor(waiting.agent, waiting.forward),
    back !== undefined && strings.remind.backLabel(day(new Date(back.setAsideAt))),
    thread.messages > 1 && strings.inbox.messages(thread.messages),
    thread.groups !== undefined && strings.inbox.toGroups(thread.groups),
    labels.length > 0 && strings.inbox.labelled(labels),
    returns === undefined ? day(new Date(thread.latestAt)) : strings.remind.comesBack(when(returns)),
  ]
    .filter(Boolean)
    .join(", ");
  const labelled = (thread.groups?.length ?? 0) > 0 || labels.length > 0;
  return (
    <a className={thread.unread ? "thread thread-unread" : "thread"} href={href} aria-label={label} aria-describedby={snippet === "" ? undefined : snippetId} aria-current={open ? "true" : undefined}>
      <span className="thread-mark" aria-hidden="true" />
      <span className="thread-sender">
        <SenderMark kind={actor} logo={thread.logo} name={sender} />
        <span className="thread-sender-name">{sender}</span>
        {thread.messages > 1 && <span className="thread-count">{thread.messages}</span>}
      </span>
      {labelled && (
        <span className="thread-labels" aria-hidden="true">
          {thread.groups?.map((group) => (
            <span key={group} className="group-mark">
              <GroupIcon />
              {group}
            </span>
          ))}
          {labels.map((name) => (
            <span key={name} className="label-name">
              {name}
            </span>
          ))}
        </span>
      )}
      {returns === undefined ? (
        <span className="thread-date">
          <Time at={thread.latestAt} short />
        </span>
      ) : (
        <span className="thread-date thread-returns">
          <ClockIcon />
          <time dateTime={returns.toISOString()}>{when(returns)}</time>
        </span>
      )}
      <span className="thread-text">
        <span className="thread-line-head">
          {waiting !== undefined && (
            <span className="thread-waiting" aria-hidden="true">
              <span className="thread-waiting-you">{strings.inbox.waitingForYou}</span> <span className="thread-waiting-agent">{waiting.agent}</span>
            </span>
          )}
          {back !== undefined && (
            <span className="thread-back" aria-hidden="true">
              <span className="thread-back-mark">{strings.remind.back}</span> <span className="thread-back-when">{strings.remind.setAsideOn(day(new Date(back.setAsideAt)))}</span>
            </span>
          )}
          <span className="thread-subject">{subject}</span>
        </span>
        {snippet !== "" && (
          <span className="thread-snippet" id={snippetId} lang="">
            {snippet}
          </span>
        )}
      </span>
    </a>
  );
}

/** What a list's chips narrow: a label's threads, the Inbox's among them, or All mail. Spam, Trash and Sent take none. */
export type Scope = { label: string } | { all: true };

/** The scope of a view's chips, or undefined if it takes none. */
export const scopeOf = (view: ThreadsView): Scope | undefined =>
  "all" in view ? view : "label" in view && view.label !== "spam" && view.label !== "trash" ? view : undefined;

/** A label's name as a search's label: filter has it, quoted if it has spaces. */
const labelFilter = (name: string) => `label:${/[\s"]/.test(name) ? `"${name.replaceAll('"', "")}"` : name}`;

/**
 * The chips of a scope: All, the scope itself, then Unread and each of the mailbox's own labels
 * but the scope's, each the search that narrows the scope to them, newest first, as Duva filters it.
 */
function chipsOf(scope: Scope, labels: Label[], base: string): { name: string; href: string; q?: string }[] {
  const named = "label" in scope ? (scope.label === "inbox" ? "inbox" : labels.find(({ id }) => id === scope.label)?.name) : undefined;
  const within = named === undefined ? [] : [labelFilter(named)];
  const search = (q: string) => ({ q, href: hrefOf({ search: { q, sort: "newest" } }, base) });
  return [
    { name: strings.inbox.chips.all, href: hrefOf(scope, base) },
    { name: strings.inbox.chips.unread, ...search([...within, "is:unread"].join(" ")) },
    ...labels
      .filter((label) => !label.builtIn && !("label" in scope && label.id === scope.label))
      .map((label) => ({ name: label.name, ...search([...within, labelFilter(label.name)].join(" ")) })),
  ];
}

/** The scope whose chip searches for what the search view does, and that chip, if one does. */
export function chipOf(view: SearchView, labels: Label[], base: string): { scope: Scope; q: string } | undefined {
  if (view.search.sort !== "newest") return undefined;
  const scopes: Scope[] = [{ label: "inbox" }, ...labels.filter((label) => !label.builtIn).map(({ id }) => ({ label: id })), { all: true }];
  for (const scope of scopes) if (chipsOf(scope, labels, base).some(({ q }) => q === view.search.q)) return { scope, q: view.search.q };
  return undefined;
}

/** The chips under a list's head that narrow it, the one shown current: All while the list is whole, or the chip whose search is `q`. */
export function ListChips({ base, scope, labels, q }: { base: string; scope: Scope; labels: Label[]; q?: string }) {
  return (
    <nav className="chips" aria-label={strings.inbox.chips.name}>
      {chipsOf(scope, labels, base).map((chip) => (
        <a key={chip.href} className="chip" href={chip.href} aria-current={chip.q === q ? "page" : undefined}>
          {chip.name}
        </a>
      ))}
    </nav>
  );
}

/** One row at the top of the Inbox saying how many new senders wait in the Screener, with the way there. */
function ScreenerWaiting({ count, href }: { count: number; href: string }) {
  return (
    <section className="screener-waiting" aria-label={strings.screener.title}>
      <ActorMark kind="human" />
      <p>
        <strong>{strings.inbox.screener.senders(count)}</strong> {strings.inbox.screener.wait(count)}
      </p>
      <a href={href}>{strings.inbox.screener.go}</a>
    </section>
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
