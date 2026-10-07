import type { components } from "@duva/openapi";
import { type OperationHandler, refusal } from "./api.ts";
import { isAdmin, organizationChanges } from "./organization.ts";

export const listOrganizationChanges: OperationHandler = async (event, deployment, actor) => {
  if (!isAdmin(actor)) return refusal(403, "Only admins can read the organization's change feed.");
  const given = event.queryStringParameters?.after ?? "0";
  if (!/^\d+$/.test(given)) return refusal(400, `${JSON.stringify(given)} isn't a position. Give after as a whole number from 0.`);
  const after = Number(given);
  const changes = await organizationChanges(deployment.table, after);
  return {
    statusCode: 200,
    body: { changes, position: changes.at(-1)?.position ?? after } satisfies components["schemas"]["ChangePage"],
  };
};
