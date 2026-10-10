// The API test harness: the real handlers, authorizer, inbound handler, sender and eraser in-process, with
// DynamoDB Local (started by dynamodb-local.ts) for DynamoDB and its stream, in-memory stand-ins
// for the mail bucket, the uploads bucket and its presigned URLs, and for the inbound Lambda's log, stand-ins for SES receiving and sending, a
// stand-in internet for the unsubscriber and the logo fetcher, a test Mark Verifying Authority, a test token issuer in place of Cognito, and search indexes
// in LanceDB on local disk, with a stand-in for the indexer's FIFO queue and Titan's recorded vectors. Tests drive
// the API only through the generated client, hand mail to SES as a sender's server does, read what
// SES sent, and put web servers on the internet to see what the unsubscriber sends them.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { randomUUID, X509Certificate } from "node:crypto";
import { CreateTableCommand, DeleteItemCommand, PutItemCommand, ScanCommand } from "@aws-sdk/client-dynamodb";
import type { ReceiptRule } from "@aws-sdk/client-ses";
import type { SESEvent, SNSEvent } from "aws-lambda";
import PostalMime from "postal-mime";
import { createDuvaClient, type DuvaClient } from "@duva/client";
import { DeleteCommand, GetCommand, PutCommand, ScanCommand as ScanDocuments, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { inject, onTestFinished, vi } from "vitest";
import { createApi } from "../src/api.ts";
import { listEarlierDecisions } from "../src/approval-log.ts";
import { decisionPrefix } from "../src/decisions.ts";
import { documents } from "../src/table.ts";
import { createFeedback } from "../src/feedback.ts";
import { createDownloads, downloadLinkLifetime as linkLifetime } from "../src/attachments.ts";
import { createAuthorizer } from "../src/authorizer.ts";
import type { Humans, SignInSender } from "../src/user-pool.ts";
import type { RecordType } from "../src/dns-records.ts";
import { createEraser, eraseBlockedSenders, type Eraser, type EraserEvent } from "../src/erasure.ts";
import { syncRecipients } from "../src/receiving.ts";
import { eraseAgentsMailboxes } from "../src/removal.ts";
import { createInbound } from "../src/inbound.ts";
import { createFeeder, createIndexer, type IndexQueue, indexMailboxes, type QueuedTask } from "../src/indexing.ts";
import { alertMailFilter, conversationPath, mcpRoutes, tokenHeader, feederFilter, taskGiverFilter, hostedLogoHeaders, hostedLogosPath, senderFilter, senderRetries, tableKey, tableStreamView } from "../src/infrastructure.ts";
import { lanceSearch } from "../src/lancedb-search.ts";
import { createSearcher } from "../src/searching.ts";
import type { Table } from "../src/deployment.ts";
import type { MailBucket } from "../src/mail-bucket.ts";
import { keys, timeEarlierLabels } from "../src/mail.ts";
import { actorKey, addHumanToOrganization, addKeylessAgent, addMailbox, agentSettingsKey, carryOverModelChoices, firstAgentSettings, mailboxKey, ownedMailboxes, screenerKey, settingsKey, setUpOrganization } from "../src/organization.ts";
import type { SendEvent } from "../src/limits.ts";
import { setUpDeliveries, setUpScreeners } from "../src/screening.ts";
import { type Decider, type Model, runAgent } from "../src/agent-loop.ts";
import { standIn } from "../src/strands.ts";
import { type AgentRuntime, type ConversationEvent, createConversation, type PreparedTurn } from "../src/conversation.ts";
import { createTaskGiver, createTaskRunner, type TaskRef, type TaskRunner, type TaskRunnerEvent } from "../src/tasks.ts";
import { createUnsubscribeRunner } from "../src/unsubscribe-runs.ts";
import { standInBrowser } from "./browser.ts";
import { createMcp } from "../src/mcp.ts";
import { giveMailboxAgents, mailboxAgentName, mailboxAgentSettings, turnPrefix } from "../src/mailbox-agents.ts";
import type { ReminderDue } from "../src/reminders.ts";
import { createSender } from "../src/sending.ts";
import type { SuppressionReason } from "../src/suppression.ts";
import { fetchForLogo, logoUrl } from "../src/sender-logos.ts";
import { postOneClick } from "../src/unsubscriber.ts";
import { type HostedLogos, logoCacheControl } from "../src/own-logos.ts";
import { dynamodbLocal } from "./dynamodb-local.ts";
import { gateway } from "./gateway.ts";
import { managedLogin, managedLoginClientId, mcpAppClientId } from "./managed-login.ts";
import { type ConnectedMcpClient, connectMcpClient, type McpClientOptions } from "./mcp-client.ts";
import { type Bounce, type Envelope, memoryDns, type PublishOptions, type ReceiveOptions, type SendingEvent, sesIdentities, sesReceiving, sesSending, type StoredIdentity } from "./ses.ts";
import { tableStream } from "./streams.ts";
import { recordedNova } from "./nova.ts";
import { recordedTitan } from "./titan.ts";
import { TestTokenIssuer } from "./token-issuer.ts";
import { memoryUploadsBucket } from "./uploads-bucket.ts";
import { type ReceivedRequest, standInInternet, type WebServerOptions } from "./web.ts";

/** The root of the tests' own Mark Verifying Authority, whose mark certificates verify logos. */
const testMarkRoot = new X509Certificate(readFileSync(new URL("marks/root.pem", import.meta.url)));

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
  /** Domains with an SES identity in the region that someone other than Duva created. */
  othersIdentities?: string[];
  /** Whether the account is in the SES sandbox, where SES refuses mail to anyone not on the domain. */
  sandbox?: boolean;
  /** Whether SES's answers to sends get lost, though SES accepted the messages. */
  sesAnswersLost?: boolean;
  /** How many times Lambda runs the sender for each stream record, as a retried batch can. */
  senderInvocations?: number;
  /** Whether the eraser's runs for each Trash emptied and each mailbox deleted are lost, as when every one of Lambda's attempts fails. */
  eraserRunsLost?: boolean;
  /** How many seconds a download link works. */
  downloadLinkLifetime?: number;
  /** Whether the sender reads the table's stream only at releaseSends(), as when Lambda falls behind. */
  sendsHeld?: boolean;
  /**
   * Whether the deployment runs a version from before the Screener until setUp() deploys this one:
   * its mailboxes have no Screener, and what they send isn't noted for it.
   */
  beforeScreener?: boolean;
  /**
   * Whether the deployment runs a version from before deliveries until setUp() deploys this one:
   * its mailboxes let senders in or block them, and list no thread by whom it is from.
   */
  beforeDeliveries?: boolean;
  /** Whether the indexer reads its queue only at releaseIndexing(), as when Lambda falls behind. */
  indexingHeld?: boolean;
  /**
   * Whether the deployment runs a version from before search until setUp() deploys this one, so
   * nothing indexes its mail until then.
   */
  beforeSearch?: boolean;
  /**
   * Whether the deployment runs a version from before the approval log until setUp() deploys this
   * one, so the decisions made until then aren't in it.
   */
  beforeApprovalLog?: boolean;
  /**
   * The organization's undo window in seconds, as its admins set it before the test. 0 unless
   * given, so approved sends go out at once; null leaves Duva's own default.
   */
  undoWindow?: number | null;
  /**
   * Whether the deployment runs a version from before mailbox agents until setUp() deploys this
   * one, so mailboxes created until then have none.
   */
  beforeMailboxAgents?: boolean;
  /**
   * Whether the deployment runs a version from before mailbox agents were named Coo until setUp()
   * deploys this one, so its mailbox agents are called Mailbox agent until then.
   */
  beforeCoo?: boolean;
  /**
   * Whether the deployment runs a version from before one mailbox agent per human until setUp()
   * deploys this one, so each mailbox has a mailbox agent of its own until then, and each human a
   * conversation with each (ADR-0033).
   */
  beforeOneCoo?: boolean;
  /**
   * The model settings admins chose on a version from before each human picked their mailbox
   * agent's models from measured ones (ADR-0035), stored as that version stored them, until
   * setUp() deploys this one: mailboxAgentModel, mailboxAgentTaskModel, mailboxAgentHarderModel,
   * mailboxAgentProfile and mailboxAgentRegion.
   */
  earlierModelSettings?: Record<string, string>;
  /**
   * The model the mailbox agents ask, in place of Claude on Bedrock: a stand-in that answers as a
   * test scripts it, from what it is asked. Unless given, it answers every turn with "Stand-in answer."
   */
  model?: Model;
  /**
   * The decider the mailbox agents ask whether a conversation turn is simple, in place of Nova
   * Micro on Bedrock. Unless given, it finds every turn simple, and is sure.
   */
  decider?: Decider;
  /**
   * Whether the task runner runs the tasks labels' prompts give only at releaseTasks(), as when
   * Lambda falls behind, so they wait until then.
   */
  tasksHeld?: boolean;
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
   * SES judges the message by `verdicts`, which pass unless given, and receives it `at` the time
   * given, or now. Also returns the ID SES gave the message, unless it refused every recipient.
   */
  receive(
    raw: string | Uint8Array,
    envelope: Partial<Envelope> & Pick<Envelope, "to">,
    options?: ReceiveOptions,
  ): Promise<{ refused: string[]; messageId?: string }>;
  /** The lines the inbound Lambda wrote to its log, oldest first, as CloudWatch Logs keeps them. */
  inboundLog(): string[];
  /** The receipt rules in Duva's rule set, as SES describes them. */
  receiptRules(): ReceiptRule[];
  /** The bounces SES sent for messages it received, oldest first, as a group refuses one. */
  bounces(): Bounce[];
  /**
   * The domain identities SES has in the region, in alphabetical order, each with its configuration
   * set, its MAIL FROM domain and its DKIM tokens. The first domain's is there from the start, verified.
   */
  emailIdentities(): StoredIdentity[];
  /**
   * Puts the records of the type at the name in DNS, replacing any there, as an admin does at the
   * domain's DNS provider, or a sender at theirs. SES verifies an identity once DNS has the records it needs.
   */
  dnsRecord(type: RecordType, name: string, values: string[]): void;
  /** The address the user pool sends sign-in codes from, as Cognito's EmailConfiguration names it. */
  signInCodesFrom(): string;
  /** The raw messages SES accepted for sending, oldest first. Each API call returns once the sends it led to are done. */
  sent(): string[];
  /**
   * Has SES publish the event for the message it sent with the ID, as when a recipient's server
   * bounces it, a recipient complains or SES rejects it, through Duva's configuration set and its
   * topic, and waits until Duva has processed it. SES reports it `at` the time given, or now, and
   * SNS delivers it `deliveries` times, once unless given. With `again`, SNS delivers the event
   * last published for the message once more, as a late redelivery does. Returns once the sends
   * it led to are done, unless sends are held.
   */
  sendingEvent(messageId: string, event: SendingEvent, options?: PublishOptions): Promise<void>;
  /** Lets the sender read the table's stream when sendsHeld, and waits until the sends it held are done. */
  releaseSends(): Promise<void>;
  /**
   * Moves the clock Duva reads to the time, for the rest of the test, from where it goes on, and
   * has EventBridge Scheduler invoke what it had scheduled until then, in order, as it does at
   * those times. The uploads bucket's lifecycle rule gives up each upload started a day before.
   */
  clock(at: Date): Promise<void>;
  /**
   * The recipients SES delivered each message in sent() to, in the same order, Bcc recipients
   * included, and none on SES's suppression list.
   */
  sentTo(): string[][];
  /**
   * The addresses on the account's suppression list, in alphabetical order, each with why SES put
   * it there. SES puts each address that hard-bounces or complains there, as the account is set to.
   */
  suppressionList(): { address: string; reason: SuppressionReason }[];
  /** The raw messages the mail bucket keeps, received and sent, every version of each. */
  stored(): string[];
  /**
   * Sends the bytes to a URL Duva gave for a part of a file, as a browser or the CLI uploads it
   * straight to S3, and gives what S3 answered.
   */
  upload(url: string, body: Uint8Array<ArrayBuffer>): Promise<Response>;
  /** The files the uploads bucket keeps, as text, and how many uploads to it were neither completed nor given up. */
  uploads(): { files: string[]; incomplete: number };
  /** Every object the search bucket keeps, each file of each mailbox's index, as text. */
  searchObjects(): string[];
  /**
   * Runs the eraser as its daily schedule does, at the time. With `s3DeletesFail`, S3 refuses to
   * delete anything during the run, which then fails, as a run that stops partway does.
   */
  erase(at: Date, options?: { s3DeletesFail?: boolean }): Promise<void>;
  /**
   * Puts a web server on the internet the unsubscriber and the logo fetcher reach, at the host name, serving http on
   * port 80 and https on 443. Returns the requests it gets, as they arrive.
   */
  webServer(hostname: string, options?: WebServerOptions): Promise<ReceivedRequest[]>;
  /**
   * Follows a download link or a sender logo's URL, as a browser does, and gives what the download
   * Lambda answered through CloudFront, or the URL of one of the organization's own logos, and gives
   * what CloudFront served from the logos bucket.
   */
  download(url: string): Promise<Response>;
  /**
   * Moves Duva to a new user pool, as the deploy of #30 did. No human can sign in there, and every
   * session ends, until setUp() moves the humans.
   */
  replaceUserPool(): void;
  /**
   * Sets the organization up again, as a re-run of duva deploy does. With `backfillLost`, the
   * indexer's queue loses each backfill's next step, as when Lambda gives up on it.
   */
  setUp(options: { admin: string; backfillLost?: boolean }): Promise<void>;
  /**
   * Gives the agent a mailbox of its own at the address, with mail to it accepted, as an admin
   * could before agents owned none (ADR-0030), so a test sees what the setup after the deploy
   * that stops it does. Returns the mailbox's ID.
   */
  agentMailbox(agent: string, address: string): Promise<string>;
  /** Lets the indexer read its queue when indexingHeld, and waits until it has caught up. */
  releaseIndexing(): Promise<void>;
  /** Has the indexer's queue lose the next task that takes a step of a backfill, as when SQS drops it as a duplicate. */
  loseBackfillStep(): void;
  /**
   * Posts a turn of Ask Coo to the conversation Lambda as the web app does, through
   * CloudFront, as the human at `email`, unless `token` gives their access token, and reads all it
   * streams back. Each of the agent's runs on AgentCore asks the `model` option's stand-in, and
   * the `decider` option's whether the turn is simple. With `harder`, it asks the harder model to
   * answer the last turn again, as Think harder does.
   */
  askAgent(email: string, turn: { mailbox?: string; words?: string; harder?: boolean }, options?: { token?: string }): Promise<{ status: number; events?: ConversationEvent[]; body?: { message: string } }>;
  /** Lets the task runner run the tasks it held when tasksHeld, and waits until they are done or wait for an unpause. */
  releaseTasks(): Promise<void>;
  /**
   * Connects an MCP client to the MCP endpoint as Claude Code does: the MCP SDK's own client, which
   * finds how to sign in, registers itself as `options` say, signs in through managed login as the
   * human at `email`, then initializes. A tool's call returns once what it did is done, and a turn
   * it started may still run; the generated client's calls wait for those.
   */
  mcp(email: string, options?: McpClientOptions): Promise<ConnectedMcpClient>;
  /**
   * Serves the API on localhost, for clients that need a URL, such as the CLI, with a stand-in
   * for managed login and the MCP endpoint at the same URL.
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
  othersIdentities = [],
  sandbox = false,
  sesAnswersLost = false,
  senderInvocations = 1,
  eraserRunsLost = false,
  downloadLinkLifetime = linkLifetime,
  sendsHeld = false,
  beforeScreener = false,
  beforeDeliveries = false,
  indexingHeld = false,
  beforeSearch = false,
  beforeApprovalLog = false,
  undoWindow = 0,
  beforeMailboxAgents = false,
  beforeCoo = false,
  beforeOneCoo = false,
  earlierModelSettings,
  model = standInModel,
  decider = standInDecider,
  tasksHeld = false,
}: DuvaOptions = {}): Promise<Duva> {
  const { table, streamArn, database } = await createTable();
  const humans = memoryHumans();
  const issuer = new TestTokenIssuer();
  const setUp = (options: { admin: string }) => setUpOrganization({ table, humans }, { domain, ...options });
  const firstAdmin = await setUp({ admin });
  for (const email of others) await addHumanToOrganization({ table, humans }, { email, by: firstAdmin.id });
  if (undoWindow !== null || earlierModelSettings !== undefined) {
    await documents(table).send(new PutCommand({ TableName: table.name, Item: { ...settingsKey, ...(undoWindow !== null && { undoWindowSeconds: undoWindow }), ...earlierModelSettings, version: 1 } }));
  }

  const mailBucket = memoryMailBucket();
  // The uploads bucket's presigned URLs lead to the API's own URL, under /uploads-bucket/, once it listens.
  let uploadsUrl = `${inProcess}/uploads-bucket/`;
  const uploads = memoryUploadsBucket(() => uploadsUrl);
  // Trash emptied and mailboxes deleted in a call, which the eraser erases once the call is answered.
  const handed: EraserEvent[] = [];
  const inboundLog: string[] = [];
  const dns = memoryDns();
  const internet = standInInternet();
  const identities = sesIdentities({ region, dns, verified: [domain], others: othersIdentities, configurationSet: "duva-sending" });
  const signInSender = memorySignInSender(domain, identities.verified);
  // SES's events invoke the feedback Lambda, which changes SES's suppression list, so the two are tied once both exist.
  let feedback: (event: SNSEvent) => Promise<void> = async () => {};
  const sending = sesSending({ region, verified: identities.verified, sandbox, answersLost: sesAnswersLost, subscriber: (event) => feedback(event) });
  feedback = createFeedback({ table, suppressionList: sending.suppressionList });
  // The API and the inbound Lambda invoke the unsubscriber Lambda and wait for it, so its answer goes through JSON.
  const unsubscriber = { post: async (url: string) => JSON.parse(JSON.stringify(await postOneClick(internet.network, url))) };
  // SES invokes the inbound Lambda, which bounces through SES, so the two are tied once both exist.
  let inbound: (event: SESEvent) => Promise<void> = async () => {};
  const ses = sesReceiving({ verified: identities.verified, region, buckets: new Map([[mailBucketName, mailBucket]]), functions: new Map([[inboundFunction, (event) => inbound(event)]]) });
  // The inbound Lambda invokes the logo fetcher Lambda and waits for it, so its answer goes through JSON.
  const logos = {
    dns,
    fetcher: {
      async get(url: string) {
        const { body } = JSON.parse(JSON.stringify(await fetchForLogo(internet.network, { url }))) as { body?: string };
        return body === undefined ? undefined : new Uint8Array(Buffer.from(body, "base64"));
      },
    },
    roots: [testMarkRoot],
    url: (logo: string) => logoUrl(downloads.url, logo),
  };
  // What the task giver, the API and the inbound Lambda handed the task runner, which it runs once what handed them is done.
  const handedTasks: TaskRunnerEvent[] = [];
  const taskRunner: TaskRunner = {
    run: async (task) => void handedTasks.push(JSON.parse(JSON.stringify(task)) as TaskRef),
    unsubscribe: async (job) => void handedTasks.push(JSON.parse(JSON.stringify({ unsubscribe: job })) as TaskRunnerEvent),
  };
  inbound = createInbound({ table, mailBucket, log: (line) => inboundLog.push(line), outbound: sending.outbound, bounces: ses.bounces, logos, unsubscriber, tasks: taskRunner });
  const receiving = { rules: ses.rules, bucket: mailBucketName, inboundFunction, suppressionList: sending.suppressionList };
  // Each mailbox's index is a table under the deployment's own directory. The search Lambda and the
  // indexer each open them, as two Lambdas do. Backfill steps are small, so a few messages take several.
  const indexes = join(searchIndexes, randomUUID());
  const indexQueue = memoryIndexQueue();
  const eraser = createEraser({ table, mailBucket, uploads, indexQueue });
  const titan = recordedTitan();
  // A test mailbox is small, so its vector index is built from a few messages.
  const vectorIndexFrom = 5;
  const indexer = createIndexer({ table, mailBucket, engine: lanceSearch({ uri: indexes, embedder: titan, vectorIndexFrom }), queue: indexQueue, backfillMessages: 2 });
  let searchDeployed = !beforeSearch;
  const feeder = createFeeder(indexQueue);
  const feed = tableStream(database, streamArn, [
    { filter: feederFilter, handler: async (event) => (searchDeployed ? feeder(event) : undefined), retries: 2, invocations: 1 },
  ]);
  const index = async () => {
    await feed.deliver();
    await indexQueue.drain(indexer);
  };
  const searcher = createSearcher(lanceSearch({ uri: indexes, embedder: titan, translator: recordedNova() }));
  // EventBridge Scheduler's one-time schedules, each invoking the sender at a time, with an agent
  // whose sends wait, a draft whose undo window is over, or a thread due back from Remind me.
  const schedules: { event: Parameters<typeof sender>[0]; at: Date }[] = [];
  const sender = createSender({
    table,
    mailBucket,
    uploads,
    outbound: sending.outbound,
    region,
    dns,
    schedules: {
      releaseAt: async (agent, at) => void schedules.push({ event: { release: agent }, at }),
      sendAt: async (draft, at) => void schedules.push({ event: { send: draft }, at }),
      expireAt: async (file, at) => void schedules.push({ event: { expire: file }, at }),
    },
    downloads: {
      get url() {
        return downloadUrl;
      },
    },
  });
  const reminders = { remindAt: async (due: ReminderDue) => void schedules.push({ event: { remind: due }, at: new Date(due.at) }) };
  const stream = tableStream(database, streamArn, [
    { filter: senderFilter, handler: sender, retries: senderRetries, invocations: senderInvocations },
    { filter: alertMailFilter, handler: sender, retries: senderRetries, invocations: senderInvocations },
  ]);
  // Agents the API handed the sender in a call, which it invokes once the call is answered.
  const released: string[] = [];
  const tasking = tableStream(database, streamArn, [{ filter: taskGiverFilter, handler: createTaskGiver({ table, runner: taskRunner }), retries: 2, invocations: 1 }]);
  // Download links lead to the web app's domain under /download/, from where CloudFront invokes the
  // download Lambda. Here they lead to the API's own URL, under the same path, once it listens.
  let downloadUrl = `${inProcess}/download/`;
  const downloads = {
    get url() {
      return downloadUrl;
    },
    lifetime: downloadLinkLifetime,
  };
  const download = createDownloads({ table, mailBucket, uploads });
  const downloaded = async (request: Request) => {
    const { statusCode, headers, body } = await download(new URL(request.url).pathname);
    return new Response(body, { status: statusCode, headers });
  };
  // The organization's own logos are in the logos bucket, which CloudFront serves under the web
  // app's domain at /bimi/. Here they are under the API's own URL, at the same path, once it listens.
  let logosUrl = `${inProcess}/${hostedLogosPath}`;
  const logoObjects = new Map<string, { body: string; type: string; cacheControl: string }>();
  const hostedLogos: HostedLogos = {
    get url() {
      return logosUrl;
    },
    async put(path, body, type) {
      logoObjects.set(`${hostedLogosPath}${path}`, { body, type, cacheControl: logoCacheControl });
    },
    async remove(path) {
      logoObjects.delete(`${hostedLogosPath}${path}`);
    },
    roots: [testMarkRoot],
  };
  // S3 answers 403 for a key it doesn't have, to CloudFront's origin access control, which may not list the bucket.
  const hosted = (request: Request) => {
    const object = logoObjects.get(new URL(request.url).pathname.slice(1));
    if (object === undefined) return new Response("<Error><Code>AccessDenied</Code></Error>", { status: 403, headers: { "content-type": "application/xml" } });
    return new Response(object.body, { headers: { "content-type": object.type, "cache-control": object.cacheControl, ...hostedLogoHeaders } });
  };
  const apiEraser: Eraser = {
    emptyTrash: async (emptyTrash) => void handed.push({ emptyTrash }),
    eraseMailbox: async (eraseMailbox) => void handed.push({ eraseMailbox }),
    eraseSender: async (eraseSender) => void handed.push({ eraseSender }),
  };
  const gatewayed = gateway(
    createApi({
      version,
      region,
      table,
      humans,
      signInSender,
      identities: identities.service,
      dns,
      mailBucket,
      uploads,
      receiving,
      downloads,
      unsubscriber,
      eraser: apiEraser,
      // The API invokes the search Lambda and waits for it, so the search goes through JSON.
      searcher: async (request) => JSON.parse(JSON.stringify(await searcher(JSON.parse(JSON.stringify(request))))),
      indexQueue,
      waitingSends: { release: async (agent) => void released.push(agent) },
      reminders,
      hostedLogos,
      tasks: taskRunner,
      embedder: titan,
    }),
    // Cognito's verifier takes only the web app's and the CLI's app clients, which share the stand-in's one.
    createAuthorizer({
      table,
      verifyAccessToken: async (token) => {
        const { sub, clientId } = await issuer.verify(token);
        if (clientId !== managedLoginClientId) throw new Error("Not an app client the API takes");
        return sub;
      },
    }),
  );
  // A call returns once the stream has handed what it wrote to the sender, unless sends are held,
  // the eraser has erased the Trash it emptied and the mailboxes it deleted, and the indexer has
  // caught up, unless indexing is held, so tests see the outcome.
  let screenerDeployed = !beforeScreener;
  let approvalLogDeployed = !beforeApprovalLog;
  let mailboxAgentsDeployed = !beforeMailboxAgents;
  let cooDeployed = !beforeCoo;
  let oneCooDeployed = !beforeOneCoo;
  let deliveriesDeployed = !beforeDeliveries;
  const api = async (request: Request) => {
    const fromBucket = await uploads.handle(request);
    if (fromBucket !== undefined) return fromBucket;
    if (new URL(request.url).pathname.startsWith("/download/")) return downloaded(request);
    if (new URL(request.url).pathname.startsWith(`/${hostedLogosPath}`)) return hosted(request);
    const response = await gatewayed(request);
    if (!sendsHeld) await stream.deliver();
    for (let agent = released.shift(); agent !== undefined; agent = released.shift()) await sender({ release: agent });
    if (!sendsHeld) await stream.deliver();
    // A block from before deliveries erased nothing: the threads it put in Trash waited there.
    for (let each = handed.shift(); each !== undefined; each = handed.shift()) if (!eraserRunsLost && (deliveriesDeployed || !("eraseSender" in each))) await eraser(each);
    if (!screenerDeployed) await forgetScreener(table);
    if (!approvalLogDeployed) await forgetApprovalLog(table);
    if (!mailboxAgentsDeployed) await forgetMailboxAgents(table);
    if (!oneCooDeployed) await forgetOneCoo(table);
    if (!cooDeployed) await forgetCoo(table);
    if (!deliveriesDeployed) await forgetDeliveries(table);
    if (!indexingHeld) await index();
    await giveTasks();
    return response;
  };
  // The mailbox agents' runtime on AgentCore, which calls the API over HTTPS. Its payload and what
  // it says go through JSON.
  // It unsubscribes in AgentCore Browser, a stand-in here over the stand-in internet.
  const browser = standInBrowser(internet.network);
  const runtime: AgentRuntime = async function* (payload) {
    for await (const event of runAgent(JSON.parse(JSON.stringify(payload)), { models: standIn(model), decider, fetch: api, browser: browser.start })) yield JSON.parse(JSON.stringify(event));
  };
  // The conversation Lambda, which runs each turn on AgentCore.
  const conversation = createConversation({ table, region, apiUrl: inProcess, fetch: api, runtime, embedder: titan });
  // The task runner, which Lambda invokes asynchronously with each task handed to it, one at a time.
  const runTask = createTaskRunner({ table, region, apiUrl: inProcess, fetch: api, runtime });
  const unsubscribe = createUnsubscribeRunner({ table, region, apiUrl: inProcess, runtime, bounces: ses.bounces });
  const runHandedTasks = async () => {
    for (let task = handedTasks.shift(); task !== undefined; task = handedTasks.shift()) {
      if ("unsubscribe" in task) await unsubscribe(task.unsubscribe);
      else await runTask(task);
      // What the runner did reaches the sender through the table's stream.
      if (!sendsHeld) await stream.deliver();
    }
  };
  // The task giver reads the table's stream, and hands its tasks to the runner, unless tasks are held.
  async function giveTasks() {
    await tasking.deliver();
    if (!tasksHeld) await runHandedTasks();
  }
  // CloudFront passes the turn to the function URL, which streams its answer a line at a time.
  const agentTurn = async (request: Request): Promise<Response> => {
    const answer = await conversation.turn({ headers: Object.fromEntries(request.headers), body: await request.text() });
    if (!("events" in answer)) return Response.json(answer.body, { status: answer.statusCode });
    const lines = answer.events[Symbol.asyncIterator]();
    return new Response(
      new ReadableStream({
        async pull(controller) {
          const { value, done } = await lines.next();
          if (done) return controller.close();
          controller.enqueue(new TextEncoder().encode(`${JSON.stringify(value)}\n`));
        },
      }),
      { headers: { "content-type": "application/x-ndjson" } },
    );
  };
  const login = managedLogin({ ids: humans.ids, issuer, accessTokenLifetime });
  // The MCP Lambda invokes the conversation Lambda without waiting, with the turn it prepared, which
  // goes through JSON. The turns still running when the generated client calls finish first.
  const runs: Promise<void>[] = [];
  // Managed login's stand-in is at the API's own URL, once it listens.
  let signInUrl = inProcess;
  const mcp = createMcp({
    version,
    region,
    table,
    get signInUrl() {
      return signInUrl;
    },
    appClient: mcpAppClientId,
    verifyAccessToken: issuer.verify,
    turns: {
      async start(prepared: PreparedTurn) {
        runs.push((async () => {
          for await (const _ of conversation.run(JSON.parse(JSON.stringify(prepared)) as PreparedTurn));
        })());
      },
    },
    fetch: (request) => web(request),
    // Shorter than a deployment's, so a test of an answer that takes longer is quick.
    askWait: 2_000,
  });
  const isMcp = (request: Request) => mcpRoutes.some(({ path, methods }) => new URL(request.url).pathname === path && (methods as string[]).includes(request.method));
  // The deployment's URLs as the internet reaches them: managed login, the MCP endpoint and the API.
  const web = async (request: Request) => (await uploads.handle(request)) ?? (await login.handle(request)) ?? (isMcp(request) ? mcp(request) : api(request));
  const settled = async (request: Request) => {
    while (runs.length > 0) await Promise.all(runs.splice(0));
    return api(request);
  };
  const client = (headers?: Record<string, string>) => createDuvaClient(inProcess, { fetch: settled, headers });
  const accessToken = (email: string) => {
    const id = humans.ids.get(email);
    if (id === undefined) throw new Error(`${email} isn't a human in the organization`);
    return issuer.issue(id, accessTokenLifetime, managedLoginClientId);
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
    async receive(raw, { from, to }, options) {
      const received = await ses.receive(raw, { from: from ?? (await senderOf(raw)), to }, options);
      if (!deliveriesDeployed) await forgetDeliveries(table);
      if (!indexingHeld) await index();
      await giveTasks();
      return received;
    },
    inboundLog: () => [...inboundLog],
    receiptRules: () => ses.describeRules(),
    bounces: () => ses.bounced(),
    emailIdentities: () => identities.identities(),
    dnsRecord: (type, name, values) => dns.set(type, name, values),
    signInCodesFrom: () => signInSender.from,
    sent: () => sending.sent(),
    sentTo: () => sending.sentTo(),
    suppressionList: () => sending.suppressed(),
    async sendingEvent(messageId, event, options) {
      await sending.publish(messageId, event, options);
      if (!sendsHeld) await stream.deliver();
      if (!indexingHeld) await index();
    },
    releaseSends: () => stream.deliver(),
    async clock(at) {
      for (;;) {
        const due = schedules.filter((schedule) => schedule.at <= at).sort((a, b) => a.at.getTime() - b.at.getTime())[0];
        if (due === undefined) break;
        schedules.splice(schedules.indexOf(due), 1);
        setClock(due.at);
        await sender(due.event);
        if (!sendsHeld) await stream.deliver();
      }
      setClock(at);
      uploads.lifecycle(at);
    },
    releaseIndexing: index,
    loseBackfillStep: () => void indexQueue.backfillStepsLost++,
    stored: () => mailBucket.stored(),
    upload: (url, body) => (url.startsWith(inProcess) ? api(new Request(url, { method: "PUT", body })) : fetch(url, { method: "PUT", body })),
    uploads: () => ({ files: uploads.files(), incomplete: uploads.incomplete() }),
    searchObjects: () => filesUnder(indexes).map((file) => new TextDecoder().decode(readFileSync(file))),
    async erase(at, { s3DeletesFail = false } = {}) {
      mailBucket.deletesFail = s3DeletesFail;
      try {
        await eraser({ time: at.toISOString() });
      } finally {
        mailBucket.deletesFail = false;
        if (!indexingHeld) await index();
      }
    },
    webServer: (hostname, options) => internet.webServer(hostname, options),
    download: (url) => (url.startsWith(inProcess) ? api(new Request(url)) : fetch(url)),
    setUp: async ({ backfillLost = false, ...options }) => {
      await setUp(options);
      await timeEarlierLabels(table);
      await eraseAgentsMailboxes({ table, eraser: apiEraser, receiving });
      for (let each = handed.shift(); each !== undefined; each = handed.shift()) if (!eraserRunsLost) await eraser(each);
      screenerDeployed = true;
      deliveriesDeployed = true;
      await setUpDeliveries(table);
      await eraseBlockedSenders(table, apiEraser);
      for (let each = handed.shift(); each !== undefined; each = handed.shift()) if (!eraserRunsLost) await eraser(each);
      await setUpScreeners(table);
      mailboxAgentsDeployed = true;
      cooDeployed = true;
      oneCooDeployed = true;
      await giveMailboxAgents(table);
      await carryOverModelChoices(table);
      approvalLogDeployed = true;
      await listEarlierDecisions(table);
      // The feeder starts with this version, and reads only what is written from then on.
      if (!searchDeployed) await feed.deliver();
      searchDeployed = true;
      await indexMailboxes(table, indexQueue);
      if (backfillLost) indexQueue.backfillStepsLost = Infinity;
      try {
        if (!indexingHeld) await index();
      } finally {
        if (backfillLost) indexQueue.backfillStepsLost = 0;
      }
    },
    async releaseTasks() {
      await tasking.deliver();
      await runHandedTasks();
    },
    async agentMailbox(agent, address) {
      const { id } = await addMailbox(table, { owner: agent, address, by: firstAdmin.id });
      await syncRecipients(table, receiving);
      return id;
    },
    async askAgent(email, turn, { token = accessToken(email) } = {}) {
      const response = await agentTurn(new Request(`${inProcess}/${conversationPath}turns`, { method: "POST", headers: { [tokenHeader]: token }, body: JSON.stringify(turn) }));
      if (!response.ok) return { status: response.status, body: (await response.json()) as { message: string } };
      const events = (await response.text()).split("\n").filter((line) => line !== "").map((line) => JSON.parse(line) as ConversationEvent);
      return { status: response.status, events };
    },
    mcp: (email, options) => connectMcpClient(`${inProcess}/mcp`, email, web, options),
    async listen() {
      const server = await listen(async (request) => (new URL(request.url).pathname.startsWith(`/${conversationPath}`) ? agentTurn(request) : web(request)));
      downloadUrl = `${server.url}/download/`;
      uploadsUrl = `${server.url}/uploads-bucket/`;
      signInUrl = server.url;
      logosUrl = `${server.url}/${hostedLogosPath}`;
      return { ...server, signIn: { url: server.url, clientId: managedLoginClientId } };
    },
  };
}

/** Moves the clock Duva reads to the time, from where it goes on, for the rest of the test. */
function setClock(at: Date) {
  vi.useFakeTimers({ toFake: ["Date"], now: at, shouldAdvanceTime: true, advanceTimeDelta: 1 });
  onTestFinished(() => void vi.useRealTimers());
}

/** Every file in the directory and the directories in it, none if it doesn't exist. */
const filesUnder = (directory: string): string[] =>
  existsSync(directory) ? readdirSync(directory, { recursive: true, encoding: "utf8" }).map((name) => join(directory, name)).filter((path) => statSync(path).isFile()) : [];

// Where every deployment's search indexes are, each in a directory of its own, until the test file ends.
const searchIndexes = mkdtempSync(join(tmpdir(), "duva-indexes-"));
process.on("exit", () => rmSync(searchIndexes, { recursive: true, force: true }));

/**
 * The indexer's FIFO queue, with Lambda reading it: a task whose ID it was given in the last five
 * minutes is dropped, and the indexer gets the tasks in order, a batch at a time. It loses the next
 * `backfillStepsLost` tasks that take a step of a backfill after its first.
 */
function memoryIndexQueue(): IndexQueue & { backfillStepsLost: number; drain(indexer: ReturnType<typeof createIndexer>): Promise<void> } {
  const queued: QueuedTask[] = [];
  const seen = new Map<string, number>();
  let draining: Promise<void> = Promise.resolve();
  const queue = {
    backfillStepsLost: 0,
    async send(tasks: QueuedTask[]) {
      for (const each of tasks) {
        if (Date.now() - (seen.get(each.id) ?? -Infinity) < 5 * 60_000) continue;
        seen.set(each.id, Date.now());
        if ((each.task.backfill ?? 0) > 0 && queue.backfillStepsLost > 0) {
          queue.backfillStepsLost--;
          continue;
        }
        queued.push(each);
      }
    },
    drain(indexer: ReturnType<typeof createIndexer>) {
      const drain = async () => {
        while (queued.length > 0) {
          const batch = queued.splice(0, 10);
          await indexer({ Records: batch.map(({ task }) => ({ body: JSON.stringify(task) })) } as Parameters<typeof indexer>[0]);
        }
      };
      draining = draining.then(drain, drain);
      return draining;
    },
  };
  return queue;
}

// Where the API is when called in-process.
const inProcess = "http://duva.test";

// What SES knows the deployment's mail bucket and inbound Lambda by.
const mailBucketName = "duva-mail";
const inboundFunction = "arn:aws:lambda:eu-north-1:000000000000:function:DuvaInbound";

async function senderOf(raw: string | Uint8Array): Promise<string> {
  const { from } = await PostalMime.parse(raw);
  if (from?.address === undefined) throw new Error("The message has no From, so give the envelope sender.");
  return from.address;
}

/**
 * The user pool's sender, which sends sign-in codes from the first domain, verified from the
 * start. Like Cognito, it refuses a domain SES hasn't verified.
 */
function memorySignInSender(domain: string, verified: (domain: string) => Promise<boolean>): SignInSender & { from: string } {
  const sender = {
    from: `Duva <no-reply@${domain}>`,
    async domain() {
      return sender.from.slice(sender.from.indexOf("@") + 1, -1);
    },
    async sendFrom(chosen: string) {
      if (!(await verified(chosen))) {
        throw new Error(`Cognito received the following error from Amazon SES when attempting to send email: Email address is not verified. The following identities failed the check: ${chosen}`);
      }
      sender.from = `Duva <no-reply@${chosen}>`;
    },
  };
  return sender;
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
    async remove(email) {
      const id = ids.get(email);
      ids.delete(email);
      return id;
    },
  };
}

