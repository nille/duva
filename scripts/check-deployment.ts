// Checks a Duva deployment from the outside, in one region of the configured AWS account:
//
//   AWS_REGION=eu-north-1 node scripts/check-deployment.ts
//
// Runs the checks of a real run that need no human: the API answers, refuses calls without valid
// credentials, and lets the web app call it; download links go through the web app's domain, and
// only its distribution may invoke the download Lambda; the bucket of files uploaded to drafts blocks public access, keeps
// no versions, gives up an upload after a day and takes a browser's parts only from the web app's domain; the organization's own logos are served to
// anyone there, as SVG or PEM, from a bucket only CloudFront reads; nothing but IAM may invoke the
// unsubscriber and the logo fetcher, which refuse addresses that aren't public; the web app is served with the config
// deploy published; the user pool takes sign-in names in any case, sends its codes from a domain
// SES has verified, and still offers emailed codes, and no pool the stack retired is left; once an address exists, SES's receipt rules list each address, and each domain with a catch-all, once, and none is on SES's
// suppression list, which only warns; and no received mail and no approved send waits in a failure queue; Duva's configuration set publishes only bounces,
// complaints and rejects, to a topic that only it may invoke the feedback Lambda for, and no event
// of SES's waits in the feedback Lambda's failure queue; nothing but IAM may invoke search, which runs at 10,240 MB
// on x64, and Nova Lite translates in the region; every mailbox's search index is backfilled, naming any whose backfill is stuck, none has held
// erased mail for more than a day, and no indexer task waits in its failure queue; nothing but IAM
// may invoke the sender, and no schedule for sends that wait for an agent's limits, or for threads set aside in Remind me, is overdue; Ask your agent's
// turns reach the conversation Lambda only through the web app's domain, the mailbox agents' AgentCore Runtime is ready and takes only IAM calls, their unsubscribe browser is ready on the public network and records nothing, the inbound Lambda is given the task runner, only IAM invokes the task runner, which retries no run, and no task is stuck working, every
// human's mailbox has its mailbox agent, no agent owns a mailbox, and Claude answers from eu-central-1 through the eu profile; and with
// DUVA_TEST_HUMAN_CODES_KEY, All mailboxes answers for the test human's agent as its mailboxes do. Signing in stays
// with a human. Then prints how many
// messages Duva dropped on arrival each day of the last 7, by reason. Exits 1 if any check fails.
import { CloudFormationClient, DescribeStacksCommand, paginateListStackResources } from "@aws-sdk/client-cloudformation";
import { CloudWatchClient, GetMetricDataCommand } from "@aws-sdk/client-cloudwatch";
import { CognitoIdentityProviderClient, DescribeUserPoolCommand, paginateListUserPools } from "@aws-sdk/client-cognito-identity-provider";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  GetFunctionConfigurationCommand,
  GetFunctionEventInvokeConfigCommand,
  GetFunctionUrlConfigCommand,
  GetPolicyCommand,
  InvokeCommand,
  LambdaClient,
  paginateListEventSourceMappings,
  ResourceNotFoundException,
} from "@aws-sdk/client-lambda";
import { paginateListSchedules, SchedulerClient } from "@aws-sdk/client-scheduler";
import { DescribeReceiptRuleSetCommand, SESClient } from "@aws-sdk/client-ses";
import { GetConfigurationSetEventDestinationsCommand, GetEmailIdentityCommand, SESv2Client } from "@aws-sdk/client-sesv2";
import { GetQueueAttributesCommand, SQSClient } from "@aws-sdk/client-sqs";
import { GetBucketCorsCommand, GetBucketLifecycleConfigurationCommand, GetBucketVersioningCommand, GetPublicAccessBlockCommand, paginateListObjectsV2, S3Client } from "@aws-sdk/client-s3";
import { indexedMailboxes, uncompactedSince } from "@duva/api/indexing";
import { alertMailFilter, authorizationServerPath, conversationPath, taskGiverFilter, mcpAuthorizePath, mcpPath, mcpRegistrationPath, mcpTokenPath, protectedResourcePaths, tokenHeader, dropMetric, dropReasons, environmentVariables, hostedLogoHeaders, hostedLogosPath, inboundPrefix, receiptRuleNumber, recipientsPerRule, senderFilter, signInFrom } from "@duva/api/infrastructure";
import { rulesTake } from "@duva/api/receiving";
import { defaultMailboxAgentModel, inferenceProfileId } from "@duva/api/agent-models";
import { mailboxAgentsLeft } from "@duva/api/mailbox-agents";
import { tasksWorkingSince } from "@duva/api/tasks";
import { agentsMailboxes } from "@duva/api/removal";
import { BedrockAgentCoreControlClient, GetAgentRuntimeCommand, GetBrowserCommand } from "@aws-sdk/client-bedrock-agentcore-control";
import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { createHash } from "node:crypto";
import { sesSuppressionList } from "@duva/api/suppression";
import { novaTranslator } from "@duva/api/translation";
import { stackName, stackOutputs, stackParameters } from "@duva/infra/outputs";
import { managedLoginReached } from "@duva/api/mcp-sign-in";

const region = process.env.AWS_REGION;
if (!region) throw new Error("Set AWS_REGION to the region of the deployment to check.");

const cloudFormation = new CloudFormationClient({ region });
const [stack] =
  (
    await cloudFormation
      .send(new DescribeStacksCommand({ StackName: stackName }))
      .catch((error: Error) => {
        throw error.message.includes("does not exist") ? new Error(`There is no Duva deployment in ${region}.`) : error;
      })
  ).Stacks ?? [];
const output = (name: string) => {
  const value = stack?.Outputs?.find(({ OutputKey }) => OutputKey === name)?.OutputValue;
  if (value === undefined) throw new Error(`The Duva stack in ${region} has no ${name} output. Run duva deploy.`);
  return value;
};
const apiUrl = output(stackOutputs.apiUrl);
const webUrl = output(stackOutputs.webUrl);

let failed = false;
async function check(name: string, run: () => Promise<string | undefined>) {
  const problem = await run().catch((error: unknown) => (error instanceof Error ? error.message : String(error)));
  if (problem !== undefined) failed = true;
  console.log(problem === undefined ? `ok    ${name}` : `FAIL  ${name}: ${problem}`);
}
const expectStatus = async (response: Response, status: number) =>
  response.status === status ? undefined : `answered ${response.status}: ${(await response.text()).slice(0, 200)}`;

// The stack's table, found once, inside the checks that need it.
let found: Promise<string | undefined> | undefined;
const stackTable = async () => {
  found ??= (async () => {
    for await (const { StackResourceSummaries = [] } of paginateListStackResources({ client: cloudFormation }, { StackName: stackName })) {
      const id = StackResourceSummaries.find(({ ResourceType }) => ResourceType === "AWS::DynamoDB::GlobalTable")?.PhysicalResourceId;
      if (id !== undefined) return id;
    }
    return undefined;
  })();
  const name = await found;
  return name === undefined ? undefined : { client: new DynamoDBClient({ region }), name };
};

