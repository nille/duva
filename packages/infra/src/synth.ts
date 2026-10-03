// Synthesizes the CDK app into the cloud assembly that duva deploy ships. The CDK app can't be
// synthesized inside the compiled duva binary (aws-cdk-lib fails to start under it), so the
// build does it here, ahead of time, and the binary embeds the result.
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import duva from "../../../package.json" with { type: "json" };
import { duvaApp } from "./app.ts";

// Start from an empty directory, so no stale assets end up in the binary.
const outdir = fileURLToPath(new URL("../dist/assembly", import.meta.url));
rmSync(outdir, { recursive: true, force: true });

duvaApp({ outdir, version: duva.version }).synth();
