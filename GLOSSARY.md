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
An actor that is software. Any human can create one, or approve one's access request, and becomes its sponsor, and each human's mailbox has its mailbox agent. An agent can own personal mailboxes, which an admin creates, and works in no one else's mailbox but its sponsor's, if its sponsor gives it sponsor access.
_Avoid_: bot, assistant

**Mailbox agent**:
The agent Duva itself runs for each human's personal mailbox, created with the mailbox, with its owner as its sponsor. It works only in that mailbox, with the sponsor access its owner gives it, by default up to asking to send, each send waiting for their approval and carrying the disclosure's line. Its owner asks it in Ask your agent, and it acts through Duva's API as itself, so all it does is attributed to it, and it obeys pause, send limits and alerts as any agent does. It has no key: each run gets a token of its own. It owns no mailbox and is never an admin. Admins choose the model it thinks with, where the mail it reads is processed, and what all mailbox agents may spend a month (ADR-0027).
_Avoid_: assistant, bot, copilot

**Ask your agent**:
A human's conversation with the mailbox agent of one of their mailboxes, in the web app's reading pane. Each thing they ask, and each answer, is a turn; the agent's turns say what it did, with links to the threads and drafts it touched. The agent reads back the last turns, until the human starts over. A thread of mail is never called a conversation.

**Mailbox**:
A store of received and sent mail, reached through one or more addresses, that actors read and act on. Every mailbox is a personal mailbox.

**Personal mailbox**:
A mailbox owned by one actor. Admins cannot read it. When the actor is removed, it is handed over or deleted.

**Sponsor access**:
An agent's access to its sponsor's personal mailboxes, which the sponsor gives per agent and which is off by default. It covers the mailboxes the sponsor chooses, all of theirs unless they choose. Read lets it read everything there. Organize also lets it organize, screen senders, set threads aside and move them to Trash and back. Draft also lets it draft. Send also lets it send as the sponsor, on their behalf with the disclosure's visible line or as them without it. Only the sponsor empties the Trash. Mail that several people need goes to a group, which gives each member their own copy; no actor works in another human's mailbox.
_Avoid_: grant, delegation, share, full access

**Access request**:
A self-hosted agent asking a human for access, with a code it shows them and a link to the web app, as `duva login --agent` does. The human sees its name, where it asked from and what it asks for, adjusts its name, mailboxes, sponsor access and approval, then approves, which makes them its sponsor, or declines. The agent then collects its key once. A code works for 10 minutes and once.
_Avoid_: device flow, pairing, invitation

**Alert**:
A notice to a sponsor that one of their agents needs them: a failed, bounced or complained-about send, its send limit reached, its key used while paused, a pause, change or removal by someone else, or a mailbox agent stopped at the organization's spend cap. Alerts show in the web app, and urgent ones are also mailed to the sponsor's own mailbox.
_Avoid_: notification, warning

**Approval**:
Sign-off before an action takes effect. An agent's send from its own mailbox, its send from its sponsor's mailbox, and a setup change by an agent admin need it from the agent's sponsor; each can be switched off for that agent on its own.

**Undo window**:
How long an agent's approved send waits before it goes out, so its approver can undo the approval, which puts it back among the requests that wait, as the agent asked it. Admins set it for the organization, from 0 to 120 seconds, 30 by default (ADR-0022). A send held after the window, while its agent is paused or by its send limits, stays approved. A human's own sends never wait.

**Approval log**:
A sponsor's record of every decision on their agents' sends, newest first: who decided, when, and how it went, sent, failed or rejected with its note. It reaches as far back as approval records are kept (ADR-0014). From it a sponsor undoes a send during its undo window, sends a rejected one after all while its draft is as the agent asked it, or writes a correction to the recipients of mail that went out, which can't be called back.

**Admin**:
An actor allowed to change the organization's setup: domains, addresses, groups, actors and settings. Admins can't read personal mailboxes. An agent can be an admin only if its sponsor is one, and stops being one when its sponsor does. An agent admin never removes humans or agents, or changes who is admin.

**Preference**:
A choice a human makes for themselves about how Duva shows things to them, such as how times and dates read in the web app, the time zone their agents' activity is counted in, or whether mail shows as designed or as plain text. It follows them to every browser, and no one else sees or changes it. An agent has none; its sponsor changes its settings.
_Avoid_: user setting, profile

**Sponsor**:
The human who answers for an agent, at first the one who created it. The sponsor acts as owner of the agent's personal mailboxes, gets the agent's alerts, can pause it or rotate its key, and approves its sends and setup changes. Admins can pause an agent too, and Duva pauses one by itself when its mail draws a complaint or many bounces (ADR-0021). When the sponsor is removed, their agents are removed too, and their mailboxes erased.
_Avoid_: owner (for agents), operator, creator

**Disclosure**:
The mark on mail an agent sends: always a header, even after a human approved it, and by default a visible line naming the agent and whom it acts for, its sponsor. The sponsor can turn the line off for that agent, separately for mail from its own mailbox and mail it sends as the sponsor. Disclosure follows the actor who sends: a draft an agent wrote that its sponsor sends carries none.

**Send limit**:
How much an agent may send per hour, and to how many new recipients per day: 100 and 50 to start. A sponsor sets their agent's limits up to the organization's cap, which admins set. Mail over the limit waits and goes out by itself as the limit allows, or when the sponsor sends it now. Humans have none.

