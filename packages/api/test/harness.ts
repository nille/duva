// The API test harness: the real handlers, authorizer, inbound handler and sender in-process, with
// DynamoDB Local (started by dynamodb-local.ts) for DynamoDB and its stream, an in-memory stand-in
// for the mail bucket, stand-ins for SES receiving and sending, and a test token issuer in place of
// Cognito. Tests drive the API only through the generated client, hand mail to SES as a sender's
// server does, and read what SES sent.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { CreateTableCommand } from "@aws-sdk/client-dynamodb";
import type { ReceiptRule } from "@aws-sdk/client-ses";
import PostalMime from "postal-mime";
import { createDuvaClient, type DuvaClient } from "@duva/client";
import { inject } from "vitest";
import { createApi } from "../src/api.ts";
import { createAuthorizer } from "../src/authorizer.ts";
import type { Humans } from "../src/user-pool.ts";
import { createInbound } from "../src/inbound.ts";
import { senderFilter, senderRetries, tableKey, tableStreamView } from "../src/infrastructure.ts";
import type { MailBucket } from "../src/mail-bucket.ts";
import { addHumanToOrganization, setUpOrganization } from "../src/organization.ts";
import { createSender } from "../src/sending.ts";
import { dynamodbLocal } from "./dynamodb-local.ts";
import { gateway } from "./gateway.ts";
import { managedLogin, managedLoginClientId } from "./managed-login.ts";
import { type Envelope, type ReceiveOptions, sesReceiving, sesSending } from "./ses.ts";
import { tableStream } from "./streams.ts";
import { TestTokenIssuer } from "./token-issuer.ts";

declare module "vitest" {
  export interface ProvidedContext {
    dynamodbEndpoint: string;
  }
}

export interface DuvaOptions {
  version?: string;
  region?: string;
  /** The organization's first domain. */
  domain?: string;
  /** The first admin's email address. */
  admin?: string;
  /** The email addresses of other humans in the organization, who aren't admins. The first admin added them. */
  humans?: string[];
  /** How many seconds the access tokens of human sessions last. */
  accessTokenLifetime?: number;
  /** Whether the account is in the SES sandbox, where SES refuses mail to anyone not on the domain. */
  sandbox?: boolean;
  /** Whether SES's answers to sends get lost, though SES accepted the messages. */
  sesAnswersLost?: boolean;
  /** How many times Lambda runs the sender for each stream record, as a retried batch can. */
  senderInvocations?: number;
}

/** A Duva deployment running in-process, set up as duva deploy sets one up, with its own table and mail bucket. */
export interface Duva {
  /** The generated client, talking to the API in-process, signed in as nobody. */
  client: DuvaClient;
  /** The generated client, signed in as the human at `email`. */
  signIn(email: string): DuvaClient;
  /** The generated client, calling with the agent key, as an agent does. */
  withKey(key: string): DuvaClient;
  /** A fresh access token for the human at `email`, as Cognito issues one when they sign in. */
  accessToken(email: string): string;
  /** Ends every human's session, as when its refresh token expires. */
  endSessions(): void;
  /**
   * Hands the raw message to SES, as the sender's mail server does, and waits until Duva has
   * processed it. Returns the recipients SES refused during delivery. The envelope sender defaults
   * to the message's From. With `invocations`, Lambda runs the inbound handler that many times.
   * SES judges the message by `verdicts`, which pass unless given.
   */
  receive(
    raw: string | Uint8Array,
    envelope: Partial<Envelope> & Pick<Envelope, "to">,
    options?: ReceiveOptions,
  ): Promise<{ refused: string[] }>;
  /** The receipt rules in Duva's rule set, as SES describes them. */
  receiptRules(): ReceiptRule[];
  /** The raw messages SES accepted for sending, oldest first. Each API call returns once the sends it led to are done. */
  sent(): string[];
  /**
   * Moves Duva to a new user pool, as the deploy of #30 did. No human can sign in there, and every
   * session ends, until setUp() moves the humans.
   */
  replaceUserPool(): void;
  /** Sets the organization up again, as a re-run of duva deploy does. */
  setUp(options: { admin: string }): Promise<void>;
  /**
   * Serves the API on localhost, for clients that need a URL, such as the CLI, with a stand-in
   * for managed login at the same URL.
   */
  listen(): Promise<{ url: string; signIn: { url: string; clientId: string }; close(): Promise<void> }>;
}

