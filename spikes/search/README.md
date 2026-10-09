# Search spike

The spike in #2: does LanceDB on S3 meet Duva's search targets, queried from Lambda in eu-north-1? It sits outside the npm workspace, with its own lockfile, so it neither waits for nor shapes the monorepo.

- `src/search.ts` is the search module's interface. Any engine sits behind it.
- `src/lancedb-search.ts` is LanceDB behind it, at the version pinned in `package.json`.
- `src/titan.ts` embeds with Titan Text Embeddings V2 in eu-north-1. The module calls it itself, so callers pass plain text.
- `test/` is the behavior suite on a fixture mailbox: the contract any engine passes.
- `harness/` builds the Lambda packages, builds the benchmark mailbox, and creates, measures and deletes everything in AWS.
- `infra/stack.yaml` is the one CloudFormation stack, `duva-search-spike`, that holds all of it.
- `results/` holds what each measurement recorded.
- `REPORT.md` is the spike's answer (#20): every number against the targets, the costs, and what's left for ADR-0007.

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
node harness/harness.ts latency   # every query type's cold and warm latency on it, into results/ (about 2 hours)
node harness/harness.ts down      # empty the bucket and delete the stack
```

To re-run the benchmark on a new LanceDB release, one command pins and installs it, runs `up`, `seed`, `mailbox` and `latency`, and runs `down` even if a step fails. It takes about 2.5 hours and $3, and rewrites `results/16-mailbox.json` and `results/17-latency.json`, so `git diff` shows what changed. A version also pins it in `package.json` and the lockfile. It doesn't re-run the behavior suite (`npm test`) or #18's writes and freshness, which copy the benchmark table, so they need `node harness/writes.ts up`, `all` and `down` before the stack goes. Without a version it re-runs on the installed one.

```sh
node harness/harness.ts benchmark <version>   # for example 0.40.0
node harness/harness.ts benchmark --shipped   # only what Duva ships, into results/67-latency.json (about 1.5 hours)
```

`--shipped` measures only the x64 zip at 10,240 MB with the vector index, the configuration ADR-0007 chose, and from #67 translated searches, in about an hour less. It still rewrites `results/16-mailbox.json`, so keep that run's copy under its own ticket's name and restore #16's.

#62 tunes the vector index with `harness/recall.ts`, which needs no stack. It reads the vectors `node harness/models.ts export` keeps in .data/models/:

```sh
node harness/recall.ts            # each vector index's recall against a flat scan, into results/62-recall.json
```

#67 measures how far search by meaning reaches, and what translating a search adds, with `harness/cutoffs.ts`, on Duva's evaluation set in `packages/api/test/search-evaluation.ts` with the Titan vectors and Nova Lite translations its test recorded. It needs no stack and no AWS:

```sh
node harness/cutoffs.ts           # recall by language pair and unrelated results per setting, into results/67-cutoffs.json
```

#19 has a harness of its own, `harness/models.ts`, with its own stack, `duva-search-spike-models`. It reads the benchmark mailbox and never writes to it:

```sh
node harness/models.ts export     # the mailbox's embedded text and Titan vectors, into .data/models/
node harness/models.ts questions  # rewrite harness/questions.json (the committed one is what results/ used)
node harness/models.ts quality    # recall at 10 and MRR per dimension, into results/
node harness/models.ts up         # the Lambda that embeds queries
node harness/models.ts latency    # query-embedding latency from it, into results/
node harness/models.ts down       # delete the stack
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

## #17: latency

`node harness/harness.ts latency` re-runs it, in about two hours, after `up` if the handler changed. LanceDB 0.39.0, `nodejs24.x`, eu-north-1, 2026-10-03 22:10 to 2026-10-04 00:16 UTC. Raw numbers, the query set and each sample are in `results/17-latency.json`, with p50, p95 and p99 of each combination, and a second cold run at 1,769 MB in `results/17-cold-recheck.json`.

How it measures:

- Each package has a function of its own for this, `duva-search-spike-latency-x64-zip` and `-arm64-image`, which reads its own copy of the benchmark mailbox. S3 counts requests to each copy, so S3 requests per query come from S3 itself, and the two packages run at the same time. S3 counts per minute, so each combination runs in minutes of its own.
- One fixed query set (`harness/queries.ts`): 44 keyword queries (single words, word pairs and names), 22 phrases taken from the corpus, 20 filtered vector queries and 20 hybrid ones. Filters rotate through label, sender, date and attachment, and nearly every query leaves out Spam and Trash. Every query asks for 20 hits. Vector and hybrid queries run with the IVF_PQ index and as a flat scan.
- Latency is inside the Lambda, from the handler receiving the query to it returning ranked hits, query embedding included. Cold adds the environment's init duration. Round trip is from this machine, through Lambda's Invoke API.
- Cold: 30 new environments per query type, started 10 at a time, each answering one query. Warm-first: 100 queries in one warm environment that forgets every mailbox before each, so each query opens the mailbox anew. Warm: 100 queries in that environment once it has the mailbox open, cycling through the set.
- Readers check for newer commits on every query (`readConsistencyInterval` 0), so a warm reader sees new mail at once. The index cache gets a quarter of the function's memory and the metadata cache a sixteenth.

