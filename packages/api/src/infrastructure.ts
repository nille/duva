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
  /** The unsubscriber Lambda, which the API invokes for each one-click unsubscribe. */
  unsubscriberFunction: "UNSUBSCRIBER_FUNCTION",
  /** The SES configuration set every send goes through. */
  configurationSet: "CONFIGURATION_SET",
  /** The URL of the download Lambda, which download links lead to. */
  downloadUrl: "DOWNLOAD_URL",
} as const;

/** What the table's stream shows of each changed item. The sender reads the item itself, so only its new image. */
export const tableStreamView = "NEW_IMAGE";

/**
 * Which of the table stream's records Lambda hands the sender: the writes that leave a draft
 * approved for sending, which only a decision does. The pattern is a Lambda filter on DynamoDB JSON.
 */
export const senderFilter = { dynamodb: { NewImage: { send: { M: { state: { S: ["approved"] } } } } } };

/** How often Lambda retries a stream record the sender failed on, before it gives up and records it in the failure queue. */
export const senderRetries = 2;

/** Where in the mail bucket SES stores each message it receives, followed by SES's message ID. */
export const inboundPrefix = "inbound/";

/** Where in the mail bucket Duva stores the raw MIME of each message it sends, followed by the message's ID in Duva. */
export const sentPrefix = "sent/";

/** The name of Duva's receipt rule, which lists its addresses. */
export const receiptRuleName = "Addresses";

/**
 * The CloudWatch metric counting the messages Duva drops on arrival, by reason. The inbound Lambda
 * writes it to its log in embedded metric format, so it costs nothing while no mail is dropped.
 */
export const dropMetric = { namespace: "Duva", name: "DroppedMessages", dimension: "Reason" } as const;

/** Why Duva drops a message on arrival, as the drop metric's dimension names it. */
export const dropReasons = ["virus", "dmarcReject"] as const;