async function createTable() {
  // Each Duva has a database of its own, so its requests don't queue behind other tests'.
  const database = { endpoint: inject("dynamodbEndpoint"), accessKeyId: randomUUID().replaceAll("-", "") };
  const client = dynamodbLocal(database);
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
  return { table: { client, name }, streamArn: TableDescription!.LatestStreamArn!, database };
}

/**
 * Removes what a version from before the Screener didn't write: each mailbox's Screener switch, and
 * the addresses each mailbox sent to.
 */
async function forgetScreener(table: Table) {
  const switchSortKey = screenerKey("")[tableKey.sortKey];
  const sentToPrefix = keys.sentToKey("", "")[tableKey.sortKey]!;
  const { Items = [] } = await table.client.send(
    new ScanCommand({
      TableName: table.name,
      FilterExpression: "#sk = :switch OR begins_with(#sk, :sentTo)",
      ExpressionAttributeNames: { "#sk": tableKey.sortKey },
      ExpressionAttributeValues: { ":switch": { S: switchSortKey! }, ":sentTo": { S: sentToPrefix } },
    }),
  );
  for (const item of Items) {
    await table.client.send(new DeleteItemCommand({ TableName: table.name, Key: { [tableKey.partitionKey]: item[tableKey.partitionKey]!, [tableKey.sortKey]: item[tableKey.sortKey]! } }));
  }
}

