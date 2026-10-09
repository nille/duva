// The mailboxes a human reads, beside the mail: their own, each by its default address when they
// have more than one, with how many threads in each Inbox are unread, and above them All mailboxes,
// all of them taken together (ADR-0033), which the web app opens on. Agents own no mailboxes, so
// none is listed for them. A human with one mailbox never sees the list, nor All mailboxes.
import { useEffect, useId, useRef, useState } from "react";
import type { components } from "@duva/openapi";
import { strings } from "./strings.ts";

type Mailbox = components["schemas"]["Mailbox"];
type Label = components["schemas"]["Label"];
type AllMailboxesLabel = components["schemas"]["AllMailboxesLabel"];

/**
 * All mailboxes, as the views take it in place of one mailbox: the human's own mailboxes, taken
 * together, at the start of the web app. It has no ID, so nothing asks a mailbox's operation for it,
 * and each thread in it names the mailbox it is in.
 */
export interface AllMailboxes {
  all: true;
  /** The mailboxes, in the order `ownInOrder` gives, with the groups their owner can send as. */
  own: (Mailbox & { groups?: string[] })[];
  /** Their labels, those of one name taken as one, as Duva last listed them. */
  labels: AllMailboxesLabel[];
}

export const isAll = (mailbox: Mailbox | AllMailboxes): mailbox is AllMailboxes => "all" in mailbox;

/** The ID of the mailbox a thread listed in `mailbox` is in: its own, in All mailboxes. */
export const mailboxOf = (mailbox: Mailbox | AllMailboxes, thread: { mailbox?: string }) => (isAll(mailbox) ? (thread.mailbox ?? "") : mailbox.id);

/** All mailboxes' labels as a view lists them: each by its ID there, a name for the mailboxes' own, its unread threads counted across them. */
export const labelsAcross = (all: AllMailboxesLabel[]): Label[] => all.map(({ id, name, builtIn, unread }) => ({ id, name, builtIn, unread }));

/** The labels of one of the mailboxes, as they are in it alone, from All mailboxes' labels. */
export const labelsIn = (all: AllMailboxesLabel[], mailbox: string): Label[] =>
  all.flatMap(({ name, builtIn, mailboxes }) => mailboxes.filter((each) => each.mailbox === mailbox).map(({ label, unread, prompt }) => ({ id: label, name, builtIn, unread, ...(prompt !== undefined && { prompt }) })));

/**
 * A thread of one of the mailboxes as All mailboxes lists it, its labels by their IDs there, so a
 * label of one name is one label across the mailboxes. One Duva hasn't listed yet keeps its ID.
 */
export function acrossOf<Thread extends { mailbox?: string; labels: string[] }>(all: AllMailboxes, thread: Thread): Thread {
  const across = (id: string) => all.labels.find(({ mailboxes }) => mailboxes.some(({ mailbox, label }) => mailbox === thread.mailbox && label === id))?.id ?? id;
  return { ...thread, labels: thread.labels.map(across) };
}

/**
 * The address mail came to, as a row in All mailboxes names it: its local part and the @, as "work@",
 * or the whole address where two of the human's addresses share their local part.
 */
export function shortAddress(address: string, own: Mailbox[]): string {
  // Plus tags aside, as Duva delivers them.
  const localOf = (each: string) => each.slice(0, Math.max(0, each.lastIndexOf("@"))).replace(/\+.*$/, "").toLowerCase();
  const at = address.lastIndexOf("@");
  if (at <= 0) return address;
  const sharing = new Set(own.flatMap(({ addresses }) => addresses).filter((each) => localOf(each) === localOf(address)));
  return sharing.size > 1 ? address : `${address.slice(0, at)}@`;
}

/** The mailbox with the ID, by its default address as All mailboxes names it, or undefined if it has none. */
export function shortAddressOf(all: AllMailboxes, mailbox: string): string | undefined {
  const address = all.own.find(({ id }) => id === mailbox)?.defaultAddress;
  return address === undefined ? undefined : shortAddress(address, all.own);
}

/** Where the mailbox's Inbox is in the web app: at the start when it is `atStart`, as the human's only own mailbox is. */
export const mailboxHref = (mailbox: Mailbox, atStart: boolean) => (atStart ? "#/" : `#/mailboxes/${encodeURIComponent(mailbox.id)}/`);

/**
 * The human's own mailboxes in the order the web app lists them: the one at the address they sign in
 * with first, then by default address, those without one last. The first one's Inbox is at the start.
 */
export function ownInOrder(own: Mailbox[], email: string): Mailbox[] {
  const rank = (mailbox: Mailbox) => (mailbox.addresses.includes(email) ? 0 : mailbox.defaultAddress === undefined ? 2 : 1);
  return [...own].sort((a, b) => rank(a) - rank(b) || (a.defaultAddress ?? "").localeCompare(b.defaultAddress ?? "") || a.id.localeCompare(b.id));
}

/** What a mailbox is called beside the mail: by its address, or as "Your mailbox" when it is the human's only one. */
export const mailboxName = (mailbox: Mailbox, own: Mailbox[]) =>
  own.length === 1 ? strings.mailboxes.yours : (mailbox.defaultAddress ?? strings.mailboxes.withoutAddress(own.indexOf(mailbox) + 1));

