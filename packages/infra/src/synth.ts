// Synthesizes the CDK app into the cloud assembly that duva deploy ships. The CDK app can't be
// synthesized inside the compiled duva binary (aws-cdk-lib fails to start under it), so the
// build does it here, ahead of time, and the binary embeds the result.
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { App } from "aws-cdk-lib";
import duva from "../../../package.json" with { type: "json" };
import cdk from "../cdk.json" with { type: "json" };
import { DuvaStack } from "./stack.ts";

// Start from an empty directory, so no stale assets end up in the binary.
const outdir = fileURLToPath(new URL("../dist/assembly", import.meta.url));
rmSync(outdir, { recursive: true, force: true });

// cdk.json pins the feature flags that were recommended when this app was created.
const app = new App({ outdir, context: cdk.context });
new DuvaStack(app, "Duva", {
  version: duva.version,
  description: `Duva ${duva.version}, a self-hosted mailbox platform. Deployed by duva deploy.`,
});
app.synth();