/** The model mailbox agents ask unless a test gives one: it answers every turn the same, using no tool. */
const standInModel: Model = async function* () {
  yield { text: "Stand-in answer." };
  yield { usage: { inputTokens: 1000, outputTokens: 10 } };
};

/** The decider mailbox agents ask unless a test gives one: every turn is simple, for sure. */
const standInDecider: Decider = async () => ({ route: "simple", confidence: 1, inputTokens: 500, outputTokens: 20 });

/** Removes what a version from before mailbox agents didn't write: each mailbox agent, with its settings and its listing. */
async function forgetMailboxAgents(table: Table) {
  const { Items = [] } = await table.client.send(
    new ScanCommand({
      TableName: table.name,
      FilterExpression: "#sk = :pointer OR (#sk = :actor AND (attribute_exists(mailbox) OR attribute_exists(mailboxAgent)))",
      ExpressionAttributeNames: { "#sk": tableKey.sortKey },
      ExpressionAttributeValues: { ":pointer": { S: "mailboxAgent" }, ":actor": { S: "actor" } },
    }),
  );
  for (const item of Items) {
    const keys =
      item[tableKey.sortKey]!.S === "actor"
        ? [item, { [tableKey.partitionKey]: item[tableKey.partitionKey]!, [tableKey.sortKey]: { S: "settings" } }, { [tableKey.partitionKey]: { S: `actor#${item.sponsor!.S}` }, [tableKey.sortKey]: { S: `agent#${item.id!.S}` } }]
        : [item];
    for (const key of keys) {
      await table.client.send(new DeleteItemCommand({ TableName: table.name, Key: { [tableKey.partitionKey]: key[tableKey.partitionKey]!, [tableKey.sortKey]: key[tableKey.sortKey]! } }));
    }
  }
}

