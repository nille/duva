# Duva

Duva is a self-hosted mailbox platform on Amazon SES where humans and agents are both actors.

## Development

- Tests run DynamoDB Local on Java, so they need Java 17 or newer on the PATH.
- The API contract is `packages/openapi/openapi.yaml`. Run `npm run generate` after editing it.
- Tests sit at four seams agreed with Nicklas:
  - the API, driven through the generated client from `startDuva()` in `packages/api/test/harness.ts`;
  - the `duva` CLI as a process: args, environment and home directory in (the config file `duva deploy` writes there is CLI behavior), stdout JSON, stderr and exit code out;
  - `duva deploy`'s logic in `packages/cli/src/deployment.ts`, with AWS and DNS replaced by in-memory stand-ins;
  - the cloud assembly the CDK app synthesizes, in `packages/infra/test/`.
- The build synthesizes the CDK app and embeds the result in the `duva` binary, which can't synthesize it. So `duva deploy` ships only what `npm run build` built. Anything deploy learns when it runs, like the domain or the admin's address, reaches the stack as a CloudFormation parameter or is set up by the CLI through the AWS SDK.

## Agent skills

### Issue tracker

GitHub Issues on `nille/duva`, through the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default labels, unchanged. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` and `docs/adr/` at the root. See `docs/agents/domain.md`.
