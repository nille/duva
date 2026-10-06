---
name: duva
description: Read and act on mail in Duva, the mailbox platform where humans and agents are both actors, with its duva CLI. Use when you work with a Duva mailbox or run any duva command.
---

# Duva's CLI

This skill describes duva 0.1.0. After updating the CLI, run `duva skill install` to update the skill too.

## Authentication

duva calls the Duva deployment that `duva deploy` saved in its config, `~/.config/duva/config.json`. On a machine where nobody ran it, copy that file from one where someone did. An agent calls Duva with the key its sponsor got when creating it. Put the key in the `DUVA_AGENT_KEY` environment variable, and every command acts as that agent. An agent never signs in. If Duva refuses the key, the sponsor may have rotated it, so ask them for the current one. A human signs in with `duva login` instead.

## Output and exit codes

Every command prints JSON on stdout and exits with 0. When a command fails, it prints `{"error": "..."}` on stderr and exits with 1. The message says what went wrong.

## Approval

By default, an agent's send from its own mailbox waits for its sponsor's approval. Asking to send succeeds once the request is waiting, before any mail goes out. The sponsor then sends the draft as it is, edits and sends it, or rejects it with a note you can read. Changing the draft withdraws a waiting request. The mailbox's change feed records each step.

# Commands

## duva deploy

Deploy Duva into the AWS account and region of your AWS configuration, for the organization's first domain, with you as its first admin.

Running it again updates the deployment to this CLI's version.

- `--domain`: The organization's first domain. Needed only the first time.
- `--admin`: Your email address, as the first admin. Needed only the first time.

## duva login

Sign in as a human through the browser.

## duva skill install

Install the skill that teaches agents this CLI, replacing any older copy.

## duva attachments download

Download one of a message's attachments to a file, and say where it went.

Without --file, the attachment goes in the working directory under its own name. An existing file is never overwritten. Only those who can read the mailbox can download from it: its owner and, for an agent's mailbox, its sponsor.

- `--mailbox` (required): The mailbox's ID.
- `--message` (required): The message's ID.
- `--attachment` (required): The attachment's place among the message's attachments, from 0.
- `--file`: Where to save it. Without it, the working directory, under the attachment's name.

## duva status

Show Duva's version and the deployment's region.

Answers without sign-in, so any client can check that it reaches the deployment.

## duva whoami

Show the signed-in actor.

## duva organization changes

List the changes to the organization's setup after a position in its change feed.

Lists up to 100 changes, oldest first. To catch up, call again with the position the answer ends at until it lists no more. Only admins can read the organization's change feed.

- `--after`: The position to list changes after. 0, the default, lists from the start.

## duva organization mailboxes

List every mailbox in the organization, with its addresses and the actor that owns it.

For giving mailboxes addresses and choosing their default address. It lists what reaches each mailbox and who owns it, and reads none of their mail, which admins can't read. Only admins can list the organization's mailboxes.

## duva organization agents

List every agent in the organization, with its sponsor.

For seeing who sponsors which agent, and removing agents. Only admins can list the organization's agents. A human lists the agents they sponsor with agents list.

## duva organization settings

Read the organization's settings.

Every actor can read them. Only admins change them.

## duva organization change-settings

Change the organization's settings.

Give only the settings to change. A setting applies from when it changes, so turning on erasureErasesApprovals leaves the approval records of threads erased before then. A shorter retentionDays reaches back: the eraser's next daily run erases every thread that has had Trash or Spam longer than it. Preview the period first to see how many. Lowering an agent cap lowers each agent above it, each recorded as a change to its settings under you. Only admins can change the settings. Each change is recorded in the organization's change feed under you.

- `--erasureErasesApprovals` or `--no-erasureErasesApprovals`: Whether erasing a thread also erases the approval records of the agents' sends in it: the draft its approver saw and any edit they made. Off by default, so the records stay as the account of what an agent sent and who approved it. Either way the mailbox's change feed keeps each decision and who made it.
- `--retentionDays`: How many days Trash and Spam keep a thread, counted from when it got the label, before the eraser erases it for good. 30 by default, and a whole number from 7 to 365. It applies to all Trash and Spam, threads already there included.
- `--searchLanguages` (once for each): The languages the organization's mail is in, English and Swedish by default. Each search is also translated into every other one on the list, so "kvitto" finds an English receipt: its words go to Amazon's Nova Lite model, in the same AWS region as the mail, which adds a little time to each search. With fewer than two, searches aren't translated. Quoted phrases and subject: never are. English and Swedish mail is always indexed in its own language. Adding another, or removing it, rebuilds every mailbox's search index, embedding its mail again, and search finds less until that is done.
- `--agentSendsPerHourCap`: The most sendsPerHour a sponsor can give an agent. 100 by default. Lowering it lowers each agent above it to it, recorded as a change to the agent's settings under you. Raising it raises no agent.
- `--agentNewRecipientsPerDayCap`: The most newRecipientsPerDay a sponsor can give an agent. 50 by default. Lowering it lowers each agent above it to it, recorded as a change to the agent's settings under you. Raising it raises no agent.

## duva organization preview-retention

Count the threads the eraser's next run would erase under a retention period.

Counts the threads in every mailbox's Trash and Spam that are older than retentionDays now, counted from when each got the label. With that retention period, the eraser's next daily run erases them, and any that pass it before the run. It counts threads, and reads none of them. Only admins can preview the retention period.

- `--retentionDays` (required): The retention period to preview, in days, a whole number from 7 to 365.

## duva preferences get

Read your own preferences, such as how the web app shows times, dates and mail.

Only humans have preferences, and each reads only their own.

## duva preferences change

Change your own preferences.

Give only the preferences to change. They follow you to every browser you sign in from. Only humans have preferences, and each changes only their own. The CLI prints timestamps as ISO 8601 whatever they are.