/**
 * Writes what a version from before one mailbox agent per human wrote: each human's mailbox agent is
 * their first mailbox's own, each of their other mailboxes gets one of its own, each listed by its
 * mailbox, and each turn of their conversation is kept by the mailbox it was asked from.
 */
async function forgetOneCoo(table: Table) {
  const db = documents(table);
  const { Items: pointers = [] } = await db.send(
    new ScanDocuments({ TableName: table.name, FilterExpression: "#sk = :pointer AND begins_with(#pk, :actor)", ExpressionAttributeNames: { "#sk": tableKey.sortKey, "#pk": tableKey.partitionKey }, ExpressionAttributeValues: { ":pointer": "mailboxAgent", ":actor": "actor#" } }),
  );
  for (const pointer of pointers) {
    const human = (pointer[tableKey.partitionKey] as string).slice("actor#".length);
    const agent = pointer.agent as string;
    const own = [];
    for (const mailbox of await ownedMailboxes(table, human)) {
      const { Item } = await db.send(new GetCommand({ TableName: table.name, Key: { ...mailboxKey(mailbox.id), [tableKey.sortKey]: "mailboxAgent" } }));
      if (Item === undefined) own.push(mailbox.id);
    }
    const asOwn = async (id: string, mailbox: string) => {
      await db.send(new UpdateCommand({ TableName: table.name, Key: actorKey(id), UpdateExpression: "SET mailbox = :mailbox REMOVE mailboxAgent", ExpressionAttributeValues: { ":mailbox": mailbox } }));
      await db.send(new UpdateCommand({ TableName: table.name, Key: agentSettingsKey(id), UpdateExpression: "SET sponsorMailboxes = :mailboxes", ExpressionAttributeValues: { ":mailboxes": [mailbox] } }));
      await db.send(new PutCommand({ TableName: table.name, Item: { ...mailboxKey(mailbox), [tableKey.sortKey]: "mailboxAgent", agent: id } }));
    };
    for (const [index, mailbox] of own.entries()) {
      if (index === 0) await asOwn(agent, mailbox);
      else await asOwn((await addKeylessAgent(table, { name: mailboxAgentName, sponsor: human, items: (id) => [firstAgentSettings(table, id, mailboxAgentSettings)] })).id, mailbox);
    }
    await db.send(new DeleteCommand({ TableName: table.name, Key: { [tableKey.partitionKey]: pointer[tableKey.partitionKey], [tableKey.sortKey]: "mailboxAgent" } }));
  }
  const { Items: turns = [] } = await db.send(
    new ScanDocuments({ TableName: table.name, FilterExpression: "begins_with(#sk, :turn)", ExpressionAttributeNames: { "#sk": tableKey.sortKey }, ExpressionAttributeValues: { ":turn": turnPrefix } }),
  );
  // A turn asked from All mailboxes had no way to be.
  for (const { [tableKey.partitionKey]: partition, [tableKey.sortKey]: key, mailbox, ...turn } of turns.filter(({ mailbox }) => mailbox !== undefined)) {
    await db.send(new PutCommand({ TableName: table.name, Item: { [tableKey.partitionKey]: partition, [tableKey.sortKey]: `turn#${mailbox}#${turn.at}#${turn.id}`, ...turn } }));
    await db.send(new DeleteCommand({ TableName: table.name, Key: { [tableKey.partitionKey]: partition, [tableKey.sortKey]: key } }));
  }
}

