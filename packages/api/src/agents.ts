import type { components } from "@duva/openapi";
import { type OperationHandler, refusal } from "./api.ts";
import { addAgent, findActor, KeyChanged, replaceAgentKey, sponsoredAgents } from "./organization.ts";

export const createAgent: OperationHandler = async (event, deployment, actor) => {
  if (actor?.kind !== "human") return refusal(403, "Only humans can create agents. Ask your sponsor to create one.");
  const name = nameIn(event.body, event.isBase64Encoded);
  if (name === undefined) return refusal(400, "Give the agent a name of 1 to 64 characters.");
  const created = await addAgent(deployment.table, { name, sponsor: actor.id });
  return { statusCode: 201, body: created satisfies components["schemas"]["AgentWithKey"] };
};

export const listAgents: OperationHandler = async (_event, deployment, actor) => ({
  statusCode: 200,
  body: { agents: await sponsoredAgents(deployment.table, actor!.id) } satisfies components["schemas"]["AgentList"],
});

export const rotateAgentKey: OperationHandler = async (event, deployment, actor) => {
  const id = event.pathParameters?.agent ?? "";
  const agent = await findActor(deployment.table, id);
  if (agent?.kind !== "agent") return refusal(404, `There is no agent ${JSON.stringify(id)}. List the agents you sponsor to find its ID.`);
  if (agent.sponsor !== actor?.id) return refusal(403, "Only the agent's sponsor can rotate its key. Ask them to.");
  try {
    const key = await replaceAgentKey(deployment.table, { agent: agent.id, by: actor.id });
    return { statusCode: 200, body: { agent, key } satisfies components["schemas"]["AgentWithKey"] };
  } catch (error) {
    if (error instanceof KeyChanged) return refusal(409, "The agent's key was rotated at the same time. Rotate it again to get a key that works.");
    throw error;
  }
};

/** The agent's name from the body, trimmed, or undefined if the body gives none that fits. */
function nameIn(body: string | undefined, isBase64Encoded: boolean): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(isBase64Encoded ? Buffer.from(body ?? "", "base64").toString() : (body ?? ""));
  } catch {
    return undefined;
  }
  const name = (parsed as { name?: unknown } | null)?.name;
  if (typeof name !== "string") return undefined;
  const trimmed = name.trim();
  return trimmed.length >= 1 && trimmed.length <= 64 ? trimmed : undefined;
}
