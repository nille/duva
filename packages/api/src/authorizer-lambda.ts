// The Lambda entry point for the API's authorizer. The CDK app sets the environment.
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import { createAuthorizer } from "./authorizer.ts";
import { required } from "./environment.ts";
import { environmentVariables } from "./infrastructure.ts";

// Only access tokens from the deployment's user pool, issued to its own app clients.
const verifier = CognitoJwtVerifier.create({
  userPoolId: required(environmentVariables.userPoolId),
  tokenUse: "access",
  clientId: required(environmentVariables.userPoolClientIds).split(","),
});

export const handler = createAuthorizer({
  table: { client: new DynamoDBClient({}), name: required(environmentVariables.tableName) },
  verifyAccessToken: async (token) => (await verifier.verify(token)).sub,
});
