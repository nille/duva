// The Lambda entry point SNS invokes with what SES reports about Duva's sends: bounces, complaints
// and rejects. The CDK app sets the environment.
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { required } from "./environment.ts";
import { createFeedback } from "./feedback.ts";
import { environmentVariables } from "./infrastructure.ts";

export const handler = createFeedback({ table: { client: new DynamoDBClient({}), name: required(environmentVariables.tableName) } });
