# Group copies to external members are re-sent from the group

SES only sends From verified identities, and DMARC would reject a relayed outside sender anyway. So when a group delivers to an external member, the copy is re-sent From the group address, shown as "Alice via team" <team@a.com>, with Reply-To set per group to the original sender (the default for new groups) or to the group. Local members get the original message untouched, because local delivery never goes through SES sending.