export async function startDuva({
  version = "0.0.0-test",
  region = "eu-north-1",
  domain = "example.com",
  admin = "ada@example.com",
  humans: others = [],
  accessTokenLifetime = 3600,
  sandbox = false,
  sesAnswersLost = false,
  senderInvocations = 1,
}: DuvaOptions = {}): Promise<Duva> {
  const { table, streamArn } = await createTable();
  const humans = memoryHumans();
  const issuer = new TestTokenIssuer();
  const setUp = (options: { admin: string }) => setUpOrganization({ table, humans }, { domain, ...options });
  const firstAdmin = await setUp({ admin });
  for (const email of others) await addHumanToOrganization({ table, humans }, { email, by: firstAdmin.id });

  const mailBucket = memoryMailBucket();
  const ses = sesReceiving({
    buckets: new Map([[mailBucketName, mailBucket]]),
    functions: new Map([[inboundFunction, createInbound({ table, mailBucket })]]),
  });
  const receiving = { rules: ses.rules, bucket: mailBucketName, inboundFunction };
  const sending = sesSending({ region, domain, sandbox, answersLost: sesAnswersLost });
  const stream = tableStream(inject("dynamodbEndpoint"), streamArn, [
    { filter: senderFilter, handler: createSender({ table, mailBucket, outbound: sending.outbound, region }), retries: senderRetries, invocations: senderInvocations },
  ]);
  const gatewayed = gateway(
    createApi({ version, region, table, humans, mailBucket, receiving }),
    createAuthorizer({ table, verifyAccessToken: issuer.verify }),
  );
  // A call returns once the stream has handed what it wrote to the sender, so tests see the outcome.
  const api = async (request: Request) => {
    const response = await gatewayed(request);
    await stream.deliver();
    return response;
  };
  const login = managedLogin({ ids: humans.ids, issuer, accessTokenLifetime });
  const client = (headers?: Record<string, string>) => createDuvaClient("http://duva.test", { fetch: api, headers });
  const accessToken = (email: string) => {
    const id = humans.ids.get(email);
    if (id === undefined) throw new Error(`${email} isn't a human in the organization`);
    return issuer.issue(id, accessTokenLifetime);
  };
  return {
    client: client(),
    signIn: (email) => client({ authorization: `Bearer ${accessToken(email)}` }),
    withKey: (key) => client({ authorization: `Bearer ${key}` }),
    accessToken,
    endSessions: () => login.endSessions(),
    replaceUserPool() {
      humans.ids.clear();
      issuer.replaceKeys();
      login.endSessions();
    },
    receive: async (raw, { from, to }, options) => ses.receive(raw, { from: from ?? (await senderOf(raw)), to }, options),
    receiptRules: () => ses.describeRules(),
    sent: () => sending.sent(),
    setUp: async (options) => {
      await setUp(options);
    },
    async listen() {
      const server = await listen(async (request) => (await login.handle(request)) ?? api(request));
      return { ...server, signIn: { url: server.url, clientId: managedLoginClientId } };
    },
  };
}

// What SES knows the deployment's mail bucket and inbound Lambda by.
const mailBucketName = "duva-mail";
const inboundFunction = "arn:aws:lambda:eu-north-1:000000000000:function:DuvaInbound";

async function senderOf(raw: string | Uint8Array): Promise<string> {
  const { from } = await PostalMime.parse(raw);
  if (from?.address === undefined) throw new Error("The message has no From, so give the envelope sender.");
  return from.address;
}

/**
 * Humans who can sign in, by email address, with the IDs their sign-ins carry. As in Duva's user
 * pool, an address is the same sign-in name in any case.
 */
function memoryHumans(): Humans & { ids: Map<string, string> } {
  const ids = new (class extends Map<string, string> {
    override get(email: string) {
      return super.get(email.toLowerCase());
    }
    override set(email: string, id: string) {
      return super.set(email.toLowerCase(), id);
    }
    override has(email: string) {
      return super.has(email.toLowerCase());
    }
    override delete(email: string) {
      return super.delete(email.toLowerCase());
    }
  })();
  return {
    ids,
    async add(email) {
      const id = ids.get(email) ?? randomUUID();
      ids.set(email, id);
      return id;
    },
  };
}

async function createTable() {
  const client = dynamodbLocal(inject("dynamodbEndpoint"));
  const name = `duva-${randomUUID()}`;
  const { TableDescription } = await client.send(
    new CreateTableCommand({
      TableName: name,
      StreamSpecification: { StreamEnabled: true, StreamViewType: tableStreamView },
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
  return { table: { client, name }, streamArn: TableDescription!.LatestStreamArn! };
}

function memoryMailBucket(): MailBucket {
  const objects = new Map<string, Uint8Array>();
  return {
    async put(key, body) {
      objects.set(key, body);
    },
    async get(key) {
      return objects.get(key);
    },
    async erase(key) {
      objects.delete(key);
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
