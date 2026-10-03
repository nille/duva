# AWS behavior Duva depends on

Facts about AWS that shaped Duva's design, each with how it was established. A change that relies on one of them, or would undo a choice made because of one, cites it here. When a run or a probe settles a new one, add it.

## Cognito

- **CreateUserPool refuses an SES identity that SES hasn't verified.** With `EmailSendingAccount: DEVELOPER`, it fails with "Email address is not verified". A new domain's identity never is on its first deploy, so the stack takes `DomainVerified`, and until SES has verified the domain the pool sends with `COGNITO_DEFAULT`. _Probed in 925039213717, 2026-10-03._
- **A pool on `COGNITO_DEFAULT` can still offer email OTP sign-in.** Codes then come from `no-reply@verificationemail.com`, which isn't in the account's SES sandbox. _Probed, and signed in through it in eu-west-3, 2026-10-03._
- **Humans created without a password are confirmed at once,** when a passwordless factor such as email OTP is available, and Cognito can't generate a password for them. PASSWORD must still be listed among the first factors. _[Creating user accounts as administrator](https://docs.aws.amazon.com/cognito/latest/developerguide/how-to-create-user-accounts.html)._
- **Choice-based and passwordless sign-in exist only in the newer managed login,** never in the classic hosted UI. An app client needs `ALLOW_USER_AUTH`. _[re:Post, passwordless authentication](https://repost.aws/knowledge-center/cognito-passwordless-authentication)._
- **Callback URLs match exactly, port included.** HTTP is allowed only for `localhost`, `127.0.0.1` and `[::1]`. So `duva login` listens on a fixed port. _[CreateUserPoolClient, CallbackURLs](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_CreateUserPoolClient.html)._
- **Prefix domains are unique per region.** Deployments in eu-north-1 and eu-west-3 of the same account both took `duva-925039213717`. _Real run, 2026-10-03._

## API Gateway HTTP APIs

- **A Lambda authorizer answers 401 by failing with "Unauthorized",** but only when it has no identity sources. With identity sources, API Gateway answers 401 itself when one is missing, and `isAuthorized: false` gives 403. Caching needs an identity source, so Duva's authorizer caches nothing. _[HTTP API Lambda authorizers](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-lambda-authorizer.html); 401 for a missing and a forged token seen in the real run, 2026-10-03._

## CloudFront

- **Names are global to the account.** Two regions' stacks collided on the origin access control's CDK default name, so every CloudFront name carries the region. _Real run, 2026-10-03._

## SES

- **An active receipt rule set with no rules refuses all mail** with `550 5.1.1`. _Real run of #4._

## Still open

- Whether SES refuses an unknown recipient with a 5xx when the same message also goes to a known one, and how `ScanEnabled` defaults. See spec #1, Further Notes.