**Activity**:
What an agent did, and what happened in its mailboxes, day by day: a daily summary of how much it sent, had approved or rejected, received, organized and screened, which opens into the day's timeline. It is read from change feeds, so it reaches back to the agent's start. Only its sponsor and admins read it, and an admin who isn't the sponsor reads none of what the mail says.
_Avoid_: log, audit. The approval log is the record of a sponsor's decisions.

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
A built-in label for threads that want attention. New mail adds it, unless its sender's delivery files it elsewhere; archiving removes it. A thread lies in at most one of the Inbox, the Feed and the Paper Trail.

**Feed**:
A built-in label for newsletters, read as a stream. A sender's delivery files their mail here instead of the Inbox, and it arrives read, so it counts nothing unread.

**Paper Trail**:
A built-in label for receipts and notifications. A sender's delivery files their mail here instead of the Inbox, and it arrives read.

**Remind me**:
Setting a thread aside until a time, chosen as later today, tomorrow morning, next week or an exact time, in the human's time zone. The thread leaves the Inbox and waits in Remind me until then, when it comes back to the top of the Inbox, unread, with a Back mark naming when it was set aside, which it keeps until it leaves the Inbox. New mail in the thread brings it back early. Cancelling puts it back in the Inbox at once, at its own place and without the mark.
_Avoid_: snooze, bubble up

**Spam**:
A built-in label for mail judged to be spam. Threads with it are out of the Inbox and left out of agents' results unless they ask.

**Trash**:
A built-in label for deleted threads. Trash and Spam are erased for good after the organization's retention period, 30 days by default and 7 to 365, counted from when each thread got the label. Only the mailbox owner can empty Trash early.

**Screener**:
Where mail from a mailbox's first-time senders waits until an actor who may organize the mailbox decides the sender's delivery. A first-time sender is one the mailbox hasn't decided on and hasn't sent mail to; senders on the organization's own domains, and messages joining a thread the mailbox already has, never wait. Letting a sender in is choosing the Inbox, and blocking them is choosing nowhere. On by default for humans' personal mailboxes, off for agents'; the mailbox's owner switches it.
_Avoid_: gatekeeper, allowlist

**Delivery**:
Where a screened sender's mail goes in a mailbox: the Inbox, the Feed, the Paper Trail, a label of the mailbox's own instead of the Inbox, or nowhere. It applies to their later mail, whether the Screener is on or not, and to their threads already there: those where their mail went before move to where it goes now, and keep the labels given by hand. Group mail skips it, as it skips the Screener.

**Nowhere**:
The delivery that drops a sender's mail on arrival, keeping none of it, not even in Trash, and records only that a message from them was dropped. Choosing it erases their threads in the mailbox for good, and unsubscribes from their mail when it offers one-click unsubscribe, as each message dropped later does too. Removing it brings back nothing. Only the mailbox's owner, or an agent's sponsor, chooses it (ADR-0025).
_Avoid_: blackhole

**Screened sender**:
An address or a domain a mailbox has decided a delivery for. A domain covers exactly that domain, never its subdomains, and is never a public mail provider's. An address beats its domain.
_Avoid_: contact, rule

**Tracking protection**:
Removing known trackers, such as spy pixels, from HTML mail before anyone sees it, and saying what was removed. Always on. Other remote images and fonts load from the sender's servers as they are.

**BIMI**:
Brand Indicators for Message Identification: how a domain publishes its logo in DNS, for receivers to show beside its mail. Duva honors it on received mail only when the message passed DMARC and the domain enforces DMARC (ADR-0023).

**Sender logo**:
The logo a sender's domain publishes through BIMI, which Duva shows in place of the sender's actor mark. Duva fetches it when mail arrives and serves it itself, so showing it never reaches the sender. It is verified, and marked with a check, when a VMC or CMC from a Mark Verifying Authority vouches for it and the domain. Mail from an agent keeps the agent's mark.
_Avoid_: avatar, brand icon

**Selector**:
The name of one of a domain's BIMI records, so a domain can publish several logos. A message names its selector in its BIMI-Selector header; without one, it is default. Duva gives a human's mailbox a selector of its own with its own logo (ADR-0026).

**Own logo**:
A logo the organization publishes through BIMI: each domain's default, which admins set, or a human's own logo for their mailbox, which some receivers show in place of the domain's. Duva converts it to SVG Tiny PS and serves it at a public URL that stays the same, and lists the TXT record it needs, but never changes DNS.
_Avoid_: avatar, brand icon

**Search**:
Finding threads in one mailbox by words and meaning together, with filters such as from: and label:. It covers subjects, senders, recipients, message text and attachment names, Sent included, and leaves out Spam and Trash unless asked. An actor searches only mailboxes it can read.
_Avoid_: query, lookup

**Search languages**:
The languages an organization's mail is in, which admins choose: English and Swedish by default, Danish too if chosen. Each search is also translated into every other one, so a Swedish word finds English mail. Mail in each is indexed with its own stemming.
_Avoid_: locales, translation setting

**Change feed**:
The ordered record of every change in a mailbox, and of every change to the organization's setup. A change made by an actor names that actor; arriving mail names none. Clients and agents catch up from where they left off. It is also the audit trail.
_Avoid_: event log, activity log, audit log
