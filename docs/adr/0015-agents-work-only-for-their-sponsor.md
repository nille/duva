# Agents work only for their sponsor, and there are no grants or shared mailboxes

An agent works in its own mailboxes and, if its sponsor gives it sponsor access, in its sponsor's personal mailbox. Nowhere else. No actor reaches another human's mailbox: there are no grants, no shared mailboxes, and no agent working for several people. Mail that several people need goes to a group, which gives each member their own copy. Duva serves families and small companies, where delegating a mailbox to another human is rare, and grants brought most of the hard rules: grants to other people's agents, grantees who mustn't see each other, a per-actor change feed, picking grantees. A first design with grants (spec #39) was dropped for this on 2026-10-05, and Nicklas chose the trade-off.

Sponsor access is per agent and off by default. Read lets the agent read everything in the sponsor's mailbox, drafts and the change feed included. Full also lets it organize, move threads to Trash and back, draft, change any draft there, and send as the sponsor. Only the sponsor empties Trash. The sponsor separately switches approval and the disclosure's visible line for the agent's sends from its own mailbox and for its sends as the sponsor, all on by default.

Mail an agent sends as its sponsor goes out as the sponsor's: from the sponsor's mailbox and address, under the sponsor's name. It always carries the Duva-Agent header naming the agent and its sponsor. Disclosure follows the actor who asks to send: a draft an agent wrote that its sponsor sends is the sponsor's mail and carries no disclosure.

## Considered options

- Grants with five abilities, given by any owner to any actor (spec #39). Rejected for its rules, as above. It can still be added later without changing what this decides.
- Shared mailboxes with one copy and shared read state. Rejected for v1: groups cover small teams, though members don't see that someone else already answered.
- Sponsor access for every agent by default. Rejected: most agents don't need their sponsor's mail, and a leaked key would expose it.

## Consequences

- ADR-0001 still holds, agents are actors, but its "hold grants to other mailboxes" is gone.
- The access check has three fixed relations and no grant data: the owner, the sponsor in its agent's mailbox, and the agent in its sponsor's mailbox with read or full sponsor access.
- Approvals are always the agent's sponsor's, so the approver never has to be chosen.
- A human who leaves takes nobody's access with them, but a group member's copies stay with each member.
- Replying as a group is for the groups slice.
