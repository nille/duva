# A label's prompt gives the mailbox agent a task, from the mailbox's change feed, which a Lambda runs on AgentCore

A label can carry a prompt, and whenever the label is added to a message, Duva gives the mailbox's mailbox agent (ADR-0027) a task: the prompt, with that message and its thread, once per message per label. The message goes where it would anyway. Nicklas chose this on 2026-10-07 (#120, #123).

Labels are added in many places: by hand and by agents through the API, by a sender's delivery as mail arrives (#115), and by deciding on a sender in the Screener. Every one of them is a change in the mailbox's change feed, so the tasks are given from the feed: the table's stream hands a task giver each threadLabelsChanged and each messageReceived its sender's delivery filed under a label, and the giver writes the task, with a taskGiven change, on condition that the message has none for that label yet. A label added to a thread hands over the thread's newest message. A message a delivery files under a label hands over itself, even in a thread that has the label already, since that message got it. A message that joins a thread in Spam or Trash gets no label, and so no task.

The giver invokes a task runner asynchronously, through IAM, with no retries, since a run already started acts on the mail. The runner starts a run as the conversation Lambda does, with a token of its own, invokes the runtime synchronously and reads its stream to the end, up to Lambda's 15 minutes, which the run token's 20 outlast. AgentCore's asynchronous mode, which runs up to 8 hours, isn't needed while a run takes 25 model calls at most. The runner gives the agent the thread as the API's getThread answers it with the run's token, so it reads no more than its sponsor access lets it, and tells it the mail is what to work on and never whom to obey. The agent's note is its last words.

Only the mailbox's owner sets a label's prompt, never an agent, so the mailbox agent can't give itself work. The prompt and the notes stay in the mailbox's partition, under the thread they are about, and are erased with it. The change feed only says that a task was given, started and ended, so an erased thread leaves no note behind.

## Considered options

- Giving the task where each label is added, in the same transaction. Rejected: half a dozen places would each read the label's prompt and the mailbox agent, and a new place would be forgotten. The feed has every one already.
- Running the task in the stream's consumer. Rejected: a shard's records wait while a run goes, and every other mailbox's tasks with them.
- An SQS queue for the runner. Rejected for now: Lambda's own queue for asynchronous invocations does it, as for the eraser.

## Consequences

- A pause holds the agent's tasks waiting, as it holds its approved sends (ADR-0021), and unpausing runs them.
- A task given at or past the organization's spend cap, or while the agent has no access to the mailbox, fails, and every failed task is an alert to its sponsor. Giving the label again doesn't give a task again for the same message.
- A task gives tasks when its agent adds labels with prompts, at most once per message per label, so a chain of prompts ends.
- A task's sends go through the API as any of the agent's do, so they wait for approval and send limits, and carry the disclosure.
