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

## duva status

Show Duva's version and the deployment's region.

Answers without sign-in, so any client can check that it reaches the deployment.

## duva whoami

Show the signed-in actor.

## duva organization changes

List the changes to the organization's setup after a position in its change feed.

Lists up to 100 changes, oldest first. To catch up, call again with the position the answer ends at until it lists no more. Only admins can read the organization's change feed.

- `--after`: The position to list changes after. 0, the default, lists from the start.

## duva agents list

List the agents you sponsor.

## duva agents create

Create an agent, with you as its sponsor, and show its key once.

Only humans can create agents. The answer is the only time Duva shows the agent's key: it keeps only a hash. Creating an agent is a change to the organization's setup, recorded in its change feed.

- `--name` (required): The agent's name.

## duva agents rotate-key

Give an agent you sponsor a new key, show it once, and refuse the old one from now on.

Only the agent's sponsor can rotate its key. Rotating is a change to the organization's setup, recorded in its change feed.

- `--agent` (required): The agent's ID.

## duva mailboxes list

List the mailboxes you can read, your own and those of the agents you sponsor.

## duva mailboxes create

Create a personal mailbox for an agent, with an address on the organization's domain.

Only admins can create mailboxes. The address becomes the mailbox's default address, and mail to it is accepted from then on. Creating the mailbox and its address are changes to the organization's setup, recorded in its change feed.

- `--owner` (required): The ID of the agent that owns the mailbox.
- `--address` (required): The mailbox's address, on the organization's domain, without a plus tag.

## duva mailboxes changes

List the changes in a mailbox after a position in its change feed.

Lists up to 100 changes, oldest first, leaving out the arrivals of mail judged to be spam unless asked for them. To catch up, call again with the position the answer ends at until it lists no more. Only the mailbox's owner and, for an agent's mailbox, its sponsor can read it.

- `--mailbox` (required): The mailbox's ID.
- `--after`: The position to list changes after. 0, the default, lists from the start.
- `--spam`: Lists the arrivals of mail judged to be spam too.

## duva threads list

List the threads in a mailbox with a label, newest first.

Lists the 100 newest threads with the label.

- `--mailbox` (required): The mailbox's ID.
- `--label`: The label the threads carry. inbox, the default, lists the Inbox.

## duva threads get

Read a thread, with each of its messages, oldest first.

- `--mailbox` (required): The mailbox's ID.
- `--thread` (required): The thread's ID.

## duva drafts list

List the drafts in a mailbox, newest first, with where each send stands.

Only the mailbox's owner and, for an agent's mailbox, its sponsor can list them.

- `--mailbox` (required): The mailbox's ID.

## duva drafts create

Draft a reply to a message in a mailbox, or a new message.

A reply goes from the address the original was sent to, plus tag kept, to the original's Reply-To or, without one, its From, with the subject carrying a single "Re: " prefix. A new message goes from the mailbox's default address, and needs to and subject. Only the mailbox's owner can draft in it. Writing a draft is recorded in the mailbox's change feed.

- `--mailbox` (required): The mailbox's ID.
- `--answers`: The ID of the message the draft replies to. Without it, the draft is a new message.
- `--to` (once for each): The recipients' addresses. A reply goes to the original's Reply-To or From unless you give them.
- `--subject`: The subject. A reply's is the original's with "Re: " unless you give one.
- `--text` (required): The plain-text body.

## duva drafts get

Read a draft, with where its send stands.

Only the mailbox's owner and, for an agent's mailbox, its sponsor can read it.

- `--mailbox` (required): The mailbox's ID.
- `--draft` (required): The draft's ID.

## duva drafts edit

Change a draft's recipients, subject or text.

Changing a draft that waits for approval withdraws the request, so an approver never approves text they didn't see. Ask to send it again once it is ready. Only the mailbox's owner can edit its drafts. The change, and any withdrawal, is recorded in the mailbox's change feed.

- `--mailbox` (required): The mailbox's ID.
- `--draft` (required): The draft's ID.
- `--to` (once for each): The recipients' addresses, in place of the draft's.
- `--subject`: The subject, in place of the draft's.
- `--text`: The plain-text body.

## duva drafts send

Ask for a draft to be sent.

An agent's send from its own mailbox needs its sponsor's approval, so the draft waits for them. Its send shows where it stands. Only the mailbox's owner can ask, and a draft waits for one approval at a time. Asking is recorded in the mailbox's change feed.

- `--mailbox` (required): The mailbox's ID.
- `--draft` (required): The draft's ID.

## duva approvals list

List the approvals waiting for you, newest first, each with its draft and the message it answers.

An agent's sends from its own mailbox wait for its sponsor, so a sponsor sees those of every agent they sponsor.

## duva approvals send

Send a draft waiting for your approval, as is or with your changes.

Give recipients, a subject or text to send your version instead of the agent's. Duva then sends it through SES from the draft's address, as a reply in the thread if it is one. Every message an agent sends carries the Duva-Agent header, naming the agent and the human it acts for, and a line that says so after the text, also when you changed it. The draft's send shows sending, then sent or failed with SES's reason. Only the approver can decide an approval, never an agent, and only once: of two decisions at the same time, one is refused. The decision, with any edits, is recorded in the mailbox's change feed under you, and the send under the agent.

- `--approval` (required): The approval's ID.
- `--to` (once for each): The recipients' addresses, in place of the draft's.
- `--subject`: The subject, in place of the draft's.
- `--text`: The plain-text body, in place of the draft's.

## duva approvals reject

Reject a draft waiting for your approval, with a note the agent sees.

The draft goes back to the agent with the note, and the agent can revise it and ask again. Only the approver can decide an approval, never an agent, and only once: of two decisions at the same time, one is refused. The decision is recorded in the mailbox's change feed.

- `--approval` (required): The approval's ID.
- `--note` (required): What the agent should change.
