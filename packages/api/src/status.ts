import type { components } from "@duva/openapi";
import type { OperationHandler } from "./api.ts";
import { webSearchRegion } from "./web-search.ts";

export const getStatus: OperationHandler = async (_event, deployment) => ({
  statusCode: 200,
  body: { version: deployment.version, region: deployment.region, webSearchRegion: webSearchRegion(deployment.region) } satisfies components["schemas"]["Status"],
});
