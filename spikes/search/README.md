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

## #18: new mail, concurrent writers and maintenance

`node harness/writes.ts up`, then `all`, then `down`. It runs on copies of the benchmark table named `writes-*`, through a writer function and a reader function of its own in the `duva-search-spike-writes` stack (x64 zip, 1,769 MB unless stated). It never writes to `benchmark`. LanceDB 0.39.0, eu-north-1, on 2026-10-03. S3 requests are LanceDB's own count of its object store requests (`instrumentLanceDbMetrics`). Costs are at eu-north-1's on-demand prices. Raw numbers are in `results/18-writes.json`.

The written mail is generated (`src/generated-mail.ts`): about 1,200 characters and 240 tokens each, from 20 sentences in rotation, with a word of its own to search for.

### Freshness

A warm reader finds a new message on its first search after the commit, every time: 129 ms p50 and 142 ms p95 from commit to answer in the writer's own process (100 writes), and 176 ms p50 and 199 ms p95 from another warm Lambda, counted from the writer's answer (20 writes). That is the time of one search, well inside the 60 s target, because readers set `readConsistencyInterval` to 0. Checking for new versions costs each search one LIST.

### Writes

| | One at a time, warm | One at a time, cold | Batches of 10 | of 100 | of 1,000 |
| --- | --- | --- | --- | --- | --- |
| Time per write, p50 | 424 ms | 846 ms init, 635 ms opening the mailbox, 685 ms writing | 523 ms | 1,012 ms | 5,289 ms |
| of which embedding | 85 ms | | 132 ms | 600 ms | 4,583 ms |
| of which the commit | 334 ms | | 389 ms | 419 ms | 706 ms |
| S3 requests per message | 13 | 13, plus 6 to open | 1.3 | 0.13 | 0.013 |
| S3 per message | $0.000047 | $0.000047 | $0.0000047 | $0.00000047 | $0.00000005 |
| Lambda per message | $0.000012 | $0.000064 | $0.0000039 | $0.0000003 | $0.0000002 |
| Embedding per message | $0.000005 | $0.000005 | $0.000005 | $0.000005 | $0.000005 |

- A commit costs the same whatever it carries: 3 PUTs, 6 LISTs and 4 GETs. LISTs are billed like PUTs, so a single write's S3 requests cost more than its embedding.
- Every write adds a fragment, which no index holds until maintenance runs.

### Labels and removals

| | Time, p50 | S3 requests | S3 | Lambda |
| --- | --- | --- | --- | --- |
| Changing one message's labels | 278 ms | 25 | $0.000038 | $0.0000086 |
| Removing one message | 215 ms | 9 | $0.000027 | $0.0000065 |
| Removing 30 messages at once | 213 ms | 9 | | |

- A label change is an update, and LanceDB rewrites the whole row, vector included, into a new fragment. So each label change adds a fragment, like a write. Changing a thread's labels message by message costs a commit per message.
- A removal only marks the row deleted. Searches leave it out at once.

### Rows no index holds yet

Searches stay correct with unindexed rows, but slow down with the number of small fragments. Most of the slowdown comes from the filter that leaves out Spam and Trash (`NOT array_has_any(labels, ...)`), which costs CPU, not S3 requests. Warm p50 from the writer's reader, on a table maintenance had left in one fragment:

| Unindexed | Keyword, without Spam and Trash | Keyword, Inbox | Keyword, unfiltered | Phrase, without Spam and Trash | Vector, without Spam and Trash | Hybrid, without Spam and Trash |
| --- | --- | --- | --- | --- | --- | --- |
| none | 55 ms | 54 ms | 50 ms | 58 ms | 159 ms | 176 ms |
| 1 write | 102 ms | 59 ms | 58 ms | 80 ms | 215 ms | 251 ms |
| 10 writes | 124 ms | 75 ms | 83 ms | 102 ms | 220 ms | 244 ms |
| 50 writes | 206 ms | 147 ms | 101 ms | 135 ms | 216 ms | 318 ms |
| 150 writes | 374 ms | 333 ms | 193 ms | 233 ms | 258 ms | 435 ms |
| 100 rows in one write | 135 ms | 88 ms | 89 ms | 98 ms | 221 ms | 260 ms |

- Vector searches read every unindexed fragment's vectors from S3 on each search: 6 GETs fully indexed, 166 after 150 writes.
- On top of the benchmark as loaded, in 50 fragments, 120 single writes took the reader function's keyword search from 57 ms to 2,132 ms p50, phrase to 1,078 ms and hybrid to 1,896 ms. Maintenance brought all of them back (keyword 50 ms).

