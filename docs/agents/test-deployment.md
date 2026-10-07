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

## The end-to-end run

`AWS_REGION=eu-north-1 DUVA_TEST_HUMAN_CODES_KEY=$(jq -r .key ~/.cache/duva-tmp/agent45.json) npm run end-to-end` builds, re-deploys the standing deployment with the `duva` binary, then runs the first slice through real SES: a second agent mails the first, the first replies, both through the binary with their own keys, and their sponsor, the test human, approves each send through the API. It reports each step as passed or failed, then what it found about SES. Run it on demand, never on every commit.

- It runs on the standing deployment. Nicklas chose that over a throwaway subdomain, since `duva.nille.xyz` already has its DNS, SES's verification and production access.
- The sponsor is the test human (below), whom the script signs in with an emailed code, which it reads with the key in `DUVA_TEST_HUMAN_CODES_KEY`, Real run 45's. Only creating mailboxes needs an admin: whoever is signed in to the CLI's config, `n@nille.dev`. When that session has expired, Nicklas runs `duva login`.
- The test human's agents `End-to-end first` and `End-to-end second` are made on the first run and reused, each with a new key every run. Agents own no mailboxes (ADR-0030), so each works in a test mailbox the test human owns, `end-to-end-first@` and `end-to-end-second@` on the domain, made on the first run too, with send sponsor access to that one only.
- It reads SES's verdicts and the headers recipients saw from the copies in the mail bucket, and hands SES one message over SMTP on port 25, so this machine needs to reach `inbound-smtp.eu-north-1.amazonaws.com:25`.

## The test human

`rr23codes@duva.nille.xyz` is a test human for runs that sign in to the web app or the API as a human without Nicklas. It owns every test mailbox; real runs never use Nicklas's.

- Its own mailbox has the addresses `rr23human@` and `rr23codes@`, so its sign-in codes land there. Scripts read the codes with Real run 45's key from `~/.cache/duva-tmp/agent45.json`, as `~/.cache/duva-tmp/pw/check.mjs` does to sign in headless Chromium. The address was in an agent's mailbox until agents stopped owning mailboxes (#126), and moved before the deploy whose setup erased that mailbox.
- Real runs send as its agent `Real run 45`, from the test human's mailbox at `rr23human@`, with send sponsor access limited to that one mailbox, to its second mailbox at `rr23second@`, so the mail stays in test mailboxes. The test human approves the sends.
- The old pattern, agent Real run 10 sending to Real run 11's `realrun11@`, is gone with the agents' mailboxes. Agents 10 and 11 are retired.

## What only Nicklas can do

Entering a sign-in code in managed login, opening an SES verification link, and checking the web app in a browser. Run everything else, then ask for these with the URLs and what to report back.

## Sending mail in

SMTP to `inbound-smtp.eu-north-1.amazonaws.com:25` from this machine works only while its IP isn't on SES's blocklists. When SES answers `550 5.7.1 IP address blacklisted by recipient`, send through Duva instead: an agent drafts the message, its sponsor approves it, and real SES delivers it.

## Nicklas's own mail

`nicklas@duva.nille.xyz` is Nicklas's personal mailbox, and may carry his real mail. An agent never reads its threads, messages or raw copies unless he asks. Real runs use the test mailboxes, and find raw copies in the mail bucket by exact Message-ID or key, never as "the latest".

## No world-invocable Lambdas

No Lambda in this account may be invocable by anyone: no resource policy with a public principal, and no function URL with `AuthType NONE`. The account's security mitigation removes such permissions within minutes and raises an alert that disables the function, as it did to the download Lambda after #26's deploy. Every Lambda is invoked by an AWS service principal with a source condition, or through IAM. The cloud assembly's tests check this before any deploy.
