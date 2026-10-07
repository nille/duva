// The mailboxes a human can read, beside the mail: their own, each by its default address when they
// have more than one, then each agent's they sponsor, with how many threads in each Inbox are unread.
// A human with one mailbox who sponsors no agents never sees it. An agent's carries its mark.
import type { components } from "@duva/openapi";
import { ActorMark } from "./mail-parts.tsx";
import { strings } from "./strings.ts";

type Mailbox = components["schemas"]["Mailbox"];

/** An agent's mailbox, with the agent's name. */
export interface AgentMailbox {
  mailbox: Mailbox;
  agent: string;
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

/** What a mailbox is called beside the mail: an agent's by the agent's name, the human's own by its address, or as "Your mailbox" when it is their only one. */
export const mailboxName = (mailbox: Mailbox, own: Mailbox[], agent?: string) =>
  agent ?? (own.length === 1 ? strings.mailboxes.yours : (mailbox.defaultAddress ?? strings.mailboxes.withoutAddress(own.indexOf(mailbox) + 1)));

export function MailboxList({
  own,
  agents,
  unread,
  current,
}: {
  /** The human's own mailboxes, in the order `ownInOrder` gives. */
  own: Mailbox[];
  agents: AgentMailbox[];
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
      {agents.length > 0 && (
        <>
          <p className="mailboxes-group" id="mailboxes-agents">
            {strings.mailboxes.agents}
          </p>
          <ul aria-labelledby="mailboxes-agents">
            {agents.map(({ mailbox, agent }) => (
              <MailboxLink
                key={mailbox.id}
                name={agent}
                address={strings.mailboxes.address(mailbox)}
                unread={unread.get(mailbox.id)}
                current={current === mailbox.id}
                href={mailboxHref(mailbox, false)}
                agent
              />
            ))}
          </ul>
        </>
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

function MailboxLink({ name, address, unread = 0, current, href, agent = false }: { name: string; address?: string; unread?: number; current: boolean; href: string; agent?: boolean }) {
  const label = [name, address, unread > 0 && strings.mailboxes.unread(unread)].filter(Boolean).join(", ");
  return (
    <li>
      <a className={unread > 0 ? "mailbox mailbox-unread" : "mailbox"} href={href} aria-label={label} aria-current={current ? "page" : undefined}>
        <span className="mailbox-name">
          {agent && <ActorMark kind="agent" />}
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
