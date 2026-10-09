// The Lambda entry point for the API. The CDK app sets the environment.
import { CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { LambdaClient } from "@aws-sdk/client-lambda";
import { S3Client } from "@aws-sdk/client-s3";
import { SESClient } from "@aws-sdk/client-ses";
import { SESv2Client } from "@aws-sdk/client-sesv2";
import { SQSClient } from "@aws-sdk/client-sqs";
import { createApi } from "./api.ts";
import { downloadLinkLifetime } from "./attachments.ts";
import { cognitoHumans, cognitoSignInSender } from "./user-pool.ts";
import { realDns } from "./dns-records.ts";
import { sesIdentities } from "./identities.ts";
import { environmentVariables } from "./infrastructure.ts";
import { s3MailBucket } from "./mail-bucket.ts";
import { required } from "./environment.ts";
import { lambdaEraser } from "./erasure.ts";
import { sqsIndexQueue } from "./indexing.ts";
import { sesReceiptRules } from "./receiving.ts";
import { lambdaSearcher } from "./searching.ts";
import { sesSuppressionList } from "./suppression.ts";
import { lambdaUnsubscriber } from "./unsubscriber.ts";
import { lambdaWaitingSends } from "./limits.ts";
import { SchedulerClient } from "@aws-sdk/client-scheduler";
import { eventBridgeReminders } from "./reminders.ts";
import { X509Certificate } from "node:crypto";
import { markRoots } from "./mark-roots.ts";
import { s3HostedLogos } from "./own-logos.ts";
import { lambdaTaskRunner } from "./tasks.ts";
import { s3UploadsBucket } from "./uploads-bucket.ts";

const mailBucket = required(environmentVariables.mailBucket);
const lambda = new LambdaClient({});
const cognito = new CognitoIdentityProviderClient({});
const userPoolId = required(environmentVariables.userPoolId);
const configurationSet = required(environmentVariables.configurationSet);
const sesV2 = new SESv2Client({});

export const handler = createApi({
  version: required(environmentVariables.version),
  region: required("AWS_REGION"),
  table: { client: new DynamoDBClient({}), name: required(environmentVariables.tableName) },
  humans: cognitoHumans(cognito, userPoolId),
  signInSender: cognitoSignInSender(cognito, userPoolId, configurationSet),
  identities: sesIdentities(sesV2, configurationSet),
  dns: realDns,
  mailBucket: s3MailBucket(new S3Client({}), mailBucket),
  uploads: s3UploadsBucket(required(environmentVariables.uploadsBucket)),
  receiving: {
    rules: sesReceiptRules(new SESClient({}), required(environmentVariables.receiptRuleSet)),
    bucket: mailBucket,
    inboundFunction: required(environmentVariables.inboundFunction),
    suppressionList: sesSuppressionList(sesV2),
  },
  eraser: lambdaEraser(lambda, required(environmentVariables.eraserFunction)),
  unsubscriber: lambdaUnsubscriber(lambda, required(environmentVariables.unsubscriberFunction)),
  searcher: lambdaSearcher(lambda, required(environmentVariables.searchFunction)),
  indexQueue: sqsIndexQueue(new SQSClient({}), required(environmentVariables.indexQueue)),
  waitingSends: lambdaWaitingSends(lambda, required(environmentVariables.senderFunction)),
  reminders: eventBridgeReminders(new SchedulerClient({}), {
    group: required(environmentVariables.scheduleGroup),
    sender: required(environmentVariables.senderFunction),
    role: required(environmentVariables.schedulerRole),
  }),
  downloads: { url: required(environmentVariables.downloadUrl), lifetime: downloadLinkLifetime },
  hostedLogos: s3HostedLogos(
    new S3Client({}),
    required(environmentVariables.logosBucket),
    required(environmentVariables.logosUrl),
    markRoots.map((pem) => new X509Certificate(pem)),
  ),
  tasks: lambdaTaskRunner(lambda, required(environmentVariables.taskRunnerFunction)),
});
