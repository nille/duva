import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { type Operation, operations, type OperationId } from "@duva/openapi";
import type { AuthorizerContext } from "./authorizer.ts";
import { listOrganizationChanges } from "./changes.ts";
import type { Deployment } from "./deployment.ts";
import type { Actor } from "./organization.ts";
import { getStatus } from "./status.ts";
import { whoami } from "./whoami.ts";

/**
 * Handles one operation. `actor` is the actor the authorizer resolved the call to, and is
 * undefined only for operations that need no sign-in.
 */
export type OperationHandler = (
  event: APIGatewayProxyEventV2,
  deployment: Deployment,
  actor: Actor | undefined,
) => Promise<{ statusCode: number; body: unknown }>;

const handlers: Record<OperationId, OperationHandler> = { getStatus, whoami, listOrganizationChanges };

const operationByRouteKey = new Map<string, Operation>(operations.map((operation) => [operation.routeKey, operation]));

/** The API's Lambda handler. API Gateway has one route per operation, so the route key names the operation. */
export function createApi(deployment: Deployment) {
  return async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
    const operation = operationByRouteKey.get(event.routeKey);
    if (operation === undefined) throw new Error(`No operation has the route ${event.routeKey}`);
    const actor = (event.requestContext as { authorizer?: { lambda?: Partial<AuthorizerContext> } }).authorizer?.lambda?.actor;
    // The authorizer guards every route that needs sign-in, so a call without an actor here is a deployment bug.
    if (operation.signIn && actor === undefined) throw new Error(`${operation.operationId} was called without an actor`);
    const { statusCode, body } = await handlers[operation.operationId](event, deployment, actor);
    return { statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
  };
}

/** An answer that the call can't be done, with what to do about it. */
export const refusal = (statusCode: number, message: string) => ({ statusCode, body: { message } });
