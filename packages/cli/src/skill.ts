// The agent skill that teaches the CLI: a hand-written preamble, then every command in the command
// tree. The binary renders it from its own commands, so it always matches the CLI's version.
import { mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import duva from "../../../package.json" with { type: "json" };
import { agentKeyVariable } from "./api-commands.ts";
import { type Command, optionValues } from "./commands.ts";

/** Where agents look for skills: the shared directory, and Claude Code's own. */
const skillDirectories = () => [join(homedir(), ".agents", "skills", "duva"), join(homedir(), ".claude", "skills", "duva")];

export const skillInstall: Command = {
  words: ["skill", "install"],
  summary: "Install the skill that teaches agents this CLI, replacing any older copy.",
  options: [],
  async run(args) {
    optionValues(skillInstall, args);
    // Loaded here, since the command tree holds this command.
    const { commands } = await import("./commands.ts");
    const installed: string[] = [];
    for (const directory of skillDirectories()) {
      await rm(directory, { recursive: true, force: true });
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, "SKILL.md"), skill(commands));
      installed.push(join(directory, "SKILL.md"));
    }
    return { installed };
  },
};

/** The skill's SKILL.md, describing the commands. */
export function skill(commands: readonly Command[]): string {
  return `${preamble}\n# Commands\n\n${commands.map(section).join("\n")}`;
}

const preamble = `---
name: duva
description: Read and act on mail in Duva, the mailbox platform where humans and agents are both actors, with its duva CLI. Use when you work with a Duva mailbox or run any duva command.
---

# Duva's CLI

This skill describes duva ${duva.version}. After updating the CLI, run \`duva skill install\` to update the skill too.

## Authentication

duva calls the Duva deployment that \`duva deploy\` saved in its config, \`~/.config/duva/config.json\`. On a machine where nobody ran it, copy that file from one where someone did. An agent calls Duva with the key its sponsor got when creating it. Put the key in the \`${agentKeyVariable}\` environment variable, and every command acts as that agent. An agent never signs in. If Duva refuses the key, the sponsor may have rotated it, so ask them for the current one. A human signs in with \`duva login\` instead.

## Output and exit codes

Every command prints JSON on stdout and exits with 0. When a command fails, it prints \`{"error": "..."}\` on stderr and exits with 1. The message says what went wrong.

## Approval

By default, an agent's send from its own mailbox waits for its sponsor's approval. Asking to send succeeds once the request is waiting, before any mail goes out. The sponsor then sends the draft as it is, edits and sends it, or rejects it with a note you can read. Changing the draft withdraws a waiting request. The mailbox's change feed records each step.
`;

function section(command: Command): string {
  const options = command.options.map(
    ({ name, required, type, description }) =>
      `- \`--${name}\`${type === "boolean" ? ` or \`--no-${name}\`` : ""}${required ? " (required)" : ""}${type === "strings" ? " (once for each)" : ""}: ${description}\n`,
  );
  return [`## duva ${command.words.join(" ")}\n`, `${command.summary}\n`, ...(command.description ? [`${command.description}\n`] : []), ...(options.length > 0 ? [options.join("")] : [])].join("\n");
}
