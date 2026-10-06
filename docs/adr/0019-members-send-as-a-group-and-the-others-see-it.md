# Members send as a group, and the other members see it

Duva has no shared mailboxes (ADR-0015), so a group is how several people handle one address, such as support@. Each member has their own copy of group mail. A member replies from their own address by default. A local member can choose the group's address as From instead. When they do, a copy of what they sent goes to every other local member's mailbox, in the same thread, naming who sent it, so nobody answers twice. Group mail skips members' Screeners, since the group's rule on who may send to it is its gate. Nicklas chose this on 2026-10-06.

## Considered options

- Always replying as the group, like a team inbox. Rejected: members also answer group mail personally.
- Never sending as the group. Rejected: support@ mail would be answered from personal addresses.
- No copy to other members. Rejected: without a shared mailbox, nobody would know a message had been answered.

## Consequences

- Each member's read state, labels and archive are their own. Only the replies sent as the group are shared, as copies.
- External members get the group's incoming mail re-sent (ADR-0003). They can't send as the group, and get no copies of members' replies.
- An agent that is a member sends as the group like any send: with its sponsor's approval, and the disclosure.
