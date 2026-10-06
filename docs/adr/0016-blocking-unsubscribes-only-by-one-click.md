# Blocking a sender unsubscribes only by one-click

When an actor blocks a sender in the Screener, Duva also tries to unsubscribe the mailbox from that sender's mail, so blocked lists stop sending rather than piling up in Trash. It does so only by RFC 8058 one-click: the blocked mail's `List-Unsubscribe` header has an `https:` URI, its `List-Unsubscribe-Post` says `List-Unsubscribe=One-Click`, and a DKIM signature that passed covers both headers. Duva then sends that one POST from a Lambda, with no cookies or referrer, and records the outcome in the mailbox's change feed under the actor who blocked. Nicklas chose this on 2026-10-06.

## Considered options

- `mailto:` unsubscribe, sent from the mailbox's address. Rejected: it's outgoing mail from the human, which raises approval and disclosure when an agent blocks, and it confirms the address to whoever reads it.
- Following unsubscribe links in the body. Rejected: arbitrary links can do anything and confirm the address to spammers.

## Consequences

- Mail without one-click, or whose headers no passing DKIM signature covers, gets no unsubscribe. The block still keeps it out.
- Duva never unsubscribes from mail SES judged to be spam, since that confirms a live address.
- The POST goes out from Duva's account to the sender's server. It needs no endpoint of Duva's own.
- A 307 or 308 redirect repeats the POST at the new URL, which may be `http:`, a few times at most, each checked as the first URL was: port 80 or 443, at a public address. Only a success unsubscribes, since another redirect may lead to a page that asks to confirm. #55 settled this on 2026-10-06.
