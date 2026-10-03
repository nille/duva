import type { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import type { MailBucket } from "./mail-bucket.ts";

/** What the API knows about the deployment it runs in. */
export interface Deployment {
  /** The version of Duva the deployment runs. */
  version: string;
  /** The AWS region the deployment runs in. */
  region: string;
  /** Duva's one DynamoDB table. */
  table: { client: DynamoDBClient; name: string };
  mailBucket: MailBucket;
}
