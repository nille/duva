# Each human keeps secrets Coo uses but never reads, and cards pay within limits

Each human has a store of secrets for Coo to use:
- site usernames and passwords;
- one-time-code seeds;
- payment cards;
- any other value, such as a membership number.

Coo uses them while browsing (ADR-0038), but never reads them. Coo's model never sees a value. The browsing run asks Duva to type a named secret into a page field, and Duva does it outside the model, so a page can't trick Coo into saying or mailing a secret it never saw. Nicklas chose this on 2026-10-11. It reverses two of ADR-0038's limits: Duva now keeps passwords, and Coo may pay.

- **Where a login or another value is used is Coo's choice.** Nicklas chose that over binding each secret to its own sites.
- **Cards pay only on their sites.** A card names the sites it may pay on, such as sj.se and netflix.com, which its human sets with it. Duva types a card only into a page whose address, as the browser reports it, is on one of them or a subdomain, never by what the page says, so a look-alike never gets it. A card with no sites pays nowhere: each of its payments waits in Approvals, as one on any site it doesn't name. A payment on another site waits in Approvals with the site named, and approving it adds the site to the card. Nicklas chose this on 2026-10-13 (#171), closing the gap below for cards.
- **Payments:** a card pays unattended only within the per-payment and per-month limits its human sets. Above either limit, the payment waits in Approvals with its site, amount and card. A card with no limits set doesn't pay at all, and admins can switch paying off for the organization.
- **Approving resumes.** Approving a payment that waited, above the limits or on a new site, starts a fresh browsing run that goes back to the page and pays it, so no one has to ask Coo again. If it can't, as when the page expired, Coo's activity and its bubble say why. Nicklas chose this on 2026-10-13 (#171).
- **An approval serves only its asker, and lapses.** An approved payment pays only in the fresh run that goes back for it, or in another run of the turn or task that asked for it, as Think harder. Any other run asks again, as a payment above the limits or on a new site does. An approval left unpaid lapses 24 hours after it was given, and pays nowhere after, so a run that still needs it asks again. Coo's activity and Approvals say it lapsed. Nicklas chose this on 2026-10-16 (#183), after #171's real run saw a run asked from another conversation pay at once, above the card's limits, with an approval left from a checkout that had expired.
- **Storage:** secrets are encrypted with a KMS key under the human, in the deployment's region, and erased with the human. Admins and agents can't see them. The human sees only names and the last four digits, and can reveal a value again after confirming with a sign-in code.
- **Record:** every use is listed in the secret's history: when, which site, which run. Every payment shows in Coo's activity with amount and site, and Coo's bubble says so at once.

## Considered options

- Site logins only, with Coo never paying. Rejected by Nicklas, who wants cards too.
- Every payment waiting for approval. Rejected by Nicklas for unattended payments within limits.
- Binding each secret to its own sites, checked by the browser's address. Recommended, since a look-alike page from mail couldn't get a secret then. Rejected by Nicklas for logins and other values, whose use he leaves to Coo, and chosen for cards on 2026-10-13.
- A fresh approval being used only by the next run Coo is asked for. Chosen first, then set aside by Nicklas: the human had to ask Coo again.
- An approval any run may use that pays its amount on the site with the card, until one pays it. Chosen with #171, then set aside by Nicklas on 2026-10-16: an approval the fresh run couldn't use stayed, and paid for a run that never asked for it.
- Coo reading values. Rejected: a value Coo never sees can't leak through what it says or sends.
- AWS Secrets Manager per secret. Rejected: $0.40 a month for each secret, against near zero for KMS-encrypted items in the table (ADR-0006).

## Consequences

- **A page can still be used to phish a login or another value.** Because Coo chooses where those are typed, a page that convinces Coo it is the right site could receive a password. A card is typed only on its sites, by the page's address, so a look-alike can't get one. The browsing run's isolation (ADR-0031, ADR-0038) still keeps the mailbox from any page. Every use is listed, so a misuse is visible.
- **Approving a new site is the human's check.** Approvals names the site, so a human who approves a look-alike adds it to the card.
- **A payment that waits keeps its page,** the run's goal and the values and secrets' names it was given, until it is decided and the fresh run takes them, or its approval lapses. That's more than ADR-0038's sentence, and only for as long as the payment waits.
- **An approval the fresh run couldn't use** is left for the turn or task that asked, for at most a day. After that, the human asks Coo again if they still want it, and approves the payment it asks for.
- **Payment limits are counted per card and month** in the table, in the same transaction as the payment's record, so a retried run never pays twice.
- **Revealing a value** asks for a fresh sign-in code, and is recorded in the secret's history.
