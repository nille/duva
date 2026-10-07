// The Lambda entry point for Duva's MCP endpoint (ADR-0028), which API Gateway invokes for its routes
// on the API's domain, without the authorizer, since the endpoint verifies tokens itself. The CDK
// app sets the environment.
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import { required } from "./environment.ts";
import { environmentVariables } from "./infrastructure.ts";
import { createMcp } from "./mcp.ts";

const lambda = new LambdaClient({});
const conversationFunction = required(environmentVariables.conversationFunction);
// Access tokens from the user pool's app client for MCP clients, which the API's authorizer refuses.
const appClient = required(environmentVariables.mcpClientId);
const verifier = CognitoJwtVerifier.create({ userPoolId: required(environmentVariables.userPoolId), tokenUse: "access", clientId: appClient });

const mcp = createMcp({
  version: required(environmentVariables.version),
  region: required("AWS_REGION"),
  table: { client: new DynamoDBClient({}), name: required(environmentVariables.tableName) },
  signInUrl: required(environmentVariables.signInUrl),
  appClient,
  verifyAccessToken: async (token) => {
    const { sub, client_id: clientId } = await verifier.verify(token);
    return { sub, clientId };
  },
  // The stack leaves the runtime out where AgentCore isn't, and gives its ARN as empty. A turn runs
  // in the conversation Lambda, which this one doesn't wait for, so it may outlast API Gateway's 30 seconds.
  turns:
    required(environmentVariables.agentRuntime) === ""
      ? undefined
      : {
          async start(prepared) {
            await lambda.send(new InvokeCommand({ FunctionName: conversationFunction, InvocationType: "Event", Payload: JSON.stringify({ run: prepared }) }));
          },
        },
  // API Gateway ends a call after 30 seconds.
  askWait: 20_000,
});

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  const query = event.rawQueryString === "" ? "" : `?${event.rawQueryString}`;
  const method = event.requestContext.http.method;
  const body = event.body === undefined ? undefined : event.isBase64Encoded ? Buffer.from(event.body, "base64") : event.body;
  const headers = Object.entries(event.headers).flatMap(([name, value]): [string, string][] => (value === undefined ? [] : [[name, value]]));
  const response = await mcp(new Request(`https://${event.requestContext.domainName}${event.rawPath}${query}`, { method, headers, body: method === "GET" || method === "HEAD" ? undefined : body }));
  return { statusCode: response.status, headers: Object.fromEntries(response.headers), body: await response.text() };
}
