# An agent is removed with its sponsor

When an admin removes a human, the agents they sponsor are removed with them, and the agents' mailboxes erased. The human's own mailboxes are handed over to another human or deleted, as the admin chooses. The glossary said such agents are paused until someone takes them over. Nicklas chose otherwise on 2026-10-06: an agent works for its sponsor alone (ADR-0015), so without the sponsor it has no one to work for. Orphaned agents would also hold keys and mail that nobody answers for.

## Consequences

- The removal shows which agents and mailboxes go with the human, and asks for confirmation.
- An agent's erased mailboxes are erased as Empty Trash does, everywhere Duva keeps mail. Its approval records follow the organization's setting (ADR-0014).
- Someone who wants to keep an agent's work hands it over before the removal: a sponsor can forward or export it, and agent handover may come later.
