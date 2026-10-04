# Search spike: the report

The spike in #2 asked one question: does LanceDB on S3 meet Duva's search targets on a 100k-message mailbox, queried from Lambda in eu-north-1? This brings together every number from #15 to #19 and compares each with spec #2's targets. The README has each ticket's method and detail, and `results/` the raw data.

**The answer.** With the vector index, every target holds at 10,240 MB, in both packages. At 1,769 and 3,538 MB every target holds except cold p95, which misses 3 s by 0.1 to 0.5 s. Read literally, the ticket's rules then accept ADR-0007 at 10,240 MB. But that rests on judgment calls the spike shouldn't make, so ADR-0007 stays proposed until Nicklas decides (see [The decision](#the-decision)).

## What was measured

| | |
| --- | --- |
| LanceDB | `@lancedb/lancedb` 0.39.0, the newest stable release on 2026-10-02, embedded through its Node SDK. Commits rely on S3 conditional writes, with no commit store |
| Lambda | `nodejs24.x`, eu-north-1, at 1,769 MB (one vCPU), 3,538 MB and 10,240 MB (six) |
| Packages | x64 zip: 214.9 MB unzipped with the Bedrock client, about 47 MB under the 262,144,000-byte limit. arm64 container image: 400.7 MB of code on the base image, 258.7 MB compressed in ECR. The arm64 native module alone is 389 MB, so arm64 can't be a zip |
| Mailbox | 100,000 messages: 97,000 from the Enron corpus and 3,000 generated Swedish ones, in 88,445 threads, with labels in realistic shares (Inbox 10.9%, archived 81.0%, Spam 3.0%, Trash 5.1%, five labels of the mailbox's own on top). One table on S3, as loaded in 50 fragments |
| Indexes | full-text (BM25, positions and stop words kept) per language, English and Swedish, BTREE on date and sender, BITMAP on has-attachment, LABEL_LIST on labels, IVF_PQ with cosine distance at LanceDB's defaults |
| Embedding | Titan Text Embeddings V2, 1,024 dimensions, eu-north-1. One vector per message from its subject and the first 2,000 characters of its body |
| Readers | `readConsistencyInterval` 0, index cache a quarter of the function's memory, metadata cache a sixteenth |
| Queries | one fixed set: 44 keyword (single words, word pairs, names), 22 phrases from the corpus, 20 filtered vector and 20 hybrid, each asking for 20 hits. Filters rotate through label, sender, date and attachment, and nearly every query leaves out Spam and Trash |
| When | 2026-10-03 and 2026-10-04 |

Latency is inside the Lambda, from the handler receiving the query to it returning ranked hits, query embedding included, as spec #2 defines it. Cold adds the environment's init duration. Round trip is what this machine saw through Lambda's Invoke API, and API Gateway would add its own on top.

## Each target, pass or fail

The worst p95 over keyword, phrase, filtered vector and hybrid, with the vector index, in milliseconds. Cold at 1,769 MB ran twice (`results/17-cold-recheck.json`), and this shows the worse run.

| Target | x64 zip 1,769 MB | 3,538 MB | 10,240 MB | arm64 image 1,769 MB | 3,538 MB | 10,240 MB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Warm keyword under 300 | 242 pass | 227 pass | 177 pass | 241 pass | 240 pass | 190 pass |
| Warm phrase under 500 | 276 pass | 267 pass | 166 pass | 270 pass | 276 pass | 157 pass |
| Warm filtered vector under 500 | 199 pass | 191 pass | 202 pass | 192 pass | 208 pass | 184 pass |
| Warm hybrid under 800 | 202 pass | 231 pass | 193 pass | 194 pass | 227 pass | 194 pass |
| Cold, any type, under 3,000 | 3,407 **fail** | 3,102 **fail** | 2,689 pass | 3,529 **fail** | 3,517 **fail** | 2,223 pass |
| New mail searchable within 60 s | 0.2 s pass | | | | | |

Freshness was measured on the x64 zip at 1,769 MB only (#18): a warm reader found every new message on its first search after the commit, 129 ms p50 and 142 ms p95 in the writer's process, 176 ms p50 and 199 ms p95 from another warm Lambda. That is one search's time, since readers check for new versions on every search, at one LIST each. It doesn't depend on memory or package.

How the cold misses look:

- **x64 zip at 1,769 MB** misses for every query type, in both runs: 3,131 to 3,407 ms p95, then 3,190 to 3,357. That is 0.13 to 0.41 s over.
- **x64 zip at 3,538 MB** misses for phrases, 3,102 ms. Keyword (2,986) and hybrid (2,991) pass by less than 15 ms.
- **arm64 image at 1,769 MB** passed in the first run (2,493 to 2,763) and missed in the second, for keyword only, at 3,529. **At 3,538 MB** it missed for keyword only, at 3,517. Both times a few environments took 1.1 to 1.6 s to init (init p95 1,104 and 1,588 ms, against a p50 of about 600 to 660).
- **At 10,240 MB** both pass: the arm64 image at 1,962 to 2,223 ms, the x64 zip at 2,403 to 2,689, so the zip has 0.31 s to spare.
- Seen by the caller, a cold start of the zip takes about 620 ms longer than init plus the handler, and of the image about 160 ms. So the zip's cold round trip at 10,240 MB is 3,077 to 3,320 ms p95, over 3 s, while the image's is 2,107 to 2,429. The spec's target is inside the Lambda, so the zip passes it, but a human feels the round trip.
- Each cold p95 comes from 30 environments started 10 at a time, so it is about the second-slowest of 30. One slow init moves it by hundreds of milliseconds, as the two runs at 1,769 MB show.

Without the vector index, as a flat scan, filtered vector and hybrid queries take 4.3 to 6.0 s p95 in every condition, at every size, in both packages, and miss every target. They read all 100,000 vectors from S3 on each query, some 840 GETs, and LanceDB caches only indexes and metadata. So Duva needs the vector index.

## Raw numbers

Milliseconds, with the vector index (`results/17-latency.json`, 2026-10-03 22:10 to 2026-10-04 00:16 UTC). Cold is 30 new environments per query type, warm-first and warm 100 queries each. Warm-first is a warm environment's first query on the mailbox, so it opens the table. Warm repeats queries with the table open.

| Package | Memory MB | Query | Init p50 | Cold p50 / p95 / p99 | Warm-first p50 / p95 / p99 | Warm p50 / p95 / p99 | Cold round trip p95 |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: |
| x64 zip | 1,769 | keyword | 751 | 2,826 / 3,215 / 3,257 | 1,100 / 1,508 / 1,623 | 69 / 242 / 345 | 3,827 |
| x64 zip | 1,769 | phrase | 856 | 2,997 / 3,407 / 3,508 | 1,383 / 1,579 / 1,645 | 61 / 276 / 302 | 4,026 |
| x64 zip | 1,769 | filtered vector | 842 | 2,855 / 3,148 / 3,184 | 1,095 / 1,363 / 1,383 | 145 / 199 / 251 | 3,744 |
| x64 zip | 1,769 | hybrid | 840 | 2,895 / 3,131 / 3,282 | 1,057 / 1,333 / 1,356 | 150 / 202 / 274 | 3,721 |
| x64 zip | 3,538 | keyword | 765 | 2,537 / 2,986 / 3,126 | 1,090 / 1,531 / 1,637 | 67 / 227 / 330 | 3,587 |
| x64 zip | 3,538 | phrase | 773 | 2,820 / 3,102 / 3,161 | 1,327 / 1,567 / 1,621 | 62 / 267 / 304 | 3,721 |
| x64 zip | 3,538 | filtered vector | 773 | 2,535 / 2,882 / 2,891 | 1,019 / 1,284 / 1,331 | 141 / 191 / 229 | 3,518 |
| x64 zip | 3,538 | hybrid | 785 | 2,660 / 2,991 / 3,107 | 999 / 1,266 / 1,353 | 149 / 231 / 1,099 | 3,617 |
| x64 zip | 10,240 | keyword | 786 | 2,350 / 2,534 / 2,724 | 817 / 890 / 915 | 65 / 177 / 238 | 3,240 |
| x64 zip | 10,240 | phrase | 778 | 2,400 / 2,567 / 2,573 | 878 / 935 / 951 | 62 / 166 / 186 | 3,146 |
| x64 zip | 10,240 | filtered vector | 774 | 2,323 / 2,403 / 2,496 | 752 / 821 / 852 | 144 / 202 / 249 | 3,077 |
| x64 zip | 10,240 | hybrid | 788 | 2,507 / 2,689 / 2,778 | 819 / 880 / 987 | 152 / 193 / 232 | 3,320 |
| arm64 image | 1,769 | keyword | 673 | 2,187 / 2,641 / 2,824 | 1,069 / 1,437 / 1,498 | 71 / 241 / 343 | 2,850 |
| arm64 image | 1,769 | phrase | 650 | 2,274 / 2,763 / 2,956 | 1,340 / 1,575 / 1,606 | 61 / 270 / 318 | 2,926 |
| arm64 image | 1,769 | filtered vector | 653 | 2,045 / 2,594 / 2,639 | 1,062 / 1,317 / 1,359 | 145 / 192 / 385 | 2,794 |
| arm64 image | 1,769 | hybrid | 662 | 1,994 / 2,493 / 2,533 | 1,004 / 1,290 / 1,327 | 147 / 194 / 226 | 2,658 |
| arm64 image | 3,538 | keyword | 602 | 1,904 / 3,517 / 4,250 | 1,061 / 1,456 / 1,535 | 73 / 240 / 358 | 3,731 |
| arm64 image | 3,538 | phrase | 601 | 2,167 / 2,634 / 2,657 | 1,332 / 1,535 / 1,587 | 62 / 276 / 309 | 2,789 |
| arm64 image | 3,538 | filtered vector | 577 | 2,010 / 2,413 / 2,489 | 997 / 1,296 / 1,342 | 135 / 208 / 306 | 2,569 |
| arm64 image | 3,538 | hybrid | 605 | 2,061 / 2,461 / 2,589 | 987 / 1,261 / 1,312 | 142 / 227 / 255 | 2,625 |
| arm64 image | 10,240 | keyword | 592 | 1,667 / 2,223 / 2,300 | 812 / 880 / 934 | 76 / 190 / 251 | 2,429 |
| arm64 image | 10,240 | phrase | 586 | 1,706 / 2,139 / 3,276 | 875 / 955 / 1,089 | 65 / 157 / 169 | 2,386 |
| arm64 image | 10,240 | filtered vector | 590 | 1,607 / 1,962 / 2,010 | 750 / 825 / 887 | 149 / 184 / 204 | 2,107 |
| arm64 image | 10,240 | hybrid | 585 | 1,695 / 2,017 / 2,152 | 807 / 904 / 933 | 153 / 194 / 205 | 2,154 |

Cold at 1,769 MB again, on 2026-10-04 at 00:34 UTC with nothing else in the bucket, because #18's writes overlapped the first run (`results/17-cold-recheck.json`):

| Package | Query | Init p50 | Cold p50 / p95 / p99 | Cold round trip p95 |
| --- | --- | ---: | ---: | ---: |
| x64 zip | keyword | 862 | 2,777 / 3,246 / 3,333 | 3,845 |
| x64 zip | phrase | 848 | 3,083 / 3,357 / 3,786 | 4,017 |
| x64 zip | filtered vector | 851 | 2,832 / 3,190 / 3,203 | 3,791 |
| x64 zip | hybrid | 847 | 2,919 / 3,273 / 3,954 | 3,898 |
| arm64 image | keyword | 659 | 2,164 / 3,529 / 3,788 | 3,812 |
| arm64 image | phrase | 647 | 2,421 / 2,935 / 4,139 | 3,128 |
| arm64 image | filtered vector | 645 | 2,166 / 2,568 / 2,802 | 2,887 |
| arm64 image | hybrid | 632 | 2,181 / 2,543 / 3,860 | 2,740 |

Nothing failed and nothing was excluded in either run. The environments peaked at 1.25 GB at 1,769 MB, and at 1.49 and 1.54 GB at the larger sizes, where they hold more. The caches held at most 53 MB, so 1,769 MB has room.

Init is 0.6 to 0.9 s of a cold query, and most of the rest is opening the table: warm-first, which opens it in a warm environment, takes 1.3 to 1.6 s p95 below 10,240 MB and 0.8 to 1.0 s at 10,240 MB.

## Costs

eu-north-1 on-demand prices from the AWS Price List: S3 GET $0.0004 and PUT or LIST $0.005 per 1,000, S3 Standard $0.023 per GB-month, Lambda $0.0000166667 per GB-second on x64 and $0.0000133334 on arm64, Titan V2 $0.000021 per 1,000 input tokens.

**The table on S3:** 598 MB in 194 objects for 100,000 messages, 508 MB of data and 90 MB of indexes. The vectors take 410 MB of it. Idle, that's about $0.014 a month per 100k messages, and S3 is all search costs while nobody searches.

**S3 requests per query,** counted by S3 itself, ranges over both packages and all sizes:

| Query | Cold | Warm-first | Warm |
| --- | ---: | ---: | ---: |
| Keyword | 89-122 | 114-143 | 16-17 |
| Phrase | 203-220 | 219-265 | 17-18 |
| Filtered vector | 135-160 | 86-140 | 12-13 |
| Hybrid | 427-617 | 187-228 | 25-27 |

All but one of them are GETs. A cold hybrid query makes two to three times the requests of a warm-first one, and the run doesn't show why.

**A search, all in,** the mean over the query types, from the samples' latency (init included when cold, since Lambda bills it) and S3's requests:

| | Warm | Warm-first | Cold |
| --- | ---: | ---: | ---: |
| x64 zip, 1,769 MB | $0.000011 | $0.00010 | $0.00017 |
| arm64 image, 1,769 MB | $0.000010 | $0.00009 | $0.00016 |
| x64 zip, 10,240 MB | $0.000027 | $0.00021 | $0.00049 |
| arm64 image, 10,240 MB | $0.000024 | $0.00018 | $0.00034 |

So 10,240 MB costs about two to three times as much per search as 1,769 MB, and both are fractions of a cent. 1,000 searches a day, one in ten of them cold, would cost about $0.80 a month on the zip at 1,769 MB and $2.20 at 10,240 MB, or $0.75 and $1.70 on the image. Embedding the query adds about $0.0000002.

**Embedding a 100k-message mailbox:** 100,000 Titan requests, 26.1M input tokens, $0.55, in 14.7 minutes at 64 concurrent requests from this machine without throttling. Writing and indexing took the load to 17 minutes. Building all nine indexes after the last write took 73 s, IVF_PQ alone 58 s.

**Each new message:** embedding is $0.0000055, about 261 tokens. Written alone from a warm Lambda, a message also costs $0.000047 of S3 (a commit is 3 PUTs, 6 LISTs and 4 GETs, whatever it carries) and $0.000012 of Lambda, so about $0.00006 in all. In batches of 100 the S3 and Lambda share falls to under $0.000001, and embedding is most of it. A label change costs about $0.000047 and a removal $0.000034.

**Maintenance:** `optimize()` on 100k messages takes 18 to 31 s and at most 1.1 GB, $0.0005 to $0.002 a run at 1,769 MB.

## The embedding model

Titan Text Embeddings V2 at 1,024 dimensions, in eu-north-1, so mail never leaves Stockholm (#19). That is the model and dimension #17 measured latency with, so nothing needed re-running.

| Dimensions | Recall at 10 | MRR | MRR, English | MRR, Swedish | MRR against 1,024 (95% interval) | Vectors per 100k messages |
| --- | --- | --- | --- | --- | --- | --- |
| 256 | 0.453 | 0.284 | 0.312 | 0.101 | -0.060 (-0.087 to -0.034) | 102 MB |
| 512 | 0.490 | 0.326 | 0.355 | 0.133 | -0.018 (-0.035 to -0.003) | 205 MB |
| 1,024 | 0.500 | 0.344 | 0.376 | 0.134 | | 410 MB |

- 300 questions, 260 English and 40 Swedish, written by Amazon Nova 2 Lite, each ranked by exact cosine against all 100,000 messages, so the numbers are the model's alone.
- 512 ranks measurably worse on MRR. Titan's smaller sizes are the renormalized prefix of its 1,024 vector, so a table can be cut to 512 later without embedding again.
- Query embedding from Lambda: 54 to 63 ms p50 and 111 to 121 ms p95 warm, about 165 ms p50 on a new environment's first request. It is inside every vector and hybrid number above.
- Cohere Embed v4, the quality reference, is unmeasured: the account terminates every AWS Marketplace agreement seconds after it's accepted, and Nicklas chose Titan without the reference.

## The write path and the maintenance schedule

From #18, which measured on copies of the benchmark table:

- **One writer per mailbox,** such as an SQS FIFO queue with the mailbox as the message group, feeding a Lambda that writes what has arrived in one `add()`. A commit costs the same whatever it carries, and one writer has no commit conflicts. Five concurrent writers lost nothing, but 29 of 200 commits lost races, commit p95 rose from 375 ms to 1.9 s, and in an earlier run, which the results don't hold, one commit took 28.8 s.
- **Retry a failed write, and make `add()` idempotent on the message id,** with LanceDB's merge-insert for example, since a queue can redeliver a write that committed. Maintenance during writes made 3 writes and a label change fail once with "Too many concurrent writers" after about 30 s; each failed attempt left nothing behind and the retry succeeded. Idempotent `add()` is unmeasured.
- **Batch label changes and removals,** so a thread's change is one commit. A label change rewrites the whole row, vector included, into a new fragment.
- **Readers keep `readConsistencyInterval` at 0,** so new mail is searchable on the next search.
- **The mailbox's writer runs `optimize()` itself, between writes,** after about 20 writes or a few minutes after the last, whichever comes first. Unindexed fragments slow searches: the keyword search that leaves out Spam and Trash takes 55 ms fully indexed, 206 ms after 50 single writes and 374 ms after 150, past the 300 ms target.
- **Maintenance runs at 1,769 MB with a 15-minute timeout,** and keeps old versions for a few minutes rather than LanceDB's 7 days, so a search still reading the version before it finds its files.

## Open points

None of these is a target, and none fails one. Each needs an answer before search ships.

- **The vector index's recall.** IVF_PQ at LanceDB's defaults (no refine, the default partitions probed) finds 0.59 of a flat scan's top 20 for vector queries (0.30 to 0.90 per query), and 0.80 for hybrid. Tuning `nprobes` and `refineFactor`, or IVF_RQ, costs latency, but warm vector queries have about 300 ms to spare under their target. Cold has none below 10,240 MB.
- **Erasure.** A removed message's text stays in its S3 data file until compaction rewrites the fragment, which LanceDB does only past 10% of its rows deleted, and Node's `optimize()` in 0.39.0 can't lower that. In a mailbox of 100k messages in one large fragment, removed Spam and Trash text could stay on S3 indefinitely. Whether the full-text index keeps removed words is unknown.
- **Swedish.** Titan's MRR on Swedish questions is 0.13 against 0.38 on English. The Swedish mail is generated from a few sentences per topic, so many messages answer a question about equally well, and it's unclear whether the gap is Titan's or the data's. Real Swedish mail would settle it. Keyword search stems Swedish in columns of its own, and Snowball leaves the definite "-an" ("faktura" doesn't find "fakturan").
- **The native module's size.** ADR-0007's "about 200 MB" holds for x64 only: 214 MB there with Apache Arrow, 389 MB on arm64. So the arm64 image is the faster package, but needs an image in ECR, and Duva's deploy ships zips today.
- **The benchmark table is uncompacted,** in 50 fragments. A maintained mailbox is one or a few, which should need fewer S3 requests per query. Cold starts came 10 at a time on one table.
- **LanceDB is pre-1.0,** so `node harness/harness.ts benchmark <version>` re-runs all of this on a new release (see the README).
- **The crash** in lancedb/lancedb#4367 (a lowercase language name in the full-text index aborts Node) is avoided by writing `"English"` and `"Swedish"`, and a suite test builds the index in a child process to prove the process survives.

## The decision

The ticket's rules: ADR-0007 is accepted, with the model recorded, when every target holds, and superseded by the fallback (SQLite FTS5 files in S3 plus S3 Vectors) when one fails. If only the cold target misses, the report says by how much and whether a search warm-up when someone opens the app would hide it, and the ADR stays proposed until Nicklas decides.

What the numbers say, read against them:

- Spec #2 names no memory size or package for its targets. It asks for at least three sizes from 1,769 to 10,240 MB, both packages, and the cheapest size that meets the targets. That size is 10,240 MB, where every target holds in both packages.
- At 1,769 and 3,538 MB, only the cold target misses, by 0.13 to 0.41 s for the x64 zip and up to 0.53 s for the arm64 image.
- The x64 zip at 10,240 MB passes inside the Lambda, by 0.31 s, but its caller sees 3.1 to 3.3 s. Only the arm64 image at 10,240 MB stays under 3 s from the caller too, and Duva would have to build and push an image in each organization's account.

**Would a search warm-up when someone opens the app hide the cold miss?** For a human in the web app, mostly. When the app opens, it would send one search request that starts an environment and opens the mailbox's table, about 2 to 3.5 s. A human's first search usually comes some seconds later, and then lands on that warm environment with the table open: 157 to 276 ms p95 in every configuration, inside the warm targets. It hides warm-first too, 1.3 to 1.6 s p95, which no target covers but a human would feel. That is inferred from the warm numbers; the spike didn't measure a warm-up itself. It doesn't help:

- when the human searches before the warm-up finishes, who then waits for the rest of it;
- when two searches arrive at once, since Lambda starts a new environment for the second, or after Lambda has retired the warm environment, usually some minutes of idling;
- for agents and the CLI, which don't open the app, so an agent's first search stays cold;
- for free: each warm-up is a cold invocation, about $0.00017 at 1,769 MB.

Provisioned concurrency would hide every cold start, but it costs while idle, against ADR-0006.

Read literally, the rules point to accepting ADR-0007 at 10,240 MB, the cheapest size where every target holds. Three things make that a judgment call rather than a rule's outcome, so it goes to Nicklas:

- Whether targets met only at the largest size Lambda offers are what spec #2 meant. If they're meant at 1,769 or 3,538 MB, only cold misses, and the warm-up question above decides.
- Which package. The zip fits how `duva deploy` ships today but passes cold by 0.31 s, and its caller sees 3.1 to 3.3 s. The image passes from the caller too, but deploy would have to build it and push it to ECR in each organization's account.
- What 10,240 MB costs: two to three times as much per search, about $2 a month at 1,000 searches a day.

So ADR-0007 stays proposed. Its text is updated with the spike's findings, and records Titan V2 at 1,024 dimensions.

## What the spike cost

| Ticket | Cost |
| --- | --- |
| #15 packaging | under $0.50 |
| #16 the mailbox | about $0.80, of which $0.55 embedding |
| #17 latency | about $2.30: $0.94 Lambda, about $1.30 for 3.2 million S3 GETs, mostly flat scans |
| #18 writes | about $0.25 |
| #19 the model | about $0.20: $0.15 writing questions, the rest embedding and S3 egress |
| #20 | under $0.05: the stack idle from #16 until it was deleted (its 0.8 GB on S3 and 0.26 GB in ECR, well under a cent a day) and the suite run twice on S3 |
| The spike | **about $4.10 of its $25** |

These are the harness's own counts at the Price List's prices. Cost Explorer can't separate them, since the account runs other workloads in eu-north-1 and the `duva-search-spike` tag isn't a cost allocation tag.

Nothing of the spike is left in AWS. `node harness/harness.ts down` deleted the `duva-search-spike` stack on 2026-10-04 with its bucket, image repository, CodeBuild project, roles, log groups and four functions. The stacks of #18 and #19 were deleted in their own tickets. No stack, bucket, function, repository, log group, project or role named `duva-search-spike` remains in eu-north-1.
