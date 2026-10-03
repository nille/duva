// The Lambda entry point for the API. The CDK app sets the environment.
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { createApi } from "./api.ts";
import { environmentVariables } from "./infrastructure.ts";
import { s3MailBucket } from "./mail-bucket.ts";

export const handler = createApi({
  version: required(environmentVariables.version),
  region: required("AWS_REGION"),
  table: { client: new DynamoDBClient({}), name: required(environmentVariables.tableName) },
  mailBucket: s3MailBucket(new S3Client({}), required(environmentVariables.mailBucket)),
});

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined) throw new Error(`The environment variable ${name} is not set`);
  return value;
}
