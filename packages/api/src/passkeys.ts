// A human's passkeys, which managed login registers and signs them in with (ADR-0041). Cognito
// lists and removes them only with the human's own access token, with no admin form, so the API
// passes on the one the call came with (docs/aws.md).
import type { components } from "@duva/openapi";
import { bearerToken } from "./authorizer.ts";
import { type OperationHandler, refusal } from "./operation-handler.ts";
import { NoPasskeyAccess } from "./user-pool.ts";

/** The human's access token the call came with, or undefined for an agent, which has no passkeys. */
const humansToken = (event: Parameters<OperationHandler>[0], actor: Parameters<OperationHandler>[2]) =>
  actor?.kind === "human" ? bearerToken(event.headers.authorization) : undefined;

const agentsHaveNone = refusal(403, "Only humans have passkeys, and each manages their own in Settings.");
const signInAgain = refusal(403, "This session started before passkeys, so it can't manage them. Sign out and sign in again.");

/** The answer of a call to Cognito with the token, or the refusal for a token from before passkeys. */
async function withAccess<Answer>(call: () => Promise<Answer>): Promise<Answer | ReturnType<typeof refusal>> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof NoPasskeyAccess) return signInAgain;
    throw error;
  }
}

export const listPasskeys: OperationHandler = async (event, deployment, actor) => {
  const token = humansToken(event, actor);
  if (token === undefined) return agentsHaveNone;
  const passkeys = await withAccess(() => deployment.humans.passkeys(token));
  if ("statusCode" in passkeys) return passkeys;
  return { statusCode: 200, body: { passkeys } satisfies components["schemas"]["PasskeyList"] };
};

export const removePasskey: OperationHandler = async (event, deployment, actor) => {
  const token = humansToken(event, actor);
  if (token === undefined) return agentsHaveNone;
  const id = event.pathParameters?.passkey ?? "";
  const removed = await withAccess(() => deployment.humans.removePasskey(token, id));
  if (typeof removed !== "boolean") return removed;
  if (!removed) return refusal(404, `You have no passkey ${JSON.stringify(id)}. List your passkeys to find its ID.`);
  const passkeys = await withAccess(() => deployment.humans.passkeys(token));
  if ("statusCode" in passkeys) return passkeys;
  return { statusCode: 200, body: { passkeys } satisfies components["schemas"]["PasskeyList"] };
};
