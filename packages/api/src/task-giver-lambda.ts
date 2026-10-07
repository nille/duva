// The Lambda entry point for the task giver, which the table's stream invokes with each change that
// may add a label in a mailbox, to give the mailbox agent the tasks labels' prompts ask for
// (ADR-0029). The CDK app sets the environment.
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { LambdaClient } from "@aws-sdk/client-lambda";
import { required } from "./environment.ts";
import { environmentVariables } from "./infrastructure.ts";
import { createTaskGiver, lambdaTaskRunner } from "./tasks.ts";

export const handler = createTaskGiver({
  table: { client: new DynamoDBClient({}), name: required(environmentVariables.tableName) },
  runner: lambdaTaskRunner(new LambdaClient({}), required(environmentVariables.taskRunnerFunction)),
});
