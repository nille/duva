import type { OperationHandler } from "./operation-handler.ts";
import { recoveryAddressOf } from "./sign-in-links.ts";

export const whoami: OperationHandler = async (_event, deployment, actor) => {
  // Only a human sees their own recovery address here.
  const recoveryAddress = actor?.kind === "human" ? await recoveryAddressOf(deployment.table, actor.id) : undefined;
  return { statusCode: 200, body: { ...actor, ...(recoveryAddress !== undefined && { recoveryAddress }) } };
};
