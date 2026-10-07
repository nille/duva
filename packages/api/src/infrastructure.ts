// What the API expects of the infrastructure the CDK app builds. The test harness builds the same.

/** The key schema of Duva's one DynamoDB table. */
export const tableKey = {
  partitionKey: "pk",
  sortKey: "sk",
} as const;

/** The attribute whose time, in seconds since the epoch, the table's time to live deletes an item after. */
export const timeToLiveAttribute = "expires";

/**
 * Where the organization's own logos are, under the web app's domain and in the logos bucket, which
 * CloudFront serves there (ADR-0026).
 */
export const hostedLogosPath = "bimi/";

/**
 * The headers CloudFront adds to each logo and mark certificate it serves, so an SVG opened on the
 * web app's domain runs nothing and is never taken for another type.
 */
export const hostedLogoHeaders = { "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox", "x-content-type-options": "nosniff" } as const;

/** The environment variables the CDK app gives the API's Lambdas. Each Lambda gets those it reads. */
export const environmentVariables = {
  version: "DUVA_VERSION",
  tableName: "TABLE_NAME",
  mailBucket: "MAIL_BUCKET",
  /** The user pool humans sign in with. */
  userPoolId: "USER_POOL_ID",
  /** The IDs of the user pool's app clients whose access tokens the authorizer accepts, comma-separated. */
  userPoolClientIds: "USER_POOL_CLIENT_IDS",
  /** The organization's first domain. */
  domain: "DOMAIN",
  /** The first admin's email address. */
  admin: "ADMIN",
  /** Duva's receipt rule set. */
  receiptRuleSet: "RECEIPT_RULE_SET",
  /** The ARN of the Lambda SES invokes for each message it receives. */
  inboundFunction: "INBOUND_FUNCTION",
  /** The eraser Lambda, which the API invokes for each Trash emptied. */
  eraserFunction: "ERASER_FUNCTION",
  /** The unsubscriber Lambda, which the API and the inbound Lambda invoke for each one-click unsubscribe. */
  unsubscriberFunction: "UNSUBSCRIBER_FUNCTION",
  /** The logo fetcher Lambda, which the inbound Lambda invokes to fetch each sender's logo. */
  logoFetcherFunction: "LOGO_FETCHER_FUNCTION",
  /** The SES configuration set every send goes through. */
  configurationSet: "CONFIGURATION_SET",
  /** The URL of the download Lambda, which download links and senders' logos lead to. */
  downloadUrl: "DOWNLOAD_URL",
  /** The bucket the organization's own logos are in, which CloudFront serves at the URL below. */
  logosBucket: "LOGOS_BUCKET",
  /** The URL the organization's own logos are served under, on the web app's domain. */
  logosUrl: "LOGOS_URL",
  /** The search Lambda, which the API invokes for each search. */
  searchFunction: "SEARCH_FUNCTION",
  /** Where the mailboxes' search indexes are, as s3://bucket/prefix. */
  searchIndexes: "SEARCH_INDEXES",
  /** The URL of the indexer's FIFO queue. */
  indexQueue: "INDEX_QUEUE",
  /** The sender Lambda, which the API invokes to send what waits for an agent's send limits. */
  senderFunction: "SENDER_FUNCTION",
  /** The schedule group the sender's one-time schedules are in. */
  scheduleGroup: "SCHEDULE_GROUP",
  /** The role EventBridge Scheduler invokes the sender with. */
  schedulerRole: "SCHEDULER_ROLE",
  /** The ARN of the mailbox agents' AgentCore Runtime, which the conversation Lambda invokes for each turn. */
  agentRuntime: "AGENT_RUNTIME",
  /** The ID of the AgentCore Browser the mailbox agents unsubscribe in, which their runtime starts a session of for each attempt. */
  unsubscribeBrowser: "UNSUBSCRIBE_BROWSER",
  /** The name of the SSM parameter that holds the URL of Duva's API, which a mailbox agent calls as its tools. */
  apiUrlParameter: "API_URL_PARAMETER",
  /** The URL of managed login, whose authorize and token endpoints MCP clients sign humans in at. */
  signInUrl: "SIGN_IN_URL",
  /** The user pool's app client MCP clients sign in through. */
  mcpClientId: "MCP_CLIENT_ID",
  /** The conversation Lambda, which the MCP Lambda invokes to run each turn it prepares. */
  conversationFunction: "CONVERSATION_FUNCTION",
  /** The task runner Lambda, which the task giver and the API invoke for each task a label's prompt gives a mailbox agent. */
  taskRunnerFunction: "TASK_RUNNER_FUNCTION",
} as const;

/** What the table's stream shows of each changed item. The sender reads the item itself, so only its new image. */
export const tableStreamView = "NEW_IMAGE";

/**
 * Which of the table stream's records Lambda hands the sender: the writes that leave a draft
 * approved for sending, which only a decision does. The pattern is a Lambda filter on DynamoDB JSON.
 */
export const senderFilter = { dynamodb: { NewImage: { send: { M: { state: { S: ["approved"] } } } } } };

