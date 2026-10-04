---
status: proposed
---

# Search with LanceDB on S3

Keyword, vector and hybrid search run in an embedded LanceDB table per mailbox, stored in the organization's S3 bucket, so idle cost is S3 storage. OpenSearch Serverless was the managed alternative, but a steady trickle of mail keeps it awake at about $190-370 a month per organization. LanceDB is pre-1.0, so a spike (#2) measured it first on a 100k-message mailbox, from Lambda in eu-north-1 (`spikes/search/REPORT.md`). With LanceDB 0.39.0 and its vector index, every target holds at 10,240 MB, in an x64 zip and in an arm64 image, though the zip's caller sees cold starts of 3.1 to 3.3 s. At 1,769 and 3,538 MB every target holds except cold p95, which reaches 3.1 to 3.5 s against 3 s. The ticket's rules would accept it at 10,240 MB, but which size and package the targets are meant at is a judgment call, so this stays proposed until #20 settles it.

## Consequences

- Search sits behind one module, so the engine can be swapped, and the spike's behavior suite is the contract any engine passes.
- Mail is embedded with Titan Text Embeddings V2 at 1,024 dimensions, which runs in eu-north-1, so mail need not leave the region. It costs $0.55 per 100k messages.
- LanceDB's x64 native module takes about 214 MB with Apache Arrow, which fits a zip with about 47 MB to spare. Its arm64 module is 389 MB, so arm64 needs a container image.
- Semantic search needs the vector index: a flat scan takes about 5 s. At LanceDB's defaults the index finds 0.59 of a flat scan's top 20, so it gets tuned before semantic search ships.
- Each mailbox has one writer, which batches what has arrived, retries, and runs maintenance itself between writes. Readers check for new versions on every search, so new mail is searchable on the next one.
- A removed message's text stays in its S3 data file until compaction rewrites the fragment, which LanceDB does only past 10% of its rows deleted. So erasing Spam and Trash needs a design of its own.
- Fallback: per-mailbox SQLite FTS5 files in S3 for keywords, plus S3 Vectors for semantic search, merged in our code.
