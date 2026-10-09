# Keyword engines beside S3 Vectors

The benchmarks behind `docs/research/s3-vectors-keyword-engines.md`, run on a laptop on 2026-10-09, so their times aren't Lambda's. They sit outside the spike's lockfile: they need `@oxdev03/node-tantivy-binding` 0.3.3, `minisearch` 7.2.0, `@orama/orama` and `@orama/stemmers` 3.1.18, `flexsearch` 0.8.212 and `snowball-stemmers` 0.6.0, installed in the directory `KEYWORD_DATA` names, and `zstd` on the PATH.

The corpus is `mail100k.jsonl` there: 100,000 unique Enron messages from shards 0 and 1 of `corbt/enron-emails` on Hugging Face, one JSON object a line with `subject`, `from`, `to` and `text`, bodies cut to 2,000 characters.

```sh
KEYWORD_DATA=<dir> node harness/keyword/fts5-bench.mjs        # its fts5-*.json, kept here as results/keyword-fts5-*.json
KEYWORD_DATA=<dir> node harness/keyword/tantivy-bench.mjs
KEYWORD_DATA=<dir> node harness/keyword/js-engines-bench.mjs
```