### p95 against the targets

| Query | Target | x64 zip 1,769 MB | 3,538 MB | 10,240 MB | arm64 image 1,769 MB | 3,538 MB | 10,240 MB |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Warm keyword | 300 ms | 242 | 227 | 177 | 241 | 240 | 190 |
| Warm phrase | 500 ms | 276 | 267 | 166 | 270 | 276 | 157 |
| Warm filtered vector | 500 ms | 199 | 191 | 202 | 192 | 208 | 184 |
| Warm filtered vector, flat | 500 ms | 5,422 ✗ | 5,459 ✗ | 5,201 ✗ | 5,207 ✗ | 5,448 ✗ | 5,439 ✗ |
| Warm hybrid | 800 ms | 202 | 231 | 193 | 194 | 227 | 194 |
| Warm hybrid, flat | 800 ms | 5,254 ✗ | 4,892 ✗ | 5,219 ✗ | 5,081 ✗ | 5,070 ✗ | 4,952 ✗ |
| Cold keyword | 3,000 ms | 3,215 ✗ | 2,986 | 2,534 | 2,641 | 3,517 ✗ | 2,223 |
| Cold phrase | 3,000 ms | 3,407 ✗ | 3,102 ✗ | 2,567 | 2,763 | 2,634 | 2,139 |
| Cold filtered vector | 3,000 ms | 3,148 ✗ | 2,882 | 2,403 | 2,594 | 2,413 | 1,962 |
| Cold filtered vector, flat | 3,000 ms | 5,473 ✗ | 5,189 ✗ | 5,150 ✗ | 4,570 ✗ | 4,696 ✗ | 4,288 ✗ |
| Cold hybrid | 3,000 ms | 3,131 ✗ | 2,991 | 2,689 | 2,493 | 2,461 | 2,017 |
| Cold hybrid, flat | 3,000 ms | 5,589 ✗ | 5,145 ✗ | 5,245 ✗ | 5,353 ✗ | 4,424 ✗ | 4,765 ✗ |

### With the vector index, by condition

Ranges over keyword, phrase, filtered vector and hybrid, in milliseconds.

| Package | Memory MB | Init p50 | Cold p95 | Warm-first p95 | Warm p50 |
| --- | ---: | ---: | ---: | ---: | ---: |
| x64 zip | 1,769 | 751-856 | 3,131-3,407 | 1,333-1,579 | 61-150 |
| x64 zip | 3,538 | 765-785 | 2,882-3,102 | 1,266-1,567 | 62-149 |
| x64 zip | 10,240 | 774-788 | 2,403-2,689 | 821-935 | 62-152 |
| arm64 image | 1,769 | 650-673 | 2,493-2,763 | 1,290-1,575 | 61-147 |
| arm64 image | 3,538 | 577-605 | 2,413-3,517 | 1,261-1,535 | 62-142 |
| arm64 image | 10,240 | 585-592 | 1,962-2,223 | 825-955 | 65-153 |

### p99 and round trip

The same ranges. Round trip is what the caller saw, from this machine through Lambda's Invoke API.

| Package | Memory MB | Cold p99 | Warm-first p99 | Warm p99 | Cold round trip p95 | Warm-first round trip p95 | Warm round trip p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| x64 zip | 1,769 | 3,184-3,508 | 1,356-1,645 | 251-345 | 3,721-4,026 | 1,367-1,616 | 230-308 |
| x64 zip | 3,538 | 2,891-3,161 | 1,331-1,637 | 229-1,099 | 3,518-3,721 | 1,297-1,599 | 219-298 |
| x64 zip | 10,240 | 2,496-2,778 | 852-987 | 186-249 | 3,077-3,320 | 852-968 | 196-237 |
| arm64 image | 1,769 | 2,533-2,956 | 1,327-1,606 | 226-385 | 2,658-2,926 | 1,323-1,603 | 226-301 |
| arm64 image | 3,538 | 2,489-4,250 | 1,312-1,587 | 255-358 | 2,569-3,731 | 1,293-1,565 | 240-309 |
| arm64 image | 10,240 | 2,010-3,276 | 887-1,089 | 169-251 | 2,107-2,429 | 853-982 | 192-225 |

