// The Lambda entry point a turn of Ask your agent reaches, through the web app's CloudFront
// distribution under /agent/, which signs each request to its function URL, so only CloudFront
// invokes it (docs/aws.md). It streams what the mailbox agent says and does as the run goes, and ends
// the run's AgentCore session when it is done, so it bills nothing after (ADR-0027). The CDK app sets
// the environment.
import { BedrockAgentCoreClient, InvokeAgentRuntimeCommand, StopRuntimeSessionCommand } from "@aws-sdk/client-bedrock-agentcore";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import type { LambdaFunctionURLEvent } from "aws-lambda";
import type { RunEvent } from "./agent-loop.ts";
import { type AgentRuntime, createConversation, type PreparedTurn } from "./conversation.ts";
import { required } from "./environment.ts";
import { environmentVariables } from "./infrastructure.ts";

const agentCore = new BedrockAgentCoreClient({});
// How often the stream says it is alive while the agent runs, in milliseconds.
const keepAlive = 20_000;
const runtimeArn = required(environmentVariables.agentRuntime);

/** The run on AgentCore, whose answer is a line of JSON for each event. Its session is stopped once the run ends. */
const agentCoreRuntime: AgentRuntime = async function* (payload, session) {
  try {
    const { response } = await agentCore.send(
      new InvokeAgentRuntimeCommand({ agentRuntimeArn: runtimeArn, runtimeSessionId: session, contentType: "application/json", accept: "application/x-ndjson", payload: new TextEncoder().encode(JSON.stringify(payload)) }),
    );
    let pending = "";
    for await (const chunk of (response ?? []) as AsyncIterable<Uint8Array>) {
      pending += new TextDecoder().decode(chunk, { stream: true });
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) if (line.trim() !== "") yield JSON.parse(line) as RunEvent;
    }
    if (pending.trim() !== "") yield JSON.parse(pending) as RunEvent;
  } finally {
    await agentCore.send(new StopRuntimeSessionCommand({ agentRuntimeArn: runtimeArn, runtimeSessionId: session })).catch((error: unknown) => console.error(error));
  }
};

// The API's URL is a parameter the stack writes, since the API, which the web app's distribution
// allows to call it, and this Lambda, which the distribution reaches, can't name each other.
const { Parameter } = await new SSMClient({}).send(new GetParameterCommand({ Name: required(environmentVariables.apiUrlParameter) }));

const conversation = createConversation({
  table: { client: new DynamoDBClient({}), name: required(environmentVariables.tableName) },
  region: required("AWS_REGION"),
  apiUrl: Parameter!.Value!,
  // The stack leaves the runtime out where AgentCore isn't, and gives its ARN as empty.
  runtime: runtimeArn === "" ? undefined : agentCoreRuntime,
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
