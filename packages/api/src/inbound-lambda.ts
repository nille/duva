// The Lambda entry point SES invokes for each message it receives. The CDK app sets the environment.
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { required } from "./environment.ts";
import { createInbound } from "./inbound.ts";
import { environmentVariables } from "./infrastructure.ts";
import { s3MailBucket } from "./mail-bucket.ts";

export const handler = createInbound({
  table: { client: new DynamoDBClient({}), name: required(environmentVariables.tableName) },
  mailBucket: s3MailBucket(new S3Client({}), required(environmentVariables.mailBucket)),
});
