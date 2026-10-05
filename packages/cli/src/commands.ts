import { parseArgs } from "node:util";
import { apiCommands } from "./api-commands.ts";
import { attachmentsDownload } from "./attachments.ts";
import { deploy } from "./deploy.ts";
import { login } from "./login.ts";
import { skillInstall } from "./skill.ts";

export interface Command {
  /** The words that name the command, as in `duva <words>`. */
  words: readonly string[];
  summary: string;
  /** More on what the command does, if its summary isn't enough. */
  description?: string;
  /** The options the command takes, as in `--<name> <value>`, or `--<name>` alone for a flag. */
  options: readonly CommandOption[];
  /** Runs the command with the arguments after its words. Returns what to print as JSON. */
  run(args: string[]): Promise<unknown>;
}

export interface CommandOption {
  name: string;
  required: boolean;
  description: string;
  /** "strings" for a list, given as the option once for each of its items, and "boolean" for a flag, which takes no value and is false as --no-<name>. */
  type?: string;
}

/** The hand-written commands, then one for each API operation. */
export const commands: Command[] = [deploy, login, skillInstall, attachmentsDownload, ...apiCommands];

/**
 * The values of the command's options in its arguments. A flag is true when given and false when
 * given as --no-<name>, a list's option takes a value once for each item, and every other option
 * takes a value.
 */
export function optionValues(command: Command, args: string[]): Record<string, string | string[] | boolean | undefined> {
  const { values } = parseArgs({
    args,
    allowNegative: true,
    options: Object.fromEntries(
      command.options.map(({ name, type }) => [name, type === "boolean" ? { type: "boolean" as const } : { type: "string" as const, multiple: type === "strings" }]),
    ),
  });
  return values as Record<string, string | string[] | boolean | undefined>;
}
