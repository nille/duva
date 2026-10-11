# Each human keeps secrets Coo uses but never reads, and cards pay within limits

Each human has a store of secrets for Coo to use:
- site usernames and passwords;
- one-time-code seeds;
- payment cards;
- any other value, such as a membership number.

Coo uses them while browsing (ADR-0038), but never reads them. Coo's model never sees a value. The browsing run asks Duva to type a named secret into a page field, and Duva does it outside the model, so a page can't trick Coo into saying or mailing a secret it never saw. Nicklas chose this on 2026-10-11. It reverses two of ADR-0038's limits: Duva now keeps passwords, and Coo may pay.

- **Where a secret is used is Coo's choice.** Nicklas chose that over binding each secret to its own sites.
- **Payments:** a card pays unattended only within the per-payment and per-month limits its human sets. Above either limit, the payment waits in Approvals with its site, amount and card. A card with no limits set doesn't pay at all, and admins can switch paying off for the organization.
- **Storage:** secrets are encrypted with a KMS key under the human, in the deployment's region, and erased with the human. Admins and agents can't see them. The human sees only names and the last four digits, and can reveal a value again after confirming with a sign-in code.
- **Record:** every use is listed in the secret's history: when, which site, which run. Every payment shows in Coo's activity with amount and site, and Coo's bubble says so at once.

## Considered options

- Site logins only, with Coo never paying. Rejected by Nicklas, who wants cards too.
- Every payment waiting for approval. Rejected by Nicklas for unattended payments within limits.
- Binding each secret to its own sites, checked by the browser's address. Recommended, since a look-alike page from mail couldn't get a secret then. Rejected by Nicklas, who leaves where to use one to Coo.
- Coo reading values. Rejected: a value Coo never sees can't leak through what it says or sends.
- AWS Secrets Manager per secret. Rejected: $0.40 a month for each secret, against near zero for KMS-encrypted items in the table (ADR-0006).

## Consequences

- **A page can still be used to phish.** Because Coo chooses where a secret is typed, a page that convinces Coo it is the right site could receive a password or a card number. The browsing run's isolation (ADR-0031, ADR-0038) still keeps it from the mailbox, and payments stay within their limits. Every use is listed, so a misuse is visible.
- **Payment limits are counted per card and month** in the table, in the same transaction as the payment's record, so a retried run never pays twice.
- **Revealing a value** asks for a fresh sign-in code, and is recorded in the secret's history.
