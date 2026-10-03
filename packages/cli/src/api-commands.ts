import { parseArgs } from "node:util";
import { createDuvaClient } from "@duva/client";
import { operations, type Operation } from "@duva/openapi";
import type { Command } from "./commands.ts";
import { readConfig } from "./config.ts";

/** One command for each operation in the OpenAPI document, named by its x-cli-command. */
export const apiCommands: Command[] = operations.map((operation) => ({
  words: operation.command,
  summary: operation.summary,
  run: (args) => call(operation, args),
}));

async function call(operation: Operation, args: string[]): Promise<unknown> {
  parseArgs({ args, options: {} });
  const { apiUrl } = await readConfig();
  if (apiUrl === undefined) throw new Error("No Duva deployment is configured. Run duva deploy first.");

  const client = createDuvaClient(apiUrl);
  const { data, response } = await client.request(operation.method, operation.path).catch((error: unknown) => {
    throw new Error(`Couldn't reach Duva at ${apiUrl}: ${error instanceof Error ? error.message : error}`);
  });
  if (!response.ok) throw new Error(`Duva at ${apiUrl} answered ${response.status} ${response.statusText}.`);
  return data;
}
