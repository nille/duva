// The custom resource that gives the stack its AgentCore Gateway to Web Search (ADR-0037), in the
// deployment's search region: CloudFormation creates resources only in the stack's own region, and
// Web Search runs only in three (docs/aws.md). CloudFormation invokes it with its own credentials,
// as it does any custom resource's function. It creates the gateway, which takes only SigV4 calls,
// with the Web Search target, and deletes both with the stack. A create or update finds a gateway
// of its name already there, as a retried create leaves one, and makes sure it has the stack's role,
// the target and the stack's tags, as CloudFormation tags what it makes (#176). It gives up in time
// to tell CloudFormation, which otherwise waits an hour.
import {
  BedrockAgentCoreControlClient,
  CreateGatewayCommand,
  CreateGatewayTargetCommand,
  DeleteGatewayCommand,
  DeleteGatewayTargetCommand,
  GetGatewayCommand,
  GetGatewayTargetCommand,
  ListGatewayTargetsCommand,
  paginateListGateways,
  ResourceNotFoundException,
  TagResourceCommand,
  UpdateGatewayCommand,
} from "@aws-sdk/client-bedrock-agentcore-control";
import { webSearchRegion } from "./web-search.ts";

interface Event {
  RequestType: "Create" | "Update" | "Delete";
  ResponseURL: string;
  StackId: string;
  RequestId: string;
  LogicalResourceId: string;
  PhysicalResourceId?: string;
  /**
   * The gateway's name, unique to the stack and its region, the role it searches with, and its tags,
   * which a rollback to a stack from before #176 gives none.
   */
  ResourceProperties: { Name: string; Role: string; Tags?: Record<string, string> };
}

/** The target's name, which names its tool, web-search___WebSearch (agentcore-web-search.ts). */
const targetName = "web-search";

const region = webSearchRegion(process.env.AWS_REGION!);
const control = new BedrockAgentCoreControlClient({ region });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** When the invocation gives up waiting, a minute short of its 5-minute timeout. */
let deadline = 0;

/** Waits while the status is one of those still on the way, until the deadline, and fails on any but READY. */
async function ready(status: () => Promise<{ status?: string; statusReasons?: string[] }>) {
  for (;;) {
    const { status: now, statusReasons } = await status();
    if (now === "READY") return;
    if (now !== "CREATING" && now !== "UPDATING") throw new Error(`It is ${now}: ${statusReasons?.join(" ")}`);
    if (Date.now() > deadline) throw new Error(`It is still ${now}.`);
    await sleep(3000);
  }
}

/** The gateway with the name, with the Web Search target, created if there isn't one. */
async function gateway({ Name, Role, Tags }: Event["ResourceProperties"]) {
  let found: string | undefined;
  for await (const page of paginateListGateways({ client: control }, {})) found ??= page.items?.find(({ name }) => name === Name)?.gatewayId;
  const settings = { name: Name, roleArn: Role, protocolType: "MCP", authorizerType: "AWS_IAM", description: "Duva's mailbox agents search the web through it" } as const;
  const gatewayIdentifier = found ?? (await control.send(new CreateGatewayCommand({ ...settings, tags: Tags }))).gatewayId!;
  await ready(() => control.send(new GetGatewayCommand({ gatewayIdentifier })));
  // A role the stack replaced is the gateway's from then on.
  if (found !== undefined && (await control.send(new GetGatewayCommand({ gatewayIdentifier }))).roleArn !== Role) {
    await control.send(new UpdateGatewayCommand({ gatewayIdentifier, ...settings }));
    await ready(() => control.send(new GetGatewayCommand({ gatewayIdentifier })));
  }
  const targets = await control.send(new ListGatewayTargetsCommand({ gatewayIdentifier }));
  const targetId =
    targets.items?.find(({ name }) => name === targetName)?.targetId ??
    (
      await control.send(
        new CreateGatewayTargetCommand({
          gatewayIdentifier,
          name: targetName,
          targetConfiguration: { mcp: { connector: { source: { connectorId: "web-search", version: "1.2.0" }, configurations: [{ name: "WebSearch", parameterValues: {} }] } } },
          credentialProviderConfigurations: [{ credentialProviderType: "GATEWAY_IAM_ROLE" }],
        }),
      )
    ).targetId!;
  await ready(() => control.send(new GetGatewayTargetCommand({ gatewayIdentifier, targetId })));
  const { gatewayArn, gatewayUrl, workloadIdentityDetails } = await control.send(new GetGatewayCommand({ gatewayIdentifier }));
  // One made before the stack gave it tags gets them too, and so does the workload identity AgentCore
  // made with it, which takes none of the gateway's (docs/aws.md).
  for (const resourceArn of [gatewayArn, workloadIdentityDetails?.workloadIdentityArn]) {
    if (resourceArn !== undefined && Tags !== undefined) await control.send(new TagResourceCommand({ resourceArn, tags: Tags }));
  }
  return { id: gatewayIdentifier, data: { Arn: gatewayArn!, Url: gatewayUrl! } };
}

/** Deletes the gateway with its targets, each once it is gone, and a gateway already gone is deleted. */
async function deleteGateway(gatewayIdentifier: string) {
  const gone = (error: unknown) => {
    if (!(error instanceof ResourceNotFoundException)) throw error;
  };
  const targets = await control.send(new ListGatewayTargetsCommand({ gatewayIdentifier })).catch((error: unknown) => void gone(error));
  if (targets === undefined) return;
  for (const { targetId } of targets.items ?? []) {
    await control.send(new DeleteGatewayTargetCommand({ gatewayIdentifier, targetId })).catch(gone);
    while (await control.send(new GetGatewayTargetCommand({ gatewayIdentifier, targetId })).then(() => true, (error: unknown) => void gone(error))) await sleep(2000);
  }
  await control.send(new DeleteGatewayCommand({ gatewayIdentifier })).catch(gone);
}

export const handler = async (event: Event) => {
  deadline = Date.now() + 4 * 60_000;
  let answer: { Status: "SUCCESS" | "FAILED"; Reason?: string; PhysicalResourceId: string; Data?: Record<string, string> };
  try {
    if (event.RequestType === "Delete") {
      // A gateway's ID is the physical ID's after the region, and a create that failed left none.
      const [, id] = (event.PhysicalResourceId ?? "").split("/");
      if (id !== undefined) await deleteGateway(id);
      answer = { Status: "SUCCESS", PhysicalResourceId: event.PhysicalResourceId! };
    } else {
      const { id, data } = await gateway(event.ResourceProperties);
      answer = { Status: "SUCCESS", PhysicalResourceId: `${region}/${id}`, Data: data };
    }
  } catch (error) {
    console.error(error);
    answer = { Status: "FAILED", Reason: `${error instanceof Error ? error.message : error}`.slice(0, 1000), PhysicalResourceId: event.PhysicalResourceId ?? "none" };
  }
  const body = JSON.stringify({ ...answer, StackId: event.StackId, RequestId: event.RequestId, LogicalResourceId: event.LogicalResourceId });
  await fetch(event.ResponseURL, { method: "PUT", headers: { "content-type": "", "content-length": String(Buffer.byteLength(body)) }, body });
};