await check("status answers without sign-in, for the region", async () => {
  const response = await fetch(`${apiUrl}/status`);
  const body = (await response.json()) as { region?: string };
  return response.ok && body.region === region ? undefined : `answered ${response.status} ${JSON.stringify(body)}`;
});
await check("whoami without credentials answers 401", async () => expectStatus(await fetch(`${apiUrl}/whoami`), 401));
await check("whoami with a forged token answers 401", async () =>
  expectStatus(await fetch(`${apiUrl}/whoami`, { headers: { authorization: "Bearer eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ4In0.forged" } }), 401),
);
await check("whoami with an agent key Duva didn't give out answers 401", async () =>
  expectStatus(await fetch(`${apiUrl}/whoami`, { headers: { authorization: `Bearer duva_agent_${"A".repeat(43)}` } }), 401),
);
await check("creating an agent without credentials answers 401", async () =>
  expectStatus(await fetch(`${apiUrl}/agents`, { method: "POST", headers: { "content-type": "application/json" }, body: '{"name":"Check"}' }), 401),
);
await check("reading an agent's settings without credentials answers 401", async () => expectStatus(await fetch(`${apiUrl}/agents/x/settings`), 401));
await check("listing an agent's events without credentials answers 401", async () => expectStatus(await fetch(`${apiUrl}/agents/x/events?kinds=tasks&kinds=alerts&failed=true`), 401));
await check("reading one of an agent's events without credentials answers 401", async () => expectStatus(await fetch(`${apiUrl}/agents/x/events/${encodeURIComponent("alert:x")}`), 401));
await check("changing an agent's settings without credentials answers 401", async () =>
  expectStatus(await fetch(`${apiUrl}/agents/x/settings`, { method: "PATCH", headers: { "content-type": "application/json" }, body: '{"sponsorAccess":"read"}' }), 401),
);
await check("an agent asks for access without sign-in and gets a code, which waits for a human, and reading or approving it needs sign-in", async () => {
  const asked = await fetch(`${apiUrl}/access-requests`, { method: "POST", headers: { "content-type": "application/json" }, body: '{"name":"check-deployment"}' });
  if (asked.status !== 201) return `asking answered ${asked.status}`;
  const { code, deviceCode, interval } = (await asked.json()) as { code: string; deviceCode: string; interval: number };
  if (!/^[A-Z]{4}-[A-Z]{4}$/.test(code) || interval !== 5) return `asking gave the code ${code} and the interval ${interval}`;
  const collected = await fetch(`${apiUrl}/access-requests/collect`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ deviceCode }) });
  if (collected.status !== 202) return `collecting before approval answered ${collected.status}`;
  return (
    (await expectStatus(await fetch(`${apiUrl}/access-requests/${code}`), 401)) ??
    (await expectStatus(await fetch(`${apiUrl}/access-requests/${code}/approve`, { method: "POST" }), 401)) ??
    (await expectStatus(await fetch(`${apiUrl}/access-requests/${code}/decline`, { method: "POST" }), 401))
  );
});
await check("adding a human without credentials answers 401", async () =>
  expectStatus(await fetch(`${apiUrl}/humans`, { method: "POST", headers: { "content-type": "application/json" }, body: '{"email":"check@example.com"}' }), 401),
);
await check("listing humans without credentials answers 401", async () => expectStatus(await fetch(`${apiUrl}/humans`), 401));
await check("listing groups without credentials answers 401", async () => expectStatus(await fetch(`${apiUrl}/groups`), 401));
await check("creating a group without credentials answers 401", async () =>
  expectStatus(await fetch(`${apiUrl}/groups`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: "x", members: [] }) }), 401),
);
await check("changing a group without credentials answers 401", async () =>
  expectStatus(await fetch(`${apiUrl}/groups/x`, { method: "PATCH", headers: { "content-type": "application/json" }, body: "{}" }), 401),
);
await check("deleting a group without credentials answers 401", async () => expectStatus(await fetch(`${apiUrl}/groups/x`, { method: "DELETE" }), 401));
await check("listing mailboxes without credentials answers 401", async () => expectStatus(await fetch(`${apiUrl}/mailboxes`), 401));
await check("reading a mailbox without credentials answers 401", async () => expectStatus(await fetch(`${apiUrl}/mailboxes/x`), 401));
await check("listing approvals without credentials answers 401", async () => expectStatus(await fetch(`${apiUrl}/approvals`), 401));
await check("rejecting an approval without credentials answers 401", async () =>
  expectStatus(await fetch(`${apiUrl}/approvals/x/reject`, { method: "POST", headers: { "content-type": "application/json" }, body: '{"note":"Check"}' }), 401),
);
for (const read of ["read", "unread"]) {
  await check(`marking threads ${read} without credentials answers 401`, async () =>
    expectStatus(await fetch(`${apiUrl}/mailboxes/x/threads/${read}`, { method: "POST", headers: { "content-type": "application/json" }, body: '{"threads":["x"]}' }), 401),
  );
}
await check("listing a mailbox's Sent without credentials answers 401", async () => expectStatus(await fetch(`${apiUrl}/mailboxes/x/sent`), 401));
await check("getting an attachment's link without credentials answers 401", async () => expectStatus(await fetch(`${apiUrl}/mailboxes/x/messages/x/attachments/0`), 401));
// A message's headers are seen only by reading mail, which this check never does, so it sees only that they need sign-in (#145).
await check("reading a message's headers without credentials answers 401", async () => expectStatus(await fetch(`${apiUrl}/mailboxes/x/messages/x/headers`), 401));
await check("a download link Duva never gave answers 404 through the web app's domain, without credentials", async () => {
  const response = await fetch(`${output(stackOutputs.downloadUrl)}${"A".repeat(43)}`);
  const text = await response.text();
  return response.status === 404 && /expired/.test(text) ? undefined : `answered ${response.status}: ${text.slice(0, 200)}`;
});
// The organization's own logos are public, served by CloudFront from a bucket only it reads (ADR-0026).
const logosBucket = output(stackOutputs.logosBucket);
const logosUrl = output(stackOutputs.logosUrl);
const hostedKeys: string[] = [];
for await (const { Contents = [] } of paginateListObjectsV2({ client: new S3Client({ region }) }, { Bucket: logosBucket, Prefix: hostedLogosPath })) hostedKeys.push(...Contents.map(({ Key }) => Key!));
await check(`the organization's own logos, ${hostedKeys.length} files, are served to anyone under ${logosUrl}, each with its content type and headers that keep it from running anything`, async () => {
  const types = { ".svg": "image/svg+xml", ".pem": "application/pem-certificate-chain" };
  const problems: string[] = [];
  for (const key of hostedKeys) {
    const url = `${logosUrl}${key.slice(hostedLogosPath.length)}`;
    const response = await fetch(url);
    const wanted = Object.entries(types).find(([ending]) => key.endsWith(ending))?.[1];
    const headers = Object.entries(hostedLogoHeaders).every(([name, value]) => response.headers.get(name) === value);
    if (response.status !== 200 || response.headers.get("content-type") !== wanted || !headers) {
      problems.push(`${url} answered ${response.status} as ${response.headers.get("content-type")}, with content-security-policy ${response.headers.get("content-security-policy")}`);
    }
  }
  // With nothing hosted yet, CloudFront still reaches the bucket, which answers that it has no such logo.
  if (hostedKeys.length === 0) {
    const response = await fetch(`${logosUrl}domains/check.invalid.svg`);
    if (response.status !== 403 || !(await response.text()).includes("AccessDenied")) problems.push(`a logo no one set answered ${response.status}`);
  }
  return problems.length === 0 ? undefined : problems.join("; ");
});
await check("the logos bucket answers no one but CloudFront", async () => {
  const key = hostedKeys[0] ?? `${hostedLogosPath}domains/check.invalid.svg`;
  return expectStatus(await fetch(`https://${logosBucket}.s3.${region}.amazonaws.com/${key}`), 403);
});
// Files uploaded to drafts go straight to a bucket of their own, which keeps no versions, so deleting one deletes it (ADR-0034).
const uploadsBucket = output(stackOutputs.uploadsBucket);
const s3 = new S3Client({ region });
await check("starting an upload to a draft without credentials answers 401", async () => expectStatus(await fetch(`${apiUrl}/mailboxes/x/drafts/x/uploads`, { method: "POST" }), 401));
await check("the uploads bucket blocks public access and keeps no versions", async () => {
  const { PublicAccessBlockConfiguration: block = {} } = await s3.send(new GetPublicAccessBlockCommand({ Bucket: uploadsBucket }));
  const { Status } = await s3.send(new GetBucketVersioningCommand({ Bucket: uploadsBucket }));
  const blocked = block.BlockPublicAcls && block.BlockPublicPolicy && block.IgnorePublicAcls && block.RestrictPublicBuckets;
  if (!blocked) return `blocks public access only as ${JSON.stringify(block)}`;
  return Status === undefined ? undefined : `has versioning ${Status}`;
});
await check("the uploads bucket gives up an upload not completed after a day, and takes a browser's parts only from the web app's domain", async () => {
  const { Rules = [] } = await s3.send(new GetBucketLifecycleConfigurationCommand({ Bucket: uploadsBucket }));
  if (!Rules.some(({ Status, AbortIncompleteMultipartUpload }) => Status === "Enabled" && AbortIncompleteMultipartUpload?.DaysAfterInitiation === 1)) return `has the lifecycle rules ${JSON.stringify(Rules)}`;
  const { CORSRules = [] } = await s3.send(new GetBucketCorsCommand({ Bucket: uploadsBucket }));
  const origins = CORSRules.flatMap(({ AllowedOrigins = [] }) => AllowedOrigins);
  return origins.length === 1 && origins[0] === webUrl ? undefined : `lets ${origins.join(", ")} upload from a browser`;
});
// The account disables a Lambda anyone may invoke (docs/aws.md), so only CloudFront may call this one.
const lambda = new LambdaClient({ region });
const downloadFunction = output(stackOutputs.downloadFunction);
await check("the download Lambda's function URL takes only signed requests, and refuses one without", async () => {
  const { AuthType, FunctionUrl } = await lambda.send(new GetFunctionUrlConfigCommand({ FunctionName: downloadFunction }));
  if (AuthType !== "AWS_IAM") return `has AuthType ${AuthType}`;
  return expectStatus(await fetch(`${FunctionUrl}download/${"A".repeat(43)}`), 403);
});
await check("the download Lambda's policy lets only the web app's distribution invoke it, and nobody publicly", async () => {
  let distribution: string | undefined;
  for await (const { StackResourceSummaries = [] } of paginateListStackResources({ client: cloudFormation }, { StackName: stackName })) {
    distribution ??= StackResourceSummaries.find(({ ResourceType }) => ResourceType === "AWS::CloudFront::Distribution")?.PhysicalResourceId;
  }
  const { Policy } = await lambda.send(new GetPolicyCommand({ FunctionName: downloadFunction }));
  const { Statement = [] } = JSON.parse(Policy ?? "{}") as { Statement?: { Principal?: unknown; Condition?: { ArnLike?: Record<string, string> } }[] };
  const fine = (statement: (typeof Statement)[number]) =>
    JSON.stringify(statement.Principal) === '{"Service":"cloudfront.amazonaws.com"}' && statement.Condition?.ArnLike?.["AWS:SourceArn"]?.endsWith(`:distribution/${distribution}`);
  return distribution !== undefined && Statement.length > 0 && Statement.every(fine) ? undefined : `has ${Policy}`;
});
// Ask your agent's turns reach the conversation Lambda only through CloudFront, as download links do.
const conversationFunction = output(stackOutputs.conversationFunction);
await check("a turn of Ask your agent with a forged token answers 401 through the web app's domain, signed for the conversation Lambda", async () => {
  const body = JSON.stringify({ mailbox: "x", words: "Hello?" });
  const hash = createHash("sha256").update(body).digest("hex");
  return expectStatus(await fetch(`${webUrl}/${conversationPath}turns`, { method: "POST", headers: { [tokenHeader]: "forged", "content-type": "application/json", "x-amz-content-sha256": hash }, body }), 401);
});
await check("the conversation Lambda's function URL takes only signed requests, and refuses one without", async () => {
  const { AuthType, FunctionUrl } = await lambda.send(new GetFunctionUrlConfigCommand({ FunctionName: conversationFunction }));
  if (AuthType !== "AWS_IAM") return `has AuthType ${AuthType}`;
  return expectStatus(await fetch(`${FunctionUrl}${conversationPath}turns`, { method: "POST", body: "{}" }), 403);
});
await check("the conversation Lambda's policy lets only the web app's distribution invoke it, and nobody publicly", async () => {
  const { Policy } = await lambda.send(new GetPolicyCommand({ FunctionName: conversationFunction }));
  const { Statement = [] } = JSON.parse(Policy ?? "{}") as { Statement?: { Principal?: unknown; Condition?: { ArnLike?: Record<string, string> } }[] };
  const fine = (statement: (typeof Statement)[number]) =>
    JSON.stringify(statement.Principal) === '{"Service":"cloudfront.amazonaws.com"}' && statement.Condition?.ArnLike?.["AWS:SourceArn"]?.includes(":distribution/") === true;
  return Statement.length > 0 && Statement.every(fine) ? undefined : `has ${Policy}`;
});
const agentRuntime = output(stackOutputs.agentRuntime);
await check("the mailbox agents' AgentCore Runtime is ready, on Node.js 22, taking only IAM calls", async () => {
  if (agentRuntime === "") return `AgentCore Runtime isn't in ${region}, so mailbox agents aren't here`;
  const runtime = await new BedrockAgentCoreControlClient({ region }).send(new GetAgentRuntimeCommand({ agentRuntimeId: agentRuntime.split("/").at(-1)! }));
  if (runtime.status !== "READY") return `is ${runtime.status}${runtime.failureReason ? `: ${runtime.failureReason}` : ""}`;
  if (runtime.authorizerConfiguration !== undefined) return `takes ${JSON.stringify(runtime.authorizerConfiguration)}`;
  const runs = runtime.agentRuntimeArtifact?.codeConfiguration?.runtime;
  return runs === "NODE_22" ? undefined : `runs ${runs}`;
});
await check("the mailbox agents' unsubscribe browser is ready, on the public network, recording nothing (ADR-0031)", async () => {
  if (agentRuntime === "") return `AgentCore isn't in ${region}, so mailbox agents unsubscribe without a browser here`;
  const control = new BedrockAgentCoreControlClient({ region });
  const runtime = await control.send(new GetAgentRuntimeCommand({ agentRuntimeId: agentRuntime.split("/").at(-1)! }));
  const browserId = runtime.environmentVariables?.[environmentVariables.unsubscribeBrowser];
  if (browserId === undefined) return "the runtime names no browser";
  const browser = await control.send(new GetBrowserCommand({ browserId }));
  if (browser.status !== "READY") return `is ${browser.status}${browser.failureReason ? `: ${browser.failureReason}` : ""}`;
  if (browser.networkConfiguration?.networkMode !== "PUBLIC") return `is on ${browser.networkConfiguration?.networkMode}`;
  return browser.recording?.enabled === true ? "records its sessions" : undefined;
});
await check("every human with a mailbox has one mailbox agent, those of each mailbox from before merged into it (ADR-0033)", async () => {
  const table = await stackTable();
  if (table === undefined) return "the stack has no table";
  const { without, unmerged } = await mailboxAgentsLeft(table);
  const left = [
    ...(without.length === 0 ? [] : [`${without.map(({ email }) => email).join(", ")} ${without.length === 1 ? "has" : "have"} none`]),
    ...(unmerged.length === 0 ? [] : [`${unmerged.map(({ addresses, id }) => addresses[0] ?? id).join(", ")} still ${unmerged.length === 1 ? "has its" : "have their"} own`]),
  ];
  return left.length === 0 ? undefined : `${left.join(", and ")}. Run duva deploy again.`;
});
await check("no agent owns a mailbox, since setup erased those they owned (ADR-0030)", async () => {
  const table = await stackTable();
  if (table === undefined) return "the stack has no table";
  const owned = await agentsMailboxes(table);
  return owned.length === 0 ? undefined : `${owned.map(({ mailbox, agent }) => `${agent.name}'s ${mailbox.addresses[0] ?? mailbox.id}`).join(", ")} ${owned.length === 1 ? "is" : "are"} left. Run duva deploy again.`;
});
await check("Claude answers through the eu profile from eu-central-1, where the mailbox agents call it by default (docs/aws.md)", async () => {
  const { output: answer } = await new BedrockRuntimeClient({ region: "eu-central-1" }).send(
    new ConverseCommand({ modelId: inferenceProfileId(defaultMailboxAgentModel, "eu"), messages: [{ role: "user", content: [{ text: "Answer with the word yes." }] }], inferenceConfig: { maxTokens: 5 } }),
  );
  const text = answer?.message?.content?.[0]?.text ?? "";
  return /yes/i.test(text) ? undefined : `answered ${JSON.stringify(text)}`;
});
await check("reading a mailbox's mailbox agent without credentials answers 401", async () => expectStatus(await fetch(`${apiUrl}/mailboxes/x/agent`), 401));
await check("clearing a conversation without credentials answers 401", async () => expectStatus(await fetch(`${apiUrl}/mailboxes/x/agent/conversation`, { method: "DELETE" }), 401));
await check("reading the mailbox agents' spend without credentials answers 401", async () => expectStatus(await fetch(`${apiUrl}/organization/mailbox-agent-spend`), 401));
// Duva's MCP endpoint, on the API's domain (ADR-0028).
const mcpCall = (headers: Record<string, string> = {}) =>
  fetch(`${apiUrl}${mcpPath}`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers }, body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' });
