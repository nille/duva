# Coo has an address its human's allowed senders mail, proven by DMARC, or by a code when DMARC fails

Each human's Coo has an address of its own: by default the local part of the human's default address with -coo, on its domain, such as nicklas-coo@duva.nille.xyz. An admin can change it, as any address. Each takes one receipt-rule recipient (ADR-0004). Mail to it is a request to the human's Coo, not mail into a mailbox, so ADR-0030's "agents own no mailboxes" stands: Coo still owns none, and its address delivers to no mailbox. Nicklas chose this on 2026-10-11.

- **Who may ask:** the human's own addresses from the start, and any address they list. Everyone else's mail to Coo's address is dropped quietly, as SES never bounces.
- **Proof of sender, DMARC first:** a request is taken at once when SES's receipt says DMARC passed for the From domain. From the organization's own addresses, the Message-ID must instead be one Duva recorded for its own send, as #161 does.
- **Verifying by email, only when that fails:** when DMARC failed or the domain has none, Coo takes nothing yet. It mails the From address a one-time code, and takes the request only when a reply from that address brings the code back within an hour. The code goes to the address's real owner, so a forger never sees it. A reply with the code counts even if its own DMARC fails, so a sender whose domain never passes DMARC can still ask. Verification attempts, and requests never verified, are noted in the human's activity.
- **Replies:** Coo always answers the From address itself, never a Reply-To, so a forged reply address can't receive what Coo says. It answers from Coo's address. The reply says what Coo did, each action with how it went, archived, labeled, drafted, browsed or paid, not just its answer. When something waits for the human, such as a send for approval or a payment over its limit, a later reply in the same thread tells the requester how it was decided. Every result is logged in Coo's activity.
- **The record:** each request becomes a turn of the human's Ask Coo, marked "by mail from <sender>", with its text and attachments, forwarded mail included, for Coo to read, and an event in Coo's activity. It's never filed in a mailbox. Coo's reply is a turn too, and the mail it sends is in its activity.

## Considered options

- Confirming every request that acts by reply, even with DMARC passing. Set aside by Nicklas for verifying by email only when DMARC fails: a passing DMARC already proves the sender's domain sent it, and a code on every request would slow every use.
- Dropping mail whose DMARC fails. Rejected: senders whose domain has no DMARC policy couldn't ask at all.
- A secret word in each mail. Rejected: forwarding the mail, or a leak, reveals it.
- A plus tag on one reserved coo@ per domain, such as coo+nicklas@. Rejected by Nicklas, who wants <name>-coo@: an address of its own reads as Coo's, and each one's receipt-rule recipient fits well within the 100,000 the rules can list.
- Filing each request as a thread in the human's mailbox, under a Coo label. Chosen first, then set aside by Nicklas: the conversation and Coo's activity are record enough, and the human's mail stays theirs.

## Consequences

- **Each Coo address is an address of the organization** that delivers to its human's Coo, not to a mailbox. It's created with the human's first mailbox, freed with the human, and listed in the receipt rules like any address. If <name>-coo@ is taken, setup picks the next free <name>-coo2@ and says so.
- **Requests and replies count toward the mailbox agents' spend cap,** and Coo's sends from its address keep the disclosure, since Coo is an agent.
- **ADR-0030 is amended, not reversed:** Coo has an address, but no mailbox.