### Five concurrent writers

Five writer Lambdas each added 40 messages one at a time to one mailbox. All 200 arrived exactly once, and no write failed. But 29 of the 200 commits lost the race for the next version 58 times between them, and LanceDB retried those inside the call. Commit p95 went from 375 ms to 1,887 ms. In the first run, one commit retried six times and took 28.8 s.

### Maintenance during writes

The same five writers added 60 messages each while a sixth changed 20 messages' labels and removed 20 others, and `optimize()` (compaction, index updates, pruning every old version) ran over and over until they were done: twice, 43 s and 56 s. All 300 messages arrived once, every label change and removal held, and the table's row count came out exactly as expected (103,395), so no earlier message went missing either. Maintenance itself never failed.

It blocks nobody, since LanceDB takes no locks, but it adds conflicts. Three writes and one label change failed with `Too many concurrent writers. Attempted 8 times, but failed on retry_timeout of 30.000 seconds`, after waiting about 30 s. The harness's retry then succeeded, and the failed attempts left nothing behind. The first run had the same, one write and one label change. So the write path must retry this error.

### Maintenance on 100k messages

`optimize()` from a new environment, on a fresh copy of the benchmark:

| Memory | As loaded, 50 fragments | After 1,000 messages in 20 writes |
| --- | --- | --- |
| 1,769 MB | 30.7 s, 760 MB peak, $0.0009 | 19.1 s, 656 MB, $0.0005 |
| 3,008 MB | 27.6 s, 898 MB, $0.0014 | 18.5 s, 635 MB, $0.0009 |
| 10,240 MB | 26.9 s, 1,108 MB, $0.0045 | 17.6 s, 691 MB, $0.0029 |

- It waits on S3, so more memory barely helps. 1,769 MB has room to spare, and every run in this ticket stayed under 1.2 GB and 65 s.
- `cleanupOlderThan` is taken when the call starts, so the versions maintenance writes are newer than it, and so is the one just before them. Old data files go only at the next run: 606 MB of them in the run after the first.
- Compaction merges small fragments and leaves large ones: after 20 writes of 50, the 100k-message fragment stayed, and the 20 became one.

### Erasure

A removed message's text stays in its data file until compaction rewrites that fragment, and the run after that prunes the old file. Compaction rewrites a fragment only once enough of its rows are deleted (LanceDB's default is 10%), and Node's `optimize()` in 0.39.0 takes no compaction options. With 1 of 20 messages removed, the message's own word stayed in the data file through two maintenance runs. With 5 of 20 removed, the fragment was rewritten, and after the second run no file held any removed message's words. In a mailbox of 100k messages in one large fragment, removing Spam and Trash would leave their text on S3 indefinitely. The words never showed in the index files, even before removal, so their encoding hides them from this check. Whether the full-text index keeps a removed message's words is unknown.

### Recommended write path

- **One writer per mailbox,** such as a per-mailbox FIFO queue (SQS FIFO with the mailbox as the message group) feeding a Lambda that writes what has arrived in one `add()`. A commit costs the same whatever it carries, so batching is nearly free, and a single writer has no commit conflicts. Concurrent writers lose nothing, but they wait up to 30 s and sometimes fail.
- **Retry a failed write.** In these runs a failed attempt left nothing behind, but a queue's redelivery can repeat a write that did commit. So the product's `add()` should be idempotent on the message id, for example with LanceDB's merge-insert. This spike didn't measure that.
- **Batch label changes and removals as well.** Changing a thread's labels should be one commit for all its messages, not one per message: the module's `changeLabels` takes one message today.
- **Readers keep `readConsistencyInterval` at 0.** New mail is then searchable on the next search, at one LIST per search.

### Recommended maintenance schedule

- **The mailbox's writer runs `optimize()` itself, between writes,** so maintenance never races a write. Five writers and maintenance together showed what racing costs.
- **Run it after about 20 writes, or a few minutes after the last write, whichever comes first.** Below 20 small fragments, the keyword search without Spam and Trash stays under about 150 ms. At 150 it reaches 374 ms, past the 300 ms keyword target. Label changes count as writes.
- **At 1,769 MB and a 15-minute timeout,** a run takes 20 to 60 s and under 1.2 GB, for about $0.0005 to $0.002. That is at most one run per quiet spell, and even 50 runs a day cost under $0.10.
- **Keep old versions for a few minutes, not 7 days.** A search still reading the version before maintenance may then still find its files. That's a precaution: this ticket pruned every old version and saw no failed search, but didn't search during pruning. Spam and Trash erasure can't rely on maintenance alone (see Erasure), so that needs a decision before search ships.
