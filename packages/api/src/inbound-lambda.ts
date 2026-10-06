// The Lambda entry point SES invokes for each message it receives. It re-sends groups' mail to
// their external members and bounces what a group refuses, through SES. The CDK app sets the environment.
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { SESClient } from "@aws-sdk/client-ses";
import { SESv2Client } from "@aws-sdk/client-sesv2";
import { required } from "./environment.ts";
import { sesBounces } from "./group-mail.ts";
import { createInbound } from "./inbound.ts";
import { environmentVariables } from "./infrastructure.ts";
import { s3MailBucket } from "./mail-bucket.ts";
import { sesOutbound } from "./sending.ts";

export const handler = createInbound({
  table: { client: new DynamoDBClient({}), name: required(environmentVariables.tableName) },
  mailBucket: s3MailBucket(new S3Client({}), required(environmentVariables.mailBucket)),
  // Straight to stdout, without the prefix console.log adds, so CloudWatch reads each line's embedded metrics.
  log: (line) => process.stdout.write(`${line}\n`),
  // One attempt per call, so the SDK never re-sends a group's copy whose answer was lost.
  outbound: sesOutbound(new SESv2Client({ maxAttempts: 1 }), required(environmentVariables.configurationSet)),
  bounces: sesBounces(new SESClient({})),
});
