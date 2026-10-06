// The Lambda entry point for the feeder, which the table's stream invokes with each mailbox's new
// changes, to give the indexer its tasks. The CDK app sets the environment.
import { SQSClient } from "@aws-sdk/client-sqs";
import { required } from "./environment.ts";
import { createFeeder, sqsIndexQueue } from "./indexing.ts";
import { environmentVariables } from "./infrastructure.ts";

export const handler = createFeeder(sqsIndexQueue(new SQSClient({}), required(environmentVariables.indexQueue)));