- `--hourCycle`: How the web app shows times. Locale, the default, follows the browser's language. h12 shows 12-hour time, as 2:30 PM, and h23 24-hour time, as 14:30.
- `--dateFormat`: How the web app shows dates. Locale, the default, follows the browser's language. iso shows 2026-10-05, dayMonth 5 Oct 2026 and monthDay Oct 5, 2026, with month names in the browser's language. Without the year, they show 10-05, 5 Oct and Oct 5.
- `--mailView`: How the web app shows a message that has HTML. html, the default, shows it as its sender designed it, with known trackers removed. text shows its plain text. Either way, the human can switch each message the other way.
- `--keyboardShortcuts`: Whether single keys work as shortcuts in the web app, such as j and k to move through a list and e to archive. on, the default, has them work anywhere but in a field. off turns them all off, for speech input or keys pressed by mistake.
- `--timeZone` or `--no-timeZone`: The time zone, as an IANA name, or null to remove it, as if the human never chose one. The CLI removes it with --no-timeZone.

## duva humans list

List the organization's humans.

Only admins can list the organization's humans.

## duva humans add

Add a human to the organization by their email address, so they can sign in.

Only admins can add humans. The human signs in with a code emailed to the address, and has no mailbox until an admin creates one for them. Adding a human is a change to the organization's setup, recorded in its change feed.

- `--email` (required): The address the human signs in with.

## duva humans change

Make a human an admin, or take it away.

Only admins can change who is an admin, and only humans can be admins. The organization always keeps one, so taking it from the last admin is refused. The change is recorded in the organization's change feed under you.

- `--human` (required): The human's ID.
- `--admin` or `--no-admin` (required): Whether the human may change the organization's setup.

## duva humans remove

Remove a human, handing over or deleting each of their mailboxes, and remove the agents they sponsor.

Only admins can remove humans. Run it first with dryRun to see the human's mailboxes, their agents and the agents' mailboxes. Then say what happens to each of the human's mailboxes: handOver gives it to the human handTo, as another personal mailbox of theirs with its addresses and mail, and delete erases it. The agents are removed, so their keys stop working, and their mailboxes are erased. Erasing a mailbox erases its mail everywhere Duva keeps it, as emptying Trash does, and its approval records only if the organization's settings say so. Its addresses are freed at once. The human's Cognito user is deleted and their sessions stop working. The organization always keeps one admin, so the last admin can't be removed. Each change is recorded in the organization's change feed under you, and older entries keep naming the human and their agents by ID.

- `--human` (required): The human's ID.
- `--dryRun` or `--no-dryRun`: Lists what the removal takes and removes nothing.
- `--handTo`: The ID of the human the mailboxes in handOver go to.
- `--handOver` (once for each): The IDs of the mailboxes to hand to the human handTo, with their addresses and mail.
- `--delete` (once for each): The IDs of the mailboxes to erase, with their mail.

## duva agents list

List the agents you sponsor.

## duva agents create

Create an agent, with you as its sponsor, and show its key once.

Only humans can create agents. The answer is the only time Duva shows the agent's key: it keeps only a hash. Creating an agent is a change to the organization's setup, recorded in its change feed.

- `--name` (required): The agent's name.

## duva agents remove

Remove an agent, which stops its key working and erases its mailboxes.

Only the agent's sponsor and human admins can remove it, never an agent, not even an agent admin. Its sends and setup changes waiting for approval are withdrawn. Its mailboxes are erased everywhere Duva keeps their mail, as emptying Trash does, and their approval records only if the organization's settings say so. Their addresses are freed at once. The removal is recorded in the organization's change feed under you.

- `--agent` (required): The agent's ID.

## duva agents change

Make an agent you sponsor an admin, or take it away.

Only the agent's sponsor can, and only while they are an admin themselves to make it one. No agent can change who is an admin. An agent admin's changes to the setup wait for your approval unless you switch approvalForSetup off in its settings, and it never removes humans or agents, or changes who is an admin. It stops being an admin when you do, and its setup changes still waiting are withdrawn. The change is recorded in the organization's change feed under you.

- `--agent` (required): The agent's ID.
- `--admin` or `--no-admin` (required): Whether the agent may change the organization's setup, with its sponsor's approval unless switched off.

## duva agents rotate-key

Give an agent you sponsor a new key, show it once, and refuse the old one from now on.

Only the agent's sponsor can rotate its key. Rotating is a change to the organization's setup, recorded in its change feed.

- `--agent` (required): The agent's ID.

## duva agents pause

Pause an agent, which refuses its key and holds its approved sends until it is unpaused.

Only the agent's sponsor and admins can pause it. While it is paused, every call with its key is refused with 403, its approvals wait but can't be sent, and its sends already approved are held. Mail to its mailboxes keeps arriving. Pausing is recorded under you in the change feed of each of the agent's mailboxes and in the organization's. Pausing a paused agent changes nothing.

- `--agent` (required): The agent's ID.

## duva agents unpause

Unpause an agent, which lets its key work again and sends what it held.

Only the agent's sponsor and human admins can unpause it, never an agent. Its sends held while it was paused go out, those from each mailbox oldest first, so look at them first. Unpausing is recorded under you in the change feed of each of the agent's mailboxes and in the organization's. Unpausing an agent that isn't paused changes nothing.

- `--agent` (required): The agent's ID.

## duva agents settings

Read an agent's settings, its sponsor access, its approval and disclosure-line switches and its send limits.

Only the agent's sponsor and the agent itself can read them. An agent starts with no sponsor access, every switch on, and send limits of 100 an hour and 50 new recipients a day.

- `--agent` (required): The agent's ID.

## duva agents change-settings

Change an agent's sponsor access, its approval and disclosure-line switches, or its send limits.

