# Duva

Duva is a self-hosted mailbox platform on Amazon SES where humans and agents are both actors.

## Development

- Tests run DynamoDB Local on Java, so they need Java 17 or newer on the PATH.
- The API contract is `packages/openapi/openapi.yaml`. Run `npm run generate` after editing it, and after changing a CLI command: it also writes the CLI's skill published in `skills/duva/`.
- Tests sit at five seams agreed with Nicklas:
  - the API, driven through the generated client from `startDuva()` in `packages/api/test/harness.ts`. Its options, its `setUp()`, which does what the setup Lambda does when deploy invokes it, its `replaceUserPool()`, which stands for a deploy that brings a new user pool, and its `receive()`, which hands SES a message as a sender's server does, are input there; what they cause is observed through the client. At SES's edge, `receive()` also answers which recipients SES refused and the ID SES gave the message, `receiptRules()` shows the rules Duva gave SES, `sent()` gives the raw MIME of each message SES accepted for sending, and `sentTo()` the recipients SES delivered each to, Bcc included. `inboundLog()` gives the lines the inbound Lambda logged, as CloudWatch Logs keeps them;
  - the `duva` CLI as a process: args, environment and home directory in (the config file `duva deploy` writes there, and the skill `duva skill install` writes there, are CLI behavior), stdout JSON, stderr and exit code out;
  - `duva deploy`'s logic in `packages/cli/src/deployment.ts`, with AWS and DNS replaced by in-memory stand-ins;
  - the cloud assembly the CDK app synthesizes, in `packages/infra/test/`;
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
