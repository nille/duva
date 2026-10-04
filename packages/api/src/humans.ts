import type { components } from "@duva/openapi";
import { jsonBody, type OperationHandler, refusal } from "./api.ts";
import { isEmailAddress } from "./email-address.ts";
import { addHumanToOrganization, allHumans, HumanExists } from "./organization.ts";

export const addHuman: OperationHandler = async (event, deployment, actor) => {
  if (!actor?.admin) return refusal(403, "Only admins can add humans. Ask an admin to add them.");
  const body = jsonBody(event);
  const given = typeof body?.email === "string" ? body.email.trim() : "";
  // Addresses are kept in lower case, so one human never gets two actors by case alone.
  const email = given.toLowerCase();
  if (!isEmailAddress(email) || email.length > 254) {
    return refusal(400, `${JSON.stringify(given)} isn't an email address. Give the address the human will sign in with, like grace@example.com.`);
  }
  try {
    const human = await addHumanToOrganization(deployment, { email, by: actor.id });
    return { statusCode: 201, body: human satisfies components["schemas"]["Human"] };
  } catch (error) {
    if (!(error instanceof HumanExists)) throw error;
    return refusal(409, `${email} is already a human in the organization. List the humans to find their ID.`);
  }
};

export const listHumans: OperationHandler = async (_event, deployment, actor) => {
  if (!actor?.admin) return refusal(403, "Only admins can list the organization's humans. Ask an admin who has access.");
  return { statusCode: 200, body: { humans: await allHumans(deployment.table) } satisfies components["schemas"]["HumanList"] };
};
