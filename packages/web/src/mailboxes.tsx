// The mailboxes a sponsor can read, beside the mail: their own, then each agent's they sponsor,
// with how many threads in each Inbox are unread. A human who sponsors no agents never sees it.
import type { components } from "@duva/openapi";
import { strings } from "./strings.ts";

type Mailbox = components["schemas"]["Mailbox"];

/** An agent's mailbox, with the agent's name. */
export interface AgentMailbox {
  mailbox: Mailbox;
  agent: string;
}

/** Where the mailbox's Inbox is in the web app. The human's own is at the start. */
export const mailboxHref = (mailbox: Mailbox, mine: boolean) => (mine ? "#/" : `#/mailboxes/${encodeURIComponent(mailbox.id)}/`);

export function MailboxList({
  mine,
  agents,
  unread,
  current,
}: {
  mine?: Mailbox;
  agents: AgentMailbox[];
  unread: ReadonlyMap<string, number>;
  current?: string;
}) {
  return (
    <nav className="mailboxes" aria-label={strings.mailboxes.label}>
      {mine !== undefined && (
        <ul>
          <MailboxLink mailbox={mine} name={strings.mailboxes.yours} unread={unread.get(mine.id)} current={current === mine.id} mine />
        </ul>
      )}
      <p className="mailboxes-group" id="mailboxes-agents">
        {strings.mailboxes.agents}
      </p>
      <ul aria-labelledby="mailboxes-agents">
        {agents.map(({ mailbox, agent }) => (
          <MailboxLink key={mailbox.id} mailbox={mailbox} name={agent} unread={unread.get(mailbox.id)} current={current === mailbox.id} />
        ))}
      </ul>
    </nav>
  );
}

function MailboxLink({ mailbox, name, unread = 0, current, mine = false }: { mailbox: Mailbox; name: string; unread?: number; current: boolean; mine?: boolean }) {
  const label = [name, mailbox.defaultAddress, unread > 0 && strings.mailboxes.unread(unread)].filter(Boolean).join(", ");
  return (
    <li>
      <a className={unread > 0 ? "mailbox mailbox-unread" : "mailbox"} href={mailboxHref(mailbox, mine)} aria-label={label} aria-current={current ? "page" : undefined}>
        <span className="mailbox-name">{name}</span>
        <span className="mailbox-count" aria-hidden="true">
          {unread > 0 ? unread : ""}
        </span>
        <span className="mailbox-at">{mailbox.defaultAddress}</span>
      </a>
    </li>
  );
}
