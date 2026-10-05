# Erasure keeps agents' approval records unless the organization chooses otherwise

Erasing a thread (#28) removes its messages, their raw copies and the drafts that sent in it. An agent's sends also left approval records, with the draft the sponsor saw and any edit they made, and `approvalDecided` entries in the mailbox's change feed carrying the edit. These are the record of what an agent was allowed to send on someone's behalf and who signed it off, which is what approval exists for (PRODUCT.md, principle 2). Erasing them whenever someone empties Trash would let the audit trail of an agent's sends disappear with the mail. Some organizations will still want erasure to mean everything. So it is an organization setting, which admins change, and it keeps the records by default. Nicklas decided this on 2026-10-05.

## Consequences

- By default an erased thread's approval records and its `approvalDecided` entries stay, text and edits included.
- With the setting on, erasing a thread also erases the approval records of the drafts that sent in it. Their `approvalDecided` entries stay in the feed, naming the decision and its actor, without the draft's text or the edit, so the feed still shows that a decision was made and by whom.
- The setting applies to erasures from when it changes. Turning it on doesn't reach back: approval records of threads erased before then stay.
- Changing it is a setup change in the organization's change feed, attributed to the admin.
- Either way, point-in-time recovery can keep erased metadata in DynamoDB's backups for up to 35 days (`docs/aws.md`). The raw mail is gone at once.
- It is the organization's first setting, so it sets the pattern for later ones, such as the retention period.
