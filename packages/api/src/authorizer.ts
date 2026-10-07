import type { APIGatewayRequestAuthorizerEventV2, APIGatewaySimpleAuthorizerWithContextResult } from "aws-lambda";
import { agentKeyPrefix } from "./agent-keys.ts";
import type { Table } from "./deployment.ts";
import { findAgentByRunToken, runTokenPrefix } from "./run-tokens.ts";
import { type Actor, findAgentByKey, findHumanBySignIn } from "./organization.ts";

/** What the authorizer passes the API about a call: the one actor it is attributed to. */
export interface AuthorizerContext {
  actor: Actor;
}

/**
 * Verifies a human's access token and returns the sub of the Cognito user it carries.
 * Throws if the token isn't one the deployment trusts. In a deployment that is Cognito's; in
 * tests, a test issuer's.
 */
export type VerifyAccessToken = (token: string) => Promise<string>;

/**
 * The API's one Lambda authorizer. It resolves each call to exactly one actor, or refuses it with
 * 401: API Gateway answers 401 when the authorizer fails with "Unauthorized". An agent's key
 * resolves to that agent, and any other bearer token must be a human's access token, which resolves
 * through their Cognito user's sub to their actor. A mailbox agent's run token resolves to it while the run lasts.
 */
export function createAuthorizer({ table, verifyAccessToken }: { table: Table; verifyAccessToken: VerifyAccessToken }) {
  return async (event: APIGatewayRequestAuthorizerEventV2): Promise<APIGatewaySimpleAuthorizerWithContextResult<AuthorizerContext>> => {
    const token = /^Bearer (.+)$/i.exec(event.headers?.authorization ?? "")?.[1];
    const actor =
      token === undefined
        ? undefined
        : token.startsWith(agentKeyPrefix)
          ? await findAgentByKey(table, token)
          : token.startsWith(runTokenPrefix)
            ? await findAgentByRunToken(table, token)
            : await human(token);
    if (actor === undefined) throw new Error("Unauthorized");
    return { isAuthorized: true, context: { actor } };
  };

  async function human(token: string) {
    const sub = await verifyAccessToken(token).catch(() => undefined);
    return sub === undefined ? undefined : findHumanBySignIn(table, sub);
  }
}
