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
An actor that is software. Any human can create one, or approve one's access request, and becomes its sponsor, and each human's mailbox has its mailbox agent. An agent owns no mailbox and is never an admin: it works only in its sponsor's personal mailboxes, with the sponsor access its sponsor gives it (ADR-0030). Any agent but a mailbox agent runs outside Duva, self-hosted, and calls it with its key.
_Avoid_: bot, assistant

**Mailbox agent**:
The agent Duva itself runs for each human, created with their first personal mailbox, with them as its sponsor. Every mailbox agent is named Coo, which its human can't change, and the web app draws it as Coo too, a pigeon, where any other agent has the diamond. It works in all its human's personal mailboxes, and in a mailbox handed to another human that human's Coo works instead. Asked from one mailbox, it works on that one unless its human says otherwise; asked from All mailboxes, on all of them. It has the sponsor access its human gives it, by default up to asking to send, each send waiting for their approval and carrying the disclosure's line. Its human asks it in Ask Coo or through the MCP endpoint, and it acts through Duva's API as itself, so all it does is attributed to it, and it obeys pause, send limits and alerts as any agent does. It has no key: each run gets a token of its own. Its human chooses the models it thinks with, an everyday one and a harder one, from the measured models admins allow. Admins set the organization's defaults and what all mailbox agents may spend a month (ADR-0027, ADR-0032, ADR-0035).
_Avoid_: assistant, bot, copilot

**Coo**:
The name of every mailbox agent, after the sound a duva, Swedish for dove, makes. In the web app Coo's portrait heads the side column, where Duva's wordmark was: it bobs its head while it works, and says, in a bubble under it, when there's news worth a glance in the mailbox open there, or in all of them from All mailboxes, unless its human turned Coo speaks up off.
_Avoid_: the bot, the assistant

**Harder model**:
The model a mailbox agent's harder work goes to: writing mail that may be sent, unsubscribing on a sender's page, a turn the decider finds complex, a run the everyday model hands over, and Think harder. Its human chooses it, as they choose the everyday model, from the measured models admins allow (ADR-0032, ADR-0035).

**Measured model**:
A model on Amazon Bedrock that Duva has recorded on its mailbox agent's evaluation, with how often it does each kind of work, what a task costs, and where it processes the mail it reads: in the deployment's region, its continent, the US, or anywhere. Only measured models can be allowed or chosen, and wherever they're chosen the place shows beside each.

**Handover**:
A run going over from the everyday model to the harder one, with the work so far, and why: decided, writing, failed calls, step budget, asked for help, or an answer that didn't hold up. The turn or the task, and the agent's activity, show it (ADR-0032).
_Avoid_: escalation, fallback

**Decider**:
The one call to Amazon Nova Micro that settles whether a turn of Ask Coo is simple, for the everyday model, or complex, for the harder model, with its confidence. Off unless an admin turns it on (ADR-0032). A router that learns from the routing Duva keeps would be a later layer, not the decider.
_Avoid_: classifier

**Think harder**:
Asking the harder model to answer a human's last turn of Ask Coo again. Its answer is a new turn, and the turn's routing is kept as thought harder (ADR-0032).

**Ask Coo**:
A human's conversation with Coo, their mailbox agent, in the web app's reading pane, asked from one of their mailboxes or from All mailboxes. Each thing they ask, and each answer, is a turn; the agent's turns say what it did, with links to the threads and drafts it touched. The agent reads back the last turns, until the human starts over. A thread of mail is never called a conversation.

**MCP endpoint**:
Duva's remote MCP server, one per deployment at `/mcp` on the API's domain, which an MCP client signs in to with a human's Duva account. Its tools reach the human's own mailbox agent: asking it or giving it a task, and Duva's operations in the human's mailboxes, each called as that agent, so they do only what it may, attributed to it, with its sends waiting for approval as its do (ADR-0028).
_Avoid_: connector, integration, plugin

**MCP client**:
An app that speaks MCP, such as Claude Code or Claude Desktop, which a human connects to the MCP endpoint. Each registers itself with Duva, and signs the human in through managed login by way of the endpoint. Its session opens only the MCP endpoint, never the API.
_Avoid_: connector. The web app calls them AI apps, to humans.

**Mailbox**:
A store of received and sent mail, reached through one or more addresses, that actors read and act on. Every mailbox is a personal mailbox.
_Avoid_: account, inbox (for the whole mailbox)

**Personal mailbox**:
A mailbox owned by one human. Admins cannot read it. When the human is removed, it is handed over or deleted. A human may own several, which admins create.

