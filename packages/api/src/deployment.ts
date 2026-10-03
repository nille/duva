import type { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import type { MailBucket } from "./mail-bucket.ts";
import type { Receiving } from "./receiving.ts";

/** Duva's one DynamoDB table. */
export interface Table {
  client: DynamoDBClient;
  name: string;
}

/** What the API knows about the deployment it runs in. */
export interface Deployment {
  /** The version of Duva the deployment runs. */
  version: string;
  /** The AWS region the deployment runs in. */
  region: string;
  table: Table;
  mailBucket: MailBucket;
  receiving: Receiving;
}
