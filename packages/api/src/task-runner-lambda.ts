// The Lambda entry point for the task runner, which the task giver and the API invoke asynchronously
// with each task to run, and which runs the mailbox agent on it on AgentCore (ADR-0029), and which
// the API and the inbound Lambda invoke with what one-click left of unsubscribing from a sender,
// which the mailbox agent goes on with (ADR-0031). The CDK app sets the environment.
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { SESClient } from "@aws-sdk/client-ses";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { agentCoreRuntime } from "./agentcore.ts";
import { required } from "./environment.ts";
import { sesBounces } from "./group-mail.ts";
import { environmentVariables } from "./infrastructure.ts";
import { createTaskRunner, type TaskRunnerEvent } from "./tasks.ts";
import { createUnsubscribeRunner } from "./unsubscribe-runs.ts";

// The API's URL is a parameter the stack writes, as for the conversation Lambda.
const { Parameter } = await new SSMClient({}).send(new GetParameterCommand({ Name: required(environmentVariables.apiUrlParameter) }));

const deployment = {
  table: { client: new DynamoDBClient({}), name: required(environmentVariables.tableName) },
  region: required("AWS_REGION"),
  apiUrl: Parameter!.Value!,
  runtime: agentCoreRuntime(required(environmentVariables.agentRuntime)),
};
const runTask = createTaskRunner(deployment);
const unsubscribe = createUnsubscribeRunner({ ...deployment, bounces: sesBounces(new SESClient({})) });

export const handler = (event: TaskRunnerEvent) => ("unsubscribe" in event ? unsubscribe(event.unsubscribe) : runTask(event));
