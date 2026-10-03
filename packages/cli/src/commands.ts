import { apiCommands } from "./api-commands.ts";
import { deploy } from "./deploy.ts";

export interface Command {
  /** The words that name the command, as in `duva <words>`. */
  words: readonly string[];
  summary: string;
  /** Runs the command with the arguments after its words. Returns what to print as JSON. */
  run(args: string[]): Promise<unknown>;
}

/** The hand-written commands, then one for each API operation. */
export const commands: Command[] = [deploy, ...apiCommands];