### S3 requests per query

Ranges over both packages and all three memory sizes. All but one of them are GETs.

| Query | Cold | Warm-first | Warm |
| --- | ---: | ---: | ---: |
| Keyword | 89-122 | 114-143 | 16-17 |
| Phrase | 203-220 | 219-265 | 17-18 |
| Filtered vector | 135-160 | 86-140 | 12-13 |
| Filtered vector, flat | 553-758 | 955-968 | 837-840 |
| Hybrid | 427-617 | 187-228 | 25-27 |
| Hybrid, flat | 692-869 | 1,020-1,050 | 697-832 |

What it shows:

- With the vector index, every warm target holds at every memory size in both packages, with room: the worst warm p95 is 276 ms for phrases against 500, and keyword's is 242 against 300. Most warm queries take 60 to 150 ms.
- The flat scan misses every target, at about 5 s p95. It reads all 100,000 vectors from S3 on every query, some 840 GETs, and more memory doesn't help, since LanceDB caches only indexes and metadata. So Duva needs the vector index.
- The index's recall@20 against the flat scan is 0.59 for vector queries (0.30 to 0.90 per query) and 0.80 for hybrid ones, at LanceDB's defaults: no refine and its default number of partitions probed. That needs tuning before semantic search ships.
- Cold sits at the 3 s line below 10,240 MB. The arm64 image's p95 was 2.5 to 2.8 s at 1,769 MB, but 3.5 s for keyword queries at 3,538 MB, where a few inits took 1.6 s, and 3.5 s again for keyword at 1,769 MB in the second cold run. The x64 zip's was 3.1 to 3.4 s at 1,769 MB in both runs, and 2.9 to 3.1 s at 3,538 MB. At 10,240 MB both pass: the image at 2.0 to 2.2 s, the zip at 2.4 to 2.7 s.
- Init is 0.6 to 0.9 s of a cold query. Most of the rest is opening the table: the warm-first numbers show that opening it costs about 1 s even in a warm environment, and 0.8 s at 10,240 MB. A search warm-up when someone opens the app would hide it.
- Seen by the caller, the zip's cold starts took about 620 ms more than init plus the handler, and the image's about 160 ms. A warm round trip from here adds about 30 ms.
- A cold hybrid query makes 430 to 620 S3 requests, more than twice a warm-first one, though both start with empty caches. The run doesn't show why.
- 1,769 MB is enough memory. Its environments peaked at 1.25 GB, and the caches held at most 53 MB, so their sizes don't bind.
- Every warm indexed query makes 12 to 27 GETs, at about $0.0000004 each. The table has 50 fragments, and a compacted one would likely need fewer.

Caveats:

- Warm-first drops the environment's LanceDB session, so it also opens new connections to S3. An environment serving several mailboxes would keep those, so warm-first is somewhat pessimistic.
- Cold starts came 10 at a time, all reading the same table.
- #18's writes ran in the same bucket, on tables of their own, until 22:20 UTC, so they overlapped the cold queries at 1,769 MB. The second cold run at 1,769 MB, on 2026-10-04 at 00:34 UTC with nothing else running, gave the zip 3.2 to 3.4 s again, and the image 2.5 to 2.9 s but 3.5 s for keyword.
- One phrase query has no hits on purpose: its filter leaves out the 4 messages that have it.
- The run cost about $2.30: $0.94 for Lambda and $1.34 for 3.0 million S3 GETs, mostly from the flat scans.

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

## #19: the embedding model

Titan Text Embeddings V2 at 1,024 dimensions, the size the module already uses. Raw numbers in `results/19-quality.json` and `results/19-latency.json`.

Cohere Embed v4 (`eu.cohere.embed-v4:0`), the ticket's quality reference, is unmeasured. In account 925039213717 every AWS Marketplace agreement is terminated 10 to 20 seconds after it's accepted: 40 since February 2026, and Cohere's offer (offer-ptn4ciwufhvds) every 6 minutes or so from 21:14 UTC on 2026-10-03. So Bedrock refuses every Marketplace model, Claude included, with "Your AWS Marketplace subscription for this model cannot be completed at this time". Nicklas chose Titan without the reference, so the ticket's rule for a small Cohere lead doesn't apply.

How it measures:

