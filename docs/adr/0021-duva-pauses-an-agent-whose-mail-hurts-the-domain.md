# Duva pauses an agent whose mail hurts the domain

An agent sends on the organization's domains through the organization's SES account. Complaints and bounces count against that account's reputation, and SES can pause sending for the whole account when they climb, which would stop every human's mail too. One misbehaving agent can do that in minutes, faster than a sponsor reads an alert. So Duva pauses an agent by itself after a complaint about its mail, or after 5 hard bounces within an hour, and sends its sponsor an urgent alert saying why. Only a human, its sponsor or an admin, unpauses it. Nicklas chose this on 2026-10-06.

## Considered options

- Alerting only, and leaving the pause to the sponsor. Rejected: the damage is done before a human reads the alert.
- Thresholds as an organization setting. Rejected for v1: fixed thresholds are easier to explain, and these are conservative. They can become a setting later without changing this decision.

## Consequences

- Duva needs SES's bounce and complaint notifications for its sends. A notification topic feeds a Lambda that SNS invokes with a source condition, never publicly.
- A pause holds the agent's approved sends rather than dropping them. Unpausing sends them, so the sponsor should look first. The alert says so.
- Humans aren't paused automatically. Their mail counts against the same reputation, and that is the admins' to watch.
- The thresholds are counted per agent, across all the mailboxes it sends from.
