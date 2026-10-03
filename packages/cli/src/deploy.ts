import duva from "../../../package.json" with { type: "json" };
import { type Command, optionValues } from "./commands.ts";
import { saveConfig } from "./config.ts";
import { configuredRegion, sesReceivingRegions } from "./regions.ts";

export const deploy: Command = {
  words: ["deploy"],
  summary:
    "Deploy Duva into the AWS account and region of your AWS configuration, for the organization's first domain, with you as its first admin.",
  description: "Running it again updates the deployment to this CLI's version.",
  options: [
    { name: "domain", required: false, description: "The organization's first domain. Needed only the first time." },
    { name: "admin", required: false, description: "Your email address, as the first admin. Needed only the first time." },
  ],
  async run(args) {
    // deploy has no flags or lists, so each option it was given is a string.
    const values = optionValues(deploy, args) as Record<string, string | undefined>;
    const region = await configuredRegion();
    if (region === undefined) {
      throw new Error("No AWS region is configured. Set AWS_REGION, or a region in your AWS profile.");
    }
    if (!sesReceivingRegions.includes(region)) {
      throw new Error(
        `Duva needs SES to receive mail, which it can't in ${region}. Use one of: ${sesReceivingRegions.join(", ")}.`,
      );
    }

    // Loaded here, so commands other than deploy start without the toolkit and the AWS SDK.
    const [{ deployDuva }, { realAws }, { realDns }] = await Promise.all([
      import("./deployment.ts"),
      import("./aws.ts"),
      import("./dns.ts"),
    ]);
    try {
      const { signIn, ...deployed } = await deployDuva({ aws: realAws(region), dns: realDns, domain: values.domain, admin: values.admin });
      await saveConfig({ apiUrl: deployed.apiUrl, webUrl: deployed.webUrl, signIn });
      return { version: duva.version, ...deployed };
    } catch (error) {
      if (error instanceof Error && error.name === "CredentialsProviderError") {
        throw new Error(`Couldn't get AWS credentials: ${error.message}`);
      }
      throw error;
    }
  },
};
