// The spike's harness. Everything it creates in AWS is in the
// duva-search-spike stack, in eu-north-1, and `down` deletes all of it.
//
//   node harness/harness.ts package   build both Lambda packages in dist/
//   node harness/harness.ts up        create the stack, upload and build both packages, add the functions
//   node harness/harness.ts test-s3   run the behavior suite on a table on S3
//   node harness/harness.ts seed      write the fixture mailbox to the functions' table location
//   node harness/harness.ts measure   cold and warm invocations of each function, into results/
//   node harness/harness.ts down      empty the bucket and delete the stack
//
// Run it with AWS_PROFILE set to the spike's account.
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createReadStream, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CloudFormationClient,
  CreateStackCommand,
  DeleteStackCommand,
  DescribeStacksCommand,
  UpdateStackCommand,
  waitUntilStackCreateComplete,
  waitUntilStackDeleteComplete,
  waitUntilStackUpdateComplete,
  type Parameter,
} from "@aws-sdk/client-cloudformation";
import { BatchGetBuildsCommand, CodeBuildClient, StartBuildCommand } from "@aws-sdk/client-codebuild";
import { DescribeImagesCommand, ECRClient } from "@aws-sdk/client-ecr";
import {
  GetFunctionConfigurationCommand,
  InvokeCommand,
  LambdaClient,
  UpdateFunctionConfigurationCommand,
  waitUntilFunctionUpdatedV2,
} from "@aws-sdk/client-lambda";
import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import * as lancedb from "@lancedb/lancedb";
import { lanceSearch } from "../src/lancedb-search.ts";
import type { SearchHit, SearchQuery } from "../src/search.ts";
import { fixture } from "../test/fixture.ts";
import { packageAll, type Package } from "./package.ts";

const region = "eu-north-1";
const stackName = "duva-search-spike";
const root = new URL("..", import.meta.url).pathname;
const functions = { "x64-zip": "duva-search-spike-x64-zip", "arm64-image": "duva-search-spike-arm64-image" } as const;

const cloudFormation = new CloudFormationClient({ region });
const s3 = new S3Client({ region });
const lambda = new LambdaClient({ region });
const ecr = new ECRClient({ region });

async function up() {
  const packages = await packageAll();
  if (!(await stackOutputs())) await deployStack({});
  const bucket = await bucketName();
  const zip = packages.find((p) => p.name === "x64-zip")!;
  const image = packages.find((p) => p.name === "arm64-image")!;
  const zipKey = `artifacts/x64-zip-${zip.hash}.zip`;
  await upload(bucket, zipKey, zip.file);
  await buildImage(bucket, image);
  await deployStack({ ZipKey: zipKey, ImageTag: image.hash });
  return { bucket, packages };
}

async function testOnS3() {
  const bucket = await bucketName();
  const prefix = `suite/${randomUUID()}`;
  try {
    const run = spawnSync("npx", ["vitest", "run"], {
      cwd: root,
      stdio: "inherit",
      env: { ...process.env, ...(await credentialsEnv()), AWS_REGION: region, SEARCH_SPIKE_S3_URI: `s3://${bucket}/${prefix}` },
    });
    return { prefix, passed: run.status === 0 };
  } finally {
    await emptyBucket(bucket, prefix);
  }
}

const fixtureMailbox = "fixture";

async function seed() {
  const uri = `s3://${await bucketName()}/tables`;
  Object.assign(process.env, await credentialsEnv());
  const storageOptions = { region };
  const db = await lancedb.connect(uri, { storageOptions });
  if ((await db.tableNames()).includes(fixtureMailbox)) await db.dropTable(fixtureMailbox);
  const mailbox = await lanceSearch({ uri, storageOptions }).mailbox(fixtureMailbox);
  await mailbox.add(fixture);
  return { uri, mailbox: fixtureMailbox, messages: fixture.length };
}

// A keyword query whose answer the behavior suite pins down.
const keywordQuery: SearchQuery = { words: "kayak", filters: { labels: { exclude: ["Spam", "Trash"] } }, limit: 10 };
const expected = ["kayak-rental", "kayak-club"];