Give only the settings to change. A change works at once. Only the agent's sponsor can change them, so not even an admin can. Each change is recorded under you, with the old and new values, in your personal mailbox's change feed, or if you have none, in the agent's. If neither of you has a mailbox, the change is refused. Read lets the agent read your mailbox. Full also lets it organize it, move threads to Trash and back, draft there, and send as you. Lowering access from full, or removing it, withdraws the agent's sends waiting for your approval in your mailbox, recorded in its change feed under you, and fails those approved but not yet gone out. Its drafts and sent messages stay. Send limits go up to the organization's caps, and raising one lets its sends that wait go out as far as the new limit allows.

- `--agent` (required): The agent's ID.
- `--sponsorAccess`: The agent's access to its sponsor's personal mailbox. None, the default, gives it none. Read lets it read everything there: threads, labels, drafts, the change feed and attachments. Full also lets it organize, move threads to Trash and back, draft and change any draft there, and send as its sponsor. Only the sponsor empties their Trash.
- `--approvalForOwnMailbox` or `--no-approvalForOwnMailbox`: Whether the agent's sends from its own mailbox wait for its sponsor's approval. On by default.
- `--approvalAsSponsor` or `--no-approvalAsSponsor`: Whether the agent's sends as its sponsor, from the sponsor's mailbox, wait for the sponsor's approval. On by default.
- `--disclosureLineForOwnMailbox` or `--no-disclosureLineForOwnMailbox`: Whether mail the agent sends from its own mailbox carries the disclosure's visible line. It always carries the Duva-Agent header. On by default.
- `--disclosureLineAsSponsor` or `--no-disclosureLineAsSponsor`: Whether mail the agent sends as its sponsor carries the disclosure's visible line. It always carries the Duva-Agent header. On by default.
- `--sendsPerHour`: How many messages the agent sends in any hour, from all its mailboxes and as its sponsor. 100 by default, and up to the organization's agentSendsPerHourCap. A send counts when it goes out, and one over the limit waits.
- `--newRecipientsPerDay`: How many new recipients the agent sends to in any 24 hours: addresses it hasn't sent to before, from any mailbox. 50 by default, and up to the organization's agentNewRecipientsPerDayCap. A send counts when it goes out, and one over the limit waits. A message with more new recipients than the whole limit waits until its sponsor sends it now.
- `--approvalForSetup` or `--no-approvalForSetup`: Whether the agent's changes to the organization's setup, as an admin, wait for its sponsor's approval. On by default.

## duva agents activity

Read an agent's daily summaries, how much it sent, had approved or rejected, received, organized and screened each day.

Gives every day from from to to, newest first, each day in your time zone, days without activity included. Leave both out for the last 30 days. Activity reaches back to the agent's start: what happened in its mailboxes, what it did in its sponsor's mailbox, and the organization's changes to it. Only the agent's sponsor and admins can read it.

- `--agent` (required): The agent's ID.
- `--from`: The first day, as YYYY-MM-DD. Defaults to 29 days before to.
- `--to`: The last day, as YYYY-MM-DD, at most 366 days after from. Defaults to today in your time zone.
- `--timeZone`: The time zone days are in, an IANA name such as Europe/Stockholm. Defaults to your timeZone preference, or UTC if you have none.

## duva agents timeline

Read an agent's timeline for one day, everything it did and what happened in its mailboxes, newest first.

Lists the day's entries a page at a time, newest first. Each is a change as the change feed recorded it, with the mailbox it was in and its thread, where it has them. To read the next page, call again with the answer's next as after, until an answer has no next. Only the agent's sponsor and admins can read it. An admin who isn't the sponsor reads no part of what the mail says, so the changes leave out approvers' edits and notes, label names, and senders' and recipients' addresses.

- `--agent` (required): The agent's ID.
- `--day` (required): The day, as YYYY-MM-DD, in your time zone.
- `--timeZone`: The time zone days are in, an IANA name such as Europe/Stockholm. Defaults to your timeZone preference, or UTC if you have none.
- `--limit`: How many entries a page lists at most.
- `--after`: Where the page starts, the next of the page before it. Leave it out for the first page.

## duva addresses list

List the organization's addresses, each with the mailbox it delivers to.

Only admins can list the organization's addresses.

## duva addresses add

Give a mailbox another address on one of the organization's standalone domains.

Mail to the address, and to its plus-tagged addresses, reaches the mailbox from then on, as does mail to the same address on each of the domain's alias domains. A mailbox that had no address takes it as its default address. Only admins can add addresses, and an address in use is refused. Adding an address is a change to the organization's setup, recorded in its change feed under you.

- `--address` (required): The address, on one of the organization's standalone domains, without a plus tag. Its alias domains mirror it.
- `--mailbox` (required): The ID of the mailbox it delivers to.

## duva addresses remove

Remove an address, so that its mail is refused from now on.

SES refuses mail to the address, and its plus-tagged addresses, at once, and the address can be given to any mailbox at once. The mail its mailbox already has stays there. If it was the mailbox's default address, the mailbox's earliest other address becomes its default. A mailbox left with no address keeps its mail, but receives and sends no new mail until it is given one. Only admins can remove addresses. Removing an address, and any change of default address it makes, are changes to the organization's setup, recorded in its change feed under you.

- `--address` (required): The address, without a plus tag. Case doesn't matter.

## duva groups list

List the organization's groups, with their members.

Only admins can list the organization's groups.

## duva groups create

Create a group, an address that delivers a copy of each message to every member.

Members are addresses: the organization's own, of mailboxes or other groups, and external addresses. Each local member's mailbox gets its own copy, marked with the group, which skips its Screener. A member that is a group gives its members a copy too, and each mailbox gets one copy however many ways it is a member. External members get the copy re-sent from the group's address, as "Alice via team", with Reply-To as the group's replyTo says. Mail from a sender the group's sendPolicy doesn't allow is bounced. Only admins can create groups. Creating one is a change to the organization's setup, recorded in its change feed under you.

