// The real AWS behind deployment.ts: the CDK Toolkit Library deploys the cloud assembly this CLI
// version bundles, and the AWS SDK does what CloudFormation can't.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
import { DescribeActiveReceiptRuleSetCommand, SESClient, SetActiveReceiptRuleSetCommand } from "@aws-sdk/client-ses";
import { GetAccountCommand, GetEmailIdentityCommand, NotFoundException, SESv2Client } from "@aws-sdk/client-sesv2";
import { GetParameterCommand, ParameterNotFound, SSMClient } from "@aws-sdk/client-ssm";
import { stackName, stackParameters } from "@duva/infra/outputs";
import type { Aws, StackOutputs } from "./deployment.ts";

export function realAws(region: string): Aws {
  const ses = new SESClient({ region });
  const sesv2 = new SESv2Client({ region });
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
        return { domain: stack.Parameters?.find(({ ParameterKey }) => ParameterKey === stackParameters.domain)?.ParameterValue, outputs };
      } catch (error) {
        if (error instanceof Error && error.message.includes("does not exist")) return undefined;
        throw error;
      }
    },

    async deployStack({ domain }) {
      const bundle = await unpackBundle();
      try {
        return await deployBundle(bundle, region, domain);
      } finally {
        await rm(bundle, { recursive: true, force: true });
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
        };
      } catch (error) {
        if (error instanceof NotFoundException) return undefined;
        throw error;
      }
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

/**
 * Unpacks what this CLI version bundles into a temporary directory: the cloud assembly synthesized
 * from the CDK app, and the CDK bootstrap template. See scripts/pack.ts.
 */
async function unpackBundle(): Promise<string> {
  const { default: archive } = await import("../dist/deploy.tar.gz", { with: { type: "file" } });
  const directory = await mkdtemp(join(tmpdir(), "duva-deploy-"));
  await new Bun.Archive(await Bun.file(archive).bytes()).extract(directory);
  return directory;
}

async function deployBundle(bundle: string, region: string, domain: string) {
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
      parameters: StackParameters.exactly({ [stackParameters.domain]: domain }),
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
