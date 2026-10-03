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

Lists up to 100 changes, oldest first. To catch up, call again with the position the answer ends at until it lists no more. Only the mailbox's owner and, for an agent's mailbox, its sponsor can read it.

- `--mailbox` (required): The mailbox's ID.
- `--after`: The position to list changes after. 0, the default, lists from the start.

## duva threads list

List the threads in a mailbox with a label, newest first.

Lists the 100 newest threads with the label.

- `--mailbox` (required): The mailbox's ID.
- `--label`: The label the threads carry. inbox, the default, lists the Inbox.

## duva threads get

Read a thread, with each of its messages, oldest first.

- `--mailbox` (required): The mailbox's ID.
- `--thread` (required): The thread's ID.