- `--address` (required): The group's address, on one of the organization's standalone domains, without a plus tag. Its alias domains mirror it.
- `--members` (required) (once for each): The members' addresses, in lower case: the organization's addresses, of mailboxes or other groups, and external addresses. A member on the organization's domains must be one of its addresses, without a plus tag.
- `--sendPolicy`: Who may send to the group, by the From of their mail. Anyone, the default, lets everyone. Organization lets only senders on the organization's domains. Members lets only the group's members, its nested groups' included, from any address of a member's mailbox. A From on the organization's domains counts only if the mail passed DMARC, and any other only if it didn't fail it. Mail from anyone else is bounced.
- `--replyTo`: Where external members' replies to the copies re-sent to them go. Sender, the default, sends them to the original sender, and group to the group.

## duva groups get

Read a group, with its members.

Only admins can read the organization's groups.

- `--group` (required): The group's address. Case doesn't matter.

## duva groups delete

Delete a group, so that mail to its address is refused from now on.

SES refuses mail to the group's address at once, and the address can be given to a mailbox or another group at once. The copies its members got stay theirs. Only admins can delete groups. Deleting one is a change to the organization's setup, recorded in its change feed under you.

- `--group` (required): The group's address. Case doesn't matter.

## duva groups change

Change a group's members, who may send to it, or where external members' replies go.

Give only what to change. Members you give replace the group's members. A change works for mail that arrives from then on. Only admins can change groups, and each change is recorded in the organization's change feed under you.

- `--group` (required): The group's address. Case doesn't matter.
- `--members` (once for each): The members' addresses, in lower case: the organization's addresses, of mailboxes or other groups, and external addresses. A member on the organization's domains must be one of its addresses, without a plus tag.
- `--sendPolicy`: Who may send to the group, by the From of their mail. Anyone, the default, lets everyone. Organization lets only senders on the organization's domains. Members lets only the group's members, its nested groups' included, from any address of a member's mailbox. A From on the organization's domains counts only if the mail passed DMARC, and any other only if it didn't fail it. Mail from anyone else is bounced.
- `--replyTo`: Where external members' replies to the copies re-sent to them go. Sender, the default, sends them to the original sender, and group to the group.

## duva domains list

List the organization's domains, each with its DNS records and SES's verification.

Each record's status is looked up when you ask: missing until DNS answers with its value, found once it does, and verified once SES has verified what the record is for, unless DNS answers with another value. Only admins can list the organization's domains.

## duva domains add

Add a domain to the organization, standalone or an alias of one of its standalone domains.

Duva creates the domain's SES identity, with DKIM and its MAIL FROM domain, mail.<domain>, and answers with the DNS records to add at the domain's DNS provider. Duva doesn't change anyone's DNS. SES verifies the domain once its records are live, and the domain shows each record's status and SES's verification as they come. A standalone domain's addresses are its own. An alias domain mirrors every address of the standalone domain given as aliasOf, those added later too: mail to name@alias reaches the mailbox of name@standalone, and replies to it go out from name@alias. Only admins can add domains, and a domain the organization has, or one with an SES identity Duva didn't create, is refused. Adding a domain is a change to the organization's setup, recorded in its change feed under you.

- `--domain` (required): The domain. International domains can be given as they are written.
- `--aliasOf`: The standalone domain it mirrors, to make it an alias domain. Without it the domain is a standalone domain.

## duva domains get

Show one of the organization's domains, with its DNS records and SES's verification.

Each record's status is looked up when you ask, so call it again to see SES verify the domain once its records are live. Only admins can read the organization's domains.

- `--domain` (required): The domain. Case doesn't matter.

## duva domains change

Send sign-in codes from one of the organization's domains.

Sign-in codes come from no-reply@<domain>. The domain must be one SES has verified. Choosing it changes Cognito's sender at once, and duva deploy keeps it. The domain sign-in codes come from can't be removed, so choose another one before removing it. Only admins can choose, and the choice is a change to the organization's setup, recorded in its change feed under you.

- `--domain` (required): The domain. Case doesn't matter.
- `--signIn` or `--no-signIn` (required): Sends sign-in codes from the domain from now on. To stop, choose another domain.

## duva domains remove

Remove a domain with its addresses, and its alias domains if it is a standalone domain.

Run it first with dryRun to see the domains it removes, the addresses that stop receiving mail and the mailboxes left without an address. Removing a standalone domain removes its addresses, deleting the groups among them, and its alias domains with the addresses they mirror, since an alias domain mirrors nothing without it. The addresses that stop working leave every group they are members of. Removing an alias domain removes only what it mirrors. SES refuses mail to those addresses at once, and the domains' SES identities are deleted. The mail the mailboxes have stays. A mailbox left with no address keeps its mail, but receives and sends no new mail until it is given one. The domain sign-in codes come from can't be removed, so choose another one first. Only admins can remove domains. Each removal, and each address removed, is a change to the organization's setup, recorded in its change feed under you.

- `--domain` (required): The domain. Case doesn't matter.
- `--dryRun` or `--no-dryRun`: Lists what the removal takes and removes nothing.

## duva domains set-catch-all

Set a standalone domain's catch-all, a mailbox or a group, for mail to addresses the organization doesn't have.

Give the mailbox's ID or the group's address. Mail to an address on the domain, or on its alias domains, that isn't one of the organization's, removed ones included, goes to the catch-all instead of being refused. A mailbox's Screener applies to it, and a group delivers it to its members, skipping their Screeners, as group mail does. Deleting the mailbox or the group clears the catch-all. Only admins can set it, and each change is a change to the organization's setup, recorded in its change feed under you.

