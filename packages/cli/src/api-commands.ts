import { createDuvaClient } from "@duva/client";
import { operations, type Operation, type OperationId } from "@duva/openapi";
import { type Command, optionValues } from "./commands.ts";
import { readConfig } from "./config.ts";
import { accessToken } from "./session.ts";

/** The environment variable an agent's key reaches the CLI in, in place of a human's session. */
export const agentKeyVariable = "DUVA_AGENT_KEY";

/** What a call passes, from the command's options: its query, its path parameters and its JSON body. */
interface Call {
  query?: Record<string, string | number | boolean>;
  path?: Record<string, string | number>;
  body?: Record<string, string | number | boolean | string[]>;
}

/**
 * One command for each operation in the OpenAPI document, named by its x-cli-command. Query and
 * path parameters and the properties of a JSON body are options, a list is an option given
 * once for each of its items, and a boolean is a flag.
 */
export const apiCommands: Command[] = operations.map((operation) => {
  const command: Command = {
    words: operation.command,
    summary: operation.summary,
    description: operation.description,
    options: operation.options,
    run: (args) => callApi(operation.operationId, callOf(operation, optionValues(command, args))),
  };
  return command;
});

function callOf(operation: Operation, values: Record<string, string | string[] | boolean | undefined>): Call {
  const call: Required<Call> = { query: {}, path: {}, body: {} };
  for (const { name, in: place, type, required } of operation.options) {
    const value = values[name];
    if (typeof value === "boolean") {
      if (place !== "path") call[place][name] = value;
      continue;
    }
    if (type === "strings" && Array.isArray(value)) {
      call[place][name] = value;
      continue;
    }
    if (typeof value !== "string") {
      if (required) throw new Error(`Give --${name}.`);
      continue;
    }
    if (type === "integer" && !/^\d+$/.test(value)) throw new Error(`${JSON.stringify(value)} isn't a whole number. Give --${name} one from 0.`);
    call[place][name] = type === "integer" ? Number(value) : value;
  }
  return call;
}

type Answer = { data?: unknown; error?: unknown; response: Response };

/**
 * Calls the operation on the configured deployment. If it needs sign-in, the call is the agent's
 * whose key is in DUVA_AGENT_KEY, or else the signed-in human's.
 */
export async function callApi(operationId: OperationId, { query = {}, path = {}, body }: Call = {}): Promise<unknown> {
  const operation = operations.find((candidate) => candidate.operationId === operationId);
  if (operation === undefined) throw new Error(`No operation is called ${operationId}.`);
  const { apiUrl, signIn } = await readConfig();
  if (apiUrl === undefined) throw new Error("No Duva deployment is configured. Run duva deploy first.");

  const agentKey = process.env[agentKeyVariable] || undefined;
  const headers = operation.signIn ? { authorization: `Bearer ${agentKey ?? (await accessToken(signIn))}` } : undefined;
  const client = createDuvaClient(apiUrl, { headers });
  const hasBody = operation.options.some((option) => option.in === "body");
  // The generated options say what the operation takes, which the client's types can't follow here.
  const request = client.request.bind(client) as (method: string, path: string, init: object) => Promise<Answer>;
  const { data, error, response } = await request(operation.method, operation.path, { params: { query, path }, body: hasBody ? body : undefined })
    .catch((error: unknown) => {
      throw new Error(`Couldn't reach Duva at ${apiUrl}: ${error instanceof Error ? error.message : error}`);
    });
  if (response.status === 401) {
    throw new Error(
      agentKey === undefined
        ? "Duva didn't accept your session. Run duva login to sign in again."
        : `Duva didn't accept the agent key in ${agentKeyVariable}. It may have been rotated. Ask the agent's sponsor for its current key.`,
    );
  }
  if (!response.ok) {
    const message = (error as { message?: unknown } | undefined)?.message;
    throw new Error(`Duva at ${apiUrl} answered ${response.status} ${response.statusText}${typeof message === "string" ? `: ${message}` : "."}`);
  }
  return data;
}
