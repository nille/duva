# Duva

Duva is a self-hosted mailbox platform on Amazon SES where humans and agents are both actors.

## Development

- Tests run DynamoDB Local on Java, so they need Java 17 or newer on the PATH.
- The build needs x64 Linux: the search Lambdas ship LanceDB's x64 native module, which npm installs only there.
- Tests embed with Titan's vectors recorded in `packages/api/test/titan-vectors.json`, and translate searches with Nova Lite's answers recorded in `packages/api/test/nova-translations.json`, so they need no AWS. A text no one recorded gets a vector unlike every other, and words no one recorded have no translation. After changing a search test's mail or words, run that test file with `DUVA_RECORD_EMBEDDINGS=1` and AWS credentials to record both.
- The API contract is `packages/openapi/openapi.yaml`. Run `npm run generate` after editing it, and after changing a CLI command: it also writes the CLI's skill published in `skills/duva/`.
- Tests sit at six seams agreed with Nicklas:
  - the API, driven through the generated client from `startDuva()` in `packages/api/test/harness.ts`. Its options, its `setUp()`, which does what the setup Lambda does when deploy invokes it, its `replaceUserPool()`, which stands for a deploy that brings a new user pool, its `receive()`, which hands SES a message as a sender's server does, now or at a chosen time, its `sendingEvent()`, which has SES publish a bounce, complaint or reject for a message it sent, at a chosen time, as SNS delivers it once or more, its `erase()`, which runs the eraser as its daily schedule does at a chosen time, its `releaseSends()`, which lets the sender catch up on the sends its `sendsHeld` option held back, as when Lambda falls behind, its `releaseIndexing()`, which lets the indexer catch up on the search indexes its `indexingHeld` option held back, its `loseBackfillStep()`, which has the indexer's queue lose the next task for a step of a backfill, as when SQS drops it as a duplicate, its `clock()`, which moves the clock Duva reads to a chosen time and has EventBridge Scheduler invoke what Duva scheduled until then, as for sends waiting for an agent's send limits and threads set aside in Remind me, and its `dnsRecord()`, which puts records in DNS as an admin does at a domain's DNS provider, are input there. `setUp()`'s `backfillLost` loses a backfill's later steps, as when Lambda gives up on them; what they cause is observed through the client. At SES's edge, `receive()` also answers which recipients SES refused and the ID SES gave the message, `receiptRules()` shows the rules Duva gave SES, `emailIdentities()` the domain identities SES has, `signInCodesFrom()` the address the user pool sends sign-in codes from, `sent()` gives the raw MIME of each message SES accepted for sending, `sentTo()` the recipients SES delivered each to, Bcc included, `suppressionList()` the addresses on the account's suppression list, which SES puts every address that hard-bounces or complains on, `bounces()` the bounces SES sent for messages it received, as for mail a group refuses, `stored()` the raw messages the mail bucket keeps, and `searchObjects()` the files of every mailbox's index the search bucket keeps. `inboundLog()` gives the lines the inbound Lambda logged, as CloudWatch Logs keeps them, `download()` follows a download link, or a sender logo's URL, as a browser does, giving what the download Lambda answered through the web app's CloudFront distribution, and `webServer()` puts a web server on the stand-in internet the unsubscriber and the logo fetcher reach, at a host name resolving to the addresses given, and gives the requests it got;
  - the `duva` CLI as a process: args, environment and home directory in (the config file `duva deploy` writes there, and the skill `duva skill install` writes there, are CLI behavior), stdout JSON, stderr and exit code out;
  - `duva deploy`'s logic in `packages/cli/src/deployment.ts`, with AWS and DNS replaced by in-memory stand-ins;
  - the cloud assembly the CDK app synthesizes, in `packages/infra/test/`;
  - the search module through its interface in `packages/api/src/search-engine.ts`, in `packages/api/test/search-engine.test.ts`: the spike's behavior suite, which any engine behind the module passes (ADR-0007). Beside it, `packages/api/test/search-evaluation.test.ts` measures the engine on #67's evaluation set, so its numbers are this engine's, and an engine swapped in measures again;
  - the built web app in headless Chromium, through `startWebApp()` in `packages/web/test/web-app.ts`: it serves the build against `startDuva()`'s in-process stack and its managed-login stand-in, and tests drive the page as a human does, by clicking, typing and reading the screen. They cover what a human sees and does, and leave the domain rules to the API's tests. They need Chromium, found at `CHROMIUM` or a usual path.
- A ticket ends with a real run in the test account. See `docs/agents/test-deployment.md` for where, and what the agent may do there.
- The build synthesizes the CDK app and embeds the result in the `duva` binary, which can't synthesize it. So `duva deploy` ships only what `npm run build` built. Anything deploy learns when it runs, like the domain or the admin's address, reaches the stack as a CloudFormation parameter or is set up by the CLI through the AWS SDK.

## Agent skills

### Issue tracker

GitHub Issues on `nille/duva`, through the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default labels, unchanged. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` and `docs/adr/` at the root. See `docs/agents/domain.md`.
