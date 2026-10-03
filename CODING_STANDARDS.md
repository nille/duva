# Coding standards

What a review of a change in Duva checks. `npm run check` already enforces the mechanical rules: generated code matches `packages/openapi/openapi.yaml`, Duva's own text has no em dash, the tests pass and the code typechecks. A review covers the judgement calls below.

## Sources

- `GLOSSARY.md`: the domain language. Names, test names, CLI output and comments use its terms, never the ones it lists under _Avoid_.
- `docs/adr/`: the decisions. A change that contradicts an ADR says so and why. It never overrides one silently.
- `PRODUCT.md`: the copy rules for anything a human or an agent reads, CLI output and error messages included. Plain, direct and short. Prefer a period or a comma over a dash, never a spaced hyphen as a dash, and no "not X but Y" restatement.
- `.agents/skills/tdd/`: what a good test is, and the anti-patterns.
- `docs/aws.md`: the AWS behavior Duva's design rests on. A change that undoes a choice made because of one of those facts says why the fact no longer holds.

## Tests

- Tests sit at the seams `AGENTS.md` lists, and observe only what comes out of them. A test that reads a DynamoDB item, an S3 key or a private function sits outside every seam.
- Test names state behavior in the glossary's terms.
- Expected values come from an independent source: a literal, a worked example, the spec.

## Code

- The API, the CDK app and the test harness take what they share from one place: operations from `@duva/openapi`, the table's key schema and the Lambda's environment variables from `@duva/api/infrastructure`.
- A deployment's code is what `npm run build` built. A Lambda bundles everything it imports, the AWS SDK included.
- Every CLI command prints JSON on stdout. Errors go to stderr as JSON, with exit code 1, and say what to do next.
