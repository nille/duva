/**
 * The key schema of Duva's one DynamoDB table. The CDK app and the test harness both build
 * the table from it.
 */
export const tableKey = {
  partitionKey: "pk",
  sortKey: "sk",
} as const;
