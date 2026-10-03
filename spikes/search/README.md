# Search spike

The spike in #2: does LanceDB on S3 meet Duva's search targets, queried from Lambda in eu-north-1? It sits outside the npm workspace, with its own lockfile, so it neither waits for nor shapes the monorepo.

- `src/search.ts` is the search module's interface. Any engine sits behind it.
- `src/lancedb-search.ts` is LanceDB behind it, at the version pinned in `package.json`.
- `test/` is the behavior suite on a fixture mailbox: the contract any engine passes.
- `harness/` builds the Lambda packages and creates, measures and deletes everything in AWS.
- `infra/stack.yaml` is the one CloudFormation stack, `duva-search-spike`, that holds all of it.
- `results/` holds what each measurement recorded.

## Running it

Node 24 or newer. `npm ci` here, then:

```sh
npm test                       # the suite on a table on local disk
npm run typecheck

export AWS_PROFILE=AWSAdministratorAccess-925039213717
node harness/harness.ts up        # create the stack, build and deploy both packages
node harness/harness.ts test-s3   # the suite on a table on S3
node harness/harness.ts seed      # the fixture mailbox, where the functions read it
node harness/harness.ts measure   # cold and warm invocations, into results/
node harness/harness.ts down      # empty the bucket and delete the stack
```

`up` builds the arm64 image in CodeBuild on an ARM host, so it needs no local Docker.

## #15: LanceDB in Lambda

LanceDB 0.39.0, `nodejs24.x`, 1,769 MB, eu-north-1, on 2026-10-03. One keyword query (`kayak`, without Spam and Trash) against the 30-message fixture table on S3. Raw numbers in `results/15-packaging.json`.

| Package | Native module loads | Size | Init, 5 cold starts | First search when cold | Warm search, 10 queries |
| --- | --- | --- | --- | --- | --- |
| x64 zip | yes | 75.3 MB zipped, 213.8 MB unzipped | 572-696 ms | 1,160-1,431 ms | 39-46 ms |
| arm64 image | yes | 400.7 MB of code on the base image, 258.7 MB compressed in ECR | 496-839 ms | 643-1,049 ms | 40-51 ms |

- The zip's unzipped limit is 262,144,000 bytes, so the x64 zip leaves about 48 MB. The arm64 native module alone is 389 MB, and stripping its debug info only takes it to 364 MB, so arm64 needs an image.
- In an earlier run, an image's first cold start right after its deploy took 6.6 s to init and 19 s to search, while Lambda readied the new image.
- The first search when cold opens the table. A warm environment keeps it open.
- Search times are inside the handler, from receiving the query to returning ranked hits. With 30 messages they are mostly S3 round trips: every query checks for newer commits, since `readConsistencyInterval` is 0.
- LanceDB's object store doesn't follow an SSO profile, so the harness hands it the profile's credentials as environment variables. In Lambda it uses the function's role.
- LanceDB 0.39.0 aborts the process when the full-text index's language isn't spelled as its enum spells it, `"english"` included (lancedb/lancedb#4367). The module writes `"English"`, and the suite builds the index in a child process to prove the process survives. With `"english"` that test fails on SIGABRT.
