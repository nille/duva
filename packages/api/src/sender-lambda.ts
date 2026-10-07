// The Lambda entry point the table's stream invokes for each draft a decision approved and each
// urgent alert to mail, the API and EventBridge Scheduler for an agent whose sends wait for its
// limits, and EventBridge Scheduler for each thread due back from Remind me and each draft whose
// undo window is over. The CDK app sets the environment and the filters.
import type { Context } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { SchedulerClient } from "@aws-sdk/client-scheduler";
import { SESv2Client } from "@aws-sdk/client-sesv2";
import { required } from "./environment.ts";
import { environmentVariables } from "./infrastructure.ts";
import { eventBridgeSchedules } from "./limits.ts";
import { s3MailBucket } from "./mail-bucket.ts";
import { realDns } from "./dns-records.ts";
import { createSender, sesOutbound } from "./sending.ts";

const table = { client: new DynamoDBClient({}), name: required(environmentVariables.tableName) };
const mailBucket = s3MailBucket(new S3Client({}), required(environmentVariables.mailBucket));
const region = required("AWS_REGION");
// One attempt per call, so the SDK never sends a message again whose answer was lost.
const outbound = sesOutbound(new SESv2Client({ maxAttempts: 1 }), required(environmentVariables.configurationSet));
const scheduler = new SchedulerClient({});
const schedule = { group: required(environmentVariables.scheduleGroup), role: required(environmentVariables.schedulerRole) };

export const handler = (event: Parameters<ReturnType<typeof createSender>>[0], context: Context) =>
  // The schedules invoke this function, which the CDK app can't name in its own environment.
  createSender({ table, mailBucket, region, outbound, dns: realDns, schedules: eventBridgeSchedules(scheduler, { ...schedule, sender: context.invokedFunctionArn }) })(event);
