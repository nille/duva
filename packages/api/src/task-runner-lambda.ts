// The Lambda entry point for the task runner, which the task giver and the API invoke asynchronously
// with each task to run, and which runs the mailbox agent on it on AgentCore (ADR-0029). The CDK app
// sets the environment.
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { agentCoreRuntime } from "./agentcore.ts";
import { required } from "./environment.ts";
import { environmentVariables } from "./infrastructure.ts";
import { createTaskRunner } from "./tasks.ts";

// The API's URL is a parameter the stack writes, as for the conversation Lambda.
const { Parameter } = await new SSMClient({}).send(new GetParameterCommand({ Name: required(environmentVariables.apiUrlParameter) }));

export const handler = createTaskRunner({
  table: { client: new DynamoDBClient({}), name: required(environmentVariables.tableName) },
  region: required("AWS_REGION"),
  apiUrl: Parameter!.Value!,
  runtime: agentCoreRuntime(required(environmentVariables.agentRuntime)),
});
