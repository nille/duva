// The real AWS behind deployment.ts: the CDK Toolkit Library deploys the cloud assembly this CLI
// version bundles, and the AWS SDK does what CloudFormation can't.
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, relative } from "node:path";
import {
  BaseCredentials,
  BootstrapEnvironments,
  BootstrapSource,
  type IIoHost,
  NonInteractiveIoHost,
  StackParameters,
  StackSelectionStrategy,
  Toolkit,
} from "@aws-cdk/toolkit-lib";
import { CloudFormationClient, DescribeStacksCommand } from "@aws-sdk/client-cloudformation";
import {
  CognitoIdentityProviderClient,
  DeleteUserPoolCommand,
  DeleteUserPoolDomainCommand,
  DescribeUserPoolCommand,
  paginateListUserPools,
} from "@aws-sdk/client-cognito-identity-provider";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { DescribeActiveReceiptRuleSetCommand, SESClient, SetActiveReceiptRuleSetCommand } from "@aws-sdk/client-ses";
import { CreateEmailIdentityCommand, GetAccountCommand, GetEmailIdentityCommand, NotFoundException, SESv2Client } from "@aws-sdk/client-sesv2";
import { GetParameterCommand, ParameterNotFound, SSMClient } from "@aws-sdk/client-ssm";
import { stackName, stackParameters } from "@duva/infra/outputs";
import type { Aws, StackOutputs, StackParameters as DuvaParameters } from "./deployment.ts";

export function realAws(region: string): Aws {
  const ses = new SESClient({ region });
  const sesv2 = new SESv2Client({ region });
  const cognito = new CognitoIdentityProviderClient({ region });
  return {
    region,

    async duvaStack() {
      const cloudformation = new CloudFormationClient({ region });
      try {
        const [stack] = (await cloudformation.send(new DescribeStacksCommand({ StackName: stackName }))).Stacks ?? [];
        // A stack whose first creation failed holds nothing, and the toolkit replaces it.
        if (stack === undefined || stack.StackStatus === "ROLLBACK_COMPLETE") return undefined;
        const outputs: StackOutputs = {};
        for (const { OutputKey, OutputValue } of stack.Outputs ?? []) if (OutputKey && OutputValue) outputs[OutputKey] = OutputValue;
        const parameter = (key: string) => stack.Parameters?.find(({ ParameterKey }) => ParameterKey === key)?.ParameterValue;
        const domainVerified = parameter(stackParameters.domainVerified);
        return {
          domain: parameter(stackParameters.domain),
          admin: parameter(stackParameters.admin),
          domainVerified: domainVerified === undefined ? undefined : domainVerified === "true",
          outputs,
        };
      } catch (error) {
        if (error instanceof Error && error.message.includes("does not exist")) return undefined;
        throw error;
      }
    },

    async deployStack(parameters) {
      const bundle = await unpackBundle();
      try {
        return await deployBundle(bundle, region, parameters);
      } finally {
        await rm(bundle, { recursive: true, force: true });
      }
    },

    async setUpOrganization(functionName) {
      const { Payload, FunctionError } = await new LambdaClient({ region }).send(new InvokeCommand({ FunctionName: functionName }));
      const result = JSON.parse(new TextDecoder().decode(Payload));
      if (FunctionError !== undefined) throw new Error(`Setting up the organization failed: ${result.errorMessage ?? FunctionError} Fix that and run duva deploy again.`);
      return result;
    },

    async stackUserPools() {
      // CloudFormation tags what it makes with the stack's ID, and a pool it kept on removal keeps the tag.
      const [stack] = (await new CloudFormationClient({ region }).send(new DescribeStacksCommand({ StackName: stackName }))).Stacks ?? [];
      if (stack?.StackId === undefined) return [];
      const ids: string[] = [];
      for await (const page of paginateListUserPools({ client: cognito }, { MaxResults: 60 })) {
        for (const { Id } of page.UserPools ?? []) {
          const { UserPool } = await cognito.send(new DescribeUserPoolCommand({ UserPoolId: Id }));
          if (UserPool?.Id !== undefined && UserPool.UserPoolTags?.["aws:cloudformation:stack-id"] === stack.StackId) ids.push(UserPool.Id);
        }
      }
      return ids;
    },

    async deleteUserPool(id) {
      // Cognito refuses to delete a pool that still has a domain.
      const { UserPool } = await cognito.send(new DescribeUserPoolCommand({ UserPoolId: id }));
      if (UserPool?.Domain) await cognito.send(new DeleteUserPoolDomainCommand({ UserPoolId: id, Domain: UserPool.Domain }));
      await cognito.send(new DeleteUserPoolCommand({ UserPoolId: id }));
    },

    async publishWebApp({ bucket, config }) {
      const s3 = new S3Client({ region });
      const unpacked = await unpackBundle();
      try {
        const web = join(unpacked, "web");
        for (const entry of await readdir(web, { recursive: true, withFileTypes: true })) {
          if (!entry.isFile()) continue;
          const path = join(entry.parentPath, entry.name);
          const key = relative(web, path);
          await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: await readFile(path), ...webObject(key) }));
        }
        await s3.send(new PutObjectCommand({ Bucket: bucket, Key: "config.json", Body: JSON.stringify(config), ...webObject("config.json") }));
      } finally {
        await rm(unpacked, { recursive: true, force: true });
      }
    },

    async activeReceiptRuleSet() {
      return (await ses.send(new DescribeActiveReceiptRuleSetCommand({}))).Metadata?.Name;
    },

    async activateReceiptRuleSet(name) {
      await ses.send(new SetActiveReceiptRuleSetCommand({ RuleSetName: name }));
    },

    async emailIdentity(domain) {
      try {
        const identity = await sesv2.send(new GetEmailIdentityCommand({ EmailIdentity: domain }));
        return {
          dkimStatus: identity.DkimAttributes?.Status ?? "NOT_STARTED",
          mailFromStatus: identity.MailFromAttributes?.MailFromDomainStatus ?? "NOT_STARTED",
          verified: identity.VerifiedForSendingStatus ?? false,
        };
      } catch (error) {
        if (error instanceof NotFoundException) return undefined;
        throw error;
      }
    },

    async emailAddressVerified(address) {
      try {
        return (await sesv2.send(new GetEmailIdentityCommand({ EmailIdentity: address }))).VerifiedForSendingStatus ?? false;
      } catch (error) {
        if (error instanceof NotFoundException) return undefined;
        throw error;
      }
    },

    async verifyEmailAddress(address) {
      await sesv2.send(new CreateEmailIdentityCommand({ EmailIdentity: address }));
    },

    async sending() {
      const { ProductionAccessEnabled, SendQuota } = await sesv2.send(new GetAccountCommand({}));
      return {
        sandbox: !ProductionAccessEnabled,
        perDay: SendQuota?.Max24HourSend ?? 0,
        perSecond: SendQuota?.MaxSendRate ?? 0,
      };
    },
  };
}

