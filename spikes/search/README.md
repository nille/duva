# Search spike

The spike in #2: does LanceDB on S3 meet Duva's search targets, queried from Lambda in eu-north-1? It sits outside the npm workspace, with its own lockfile, so it neither waits for nor shapes the monorepo.

- `src/search.ts` is the search module's interface. Any engine sits behind it.
- `src/lancedb-search.ts` is LanceDB behind it, at the version pinned in `package.json`.
- `src/titan.ts` embeds with Titan Text Embeddings V2 in eu-north-1. The module calls it itself, so callers pass plain text.
- `test/` is the behavior suite on a fixture mailbox: the contract any engine passes.
- `harness/` builds the Lambda packages, builds the benchmark mailbox, and creates, measures and deletes everything in AWS.
- `infra/stack.yaml` is the one CloudFormation stack, `duva-search-spike`, that holds all of it.
- `results/` holds what each measurement recorded.

## Running it

Node 24 or newer. `npm ci` here. Every run embeds with Bedrock, the suite's on local disk included, so set the profile first:

```sh
export AWS_PROFILE=AWSAdministratorAccess-925039213717
npm test                       # the suite on a table on local disk
npm run typecheck

node harness/harness.ts up        # create the stack, build and deploy both packages
node harness/harness.ts test-s3   # the suite on a table on S3
node harness/harness.ts seed      # the fixture mailbox, where the functions read it
node harness/harness.ts measure   # cold and warm invocations, into results/
node harness/harness.ts mailbox   # rebuild the 100k-message benchmark mailbox from scratch, into results/
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

## #16: the benchmark mailbox

`node harness/harness.ts mailbox` rebuilds it from scratch: it downloads the Enron corpus into `.data/` if it isn't there (CMU's tarball, 443 MB, never committed), drops the `benchmark` table, and loads every message through the search module. LanceDB 0.39.0, eu-north-1, on 2026-10-03, loaded from this machine over the internet. Raw numbers in `results/16-mailbox.json`.

The mailbox:

- 100,000 messages: 97,000 from Enron and 3,000 generated Swedish ones, from 1997 to 2002, in 88,445 threads. The corpus has 254,783 messages once copies are removed. The sample is the 97,000 with the lowest content hash, so it spreads over every employee's folders.
- A thread is a subject without its reply and forward prefixes, among the same set of people, since the corpus has no In-Reply-To headers.
- Labels are assigned per thread: 10.9% of messages are in the Inbox, 81.0% are archived, 3.0% are Spam and 5.1% Trash. Five user labels sit on top: Projects 7.4%, Finance 5.4%, Important 3.6%, Legal 2.6%, Travel 1.8%.
- Attachments were stripped from the corpus, but 9.6% of messages still name one (`<<forecast.xls>>`), and those count as having one.
- The Swedish mail comes from a seeded generator (`harness/swedish.ts`): ten everyday topics, each with its words in several forms.

What it took:

| | |
| --- | --- |
| Embedding | 100,000 Titan V2 requests, 26.1M input tokens, $0.55 at $0.000021 per 1,000 |
| Load | 17.0 min to embed, write and index, of which embedding 14.7 min; reading the corpus 28 s |
| Indexes | all nine built in 73 s after the last write, IVF_PQ alone 58 s |
| Size on S3 | 598 MB in 194 objects: data 508 MB, indexes 90 MB |
| Peak memory | 2.2 GB, holding the mailbox while building the indexes |

- The module writes in batches of 2,000, so the table has 50 fragments. Compaction is the next tickets' maintenance question.
- IVF_PQ with cosine distance and otherwise LanceDB's defaults (partitions, probes, no refine) found 5 to 8 of the flat scan's top 10 on six queries, filtered ones included. `flatVectorSearch` (and `flatVectorSearch: true` in the Lambda's event) runs the flat scan, so the next ticket can measure both.

### Swedish next to English

A full-text index stems for one language. So the module detects each message's language by counting common Swedish and English words, puts its subject and text in either the `_en` or the `_sv` columns, and indexes each pair with its own stemmer. A query searches all four columns, and each column analyzes the query its own way. So "invoices" finds "invoice" and "fakturor" finds "faktura", in one search. 3,022 messages went to the Swedish columns: the generated ones but one, and 23 Enron messages that are mostly lists of names.

- English folds accents, so "cafe" finds "café". Swedish keeps å, ä and ö, which are letters of their own there: "får" (gets) is not "far" (father).
- Snowball's Swedish stemmer takes "-or", "-orna", "-en" and "-et" off, but not the definite "-an": "fakturan" stays "fakturan", and "faktura" doesn't find it.
- Short Swedish mail without any common Swedish word is stemmed as English.
