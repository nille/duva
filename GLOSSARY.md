# Duva

A mailbox platform where humans and agents both receive, read and send mail. Duva is Swedish for dove, as in brevduva, the carrier pigeon.

## Language

**Organization**:
The group a deployment serves, with its domains, mailboxes and actors. Each deployment serves exactly one.
_Avoid_: account, tenant, workspace, team

**Actor**:
A human or an agent that acts on mail. Every action is attributed to exactly one actor.
_Avoid_: principal, identity, user

**Human**:
An actor that is a person.
_Avoid_: user

**Agent**:
An actor that is software. Any human can create one and becomes its sponsor. An agent can own personal mailboxes, which an admin creates, and act in mailboxes it holds a grant to.
_Avoid_: bot, assistant

**Mailbox**:
A store of received and sent mail, reached through one or more addresses, that actors read and act on. It is either personal or shared.

**Personal mailbox**:
A mailbox owned by one actor. Admins cannot read it without a grant from the owner. When the actor is removed, it is handed over or deleted.

**Shared mailbox**:
A mailbox owned by the organization, where admins act as its owner. Other actors use it through grants. It holds one copy of each message; a group sends a copy to each member instead.
_Avoid_: team inbox, collaborative inbox

**Grant**:
Limited, revocable access to a mailbox, given to an actor by the mailbox's owner, or by an agent's sponsor for the agent's mailbox. It says which of read, organize, draft, send and delete the actor may do: everything includes read, and send includes draft. It also says whether sending needs approval (yes by default) and, for an agent, whether its mail carries the disclosure's visible line (yes by default). It works as soon as it's given and lasts until revoked. An actor holds at most one grant to a mailbox.
_Avoid_: delegation, permission, share

**Approval**:
Sign-off before an action takes effect. A send needs it when the sender's grant says so, from the mailbox's owner, or the sponsor for an agent's mailbox. An agent's send from its own mailbox, and a setup change by an agent admin, need it from the agent's sponsor; each can be switched off for that agent.

**Admin**:
An actor allowed to change the organization's setup: domains, addresses, groups, actors and settings. Admins act as owner of shared mailboxes only; they never give grants to personal ones. An agent can be an admin only if its sponsor is one.

**Sponsor**:
The human who answers for an agent, at first the one who created it. The sponsor acts as owner of the agent's personal mailboxes, gets the agent's alerts, can pause it or rotate its key, and approves its sends and setup changes. An agent whose sponsor is removed is paused until someone takes it over.
_Avoid_: owner (for agents), operator, creator

**Disclosure**:
The mark on mail an agent sends: always a header, even after a human approved it, and by default a visible line naming the agent and whom it acts for, the owner of the mailbox it sends from. It follows the actor who sends: a draft an agent wrote that a human sends carries none.

**Send limit**:
How much an actor may send per hour, and to how many new recipients per day. Agents start low; admins can change it. Mail over the limit waits.

## Domains and addresses

**Domain**:
A DNS domain the organization receives and sends mail for. An organization can have many. Each is either a standalone domain or an alias domain.

**Standalone domain**:
A domain whose addresses are its own.
_Avoid_: primary domain, main domain

**Alias domain**:
A domain that mirrors a standalone domain: every address there also exists here with the same local part. It has no addresses of its own.
_Avoid_: shadow domain, domain alias, secondary domain

**Address**:
An email address on one of the organization's domains. It delivers to exactly one mailbox, or it is a group. The same local part on two standalone domains gives two unrelated addresses.
_Avoid_: alias

**Plus tag**:
The part of an address after a +, like news in user-1+news@a.com. Mail to a tagged address reaches the untagged one, with the plus tag kept.
_Avoid_: tag, subaddress, detail

**Catch-all**:
A domain's optional mailbox or group for mail to addresses that don't exist. Off unless an admin sets one; otherwise such mail is refused.

**Default address**:
The address a mailbox sends new messages from unless the sender picks another. Replies go out from the address the original was sent to.

**External address**:
An email address on a domain the organization does not have.
_Avoid_: remote user, outside user

**Group**:
An address that delivers a copy of each message to every member. Each group sets who may send to it: anyone, the organization, or its members.
_Avoid_: distribution list, mailing list

**Member**:
An address, local or external, that receives a copy of a group's mail. A member can itself be a group; each mailbox still gets one copy.
_Avoid_: recipient, subscriber

## Organizing mail

**Thread**:
The messages of one conversation in a mailbox.
_Avoid_: conversation

**Label**:
A name on a thread. A thread can carry many labels.
_Avoid_: folder, tag, category

**Inbox**:
A built-in label for threads that want attention. New mail adds it; archiving removes it.

**Spam**:
A built-in label for mail judged to be spam. Threads with it are out of the Inbox and left out of agents' results unless they ask.

**Trash**:
A built-in label for deleted threads. Trash and Spam are erased for good after the organization's retention period, 30 days by default. Only the mailbox owner can empty Trash early.

**Screener**:
Where mail from a mailbox's first-time senders waits until an actor who may organize the mailbox lets the sender in or blocks them. On by default for humans' personal mailboxes, off for agents' and shared ones.

**Tracking protection**:
Keeping senders from learning whether, when or where their mail was read. On by default; each actor can turn it off.

**Change feed**:
The ordered record of every change in a mailbox, of every change to the organization's setup, and of the grants each actor gives and is given. A change made by an actor names that actor; arriving mail names none. Clients and agents catch up from where they left off. It is also the audit trail.
_Avoid_: event log, activity log, audit log
