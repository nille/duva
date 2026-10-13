// The Lambda entry point for the task runner, which the task giver and the API invoke asynchronously
// with each task to run, and which runs the mailbox agent on it on AgentCore (ADR-0029), and which
// the API and the inbound Lambda invoke with what one-click left of unsubscribing from a sender,
// which the mailbox agent goes on with (ADR-0031), and with mail to a Coo's address to settle and
// run, or a send Coo said it would follow up (ADR-0040), and with each payment its human approved,
// to go back and pay (#171). The CDK app sets the environment.
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { SESClient } from "@aws-sdk/client-ses";
import { SESv2Client } from "@aws-sdk/client-sesv2";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { agentCoreRuntime } from "./agentcore.ts";
import { createCooMail } from "./coo-mail.ts";
import { required } from "./environment.ts";
import { sesBounces } from "./group-mail.ts";
import { environmentVariables } from "./infrastructure.ts";
import { s3MailBucket } from "./mail-bucket.ts";
import { sesOutbound } from "./outbound.ts";
import { createPaymentRunner } from "./payment-runs.ts";
import { createTaskRunner, type TaskRunnerEvent } from "./tasks.ts";
import { titanEmbedder } from "./titan.ts";
import { createUnsubscribeRunner } from "./unsubscribe-runs.ts";

// The API's URL is a parameter the stack writes, as for the conversation Lambda.
const { Parameter } = await new SSMClient({}).send(new GetParameterCommand({ Name: required(environmentVariables.apiUrlParameter) }));

const deployment = {
  table: { client: new DynamoDBClient({}), name: required(environmentVariables.tableName) },
  region: required("AWS_REGION"),
  apiUrl: Parameter!.Value!,
  runtime: agentCoreRuntime(required(environmentVariables.agentRuntime)),
};
const runTask = createTaskRunner(deployment);
const unsubscribe = createUnsubscribeRunner({ ...deployment, bounces: sesBounces(new SESClient({})) });
const pay = createPaymentRunner(deployment);

const cooMail = createCooMail({
  ...deployment,
  embedder: titanEmbedder(),
  // One attempt per call, so the SDK never sends Coo's mail twice when an answer was lost.
  outbound: sesOutbound(new SESv2Client({ maxAttempts: 1 }), required(environmentVariables.configurationSet)),
  mailBucket: s3MailBucket(new S3Client({}), required(environmentVariables.mailBucket)),
});

export const handler = (event: TaskRunnerEvent) =>
  "unsubscribe" in event ? unsubscribe(event.unsubscribe) : "cooMail" in event ? cooMail(event.cooMail) : "payment" in event ? pay(event.payment) : runTask(event);
