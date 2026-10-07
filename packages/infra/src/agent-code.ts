// The code of the mailbox agents' AgentCore Runtime (ADR-0027), for direct code deployment: one
// CommonJS file esbuild bundles with everything it imports, the AWS SDK included, for Node.js 22,
// which AgentCore runs on arm64. It has no native module, so it runs there as built here.
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";

/** The file AgentCore starts, in the code's directory. */
export const agentEntryPoint = "main.js";

/** Builds the code into a directory of its own under node_modules/.cache, rebuilt on every synth, and returns it. */
export function agentCode(): string {
  const directory = fileURLToPath(new URL("../node_modules/.cache/duva-agent-code", import.meta.url));
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  buildSync({
    entryPoints: [fileURLToPath(import.meta.resolve("@duva/api/agent-runtime-main"))],
    outfile: join(directory, agentEntryPoint),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    mainFields: ["module", "main"],
    minify: true,
    sourcemap: true,
    sourcesContent: false,
    logLevel: "error",
  });
  return directory;
}
