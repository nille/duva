// The views of a mailbox's mail: the Inbox, Sent, Drafts, All mail, Spam and Trash, then its own labels,
// each a link with how many unread threads it has. It is one component, so the side column can hold it.
import { useId, useState } from "react";
import type { DuvaClient } from "@duva/client";
import type { components } from "@duva/openapi";
import { type Label, NewLabel } from "./organize.tsx";
import { strings } from "./strings.ts";

type Mailbox = components["schemas"]["Mailbox"];

/** A listing of threads: a label's, Sent, or All mail. */
export type View = { label: string } | { sent: true } | { all: true };

/** Where the view is in its mailbox, after the mailbox's place in the hash the web app routes by. */
export function pathOf(view: View): string {
  if ("all" in view) return "all";
  if ("sent" in view) return "sent";
  if (view.label === "inbox") return "";
  if (view.label === "spam" || view.label === "trash") return view.label;
  return `labels/${encodeURIComponent(view.label)}`;
}

/** The address of the view in the mailbox whose Inbox is at `base`. */
export const hrefOf = (view: View, base: string) => `${base}${pathOf(view)}`;

/** The view at the path in its mailbox, or undefined if it names none. */
export function viewOf(path: string): View | undefined {
  if (path === "") return { label: "inbox" };
  if (path === "all") return { all: true };
  if (path === "sent") return { sent: true };
  if (path === "spam" || path === "trash") return { label: path };
  const label = /^labels\/(.+)$/.exec(path)?.[1];
  return label === undefined ? undefined : { label: decodeURIComponent(label) };
}

/** What the view is called, an agent's Inbox by the agent's name. */
export function titleOf(view: View, labels: Label[], agent?: string): string {
  if ("all" in view) return strings.views.allMail;
  if ("sent" in view) return agent === undefined ? strings.sent.title : strings.sent.agentTitle(agent);
  if (view.label === "inbox" && agent !== undefined) return strings.inbox.agentTitle(agent);
  return labels.find((label) => label.id === view.label)?.name ?? builtInName(view.label) ?? strings.views.unknownLabel;
}

const builtInName = (label: string) => ({ inbox: strings.views.inbox, spam: strings.views.spam, trash: strings.views.trash })[label];

/**
 * The mailbox's views as links, the one open marked current, with a form at the foot to create a
 * label. Only the Inbox and the mailbox's own labels count their unread threads, so Sent, Spam,
 * Trash and All mail never call for attention.
 */
export function MailViews({
  client,
  mailbox,
  base,
  labels,
  current,
  drafts,
  onLabelCreated,
  onSignedOut,
}: {
  client: DuvaClient;
  mailbox: Mailbox;
  base: string;
  labels: Label[];
  current: View | undefined;
  /** Whether Drafts is listed, as it is for the human's own mailbox only, and whether it's open. */
  drafts?: { current: boolean };
  onLabelCreated: (label: Label) => void;
  onSignedOut: () => void;
}) {
  const [creating, setCreating] = useState(false);
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
        {link({ sent: true }, strings.views.sent, 0)}
        {drafts !== undefined && (
          <li>
            <a href="#/drafts" className="view-link" aria-current={drafts.current ? "page" : undefined}>
              <span className="view-name">{strings.views.drafts}</span>
            </a>
          </li>
        )}
        {link({ all: true }, strings.views.allMail, 0)}
        {link({ label: "spam" }, strings.views.spam, 0)}
        {link({ label: "trash" }, strings.views.trash, 0)}
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
