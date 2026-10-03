import type { components } from "@duva/openapi";
import type { OperationHandler } from "./api.ts";

export const getStatus: OperationHandler = async (_event, deployment) => ({
  statusCode: 200,
  body: { version: deployment.version, region: deployment.region } satisfies components["schemas"]["Status"],
});