await check("the MCP endpoint answers a call without a session with 401, naming where MCP clients find how to sign in", async () => {
  const response = await mcpCall();
  const named = response.headers.get("www-authenticate");
  return response.status === 401 && named === `Bearer resource_metadata="${apiUrl}${protectedResourcePaths[1]}"` ? undefined : `answered ${response.status} with ${named}`;
});
await check("the MCP endpoint refuses a forged token with 401, as an invalid token", async () => {
  const response = await mcpCall({ authorization: "Bearer eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ4In0.forged" });
  return response.status === 401 && /error="invalid_token"/.test(response.headers.get("www-authenticate") ?? "") ? undefined : `answered ${response.status}`;
});
await check("the MCP endpoint's protected resource names Duva's API as its authorization server, which registers clients and signs them in with PKCE", async () => {
  const resource = (await (await fetch(`${apiUrl}${protectedResourcePaths[1]}`)).json()) as { resource?: string; authorization_servers?: string[] };
  if (resource.resource !== `${apiUrl}${mcpPath}` || resource.authorization_servers?.[0] !== apiUrl) return `has ${JSON.stringify(resource)}`;
  const server = (await (await fetch(`${apiUrl}${authorizationServerPath}`)).json()) as Record<string, unknown>;
  const fine =
    server.issuer === apiUrl &&
    server.authorization_endpoint === `${apiUrl}${mcpAuthorizePath}` &&
    server.token_endpoint === `${apiUrl}${mcpTokenPath}` &&
    server.registration_endpoint === `${apiUrl}${mcpRegistrationPath}` &&
    JSON.stringify(server.code_challenge_methods_supported) === '["S256"]';
  return fine ? undefined : `has ${JSON.stringify(server)}`;
});
await check("the MCP endpoint refuses a registration with a redirect URI Cognito wouldn't take", async () => {
  const response = await fetch(`${apiUrl}${mcpRegistrationPath}`, { method: "POST", headers: { "content-type": "application/json" }, body: '{"redirect_uris":["http://example.org/callback"],"token_endpoint_auth_method":"none"}' });
  const { error } = (await response.json()) as { error?: string };
  return response.status === 400 && error === "invalid_redirect_uri" ? undefined : `answered ${response.status} ${error}`;
});
// Each run registers a client, which is only an item in the table, gone 60 days on.
await check("a registered MCP client's sign-in reaches managed login for the MCP app client once the human allows it, back to the MCP endpoint, and an unknown client's reaches nothing", async () => {
  // The app client the MCP Lambda signs MCP clients in through.
  const { Environment } = await lambda.send(new GetFunctionConfigurationCommand({ FunctionName: output(stackOutputs.mcpFunction) }));
  const appClient = Environment?.Variables?.[environmentVariables.mcpClientId];
  if (appClient === undefined) return "the MCP Lambda names no app client";
  return managedLoginReached(apiUrl, output(stackOutputs.signInUrl), appClient);
});
await check("the MCP Lambda's policy lets only API Gateway invoke it, for Duva's API, and nobody publicly", async () => {
  const { Policy } = await lambda.send(new GetPolicyCommand({ FunctionName: output(stackOutputs.mcpFunction) }));
  const { Statement = [] } = JSON.parse(Policy ?? "{}") as { Statement?: { Principal?: unknown; Condition?: { ArnLike?: Record<string, string> } }[] };
  const apiId = new URL(apiUrl).hostname.split(".")[0];
  const fine = (statement: (typeof Statement)[number]) =>
    JSON.stringify(statement.Principal) === '{"Service":"apigateway.amazonaws.com"}' && statement.Condition?.ArnLike?.["AWS:SourceArn"]?.includes(`:${apiId}/`) === true;
  return Statement.length > 0 && Statement.every(fine) ? undefined : `has ${Policy}`;
});