**All mailboxes**:
Every mailbox an actor can read, taken together, beside each one alone. Each view, search and count works on All mailboxes as on one mailbox, and each thread there says which address it came to. A message delivered to two of them is two threads there, as it is two copies: reading or replying to one marks only that one, so each mailbox shows whether it has answered. Labels with the same name in several mailboxes are one label there. Deciding on a sender, or writing a reply, still belongs to the mailbox the thread is in. A human with several mailboxes opens the web app on All mailboxes, unless their preference names one.
_Avoid_: unified inbox, combined inbox, all accounts

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
Sign-off from an agent's sponsor before the agent's send from the sponsor's mailbox goes out. The sponsor can switch it off for that agent.

**Undo window**:
How long an agent's approved send waits before it goes out, so its approver can undo the approval, which puts it back among the requests that wait, as the agent asked it. Admins set it for the organization, from 0 to 120 seconds, 30 by default (ADR-0022). A send held after the window, while its agent is paused or by its send limits, stays approved. A human's own sends never wait.

**Approval log**:
A sponsor's record of every decision on their agents' sends, newest first: who decided, when, and how it went, sent, failed or rejected with its note. It reaches as far back as approval records are kept (ADR-0014). From it a sponsor undoes a send during its undo window, sends a rejected one after all while its draft is as the agent asked it, or writes a correction to the recipients of mail that went out, which can't be called back.

**Admin**:
A human allowed to change the organization's setup: domains, addresses, groups, actors and settings. Admins can't read personal mailboxes. Only humans are admins; no agent is one.

**Preference**:
A choice a human makes for themselves about how Duva shows things to them, such as how times and dates read in the web app, the time zone their agents' activity gives dates and times in, whether mail shows as designed or as plain text, where the web app opens (All mailboxes or one of them), or which address new mail in All mailboxes starts from. It follows them to every browser, and no one else sees or changes it. An agent has none; its sponsor changes its settings.
_Avoid_: user setting, profile

**Sponsor**:
The human who answers for an agent, at first the one who created it or approved its access request. The sponsor gives it sponsor access to their mailboxes, gets its alerts, can pause it or rotate its key, and approves its sends. Admins can pause an agent too, and Duva pauses one by itself when its mail draws a complaint or many bounces (ADR-0021). When the sponsor is removed, their agents are removed too.
_Avoid_: owner (for agents), operator, creator

**Disclosure**:
The mark on mail an agent sends: always a header, even after a human approved it, and by default a visible line naming the agent and whom it acts for, its sponsor. The sponsor can turn the line off for that agent. Disclosure follows the actor who sends: a draft an agent wrote that its sponsor sends carries none.

**Attachment**:
A file a message carries. A draft takes attachments its writer uploads, or those of the mail it forwards.

**Upload**:
A file on its way to a draft: its parts go straight to Duva's storage, and completing the upload attaches it. An upload never completed is given up after a day.

**Linked file**:
An attachment sent as a link instead of inside the message: Duva links the largest attachments when carrying them all would make the message more than 10 MB, and the sender may link any one. The message lists each with its size and the date its link stops working, 30 days after the send unless the sender chose 7 days or a year. Anyone with the link opens a page with the file and a Download button. The sender sees how often each was downloaded, and Coo tells them the first time. Stopping sharing, undoing the send or erasing the sent mail ends the link at once and deletes the file.
_Avoid_: share, transfer, large attachment

**Send limit**:
How much an agent may send per hour, and to how many new recipients per day: 100 and 50 to start. A sponsor sets their agent's limits up to the organization's cap, which admins set. Mail over the limit waits and goes out by itself as the limit allows, or when the sponsor sends it now. Humans have none.

**Activity**:
What an agent did, and what was done to it, as one list of events, newest first, across days. Each event is one change from a change feed, such as a turn of Ask Coo, a task, a draft or a send, an approval, a thread organized, a sender screened, an unsubscribe, a pause or a change to its limits, or an alert its sponsor got, with when it happened and what happened in one line. Each opens into everything recorded on it: the threads, drafts and senders it touched, the models and a handover, the cost, why it failed, and a task's note. It is read from change feeds, so it reaches back to the agent's start. Only its sponsor and admins read it, and an admin who isn't the sponsor reads none of what the mail says.
_Avoid_: daily summary, timeline, audit log

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
The address a mailbox sends new messages from unless the sender picks another. New mail written in All mailboxes starts from the address the human's preference names, and can go from any of their addresses. Replies go out from the address the original was sent to, and replies to group mail from the member's own address unless they choose the group.

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

