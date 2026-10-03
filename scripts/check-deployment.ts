// Checks a Duva deployment from the outside, in one region of the configured AWS account:
//
//   AWS_REGION=eu-north-1 node scripts/check-deployment.ts
//
// Runs the checks of a real run that need no human: the API answers, refuses calls without valid
// credentials, and lets the web app call it; the web app is served with the config deploy
// published; once an address exists, SES's receipt rule lists it; and no received mail and no
// approved send waits in a failure queue. Signing in stays with a human. Exits 1 if any check fails.
import { CloudFormationClient, DescribeStacksCommand } from "@aws-sdk/client-cloudformation";
import { DescribeReceiptRuleSetCommand, SESClient } from "@aws-sdk/client-ses";
import { GetQueueAttributesCommand, SQSClient } from "@aws-sdk/client-sqs";
import { inboundPrefix, receiptRuleName } from "@duva/api/infrastructure";
import { stackName, stackOutputs } from "@duva/infra/outputs";

const region = process.env.AWS_REGION;
if (!region) throw new Error("Set AWS_REGION to the region of the deployment to check.");

const [stack] =
  (
    await new CloudFormationClient({ region })
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
await check("listing mailboxes without credentials answers 401", async () => expectStatus(await fetch(`${apiUrl}/mailboxes`), 401));
await check("listing approvals without credentials answers 401", async () => expectStatus(await fetch(`${apiUrl}/approvals`), 401));
await check("rejecting an approval without credentials answers 401", async () =>
  expectStatus(await fetch(`${apiUrl}/approvals/x/reject`, { method: "POST", headers: { "content-type": "application/json" }, body: '{"note":"Check"}' }), 401),
);
await check("sending an approval without credentials answers 401", async () =>
  expectStatus(await fetch(`${apiUrl}/approvals/x/send`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }), 401),
);
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

process.exitCode = failed ? 1 : 0;