async function measure() {
  const cold = 5;
  const warm = 10;
  const results = [];
  for (const [name, functionName] of Object.entries(functions)) {
    const invocations = [];
    for (let i = 0; i < cold; i++) {
      await newEnvironment(functionName);
      invocations.push({ cold: true, ...(await invoke(functionName)) });
      for (let j = 0; j < (i === 0 ? warm : 0); j++) invocations.push({ cold: false, ...(await invoke(functionName)) });
    }
    const config = await lambda.send(new GetFunctionConfigurationCommand({ FunctionName: functionName }));
    results.push({
      package: name,
      functionName,
      memoryMb: config.MemorySize,
      size: await packageSize(name as keyof typeof functions),
      answered: invocations.every((i) => JSON.stringify(i.hits) === JSON.stringify(expected)),
      invocations,
    });
  }
  const lancedbVersion = JSON.parse(readFileSync(join(root, "node_modules/@lancedb/lancedb/package.json"), "utf8")).version;
  const report = { measuredAt: new Date().toISOString(), region, lancedbVersion, query: keywordQuery, results };
  mkdirSync(join(root, "results"), { recursive: true });
  writeFileSync(join(root, "results/15-packaging.json"), JSON.stringify(report, null, 2) + "\n");
  return report;
}

async function down() {
  const outputs = await stackOutputs();
  if (!outputs) return { deleted: false, reason: "There is no stack." };
  await emptyBucket(outputs.Bucket!);
  await cloudFormation.send(new DeleteStackCommand({ StackName: stackName }));
  await waitUntilStackDeleteComplete({ client: cloudFormation, maxWaitTime: 1800 }, { StackName: stackName });
  return { deleted: true, stack: stackName, bucket: outputs.Bucket };
}

async function deployStack(parameters: Record<string, string>) {
  const input = {
    StackName: stackName,
    TemplateBody: readFileSync(join(root, "infra/stack.yaml"), "utf8"),
    Capabilities: ["CAPABILITY_NAMED_IAM" as const],
    Parameters: Object.entries(parameters).map(([ParameterKey, ParameterValue]): Parameter => ({ ParameterKey, ParameterValue })),
    Tags: [{ Key: "duva-search-spike", Value: "throwaway" }],
  };
  const waitFor = { client: cloudFormation, maxWaitTime: 1800 };
  if (!(await stackOutputs())) {
    await cloudFormation.send(new CreateStackCommand({ ...input, OnFailure: "DELETE" }));
    await waitUntilStackCreateComplete(waitFor, { StackName: stackName });
    return;
  }
  try {
    await cloudFormation.send(new UpdateStackCommand(input));
  } catch (error) {
    if (error instanceof Error && error.message.includes("No updates are to be performed")) return;
    throw error;
  }
  await waitUntilStackUpdateComplete(waitFor, { StackName: stackName });
}

async function stackOutputs(): Promise<Record<string, string> | undefined> {
  try {
    const { Stacks } = await cloudFormation.send(new DescribeStacksCommand({ StackName: stackName }));
    const outputs = Stacks?.[0]?.Outputs ?? [];
    return Object.fromEntries(outputs.map((o) => [o.OutputKey!, o.OutputValue!]));
  } catch (error) {
    if (error instanceof Error && error.message.includes("does not exist")) return undefined;
    throw error;
  }
}

async function bucketName(): Promise<string> {
  const bucket = (await stackOutputs())?.Bucket;
  if (!bucket) throw new Error("The stack isn't up. Run `node harness/harness.ts up` first.");
  return bucket;
}

async function upload(bucket: string, key: string, file: string) {
  await new Upload({ client: s3, params: { Bucket: bucket, Key: key, Body: createReadStream(file) } }).done();
}

async function buildImage(bucket: string, image: Package) {
  const existing = await ecr
    .send(new DescribeImagesCommand({ repositoryName: "duva-search-spike", imageIds: [{ imageTag: image.hash }] }))
    .catch((error) => {
      if (error instanceof Error && error.name === "ImageNotFoundException") return undefined;
      throw error;
    });
  if (existing?.imageDetails?.length) return;
  await upload(bucket, "artifacts/image-context.zip", image.file);
  const codeBuild = new CodeBuildClient({ region });
  const { build } = await codeBuild.send(
    new StartBuildCommand({
      projectName: "duva-search-spike-image",
      environmentVariablesOverride: [{ name: "IMAGE_TAG", value: image.hash, type: "PLAINTEXT" }],
    }),
  );
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 15_000));
    const { builds } = await codeBuild.send(new BatchGetBuildsCommand({ ids: [build!.id!] }));
    const status = builds?.[0]?.buildStatus;
    if (status === "SUCCEEDED") return;
    if (status !== "IN_PROGRESS") throw new Error(`The image build ended ${status}. See ${builds?.[0]?.logs?.deepLink}`);
  }
}

