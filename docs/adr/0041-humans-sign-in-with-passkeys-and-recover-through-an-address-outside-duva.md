# Humans sign in with passkeys, and recover through an address outside Duva

Humans sign in with passkeys, through Cognito's managed login, which ADR-0010 left for later. Each human also has a recovery address outside the organization's own domains, given when they're added. Duva sends the first sign-in link there, to register a passkey, and every recovery link after. The emailed code to the sign-in address stays as a fallback. Nicklas chose this on 2026-10-13, so that his sign-in address can be n@nille.world, a mailbox in Duva itself, with ekenstam@gmail.com as its recovery address.

- **Adding a human** takes a recovery address, and refuses one on the organization's domains. `duva deploy` takes the first admin's recovery address as well.
- **The first sign-in:** Duva mails a one-time link to the recovery address, valid 30 minutes. Following it signs the human in and asks them to register a passkey. A human can keep several passkeys and remove them.
- **Recovery:** a human who has lost their passkeys asks for a recovery link on the sign-in page. It goes only to the recovery address, and an admin can send one too. A human changes their recovery address only after confirming a link sent to the new one.
- **How it's built:** the links are a Cognito custom authentication challenge, whose triggers are Lambdas only Cognito may invoke. The link's token is single-use, kept only as a hash, and expires.

## Considered options

- Signing in with an address outside Duva, such as n@nille.dev, and keeping the mailbox separate. Safe today, but Nicklas wants his Duva address to be his identity.
- A one-time link printed by `duva deploy` for the deployer. Rejected by Nicklas for a recovery address per human, which also serves every later human and every later recovery.
- Keycloak, self-hosted. Rejected: it needs an always-on server and database, which breaks ADR-0006, and Cognito's passkeys give what Duva needs.

## Consequences

- **ADR-0010's "passkeys come later" is done,** and the emailed code becomes a fallback.
- **SES must be out of the sandbox** to mail recovery addresses, since those are outside the organization.
- **Existing humans get no recovery address.** They can add one in Settings, and the web app asks them to until they do.
- **Passkeys are bound to the user pool's prefix domain,** Cognito's default relying party, since a stack that creates the pool can't name its domain as one (docs/aws.md). A custom sign-in domain later would need its own passkeys.
- **Registering a passkey is managed login's own,** and needs a session there. Managed login never offers a custom challenge, so a human signed in by a link signs in to managed login, with the code emailed to their sign-in address, before they register one. For a sign-in address in Duva, that code lands in the mailbox the link opened.
- **Setup gives the first admin a mailbox at their sign-in address** when it is on one of the organization's domains and no mailbox has it, as an admin creating one in Settings does, so the code managed login emails before their first passkey has somewhere to land (#177). A first admin who signs in outside the organization's domains gets none.
- **The first admin's first link waits for SES,** which mails it from the sign-in domain once SES has verified it, so a first deploy mails it on the re-run that deploy already asks for.
- **Sessions that manage passkeys carry Cognito's own scope,** whose tokens may also set the human a password or register a passkey through Cognito's API. Duva's app clients may write no attribute it reads, so no token changes the address a human signs in with.
