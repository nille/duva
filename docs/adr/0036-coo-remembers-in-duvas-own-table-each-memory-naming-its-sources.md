# Coo remembers in Duva's own table, each memory naming its sources

Coo keeps memories of its human between conversations: what the human tells it, and what it learns from mail it reads during its own runs (Ask Coo, label tasks, unsubscribing). It never learns from mail in the Screener or Spam, and it makes no extra model call on mail that merely arrives. Coo writes each memory itself, naming its sources: the human's own words, or the threads it learned it from. The memories sit in Duva's own table under the human, so they stay in the deployment's region and cost nothing while idle (ADR-0006). Nicklas chose this on 2026-10-10, and chose learning from mail on by default.

Erasure holds as Duva promises it, because a memory goes with its sources:
- Erasing a thread erases every memory learned from it, in the same transaction. That covers Spam and Trash after the retention period, Empty Trash, Nowhere, and removing a human.
- Handing a mailbox to another human erases what the old owner's Coo learned from its threads. What the human told Coo stays.

Memories are the human's, so Coo uses them in any of their mailboxes. The human sees them in Coo's settings, each with when and where it came from, and can correct or forget any, forget everything, or stop Coo learning from mail. Telling Coo to forget something works too. The first time Coo keeps a memory from mail, its bubble says so once, linking to the list.

## Considered options

- **AgentCore Memory's long-term memory with its built-in extraction.** Rejected: an extracted record doesn't say which events it came from, so erasing mail couldn't erase what was learned from it. There's also no deletion by human, extraction runs in other EU regions, records cost every hour they're kept, and Strands for TypeScript has no integration. ADR-0027's "no AgentCore Memory" stands, now for this reason.
- **AgentCore Memory's self-managed records, written by Coo with their sources.** Rejected: Duva would own the extraction and the deletes anyway, deletes go one record at a time with no documented timing, and the records would cost while idle.
- **Rebuilding memories from mail each night.** Rejected: erased mail would linger in memory for up to a day, and every human's mail would be read nightly at the organization's cost.
- **Learning from every arriving message.** Rejected: a model call per message, paid for idle mailboxes too.

## Consequences

- Strands' `MemoryStore` gets an implementation over Duva's table. Coo finds memories by meaning, embedded with Titan as mail search is.
- A memory keeps its source threads' IDs, and erasure looks them up there, as it looks up a thread's messages.
- The API, the CLI and Settings get the memory list, correct, forget and the learning switch, in the human's partition, so they go with the human.
