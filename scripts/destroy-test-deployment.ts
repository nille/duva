// Tears down a Duva test deployment in one region of the configured AWS account:
//
//   AWS_PROFILE=... AWS_REGION=eu-west-3 node scripts/destroy-test-deployment.ts --yes [--bootstrap]
//
// Deactivates Duva's receipt rule set, which SES can't delete while it's active, then deletes
// the Duva stack, then the table and mail bucket it keeps on deletion, all their data included. With --bootstrap, it also deletes the CDK bootstrap stack and its staging bucket,
// but only when the same duva deploy created both stacks. For test deployments only.
import { parseArgs } from "node:util";
import { stackName, stackOutputs } from "@duva/infra/outputs";
import {
  CloudFormationClient,
  DeleteStackCommand,
  DescribeStacksCommand,
  paginateListStackResources,
  waitUntilStackDeleteComplete,
} from "@aws-sdk/client-cloudformation";
import { DeleteTableCommand, DynamoDBClient, waitUntilTableNotExists } from "@aws-sdk/client-dynamodb";
import { DescribeActiveReceiptRuleSetCommand, SESClient, SetActiveReceiptRuleSetCommand } from "@aws-sdk/client-ses";
import { DeleteBucketCommand, DeleteObjectsCommand, ListObjectVersionsCommand, S3Client } from "@aws-sdk/client-s3";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";

const { values } = parseArgs({ options: { yes: { type: "boolean" }, bootstrap: { type: "boolean" } } });
const region = process.env.AWS_REGION;
if (!region) throw new Error("Set AWS_REGION to the region to tear down.");

const cloudformation = new CloudFormationClient({ region });
const s3 = new S3Client({ region });
const dynamodb = new DynamoDBClient({ region });
const ses = new SESClient({ region });
const { Account: account } = await new STSClient({ region }).send(new GetCallerIdentityCommand({}));

const duva = await findStack(stackName);
const bootstrap = values.bootstrap ? await findStack("CDKToolkit") : undefined;
// duva deploy creates the bootstrap stack moments before the Duva stack. One created at any other
// time was already there, so something else may use it.
const createdTogether = (before?: Date, after?: Date) =>
  before !== undefined && after !== undefined && after >= before && after.getTime() - before.getTime() < 10 * 60_000;
if (bootstrap && !createdTogether(bootstrap.CreationTime, duva?.CreationTime)) {
  throw new Error(`The CDK bootstrap stack in ${region} wasn't created by the same duva deploy as the Duva stack. Leaving it alone.`);
}
const doomed = [duva, bootstrap].flatMap((stack) => (stack?.StackName ? [stack.StackName] : []));
if (doomed.length === 0) {
  console.log(`Nothing to tear down in ${account} ${region}.`);
  process.exit(0);
}
if (!values.yes) {
  console.log(`Would delete ${doomed.join(" and ")} in ${account} ${region}, with all their data. Pass --yes to do it.`);
  process.exit(1);
}

const duvasRuleSet = duva?.Outputs?.find(({ OutputKey }) => OutputKey === stackOutputs.receiptRuleSet)?.OutputValue;
const active = (await ses.send(new DescribeActiveReceiptRuleSetCommand({}))).Metadata?.Name;
if (duvasRuleSet !== undefined && active === duvasRuleSet) {
  // Without a name, SetActiveReceiptRuleSet leaves no rule set active.
  await ses.send(new SetActiveReceiptRuleSetCommand({}));
  console.log(`Deactivated receipt rule set ${active}`);
}

for (const stack of [duva, bootstrap]) {
  if (stack?.StackId === undefined) continue;
  await cloudformation.send(new DeleteStackCommand({ StackName: stack.StackId }));
  await waitUntilStackDeleteComplete({ client: cloudformation, maxWaitTime: 900 }, { StackName: stack.StackId });
  // What the stack keeps on deletion is left behind as DELETE_SKIPPED.
  for await (const page of paginateListStackResources({ client: cloudformation }, { StackName: stack.StackId })) {
    for (const resource of page.StackResourceSummaries ?? []) {
      if (resource.ResourceStatus !== "DELETE_SKIPPED" || !resource.PhysicalResourceId) continue;
      await deleteKept(resource.ResourceType ?? "", resource.PhysicalResourceId);
      console.log(`Deleted ${resource.ResourceType} ${resource.PhysicalResourceId}`);
    }
  }
  console.log(`Deleted stack ${stack.StackName}`);
}

async function findStack(name: string) {
  try {
    return (await cloudformation.send(new DescribeStacksCommand({ StackName: name }))).Stacks?.[0];
  } catch (error) {
    if (error instanceof Error && error.message.includes("does not exist")) return undefined;
    throw error;
  }
}

async function deleteKept(type: string, id: string) {
  switch (type) {
    case "AWS::S3::Bucket":
      await emptyBucket(id);
      await s3.send(new DeleteBucketCommand({ Bucket: id }));
      return;
    case "AWS::DynamoDB::GlobalTable":
    case "AWS::DynamoDB::Table":
      await dynamodb.send(new DeleteTableCommand({ TableName: id }));
      await waitUntilTableNotExists({ client: dynamodb, maxWaitTime: 300 }, { TableName: id });
      return;
    default:
      throw new Error(`Don't know how to delete the kept ${type} ${id}. Delete it by hand.`);
  }
}

/** Deletes every version and delete marker in a versioned bucket. */
async function emptyBucket(bucket: string) {
  let page: { KeyMarker?: string; VersionIdMarker?: string } = {};
  for (;;) {
    const listing = await s3.send(new ListObjectVersionsCommand({ Bucket: bucket, ...page }));
    const objects = [...(listing.Versions ?? []), ...(listing.DeleteMarkers ?? [])].map(({ Key, VersionId }) => ({ Key, VersionId }));
    if (objects.length > 0) await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: objects, Quiet: true } }));
    if (!listing.IsTruncated) return;
    page = { KeyMarker: listing.NextKeyMarker, VersionIdMarker: listing.NextVersionIdMarker };
  }
}
