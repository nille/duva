import { operations } from "./operations.gen.ts";

export { operations };
export type { components, paths } from "./schema.gen.ts";

/**
 * An operation in the OpenAPI document, with what the API, the CDK app and the CLI need to know
 * about it. Its routeKey is the one API Gateway gives the operation's route.
 */
export type Operation = (typeof operations)[number];

export type OperationId = Operation["operationId"];
