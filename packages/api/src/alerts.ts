import type { components } from "@duva/openapi";
import { alertsPage, seeAlerts, unseenAlerts } from "./alerting.ts";
import { jsonBody, type OperationHandler, refusal } from "./api.ts";

export const listAlerts: OperationHandler = async (event, deployment, actor) => {
  const { agent: asked, limit: givenLimit = "100", after } = event.queryStringParameters ?? {};
  if (!/^\d+$/.test(givenLimit) || Number(givenLimit) < 1 || Number(givenLimit) > 100) return refusal(400, "Give limit as a whole number from 1 to 100.");
  // An agent's alerts are its sponsor's, so it lists those about itself.
  const [sponsor, agent] = actor!.kind === "agent" ? [actor!.sponsor, actor!.id] : [actor!.id, asked];
  const page = await alertsPage(deployment.table, sponsor, { agent, limit: Number(givenLimit), after });
  return { statusCode: 200, body: page satisfies components["schemas"]["AlertList"] };
};

export const markAlertsSeen: OperationHandler = async (event, deployment, actor) => {
  if (actor!.kind !== "human") return refusal(403, "Only the agent's sponsor marks its alerts seen. Ask your sponsor.");
  const ids = jsonBody(event)?.alerts;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 100 || !ids.every((id) => typeof id === "string")) return refusal(400, "Give alerts as a list of 1 to 100 alert IDs.");
  await seeAlerts(deployment.table, actor!.id, ids);
  return { statusCode: 200, body: { unseen: await unseenAlerts(deployment.table, actor!.id) } satisfies components["schemas"]["UnseenAlerts"] };
};
