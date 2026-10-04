// The Lambda entry point for the eraser, which its schedule invokes once a day and the API invokes,
// without waiting, for each Trash emptied. The CDK app sets the environment.
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { required } from "./environment.ts";
import { createEraser } from "./erasure.ts";
import { environmentVariables } from "./infrastructure.ts";
import { s3MailBucket } from "./mail-bucket.ts";

export const handler = createEraser({
  table: { client: new DynamoDBClient({}), name: required(environmentVariables.tableName) },
  mailBucket: s3MailBucket(new S3Client({}), required(environmentVariables.mailBucket)),
});