const unsubscriberFunction = output(stackOutputs.unsubscriberFunction);
const missing = (request: Promise<unknown>) =>
  request.then(
    () => "exists",
    (error: unknown) => {
      if (error instanceof ResourceNotFoundException) return undefined;
      throw error;
    },
  );
await check("the unsubscriber has no resource policy, so only IAM invokes it", () => missing(lambda.send(new GetPolicyCommand({ FunctionName: unsubscriberFunction }))));
await check("the unsubscriber has no function URL", () => missing(lambda.send(new GetFunctionUrlConfigCommand({ FunctionName: unsubscriberFunction }))));
for (const url of ["https://169.254.169.254/latest/meta-data/", "https://localhost/", "https://[::1]/"]) {
  await check(`the unsubscriber refuses to POST to ${url}, which isn't public`, async () => {
    const { FunctionError, Payload } = await lambda.send(new InvokeCommand({ FunctionName: unsubscriberFunction, Payload: JSON.stringify({ url }) }));
    const answer = new TextDecoder().decode(Payload);
    return FunctionError === undefined && answer === JSON.stringify({ outcome: "failed", reason: "notPublic" }) ? undefined : `answered ${answer}`;
  });
}
const logoFetcherFunction = output(stackOutputs.logoFetcherFunction);
await check("the logo fetcher has no resource policy, so only IAM invokes it", () => missing(lambda.send(new GetPolicyCommand({ FunctionName: logoFetcherFunction }))));
await check("the logo fetcher has no function URL", () => missing(lambda.send(new GetFunctionUrlConfigCommand({ FunctionName: logoFetcherFunction }))));
for (const url of ["https://169.254.169.254/latest/meta-data/", "https://localhost/logo.svg", "https://[::1]/logo.svg"]) {
  await check(`the logo fetcher fetches nothing from ${url}, which isn't public`, async () => {
    const { FunctionError, Payload } = await lambda.send(new InvokeCommand({ FunctionName: logoFetcherFunction, Payload: JSON.stringify({ url }) }));
    const answer = new TextDecoder().decode(Payload);
    return FunctionError === undefined && answer === "{}" ? undefined : `answered ${answer}`;
  });
}
/** The physical ID of the stack's one resource of the type whose logical ID starts with the prefix. */
async function stackResource(type: string, prefix: string): Promise<string | undefined> {
  for await (const { StackResourceSummaries = [] } of paginateListStackResources({ client: cloudFormation }, { StackName: stackName })) {
    const id = StackResourceSummaries.find(({ ResourceType, LogicalResourceId }) => ResourceType === type && LogicalResourceId?.startsWith(prefix))?.PhysicalResourceId;
    if (id !== undefined) return id;
  }
  return undefined;
}
await check("the sender has no resource policy, so only IAM invokes it, as EventBridge Scheduler does with its role", async () => {
  const sender = await stackResource("AWS::Lambda::Function", "SenderHandler");
  return sender === undefined ? "isn't in the stack" : missing(lambda.send(new GetPolicyCommand({ FunctionName: sender })));
});
await check("the table's stream hands the sender each approved draft and each urgent alert to mail, and nothing else", async () => {
  const sender = await stackResource("AWS::Lambda::Function", "SenderHandler");
  if (sender === undefined) return "the sender isn't in the stack";
  const patterns: string[] = [];
  for await (const { EventSourceMappings = [] } of paginateListEventSourceMappings({ client: lambda }, { FunctionName: sender })) {
    for (const { FilterCriteria } of EventSourceMappings) patterns.push(...(FilterCriteria?.Filters ?? []).map(({ Pattern = "" }) => JSON.stringify(JSON.parse(Pattern))));
  }
  const expected = [senderFilter, alertMailFilter].map((filter) => JSON.stringify(filter));
  return JSON.stringify(patterns.sort()) === JSON.stringify(expected.sort()) ? undefined : `its filters are ${patterns.join(", ")}`;
});
// Label prompts (ADR-0029): the table's stream hands the task giver what may add a label, and only IAM invokes the task runner.
await check("the task runner has no resource policy and no function URL, runs up to 15 minutes, and Lambda retries none of its runs", async () => {
  const runner = await stackResource("AWS::Lambda::Function", "TaskRunnerHandler");
  if (runner === undefined) return "isn't in the stack";
  const policy = await missing(lambda.send(new GetPolicyCommand({ FunctionName: runner })));
  if (policy !== undefined) return policy;
  const url = await missing(lambda.send(new GetFunctionUrlConfigCommand({ FunctionName: runner })));
  if (url !== undefined) return url;
  const { Timeout } = await lambda.send(new GetFunctionConfigurationCommand({ FunctionName: runner }));
  const { MaximumRetryAttempts } = await lambda.send(new GetFunctionEventInvokeConfigCommand({ FunctionName: runner }));
  return Timeout === 900 && MaximumRetryAttempts === 0 ? undefined : `times out at ${Timeout} s and retries ${MaximumRetryAttempts} times`;
});
await check("the table's stream hands the task giver each change that may add a label, and nothing else", async () => {
  const giver = await stackResource("AWS::Lambda::Function", "TaskGiverHandler");
  if (giver === undefined) return "isn't in the stack";
  const mappings: string[] = [];
  for await (const { EventSourceMappings = [] } of paginateListEventSourceMappings({ client: lambda }, { FunctionName: giver })) {
    for (const { State, FilterCriteria } of EventSourceMappings) mappings.push(`${State} ${(FilterCriteria?.Filters ?? []).map(({ Pattern = "" }) => JSON.stringify(JSON.parse(Pattern))).join(", ")}`);
  }
  return JSON.stringify(mappings) === JSON.stringify([`Enabled ${JSON.stringify(taskGiverFilter)}`]) ? undefined : `its mappings are ${mappings.join("; ")}`;
});
await check("no task has worked longer than a run can last", async () => {
  const table = await stackTable();
  if (table === undefined) return "the stack has no table";
  const stuck = await tasksWorkingSince(table, new Date(Date.now() - 20 * 60_000).toISOString());
  return stuck.length === 0 ? undefined : `${stuck.length} ${stuck.length === 1 ? "task has" : "tasks have"} worked since ${stuck.map(({ startedAt }) => startedAt).sort()[0]}, as when the task runner stopped partway`;
});
await check("giving a label a prompt without credentials answers 401", async () =>
  expectStatus(await fetch(`${apiUrl}/mailboxes/x/labels/x/prompt`, { method: "PUT", headers: { "content-type": "application/json" }, body: '{"prompt":"x"}' }), 401),
);
await check("listing alerts without credentials answers 401", async () => expectStatus(await fetch(`${apiUrl}/alerts`), 401));
await check("marking alerts seen without credentials answers 401", async () =>
  expectStatus(await fetch(`${apiUrl}/alerts/seen`, { method: "POST", headers: { "content-type": "application/json" }, body: '{"alerts":["x"]}' }), 401),
);
await check("no schedule for sends that wait for an agent's limits, or for a thread due back from Remind me, is more than an hour overdue", async () => {
  const group = await stackResource("AWS::Scheduler::ScheduleGroup", "SenderSchedules");
  if (group === undefined) return "the schedule group isn't in the stack";
  const overdue: string[] = [];
  for await (const { Schedules = [] } of paginateListSchedules({ client: new SchedulerClient({ region }) }, { GroupName: group.split("/").at(-1) })) {
    // Each is named for the second it runs at, and deleted once it ran.
    for (const { Name = "" } of Schedules) if (Number(/-(\d+)$/.exec(Name)?.[1] ?? 0) * 1000 < Date.now() - 60 * 60 * 1000) overdue.push(Name);
  }
  return overdue.length === 0 ? undefined : `${overdue.join(", ")} should have run`;
});
const searchFunction = output(stackOutputs.searchFunction);
await check("search has no resource policy, so only IAM invokes it", () => missing(lambda.send(new GetPolicyCommand({ FunctionName: searchFunction }))));
await check("search has no function URL", () => missing(lambda.send(new GetFunctionUrlConfigCommand({ FunctionName: searchFunction }))));
await check("search runs at 10,240 MB on x64, as ADR-0007 measured", async () => {
  const { MemorySize, Architectures } = await lambda.send(new GetFunctionConfigurationCommand({ FunctionName: searchFunction }));
  return MemorySize === 10_240 && JSON.stringify(Architectures) === '["x86_64"]' ? undefined : `runs at ${MemorySize} MB on ${Architectures}`;
});
await check("searching without credentials answers 401", async () => expectStatus(await fetch(`${apiUrl}/mailboxes/x/search?q=x`), 401));
await check("Nova Lite translates a search's words in the deployment's region, as search does (#67)", async () => {
  // The translator's client is in AWS_REGION, the deployment's.
  const translated = await novaTranslator().translate("kvitto", "English");
  return translated?.toLowerCase().includes("receipt") ? undefined : `translated "kvitto" into English as ${JSON.stringify(translated)}`;
});
await check("every mailbox's search index is backfilled", async () => {
  const table = await stackTable();
  if (table === undefined) return "the stack has no table";
  const { mailboxes, indexed, stuck } = await indexedMailboxes(table);
  console.log(`      ${indexed} of ${mailboxes} mailboxes' indexes are backfilled`);
  for (const { mailbox, addresses, step, since } of stuck) {
    console.log(`      ${mailbox} (${addresses.join(", ")}) waits for backfill step ${step}${since === undefined ? "" : `, its last step at ${since.toISOString()}`}`);
  }
  if (indexed === mailboxes) return undefined;
  return stuck.length > 0
    ? `${mailboxes - indexed} of ${mailboxes} aren't yet, and ${stuck.length} of those have taken no step for 5 minutes. A change in such a mailbox resumes its backfill, and so does running duva deploy again.`
    : `${mailboxes - indexed} of ${mailboxes} aren't yet. Wait a few minutes, or run duva deploy again to finish them.`;
});
// The eraser runs once a day, so mail erased just after a run waits a day, and the hour is slack.
await check("no search index has held erased mail's text for more than a day", async () => {
  const table = await stackTable();
  if (table === undefined) return "the stack has no table";
  const since = await uncompactedSince(table);
  if (since !== undefined) console.log(`      the longest wait for compaction is since ${since.toISOString()}`);
  return since === undefined || Date.now() - since.getTime() < 25 * 60 * 60 * 1000
    ? undefined
    : `an index has held erased mail since ${since.toISOString()}. Look for the eraser's and the indexer's errors in their logs.`;
});
await check("deleting a draft without credentials answers 401", async () => expectStatus(await fetch(`${apiUrl}/mailboxes/x/drafts/x`, { method: "DELETE" }), 401));
await check("labelling threads without credentials answers 401", async () =>
  expectStatus(await fetch(`${apiUrl}/mailboxes/x/threads/labels`, { method: "POST", headers: { "content-type": "application/json" }, body: '{"threads":["x"],"add":["trash"]}' }), 401),
);
await check("setting threads aside in Remind me without credentials answers 401", async () =>
  expectStatus(await fetch(`${apiUrl}/mailboxes/x/threads/remind`, { method: "POST", headers: { "content-type": "application/json" }, body: '{"threads":["x"],"preset":"nextWeek"}' }), 401),
);
await check("cancelling reminders without credentials answers 401", async () =>
  expectStatus(await fetch(`${apiUrl}/mailboxes/x/threads/remind/cancel`, { method: "POST", headers: { "content-type": "application/json" }, body: '{"threads":["x"]}' }), 401),
);
await check("listing Remind me without credentials answers 401", async () => expectStatus(await fetch(`${apiUrl}/mailboxes/x/reminders`), 401));
await check("listing All mail without credentials answers 401", async () => expectStatus(await fetch(`${apiUrl}/mailboxes/x/all-mail`), 401));
await check("listing All mailboxes' Inbox without credentials answers 401", async () => expectStatus(await fetch(`${apiUrl}/all-mailboxes/threads`), 401));
await check("marking threads in All mailboxes read without credentials answers 401", async () =>
  expectStatus(await fetch(`${apiUrl}/all-mailboxes/threads/read`, { method: "POST", headers: { "content-type": "application/json" }, body: '{"threads":["x"]}' }), 401),
);
// The test human's agent reads All mailboxes as the mailboxes its sponsor access covers, with the key of Real run 45 (docs/agents/test-deployment.md).
const testHumansAgent = process.env.DUVA_TEST_HUMAN_CODES_KEY;
if (testHumansAgent === undefined) console.log("skip  All mailboxes answers for the test human's agent: set DUVA_TEST_HUMAN_CODES_KEY to check them");
else {
  await check("All mailboxes answers for the test human's agent with the mailboxes it reads, their unread counts summed, and their Inboxes merged newest first, each thread naming one of them", async () => {
    const asAgent = async (path: string) => {
      const response = await fetch(`${apiUrl}${path}`, { headers: { authorization: `Bearer ${testHumansAgent}` } });
      if (!response.ok) throw new Error(`${path} answered ${response.status}: ${(await response.text()).slice(0, 200)}`);
      return response.json();
    };
    const { mailboxes } = (await asAgent("/mailboxes")) as { mailboxes: { id: string }[] };
    const all = (await asAgent("/all-mailboxes")) as { mailboxes: { id: string; unread: number }[]; unread: number };
    const unread = await Promise.all(mailboxes.map(async ({ id }) => ((await asAgent(`/mailboxes/${id}`)) as { unread: number }).unread));
    const ids = mailboxes.map(({ id }) => id);
    if (JSON.stringify(all.mailboxes.map(({ id }) => id)) !== JSON.stringify(ids)) return `lists ${all.mailboxes.length} mailboxes where listing them gives ${ids.length}`;
    if (all.unread !== unread.reduce((sum, each) => sum + each, 0)) return `counts ${all.unread} unread where its mailboxes count ${unread.join(" and ")}`;
    const { threads } = (await asAgent("/all-mailboxes/threads?limit=20")) as { threads: { mailbox: string; recipient: string; latestAt: string }[] };
    const strange = threads.find(({ mailbox, recipient }) => !ids.includes(mailbox) || !recipient.includes("@"));
    if (strange !== undefined) return `lists a thread in ${strange.mailbox} to ${JSON.stringify(strange.recipient)}`;
    if (threads.some((thread, index) => index > 0 && thread.latestAt > threads[index - 1]!.latestAt)) return "lists its Inbox out of order";
    const { labels } = (await asAgent("/all-mailboxes/labels")) as { labels: { id: string }[] };
    return JSON.stringify(labels.slice(0, 5).map(({ id }) => id)) === JSON.stringify(["inbox", "feed", "paperTrail", "spam", "trash"]) ? undefined : "lists its labels without the built-in ones first";
  });
}
await check("reading a human's preferences without credentials answers 401", async () => expectStatus(await fetch(`${apiUrl}/preferences`), 401));
await check("changing a human's preferences without credentials answers 401", async () =>
  expectStatus(await fetch(`${apiUrl}/preferences`, { method: "PATCH", headers: { "content-type": "application/json" }, body: '{"hourCycle":"h23"}' }), 401),
);
await check("reading the organization's settings without credentials answers 401", async () => expectStatus(await fetch(`${apiUrl}/organization/settings`), 401));
await check("listing the organization's agents without credentials answers 401", async () => expectStatus(await fetch(`${apiUrl}/organization/agents`), 401));
await check("changing the organization's settings without credentials answers 401", async () =>
  expectStatus(await fetch(`${apiUrl}/organization/settings`, { method: "PATCH", headers: { "content-type": "application/json" }, body: '{"erasureErasesApprovals":true}' }), 401),
);
await check("listing labels without credentials answers 401", async () => expectStatus(await fetch(`${apiUrl}/mailboxes/x/labels`), 401));
await check("creating a label without credentials answers 401", async () =>
  expectStatus(await fetch(`${apiUrl}/mailboxes/x/labels`, { method: "POST", headers: { "content-type": "application/json" }, body: '{"name":"Check"}' }), 401),
);
await check("renaming a label without credentials answers 401", async () =>
  expectStatus(await fetch(`${apiUrl}/mailboxes/x/labels/x`, { method: "PATCH", headers: { "content-type": "application/json" }, body: '{"name":"Check"}' }), 401),
);
await check("deleting a label without credentials answers 401", async () => expectStatus(await fetch(`${apiUrl}/mailboxes/x/labels/x`, { method: "DELETE" }), 401));
await check("reading a mailbox's Screener without credentials answers 401", async () => expectStatus(await fetch(`${apiUrl}/mailboxes/x/screener`), 401));
await check("switching a mailbox's Screener without credentials answers 401", async () =>
  expectStatus(await fetch(`${apiUrl}/mailboxes/x/screener`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ on: false }) }), 401),
);
await check("reading a sender's sheet without credentials answers 401", async () => expectStatus(await fetch(`${apiUrl}/mailboxes/x/senders/a%40example.org`), 401));
await check("deciding where a sender's mail goes without credentials answers 401", async () =>
  expectStatus(await fetch(`${apiUrl}/mailboxes/x/senders/a%40example.org`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ delivery: "feed" }) }), 401),
);
await check("listing a mailbox's senders without credentials answers 401", async () => expectStatus(await fetch(`${apiUrl}/mailboxes/x/senders`), 401));
await check("removing a decision on a sender without credentials answers 401", async () =>
  expectStatus(await fetch(`${apiUrl}/mailboxes/x/senders/a%40example.org`, { method: "DELETE" }), 401),
);
await check("the inbound Lambda is given the unsubscriber, for each message it drops since its sender's mail goes nowhere", async () => {
  const inbound = await stackResource("AWS::Lambda::Function", "InboundHandler");
  if (inbound === undefined) return "has no inbound Lambda";
  const { Environment } = await lambda.send(new GetFunctionConfigurationCommand({ FunctionName: inbound }));
  const given = Environment?.Variables?.[environmentVariables.unsubscriberFunction];
  return given?.endsWith(`:function:${unsubscriberFunction}`) ? undefined : `has ${given ?? "none"}`;
});
await check("the inbound Lambda is given the task runner, which goes on unsubscribing where one-click didn't (ADR-0031)", async () => {
  const [inbound, runner] = await Promise.all([stackResource("AWS::Lambda::Function", "InboundHandler"), stackResource("AWS::Lambda::Function", "TaskRunnerHandler")]);
  if (inbound === undefined || runner === undefined) return "has no inbound Lambda or task runner";
  const { Environment } = await lambda.send(new GetFunctionConfigurationCommand({ FunctionName: inbound }));
  const given = Environment?.Variables?.[environmentVariables.taskRunnerFunction];
  return given?.endsWith(`:function:${runner}`) ? undefined : `has ${given ?? "none"}`;
});
await check("emptying Trash without credentials answers 401", async () => expectStatus(await fetch(`${apiUrl}/mailboxes/x/trash/empty`, { method: "POST" }), 401));
await check("sending an approval without credentials answers 401", async () =>
  expectStatus(await fetch(`${apiUrl}/approvals/x/send`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }), 401),
);
for (const [what, path, method] of [
  ["adding a domain", "/domains", "POST"],
  ["listing domains", "/domains", "GET"],
  ["reading a domain", "/domains/example.net", "GET"],
  ["choosing the sign-in domain", "/domains/example.net", "PATCH"],
  ["removing a domain", "/domains/example.net/remove", "POST"],
] as const) {
  await check(`${what} without credentials answers 401`, async () =>
    expectStatus(await fetch(`${apiUrl}${path}`, { method, ...(method !== "GET" && { headers: { "content-type": "application/json" }, body: "{}" }) }), 401),
  );
}
const cognito = new CognitoIdentityProviderClient({ region });
await check("the user pool sends sign-in codes from no-reply@ a domain SES has verified, or from Cognito until the first is, and still offers emailed codes", async () => {
  const { UserPool } = await cognito.send(new DescribeUserPoolCommand({ UserPoolId: output(stackOutputs.userPoolId) }));
  const parameter = (key: string) => stack?.Parameters?.find(({ ParameterKey }) => ParameterKey === key)?.ParameterValue;
  const { EmailSendingAccount, SourceArn, From } = UserPool?.EmailConfiguration ?? {};
  const factors = UserPool?.Policies?.SignInPolicy?.AllowedFirstAuthFactors ?? [];
  if (!factors.includes("EMAIL_OTP")) return `offers only ${factors.join(", ")}`;
  if (EmailSendingAccount !== "DEVELOPER") return parameter(stackParameters.domainVerified) === "false" ? undefined : `sends with ${EmailSendingAccount}`;
  const domain = SourceArn?.split(":identity/")[1] ?? "";
  // An admin may have chosen another domain since the last deploy, so the stack's is only what deploy last saw.
  if (domain !== parameter(stackParameters.signInDomain)) console.log(`      the stack has ${parameter(stackParameters.signInDomain)}, and an admin has chosen ${domain} since`);
  const identity = await new SESv2Client({ region }).send(new GetEmailIdentityCommand({ EmailIdentity: domain }));
  if (identity.VerifiedForSendingStatus !== true) return `${domain} isn't verified in SES`;
  return From === signInFrom(domain) ? undefined : `sends from ${From}`;
});
await check("the user pool takes sign-in names in any case", async () => {
  const { UserPool } = await cognito.send(new DescribeUserPoolCommand({ UserPoolId: output(stackOutputs.userPoolId) }));
  return UserPool?.UsernameConfiguration?.CaseSensitive === false ? undefined : `has ${JSON.stringify(UserPool?.UsernameConfiguration)}`;
});
await check("no user pool the stack retired is left", async () => {
  const retired: string[] = [];
  for await (const page of paginateListUserPools({ client: cognito }, { MaxResults: 60 })) {
    for (const { Id } of page.UserPools ?? []) {
      const { UserPool } = await cognito.send(new DescribeUserPoolCommand({ UserPoolId: Id }));
      if (UserPool?.UserPoolTags?.["aws:cloudformation:stack-id"] === stack?.StackId && Id !== output(stackOutputs.userPoolId)) retired.push(Id!);
    }
  }
  return retired.length === 0 ? undefined : `left: ${retired.join(", ")}. Run duva deploy again.`;
});
await check("the receipt rule set holds only Duva's rules, each with 1 to 500 recipients, addresses or whole domains with a catch-all, none listed twice, scanning, then S3 and the inbound Lambda", async () => {
  const { Rules = [] } = await new SESClient({ region }).send(new DescribeReceiptRuleSetCommand({ RuleSetName: output(stackOutputs.receiptRuleSet) }));
  // Until an admin creates the first address there is no rule, and SES refuses all mail.
  const recipients = Rules.flatMap((rule) => rule.Recipients ?? []);
  const fine = (rule: (typeof Rules)[number]) => {
    const [s3, invoke, ...more] = rule.Actions ?? [];
    return (
      receiptRuleNumber(rule.Name) !== undefined &&
      rule.Enabled === true &&
      rule.ScanEnabled === true &&
      (rule.Recipients?.length ?? 0) > 0 &&
      (rule.Recipients?.length ?? 0) <= recipientsPerRule &&
      // A domain is listed only while it has a catch-all, and never with a leading dot, which would take its subdomains' mail.
      rule.Recipients!.every((recipient) => recipient.includes("@") || /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(recipient)) &&
      s3?.S3Action?.ObjectKeyPrefix === inboundPrefix &&
      invoke?.LambdaAction?.InvocationType === "Event" &&
      more.length === 0
    );
  };
  return Rules.every(fine) && new Set(recipients).size === recipients.length ? undefined : `is ${JSON.stringify(Rules)}`;
});
{
  // SES suppresses an address that hard-bounced, which one of the organization's can while SES
  // receiving picks it up, until the feedback Lambda takes it off again. One left there gets no mail
  // Duva sends, so this warns, without failing the check.
  const { Rules = [] } = await new SESClient({ region }).send(new DescribeReceiptRuleSetCommand({ RuleSetName: output(stackOutputs.receiptRuleSet) }));
  const listed = new Set(Rules.flatMap((rule) => rule.Recipients ?? []).map((recipient) => recipient.toLowerCase()));
  const suppressed = (await sesSuppressionList(new SESv2Client({ region })).list()).filter((address) => rulesTake(listed, address));
  console.log(
    suppressed.length === 0
      ? "ok    none of the organization's addresses is on SES's suppression list"
      : `WARN  the organization's addresses on SES's suppression list get no mail Duva sends: ${suppressed.join(", ")}. Remove each with aws sesv2 delete-suppressed-destination --email-address <address>.`,
  );
}
const waitingIn = async (queue: string) => {
  const { Attributes } = await new SQSClient({ region }).send(new GetQueueAttributesCommand({ QueueUrl: output(queue), AttributeNames: ["ApproximateNumberOfMessages"] }));
  return Number(Attributes?.ApproximateNumberOfMessages ?? 0);
};
await check("no received mail waits in the failure queue", async () => {
  const waiting = await waitingIn(stackOutputs.inboundFailures);
  return waiting === 0 ? undefined : `${waiting} events wait there. Fix what failed, then replay them.`;
});
await check("no approved send waits in the failure queue", async () => {
  const waiting = await waitingIn(stackOutputs.sendFailures);
  return waiting === 0 ? undefined : `${waiting} stream records failed. Fix what failed, then read them from the stream again within 24 hours of the decision.`;
});
await check("the configuration set publishes only bounces, complaints and rejects, to a topic, and only SNS may invoke the feedback Lambda, for that topic", async () => {
  let configurationSet: string | undefined;
  for await (const { StackResourceSummaries = [] } of paginateListStackResources({ client: cloudFormation }, { StackName: stackName })) {
    configurationSet ??= StackResourceSummaries.find(({ ResourceType }) => ResourceType === "AWS::SES::ConfigurationSet")?.PhysicalResourceId;
  }
  const { EventDestinations = [] } = await new SESv2Client({ region }).send(new GetConfigurationSetEventDestinationsCommand({ ConfigurationSetName: configurationSet }));
  const [destination, ...others] = EventDestinations;
  const types = [...(destination?.MatchingEventTypes ?? [])].sort().join(",");
  const topic = destination?.SnsDestination?.TopicArn;
  if (others.length > 0 || !destination?.Enabled || types !== "BOUNCE,COMPLAINT,REJECT" || topic === undefined) return `has ${JSON.stringify(EventDestinations)}`;
  const { Policy } = await lambda.send(new GetPolicyCommand({ FunctionName: output(stackOutputs.feedbackFunction) }));
  const { Statement = [] } = JSON.parse(Policy ?? "{}") as { Statement?: { Principal?: unknown; Condition?: { ArnLike?: Record<string, string> } }[] };
  const fine = (statement: (typeof Statement)[number]) => JSON.stringify(statement.Principal) === '{"Service":"sns.amazonaws.com"}' && statement.Condition?.ArnLike?.["AWS:SourceArn"] === topic;
  return Statement.length > 0 && Statement.every(fine) ? undefined : `the feedback Lambda has ${Policy}`;
});
await check("no event of SES's waits in the feedback Lambda's failure queue", async () => {
  const waiting = await waitingIn(stackOutputs.feedbackFailures);
  return waiting === 0 ? undefined : `${waiting} events wait there. Fix what failed, then replay them.`;
});
await check("no indexer task waits in the failure queue", async () => {
  const waiting = await waitingIn(stackOutputs.indexFailures);
  return waiting === 0 ? undefined : `${waiting} tasks failed. Fix what failed; each mailbox's next change catches its index up.`;
});
await check("the web app is served", async () => {
  const response = await fetch(`${webUrl}/`);
  return response.ok && response.headers.get("content-type")?.startsWith("text/html") ? undefined : `answered ${response.status}`;
});
await check("the web app's icon is served", async () => {
  const response = await fetch(`${webUrl}/favicon.ico`);
  return response.ok && response.headers.get("content-type") === "image/x-icon" ? undefined : `answered ${response.status} with ${response.headers.get("content-type")}`;
});
await check("the web app's config names this deployment's API and sign-in", async () => {
  const config = (await (await fetch(`${webUrl}/config.json`)).json()) as {
    apiUrl?: string;
    signIn?: { url?: string; clientId?: string; redirectUri?: string };
  };
  const wanted = { apiUrl, signIn: { url: output(stackOutputs.signInUrl), clientId: output(stackOutputs.webClientId), redirectUri: `${webUrl}/` } };
  return JSON.stringify(config) === JSON.stringify(wanted) ? undefined : `is ${JSON.stringify(config)}`;
});
await check("the API lets the web app call it with a session", async () => {
  const response = await fetch(`${apiUrl}/whoami`, {
    method: "OPTIONS",
    headers: { origin: webUrl, "access-control-request-method": "GET", "access-control-request-headers": "authorization" },
  });
  const origin = response.headers.get("access-control-allow-origin");
  const headers = response.headers.get("access-control-allow-headers") ?? "";
  return origin === webUrl && headers.includes("authorization") ? undefined : `allows origin ${origin} and headers ${headers}`;
});
// The CloudWatch console shows the same metric for any period.
const days = 7;
const day = 86_400_000;
const dayOf = (time: Date) => time.toISOString().slice(0, 10);
const reasonNames: Record<(typeof dropReasons)[number], string> = { virus: "virus", dmarcReject: "DMARC reject" };
const drops = new Map<string, Record<string, number>>();
await check(`CloudWatch counts the drops on arrival of the last ${days} days`, async () => {
  const today = new Date(dayOf(new Date()));
  const start = new Date(today.getTime() - (days - 1) * day);
  for (let index = 0; index < days; index++) drops.set(dayOf(new Date(start.getTime() + index * day)), {});
  const { MetricDataResults = [] } = await new CloudWatchClient({ region }).send(
    new GetMetricDataCommand({
      StartTime: start,
      EndTime: new Date(today.getTime() + day),
      MetricDataQueries: dropReasons.map((reason) => ({
        Id: reason.toLowerCase(),
        Label: reason,
        MetricStat: {
          Metric: { Namespace: dropMetric.namespace, MetricName: dropMetric.name, Dimensions: [{ Name: dropMetric.dimension, Value: reason }] },
          Period: day / 1000,
          Stat: "Sum",
        },
      })),
    }),
  );
  for (const { Label, Timestamps = [], Values = [] } of MetricDataResults) {
    Timestamps.forEach((timestamp, index) => {
      const counts = drops.get(dayOf(timestamp));
      if (counts !== undefined) counts[Label!] = Values[index] ?? 0;
    });
  }
  return undefined;
});
console.log(`\nMessages dropped on arrival, by day (UTC) and reason:`);
for (const [date, counts] of drops) {
  console.log(`  ${date}  ${dropReasons.map((reason) => `${reasonNames[reason]} ${counts[reason] ?? 0}`).join(", ")}`);
}

process.exitCode = failed ? 1 : 0;
