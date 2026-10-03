// duva, the command-line interface for Duva. Every command prints JSON on stdout. Errors go to
// stderr as JSON, with exit code 1.
import { commands } from "./commands.ts";

try {
  const args = process.argv.slice(2);
  const command = commands.find(({ words }) => words.every((word, index) => args[index] === word));
  if (command === undefined) {
    const known = commands.map(({ words }) => words.join(" ")).join(", ");
    throw new Error(args.length === 0 ? `Give a command: ${known}.` : `Unknown command "${args.join(" ")}". The commands are: ${known}.`);
  }
  const result = await command.run(args.slice(command.words.length));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ error: error instanceof Error ? error.message : String(error) })}\n`);
  process.exitCode = 1;
}
