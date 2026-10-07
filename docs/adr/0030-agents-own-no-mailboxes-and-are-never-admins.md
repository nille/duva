# Agents own no mailboxes and are never admins

An agent works only in its sponsor's personal mailboxes, through the sponsor access its sponsor gives it (ADR-0015, ADR-0024). It owns no mailbox and has no address of its own, and it is never an admin. Duva hosts one agent itself, each human mailbox's mailbox agent (ADR-0027), and any other agent is self-hosted: it runs elsewhere and calls Duva through the CLI or the API with its own key, under its sponsor. Nicklas chose this on 2026-10-07 (#120, #126), and chose erasing the agents' mailboxes that existed over handing them over.

Agent-owned mailboxes brought a second way for an agent to send, from its own address under its own name, with switches of its own for approval and the disclosure's line, a sponsor who acted as owner of a mailbox they didn't own, and Screener rules for mailboxes no human reads. Agent admins brought setup approvals: each setup change an agent asked for waited for its sponsor, with a preview of what it would do, planned again from the setup as it was when approved. With every agent working for one human in that human's mail, both are more than the product needs, and every rule they brought had to hold everywhere else.

## Considered options

- Keep agent mailboxes for self-hosted agents. Rejected: an agent that needs mail of its own sends from its sponsor's mailbox with send sponsor access, its mail marked by the disclosure, and a group gives several people one address.
- Hand existing agent mailboxes over to their sponsors. Rejected by Nicklas, who chose erasing them, as removing an agent always erased its mailboxes (ADR-0020).
- Keep agent admins with setup approvals. Rejected: admins are few and human, and an agent that suggests a setup change can say so to its sponsor.

## Consequences

- ADR-0001 still holds, agents are actors, and every action names one, but an agent no longer owns mailboxes. ADR-0015's access check loses its relation of a sponsor in their agent's mailbox, and ADR-0015's and ADR-0024's switches for an agent's sends from its own mailbox are gone: an agent's send goes as its sponsor's, waiting for approval and carrying the line unless the sponsor switched them off.
- An agent removed with its sponsor (ADR-0020) has no mailboxes to erase.
- The setup after the deploy that brings this erases every mailbox an agent owned, as Empty Trash erases, search indexes included, frees its addresses, takes them out of the receipt rules and out of the groups they were members of, and withdraws the agent's sends that waited there. Each erasure is in the organization's change feed under Duva. The agents stay, with their sponsors.
- The organization's change feed keeps the agent-admin and setup-approval changes it recorded before, as they were. The activity leaves them out, and Duva records none.
- A human's Approvals lists only sends. The admin flag, approvalForSetup, approvalForOwnMailbox and disclosureLineForOwnMailbox are gone from the contract, and settings stored with them read without them.
