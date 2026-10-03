import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { IIoHost } from "@aws-cdk/toolkit-lib";
import duva from "../../../package.json" with { type: "json" };
import type { Command } from "./commands.ts";
import { saveConfig } from "./config.ts";
import { configuredRegion, sesReceivingRegions } from "./regions.ts";

export const deploy: Command = {
  words: ["deploy"],
  summary: "Deploy Duva into the AWS account and region of your AWS configuration.",
  async run(args) {
    parseArgs({ args, options: {} });
    const region = await configuredRegion();
    if (region === undefined) {
      throw new Error("No AWS region is configured. Set AWS_REGION, or a region in your AWS profile.");
    }
    if (!sesReceivingRegions.includes(region)) {
      throw new Error(
        `Duva needs SES to receive mail, which it can't in ${region}. Use one of: ${sesReceivingRegions.join(", ")}.`,
      );
    }

    const bundle = await unpackBundle();
    try {
      const deployed = await deployBundle(bundle, region);
      await saveConfig({ apiUrl: deployed.apiUrl });
      return { version: duva.version, ...deployed };
    } finally {
      await rm(bundle, { recursive: true, force: true });
    }
  },
};

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

async function deployBundle(bundle: string, region: string) {
  const { BaseCredentials, BootstrapEnvironments, BootstrapSource, NonInteractiveIoHost, StackSelectionStrategy, Toolkit } =
    await import("@aws-cdk/toolkit-lib");
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

    const { stacks } = await toolkit.deploy(assembly, { stacks: { strategy: StackSelectionStrategy.ALL_STACKS } });
    const [deployed] = stacks;
    const apiUrl = deployed?.outputs.ApiUrl;
    if (deployed === undefined || apiUrl === undefined) throw new Error("The deployed stack has no ApiUrl output.");
    // The assembly is environment-agnostic, so the deployed stack's environment stays unresolved. Its ARN names the account.
    return { account: deployed.stackArn.split(":")[4], region, apiUrl };
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
  const { GetParameterCommand, ParameterNotFound, SSMClient } = await import("@aws-sdk/client-ssm");
  try {
    const { Parameter } = await new SSMClient({ region }).send(new GetParameterCommand({ Name: parameter }));
    return Number(Parameter?.Value ?? 0);
  } catch (error) {
    if (error instanceof ParameterNotFound) return 0;
    if (error instanceof Error && error.name === "CredentialsProviderError") {
      throw new Error(`Couldn't get AWS credentials: ${error.message}`);
    }
    throw error;
  }
}
