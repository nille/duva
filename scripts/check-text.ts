// Fails if Duva's own text uses an em dash. Its copy rules never use one (PRODUCT.md).
import { spawnSync } from "node:child_process";

const emDash = "\u2014";
const grep = spawnSync(
  "git",
  ["grep", "--untracked", "-n", "-I", "-F", emDash, "--", ".", ":!.agents", ":!*package-lock.json"],
  { encoding: "utf8" },
);
if (grep.status === 0) {
  console.error(`Use a period, comma, colon or parentheses instead of an em dash:\n${grep.stdout}`);
  process.exit(1);
}
if (grep.status !== 1) throw new Error(`git grep failed: ${grep.stderr}`);
