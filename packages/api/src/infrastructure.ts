// What the API expects of the infrastructure the CDK app builds. The test harness builds the same.

/** The key schema of Duva's one DynamoDB table. */
export const tableKey = {
  partitionKey: "pk",
  sortKey: "sk",
} as const;

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
} as const;

/** Where in the mail bucket SES stores each message it receives, followed by SES's message ID. */
export const inboundPrefix = "inbound/";

/** The name of Duva's receipt rule, which lists its addresses. */
export const receiptRuleName = "Addresses";