/** Which of the table stream's records Lambda also hands the sender: each urgent alert to mail to its sponsor. */
export const alertMailFilter = { dynamodb: { NewImage: { mail: { S: ["pending"] } } } };

/**
 * Which of the table stream's records Lambda hands the feeder: each new change in a mailbox's change
 * feed, whose entries are in the mailbox's changes partition.
 */
export const feederFilter = { eventName: ["INSERT"], dynamodb: { Keys: { [tableKey.partitionKey]: { S: [{ prefix: "mailbox#" }] }, [tableKey.sortKey]: { S: [{ prefix: "change#" }] } } } };

/**
 * Which of the table stream's records Lambda hands the task giver: each new change in a mailbox's
 * change feed that may add a label to a message (ADR-0029).
 */
export const taskGiverFilter = {
  eventName: ["INSERT"],
  dynamodb: {
    Keys: { [tableKey.partitionKey]: { S: [{ prefix: "mailbox#" }] }, [tableKey.sortKey]: { S: [{ prefix: "change#" }] } },
    NewImage: { type: { S: ["threadLabelsChanged", "messageReceived"] } },
  },
};

/** Where in the search bucket the mailboxes' indexes are, one table each. */
export const searchIndexesPrefix = "indexes";

/** The Bedrock model that embeds mail and searches: Titan Text Embeddings V2 (ADR-0007). */
export const embeddingModel = "amazon.titan-embed-text-v2:0";

/** The Bedrock model that translates a search's words into the organization's search languages: Amazon Nova Lite (ADR-0007). */
export const translationModel = "amazon.nova-lite-v1:0";

/** How often Lambda retries a stream record the sender failed on, before it gives up and records it in the failure queue. */
export const senderRetries = 2;

/** Where in the mail bucket SES stores each message it receives, followed by SES's message ID. */
export const inboundPrefix = "inbound/";

/** Where in the mail bucket Duva stores the raw MIME of each message it sends, followed by the message's ID in Duva. */
export const sentPrefix = "sent/";

/** The name of Duva's first receipt rule for addresses. Later ones add -2, -3 and on to it. */
export const receiptRuleName = "Addresses";

/** Which of Duva's receipt rules for addresses the name is, counting from 1, or undefined if it is no such rule. */
export function receiptRuleNumber(name: string | undefined): number | undefined {
  if (name === receiptRuleName) return 1;
  const number = new RegExp(`^${receiptRuleName}-(\\d+)$`).exec(name ?? "")?.[1];
  return number === undefined ? undefined : Number(number);
}

/** How many recipients SES takes in one receipt rule (docs/aws.md). */
export const recipientsPerRule = 500;

/**
 * The CloudWatch metric counting the messages Duva drops on arrival, by reason. The inbound Lambda
 * writes it to its log in embedded metric format, so it costs nothing while no mail is dropped.
 */
export const dropMetric = { namespace: "Duva", name: "DroppedMessages", dimension: "Reason" } as const;

/** Why Duva drops a message on arrival, as the drop metric's dimension names it. */
export const dropReasons = ["virus", "dmarcReject"] as const;

/** Duva's own address on the domain, which mail no actor sent comes from, such as sign-in codes and urgent alerts. */
export const systemAddress = (domain: string) => `no-reply@${domain}`;

/** The address sign-in codes come from once SES has verified the sign-in domain. */
export const signInSender = systemAddress;

/** The From of sign-in codes, as Cognito sends them from the sign-in domain. */
export const signInFrom = (domain: string) => `Duva <${signInSender(domain)}>`;

/** Where on the web app's domain Ask Coo posts each turn, which CloudFront passes to the conversation Lambda. */
export const conversationPath = "agent/";

/** The header a turn gives the human's access token in, since CloudFront signs the request to the conversation Lambda with its own Authorization. */
export const tokenHeader = "x-duva-token";

/**
 * Duva's MCP endpoint (ADR-0028), on the API's domain beside its operations, and what OAuth asks of
 * it: the documents MCP clients discover the sign-in from, where they register, and the endpoints
 * they sign in through, which pass each step on to managed login. API Gateway
 * routes each to the MCP Lambda without the authorizer, since the endpoint answers 401 itself.
 */
export const mcpPath = "/mcp";
export const mcpRegistrationPath = "/mcp/register";
export const mcpAuthorizePath = "/mcp/authorize";
/** Where managed login sends a human back to after an MCP client's sign-in, the MCP app client's only callback. */
export const mcpCallbackPath = "/mcp/callback";
export const mcpTokenPath = "/mcp/token";
export const protectedResourcePaths = ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"];
export const authorizationServerPath = "/.well-known/oauth-authorization-server";
export const mcpRoutes: { path: string; methods: ("GET" | "POST")[] }[] = [
  { path: mcpPath, methods: ["GET", "POST"] },
  { path: mcpRegistrationPath, methods: ["POST"] },
  { path: mcpAuthorizePath, methods: ["GET", "POST"] },
  { path: mcpCallbackPath, methods: ["GET"] },
  { path: mcpTokenPath, methods: ["POST"] },
  ...protectedResourcePaths.map((path) => ({ path, methods: ["GET" as const] })),
  { path: authorizationServerPath, methods: ["GET"] },
];
