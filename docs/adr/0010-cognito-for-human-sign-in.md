# Cognito for human sign-in

Humans sign in through a Cognito user pool in the organization's own AWS account: passkeys first, emailed one-time codes (sent through our SES) as fallback, social sign-in later. Building our own sign-in would mean owning credential security. Requiring an external identity provider would suit companies but not a family. Cognito's free tier covers a typical organization, and moving users out of a user pool later is hard, so this carries lock-in.
