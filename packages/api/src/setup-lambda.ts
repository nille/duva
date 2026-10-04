// The Lambda entry point that sets up the organization. duva deploy invokes it after each deploy,
// and the CDK app sets the environment from what deploy gave the stack.
import { CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { required } from "./environment.ts";
import { cognitoHumans } from "./user-pool.ts";
import { environmentVariables } from "./infrastructure.ts";
import { setUpOrganization } from "./organization.ts";

const table = { client: new DynamoDBClient({}), name: required(environmentVariables.tableName) };
const humans = cognitoHumans(new CognitoIdentityProviderClient({}), required(environmentVariables.userPoolId));

/** Sets up the organization and returns its first admin. */
export const handler = () =>
  setUpOrganization(
    { table, humans },
    { domain: required(environmentVariables.domain), admin: required(environmentVariables.admin) },
  );
