# Keyword search beside Amazon S3 Vectors: would it be a smarter architecture for Duva?

The keyword half of `docs/research/s3-vectors.md`, which has the answer and S3 Vectors' own measurements.

Researched 2026-10-09. The question is whether Duva's search (ADR-0007: LanceDB 0.39 embedded in a 10,240 MB x64 Lambda zip, reading per-mailbox tables on S3) would be better split in two: Amazon S3 Vectors for meaning, and some other engine for words. S3 Vectors does dense vectors only, so most of this report is about the keyword half.

Labels used below: **[verified]** means read in a primary source or measured here. **[reported]** means a third party's measurement, not reproduced. **[estimate]** means my arithmetic from verified inputs. **[unverified]** means I couldn't confirm it.

## Answer in brief

- **S3 Vectors has no keyword search.** It has no sparse vectors, BM25, full-text or hybrid search, and no announcement since GA (Dec 2025) adds any. The post-GA launches were metadata pre-filtering (Sep 2026), 10,000 results per query, an 80% cut in query price for large indexes, and new regions. AWS's own hybrid patterns pair it with OpenSearch.
- **The vector half would get better.** You'd lose the IVF_RQ tuning, the 410 MB of vectors per 100k messages in LanceDB, and most of the reason for the 10,240 MB function. Cold queries take about 0.1 to 0.45 s **[reported]**.
- **The vector half would also get worse in four ways:**
  - Recall can't be tuned.
  - There is no metadata-only update, so every relabel or mark-read rewrites the whole vector.
  - It has no substring filter, and filterable metadata is capped at 2 KB.
  - There is **no documented bound on when deleted vectors physically leave storage**. That last one conflicts with Duva's promise that erased text leaves S3 within 24 hours, because embeddings can be inverted back into text.
- **For the keyword half, the best fit is Tantivy** (Rust, through a napi-rs binding), with its immutable segment files synced between S3 and /tmp. **The runner-up is SQLite FTS5 through Node 24's built-in `node:sqlite`**: it needs no native dependency and can erase at once with `secure-delete`, but its index is about twice the size and it has no Swedish or Danish stemmer built in. On the same 100k Enron messages, measured here:

| | Index | zstd | Query p95 |
| --- | ---: | ---: | ---: |
| Tantivy | 45.5 MB | 35.5 MB | 11 ms |
| FTS5, stemmed only | 91 MB | 45 MB | 41 ms |

  MiniSearch, Orama and FlexSearch are ruled out.
- **Overall, this is a lateral move, not a clear win.** The keyword engine still has to come from S3 on a cold start, and that is now a whole-index download that grows linearly with the mailbox. Duva would own much more plumbing than it does with LanceDB:
  - two stores to keep consistent
  - a segment-sync protocol
  - garbage collection
  - a native binding with 15 GitHub stars
  - a stand-in for S3 Vectors in tests, which can't reproduce its ANN quirks

  I'd only do it after a spike that runs the existing behavior suite and `harness benchmark` against Tantivy-on-S3 plus S3 Vectors, and after AWS answers in writing how long deleted vectors persist.

---

## 1. S3 Vectors and keyword, sparse or hybrid search

### What it supports natively (as of 2026-10-09)

**Dense float32 vectors only. [verified]**
- Each vector has 1 to 4,096 dimensions and a cosine or euclidean metric.
- Each vector carries metadata: up to 40 KB in total, of which up to 2 KB is filterable, with up to 10 non-filterable keys per index.
- The API has 21 operations: CreateIndex, CreateVectorBucket, DeleteIndex, DeleteVectorBucket, DeleteVectorBucketPolicy, DeleteVectors, GetIndex, GetVectorBucket, GetVectorBucketPolicy, GetVectors, ListIndexes, ListTagsForResource, ListVectorBuckets, ListVectors, PutVectorBucketDefaultIndexMode, PutVectorBucketPolicy, PutVectors, QueryVectors, TagResource, UntagResource and UpdateIndexMode.
- None of them does text, sparse vectors or a metadata-only update. Source: https://docs.aws.amazon.com/AmazonS3/latest/API/API_Operations_Amazon_S3_Vectors.html (fetched 2026-10-09).
- Limits: https://docs.aws.amazon.com/AmazonS3/latest/userguide/s3-vectors-limitations.html

