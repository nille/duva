import { parseArgs } from "node:util";
import { createDuvaClient } from "@duva/client";
import { operations, type Operation, type OperationId } from "@duva/openapi";
import type { Command } from "./commands.ts";
import { readConfig } from "./config.ts";
import { accessToken } from "./session.ts";

/** One command for each operation in the OpenAPI document, named by its x-cli-command. Query parameters are options. */
export const apiCommands: Command[] = operations.map((operation) => ({
  words: operation.command,
  summary: operation.summary,
  run: (args) => callApi(operation.operationId, queryOf(operation, args)),
}));

function queryOf(operation: Operation, args: string[]): Record<string, string | number> {
  const { values } = parseArgs({
    args,
    options: Object.fromEntries(operation.query.map(({ name }) => [name, { type: "string" as const }])),
  });
  const query: Record<string, string | number> = {};
  for (const { name, type } of operation.query) {
    const value = values[name];
    if (typeof value !== "string") continue;
    if (type === "integer" && !/^\d+$/.test(value)) throw new Error(`${JSON.stringify(value)} isn't a whole number. Give --${name} one from 0.`);
    query[name] = type === "integer" ? Number(value) : value;
  }
  return query;
}

/** Calls the operation on the configured deployment, as the signed-in human if it needs sign-in. */
export async function callApi(operationId: OperationId, query: Record<string, string | number> = {}): Promise<unknown> {
  const operation = operations.find((candidate) => candidate.operationId === operationId);
  if (operation === undefined) throw new Error(`No operation is called ${operationId}.`);
  const { apiUrl, signIn } = await readConfig();
  if (apiUrl === undefined) throw new Error("No Duva deployment is configured. Run duva deploy first.");

  const headers = operation.signIn ? { authorization: `Bearer ${await accessToken(signIn)}` } : undefined;
  const client = createDuvaClient(apiUrl, { headers });
  const { data, error, response } = await client.request(operation.method, operation.path, { params: { query } }).catch((error: unknown) => {
    throw new Error(`Couldn't reach Duva at ${apiUrl}: ${error instanceof Error ? error.message : error}`);
  });
  if (response.status === 401) throw new Error("Duva didn't accept your session. Run duva login to sign in again.");
  if (!response.ok) {
    const message = (error as { message?: unknown } | undefined)?.message;
    throw new Error(`Duva at ${apiUrl} answered ${response.status} ${response.statusText}${typeof message === "string" ? `: ${message}` : "."}`);
  }
  return data;
}
