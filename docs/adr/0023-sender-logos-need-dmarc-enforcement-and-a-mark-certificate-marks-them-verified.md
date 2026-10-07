# Sender logos need DMARC enforcement, and a mark certificate marks them verified

Duva honors BIMI on received mail. It shows a sender's logo in place of their actor mark when all of these hold: the message passed DMARC; the sender's domain enforces DMARC, with `p=quarantine` or `p=reject` (a parent domain's `sp=` for a subdomain) at `pct=100`; and its BIMI record, at the selector the message's `BIMI-Selector` header names or `default`, gives an https logo that is valid SVG Tiny PS. A logo whose VMC or CMC is valid carries a small verified check; one without still shows, unmarked. Mail from an agent keeps the agent's diamond. Nicklas chose this on 2026-10-07 (#117).

A mark certificate is valid when its chain leads to the root of a Mark Verifying Authority the BIMI Group admits to its certificate transparency log, every certificate in the chain is valid at the time and, where it names its purposes, for BIMI, its subject alternative names include the domain or the domain whose record was found, and the logo in its logotype extension is byte for byte the logo the record gives.

Duva looks the logo up when mail arrives, fetches it and the certificate from a Lambda of its own that can reach nothing of Duva's, checks the logo and writes it out again with only the elements and attributes it read. It keeps each logo once, under an ID of its own, and serves it from the web app's domain. So opening mail never reaches the sender, in line with the tracking stance of ADR-0017.

## Considered options

- Showing logos only with a VMC, as Gmail does. Rejected: most senders publish BIMI without one, and DMARC enforcement already says the domain sent the mail. The check tells the two apart.
- Showing logos without DMARC enforcement. Rejected: under `p=none` anyone can send as the domain, and a receiver can't tell.
- Fetching the logo in the browser from the sender's URL. Rejected: it tells the sender when mail is read, and runs the sender's SVG.

## Consequences

- Without the Public Suffix List, the organizational domain is the parent whose DMARC record covers the domain. A subdomain with a DMARC record of its own shows only a logo it publishes itself.
- Revocation of mark certificates isn't checked. An authority that revokes one is followed only once it expires.
- A lookup is kept a day per domain and selector, or an hour when DNS or the sender's server failed, so a domain's new logo shows within a day.
- Logos are public brand marks, so erasing mail leaves them. A logo's URL needs no sign-in, and is the only way to it.
- The roots are part of Duva's code, so a new authority, or one that leaves, needs a new version.
