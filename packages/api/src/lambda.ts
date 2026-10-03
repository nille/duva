// The Lambda entry point for the API. The CDK app sets the environment.
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { createApi } from "./api.ts";
import { s3MailStore } from "./mail-store.ts";

export const handler = createApi({
  version: environment("DUVA_VERSION"),
  region: environment("AWS_REGION"),
  table: { client: new DynamoDBClient({}), name: environment("TABLE_NAME") },
  mail: s3MailStore(new S3Client({}), environment("MAIL_BUCKET")),
});

function environment(name: string): string {
  const value = process.env[name];
  if (value === undefined) throw new Error(`The environment variable ${name} is not set`);
  return value;
}
