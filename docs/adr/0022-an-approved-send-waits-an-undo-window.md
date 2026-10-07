# An approved send waits an undo window, and the approval log reads the approval records

A sponsor who approves an agent's send by mistake, or sees a typo a second later, has no way back once SES has the message. Mail that went out can't be called back. So an approved send waits an undo window before the sender takes it, and its approver can undo the approval meanwhile, which puts it back among the requests that wait for them, as the agent asked it. The window is an organization setting, which admins set from 0 to 120 seconds, 30 by default. Nicklas chose this on 2026-10-07 (spec #113).

## Considered options

- An undo window per sponsor, as a preference. Rejected for v1: one window for the organization is one thing to explain, and admins already set the agents' caps.
- Holding a human's own sends too, as Gmail does. Rejected: a human's own send goes at once, as it always has, and the window is for decisions on an agent's behalf.
- Undo after the window, while a send is still held for its agent's pause or send limits. Rejected: a held send stays approved, so a pause can't quietly turn into a way to reconsider.

## Consequences

- The sender takes an approved send only once its undo window is over, and asks EventBridge Scheduler to hand it over then, in the schedule group it already uses for send limits. Undoing and the sender's take are each conditional on the draft as read, so of the two one wins.
- An approval undone and approved again waits a new window. Its edits go with the undo, and the draft is as the agent asked it again.
- A rejected send can be sent after all while its draft is as the agent asked it. Once the agent changes it, deletes it or asks again, the new request is what waits.
- Each sponsor's approval log lists every decision on their agents' sends, newest first, with how it went. It reads the approval records ADR-0014 keeps, so it reaches as far back as they are kept: when erasure erases a thread's approval records, their decisions leave the log too. Decisions from before the log are listed once, by the setup after the deploy that brings it.
- Sent mail is final. The log offers a correction to its recipients from the sponsor's own mailbox instead.
