import { App, Tags } from "aws-cdk-lib";
import { projectTag } from "@duva/api/infrastructure";
import cdk from "../cdk.json" with { type: "json" };
import { stackName } from "./outputs.ts";
import { DuvaStack } from "./stack.ts";

/** The CDK app for Duva `version`, synthesizing into `outdir`. */
export function duvaApp({ outdir, version }: { outdir: string; version: string }): App {
  // cdk.json pins the feature flags that were recommended when this app was created.
  const app = new App({ outdir, context: cdk.context });
  // Everything Duva makes is tagged as the project's (#176): the stack, whose tags deploy gives
  // CloudFormation, and each resource in the template that CloudFormation can tag. cdk.json's
  // explicitStackTags keeps Tags.of off the stack, so the stack names its own.
  new DuvaStack(app, stackName, {
    version,
    description: `Duva ${version}, a self-hosted mailbox platform. Deployed by duva deploy.`,
    tags: { [projectTag.Key]: projectTag.Value },
  });
  Tags.of(app).add(projectTag.Key, projectTag.Value);
  return app;
}
