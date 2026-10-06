// Checks a Duva deployment from the outside, in one region of the configured AWS account:
//
//   AWS_REGION=eu-north-1 node scripts/check-deployment.ts
//
// Runs the checks of a real run that need no human: the API answers, refuses calls without valid
// credentials, and lets the web app call it; download links go through the web app's domain, and
// only its distribution may invoke the download Lambda; nothing but IAM may invoke the
// unsubscriber, which refuses addresses that aren't public; the web app is served with the config
// deploy published; the user pool takes sign-in names in any case, and no pool the stack retired
// is left; once an address exists, SES's receipt rule lists it; and no received mail and no
// approved send waits in a failure queue. Signing in stays with a human. Then prints how many
// messages Duva dropped on arrival each day of the last 7, by reason. Exits 1 if any check fails.
import { CloudFormationClient, DescribeStacksCommand, paginateListStackResources } from "@aws-sdk/client-cloudformation";
import { CloudWatchClient, GetMetricDataCommand } from "@aws-sdk/client-cloudwatch";
import { CognitoIdentityProviderClient, DescribeUserPoolCommand, paginateListUserPools } from "@aws-sdk/client-cognito-identity-provider";
import { GetFunctionUrlConfigCommand, GetPolicyCommand, InvokeCommand, LambdaClient, ResourceNotFoundException } from "@aws-sdk/client-lambda";
import { DescribeReceiptRuleSetCommand, SESClient } from "@aws-sdk/client-ses";
import { GetQueueAttributesCommand, SQSClient } from "@aws-sdk/client-sqs";
import { dropMetric, dropReasons, inboundPrefix, receiptRuleName } from "@duva/api/infrastructure";
import { stackName, stackOutputs } from "@duva/infra/outputs";

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
await check("changing an agent's settings without credentials answers 401", async () =>
  expectStatus(await fetch(`${apiUrl}/agents/x/settings`, { method: "PATCH", headers: { "content-type": "application/json" }, body: '{"sponsorAccess":"read"}' }), 401),
);
await check("adding a human without credentials answers 401", async () =>
  expectStatus(await fetch(`${apiUrl}/humans`, { method: "POST", headers: { "content-type": "application/json" }, body: '{"email":"check@example.com"}' }), 401),
);
await check("listing humans without credentials answers 401", async () => expectStatus(await fetch(`${apiUrl}/humans`), 401));
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
await check("a download link Duva never gave answers 404 through the web app's domain, without credentials", async () => {
  const response = await fetch(`${output(stackOutputs.downloadUrl)}${"A".repeat(43)}`);
  const text = await response.text();
  return response.status === 404 && /expired/.test(text) ? undefined : `answered ${response.status}: ${text.slice(0, 200)}`;
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
await check("deleting a draft without credentials answers 401", async () => expectStatus(await fetch(`${apiUrl}/mailboxes/x/drafts/x`, { method: "DELETE" }), 401));
await check("labelling threads without credentials answers 401", async () =>
  expectStatus(await fetch(`${apiUrl}/mailboxes/x/threads/labels`, { method: "POST", headers: { "content-type": "application/json" }, body: '{"threads":["x"],"add":["trash"]}' }), 401),
);
await check("listing All mail without credentials answers 401", async () => expectStatus(await fetch(`${apiUrl}/mailboxes/x/all-mail`), 401));
await check("reading a human's preferences without credentials answers 401", async () => expectStatus(await fetch(`${apiUrl}/preferences`), 401));
await check("changing a human's preferences without credentials answers 401", async () =>
  expectStatus(await fetch(`${apiUrl}/preferences`, { method: "PATCH", headers: { "content-type": "application/json" }, body: '{"hourCycle":"h23"}' }), 401),
);
await check("reading the organization's settings without credentials answers 401", async () => expectStatus(await fetch(`${apiUrl}/organization/settings`), 401));
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
for (const decision of ["let-in", "block"]) {
  await check(`screening a sender (${decision}) without credentials answers 401`, async () =>
    expectStatus(await fetch(`${apiUrl}/mailboxes/x/screener/${decision}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: "a@example.org" }) }), 401),
  );
}
await check("listing a mailbox's screened senders without credentials answers 401", async () => expectStatus(await fetch(`${apiUrl}/mailboxes/x/screener/senders`), 401));
await check("removing a screened sender without credentials answers 401", async () =>
  expectStatus(await fetch(`${apiUrl}/mailboxes/x/screener/senders/a%40example.org`, { method: "DELETE" }), 401),
);
await check("emptying Trash without credentials answers 401", async () => expectStatus(await fetch(`${apiUrl}/mailboxes/x/trash/empty`, { method: "POST" }), 401));
await check("sending an approval without credentials answers 401", async () =>
  expectStatus(await fetch(`${apiUrl}/approvals/x/send`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }), 401),
);
const cognito = new CognitoIdentityProviderClient({ region });
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
await check("the receipt rule set holds only Duva's rule, with explicit recipients, scanning, then S3 and the inbound Lambda", async () => {
  const { Rules = [] } = await new SESClient({ region }).send(new DescribeReceiptRuleSetCommand({ RuleSetName: output(stackOutputs.receiptRuleSet) }));
  // Until an admin creates the first address there is no rule, and SES refuses all mail.
  if (Rules.length === 0) return undefined;
  const [rule, ...others] = Rules;
  const [s3, invoke, ...more] = rule?.Actions ?? [];
  const fine =
    others.length === 0 &&
    rule?.Name === receiptRuleName &&
    rule.Enabled === true &&
    rule.ScanEnabled === true &&
    (rule.Recipients?.length ?? 0) > 0 &&
    rule.Recipients!.every((recipient) => recipient.includes("@")) &&
    s3?.S3Action?.ObjectKeyPrefix === inboundPrefix &&
    invoke?.LambdaAction?.InvocationType === "Event" &&
    more.length === 0;
  return fine ? undefined : `is ${JSON.stringify(Rules)}`;
});
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