AWS Prescriptive Guidance says it outright: "Hybrid search: ❌ No BM25 + vector" for S3 Vectors, against "✅ Native hybrid" for OpenSearch Serverless (https://docs.aws.amazon.com/prescriptive-guidance/latest/semantic-layer-agentic-ai-ontology-reasoning-virtual-knowledge-graph/technology-tradeoffs-alternatives.html).

Users say the same. On HN on 2025-10-22, one wrote that it "does not support keyword search and sparse vectors" (https://news.ycombinator.com/item?id=45665062). Ruggles, 2026-06-01, lists "no hybrid BM25, learning-to-rank, custom scoring" (https://darryl-ruggles.cloud/the-real-cost-of-vector-storage-s3-vectors-vs-opensearch-vs-pgvector-vs-pinecone/).

### Launches after GA (2025-12-02)

From the AWS What's New feed. None adds keyword, sparse or hybrid search **[verified]**.

| Date | What | Source |
| --- | --- | --- |
| 2025-12 | GA: 2B vectors per index, about 100 ms warm and under 1 s cold, top-K 100 | https://aws.amazon.com/blogs/aws/amazon-s3-vectors-now-generally-available-with-increased-scale-and-performance/ |
| 2026-03 | 17 more regions (31 in all). eu-north-1 is in the list | https://aws.amazon.com/about-aws/whats-new/2026/03/s3-vectors-expands-17-regions/ ; https://docs.aws.amazon.com/AmazonS3/latest/userguide/s3-vectors-regions-quotas.html |
| 2026-06 | Up to 10,000 results per query, paginated, with a data-returned fee beyond 512 KB | https://aws.amazon.com/about-aws/whats-new/2026/06/s3-vectors-supports-10000-search-results-per-query/ |
| 2026-06 | Query charges up to 80% lower on indexes over 10M vectors | https://aws.amazon.com/about-aws/whats-new/2026/06/s3-vectors-reduces-query-charges-80-percent-large-indexes/ |
| 2026-07/08 | GovCloud and the European Sovereign Cloud | What's New |
| 2026-09 | **Metadata pre-filtering** (index mode `ENHANCED`), `$startsWith`, 100 filter constraints per query. Buckets created on or after 2026-09-30 default to ENHANCED | https://aws.amazon.com/about-aws/whats-new/2026/09/s3-vectors-introduces-metadata-pre-filtering/ ; https://aws.amazon.com/blogs/aws/amazon-s3-vectors-now-supports-metadata-pre-filtering-for-higher-recall-on-filtered-searches/ |

### AWS's own hybrid patterns, and what they cost idle

**Bedrock Knowledge Bases**
- Hybrid search "is only supported for Amazon RDS, Amazon OpenSearch Serverless, and MongoDB vector stores that contain a filterable text field". **A Knowledge Base on S3 Vectors falls back to semantic search** [verified] (https://docs.aws.amazon.com/bedrock/latest/userguide/kb-test-config.html).
- It also chunks documents for RAG and caps custom metadata at 1 KB and 35 keys per vector (https://docs.aws.amazon.com/bedrock/latest/userguide/knowledge-base-setup.html).
- It doesn't fit per-mailbox mail search with label filters.

**OpenSearch Service with S3 Vectors as its engine** (https://docs.aws.amazon.com/AmazonS3/latest/userguide/s3-vectors-opensearch.html)
- This is AWS's main hybrid pattern: OpenSearch does BM25 and fuses, S3 Vectors stores the vectors.
- It needs a managed OpenSearch domain, with instances billed by the hour around the clock, so it is not near-zero idle.
- I didn't verify which instance types the S3 Vectors engine supports, so I can't give a floor price for eu-north-1 **[unverified]**.
- The other pattern is a one-time export from S3 Vectors into OpenSearch Serverless for high QPS.

**OpenSearch Serverless NextGen, GA 2026-05.** This is new since ADR-0007 was written, and it changes the premise of that ADR's dismissal.
- It scales to zero: after 10 minutes with no requests, search and indexing each drop to 0 OCU, and idle cost is storage only (https://aws.amazon.com/about-aws/whats-new/2026/05/amazon-opensearch-serverless-next-generation-generally-available/ ; https://docs.aws.amazon.com/opensearch-service/latest/developerguide/serverless-scale-to-zero.html).
- **But the docs say to "Expect 10–30 seconds of latency on the first request to each component" after it has scaled to zero** [verified]. Ruggles measured about 15 s at 50K vectors [reported].
- In eu-north-1, Indexing and Search OCUs cost $0.25512 per OCU-hour [verified, AWS Price List API, 2026-10-09].
- How many OCUs a woken "worker" is, I didn't verify **[unverified]**.
- For Duva the trouble is twofold. Mail trickling in wakes indexing and keeps it awake for at least 10 minutes each time. And a 10 to 30 s first search after idle fails the 3 s cold target by an order of magnitude, which #64's warm-up can't hide.
- Rough cost, if indexing is batched to once an hour: about 4 h a day awake at 0.5 to 1 OCU is $15 to $31 a month, plus search time **[estimate]**. That still breaks the 60 s freshness target, and it is 10 to 30 times what search costs today. It is a credible AWS-managed option only if Duva gives up near-zero idle or the cold target.
- Its predecessor, Classic, has a floor of 2 OCUs, about $366 a month (or about $183 with 1 OCU in dev-test) (https://builder.aws.com/content/3BWqyF1PhA4Mc1fxUOl9n2B9yZo/benchmarking-amazon-s3-vectors-vs-opensearch-serverless-at-scale).

**ElastiCache for Valkey 9 hybrid search, 2026-05:** node-based clusters only, so it is always on (https://aws.amazon.com/about-aws/whats-new/2026/05/amazon-elasticache-hybrid-search/). Ruled out.

---

## 2. Near-zero-idle keyword engines a Lambda could use per mailbox

The requirements, from `packages/api/src/search-engine.ts`:
- BM25-ranked words and phrases over subject, people, text and attachment names, or over the subject alone
- Filters: labels include/exclude, unread, has-attachment, a received range, threads include/exclude/exempt, and from/to as *a substring of a name or address, in any case*
- Swedish, English and Danish stemming
- One writer per mailbox
- Erased text physically gone from S3 within 24 h

### Measured here, same corpus for every engine

The corpus is 100,000 unique Enron messages, `corbt/enron-emails` shards 0 and 1 on Hugging Face. Bodies are cut to 2,000 characters, which leaves an **average of 965 characters**, since Enron mail is short. A "padded" run fills each body with its neighbour's text to an average of 1,493.

Labels follow the spike's shares: Inbox 10.9%, archive 81%, Spam 3%, Trash 5.1%. Each engine ran 140 queries:
- 16 single words
- 6 word pairs
- 6 phrases

Each query leaves out Spam and Trash and asks for the top 20.

This ran on an Intel Core Ultra X7 358H laptop under Node 26.10 (bundled SQLite 3.53.4, the same version Node 24.x bundles). **These are not Lambda numbers.** Lambda's vCPUs are slower, so expect warm query times about 1.5 to 3 times these **[estimate]**. The scripts are in `spikes/search/harness/keyword/`, and their results in `spikes/search/results/keyword-fts5-*.json`.

| Engine (965-character average) | On disk | zstd -3 | Build | Query p50 / p95 / p99 | Heap |
| --- | ---: | ---: | ---: | ---: | ---: |
| Tantivy 0.26.2 (`@oxdev03/node-tantivy-binding` 0.3.3), en_stem, no stored text, 1 segment | **45.5 MB** | **35.5 MB** | 18.6 s | **1.1 / 11 / 16 ms** | n/a (memory-mapped) |
| SQLite FTS5 "lean": stemmed body column, subject, people, no text copy | 91 MB (FTS 73 MB) | 45 MB | 131 s | 11.8 / 41 / 233 ms | n/a |
| SQLite FTS5 "full": unstemmed and stemmed columns, plus a text table for `texts()` | 267 MB (FTS 118 MB) | 95 MB | 142 s | 15 / 60 / 330 ms | n/a |
| SQLite FTS5 "full", 1,493-character average | 426 MB (FTS 172 MB) | 122 MB | 219 s | 24 / 88 / 406 ms | n/a |
| MiniSearch 7.2 | JSON 122 MB | 34 MB | 205 s | 14 / 186 ms | **596 MB**, **7.7 s** to `loadJSON` |
| Orama 3.1.18 | `save()` exceeded V8's maximum string length | n/a | 77 s | 66 / **7,073 ms** | **1,455 MB** |

What the numbers show:
- **Index size grows about linearly with text.** Going from 965 to 1,493 characters multiplied the FTS index by 1.46. At the 2,000-character average the question assumes, expect about 95 MB for Tantivy and 150 to 180 MB for FTS5 lean, or about 70 to 90 MB zstd **[estimate]**.
- **FTS5's slow tail is ranking.** `ORDER BY bm25()` scores every match, so "enron", which is in nearly every message, took 230 to 340 ms. Tantivy prunes with block-max WAND for its top-k, which is why its p99 is 16 ms.
- **FTS5's `secure-delete` erases immediately [verified].** Deleting a message whose text held a unique marker removed every copy of the marker from the file: 1 occurrence before, 0 after, with `INSERT INTO fts(fts,rank) VALUES('secure-delete',1)` and `PRAGMA secure_delete=ON`. It is slow: about 5 ms per message, or 5.2 s for 1,000.

### SQLite FTS5

**FTS5 in Node 24 [verified].** Node's `deps/sqlite/sqlite.gyp` on `v24.x` defines `SQLITE_ENABLE_FTS5`, as well as FTS3, RTREE, SESSION, PERCENTILE and others. The bundled version is 3.53.4 (https://raw.githubusercontent.com/nodejs/node/v24.x/deps/sqlite/sqlite.gyp).
- `node:sqlite` is "Stability: 1.2 – Release candidate".
- It has `loadExtension()`, when constructed with `allowExtension: true` (added in v22.13 and v23.5).
- It has `serialize()` and `deserialize()`, added in v24.16 (https://raw.githubusercontent.com/nodejs/node/v24.x/doc/api/sqlite.md).
- **There is no JS API for registering a custom FTS5 tokenizer or a custom VFS.**

**Swedish and Danish stemming.** FTS5's built-in tokenizers are unicode61, ascii, porter (English only) and trigram. There are two ways to get Snowball's Swedish and Danish stemmers.
- **Pre-stem in JS (recommended).** Tokenize, stem each token with Snowball, and write the stems space-joined into a column that `unicode61` indexes. Stem the query terms the same way. Positions survive one-to-one, so phrases work on the stemmed column, as measured here with the 2016 JS port `snowball-stemmers` 0.6.0. Snowball upstream (v3.1.1) generates JavaScript itself, so Duva could vendor current stemmers under BSD instead. Each message goes in the column for its language, as LanceDB files them today.
- **Load a C tokenizer** such as `abiliojr/fts5-snowball` (55 stars, last pushed 2021-05-29) with `loadExtension`. That brings back a native artifact built for Amazon Linux 2023 x64. It is possible, but it loses the "no native module" advantage.

**Files in S3: download to /tmp versus HTTP range reads.**
- **Download:**
  - Lambda's sustained network throughput is 625 Mbps (about 78 MB/s) below 2,048 MB. Above that it scales to 3,000 Mbps at 10,240 MB, but **only after a Service Quotas request** ("Network bandwidth per execution environment") and only outside a VPC. One stream doesn't fill the link, so parallel ranged GETs are needed (https://aws.amazon.com/blogs/compute/improving-lambda-function-latency-with-scalable-network-bandwidth/, 2026-09) [verified].
  - So 45 MB of zstd (lean, 965 characters) takes about 0.6 s plus about 0.1 to 0.2 s to decompress. About 90 MB (2,000 characters) takes about 1.2 to 1.4 s. A 500k-message mailbox would take 3 to 7 s **[estimate]**.
  - /tmp is 512 MB by default and can be configured up to 10 GB.
- **Range reads:**
  - `node:sqlite` can't take a JS VFS, so range reads mean WASM SQLite (wa-sqlite or sql.js-httpvfs) with an async S3 VFS.
  - sql.js-httpvfs reports 10 to 20 GETs and 130 to 270 KiB for an indexed query, and about 70 KiB for an FTS prefix query on an 8 MB FTS table (https://phiresky.github.io/blog/2021/hosting-sqlite-databases-on-github-pages/) [reported].
  - BM25 over a common term needs its whole doclist, many MB at 100k messages. With S3 Standard's first byte at tens of ms per GET and B-tree descents that are sequential, a cold query would plausibly take 0.5 to 2 s **[unverified estimate]**. sql.js-httpvfs was last released in 2022, and its readers are read-only.
- **S3 Files** (2026), which mounts S3 in Lambda, would avoid the download, but it **requires the function to be in a VPC** (https://aws.amazon.com/blogs/compute/modernizing-lambda-s3-workloads-with-amazon-s3-files/). That conflicts with ADR-0006.

**Write model.** A single writer downloads or keeps the DB, applies a batch and uploads it. A whole-file upload on every commit forces every reader to download the whole file again after each new message. That breaks the cold and freshness budget, so Duva would need its own chunking: fixed-size chunk objects plus a manifest updated with a conditional `If-Match` PUT, so commits and readers move only the changed chunks. The alternative is a base DB plus a small delta DB attached together. Relabels touch pages throughout the base. Duva would own all of this, and LanceDB does it for Duva today.

**Erasure: the best of all the options.** `secure-delete` plus `PRAGMA secure_delete` takes the bytes out of the file at delete time (https://www.sqlite.org/fts5.html §6.13). The next upload carries no erased text, as long as the bucket keeps no noncurrent versions.

**Package and idle.** Nothing to package. Idle is S3 storage only.

**Cold start.** Init plus download plus first query: about 1.0 to 2.0 s at 100k [estimate]. Warm: 12 to 60 ms p95 locally, against the 300 ms target.

### Tantivy

**Engine.** Rust, Lucene-like. BM25 with block-max WAND, phrase queries over positions, and Snowball stemmers through rust-stemmers, including Swedish, Danish and English, which the binding exposes as `Filter.stemmer("swedish")`.

**Node bindings.**
- `@oxdev03/node-tantivy-binding` 0.3.3: napi-rs, tantivy 0.26.2, prebuilt for linux-x64-gnu and aarch64-gnu. Its x64 `.node` is **5.4 MB** and needs only GLIBC 2.14 [verified]. The repo has 15 stars and was created 2025-08 and pushed 2026-10-07 [verified]. Its `garbageCollectFiles()` is documented as a no-op.
- `@harperfast/fulltext` 0.5.0 (Apache-2.0, first published 2026-09-24) is a second option [verified on npm, not evaluated].
- Either way Duva depends on a thin binding, or writes its own napi-rs crate. That would be the first Rust in a TypeScript monorepo, which strains ADR-0005.

**On S3.** A Tantivy index is immutable segment files plus `meta.json`. A commit writes a new small segment. Deletes write a per-segment `.del` bitset. That maps cleanly onto S3:
- The writer PUTs the new segment files, then PUTs `meta.json` with `If-Match` as the commit pointer.
- Readers GET `meta.json` (one request), download any segments they don't have into /tmp, and open the index.
- The binding only opens a filesystem path, so Duva owns this sync.

Quickwit does the same natively in Rust: range reads plus a "hotcache", and sub-second cold search on Lambda (https://quickwit.io/blog/quickwit-lambda-search-performance, 2024-01). But Datadog acquired Quickwit in early 2025, and a user reports that "Quickwit devs have decided to not support the Lambda deployment mode going forward" (https://news.ycombinator.com/item?id=46032694, 2025-11) [reported].

**Size and speed.** 45.5 MB index, 35.5 MB zstd. Tantivy already compresses, so zstd gains little. Query p95 is 11 ms locally [verified]. Cold download is about 0.45 s at 965 characters and about 1 s at 2,000 [estimate].

**Relabel and update.** Tantivy can't update a document in place. A relabel deletes and re-adds the document, so the full text must be available: as a stored field (compressed) or fetched from the raw mail in S3. Each relabel batch is one small new segment. Merges need scheduling, or readers keep downloading merged segments.

**Erasure.** Deleted documents stay in their segments, terms and positions included, until a merge rewrites the segment. That is the same 24-hour model as LanceDB today: the eraser force-merges segments with deletes, deletes unreferenced files from S3, and the bucket keeps no noncurrent versions. Duva would write the GC itself, since the binding's GC is a no-op.

**Filters.**
- Labels: a raw multi-valued term field.
- Unread and attachment: boolean fields.
- Received: a fast date field with range queries.
- Threads: term-set queries.
- From/to substring: `RegexQuery` over a raw lowercased field, or an n-gram field. Not measured.

**Cold start.** Init (Node plus a 5 MB `.node`) plus download plus open: about 0.8 to 1.5 s at 100k [estimate]. The x64 package is about 5 MB, against LanceDB's 214 MB, so it would fit at 1,769 MB, and arm64 also fits in a zip.

### MiniSearch, Orama, FlexSearch

- **MiniSearch 7.2.** BM25+ and prefix/fuzzy matching, but no phrase queries. A custom `processTerm` can carry Snowball stemming. At 100k messages it took 596 MB of heap and 122 MB of JSON (34 MB zstd), and **7.7 s to load**, with p95 186 ms [verified, measured]. Ruled out on cold start.
- **Orama 3.1.18.** BM25 and its own stemmers (`@orama/stemmers`, which covers Swedish and Danish). It took 1.46 GB of heap, its `save()` overflowed V8's maximum string length, and warm p95 was 7 s [verified, measured]. Ruled out.
- **FlexSearch 0.8.212.** It ships language packs only for en, de and fr. It has no BM25: its README's "bm25" row is a library it compares against. It persists to IndexedDB, Redis, SQLite, Postgres, MongoDB or ClickHouse [verified, in its README]. Not tried. Ruled out on ranking and languages.

### DynamoDB as an inverted index

One item per term and message (positions packed), or postings blocks per term. DynamoDB has no BM25, phrase or top-k support, so Duva would write a search engine: tokenizing, stemming, document frequencies, average lengths, scoring and phrase matching.

Costs in eu-north-1 [verified, Price List API]: $0.67 per million WRU, $0.1345 per million RRU, $0.269 per GB-month. At about 120 term items per message, that is about 12M writes, or about $8 to load 100k messages [estimate]. A common term means reading about 100k postings: megabytes, in several paginated sequential Queries, so hundreds of ms and thousands of RRU per query [estimate].

Erasure: deletes are immediate to readers, but **point-in-time recovery keeps deleted items for up to 35 days**. That already applies to Duva's existing tables. Not credible as a search engine.

### Others considered and ruled out

| Option | Why not |
| --- | --- |
| turbopuffer, Pinecone, Algolia and other SaaS | Data would leave the organization's account |
| Aurora Serverless v2 at 0 ACU | Resumes in about 15 s; ADR-0006 already rejected it |
| Aurora DSQL | No full-text search |
| Nixiesearch and Lucene on Lambda through GraalVM (https://nixiesearch.substack.com/p/i-put-a-real-search-engine-into-a, 2025-11) | Uses EFS, so needs a VPC; a JVM-based stack |
| Keeping LanceDB for keywords only | Keeps the 214 MB native module and the table-open cold cost, which the spike found is most of a cold query. Small gain |

---

## 3. S3 Vectors in practice: independent evidence

**Latency**

| Who | Setup | Result |
| --- | --- | --- |
| Ruggles, 2026-05-30 [reported] | arm64 Lambda in us-east-1, 50K × 1024 Titan vectors, top 10, 10 iterations | Warm p50 / p95 / p99 68 / 100 / 107 ms. First query 104 ms: "no observable cold start" |
| manupm87/travel-ai-world PR #118, 2026-09-17 [reported] | From Lambda, small corpus (about 6k vectors, inferred from 24 MB of float32) | Search p50 64 ms warm, 91 ms on a Lambda cold start (https://github.com/manupm87/travel-ai-world/pull/118) |
| AWS employee, Builder Center, 2026-04-07 [reported] | eu-west-1, 50 to 75K × 1024 | Warm 56 to 65 ms average, cold max 447 ms. Cites re:Invent STG318: the cache "persists for several minutes after the last access" |
| Siddhant Khare, 2025-12 [reported] | CloudShell in us-east-1 | 137 ms at 100k × 384, 158 ms at 100k × 1024, 207 ms at 1M, 382 ms at 10M. Averages, no percentiles |
| Ajay Kumar, 2026-10-06 [reported] | From a PC to us-east-1, round trip | 329 to 330 ms warm median at 50k × 384, the same with or without filters (https://dev.to/aws-builders/i-tested-amazon-s3-vectors-new-pre-filtering-against-exact-ground-truth-42f8) |

Builder Center: https://builder.aws.com/content/3BWqyF1PhA4Mc1fxUOl9n2B9yZo/benchmarking-amazon-s3-vectors-vs-opensearch-serverless-at-scale. Siddhant Khare: https://dev.to/siddhantkcode/aws-s3-vectors-at-scale-real-performance-numbers-at-10-million-vectors-2lno.

**Nobody has published a cold-start p95 for 100k × 1024 from Lambda in eu-north-1 [unverified]. Measure it.**

**Recall against exact search.** Recall isn't tunable.
- Siddhant: Recall@4 of 0.973 to 0.988 at 100k and 0.908 at 10M, about matching FAISS HNSW [reported].
- Kumar, ENHANCED, against brute-force ground truth: 0.994 unfiltered at Recall@10. Filters matching 5 or fewer vectors were exact. **Mid-selectivity filters dip as K grows**: 50 matches gave 0.948 at K=5, 0.811 at K=20 and 0.610 at K=50. 135 matches gave 0.883 at K=20 [reported].
- One query at K=50 kept returning 30.5 of 50 results, for no reason anyone found.
- The older claims of 85 to 90% (Zilliz, 2025-09) predate GA.

For comparison, #62 tuned LanceDB to 0.98 of a flat scan's top 20.

**Filtering**
- **On `ENHANCED` indexes the filter runs first (pre-filtering).** On `CLASSIC` indexes, filter and search run "in tandem" and "may return fewer than top K results". AWS's own example shows 2 results back of 10 asked [verified] (https://docs.aws.amazon.com/AmazonS3/latest/userguide/s3-vectors-metadata-filtering.html).
- Buckets created on or after 2026-09-30 default to ENHANCED, and `$startsWith` needs ENHANCED.
- Latency grows with index size, with the share of vectors the filter matches, and with the number of constraints [verified, same page].
- Before ENHANCED, Siddhant saw "approximately 20% of queries return K-1 results" [reported].
- **Gaps that matter for Duva:**
  - No substring or contains operator, so "part of the sender's name or address, in any case" can't be expressed. Only `$eq`, `$in` and `$startsWith` on strings.
  - At most **100 constraints per query**, so long thread include/exclude/exempt lists don't fit.
  - At most **2 KB of filterable metadata**, which a long recipient list overflows.
- So filtered semantic search needs either the keyword engine to resolve candidates, or over-fetching and post-filtering in Lambda.

**Writes**
- Limits: 1,000 PutVectors and DeleteVectors requests per second, 2,500 vectors per second and 500 vectors per call, per index [verified].
- Measured: about 250 vectors per second sustained at 1024 dimensions in batches of 500 (Builder Center), so loading 100k takes about 6.6 minutes [reported].
- Prices in eu-north-1 [verified, Price List API, 2026-10-09]:
  - PUT: $0.20 per GB
  - Storage: $0.06 per GB-month
  - Queries: $0.0025 per 1,000
  - Processed bytes: $0.0039 per TB below 100K vectors, falling at higher tiers
  - Returned bytes: $0.01 per GB beyond the free 512 KB
- For a 100k mailbox (about 4.4 KB per vector): about $0.026 a month to store and about $0.09 to load. A query costs about $0.0000042. All negligible [estimate].
- **No metadata-only update.** A relabel or mark-read means GetVectors (with data, 100 per call), then PutVectors of the whole vector [verified from the API list]. PutVectors with an existing key works as an upsert in common libraries. The API page doesn't spell it out [unverified wording].

**Consistency.** "Writes to S3 Vectors are strongly consistent, which means that you can immediately access the most recently added data" [verified] (https://docs.aws.amazon.com/AmazonS3/latest/userguide/s3-vectors.html). Siddhant saw inserts queryable at once during bulk loads [reported]. That fits the 60 s freshness target.

**Deletion**
- By key only. **There is no delete by filter**: Mastra's adapter keeps filter deletes unsupported because S3 Vectors "has no native filtered-delete primitive" (https://github.com/mastra-ai/mastra/issues/24668) [reported]. So Duva needs message IDs per thread, from DynamoDB, for `removeThreads`.
- Siddhant reports deletes at "3–4 vectors per second via boto3" and advises rebuilding indexes over bulk deletes. That was probably single-key calls; the documented limit is 2,500 a second [reported, skeptical].
- **Physical erasure is undocumented.** AWS says only that it "automatically optimizes the vector data" as you write and delete. No page I found gives a bound on when a deleted vector's bytes leave storage [unverified].
- A per-index KMS key is possible (`encryptionConfiguration` on CreateIndex [verified]), so a whole mailbox can be crypto-shredded. But KMS key deletion waits at least 7 days, and nothing works per message.
- Embeddings are not text, but they can be inverted: vec2text recovered 92% of 32-token inputs exactly (Morris et al., "Text Embeddings Reveal (Almost) As Much As Text", EMNLP 2023, arXiv 2310.06816). Duva would have to treat vectors as personal data, which **puts ADR-0007's "erased text leaves S3 within 24 hours" out of reach for the vector half**, unless AWS commits to a bound.

**Other gotchas**
- Metadata keys are filterable unless declared non-filterable at index creation, and filterable metadata counts toward the processed bytes you pay for (Ruggles).
- Index dimension, metric and non-filterable keys are fixed once the index is created [verified].
- Pagination tokens expire: a retry after a pause failed with "Invalid page token" (Kumar).
- "Hundreds" of queries per second per index. Fine for Duva.
- AWS positions it for "infrequent queries".
- No local emulator I could find [unverified]. Duva's tests run with no AWS, so they would use a brute-force stand-in, and the behavior suite couldn't catch ANN recall or filter quirks.

---

## 4. Judgment

**Pairing.** Tantivy is the best keyword partner for S3 Vectors in Duva:
- real BM25 with top-k pruning
- phrases
- Swedish, Danish and English Snowball stemmers built in
- a 45 MB index for 100k Enron messages
- an 11 ms p95
- a 5 MB native module
- immutable segments that map onto S3 objects for single-writer commits and cheap incremental reader sync

Its risk is the binding (15 stars) and the Rust it brings in.

**SQLite FTS5 on `node:sqlite` is the fallback if Duva wants no native code.** It needs nothing extra, and `secure-delete` erases at once, simpler than today's daily compaction. But it needs JS pre-stemming for Swedish and Danish, an index about twice Tantivy's, slow ranking on very common terms (230 to 400 ms locally), and a chunked upload scheme to avoid moving the whole file on every commit.

**Is the split smarter than today? Not clearly.**

What it would gain [estimates unless marked]:
- Search no longer needs 10,240 MB and the x64-only 214 MB zip: 1,769 MB, or arm64 in a zip, so cheaper searches.
- No vector-index tuning (#62).
- Semantic cold queries of about 0.1 to 0.45 s [reported].
- A plausible cold total of about 1.0 to 1.5 s at 100k messages, against 2.4 to 2.7 s today.

What it would cost:
- **Cold start moves rather than vanishes.** The keyword index is downloaded, so cold time grows linearly with the mailbox: about 3 to 7 s at 500k messages. LanceDB reads lazily.
- **Filters split across two engines.** Sender and recipient substrings, long thread lists and the 2 KB metadata cap push filtered semantic search into candidate resolution or post-filtering.
- **Relabel and mark-read write amplification** in S3 Vectors, or else label state left out of S3 Vectors and the top-K problem back.
- **No erasure bound for vectors.**
- **Recall is fixed by AWS.** It dips on mid-selective filters.

Plumbing Duva would own, compared with LanceDB today:

| | Today (LanceDB) | S3 Vectors + Tantivy on S3 |
| --- | --- | --- |
| Storage format and commits | LanceDB: conditional writes, versions | Duva: `meta.json` as the commit pointer with `If-Match`, segment upload, file GC, no noncurrent versions |
| Reader freshness | LanceDB checks versions (one LIST) | Duva: GET `meta.json`, diff segments, download to /tmp, LRU across mailboxes in 512 MB to 10 GB /tmp |
| Vector index | Duva tunes IVF_RQ, rebuilt in compaction | AWS. Duva: per-mailbox CreateIndex/DeleteIndex, ENHANCED mode, key scheme, metadata schema within 2 KB, retries on 429 |
| Labels and read state | One in-place update | Tantivy delete plus re-add (needs stored text), plus S3 Vectors GetVectors and PutVectors of whole vectors |
| Consistency | One table | Two stores. Reconcile partial failures, and keep puts and deletes idempotent by message ID |
| Erasure | Delete rows, daily rewrite and prune | Tantivy: daily merge of segments with deletes, plus GC. S3 Vectors: delete by key with no physical bound, so ask AWS or document it |
| Language change | Drop and rewrite one table | Drop and rewrite both |
| Hybrid | Two searches of one table, RRF in Duva | The same RRF, now across two services (no change) |
| Native code | LanceDB's 214 MB module | A 5 MB Tantivy binding (thin upstream, or Duva's own napi-rs) |
| Tests | LanceDB runs locally | A stand-in for S3 Vectors. The behavior suite passes against a fake |

**Recommendation.** Don't switch on paper. If cold start, Lambda size or vector tuning start to hurt, spike exactly this pair:
- Tantivy segments on S3 in /tmp, plus S3 Vectors ENHANCED.
- At 100k and 500k messages, from Lambda in eu-north-1.
- With `harness benchmark` and the search-engine behavior suite.
- Measuring cold p95 with the index download and filtered-semantic recall against a flat scan.

Before that, ask AWS Support in writing how long deleted vectors persist in S3 Vectors storage. Separately, ADR-0007's dismissal of OpenSearch Serverless at $190 to $370 a month is out of date: NextGen scales to zero. Its 10 to 30 s wake-up still rules it out for Duva's 3 s cold target, but the ADR's reason should be updated.

### Not verified, to check in a spike

- S3 Vectors cold p95 from Lambda in eu-north-1 at 100k × 1024 with label filters.
- Physical deletion time in S3 Vectors.
- Tantivy-on-S3 cold time in Lambda, and the effect of merges on reader downloads.
- How the binding behaves on Lambda's Amazon Linux 2023.
- FTS5 and Tantivy query times on Lambda's vCPUs.
- How many OCUs an OpenSearch Serverless NextGen "worker" is.
- Which instance types OpenSearch's S3 Vectors engine needs.
- Whether wa-sqlite range reads from S3 make cold FTS5 queries sub-second.