- `--domain` (required): The domain. Case doesn't matter.
- `--mailbox`: The ID of the mailbox that gets the mail, its Screener applying.
- `--group`: The address of the group whose members get the mail, skipping their Screeners.

## duva domains clear-catch-all

Clear a domain's catch-all, so that mail to addresses the organization doesn't have is refused again.

SES refuses such mail on the domain and its alias domains at once. Mail the catch-all already got stays. Only admins can clear it, and clearing it is a change to the organization's setup, recorded in its change feed under you.

- `--domain` (required): The domain. Case doesn't matter.

## duva mailboxes list

List the mailboxes you can read, your own and those of the agents you sponsor.

An agent your sponsor gives read or full sponsor access also finds your sponsor's personal mailbox here, listed with that access.

## duva mailboxes create

Create a personal mailbox for a human or an agent, with an address on one of the organization's standalone domains.

Only admins can create mailboxes. The address becomes the mailbox's default address, and mail to it is accepted from then on. An admin can't read a personal mailbox they don't own, even one they created, unless they sponsor the agent that owns it. Creating the mailbox and its address are changes to the organization's setup, recorded in its change feed.

- `--owner` (required): The ID of the human or agent that owns the mailbox.
- `--address` (required): The mailbox's first address, its default address, on one of the organization's standalone domains, without a plus tag.

## duva mailboxes get

Read a mailbox you can read, with how many threads in its Inbox are unread.

Only the mailbox's owner, for an agent's mailbox its sponsor, and for a human's mailbox the agents they give sponsor access can read it.

- `--mailbox` (required): The mailbox's ID.

## duva mailboxes change

Choose a mailbox's default address among its addresses.

New mail goes from the default address. Replies still go from the address the original was sent to. Only admins can choose it, and the choice is a change to the organization's setup, recorded in its change feed under you.

- `--mailbox` (required): The mailbox's ID.
- `--defaultAddress` (required): The mailbox's new default address, one of its addresses.

## duva mailboxes changes

List the changes in a mailbox after a position in its change feed.

Lists up to 100 changes, oldest first, leaving out the arrivals of mail judged to be spam unless asked for them. To catch up, call again with the position the answer ends at until it lists no more. Only the mailbox's owner, for an agent's mailbox its sponsor, and for a human's mailbox the agents they give sponsor access can read it.

- `--mailbox` (required): The mailbox's ID.
- `--after`: The position to list changes after. 0, the default, lists from the start.
- `--spam` or `--no-spam`: Lists the arrivals of mail judged to be spam too.

## duva threads list

List the threads in a mailbox with a label, newest first.

Lists the threads a page at a time, newest first by their newest message. To read the next page, call again with the answer's next as after, until an answer has no next.

- `--mailbox` (required): The mailbox's ID.
- `--label`: The label the threads carry. inbox, the default, lists the Inbox.
- `--limit`: How many threads a page lists at most.
- `--after`: Where the page starts, the next of the page before it. Leave it out for the first page.

## duva threads sent

List the threads a mailbox has sent mail in, newest first.

Lists every thread with a message sent from the mailbox, except those in Spam and Trash, a page at a time, newest first by its newest message. To read the next page, call again with the answer's next as after, until an answer has no next.

- `--mailbox` (required): The mailbox's ID.
- `--limit`: How many threads a page lists at most.
- `--after`: Where the page starts, the next of the page before it. Leave it out for the first page.

## duva threads mark-read

Mark threads in a mailbox read.

Marks each thread read. Read state belongs to the mailbox, so it is the same for each actor who reads it. Each thread that was unread gets a change in the mailbox's change feed, naming you. Only the mailbox's owner, for an agent's mailbox its sponsor, and for a human's mailbox the agents they give full sponsor access can mark its threads.

- `--mailbox` (required): The mailbox's ID.
- `--threads` (required) (once for each): The IDs of the threads.

## duva threads mark-unread

Mark threads in a mailbox unread.

Marks each thread unread, so it stands out until it is read again. Each thread that was read gets a change in the mailbox's change feed, naming you. Only the mailbox's owner, for an agent's mailbox its sponsor, and for a human's mailbox the agents they give full sponsor access can mark its threads.

- `--mailbox` (required): The mailbox's ID.
- `--threads` (required) (once for each): The IDs of the threads.

## duva threads label

Add labels to threads in a mailbox, and remove them.

Adds and removes the labels on each thread. Archiving removes inbox, and adding inbox moves a thread back to the Inbox, out of Spam, Trash and the Screener. Adding spam or trash takes a thread out of the Inbox. Removing spam (not spam) or trash (restore) puts it back in the Inbox, unless it still has the other, waits in the Screener, or inbox is removed too. Each thread whose labels change gets a change in the mailbox's change feed, naming you. Only the mailbox's owner, for an agent's mailbox its sponsor, and for a human's mailbox the agents they give full sponsor access can label its threads.

- `--mailbox` (required): The mailbox's ID.
- `--threads` (required) (once for each): The IDs of the threads.
- `--add` (once for each): The IDs of the labels to add, such as inbox, spam, trash or one of the mailbox's own.
- `--remove` (once for each): The IDs of the labels to remove.

## duva threads get

Read a thread, with each of its messages, oldest first.

- `--mailbox` (required): The mailbox's ID.
- `--thread` (required): The thread's ID.

## duva threads all-mail

List every thread in a mailbox except those in Spam and Trash, newest first.

Lists archived threads too, a page at a time, newest first by their newest message. To read the next page, call again with the answer's next as after, until an answer has no next.

- `--mailbox` (required): The mailbox's ID.
- `--limit`: How many threads a page lists at most.
- `--after`: Where the page starts, the next of the page before it. Leave it out for the first page.

## duva search

Search a mailbox's threads by words, meaning and filters.

