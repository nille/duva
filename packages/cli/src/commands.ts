import { parseArgs } from "node:util";
import { apiCommands } from "./api-commands.ts";
import { deploy } from "./deploy.ts";
import { login } from "./login.ts";
import { skillInstall } from "./skill.ts";

export interface Command {
  /** The words that name the command, as in `duva <words>`. */
  words: readonly string[];
  summary: string;
  /** More on what the command does, if its summary isn't enough. */
  description?: string;
  /** The options the command takes, as in `--<name> <value>`. */
  options: readonly CommandOption[];
  /** Runs the command with the arguments after its words. Returns what to print as JSON. */
  run(args: string[]): Promise<unknown>;
}

export interface CommandOption {
  name: string;
  required: boolean;
  description: string;
}

/** The hand-written commands, then one for each API operation. */
export const commands: Command[] = [deploy, login, skillInstall, ...apiCommands];

/** The values of the command's options in its arguments. Every option takes a value. */
export function optionValues(command: Command, args: string[]): Record<string, string | undefined> {
  const { values } = parseArgs({ args, options: Object.fromEntries(command.options.map(({ name }) => [name, { type: "string" as const }])) });
  return values as Record<string, string | undefined>;
}
