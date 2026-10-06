// Vitest global setup: starts DynamoDB Local once per test run. It runs on Java, which must be on the PATH.
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { DynamoDBClient, ListTablesCommand } from "@aws-sdk/client-dynamodb";
import { spawn } from "dynamo-db-local";
import type { TestProject } from "vitest/node";
import { tableKey } from "../src/infrastructure.ts";

export default async function setup(project: TestProject) {
  const port = await freePort();
  // Without -sharedDb, DynamoDB Local keeps a database for each access key, and runs each
  // database's requests one at a time, so tests in parallel use databases of their own.
  const dynamodb = spawn({ port });
  let output = "";
  let failure: Error | undefined;
  dynamodb.stdout?.on("data", (chunk) => (output += chunk));
  dynamodb.stderr?.on("data", (chunk) => (output += chunk));
  dynamodb.once("error", (error) => (failure = new Error(`DynamoDB Local needs Java on the PATH: ${error.message}`)));
  dynamodb.once("exit", (code) => (failure ??= new Error(`DynamoDB Local exited with code ${code}:\n${output}`)));

  const endpoint = `http://127.0.0.1:${port}`;
  await untilReady(dynamodbLocal({ endpoint, accessKeyId: "local" }, 1), () => failure);
  project.provide("dynamodbEndpoint", endpoint);
  return () => {
    dynamodb.kill();
  };
}

/** A database in DynamoDB Local, which keeps one for each access key, any letters and digits. */
export interface LocalDatabase {
  endpoint: string;
  accessKeyId: string;
}

/** What a client of DynamoDB or its streams needs to reach the database, which takes any secret. */
export function localClientConfig({ endpoint, accessKeyId }: LocalDatabase) {
  return { endpoint, region: "eu-north-1", credentials: { accessKeyId, secretAccessKey: "local" } };
}

/**
 * A client for the database in DynamoDB Local. DynamoDB keeps no order of an item's attributes,
 * where DynamoDB Local keeps the order they were written in, so this client lists the attributes
 * of each item it reads, and those of each map in them, in an order of the item's own, by a hash
 * of its key and their names. An item comes back the same way each time it is read, and two items
 * with the same attributes almost always in different orders.
 */
export function dynamodbLocal(database: LocalDatabase, maxAttempts?: number): DynamoDBClient {
  const client = new DynamoDBClient({ ...localClientConfig(database), maxAttempts });
  client.middlewareStack.add(
    (next) => async (args) => {
      const result = await next(args);
      const output = result.output as unknown as Record<string, unknown>;
      for (const name of ["Item", "Items", "Attributes", "Responses"]) if (output[name] !== undefined) output[name] = inOwnOrder(output[name]);
      return result;
    },
    { step: "initialize" },
  );
  return client;
}

/** The items in the value, each with its attributes in its own order. */
function inOwnOrder(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(inOwnOrder);
  if (value?.constructor !== Object) return value;
  const item = value as Record<string, unknown>;
  const key = [tableKey.partitionKey, tableKey.sortKey].map((name) => (item[name] as { S?: string } | undefined)?.S ?? item[name]);
  if (key.some((part) => typeof part !== "string")) return Object.fromEntries(Object.entries(item).map(([name, inner]) => [name, inOwnOrder(inner)]));
  return shuffled(item, key.join("|"));
}

/** The value with each object's properties in an order the seed gives, however deep. */
function shuffled(value: unknown, seed: string): unknown {
  if (Array.isArray(value)) return value.map((inner, index) => shuffled(inner, `${seed}|${index}`));
  if (value?.constructor !== Object) return value;
  const rank = (name: string) => createHash("sha256").update(`${seed}|${name}`).digest("hex");
  return Object.fromEntries(
    Object.entries(value as object)
      .sort(([a], [b]) => (rank(a) < rank(b) ? -1 : 1))
      .map(([name, inner]) => [name, shuffled(inner, `${seed}|${name}`)]),
  );
}

async function untilReady(client: DynamoDBClient, failure: () => Error | undefined) {
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      await client.send(new ListTablesCommand({}));
      return;
    } catch (error) {
      const failed = failure();
      if (failed !== undefined) throw failed;
      if (Date.now() > deadline) throw new Error("DynamoDB Local did not start", { cause: error });
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => (typeof address === "object" && address ? resolve(address.port) : reject(new Error("No port"))));
    });
  });
}
