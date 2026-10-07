# Agents are actors, equal to humans

Humans and agents are both actors: an agent can own mailboxes and hold grants to other mailboxes, and every action is attributed to exactly one actor. The usual model treats agents as API clients acting as a human user. We rejected it because agent use is the point of the platform, and adding agent ownership to a human-only model later would touch identity, access and audit everywhere.

Superseded in part by ADR-0030 (2026-10-07): agents are still actors, but an agent owns no mailboxes and is never an admin. It works only in its sponsor's mailboxes, through sponsor access.
