// Vitest global setup: starts DynamoDB Local once per test run. It runs on Java, which must be on the PATH.
import { createServer } from "node:net";
import { DynamoDBClient, ListTablesCommand } from "@aws-sdk/client-dynamodb";
import { spawn } from "dynamo-db-local";
import type { TestProject } from "vitest/node";

export default async function setup(project: TestProject) {
  const port = await freePort();
  const dynamodb = spawn({ port, sharedDb: true });
  let output = "";
  let failure: Error | undefined;
  dynamodb.stdout?.on("data", (chunk) => (output += chunk));
  dynamodb.stderr?.on("data", (chunk) => (output += chunk));
  dynamodb.once("error", (error) => (failure = new Error(`DynamoDB Local needs Java on the PATH: ${error.message}`)));
  dynamodb.once("exit", (code) => (failure ??= new Error(`DynamoDB Local exited with code ${code}:\n${output}`)));

  const endpoint = `http://127.0.0.1:${port}`;
  await untilReady(dynamodbLocal(endpoint, 1), () => failure);
  project.provide("dynamodbEndpoint", endpoint);
  return () => {
    dynamodb.kill();
  };
}

/** A client for DynamoDB Local at `endpoint`, which takes any credentials. */
export function dynamodbLocal(endpoint: string, maxAttempts?: number): DynamoDBClient {
  return new DynamoDBClient({
    endpoint,
    region: "eu-north-1",
    credentials: { accessKeyId: "local", secretAccessKey: "local" },
    maxAttempts,
  });
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
