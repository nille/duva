# Would Amazon S3 Vectors be a smarter search engine for Duva?

Researched and measured on 2026-10-09, after Nicklas asked whether S3 Vectors would be a smarter architecture than LanceDB (ADR-0007). S3 Vectors was measured in account 925039213717 on the search spike's benchmark mailbox, from a Lambda in eu-north-1, with `spikes/search/harness/s3vectors/probe.mjs`. Everything it created was deleted the same day, and it cost under $1. The keyword half, which S3 Vectors doesn't do, is in `s3-vectors-keyword-engines.md`.

## Short answer

No, not today. S3 Vectors is a better home for the vectors than LanceDB: faster, cheaper, consistent at once, and with no function to size or index to tune. But it searches only by meaning. Duva's search is also a search by words, phrases and stems, so S3 Vectors would split one store into two. Three things decide against it:

1. **Its recall is lower on a large mailbox, and nothing raises it.** At 100,000 messages it found 0.90 of a flat scan's top 20, and 0.82 under a narrow label. LanceDB, as Duva tunes it, finds 0.98. On a 2,000-message mailbox S3 Vectors finds 0.99 or more.
2. **The keyword half still needs an engine of its own.** That engine would need files in S3, a single writer per mailbox, a commit protocol, compaction and erasure. That is the work LanceDB does for Duva now, and Duva would also have to keep the two stores consistent.
3. **There's no documented bound on when a deleted vector leaves storage.** An embedding can be turned back into much of its text, so Duva couldn't promise that erased mail's text leaves S3 within 24 hours (ADR-0007, #63).

Revisit if:
- S3 Vectors gains sparse vectors or BM25;
- AWS documents when deleted vectors leave storage;
- LanceDB's 10,240 MB function or its cold starts start to hurt.

The next step then is a spike of Tantivy on S3 plus S3 Vectors behind `search-engine.ts`, against the behavior suite and #67's evaluation, at 100,000 and 500,000 messages.

## What was measured

