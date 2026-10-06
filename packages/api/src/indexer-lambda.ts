// The Lambda entry point for the indexer, which reads its FIFO queue, one batch per mailbox at a
// time. The CDK app sets the environment.
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { SQSClient } from "@aws-sdk/client-sqs";
import { required } from "./environment.ts";
import { createIndexer, sqsIndexQueue } from "./indexing.ts";
import { environmentVariables } from "./infrastructure.ts";
import { lanceSearch } from "./lancedb-search.ts";
import { s3MailBucket } from "./mail-bucket.ts";

export const handler = createIndexer({
  table: { client: new DynamoDBClient({}), name: required(environmentVariables.tableName) },
  mailBucket: s3MailBucket(new S3Client({}), required(environmentVariables.mailBucket)),
  engine: lanceSearch({ uri: required(environmentVariables.searchIndexes), storageOptions: { region: required("AWS_REGION") } }),
  queue: sqsIndexQueue(new SQSClient({}), required(environmentVariables.indexQueue)),
});
