// Checks a Duva deployment from the outside, in one region of the configured AWS account:
//
//   AWS_REGION=eu-north-1 node scripts/check-deployment.ts
//
// Runs the checks of a real run that need no human: the API answers, refuses calls without valid
// credentials, and lets the web app call it; the web app is served with the config deploy
// published. Signing in stays with a human. Exits 1 if any check fails.
import { CloudFormationClient, DescribeStacksCommand } from "@aws-sdk/client-cloudformation";
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
