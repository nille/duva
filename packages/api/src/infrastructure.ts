// What the API expects of the infrastructure the CDK app builds. The test harness builds the same.

/** The key schema of Duva's one DynamoDB table. */
export const tableKey = {
  partitionKey: "pk",
  sortKey: "sk",
} as const;

/** The attribute whose time, in seconds since the epoch, the table's time to live deletes an item after. */
export const timeToLiveAttribute = "expires";

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
