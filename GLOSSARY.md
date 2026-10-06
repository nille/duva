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
An actor that is software. Any human can create one and becomes its sponsor. An agent can own personal mailboxes, which an admin creates, and works in no one else's mailbox but its sponsor's, if its sponsor gives it sponsor access.
_Avoid_: bot, assistant

**Mailbox**:
A store of received and sent mail, reached through one or more addresses, that actors read and act on. Every mailbox is a personal mailbox.

**Personal mailbox**:
A mailbox owned by one actor. Admins cannot read it. When the actor is removed, it is handed over or deleted.

**Sponsor access**:
An agent's access to its sponsor's personal mailbox, which the sponsor gives per agent and which is off by default. Read lets it read everything there. Full also lets it organize, move threads to Trash and back, draft, and send as the sponsor. Only the sponsor empties the Trash. Mail that several people need goes to a group, which gives each member their own copy; no actor works in another human's mailbox.
_Avoid_: grant, delegation, share

**Alert**:
A notice to a sponsor that one of their agents needs them: a failed, bounced or complained-about send, its send limit reached, its key used while paused, or a pause, change or removal by someone else. Alerts show in the web app, and urgent ones are also mailed to the sponsor's own mailbox.
_Avoid_: notification, warning

**Approval**:
Sign-off before an action takes effect. An agent's send from its own mailbox, its send from its sponsor's mailbox, and a setup change by an agent admin need it from the agent's sponsor; each can be switched off for that agent on its own.

**Admin**:
An actor allowed to change the organization's setup: domains, addresses, groups, actors and settings. Admins can't read personal mailboxes. An agent can be an admin only if its sponsor is one, and stops being one when its sponsor does. An agent admin never removes humans or agents, or changes who is admin.

**Preference**:
A choice a human makes for themselves about how Duva shows things to them, such as how times and dates read in the web app, or whether mail shows as designed or as plain text. It follows them to every browser, and no one else sees or changes it. An agent has none; its sponsor changes its settings.
_Avoid_: user setting, profile

**Sponsor**:
The human who answers for an agent, at first the one who created it. The sponsor acts as owner of the agent's personal mailboxes, gets the agent's alerts, can pause it or rotate its key, and approves its sends and setup changes. Admins can pause an agent too, and Duva pauses one by itself when its mail draws a complaint or many bounces (ADR-0021). When the sponsor is removed, their agents are removed too, and their mailboxes erased.
_Avoid_: owner (for agents), operator, creator

**Disclosure**:
The mark on mail an agent sends: always a header, even after a human approved it, and by default a visible line naming the agent and whom it acts for, its sponsor. The sponsor can turn the line off for that agent, separately for mail from its own mailbox and mail it sends as the sponsor. Disclosure follows the actor who sends: a draft an agent wrote that its sponsor sends carries none.

**Send limit**:
How much an agent may send per hour, and to how many new recipients per day: 100 and 50 to start. A sponsor sets their agent's limits up to the organization's cap, which admins set. Mail over the limit waits and goes out by itself as the limit allows, or when the sponsor sends it now. Humans have none.

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
A domain's optional mailbox or group for mail to addresses that don't exist, removed ones included. Off unless an admin sets one; otherwise such mail is refused.

**Default address**:
The address a mailbox sends new messages from unless the sender picks another. Replies go out from the address the original was sent to, and replies to group mail from the member's own address unless they choose the group.

**External address**:
An email address on a domain the organization does not have.
_Avoid_: remote user, outside user

**Group**:
An address that delivers a copy of each message to every member. Each group sets who may send to it: anyone, the organization, or its members, and that is its only gate: group mail skips members' Screeners. A local member can send as the group, and a copy of what they send goes to the other local members, so everyone sees it was answered.
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
A built-in label for deleted threads. Trash and Spam are erased for good after the organization's retention period, 30 days by default and 7 to 365, counted from when each thread got the label. Only the mailbox owner can empty Trash early.

**Screener**:
Where mail from a mailbox's first-time senders waits until an actor who may organize the mailbox lets the sender in or blocks them. A first-time sender is one the mailbox hasn't let in and hasn't sent mail to; senders on the organization's own domains, and messages joining a thread the mailbox already has, never wait. Letting in moves the sender's waiting threads to the Inbox; blocking moves them to Trash, and later mail from them goes straight there. Removing a block, or letting the sender in, brings back to the Inbox only the threads the block put in Trash, never those trashed by hand. On by default for humans' personal mailboxes, off for agents'; the mailbox's owner switches it.
_Avoid_: gatekeeper, allowlist

**Screened sender**:
An address or a domain a mailbox has let in or blocked. A domain covers exactly that domain, never its subdomains, and is never a public mail provider's. An address beats its domain. Blocking a sender also unsubscribes from their mail when it offers one-click unsubscribe.
_Avoid_: contact, rule

**Tracking protection**:
Removing known trackers, such as spy pixels, from HTML mail before anyone sees it, and saying what was removed. Always on. Other remote images and fonts load from the sender's servers as they are.

**Search**:
Finding threads in one mailbox by words and meaning together, with filters such as from: and label:. It covers subjects, senders, recipients, message text and attachment names, Sent included, and leaves out Spam and Trash unless asked. An actor searches only mailboxes it can read.
_Avoid_: query, lookup

**Search languages**:
The languages an organization's mail is in, which admins choose: English and Swedish by default, Danish too if chosen. Each search is also translated into every other one, so a Swedish word finds English mail. Mail in each is indexed with its own stemming.
_Avoid_: locales, translation setting

**Change feed**:
The ordered record of every change in a mailbox, and of every change to the organization's setup. A change made by an actor names that actor; arriving mail names none. Clients and agents catch up from where they left off. It is also the audit trail.
_Avoid_: event log, activity log, audit log
