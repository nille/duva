import type { components } from "@duva/openapi";
import { jsonBody, type OperationHandler, refusal } from "./api.ts";
import { sponsorAccessAllows } from "./access.ts";
import { withdrawPendingApprovals } from "./drafting.ts";
import { syncRecipients } from "./receiving.ts";
import { removeAgentWithMailboxes } from "./removal.ts";
import {
  addAgent,
  type Agent,
  type AgentSettings,
  agentSettings,
  changeAgentSettings as changeStoredSettings,
  defaultAgentSettings,
  findActor,
  KeyChanged,
  NowhereToRecord,
  ownedMailboxes,
  replaceAgentKey,
  sponsoredAgents,
} from "./organization.ts";

export const createAgent: OperationHandler = async (event, deployment, actor) => {
  if (actor?.kind !== "human") return refusal(403, "Only humans can create agents. Ask your sponsor to create one.");
  const name = nameIn(jsonBody(event));
  if (name === undefined) return refusal(400, "Give the agent a name of 1 to 64 characters.");
  const created = await addAgent(deployment.table, { name, sponsor: actor.id });
  return { statusCode: 201, body: created satisfies components["schemas"]["AgentWithKey"] };
};

export const listAgents: OperationHandler = async (_event, deployment, actor) => ({
  statusCode: 200,
  body: { agents: await sponsoredAgents(deployment.table, actor!.id) } satisfies components["schemas"]["AgentList"],
});

export const rotateAgentKey: OperationHandler = async (event, deployment, actor) => {
  const agent = await agentAsked(event, deployment);
  if ("statusCode" in agent) return agent;
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
function nameIn(body: Record<string, unknown> | undefined): string | undefined {
  const name = body?.name;
  if (typeof name !== "string") return undefined;
  const trimmed = name.trim();
  return trimmed.length >= 1 && trimmed.length <= 64 ? trimmed : undefined;
}

export const getAgentSettings: OperationHandler = async (event, deployment, actor) => {
  const agent = await agentAsked(event, deployment);
  if ("statusCode" in agent) return agent;
  if (actor!.id !== agent.sponsor && actor!.id !== agent.id) return refusal(403, "Only the agent's sponsor and the agent can read its settings. Ask its sponsor.");
  const { settings } = await agentSettings(deployment.table, agent.id);
  return { statusCode: 200, body: settings satisfies components["schemas"]["AgentSettings"] };
};

export const changeAgentSettings: OperationHandler = async (event, deployment, actor) => {
  const agent = await agentAsked(event, deployment);
  if ("statusCode" in agent) return agent;
  if (actor!.id !== agent.sponsor) return refusal(403, "Only the agent's sponsor can change its settings. Ask them to.");
  const body = jsonBody(event) ?? {};
  const names = Object.keys(defaultAgentSettings);
  const unknown = Object.keys(body).find((name) => !names.includes(name));
  if (unknown !== undefined) return refusal(400, `An agent has no setting ${JSON.stringify(unknown)}. Its settings are ${names.join(", ")}.`);
  if (Object.keys(body).length === 0) return refusal(400, `Give a setting to change: ${names.join(", ")}.`);
  const { sponsorAccess, ...switches } = body;
  if (sponsorAccess !== undefined && !sponsorAccesses.includes(sponsorAccess as AgentSettings["sponsorAccess"])) {
    return refusal(400, `Give sponsorAccess as ${sponsorAccesses.slice(0, -1).join(", ")} or ${sponsorAccesses.at(-1)}.`);
  }
  const notOnOrOff = Object.entries(switches).find(([, value]) => typeof value !== "boolean");
  if (notOnOrOff !== undefined) return refusal(400, `Give ${notOnOrOff[0]} as true to turn it on, or false to turn it off.`);
  try {
    const settings = await changeStoredSettings(deployment.table, { agent, changes: body as Partial<AgentSettings> });
    // Without full access the agent can't send as its sponsor, so what waits for that is withdrawn.
    // Each change does it, so a change again finishes what one that stopped partway left.
    if (!sponsorAccessAllows(settings.sponsorAccess, "send")) {
      const mailboxes = (await ownedMailboxes(deployment.table, agent.sponsor)).map(({ id }) => id);
      await withdrawPendingApprovals(deployment.table, { agent, mailboxes });
    }
    return { statusCode: 200, body: settings satisfies components["schemas"]["AgentSettings"] };
  } catch (error) {
    if (error instanceof NowhereToRecord) {
      return refusal(409, "Neither you nor the agent has a mailbox, whose change feed would record the change. Ask an admin to create one for you first.");
    }
    throw error;
  }
};

const sponsorAccesses: AgentSettings["sponsorAccess"][] = ["none", "read", "full"];

/** The agent the call's path names, or a refusal if there is none. */
async function agentAsked(event: Parameters<OperationHandler>[0], deployment: Parameters<OperationHandler>[1]): Promise<Agent | ReturnType<typeof refusal>> {
  const id = event.pathParameters?.agent ?? "";
  const agent = await findActor(deployment.table, id);
  if (agent?.kind !== "agent") return refusal(404, `There is no agent ${JSON.stringify(id)}. List the agents you sponsor to find its ID.`);
  return agent;
}

export const removeAgent: OperationHandler = async (event, deployment, actor) => {
  const agent = await agentAsked(event, deployment);
  if ("statusCode" in agent) return agent;
  if (actor!.id !== agent.sponsor && !actor!.admin) return refusal(403, "Only the agent's sponsor and admins can remove it. Ask its sponsor.");
  const mailboxes = await removeAgentWithMailboxes(deployment, { agent, by: actor!.id });
  await syncRecipients(deployment.table, deployment.receiving);
  return { statusCode: 200, body: { agent, mailboxes } satisfies components["schemas"]["AgentRemoval"] };
};
