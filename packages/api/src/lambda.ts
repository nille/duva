// The Lambda entry point for the API. The CDK app sets the environment.
import { CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { LambdaClient } from "@aws-sdk/client-lambda";
import { S3Client } from "@aws-sdk/client-s3";
import { SESClient } from "@aws-sdk/client-ses";
import { SESv2Client } from "@aws-sdk/client-sesv2";
import { createApi } from "./api.ts";
import { downloadLinkLifetime } from "./attachments.ts";
import { cognitoHumans, cognitoSignInSender } from "./user-pool.ts";
import { realDns } from "./dns-records.ts";
import { sesIdentities } from "./identities.ts";
import { environmentVariables } from "./infrastructure.ts";
import { s3MailBucket } from "./mail-bucket.ts";
import { required } from "./environment.ts";
import { lambdaEraser } from "./erasure.ts";
import { sesReceiptRules } from "./receiving.ts";
import { lambdaSearcher } from "./searching.ts";
import { lambdaUnsubscriber } from "./unsubscriber.ts";

const mailBucket = required(environmentVariables.mailBucket);
const lambda = new LambdaClient({});
const cognito = new CognitoIdentityProviderClient({});
const userPoolId = required(environmentVariables.userPoolId);
const configurationSet = required(environmentVariables.configurationSet);

export const handler = createApi({
  version: required(environmentVariables.version),
  region: required("AWS_REGION"),
  table: { client: new DynamoDBClient({}), name: required(environmentVariables.tableName) },
  humans: cognitoHumans(cognito, userPoolId),
  signInSender: cognitoSignInSender(cognito, userPoolId, configurationSet),
  identities: sesIdentities(new SESv2Client({}), configurationSet),
  dns: realDns,
  mailBucket: s3MailBucket(new S3Client({}), mailBucket),
  receiving: {
    rules: sesReceiptRules(new SESClient({}), required(environmentVariables.receiptRuleSet)),
    bucket: mailBucket,
    inboundFunction: required(environmentVariables.inboundFunction),
  },
  eraser: lambdaEraser(lambda, required(environmentVariables.eraserFunction)),
  unsubscriber: lambdaUnsubscriber(lambda, required(environmentVariables.unsubscriberFunction)),
  searcher: lambdaSearcher(lambda, required(environmentVariables.searchFunction)),
  downloads: { url: required(environmentVariables.downloadUrl), lifetime: downloadLinkLifetime },
});
