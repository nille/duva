// Writes the copy of the CLI's skill published in the repo, for npx skills add.
//
//   node packages/cli/scripts/skill.ts           writes skills/duva/SKILL.md
//   node packages/cli/scripts/skill.ts --check   fails if it's stale
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { commands } from "../src/commands.ts";
import { skill } from "../src/skill.ts";

const path = "skills/duva/SKILL.md";
const file = new URL(`../../../${path}`, import.meta.url);
const content = skill(commands);

if (process.argv.includes("--check")) {
  if ((await readFile(file, "utf8").catch(() => undefined)) !== content) {
    console.error(`${path} is stale. Run npm run generate.`);
    process.exit(1);
  }
} else {
  await mkdir(new URL(".", file), { recursive: true });
  await writeFile(file, content);
}
