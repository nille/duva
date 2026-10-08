// The Lambda entry point a turn of Ask Coo reaches, through the web app's CloudFront
// distribution under /agent/, which signs each request to its function URL, so only CloudFront
// invokes it (docs/aws.md). It streams what the mailbox agent says and does as the run goes
// (ADR-0027). The CDK app sets the environment.
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import type { LambdaFunctionURLEvent } from "aws-lambda";
import { agentCoreRuntime } from "./agentcore.ts";
import { createConversation, type PreparedTurn } from "./conversation.ts";
import { required } from "./environment.ts";
import { environmentVariables } from "./infrastructure.ts";
import { titanEmbedder } from "./titan.ts";

// How often the stream says it is alive while the agent runs, in milliseconds.
const keepAlive = 20_000;
// The API's URL is a parameter the stack writes, since the API, which the web app's distribution
// allows to call it, and this Lambda, which the distribution reaches, can't name each other.
const { Parameter } = await new SSMClient({}).send(new GetParameterCommand({ Name: required(environmentVariables.apiUrlParameter) }));

const conversation = createConversation({
  table: { client: new DynamoDBClient({}), name: required(environmentVariables.tableName) },
  region: required("AWS_REGION"),
  apiUrl: Parameter!.Value!,
  runtime: agentCoreRuntime(required(environmentVariables.agentRuntime)),
  embedder: titanEmbedder(),
});

// A turn comes through the function URL, or from the MCP Lambda, which invokes this one through IAM
// without waiting, with the turn it prepared, so the run goes on after its own answer.
export const handler = awslambda.streamifyResponse<LambdaFunctionURLEvent | { run: PreparedTurn }>(async (event, responseStream) => {
  if ("run" in event) {
    for await (const _ of conversation.run(event.run));
    responseStream.end();
    return;
  }
  const body = event.isBase64Encoded ? Buffer.from(event.body ?? "", "base64").toString() : (event.body ?? "");
  const answer = await conversation.turn({ headers: event.headers, body });
  const headers = { "content-type": "events" in answer ? "application/x-ndjson" : "application/json", "cache-control": "no-store" };
  const stream = awslambda.HttpResponseStream.from(responseStream, { statusCode: answer.statusCode, headers });
  // The runtime sends the status and headers with the first write (docs/aws.md).
  if (!("events" in answer)) {
    stream.write(JSON.stringify(answer.body));
    stream.end();
    return;
  }
  // CloudFront gives up on an origin silent for its read timeout, 60 seconds, which a model's long
  // thought could reach, so an empty line keeps the stream going. The web app skips it.
  stream.write("\n");
  const alive = setInterval(() => stream.write("\n"), keepAlive);
  try {
    for await (const each of answer.events) stream.write(`${JSON.stringify(each)}\n`);
  } finally {
    clearInterval(alive);
    stream.end();
  }
});
