# Cognito for human sign-in

Humans sign in through a Cognito user pool in the organization's own AWS account: passkeys first, emailed one-time codes (sent through our SES) as fallback, social sign-in later. Building our own sign-in would mean owning credential security. Requiring an external identity provider would suit companies but not a family. Cognito's free tier covers a typical organization, and moving users out of a user pool later is hard, so this carries lock-in.

## Consequences

- Cognito sends codes through SES only once SES has verified the domain (`docs/aws.md`). Until then, after a deployment's first deploy, they come from Cognito's own sender, and deploy asks for a re-run once SES has verified it.
- Passkeys wait for a custom sign-in domain, since a passkey is bound to the domain it was made on (spec #1, Further Notes). Until then codes are the only way to sign in.
