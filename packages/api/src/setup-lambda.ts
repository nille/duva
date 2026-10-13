// The Lambda entry point that sets up the organization. duva deploy invokes it after each deploy,
// and the CDK app sets the environment from what deploy gave the stack.
import { CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { LambdaClient } from "@aws-sdk/client-lambda";
import { SESClient } from "@aws-sdk/client-ses";
import { SESv2Client } from "@aws-sdk/client-sesv2";
import { SQSClient } from "@aws-sdk/client-sqs";
import { required } from "./environment.ts";
import { cognitoHumans, cognitoSignInSender } from "./user-pool.ts";
import { sesOutbound } from "./outbound.ts";
import { setUpFirstAdmin } from "./sign-in-links.ts";
import { environmentVariables } from "./infrastructure.ts";
import { listEarlierDecisions } from "./approval-log.ts";
import { eraseBlockedSenders, lambdaEraser } from "./erasure.ts";
import { indexMailboxes, sqsIndexQueue } from "./indexing.ts";
import { timeEarlierLabels } from "./mail.ts";
import { giveMailboxAgents } from "./mailbox-agents.ts";
import { carryOverModelChoices, keepEarlierModels, setUpOrganization } from "./organization.ts";
import { sesReceiptRules, syncRecipients } from "./receiving.ts";
import { eraseAgentsMailboxes } from "./removal.ts";
import { setUpDeliveries, setUpScreeners } from "./screening.ts";
import { sesSuppressionList } from "./suppression.ts";

const table = { client: new DynamoDBClient({}), name: required(environmentVariables.tableName) };
// Setup only adds humans, and mails no sign-in codes, so it names no app client for them.
const cognito = new CognitoIdentityProviderClient({});
const humans = cognitoHumans(cognito, required(environmentVariables.userPoolId), "");
const eraser = lambdaEraser(new LambdaClient({}), required(environmentVariables.eraserFunction));
const receiving = {
  rules: sesReceiptRules(new SESClient({}), required(environmentVariables.receiptRuleSet)),
  bucket: required(environmentVariables.mailBucket),
  inboundFunction: required(environmentVariables.inboundFunction),
  suppressionList: sesSuppressionList(new SESv2Client({})),
};

// The first admin's first sign-in link goes from the domain the user pool sends codes from (ADR-0041),
// with one attempt per call, so a lost answer never mails it twice.
const configurationSet = required(environmentVariables.configurationSet);
const mailing = {
  table,
  webUrl: required(environmentVariables.webUrl),
  signInSender: cognitoSignInSender(cognito, required(environmentVariables.userPoolId), configurationSet),
  outbound: sesOutbound(new SESv2Client({ maxAttempts: 1 }), configurationSet),
};

/** Sets up the organization and returns its first admin, with the first sign-in link it mailed them, if it did now. */
export const handler = async () => {
  const admin = await setUpFirstAdmin(
    mailing,
    await setUpOrganization({ table, humans }, { domain: required(environmentVariables.domain), admin: required(environmentVariables.admin) }),
    process.env[environmentVariables.recovery],
  );
  // Threads in Spam and Trash from before erasure existed count their retention period from now.
  await timeEarlierLabels(table);
  // Agents own no mailboxes (ADR-0030), so those they owned before are erased, their addresses freed.
  await eraseAgentsMailboxes({ table, eraser, receiving });
  // Decisions from before deliveries become deliveries, and threads are listed by whom they are from.
  await setUpDeliveries(table);
  // Blocks from before deliveries became nowhere, so the threads they put in Trash are erased, once, as nowhere erases.
  await eraseBlockedSenders(table, eraser);
  // Humans' mailboxes from before the Screener get it on, with every sender they already have sent to the Inbox.
  await setUpScreeners(table);
  // Each human's mailbox agents from before one per human are merged into one, once (ADR-0033), humans
  // from before mailbox agents get theirs, and those named before Coo are renamed. Each Coo gets its
  // address (ADR-0040), which SES takes mail for from then on.
  await giveMailboxAgents(table);
  await syncRecipients(table, receiving);
  // The models admins chose before each human picked their mailbox agent's become the organization's defaults, once (ADR-0035).
  await carryOverModelChoices(table);
  // An organization from before GPT-6 Luna and Sol became the defaults keeps the models it had, once (#158).
  await keepEarlierModels(table);
  // Decisions on approvals from before the approval log are listed in it, once.
  await listEarlierDecisions(table);
  // Each mailbox's index is backfilled with the mail it has, or its backfill finished if one stopped.
  await indexMailboxes(table, sqsIndexQueue(new SQSClient({}), required(environmentVariables.indexQueue)));
  return admin;
};
