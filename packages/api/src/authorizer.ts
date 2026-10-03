import type { APIGatewayRequestAuthorizerEventV2, APIGatewaySimpleAuthorizerWithContextResult } from "aws-lambda";
import type { Table } from "./deployment.ts";
import { type Actor, findActor } from "./organization.ts";

/** What the authorizer passes the API about a call: the one actor it is attributed to. */
export interface AuthorizerContext {
  actor: Actor;
}

/**
 * Verifies a human's access token and returns the ID it carries. Throws if the token isn't one
 * the deployment trusts. In a deployment that is Cognito's; in tests, a test issuer's.
 */
export type VerifyAccessToken = (token: string) => Promise<string>;

/**
 * The API's one Lambda authorizer. It resolves each call to exactly one actor, or refuses it with
 * 401: API Gateway answers 401 when the authorizer fails with "Unauthorized".
 */
export function createAuthorizer({ table, verifyAccessToken }: { table: Table; verifyAccessToken: VerifyAccessToken }) {
  return async (event: APIGatewayRequestAuthorizerEventV2): Promise<APIGatewaySimpleAuthorizerWithContextResult<AuthorizerContext>> => {
    const token = /^Bearer (.+)$/i.exec(event.headers?.authorization ?? "")?.[1];
    const id = token === undefined ? undefined : await verifyAccessToken(token).catch(() => undefined);
    const actor = id === undefined ? undefined : await findActor(table, id);
    if (actor === undefined) throw new Error("Unauthorized");
    return { isAuthorized: true, context: { actor } };
  };
}
