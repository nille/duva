// These tests check the cloud assembly the CDK app synthesizes, which is what duva deploy ships.
// Each rule holds for every resource, so it also covers what later tickets add.
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { environmentVariables } from "@duva/api/infrastructure";
import { buildSync } from "esbuild";
import { expect, test } from "vitest";
import { duvaApp } from "../src/app.ts";

interface Resource {
  Type: string;
  /** Untyped CloudFormation JSON. */
  Properties?: Record<string, any>;
}

/**
 * Resource types an idle deployment pays nothing for beyond storage (ADR-0006). Add a type only
 * once you know that holds for it.
 */
const payPerUse = new Set([
  "AWS::ApiGatewayV2::Api",
  "AWS::ApiGatewayV2::Integration",
  "AWS::ApiGatewayV2::Route",
  "AWS::ApiGatewayV2::Stage",
  "AWS::DynamoDB::GlobalTable",
  "AWS::IAM::Role",
  "AWS::Lambda::Function",
  "AWS::Lambda::Permission",
  "AWS::Logs::LogGroup",
  "AWS::S3::Bucket",
  "AWS::S3::BucketPolicy",
]);

const outdir = mkdtempSync(join(tmpdir(), "duva-assembly-"));
const stack = duvaApp({ outdir, version: "0.0.0-test" }).synth().getStackByName("Duva");
const resources = Object.entries(stack.template.Resources as Record<string, Resource>);
const ofType = (type: string) => resources.filter(([, resource]) => resource.Type === type);

test("an idle deployment pays for nothing beyond storage", () => {
  const types = new Set(resources.map(([, resource]) => resource.Type));
  expect([...types].filter((type) => !payPerUse.has(type))).toEqual([]);
});

test("every Lambda runs Node.js 24 on arm64, outside any VPC", () => {
  const functions = ofType("AWS::Lambda::Function");
  expect(functions).not.toHaveLength(0);
  for (const [id, { Properties }] of functions) {
    const { Runtime: runtime, Architectures: architectures, VpcConfig: vpc } = Properties ?? {};
    expect({ id, runtime, architectures, vpc }).toEqual({ id, runtime: "nodejs24.x", architectures: ["arm64"], vpc: undefined });
  }
});

test("every Lambda carries its own AWS SDK, so a CLI version pins all the code it deploys", () => {
  const assets = JSON.parse(readFileSync(join(outdir, `${stack.id}.assets.json`), "utf8")) as {
    files: Record<string, { source: { path: string } }>;
  };
  for (const [id, { Properties }] of ofType("AWS::Lambda::Function")) {
    const asset = assets.files[String(Properties?.Code?.S3Key).replace(/\.zip$/, "")];
    if (asset === undefined) throw new Error(`${id} has no asset in the assembly`);
    const directory = join(outdir, asset.source.path);
    const sdkImports = readdirSync(directory, { recursive: true, encoding: "utf8" })
      .filter((file) => /\.[cm]?js$/.test(file))
      .flatMap((file) => importsOf(join(directory, file)))
      .filter((path) => path.startsWith("@aws-sdk/"));
    expect({ id, sdkImports }).toEqual({ id, sdkImports: [] });
  }
});

/** The modules a bundle still imports at run time, read by esbuild so strings that name a module don't count. */
function importsOf(file: string): string[] {
  const { metafile } = buildSync({
    entryPoints: [file],
    bundle: true,
    write: false,
    metafile: true,
    platform: "node",
    format: "esm",
    packages: "external",
    logLevel: "silent",
  });
  return Object.values(metafile.inputs).flatMap(({ imports }) => imports.map(({ path }) => path));
}

test("the deployment has one table, on demand, with point-in-time recovery", () => {
  const tables = ofType("AWS::DynamoDB::GlobalTable");
  expect(tables).toHaveLength(1);
  for (const [, { Properties }] of tables) {
    expect(Properties?.BillingMode).toBe("PAY_PER_REQUEST");
    for (const replica of Properties?.Replicas ?? []) {
      expect(replica.PointInTimeRecoverySpecification).toEqual({ PointInTimeRecoveryEnabled: true });
    }
  }
});

test("every bucket is encrypted with SSE-S3 and blocks public access", () => {
  const buckets = ofType("AWS::S3::Bucket");
  expect(buckets).not.toHaveLength(0);
  for (const [id, { Properties }] of buckets) {
    const { BucketEncryption: encryption, PublicAccessBlockConfiguration: publicAccess } = Properties ?? {};
    expect({ id, encryption, publicAccess }).toEqual({
      id,
      encryption: { ServerSideEncryptionConfiguration: [{ ServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" } }] },
      publicAccess: { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true },
    });
  }
});

test("the mail bucket keeps every version of raw mail", () => {
  const mailBuckets = new Set(
    ofType("AWS::Lambda::Function").flatMap(([, { Properties }]) => {
      const ref: unknown = Properties?.Environment?.Variables?.[environmentVariables.mailBucket]?.Ref;
      return typeof ref === "string" ? [ref] : [];
    }),
  );
  expect(mailBuckets.size).toBe(1);
  for (const id of mailBuckets) {
    expect(stack.template.Resources[id].Properties.VersioningConfiguration).toEqual({ Status: "Enabled" });
  }
});
