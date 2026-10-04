import type { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import type { Eraser } from "./erasure.ts";
import type { Humans } from "./user-pool.ts";
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
  /** Where humans sign in. */
  humans: Humans;
  mailBucket: MailBucket;
  receiving: Receiving;
  eraser: Eraser;
}
