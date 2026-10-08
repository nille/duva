// The views of a mailbox's mail: the Inbox, the Screener, Remind me, the Feed, the Paper Trail, Sent, Drafts, All mail, Spam and Trash, its
// mailbox agent to ask, then its own labels, each a link with how many unread threads it has, the Screener with how many senders wait. It is one component, so the side column can hold it.
// A search's results are a view too, which the bar opens.
import { useContext, useId, useState } from "react";
import type { DuvaClient } from "@duva/client";
import type { components } from "@duva/openapi";
import { type Label, NewLabel } from "./organize.tsx";
import { strings } from "./strings.ts";
import { PreferencesContext } from "./dates.ts";
import { ActorMark } from "./mail-parts.tsx";

type Mailbox = components["schemas"]["Mailbox"];

/** A listing of threads: a label's, Sent, All mail, or Remind me's threads set aside. */
export type ThreadsView = { label: string } | { sent: true } | { all: true } | { reminders: true };

/** A search of the mailbox: what to search for, and whether best or newest first. */
export type SearchView = { search: { q: string; sort: "relevance" | "newest" } };

/** A view of the mail: a listing of threads, the Screener, or a search's results. */
export type View = ThreadsView | { screener: true } | SearchView;

/** Where the view is in its mailbox, after the mailbox's place in the hash the web app routes by. */
export function pathOf(view: View): string {
  if ("screener" in view) return "screener";
  if ("search" in view) {
    const { q, sort } = view.search;
    return `search?${new URLSearchParams({ q, ...(sort === "newest" && { sort }) })}`;
  }
  if ("all" in view) return "all";
  if ("sent" in view) return "sent";
  if ("reminders" in view) return "reminders";
  if (view.label === "inbox") return "";
  if (view.label === "spam" || view.label === "trash" || view.label === "feed") return view.label;
  if (view.label === "paperTrail") return "paper-trail";
  return `labels/${encodeURIComponent(view.label)}`;
}

/** Where a mailbox's screened senders are, after the mailbox's place in the hash, reached from its Screener. */
export const screenedSendersPath = "screener/senders";

/**
 * The address of the sheet of the sender with the address in the mailbox whose Inbox is at `base`,
 * opened from the view, or the screened senders, at the path `from`.
 */
export const senderHref = (address: string, from: string, base: string) => `${base}senders/${encodeURIComponent(address)}?${new URLSearchParams({ from })}`;

/** The address of the view in the mailbox whose Inbox is at `base`. */
export const hrefOf = (view: View, base: string) => `${base}${pathOf(view)}`;

/**
 * The address of the thread in the mailbox whose Inbox is at `base`, opened from the view, and from a
 * search at the message that matched.
 */
export const threadHref = (thread: string, from: View, base: string, message?: string) =>
  `${base}threads/${encodeURIComponent(thread)}?${new URLSearchParams({ from: pathOf(from), ...(message !== undefined && { message }) })}`;

/** The view at the path in its mailbox, or undefined if it names none. */
export function viewOf(path: string): View | undefined {
  if (path === "") return { label: "inbox" };
  if (path === "screener") return { screener: true };
  if (path === "all") return { all: true };
  if (path === "sent") return { sent: true };
  if (path === "reminders") return { reminders: true };
  const search = /^search\?(.*)$/.exec(path)?.[1];
  if (search !== undefined) {
    const asked = new URLSearchParams(search);
    return { search: { q: asked.get("q") ?? "", sort: asked.get("sort") === "newest" ? "newest" : "relevance" } };
  }
  if (path === "spam" || path === "trash" || path === "feed") return { label: path };
  if (path === "paper-trail") return { label: "paperTrail" };
  const label = /^labels\/(.+)$/.exec(path)?.[1];
  return label === undefined ? undefined : { label: decodeURIComponent(label) };
}

/** What the view is called. */
export function titleOf(view: View, labels: Label[]): string {
  if ("screener" in view) return strings.screener.title;
  if ("search" in view) return strings.search.title;
  if ("all" in view) return strings.views.allMail;
  if ("reminders" in view) return strings.views.reminders;
  if ("sent" in view) return strings.sent.title;
  return labels.find((label) => label.id === view.label)?.name ?? builtInName(view.label) ?? strings.views.unknownLabel;
}

const builtInName = (label: string) => ({ inbox: strings.views.inbox, feed: strings.views.feed, paperTrail: strings.views.paperTrail, spam: strings.views.spam, trash: strings.views.trash })[label];

