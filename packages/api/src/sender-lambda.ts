// The Lambda entry point the table's stream invokes for each draft a decision approved. The CDK app
// sets the environment and the filter.
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { SESv2Client } from "@aws-sdk/client-sesv2";
import { required } from "./environment.ts";
import { environmentVariables } from "./infrastructure.ts";
import { s3MailBucket } from "./mail-bucket.ts";
import { createSender, sesOutbound } from "./sending.ts";

export const handler = createSender({
  table: { client: new DynamoDBClient({}), name: required(environmentVariables.tableName) },
  mailBucket: s3MailBucket(new S3Client({}), required(environmentVariables.mailBucket)),
  // One attempt per call, so the SDK never sends a message again whose answer was lost.
  region: required("AWS_REGION"),
  outbound: sesOutbound(new SESv2Client({ maxAttempts: 1 }), required(environmentVariables.configurationSet)),
});