- 300 questions in `harness/questions.json`: 260 on English Enron messages of at least 300 characters, and 40 on the generated Swedish mail. Amazon Nova 2 Lite wrote one question per message, told to use its own words and to name people by role. On average 25% of a question's words of four letters or more also appear in its message.
- Each question's target is ranked against all 100,000 messages by exact cosine similarity, with no vector index, so the numbers measure the model alone. Recall at 10 is the share of targets in the top ten, and MRR averages one over each target's rank.
- At 256 and 512 dimensions Titan returns the first components of its 1,024 vector, renormalized. So the harness cuts the benchmark table's vectors down instead of embedding again. Direct requests at each size agree to a cosine of 1.0, and so do the table's vectors against a fresh embedding.

Titan V2, eu-north-1, on 2026-10-04:

| Dimensions | Recall at 10 | MRR | MRR, English | MRR, Swedish | MRR against 1,024 (95% interval) | Vectors per 100k messages |
| --- | --- | --- | --- | --- | --- | --- |
| 256 | 0.453 | 0.284 | 0.312 | 0.101 | -0.060 (-0.087 to -0.034) | 102 MB |
| 512 | 0.490 | 0.326 | 0.355 | 0.133 | -0.018 (-0.035 to -0.003) | 205 MB |
| 1,024 | 0.500 | 0.344 | 0.376 | 0.134 | | 410 MB |

- The pick: 1,024. 512 ranks measurably worse, with an MRR 0.018 lower whose interval stays below zero, though its recall at 10 is within noise (-0.010, from -0.037 to +0.013). It would save 205 MB per 100k messages, about half a cent a month at S3 Standard's $0.023 per GB in eu-north-1. 256 is clearly worse. A table at 1,024 can still be cut to 512 later without embedding again, if #17 finds the vector index's size or speed needs it.
- Embedding costs the same at every size: 261 tokens a message, $0.0000055 a message, $0.55 per 100k.
- What #19 spent: $0.15 writing the questions (two runs of Nova 2 Lite), under $0.01 embedding questions and checks with Titan, and about $0.05 of S3 egress reading the table once. It reused the table's Titan vectors, so the whole spike stands at about $1.50 of its $25.
- Query embedding from Lambda (`nodejs24.x`, x64, 1,769 MB), timed in the handler, 300 questions per size: warm p50 54 to 63 ms and p95 111 to 121 ms. The first request in a new environment, 10 per size: p50 160 to 168 ms. Size makes no difference.

Open risk for #20: Swedish MRR is far below English, 0.13 against 0.38. The Swedish mail is generated from a few sentences per topic, so many messages answer each Swedish question about equally well, and it's unclear whether the gap is Titan's or the data's. Real Swedish mail would settle it.

## #62: the vector index, and hybrid search as Duva runs it

LanceDB 0.39.0, eu-north-1, 2026-10-06. Raw numbers in `results/62-recall.json`, `results/62-mailbox.json` and `results/62-latency.json`.

**Recall.** `harness/recall.ts` loads the 100k mailbox's Titan vectors into a table on local disk, in 50 fragments as the benchmark's, and asks each index for the top 20 of #19's 300 questions and #17's 15 meanings. Recall is the share of a flat scan's top 20 it finds. Labels are drawn in the benchmark's shares, so a search can leave out Spam and Trash (8.1%) or keep only Travel (1.8%).

| Index | Search | Recall, none / not Spam or Trash / Travel | Built in |
| --- | --- | --- | ---: |
| IVF_PQ at defaults | defaults | 0.50 / 0.51 / 0.47 | 47 s |
| IVF_PQ at defaults | refine factor 10 | 0.87 / 0.87 / 0.88 | |
| IVF_PQ, 128 subvectors | refine factor 5 | 0.93 / 0.93 / 0.92 | 87 s |
| IVF_PQ, 256 subvectors | refine factor 2 | 0.97 / 0.97 / 0.97 | 294 s |
| IVF_HNSW_SQ | ef 100 | 0.94 / 0.95 / 0.98, and 0 for some queries | 19 s |
| **IVF_RQ** | **refine factor 5** | **0.98 / 0.98 / 0.98** | **0.8 s** |

- Probing 40 partitions instead of LanceDB's 20 changed IVF_PQ by nothing and IVF_RQ by 0.01, so what loses neighbours is quantization, which refining from the full vectors makes up.
- Duva ships IVF_RQ with a refine factor of 5. Built on S3 in the benchmark table it takes 14.6 MB for 100k messages, and its six check queries found all of a flat scan's top 10.
- Built again on the same 100k vectors, on local disk, IVF_RQ takes 0.9 s on 16 cores and 5.8 s at about 600 MB on one core, as Duva's indexer has.

