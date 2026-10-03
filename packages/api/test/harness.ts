// The API test harness: the real handlers in-process, with DynamoDB Local (started by
// dynamodb-local.ts) for DynamoDB and an in-memory stand-in for S3. Tests drive it only
// through the generated client.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { CreateTableCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { createDuvaClient, type DuvaClient } from "@duva/client";
import { inject } from "vitest";
import { createApi } from "../src/api.ts";
import type { MailStore } from "../src/mail-store.ts";
import { tableKey } from "../src/table.ts";
import { gateway } from "./gateway.ts";

declare module "vitest" {
  export interface ProvidedContext {
    dynamodbEndpoint: string;
  }
}

export interface DuvaOptions {
  version?: string;
  region?: string;
}

/** A Duva deployment running in-process, with its own empty table and mail store. */
export interface Duva {
  /** The generated client, talking to the API in-process. */
  client: DuvaClient;
  /** Serves the API on localhost, for clients that need a URL, such as the CLI. */
  listen(): Promise<{ url: string; close(): Promise<void> }>;
}

export async function startDuva({ version = "0.0.0-test", region = "eu-north-1" }: DuvaOptions = {}): Promise<Duva> {
  const api = gateway(createApi({ version, region, table: await createTable(), mail: memoryMailStore() }));
  return {
    client: createDuvaClient("http://duva.test", { fetch: api }),
    listen: () => listen(api),
  };
}

async function createTable() {
  const client = new DynamoDBClient({
    endpoint: inject("dynamodbEndpoint"),
    region: "eu-north-1",
    credentials: { accessKeyId: "local", secretAccessKey: "local" },
  });
  const name = `duva-${randomUUID()}`;
  await client.send(
    new CreateTableCommand({
      TableName: name,
      BillingMode: "PAY_PER_REQUEST",
      AttributeDefinitions: [
        { AttributeName: tableKey.partitionKey, AttributeType: "S" },
        { AttributeName: tableKey.sortKey, AttributeType: "S" },
      ],
      KeySchema: [
        { AttributeName: tableKey.partitionKey, KeyType: "HASH" },
        { AttributeName: tableKey.sortKey, KeyType: "RANGE" },
      ],
    }),
  );
  return { client, name };
}

function memoryMailStore(): MailStore {
  const objects = new Map<string, Uint8Array>();
  return {
    async put(key, body) {
      objects.set(key, body);
    },
    async get(key) {
      return objects.get(key);
    },
  };
}

async function listen(api: (request: Request) => Promise<Response>) {
  const server = createServer(async (incoming, outgoing) => {
    const chunks: Buffer[] = [];
    for await (const chunk of incoming) chunks.push(chunk);
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) {
      if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
    }
    const response = await api(
      new Request(new URL(incoming.url ?? "/", "http://127.0.0.1").href, {
        method: incoming.method,
        headers,
        body: chunks.length > 0 ? Buffer.concat(chunks) : undefined,
      }),
    );
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}
