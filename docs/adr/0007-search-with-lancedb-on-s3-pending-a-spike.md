---
status: proposed
---

# Search with LanceDB on S3, pending a spike

Keyword, vector and hybrid search run in an embedded LanceDB table per mailbox, stored in the organization's S3 bucket, so idle cost is S3 storage. OpenSearch Serverless was the managed alternative, but a steady trickle of mail keeps it awake at about $190-370 a month per organization. LanceDB is pre-1.0 and ships a native module of about 200 MB, so before building on it we measure cold and warm p95 for keyword, phrase, filtered vector and hybrid queries on a 100k-message mailbox.

## Consequences

- Search sits behind one module, so the engine can be swapped.
- The spike also picks the embedding model. Titan Text Embeddings V2 runs in eu-north-1, so mail need not leave the region.
- Fallback if the spike fails: per-mailbox SQLite FTS5 files in S3 for keywords, plus S3 Vectors for semantic search, merged in our code.