/** Names each mailbox agent as a version from before Coo did. */
async function forgetCoo(table: Table) {
  const { Items = [] } = await table.client.send(
    new ScanCommand({
      TableName: table.name,
      FilterExpression: "#sk = :actor AND (attribute_exists(mailbox) OR attribute_exists(mailboxAgent))",
      ExpressionAttributeNames: { "#sk": tableKey.sortKey },
      ExpressionAttributeValues: { ":actor": { S: "actor" } },
    }),
  );
  for (const item of Items) await table.client.send(new PutItemCommand({ TableName: table.name, Item: { ...item, name: { S: "Mailbox agent" } } }));
}

/** Removes what a version from before the approval log didn't write: each decision's listing in its approver's log. */
async function forgetApprovalLog(table: Table) {
  const { Items = [] } = await table.client.send(
    new ScanCommand({
      TableName: table.name,
      FilterExpression: "begins_with(#sk, :decided)",
      ExpressionAttributeNames: { "#sk": tableKey.sortKey },
      ExpressionAttributeValues: { ":decided": { S: decisionPrefix } },
    }),
  );
  for (const item of Items) {
    await table.client.send(new DeleteItemCommand({ TableName: table.name, Key: { [tableKey.partitionKey]: item[tableKey.partitionKey]!, [tableKey.sortKey]: item[tableKey.sortKey]! } }));
  }
}

