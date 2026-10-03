# Duva

Duva is a self-hosted mailbox platform on Amazon SES where humans and agents are both actors.

## Development

- Tests run DynamoDB Local on Java, so they need Java 17 or newer on the PATH.
- `packages/openapi/src/*.gen.ts` is generated from `packages/openapi/openapi.yaml`. Edit the document, then run `npm run generate`. `npm run build` fails while generated code is stale.
- API tests start the API in-process with `startDuva()` from `packages/api/test/harness.ts` and drive it through the generated client. CLI tests run `duva` as a process under Bun.
- `duva deploy` deploys the cloud assembly embedded in the binary, so changes to the CDK app reach it only through `npm run build`. The CDK app can't be synthesized inside the compiled binary.

## Agent skills

### Issue tracker

GitHub Issues on `nille/duva`, through the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default labels, unchanged. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` and `docs/adr/` at the root. See `docs/agents/domain.md`.