Finds the threads whose messages have every word in q, or mean what its words say, best first. Each comes with the message that matched best and a snippet of its text where the words stand. A "quoted phrase" or subject: matches by its words alone, and every filter holds. Subjects, senders and recipients by name and address, message text and attachment names are searched, Sent included. A word also finds its other forms in English and Swedish, as invoice finds invoices and faktura finds fakturan. Threads in Spam and Trash, and those waiting in the Screener, are left out unless q has label:spam or label:trash. New mail is found within a minute, and label and read changes count at once. Only those who can read the mailbox can search it. To read the next page, call again with the answer's next as after.

- `--mailbox` (required): The mailbox's ID.
- `--q` (required): What to search for: words, "quoted phrases", and the filters from: and to: (part of a name or address), subject: (a word or quoted phrase in the subject), label: (a label's name, quoted if it has spaces), has:attachment, is:unread, after: (received on or after the day) and before: (received before the day), with days as YYYY-MM-DD in UTC. Every phrase and filter must hold.

- `--sort`: Best first, or newest first. Without words or phrases, both are newest first.
- `--limit`: How many threads a page lists at most.
- `--after`: Where the page starts, the next of the page before it. Leave it out for the first page.

## duva labels list

List a mailbox's labels, with how many unread threads each has.

Lists the built-in labels inbox, spam and trash first, then the mailbox's own labels by name. Only those who can read the mailbox can list its labels.

- `--mailbox` (required): The mailbox's ID.

## duva labels create

Create a label in a mailbox.

Creates a label of the mailbox's own, with a name no other label in it has, in any case. Then add it to threads by its ID. Only the mailbox's owner, for an agent's mailbox its sponsor, and for a human's mailbox the agents they give full sponsor access can create its labels. The change is recorded in the mailbox's change feed, naming you.

- `--mailbox` (required): The mailbox's ID.
- `--name` (required): The label's name.

## duva labels delete

Delete one of a mailbox's own labels.

Removes the label from each of its threads, each with a change in the mailbox's change feed, and then deletes it. The threads stay. The built-in labels can't be deleted. If deleting stops partway, delete the label again to finish. Only the mailbox's owner, for an agent's mailbox its sponsor, and for a human's mailbox the agents they give full sponsor access can delete its labels.

- `--mailbox` (required): The mailbox's ID.
- `--label` (required): The label's ID.

## duva labels rename

Rename one of a mailbox's own labels.

Gives the label a name no other label in the mailbox has, in any case. Its threads keep it. The built-in labels can't be renamed. Only the mailbox's owner, for an agent's mailbox its sponsor, and for a human's mailbox the agents they give full sponsor access can rename its labels. The change is recorded in the mailbox's change feed, naming you.

- `--mailbox` (required): The mailbox's ID.
- `--label` (required): The label's ID.
- `--name` (required): The label's name.

## duva threads empty-trash

Empty a mailbox's Trash, erasing every thread in it for good.

Erases each thread that is in Trash when you call, with its messages and their raw copies, every stored version included. Erasing can't be undone. Each erased thread gets a threadErased change in the mailbox's change feed, naming you, with none of its content. Duva erases the threads right after answering, and finishes on its next daily run if that fails. Only the mailbox's owner can empty its Trash, and an agent's sponsor its agent's. An agent never empties its sponsor's Trash, whatever its sponsor access. Without emptying, Trash and Spam are erased after the organization's retention period, counted from when a thread got the label.

- `--mailbox` (required): The mailbox's ID.

## duva screener get

Read a mailbox's Screener, with the first-time senders whose mail waits there.

Lists each sender whose mail waits, newest first, with their waiting threads, newest first. Mail waiting in the Screener is in no other listing and no unread count. Says whether the Screener is on, and how many senders the mailbox has let in and blocked. Only those who can read the mailbox can read its Screener.

- `--mailbox` (required): The mailbox's ID.

## duva screener switch

Switch a mailbox's Screener on or off.

Turning it off moves every waiting thread to the Inbox. Turning it on lets in every address mail in the mailbox is from, except mail in Spam, so no sender the mailbox already has waits. A human's mailbox starts with it on, an agent's with it off. Switching is recorded in the mailbox's change feed under you. Only the mailbox's owner, and an agent's sponsor for its agent's mailbox, can switch it.

- `--mailbox` (required): The mailbox's ID.
- `--on` or `--no-on` (required): True to switch the Screener on, false to switch it off.

## duva screener let-in

Let a sender into a mailbox, moving their waiting threads to the Inbox.

Give an address, or a domain to let in everyone there. A domain covers exactly that domain, not its subdomains, and can't be a public mail provider's, like gmail.com. An address's decision beats its domain's. Their later mail skips the Screener, even while it is off. Letting in a sender the mailbox blocked replaces the block and moves their threads still in Trash to the Inbox. The decision and each thread it moves are recorded in the mailbox's change feed under you. Only the mailbox's owner, for an agent's mailbox its sponsor, and for a human's mailbox the agents they give full sponsor access can decide.

- `--mailbox` (required): The mailbox's ID.
- `--address`: The sender's email address. Case doesn't matter.
- `--domain`: The domain, for everyone at exactly that domain, not its subdomains. Case doesn't matter. Public mail providers' domains, like gmail.com, are refused.


## duva screener block

Block a sender in a mailbox, moving their waiting threads to Trash.

Give an address, or a domain to block everyone there. A domain covers exactly that domain, not its subdomains, and can't be a public mail provider's, like gmail.com. An address's decision beats its domain's. Their later mail that starts a thread goes straight to Trash, even while the Screener is off. Trash is erased after the organization's retention period, counted from when a thread got it. Blocking a sender the mailbox let in replaces that. Blocking also unsubscribes the mailbox from the sender's mail by one-click (RFC 8058), when their newest mail that SES didn't judge to be spam offers it and a DKIM signature that passed covers its unsubscribe headers. For a domain, that is the newest mail from an address there that the mailbox hasn't let in. Duva never unsubscribes by mailto or by a link in the body. The decision, each thread it moves and the unsubscribe's outcome are recorded in the mailbox's change feed under you. Only the mailbox's owner, for an agent's mailbox its sponsor, and for a human's mailbox the agents they give full sponsor access can decide.

- `--mailbox` (required): The mailbox's ID.
- `--address`: The sender's email address. Case doesn't matter.
- `--domain`: The domain, for everyone at exactly that domain, not its subdomains. Case doesn't matter. Public mail providers' domains, like gmail.com, are refused.


## duva screener senders

List the senders a mailbox has let in or blocked.

Each address and domain, with its decision, when it was made and by whom, newest first. Only those who can read the mailbox can list them.

- `--mailbox` (required): The mailbox's ID.

## duva screener remove

Remove a mailbox's decision on a sender, so they are first-time again.

Their later mail waits in the Screener again, unless the mailbox has written to them, or a decision on their domain covers them. Removing a block moves their threads still in Trash to the Inbox. To flip a decision instead, let them in or block them. The removal and each thread it moves are recorded in the mailbox's change feed under you. Only the mailbox's owner, for an agent's mailbox its sponsor, and for a human's mailbox the agents they give full sponsor access can remove decisions.

- `--mailbox` (required): The mailbox's ID.
- `--sender` (required): The address or the domain, as the mailbox decided on it. Case doesn't matter.

## duva attachments link

Get a short-lived link that downloads one of a message's attachments.

Duva takes the attachment from the stored message when the link is followed, so nothing is stored twice. The link works for 5 minutes, for whoever follows it, so keep it to yourself. Only those who can read the mailbox get one: its owner, for an agent's mailbox its sponsor, and for a human's mailbox the agents they give sponsor access.

- `--mailbox` (required): The mailbox's ID.
- `--message` (required): The message's ID.
- `--attachment` (required): The attachment's place among the message's attachments, from 0.

## duva drafts list

List the drafts in a mailbox, newest first, with where each send stands.

Only those who can read the mailbox can list them.

- `--mailbox` (required): The mailbox's ID.

## duva drafts create

Draft a reply to a message in a mailbox, a reply to all, a forward, or a new message.

A reply goes from the address the original was sent to, plus tag kept, or from the default address if the mailbox no longer has it, to the original's Reply-To or, without one, its From, with the subject carrying a single "Re: " prefix. A reply to your own message goes to its recipients instead. A reply to all also goes to every other recipient of the original, except the mailbox's own addresses. A forward goes from the address the original was sent to, to whoever you give, with the subject carrying a single "Fwd: " prefix, the original's text quoted and its attachments, from the same address a reply would. A new message goes from the mailbox's default address. Give from to choose another of the mailbox's addresses, or a group the mailbox's owner is a local member of, to send as the group. Only its members can, so any other group gets 403. A reply to group mail goes from the member's own address unless you give the group. A mailbox with no address can't draft. A draft can be saved before it has recipients, a subject or text, but it needs a recipient in To to be sent. Only the mailbox's owner can draft in it, and for a human's mailbox the agents they give full sponsor access, whose drafts go from the same addresses as the human's own. Writing a draft is recorded in the mailbox's change feed, naming you.

- `--mailbox` (required): The mailbox's ID.
- `--answers`: The ID of the message the draft replies to. Without it or forwards, the draft is a new message.
- `--forwards`: The ID of the message the draft forwards, with its text and attachments. Give answers or forwards, not both.
- `--from`: The address to send from: one of the mailbox's addresses, or a group its owner is a local member of, to send as the group. A reply or a forward goes from the address the original was sent to unless you give one, and a new message from the default address.
- `--replyAll` or `--no-replyAll`: With answers, replies to all, so every other recipient of the original gets it too, except the mailbox's own addresses.
- `--to` (once for each): The recipients' addresses. A reply goes to the original's Reply-To or From unless you give them.
- `--cc` (once for each): The Cc recipients' addresses. A reply to all copies the original's Cc recipients unless you give them.
- `--bcc` (once for each): The Bcc recipients' addresses, which get the message but appear in no header.
- `--subject`: The subject. A reply's is the original's with "Re: " unless you give one.
- `--text`: The plain-text body.

## duva drafts get

Read a draft, with where its send stands.

Only those who can read the mailbox can read it.

- `--mailbox` (required): The mailbox's ID.
- `--draft` (required): The draft's ID.

## duva drafts delete

Delete a draft.

Deleting a draft that waits for approval withdraws the request. A draft being sent can't be deleted until its send is done. Deleting a sent draft leaves the sent message in its thread. Only the mailbox's owner can delete its drafts, and for a human's mailbox the agents they give full sponsor access, whoever wrote the draft. The deletion, and any withdrawal, is recorded in the mailbox's change feed, naming you.

- `--mailbox` (required): The mailbox's ID.
- `--draft` (required): The draft's ID.

## duva drafts edit

Change a draft's From, recipients, subject or text.

Changing a draft that waits for approval withdraws the request, so an approver never approves text they didn't see. Ask to send it again once it is ready. From can be one of the mailbox's addresses, or a group the mailbox's owner is a local member of, and any other group gets 403. Only the mailbox's owner can edit its drafts, and for a human's mailbox the agents they give full sponsor access, whoever wrote the draft. The change, and any withdrawal, is recorded in the mailbox's change feed, naming you.

- `--mailbox` (required): The mailbox's ID.
- `--draft` (required): The draft's ID.
- `--from`: The address to send from, in place of the draft's: one of the mailbox's addresses, or a group its owner is a local member of.
- `--to` (once for each): The recipients' addresses, in place of the draft's.
- `--cc` (once for each): The Cc recipients' addresses, in place of the draft's.
- `--bcc` (once for each): The Bcc recipients' addresses, in place of the draft's.
- `--subject`: The subject, in place of the draft's.
- `--text`: The plain-text body.

## duva drafts send

Ask for a draft to be sent.

A human's send from their own mailbox needs no approval, so Duva sends it at once, with no disclosure, also when their agent wrote the draft. An agent's send waits for its sponsor's approval unless the sponsor switched that off, separately for its own mailbox and for its sponsor's. With full sponsor access, an agent sends as its sponsor from the sponsor's mailbox: from the draft's address, under the sponsor's name. Every message an agent sends carries the Duva-Agent header, and a visible line unless its sponsor switched that off for where it sends from. Its send shows where it stands. Bcc recipients get the message, but no header names them. Only the mailbox's owner, and an agent with full sponsor access to it, can ask. The draft needs a recipient in To, and a draft waits for one approval at a time. It goes only from an address the mailbox still has, so a draft from an address since removed fails. A draft from a group goes out from the group's address, as any send does, and only while the mailbox's owner is still a local member: otherwise asking gets 403, and a send asked before fails. Each other local member's mailbox then gets a copy, in the thread of the message it answers, marked with who sent it as the group. External members get none. A send that needs no approval withdraws the request the draft waits for, if it waits. Asking is recorded in the mailbox's change feed. An agent's approved send over its send limits waits, as waitingForLimit, and goes out by itself, oldest first, as the limits allow, or when its sponsor sends it now. Humans have no send limits.

- `--mailbox` (required): The mailbox's ID.
- `--draft` (required): The draft's ID.

## duva drafts send-now

Send a draft waiting for an agent's send limits now, past the limits.

Only the agent's sponsor can, for one draft at a time, and the agent's limits stay as they are. The send still counts toward them. A paused agent's send is held until it is unpaused. Sending now is recorded in the mailbox's change feed under you, and the draft's send shows sending, then sent or failed. A draft that isn't waitingForLimit is 409.

- `--mailbox` (required): The mailbox's ID.
- `--draft` (required): The draft's ID.

## duva alerts list

List your agents' alerts, newest first, with how many you haven't seen.

An alert tells a sponsor that one of their agents needs them: a send that failed, bounced or drew a complaint, its send limit reached, its key used while paused, a pause, limit change or removal by an admin, or a pause by Duva. A human lists the alerts about the agents they sponsor, and an agent those about itself, as its sponsor sees them. Urgent alerts are also mailed to the sponsor's own mailbox, if they have one. Removing an agent keeps its alerts. To read the next page, call again with the answer's next as after, until an answer has no next.

- `--agent`: List only the alerts about this agent.
- `--limit`: How many alerts a page lists at most.
- `--after`: Where the page starts, the next of the page before it. Leave it out for the first page.

## duva alerts mark-seen

Mark alerts seen, so they no longer count as unseen.

Only the sponsor marks their alerts seen. IDs of alerts that aren't yours, or no longer exist, are left alone.

- `--alerts` (required) (once for each): The IDs of the alerts.

## duva approvals list

List the approvals waiting for you, newest first, sends with their drafts and setup changes with their previews.

An agent's sends wait for its sponsor, from its own mailbox and as its sponsor from theirs, so a sponsor sees those of every agent they sponsor. Each approval's mailbox tells which. The setup changes of agents they made admins wait for them too, each with a preview of what it does.

## duva approvals send

Send a draft waiting for your approval, as is or with your changes.

Give recipients, a subject or text to send your version instead of the agent's. Duva then sends it through SES from the draft's address, as a reply in the thread if it is one. Every message an agent sends carries the Duva-Agent header, naming the agent and the human it acts for, also when you changed it, and a line that says so after the text unless you switched that off for the agent. The draft's send shows sending, then sent or failed with the reason. Only the approver can decide an approval, never an agent, and only once: of two decisions at the same time, one is refused. The decision, with any edits, is recorded in the mailbox's change feed under you, and the send under the agent. While the agent is paused, its approvals wait and can't be sent, which is 409.

- `--approval` (required): The approval's ID.
- `--to` (once for each): The recipients' addresses, in place of the draft's.
- `--subject`: The subject, in place of the draft's.
- `--text`: The plain-text body, in place of the draft's.

## duva approvals reject

Reject a draft waiting for your approval, with a note the agent sees.

The draft goes back to the agent with the note, and the agent can revise it and ask again. Only the approver can decide an approval, never an agent, and only once: of two decisions at the same time, one is refused. The decision is recorded in the mailbox's change feed.

- `--approval` (required): The approval's ID.
- `--note` (required): What the agent should change.

## duva setup-approvals get

Read a setup change an agent admin asked for, and what became of it.

Only the agent that asked and its sponsor, who decides, can read it.

- `--approval` (required): The approval's ID.

## duva setup-approvals approve

Approve a setup change your agent admin asked for, which makes it as the agent.

Duva works out the change's effect again first. If it would now do something other than its preview says, the approval waits with the new preview, and approving is refused with 409, so read it and approve again. A change that can't be made now, as when its address was taken meanwhile, is refused with 409 and keeps waiting, for you to reject. Only the agent's sponsor decides, never an agent, and only once. While the agent is paused, it can't be approved. The decision is recorded in the organization's change feed under you, and the change under the agent.

- `--approval` (required): The approval's ID.

## duva setup-approvals reject

Reject a setup change your agent admin asked for, with a note the agent sees.

Nothing changes. Only the agent's sponsor decides, never an agent, and only once. The decision is recorded in the organization's change feed under you.

- `--approval` (required): The approval's ID.
- `--note` (required): What the agent should change.
