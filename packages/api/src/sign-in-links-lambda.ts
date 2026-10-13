// The Lambda entry point for the user pool's custom challenge, which signs a human in with a
// sign-in link (ADR-0041). Only the user pool invokes it, for its define, create and verify triggers.
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { required } from "./environment.ts";
import { environmentVariables } from "./infrastructure.ts";
import { signInLinkTriggers } from "./sign-in-links.ts";

export const handler = signInLinkTriggers({ client: new DynamoDBClient({}), name: required(environmentVariables.tableName) });
