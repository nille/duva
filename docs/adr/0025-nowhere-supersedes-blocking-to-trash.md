# Nowhere supersedes blocking to Trash

Blocking a sender in the Screener used to move their mail to Trash, where it waited out the retention period. Duva now has deliveries instead, HEY's model: a mailbox decides per sender whether their mail goes to the Inbox, the Feed, the Paper Trail, a label, or nowhere. The Screener's let in became the Inbox and its block became nowhere. Nowhere drops the sender's mail on arrival and keeps none of it: not the message in a thread, not the raw copy in the mail bucket once no other mailbox has it, only a messageDropped change naming the sender's address. Choosing nowhere erases the sender's threads already in the mailbox for good, Spam and Trash included, and removing it later brings back nothing. Nicklas chose this on 2026-10-07 (#113).

Unsubscribing keeps ADR-0016's rules: only by RFC 8058 one-click, never from spam. ADR-0031 superseded that on 2026-10-08: where one-click doesn't unsubscribe, the mailbox agent goes on. Duva tries it when an actor chooses nowhere, under that actor, and again for each message it drops later, naming no actor, since arriving mail names none.

## Considered options

- Keeping blocked mail in Trash, as before. Rejected: a sender someone wants gone keeps filling a list they have to look past, and their mail is still kept for the retention period.
- Dropping later mail but leaving the threads already there. Rejected: the delivery applies to a sender's existing mail as well as their later mail, so their threads go too.

## Consequences

- Nowhere erases mail, so only those who may empty Trash choose it: the mailbox's owner. An agent with organize sponsor access or more chooses every other delivery. The web app asks before saving, and says it can't be undone.
- Nowhere drops spam from the sender as well, and drops their replies in threads the mailbox has. Group mail skips deliveries, as it skips the Screener (ADR-0019), so a sender sent nowhere still reaches a member through a group.
- The inbound Lambda now invokes the unsubscriber, through IAM, for each message it drops, and erases the raw copy when no mailbox it was for stored it.
- A block from before deliveries became nowhere when setup ran, and the threads it had put in Trash stayed there, to be erased with the rest of Trash.
