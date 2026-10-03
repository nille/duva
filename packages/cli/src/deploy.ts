import { mkdtemp, readFile, rm } from "node:fs/promises";
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

    const shipped = await unpack();
    try {
      const deployed = await deployAssembly(region, shipped);
      await saveConfig({ apiUrl: deployed.apiUrl });
      return { version: duva.version, ...deployed };
    } finally {
      await rm(shipped, { recursive: true, force: true });
    }
  },
};

/**
 * Unpacks what this CLI version ships into a temporary directory: the cloud assembly synthesized
 * from the CDK app, and the CDK bootstrap template. See scripts/pack.ts.
 */
async function unpack(): Promise<string> {
  const { default: archive } = await import("../dist/deploy.tar.gz", { with: { type: "file" } });
  const directory = await mkdtemp(join(tmpdir(), "duva-deploy-"));
  await new Bun.Archive(await Bun.file(archive).bytes()).extract(directory);
  return directory;
}

async function deployAssembly(region: string, shipped: string) {
  const { BaseCredentials, BootstrapEnvironments, BootstrapSource, NonInteractiveIoHost, StackSelectionStrategy, Toolkit } =
    await import("@aws-cdk/toolkit-lib");
  const toolkit = new Toolkit({
    ioHost: progressOnStderr(new NonInteractiveIoHost({ isCI: false })),
    sdkConfig: { baseCredentials: BaseCredentials.awsCliCompatible({ defaultRegion: region }) },
  });
  const assembly = join(shipped, "assembly");
  const cx = await toolkit.fromAssemblyDirectory(assembly);

  const { requiredVersion, versionParameter } = await bootstrapNeeds(assembly);
  if ((await bootstrapVersion(region, versionParameter)) < requiredVersion) {
    await toolkit.bootstrap(BootstrapEnvironments.fromCloudAssemblySource(cx), {
      source: BootstrapSource.customTemplate(join(shipped, "bootstrap-template.yaml")),
    });
  }

  const { stacks } = await toolkit.deploy(cx, { stacks: { strategy: StackSelectionStrategy.ALL_STACKS } });
  const [stack] = stacks;
  const apiUrl = stack?.outputs.ApiUrl;
  if (stack === undefined || apiUrl === undefined) throw new Error("The deployed stack has no ApiUrl output.");
  // The stack's environment stays unresolved, because the assembly is environment-agnostic. Its ARN isn't.
  const [, , , stackRegion, account] = stack.stackArn.split(":");
  return { account, region: stackRegion, apiUrl };
}

/** Keeps stdout for the command's JSON: the toolkit's progress, results included, goes to stderr. */
function progressOnStderr(host: IIoHost): IIoHost {
  return {
    notify: (message) => host.notify(message.level === "result" ? { ...message, level: "info" } : message),
    requestResponse: (request) => host.requestResponse(request),
  };
}

/** The bootstrap version the assembly's stack needs, and the SSM parameter that holds the region's current one. */
async function bootstrapNeeds(assembly: string) {
  const manifest = JSON.parse(await readFile(join(assembly, "manifest.json"), "utf8")) as {
    artifacts: Record<string, { type: string; properties?: { requiresBootstrapStackVersion?: number; bootstrapStackVersionSsmParameter?: string } }>;
  };
  const stack = Object.values(manifest.artifacts).find(({ type }) => type === "aws:cloudformation:stack");
  const { requiresBootstrapStackVersion, bootstrapStackVersionSsmParameter } = stack?.properties ?? {};
  if (requiresBootstrapStackVersion === undefined || bootstrapStackVersionSsmParameter === undefined) {
    throw new Error("The cloud assembly names no bootstrap version.");
  }
  return { requiredVersion: requiresBootstrapStackVersion, versionParameter: bootstrapStackVersionSsmParameter };
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
