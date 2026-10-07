// The Lambda entry point SES invokes for each message it receives. It re-sends groups' mail to
// their external members and bounces what a group refuses, through SES, looks up senders' logos in
// DNS, fetching them through the logo fetcher Lambda, and invokes the unsubscriber for mail it drops. The CDK app sets the environment.
import { X509Certificate } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { LambdaClient } from "@aws-sdk/client-lambda";
import { S3Client } from "@aws-sdk/client-s3";
import { SESClient } from "@aws-sdk/client-ses";
import { SESv2Client } from "@aws-sdk/client-sesv2";
import { required } from "./environment.ts";
import { sesBounces } from "./group-mail.ts";
import { realDns } from "./dns-records.ts";
import { createInbound } from "./inbound.ts";
import { environmentVariables } from "./infrastructure.ts";
import { s3MailBucket } from "./mail-bucket.ts";
import { markRoots } from "./mark-roots.ts";
import { lambdaLogoFetcher, logoUrl } from "./sender-logos.ts";
import { sesOutbound } from "./sending.ts";
import { lambdaUnsubscriber } from "./unsubscriber.ts";

export const handler = createInbound({
  table: { client: new DynamoDBClient({}), name: required(environmentVariables.tableName) },
  mailBucket: s3MailBucket(new S3Client({}), required(environmentVariables.mailBucket)),
  // Straight to stdout, without the prefix console.log adds, so CloudWatch reads each line's embedded metrics.
  log: (line) => process.stdout.write(`${line}\n`),
  // One attempt per call, so the SDK never re-sends a group's copy whose answer was lost.
  outbound: sesOutbound(new SESv2Client({ maxAttempts: 1 }), required(environmentVariables.configurationSet)),
  bounces: sesBounces(new SESClient({})),
  logos: {
    dns: realDns,
    fetcher: lambdaLogoFetcher(new LambdaClient({}), required(environmentVariables.logoFetcherFunction)),
    roots: markRoots.map((pem) => new X509Certificate(pem)),
    url: (logo) => logoUrl(required(environmentVariables.downloadUrl), logo),
  },
  unsubscriber: lambdaUnsubscriber(new LambdaClient({}), required(environmentVariables.unsubscriberFunction)),
});
