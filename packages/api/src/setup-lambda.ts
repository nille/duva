// The Lambda entry point that sets up the organization. duva deploy invokes it after each deploy,
// and the CDK app sets the environment from what deploy gave the stack.
import { CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { SQSClient } from "@aws-sdk/client-sqs";
import { required } from "./environment.ts";
import { cognitoHumans } from "./user-pool.ts";
import { environmentVariables } from "./infrastructure.ts";
import { listEarlierDecisions } from "./approval-log.ts";
import { indexMailboxes, sqsIndexQueue } from "./indexing.ts";
import { timeEarlierLabels } from "./mail.ts";
import { setUpOrganization } from "./organization.ts";
import { setUpScreeners } from "./screening.ts";

const table = { client: new DynamoDBClient({}), name: required(environmentVariables.tableName) };
const humans = cognitoHumans(new CognitoIdentityProviderClient({}), required(environmentVariables.userPoolId));

/** Sets up the organization and returns its first admin. */
export const handler = async () => {
  const admin = await setUpOrganization(
    { table, humans },
    { domain: required(environmentVariables.domain), admin: required(environmentVariables.admin) },
  );
  // Threads in Spam and Trash from before erasure existed count their retention period from now.
  await timeEarlierLabels(table);
  // Humans' mailboxes from before the Screener get it on, with every sender they already have let in.
  await setUpScreeners(table);
  // Decisions on approvals from before the approval log are listed in it, once.
  await listEarlierDecisions(table);
  // Each mailbox's index is backfilled with the mail it has, or its backfill finished if one stopped.
  await indexMailboxes(table, sqsIndexQueue(new SQSClient({}), required(environmentVariables.indexQueue)));
  return admin;
};
