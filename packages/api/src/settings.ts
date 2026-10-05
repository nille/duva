import type { components } from "@duva/openapi";
import { jsonBody, type OperationHandler, refusal } from "./api.ts";
import { changeSettings, defaultSettings, organizationSettings, type OrganizationSettings } from "./organization.ts";

export const getOrganizationSettings: OperationHandler = async (_event, deployment) => {
  const { settings } = await organizationSettings(deployment.table);
  return { statusCode: 200, body: settings satisfies components["schemas"]["OrganizationSettings"] };
};

export const changeOrganizationSettings: OperationHandler = async (event, deployment, actor) => {
  if (!actor?.admin) return refusal(403, "Only admins can change the organization's settings. Ask an admin to change them.");
  const body = jsonBody(event) ?? {};
  const names = Object.keys(defaultSettings);
  const unknown = Object.keys(body).find((name) => !names.includes(name));
  if (unknown !== undefined) return refusal(400, `The organization has no setting ${JSON.stringify(unknown)}. Its settings are ${names.join(", ")}.`);
  if (Object.keys(body).length === 0) return refusal(400, `Give a setting to change: ${names.join(", ")}.`);
  const notOnOrOff = Object.entries(body).find(([, value]) => typeof value !== "boolean");
  if (notOnOrOff !== undefined) return refusal(400, `Give ${notOnOrOff[0]} as true to turn it on, or false to turn it off.`);
  const settings = await changeSettings(deployment.table, { by: actor.id, changes: body as Partial<OrganizationSettings> });
  return { statusCode: 200, body: settings satisfies components["schemas"]["OrganizationSettings"] };
};