export function MailboxList({
  own,
  unread,
  current,
}: {
  /** The human's own mailboxes, in the order `ownInOrder` gives. */
  own: Mailbox[];
  unread: ReadonlyMap<string, number>;
  /** The mailbox open, or All mailboxes. */
  current?: string | AllMailboxes;
}) {
  const several = own.length > 1;
  // All mailboxes counts what its mailboxes count.
  const all = own.reduce((sum, { id }) => sum + (unread.get(id) ?? 0), 0);
  return (
    <nav className="mailboxes" aria-label={strings.mailboxes.label}>
      {several && (
        <ul className="mailboxes-all">
          <MailboxLink name={strings.mailboxes.all} unread={all} current={typeof current === "object"} href="#/" />
        </ul>
      )}
      {several && (
        <p className="mailboxes-group" id="mailboxes-own">
          {strings.mailboxes.yourMailboxes}
        </p>
      )}
      {own.length > 0 && (
        <ul aria-labelledby={several ? "mailboxes-own" : undefined}>
          {own.map((mailbox, index) => (
            <MailboxLink
              key={mailbox.id}
              name={mailboxName(mailbox, own)}
              // Listed by its address, a mailbox needs it said only once.
              address={several ? undefined : strings.mailboxes.address(mailbox)}
              unread={unread.get(mailbox.id)}
              current={current === mailbox.id}
              // With several, each names its mailbox, and All mailboxes is at the start.
              href={mailboxHref(mailbox, !several && index === 0)}
            />
          ))}
        </ul>
      )}
    </nav>
  );
}

/** An address that may break before its @, so a long one reads whole, its domain on the next line. Text without one is as it is. */
function breakableBeforeAt(text: string) {
  const at = text.lastIndexOf("@");
  if (at <= 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <wbr />
      {text.slice(at)}
    </>
  );
}

function MailboxLink({ name, address, unread = 0, current, href }: { name: string; address?: string; unread?: number; current: boolean; href: string }) {
  const label = [name, address, unread > 0 && strings.mailboxes.unread(unread)].filter(Boolean).join(", ");
  return (
    <li>
      <a className={unread > 0 ? "mailbox mailbox-unread" : "mailbox"} href={href} aria-label={label} aria-current={current ? "page" : undefined}>
        <span className="mailbox-name">
          <span>{breakableBeforeAt(name)}</span>
        </span>
        <span className="mailbox-count" aria-hidden="true">
          {unread > 0 ? unread : ""}
        </span>
        {address !== undefined && <span className="mailbox-at">{breakableBeforeAt(address)}</span>}
      </a>
    </li>
  );
}

/**
 * The open mailbox at the side column's head, as a selector: its name, or All mailboxes, its address
 * in Second Ink when the name differs, and a chevron, with the dot when another of the human's own
 * mailboxes has unread mail. It opens All mailboxes and their own mailboxes, as the list beside the
 * mail gives them, and Escape closes them, back to it. A human with one mailbox sees it named, a
 * link to its Inbox, with nothing to open.
 */
export function MailboxSelector({
  own,
  unread,
  current,
}: {
  own: Mailbox[];
  unread: ReadonlyMap<string, number>;
  /** The mailbox open, or All mailboxes, if either is. */
  current?: Mailbox | AllMailboxes;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);
  // With none of their own open, it asks for one.
  const one = current !== undefined && isAll(current) ? undefined : current;
  const shown = one ?? (own.length === 1 ? own[0] : undefined);
  const all = current !== undefined && isAll(current);
  const name = all ? strings.mailboxes.all : shown === undefined ? strings.mailboxes.choose : mailboxName(shown, own);
  const address = shown === undefined ? name : strings.mailboxes.address(shown);
  // All mailboxes shows every mailbox's mail, so none is elsewhere.
  const elsewhere = !all && own.some(({ id }) => id !== one?.id && (unread.get(id) ?? 0) > 0);
  // Opening a mailbox, or anything else, closes the list, as does a click outside it.
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close();
    };
    addEventListener("hashchange", close);
    document.addEventListener("pointerdown", outside);
    return () => {
      removeEventListener("hashchange", close);
      document.removeEventListener("pointerdown", outside);
    };
  }, [open]);
  const named = (
    <>
      <span className="selector-name">
        <span>{breakableBeforeAt(name)}</span>
      </span>
      {address !== name && <span className="selector-address">{breakableBeforeAt(address)}</span>}
    </>
  );
  if (own.length === 1) {
    const only = own[0]!;
    const count = unread.get(only.id) ?? 0;
    return (
      <a
        className="selector"
        href={mailboxHref(only, true)}
        aria-current={one?.id === only.id ? "page" : undefined}
        aria-label={[mailboxName(only, own), strings.mailboxes.address(only), count > 0 && strings.mailboxes.unread(count)].filter(Boolean).join(", ")}
      >
        {named}
      </a>
    );
  }
  return (
    <div
      ref={root}
      className="selector-root"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open) return;
        // Escape closes the list here, and does nothing else, as closing a thread.
        event.stopPropagation();
        setOpen(false);
        button.current?.focus();
      }}
    >
      <button
        ref={button}
        type="button"
        className="selector"
        aria-expanded={open}
        aria-controls={id}
        aria-label={current === undefined ? name : [name, address !== name && address, elsewhere && strings.views.elsewhere, strings.mailboxes.choose].filter(Boolean).join(", ")}
        onClick={() => setOpen((shown) => !shown)}
      >
        {named}
        {elsewhere && <span className="switcher-dot" aria-hidden="true" />}
        <ChevronIcon />
      </button>
      <div id={id} className="selector-list" hidden={!open}>
        {open && <MailboxList own={own} unread={unread} current={current !== undefined && isAll(current) ? current : current?.id} />}
      </div>
    </div>
  );
}

export const ChevronIcon = () => (
  <svg className="icon switcher-chevron" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M4.5 6.25 8 9.75l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
