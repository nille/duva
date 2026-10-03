// What the API expects of the infrastructure the CDK app builds. The test harness builds the same.

/** The key schema of Duva's one DynamoDB table. */
export const tableKey = {
  partitionKey: "pk",
  sortKey: "sk",
} as const;

/** The environment variables the CDK app gives the API's Lambda. */
export const environmentVariables = {
  version: "DUVA_VERSION",
  tableName: "TABLE_NAME",
  mailBucket: "MAIL_BUCKET",
} as const;