/**
 * Takes away what deliveries added, as a deployment from before them has it: each decision is a
 * let-in or a block, as the Inbox and nowhere were, no thread is listed by whom it is from, and no
 * sender's threads wait for the eraser.
 */
async function forgetDeliveries(table: Table) {
  const { Items = [] } = await table.client.send(new ScanCommand({ TableName: table.name }));
  for (const item of Items) {
    const [partition, sort] = [item[tableKey.partitionKey]!.S!, item[tableKey.sortKey]!.S!];
    const Key = { [tableKey.partitionKey]: item[tableKey.partitionKey]!, [tableKey.sortKey]: item[tableKey.sortKey]! };
    if (/#from(-domain)?#/.test(partition) || sort === "senders-listed" || sort === "blocks-erased" || partition === "erasure#senders") {
      await table.client.send(new DeleteItemCommand({ TableName: table.name, Key }));
    } else if (sort.startsWith("screened#") && item.delivery !== undefined) {
      const { delivery, label, ...rest } = item;
      await table.client.send(new PutItemCommand({ TableName: table.name, Item: { ...rest, decision: { S: delivery.S === "nowhere" ? "block" : "letIn" } } }));
    }
  }
}

/** The mail bucket, which keeps one version of each object, and refuses deletes while `deletesFail`. */
function memoryMailBucket(): MailBucket & { stored(): string[]; deletesFail: boolean } {
  const objects = new Map<string, Uint8Array>();
  return {
    deletesFail: false,
    async put(key, body) {
      objects.set(key, body);
    },
    async get(key) {
      return objects.get(key);
    },
    async erase(key) {
      if (this.deletesFail) throw new Error("Access Denied");
      return objects.delete(key);
    },
    stored: () => [...objects.values()].map((raw) => new TextDecoder().decode(raw)),
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
      // The URL the client asked for, port included, as the MCP endpoint names itself by it.
      new Request(new URL(incoming.url ?? "/", `http://${incoming.headers.host ?? "127.0.0.1"}`).href, {
        method: incoming.method,
        headers,
        body: chunks.length > 0 ? Buffer.concat(chunks) : undefined,
      }),
    );
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    // A streamed answer, as the conversation Lambda's, goes out as it comes.
    if (response.body !== null) for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) outgoing.write(chunk);
    outgoing.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}