// Changing the configuration retires the function's warm environments, so the
// next invocation starts a new one.
async function newEnvironment(functionName: string) {
  const config = await lambda.send(new GetFunctionConfigurationCommand({ FunctionName: functionName }));
  const variables = { ...config.Environment?.Variables, COLD_START: randomUUID() };
  await lambda.send(new UpdateFunctionConfigurationCommand({ FunctionName: functionName, Environment: { Variables: variables } }));
  await waitUntilFunctionUpdatedV2({ client: lambda, maxWaitTime: 300 }, { FunctionName: functionName });
}

async function invoke(functionName: string) {
  const started = performance.now();
  const response = await lambda.send(
    new InvokeCommand({ FunctionName: functionName, LogType: "Tail", Payload: JSON.stringify({ mailbox: fixtureMailbox, query: keywordQuery }) }),
  );
  const roundTripMs = performance.now() - started;
  const payload = JSON.parse(Buffer.from(response.Payload ?? []).toString("utf8"));
  if (response.FunctionError) throw new Error(`${functionName} failed: ${JSON.stringify(payload)}`);
  const log = Buffer.from(response.LogResult ?? "", "base64").toString("utf8");
  const report = (label: string) => {
    const match = log.match(new RegExp(`${label}: ([\\d.]+)`));
    return match ? Number(match[1]) : undefined;
  };
  return {
    hits: (payload.hits as SearchHit[]).map((h) => h.messageId),
    searchMs: payload.searchMs as number,
    durationMs: report("\\tDuration"),
    initMs: report("Init Duration"),
    maxMemoryMb: report("Max Memory Used"),
    roundTripMs,
  };
}

async function packageSize(name: keyof typeof functions) {
  const config = await lambda.send(new GetFunctionConfigurationCommand({ FunctionName: functions[name] }));
  if (name === "x64-zip") return { zipBytes: config.CodeSize };
  const tag = (await stackParameters()).ImageTag;
  const { imageDetails } = await ecr.send(new DescribeImagesCommand({ repositoryName: "duva-search-spike", imageIds: [{ imageTag: tag }] }));
  return { imageBytesCompressed: imageDetails?.[0]?.imageSizeInBytes, codeSha256: config.CodeSha256 };
}

async function stackParameters(): Promise<Record<string, string>> {
  const { Stacks } = await cloudFormation.send(new DescribeStacksCommand({ StackName: stackName }));
  return Object.fromEntries((Stacks?.[0]?.Parameters ?? []).map((p) => [p.ParameterKey!, p.ParameterValue!]));
}

async function emptyBucket(bucket: string, prefix?: string) {
  for (;;) {
    const { Contents } = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }));
    if (!Contents?.length) return;
    await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: Contents.map((o) => ({ Key: o.Key! })) } }));
  }
}

// LanceDB's object store reads credentials from the environment, and doesn't
// follow an SSO profile itself.
async function credentialsEnv(): Promise<Record<string, string>> {
  const credentials = await s3.config.credentials();
  return {
    AWS_ACCESS_KEY_ID: credentials.accessKeyId,
    AWS_SECRET_ACCESS_KEY: credentials.secretAccessKey,
    ...(credentials.sessionToken ? { AWS_SESSION_TOKEN: credentials.sessionToken } : {}),
  };
}

const commands: Record<string, () => Promise<unknown>> = {
  package: packageAll,
  up,
  "test-s3": testOnS3,
  seed,
  measure,
  down,
};

const command = commands[process.argv[2] ?? ""];
if (!command) {
  console.error(`Usage: node harness/harness.ts ${Object.keys(commands).join("|")}`);
  process.exit(1);
}
console.log(JSON.stringify(await command(), null, 2));