- **The mailbox:** 100,000 Titan Text Embeddings V2 vectors, 1,024 dimensions, from the spike's benchmark mailbox (`node harness/models.ts export`).
- **The labels:** drawn from the same seeded generator as `harness/recall.ts` (#62): Spam 3%, Trash 5.1%, Travel 1.8%, the rest Inbox. Each vector carries its labels as filterable metadata.
- **The queries:** #62's 315, each asking for the top 20, under three filters: none, not Spam or Trash, and label Travel.
- **The truth:** an exact cosine scan computed by the probe, as #62's flat scan was.
- **The index:** one S3 Vectors index, cosine, float32. A bucket created after 2026-09-30 makes `ENHANCED` indexes, which apply the filter before the search. `CLASSIC` queries aren't allowed on an `ENHANCED` index.
- **The Lambda:** Python 3.13, x86_64, 1,024 MB, calling QueryVectors with boto3. Its times are the call alone, from inside eu-north-1.

## Recall of the top 20

| Filter | S3 Vectors, 100,000 | worst query | S3 Vectors, 2,000 | LanceDB IVF_RQ, refine 5 (#62) | worst query |
| --- | ---: | ---: | ---: | ---: | ---: |
| none | 0.90 | 0.35 | 0.99 | 0.98 | 0.45 |
| not Spam or Trash | 0.90 | 0.35 | 0.99 | 0.98 | |
| label Travel | 0.82 | 0.40 | 1.00 | 0.98 | 0.75 |

- **Asking for 100 results and keeping the closest 20 found exactly the same.** So the misses aren't a matter of ranking, and the index has no setting like LanceDB's refine factor or nprobes.
- **Filters were exact.** No result broke its filter, and every query returned all 20, the narrow label's included.
- **Most mailboxes are small,** where S3 Vectors is close to exact. The gap shows on large ones, where search matters most.

## Speed, freshness and writes

| | S3 Vectors | LanceDB today (spike, #62, #67) |
| --- | ---: | ---: |
| Warm query p50 / p95 | 64 / 69 ms, the same for every filter, with or without metadata, top 20 or 100 | 61 to 150 / 170 to 240 ms |
| Cold: init / first query, p50 / p95 | 646 / 878 ms (Python with boto3 and 6.8 MB of queries) / 89 / 106 ms, over 25 new environments | 2,400 to 2,700 ms p95 in all, at 10,240 MB |
| New mail searchable | at the first query after PutVectors answered, in each of 10 trials (PutVectors 150 to 255 ms) | 0.2 s |
| Deleted mail gone from search | at the first query after DeleteVectors answered, in each of 10 trials. GetVectors finds nothing either | at once from search, from S3 within 24 hours |
| Load | 100,000 vectors in 214 s from outside AWS through the CLI, 500 per PutVectors, 6 at once | |

The cold numbers are the probe's Python. Duva's search Lambda would be Node with the S3 Vectors client, plus Titan for the query, so its cold search is an estimate: about 1 s, against LanceDB's 2.6 s.

## Cost in eu-north-1 (Price List API, 2026-10-09)

| | Price |
| --- | --- |
| Storage | $0.06 per GB-month |
| Writes | $0.20 per GB put |
| Queries | $0.0025 per 1,000, plus $0.0039 per TB processed for an index under 100,000 vectors, and $0.01 per GB returned |
| The bucket | free |

A 100,000-message mailbox is about 0.42 GB of vectors. That's $0.025 a month to store, and $0.08 to write once. With 1,000 searches a day, queries come to about $0.13 a month. All in, about $0.15 a month, against LanceDB's 10,240 MB function at about $2.20. Both are close to nothing next to ADR-0006's budget, so cost doesn't decide this.

## What S3 Vectors can't do that Duva's search needs

- **Words, phrases and stems.** It has no BM25, phrases or stemming, and no sparse vectors. Since general availability in December 2025 it has gained:
  - pre-filtering;
  - `$startsWith`;
  - 10,000 results a query;
  - a lower price for very large indexes.

  None of those adds words. AWS's own hybrid pattern puts an OpenSearch domain in front of it, which runs all the time. Bedrock Knowledge Bases on S3 Vectors search by meaning only.
- **Part of an address.** The filters have no substring operator, so `from:` on part of an address has to go to the keyword engine.
- **A label change without the vector.** There's no metadata-only update, so adding or removing a label rewrites the whole vector, with its 4 KB.
- **Erasure with a bound.** Deletion is by key, and AWS documents no time by which a deleted vector leaves storage.

## The keyword half, in brief

From `s3-vectors-keyword-engines.md`, measured on a laptop on 100,000 Enron messages, so not Lambda's times:

| Engine | Index | Notes |
| --- | --- | --- |
| Tantivy, through `@oxdev03/node-tantivy-binding` | 45.5 MB, 11 ms p95 | Snowball stemmers for Swedish, Danish and English. A binding with 15 GitHub stars, or Rust in the monorepo |
| SQLite FTS5, built into Node 24 | 91 MB, 41 ms p95, 230 to 400 ms on common words | No custom tokenizer, so stemming happens in JS. Its `secure-delete` erases text from the file at once |
| MiniSearch, Orama, FlexSearch | ruled out | Too slow, or too much memory at 100,000 messages |

Either engine's files come from S3 whole on a cold start, about 0.5 to 1.4 s at 100,000 messages and growing with the mailbox. LanceDB reads only the parts a search needs.

So Duva would own:
- a commit pointer with conditional writes;
- syncing segment files to /tmp, and collecting old ones;
- writes to two stores for every change, consistent with each other;
- a merge that erases from the keyword files;
- an S3 Vectors index per mailbox;
- a stand-in for S3 Vectors in the harness, which can't reproduce its recall.

The search Lambda would shrink from 10,240 MB to about 1,769 MB, and the vector index would need no tuning.

## A side finding

The research found that OpenSearch Serverless's newer generation scales to zero while idle. That would undo ADR-0007's reason for leaving it out, about $190 to $370 a month. It reports a first request after idle of 10 to 30 s, though, and mail trickling in keeps its indexing awake, so it still doesn't fit. Neither claim was checked here.
