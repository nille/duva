import { App } from "aws-cdk-lib";
import cdk from "../cdk.json" with { type: "json" };
import { stackName } from "./outputs.ts";
import { DuvaStack } from "./stack.ts";

/** The CDK app for Duva `version`, synthesizing into `outdir`. */
export function duvaApp({ outdir, version }: { outdir: string; version: string }): App {
  // cdk.json pins the feature flags that were recommended when this app was created.
  const app = new App({ outdir, context: cdk.context });
  new DuvaStack(app, stackName, {
    version,
    description: `Duva ${version}, a self-hosted mailbox platform. Deployed by duva deploy.`,
  });
  return app;
}