/** How CloudFront serves a web app file. Vite names assets by their content, so they never change. */
function webObject(key: string) {
  const types: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".txt": "text/plain; charset=utf-8",
  };
  return {
    ContentType: types[extname(key)] ?? "application/octet-stream",
    CacheControl: key.startsWith("assets/") ? "public, max-age=31536000, immutable" : "no-cache",
  };
}

/**
 * Unpacks what this CLI version bundles into a temporary directory: the cloud assembly synthesized
 * from the CDK app, the CDK bootstrap template and the built web app. See scripts/pack.ts.
 */
async function unpackBundle(): Promise<string> {
  const { default: archive } = await import("../dist/deploy.tar.gz", { with: { type: "file" } });
  const directory = await mkdtemp(join(tmpdir(), "duva-deploy-"));
  await new Bun.Archive(await Bun.file(archive).bytes()).extract(directory);
  return directory;
}

async function deployBundle(bundle: string, region: string, { domain, admin, domainVerified }: DuvaParameters) {
  const toolkit = new Toolkit({
    ioHost: progressOnStderr(new NonInteractiveIoHost({ isCI: false })),
    sdkConfig: { baseCredentials: BaseCredentials.awsCliCompatible({ defaultRegion: region }) },
  });
  const assembly = await toolkit.synth(await toolkit.fromAssemblyDirectory(join(bundle, "assembly")));
  try {
    const [stack] = assembly.cloudAssembly.stacks;
    const { requiresBootstrapStackVersion: required, bootstrapStackVersionSsmParameter: parameter } = stack ?? {};
    if (required === undefined || parameter === undefined) throw new Error("The cloud assembly names no bootstrap version.");
    if ((await bootstrapVersion(region, parameter)) < required) {
      await toolkit.bootstrap(BootstrapEnvironments.fromCloudAssemblySource(assembly), {
        source: BootstrapSource.customTemplate(join(bundle, "bootstrap-template.yaml")),
      });
    }

    const { stacks } = await toolkit.deploy(assembly, {
      stacks: { strategy: StackSelectionStrategy.ALL_STACKS },
      parameters: StackParameters.exactly({
        [stackParameters.domain]: domain,
        [stackParameters.admin]: admin,
        [stackParameters.domainVerified]: String(domainVerified),
      }),
    });
    const [deployed] = stacks;
    if (deployed === undefined) throw new Error("The toolkit deployed no stack.");
    // The assembly is environment-agnostic, so the deployed stack's environment stays unresolved. Its ARN names the account.
    return { account: deployed.stackArn.split(":")[4] ?? "", outputs: deployed.outputs };
  } finally {
    await assembly.dispose();
  }
}

/** Keeps stdout for the command's JSON: the toolkit's progress, results included, goes to stderr. */
function progressOnStderr(host: IIoHost): IIoHost {
  return {
    notify: (message) => host.notify(message.level === "result" ? { ...message, level: "info" } : message),
    requestResponse: (request) => host.requestResponse(request),
  };
}

/** The CDK bootstrap version in the region, or 0 if the account isn't bootstrapped there. */
async function bootstrapVersion(region: string, parameter: string): Promise<number> {
  try {
    const { Parameter } = await new SSMClient({ region }).send(new GetParameterCommand({ Name: parameter }));
    return Number(Parameter?.Value ?? 0);
  } catch (error) {
    if (error instanceof ParameterNotFound) return 0;
    throw error;
  }
}
