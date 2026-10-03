import { getProfileName, loadSharedConfigFiles } from "@smithy/shared-ini-file-loader";

/**
 * The regions where SES can receive mail, which Duva needs (ADR-0004). From
 * https://docs.aws.amazon.com/general/latest/gr/ses.html#ses_inbound_endpoints
 */
export const sesReceivingRegions = [
  "af-south-1",
  "ap-northeast-1",
  "ap-northeast-2",
  "ap-northeast-3",
  "ap-south-1",
  "ap-southeast-1",
  "ap-southeast-2",
  "ap-southeast-3",
  "ca-central-1",
  "eu-central-1",
  "eu-north-1",
  "eu-south-1",
  "eu-west-1",
  "eu-west-2",
  "eu-west-3",
  "il-central-1",
  "me-south-1",
  "sa-east-1",
  "us-east-1",
  "us-east-2",
  "us-west-1",
  "us-west-2",
];

/** The region the AWS configuration names, read the way the AWS CLI reads it, or undefined if it names none. */
export async function configuredRegion(): Promise<string | undefined> {
  const fromEnvironment = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
  if (fromEnvironment) return fromEnvironment;
  const { configFile } = await loadSharedConfigFiles({ ignoreCache: true });
  return configFile[getProfileName({})]?.region;
}