/**
 * The mailbox's views as links, the one open marked current, with a form at the foot to create a
 * label. Only the Inbox, the Feed, the Paper Trail and the mailbox's own labels count their unread
 * threads, each its own, so Sent, Spam, Trash and All mail never call for attention. The Screener, listed while it is on or something
 * waits there, quietly counts the senders who wait.
 */
export function MailViews({
  client,
  mailbox,
  base,
  labels,
  current,
  drafts,
  ask,
  screener,
  onLabelCreated,
  onSignedOut,
}: {
  client: DuvaClient;
  mailbox: Mailbox;
  base: string;
  labels: Label[];
  current: View | undefined;
  /** Whether Drafts is open. */
  drafts: { current: boolean };
  /** Where the human asks the mailbox's mailbox agent, and whether it's open. */
  ask: { href: string; current: boolean };
  /** Whether the mailbox's Screener is on, and how many senders wait there, once Duva has said. */
  screener?: { on: boolean; waiting: number };
  onLabelCreated: (label: Label) => void;
  onSignedOut: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const keys = useContext(PreferencesContext).keyboardShortcuts !== "off";
  const headingId = useId();
  const unread = (id: string) => labels.find((label) => label.id === id)?.unread ?? 0;
  const own = labels.filter((label) => !label.builtIn);
  const isCurrent = (view: View) => current !== undefined && pathOf(current) === pathOf(view);
  const link = (view: View, name: string, count: number) => (
    <li key={pathOf(view)}>
      <a href={hrefOf(view, base)} className="view-link" aria-current={isCurrent(view) ? "page" : undefined}>
        <span className="view-name">{name}</span>
        {count > 0 && (
          <>
            <span className="view-count" aria-hidden="true">
              {count}
            </span>
            <span className="visually-hidden">{strings.views.unread(count)}</span>
          </>
        )}
      </a>
    </li>
  );

  return (
    <nav className="views" aria-label={strings.views.label}>
      <ul className="views-list">
        {link({ label: "inbox" }, strings.views.inbox, unread("inbox"))}
        {screener !== undefined && (screener.on || screener.waiting > 0) && (
          <li>
            <a href={hrefOf({ screener: true }, base)} className="view-link" aria-current={isCurrent({ screener: true }) ? "page" : undefined}>
              <span className="view-name">{strings.screener.title}</span>
              {screener.waiting > 0 && (
                <>
                  <span className="view-count view-count-quiet" aria-hidden="true">
                    {screener.waiting}
                  </span>
                  <span className="visually-hidden">{strings.screener.waiting(screener.waiting)}</span>
                </>
              )}
            </a>
          </li>
        )}
        {link({ reminders: true }, strings.views.reminders, 0)}
        {link({ label: "feed" }, strings.views.feed, unread("feed"))}
        {link({ label: "paperTrail" }, strings.views.paperTrail, unread("paperTrail"))}
        {link({ sent: true }, strings.views.sent, 0)}
        <li>
          <a href={`${base}drafts`} className="view-link" aria-current={drafts.current ? "page" : undefined}>
            <span className="view-name">{strings.views.drafts}</span>
          </a>
        </li>
        {link({ all: true }, strings.views.allMail, 0)}
        {link({ label: "spam" }, strings.views.spam, 0)}
        {link({ label: "trash" }, strings.views.trash, 0)}
        <li className="views-ask">
          <a href={ask.href} className="view-link" aria-current={ask.current ? "page" : undefined} aria-keyshortcuts={keys ? "Shift+A" : undefined}>
            <ActorMark kind="coo" />
            <span className="view-name">{strings.ask.link}</span>
          </a>
        </li>
      </ul>
      <h2 className="views-heading" id={headingId}>
        {strings.views.yourLabels}
      </h2>
      {own.length > 0 && (
        <ul className="views-list" aria-labelledby={headingId}>
          {own.map((label) => link({ label: label.id }, label.name, label.unread))}
        </ul>
      )}
      {creating ? (
        <NewLabel
          client={client}
          mailbox={mailbox}
          onCreated={(label) => {
            setCreating(false);
            onLabelCreated(label);
          }}
          onCancel={() => setCreating(false)}
          onSignedOut={onSignedOut}
        />
      ) : (
        <button type="button" className="button button-quiet button-small views-new" onClick={() => setCreating(true)}>
          <PlusIcon />
          {strings.views.newLabel}
        </button>
      )}
    </nav>
  );
}

const PlusIcon = () => (
  <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M8 3v10M3 8h10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);