**Hybrid search.** LanceDB's own hybrid search scales each side's distances and scores to between 0 and 1 before its reranker sees them, so it can't tell a near meaning from a far one. Duva runs the words and the meaning as two searches of the table at once, and fuses them by RRF itself. The spike's module does the same now, so the benchmark measures that.

**Latency,** with `benchmark --shipped`: the x64 zip at 10,240 MB, the benchmark mailbox built again with IVF_RQ (embedding $0.55), the same query set. Milliseconds, inside the Lambda, cold including init.

| Query | Target | Cold p50 / p95 | Cold round trip p95 | Warm-first p95 | Warm p50 / p95 | #17's warm p95, cold p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| keyword | 300 warm | 2,452 / 2,566 | 3,232 | 879 | 75 / 186 | 177, 2,534 |
| phrase | 500 warm | 2,385 / 2,569 | 3,173 | 907 | 61 / 171 | 166, 2,567 |
| vector | 500 warm | 2,516 / 2,650 | 3,239 | 954 | 184 / 241 | 202, 2,403 |
| hybrid | 800 warm | 2,596 / 2,698 | 3,304 | 934 | 179 / 213 | 193, 2,689 |

- Every target holds: cold under 3,000 ms, by 0.30 s at worst, as in #17. Seen by the caller, cold takes 3.2 to 3.3 s, also as in #17.
- Vector queries take about 40 ms more than with IVF_PQ at its defaults when warm, and 0.25 s more at cold p95. That's the refining, which reads the 100 nearest's full vectors.
- This measures the spike's module, which has Duva's index, refining and fusion but not its cut of far meanings, its definite Swedish forms or its 1,000-message vector index threshold. The real run measures Duva's own search Lambda.


## #67: searches translated into the search languages

LanceDB 0.39.0, eu-north-1, 2026-10-06. Raw numbers in `results/67-cutoffs.json`, `results/67-mailbox.json` and `results/67-latency.json`.

**Cutoffs.** On Duva's evaluation set, 72 made-up messages in English, Swedish and Danish on 20 subjects and 75 questions in the three, Titan puts a word and its match in another language about as far apart as unrelated mail, so no cutoff finds one without the other. Translating each search with Nova Lite into every search language does: with English and Swedish, Swedish questions find 0.68 of the English mail they ask for, against 0.22, with no more unrelated results. `harness/cutoffs.ts` has every setting tried, and `packages/api/src/lancedb-search.ts` the table and the choice.

**Latency,** with `benchmark --shipped`: as #62's, plus `translated`, Duva's search as its words give it, the same words searched as words and as a meaning and translated into three languages at once. The spike's module translates as Duva's does, with Nova Lite in eu-north-1. Milliseconds, inside the Lambda, cold including init.

| Query | Target | Cold p50 / p95 | Cold round trip p95 | Warm-first p95 | Warm p50 / p95 | #62's warm p95, cold p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| keyword | 300 warm | 2,470 / 3,896 | 4,469 | 869 | 74 / 167 | 186, 2,566 |
| phrase | 500 warm | 2,443 / 2,567 | 3,243 | 935 | 61 / 155 | 171, 2,569 |
| vector | 500 warm | 2,514 / 2,585 | 3,228 | 983 | 182 / 212 | 241, 2,650 |
| hybrid | 800 warm | 2,557 / 2,732 | 3,334 | 957 | 182 / 219 | 213, 2,698 |
| translated | 800 warm | 2,718 / 3,002 | 3,645 | 1,043 | 515 / 740 | |

- A translated search holds its warm target, 740 ms against 800, and misses the cold one by 2 ms: 3,002 against 3,000. Its caller sees 3.6 s cold.
- Translating adds about 0.3 s at warm p50 and 0.5 s at warm p95: Nova Lite's answer, then the translation's embedding and searches, which wait for it.
- Keyword cold missed too, at 3,896 ms, from four slow starts in one batch of ten (3.2 to 3.9 s), where the other 26 took 2.1 to 2.7 s. A keyword search isn't translated and its code didn't change since #62's run, where it was 2,566.
- Titan failed two runs of the mailbox's 100k embeddings, once with ModelErrorException and once with an answer without a body, neither of which the SDK retries. The harness's embedder now tries a request again up to five times.

S3 Vectors was measured against the same mailbox, after the spike, for `docs/research/s3-vectors.md`. `harness/s3vectors/probe.mjs` makes its own vector bucket, role and Lambda, needs the exported vectors and the AWS CLI 2.37 or newer, and `all` deletes what it made even if a step fails. `harness/keyword/` has the keyword engines measured beside it, on a laptop:

```sh
node harness/s3vectors/probe.mjs all   # recall, latency and freshness, into results/s3vectors-*.json (about 30 minutes, under $1)
```
