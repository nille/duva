import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { operations, type OperationId } from "@duva/openapi";
import type { Deployment } from "./deployment.ts";
import { getStatus } from "./status.ts";

export type OperationHandler = (
  event: APIGatewayProxyEventV2,
  deployment: Deployment,
) => Promise<{ statusCode: number; body: unknown }>;

const handlers: Record<OperationId, OperationHandler> = { getStatus };

const operationIdByRouteKey = new Map<string, OperationId>(
  operations.map((operation) => [`${operation.method.toUpperCase()} ${operation.path}`, operation.operationId]),
);

/** The API's Lambda handler. API Gateway has one route per operation, so the route key names the operation. */
export function createApi(deployment: Deployment) {
  return async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
    const operationId = operationIdByRouteKey.get(event.routeKey);
    if (operationId === undefined) throw new Error(`No operation has the route ${event.routeKey}`);
    const { statusCode, body } = await handlers[operationId](event, deployment);
    return { statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
  };
}
