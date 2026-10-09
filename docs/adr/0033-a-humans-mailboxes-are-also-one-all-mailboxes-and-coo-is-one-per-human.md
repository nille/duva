# A human's mailboxes are also one, All mailboxes, and Coo is one per human

A human may own several personal mailboxes, which admins create, each with one or more addresses. Besides each mailbox alone, the API and every client also offer All mailboxes: every mailbox the actor can read, taken together. Each list, count and search works on it as on one mailbox, so the web app does nothing the API can't (ADR-0009), and an agent's All mailboxes is the mailboxes its sponsor access covers. A human with several mailboxes opens the web app on All mailboxes unless their preference names one. Nicklas chose this on 2026-10-09.

In All mailboxes:
- Each thread says which address it came to: the recipient Duva recorded from the envelope, which holds for Cc, Bcc, mailing lists, groups and catch-alls.
- A message delivered to two of the human's mailboxes is two threads, as it is two copies, and acting on one touches only that one. Reading one leaves the other unread, and a reply from one mailbox shows in its thread only, so it stays plain which mailbox has answered.
- Labels with the same name in several mailboxes are one label.
- Deciding on a sender, labeling and replying still belong to the mailbox the thread is in, so work and home can decide on a sender differently.
- New mail starts from the address the human's preference names, and can go from any of their addresses. The draft lives in that address's mailbox.

Coo, the mailbox agent, becomes one per human, working in all their personal mailboxes, where ADR-0027 gave each mailbox its own. A question asked from one mailbox is about that one unless the human says otherwise. One asked from All mailboxes is about all of them. A mailbox handed to another human is worked by that human's Coo.

## Considered options

- Merge only the Inbox and the Screener. Rejected: leaving the Inbox for the Feed would mean choosing a mailbox first, and one rule for every view is easier to learn.
- Merge in the web app, asking each mailbox and merging the pages. Rejected: paging across mailboxes in the browser is awkward, and the CLI, agents and MCP would never get it (PRODUCT.md's principle 5).
- Show a message delivered to two mailboxes once, naming both. Rejected by Nicklas: one row would mark both copies read, and hide which mailbox had answered.
- Keep a Coo per mailbox, with runs from All mailboxes reading across them and acting as each mailbox's own Coo. Rejected: several Coos per human would share one conversation, and a human thinks of one Coo.
- Let humans create their own mailboxes and addresses. Rejected: mailboxes and addresses stay the organization's setup, which admins change (ADR-0018).

## Consequences

- **Every mail operation that takes a mailbox also takes All mailboxes.** Answers name each thread's mailbox. A count of All mailboxes adds up its mailboxes' counts. A search of All mailboxes searches each mailbox's own index (ADR-0007) and merges them by rank. A page of All mailboxes merges its mailboxes' pages in their order.
- **Labels stay a mailbox's own.** Labeling a thread in All mailboxes uses its mailbox's label of that name, made there if missing, and label prompts stay with each mailbox's label.
- **The existing mailbox agents become one per human,** each keeping its history: the actions they took stay attributed to the agent they were. ADR-0027's runtime, run tokens and spend cap stand. Its "a mailbox agent for each human's mailbox" doesn't.
- **ADR-0028's MCP tools reach the human's one mailbox agent,** across their mailboxes.
- **Two new preferences:** where the web app opens, and which address new mail in All mailboxes starts from.
