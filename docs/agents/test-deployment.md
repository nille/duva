# Test deployment

Where a ticket's real run happens, and what the agent may do there.

## The account

- AWS account 925039213717, through the SSO profile `AWSAdministratorAccess-925039213717`. When its credentials have expired, Nicklas signs in again.
- The shell's `AWS_REGION` points at a region Duva doesn't use, so set `AWS_REGION` on every command that touches a deployment.
- The agent may create throwaway resources in this account to settle how an AWS service behaves, as long as the same script deletes them. Record what it learns in `docs/aws.md`.

## The standing deployment

- eu-north-1, with the domain `duva.nille.xyz`. Its DNS records are live in Cloudflare, SES has verified it, and the account has production access there.
- The first admin is `n@nille.dev`. The CLI config in `~/.config/duva` points at this deployment, with Nicklas signed in.
- Redeploy it with the ticket's build. It stays up.

## Fresh deploys

- Use eu-west-3, where the account is in the SES sandbox, with a throwaway subdomain of `duva.nille.xyz` that has no DNS records, like `w3.duva.nille.xyz`. That covers a first deploy, an unverified domain and the sandbox.
- Give the CLI its own config there, with `XDG_CONFIG_HOME=/tmp/duva-euw3`, so the standing deployment's config survives.
- Tear it down afterwards with `AWS_REGION=eu-west-3 node scripts/destroy-test-deployment.ts --yes`.

## Checking a deployment

After every deploy, run `AWS_REGION=<region> node scripts/check-deployment.ts`. It runs the checks that need no human. Add a check there for each behavior a ticket makes visible from outside.

## What only Nicklas can do

Entering a sign-in code in managed login, opening an SES verification link, and checking the web app in a browser. Run everything else, then ask for these with the URLs and what to report back.