**Label prompt**:
What a label's owner asks the mailbox agent to do with each message that gets the label, the Feed's and the Paper Trail's included. Adding the label, by hand, by an agent or by a sender's delivery, gives the agent a task, once per message per label, and the message goes where it would anyway (ADR-0029).
_Avoid_: rule, filter, automation

**Task**:
Work a label prompt gave the mailbox agent: the prompt, with a message that got the label and its thread. It waits, works, and is done or fails, with the agent's note, which the thread and the agent's activity show. A failed one is an alert to its sponsor. Removing the label doesn't recall it.
_Avoid_: job

**Inbox**:
A built-in label for threads that want attention. New mail adds it, unless its sender's delivery files it elsewhere; archiving removes it. A thread lies in at most one of the Inbox, the Feed and the Paper Trail.

**Feed**:
A built-in label for newsletters, read as a stream. A sender's delivery files their mail here instead of the Inbox, and it arrives unread, counted here and never on the Inbox. Mail screened in from the Screener arrives read.

**Paper Trail**:
A built-in label for receipts and notifications. A sender's delivery files their mail here instead of the Inbox, and it arrives unread, counted here and never on the Inbox. Mail screened in from the Screener arrives read.

**Remind me**:
Setting a thread aside until a time, chosen as later today, tomorrow morning, next week or an exact time, in the human's time zone. The thread leaves the Inbox and waits in Remind me until then, when it comes back to the top of the Inbox, unread, with a Back mark naming when it was set aside, which it keeps until it leaves the Inbox. New mail in the thread brings it back early. Cancelling puts it back in the Inbox at once, at its own place and without the mark.
_Avoid_: snooze, bubble up

**Spam**:
A built-in label for mail judged to be spam. Threads with it are out of the Inbox and left out of agents' results unless they ask.

**Trash**:
A built-in label for deleted threads. Trash and Spam are erased for good after the organization's retention period, 30 days by default and 7 to 365, counted from when each thread got the label. Only the mailbox owner can empty Trash early.

**Screener**:
Where mail from a mailbox's first-time senders waits until an actor who may organize the mailbox decides the sender's delivery. A first-time sender is one the mailbox hasn't decided on and hasn't sent mail to; senders on the organization's own domains, and messages joining a thread the mailbox already has, never wait. Letting a sender in is choosing the Inbox, and blocking them is choosing nowhere. On by default; the mailbox's owner switches it.
_Avoid_: gatekeeper, allowlist

**Delivery**:
Where a screened sender's mail goes in a mailbox: the Inbox, the Feed, the Paper Trail, a label of the mailbox's own instead of the Inbox, or nowhere. It applies to their later mail, whether the Screener is on or not, and to their threads already there: changing it moves them all, archived ones too, to where it goes now, and they keep the labels given by hand. Those in Spam, Trash or Remind me stay there. Group mail skips it, as it skips the Screener.

**Nowhere**:
The delivery that drops a sender's mail on arrival, keeping none of it, not even in Trash, and records only that a message from them was dropped. Choosing it erases their threads in the mailbox for good, and unsubscribes from their mail, as each message dropped later does too, until one method works: see Unsubscribing. Removing it brings back nothing. Only the mailbox's owner chooses it (ADR-0025).
_Avoid_: blackhole

**Unsubscribing**:
What Duva does for a sender sent nowhere, in order, for mail SES didn't judge to be spam: one-click, the RFC 8058 POST; then the mailbox agent, by itself, on the opt-out page the mail names, in an isolated browser where it can type only the mailbox's address; by mailing the unsubscribe address the mail names, without approval; by an unsubscribe link in the body on the signer's domain; and as a last resort by bouncing the sender's mail as if the address were unknown. All but one-click need mail that passed DMARC. The sender's sheet says how it went last (ADR-0031).

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
Finding threads in one mailbox, or in All mailboxes, by words and meaning together, with filters such as from: and label:. It covers subjects, senders, recipients, message text and attachment names, Sent included, and leaves out Spam and Trash unless asked. An actor searches only mailboxes it can read.
_Avoid_: query, lookup

**Search languages**:
The languages an organization's mail is in, which admins choose: English and Swedish by default, Danish too if chosen. Each search is also translated into every other one, so a Swedish word finds English mail. Mail in each is indexed with its own stemming.
_Avoid_: locales, translation setting

**Change feed**:
The ordered record of every change in a mailbox, and of every change to the organization's setup. A change made by an actor names that actor; arriving mail names none. Clients and agents catch up from where they left off. It is also the audit trail.
_Avoid_: event log, activity log, audit log
