// The Lambda entry point SNS invokes with what SES reports about Duva's sends: bounces, complaints
// and rejects. The CDK app sets the environment.
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { SESv2Client } from "@aws-sdk/client-sesv2";
import { required } from "./environment.ts";
import { createFeedback } from "./feedback.ts";
import { environmentVariables } from "./infrastructure.ts";
import { sesSuppressionList } from "./suppression.ts";

export const handler = createFeedback({
  table: { client: new DynamoDBClient({}), name: required(environmentVariables.tableName) },
  suppressionList: sesSuppressionList(new SESv2Client({})),
});
