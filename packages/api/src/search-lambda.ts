// The Lambda entry point for search, which only the API invokes, through IAM. The CDK app sets the
// environment. A warm environment keeps the tables it has opened and their caches.
import { Session } from "@lancedb/lancedb";
import { required } from "./environment.ts";
import { environmentVariables } from "./infrastructure.ts";
import { lanceSearch } from "./lancedb-search.ts";
import { createSearcher } from "./searching.ts";
import { titanEmbedder } from "./titan.ts";
import { novaTranslator } from "./translation.ts";

// A quarter of the function's memory for the index cache and a sixteenth for the metadata cache,
// as the search spike measured (#17).
const memory = BigInt(required("AWS_LAMBDA_FUNCTION_MEMORY_SIZE")) * 1024n * 1024n;

export const handler = createSearcher(
  lanceSearch({
    uri: required(environmentVariables.searchIndexes),
    storageOptions: { region: required("AWS_REGION") },
    session: new Session(memory / 4n, memory / 16n),
    embedder: titanEmbedder(),
    translator: novaTranslator(),
  }),
);
