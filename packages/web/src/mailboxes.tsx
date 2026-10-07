// The mailboxes a human reads, beside the mail: their own, each by its default address when they
// have more than one, with how many threads in each Inbox are unread. Agents own no mailboxes, so
// none is listed for them. A human with one mailbox never sees the list.
import { useEffect, useId, useRef, useState } from "react";
import type { components } from "@duva/openapi";
import { strings } from "./strings.ts";

type Mailbox = components["schemas"]["Mailbox"];

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
  current?: string;
}) {
  const several = own.length > 1;
  return (
    <nav className="mailboxes" aria-label={strings.mailboxes.label}>
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
              // With several, each names its mailbox, so a link never depends on which was last open.
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
 * The open mailbox at the side column's head, as a selector: its name, its address in Second Ink
 * when the name differs, and a chevron, with the dot when another of the human's own mailboxes has
 * unread mail. It opens their own mailboxes, as the list beside the mail gives them, and Escape
 * closes them, back to it. A human with one mailbox sees it named, a link to its Inbox, with nothing to open.
 */
export function MailboxSelector({
  own,
  unread,
  current,
}: {
  own: Mailbox[];
  unread: ReadonlyMap<string, number>;
  /** The mailbox open, if one is. */
  current?: Mailbox;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);
  // With none of their own open, it asks for one.
  const shown = current ?? (own.length === 1 ? own[0] : undefined);
  const name = shown === undefined ? strings.mailboxes.choose : mailboxName(shown, own);
  const address = shown === undefined ? name : strings.mailboxes.address(shown);
  const elsewhere = own.some(({ id }) => id !== current?.id && (unread.get(id) ?? 0) > 0);
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
      <span className="selector-name">{name}</span>
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
        aria-current={current?.id === only.id ? "page" : undefined}
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
        {open && <MailboxList own={own} unread={unread} current={current?.id} />}
      </div>
    </div>
  );
}

export const ChevronIcon = () => (
  <svg className="icon switcher-chevron" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M4.5 6.25 8 9.75l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
