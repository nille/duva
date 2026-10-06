// The code of the two Lambdas that use LanceDB, search and the indexer, as one x64 zip (ADR-0007).
// esbuild bundles each handler with everything it imports, the AWS SDK and LanceDB's JavaScript
// included, and LanceDB's native module, which can't be bundled, sits beside them as its package.
// Only x64 fits a zip: with Apache Arrow it takes about 214 MB, and arm64's native module alone 389 MB (docs/aws.md).
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";

/** The package of LanceDB's native module for Lambda's x64 Linux. */
const nativeModule = "@lancedb/lancedb-linux-x64-gnu";

/** The handlers in the code, each as the module Lambda names: search.handler and indexer.handler. */
export const searchHandlers = { search: "@duva/api/search-lambda", indexer: "@duva/api/indexer-lambda" } as const;

/**
 * Builds the code into a directory of its own under node_modules/.cache, rebuilt on every synth,
 * and returns it.
 */
export function searchCode(): string {
  const directory = fileURLToPath(new URL("../node_modules/.cache/duva-search-code", import.meta.url));
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  const entries = Object.fromEntries(Object.entries(searchHandlers).map(([name, module]) => [name, fileURLToPath(import.meta.resolve(module))]));
  buildSync({
    entryPoints: entries,
    outdir: directory,
    outExtension: { ".js": ".mjs" },
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    mainFields: ["module", "main"],
    minify: true,
    sourcemap: true,
    sourcesContent: false,
    // The native module is loaded at run time, and LanceDB's embedding providers, which Duva doesn't
    // use, only if asked for.
    external: [nativeModule, "*.node", "openai", "@huggingface/transformers"],
    // CommonJS modules in the bundle still require Node's built-ins, so ESM gets a require.
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
    logLevel: "error",
  });
  const api = createRequire(entries.search!);
  let native: string;
  try {
    native = dirname(api.resolve(`${nativeModule}/package.json`));
  } catch {
    throw new Error(`The build needs ${nativeModule}, which npm installs only on x64 Linux. Build Duva there.`);
  }
  cpSync(native, join(directory, "node_modules", nativeModule), { recursive: true });
  writeFileSync(join(directory, "package.json"), JSON.stringify({ type: "module" }));
  return directory;
}
