import type { components } from "@duva/openapi";
import { jsonBody, type OperationHandler, refusal } from "./api.ts";
import { sponsorAccessAllows } from "./access.ts";
import { actorNamed, alertWrites, raiseAlert } from "./alerting.ts";
import { releaseHeldSends, withdrawPendingApprovals } from "./drafting.ts";
import type { Table } from "./deployment.ts";
import { syncRecipients } from "./receiving.ts";
import { removeAgentWithMailboxes } from "./removal.ts";
import { sendsLeft } from "./limits.ts";
import { isLimit } from "./settings.ts";
import { setupOperation, takeAgentAdminAway } from "./setup.ts";
import {
  type Actor,
  addAgent,
  type Agent,
  type AgentSettings,
  agentSettings,
  allHumans,
  changeAgentAdmin,
  changeAgentSettings as changeStoredSettings,
  defaultAgentSettings,
  duva,
  findActor,
  KeyChanged,
  NowhereToRecord,
  OverCap,
  ownedMailboxes,
  limitCaps,
  pauseAgent as pause,
  replaceAgentKey,
  SponsorNotAdmin,
  sponsoredAgents,
  unpauseAgent as unpause,
} from "./organization.ts";

export const createAgent: OperationHandler = async (event, deployment, actor) => {
  if (actor?.kind !== "human") return refusal(403, "Only humans can create agents. Ask your sponsor to create one.");
  const name = nameIn(jsonBody(event));
  if (name === undefined) return refusal(400, "Give the agent a name of 1 to 64 characters.");
  const created = await addAgent(deployment.table, { name, sponsor: actor.id });
  return { statusCode: 201, body: created satisfies components["schemas"]["AgentWithKey"] };
};

export const listAgents: OperationHandler = async (_event, deployment, actor) => {
  const now = new Date();
  const agents = await Promise.all(
    (await sponsoredAgents(deployment.table, actor!.id)).map(async (agent) => ({ ...agent, sendsLeftThisHour: await sendsLeft(deployment.table, agent.id, now) })),
  );
  return { statusCode: 200, body: { agents } satisfies components["schemas"]["AgentList"] };
};

export const listOrganizationAgents: OperationHandler = async (_event, deployment, actor) => {
  if (!actor?.admin) return refusal(403, "Only admins can list the organization's agents. List the agents you sponsor with agents list.");
  // Every agent has a human sponsor, since a removed human's agents go with them (ADR-0020).
  const agents = (await Promise.all((await allHumans(deployment.table)).map(({ id }) => sponsoredAgents(deployment.table, id)))).flat();
  return { statusCode: 200, body: { agents } satisfies components["schemas"]["AgentList"] };
};

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
  const { sponsorAccess, sendsPerHour, newRecipientsPerDay, ...switches } = body;
  if (sponsorAccess !== undefined && !sponsorAccesses.includes(sponsorAccess as AgentSettings["sponsorAccess"])) {
    return refusal(400, `Give sponsorAccess as ${sponsorAccesses.slice(0, -1).join(", ")} or ${sponsorAccesses.at(-1)}.`);
  }
  const notLimit = Object.entries({ sendsPerHour, newRecipientsPerDay }).find(([, value]) => value !== undefined && !isLimit(value));
  if (notLimit !== undefined) return refusal(400, `Give ${notLimit[0]} as a whole number from 1 up to the organization's cap.`);
  const notOnOrOff = Object.entries(switches).find(([, value]) => typeof value !== "boolean");
  if (notOnOrOff !== undefined) return refusal(400, `Give ${notOnOrOff[0]} as true to turn it on, or false to turn it off.`);
  try {
    const settings = await changeStoredSettings(deployment.table, { agent, changes: body as Partial<AgentSettings> });
    // A higher limit may let sends that wait for it go out.
    if (sendsPerHour !== undefined || newRecipientsPerDay !== undefined) await deployment.waitingSends.release(agent.id);
    // Without full access the agent can't send as its sponsor, so what waits for that is withdrawn.
    // Each change does it, so a change again finishes what one that stopped partway left.
    if (!sponsorAccessAllows(settings.sponsorAccess, "send")) {
      const mailboxes = (await ownedMailboxes(deployment.table, agent.sponsor)).map(({ id }) => id);
      await withdrawPendingApprovals(deployment.table, { agent, mailboxes });
    }
    return { statusCode: 200, body: settings satisfies components["schemas"]["AgentSettings"] };
  } catch (error) {
    if (error instanceof OverCap) {
      return refusal(400, `${error.limit} can be at most the organization's cap of ${error.cap}. Ask an admin to raise ${limitCaps[error.limit]}.`);
    }
    if (error instanceof NowhereToRecord) {
      return refusal(409, "Neither you nor the agent has a mailbox, whose change feed would record the change. Ask an admin to create one for you first.");
    }
    throw error;
  }
};

type Pause = components["schemas"]["Pause"];

const sponsorAccesses: AgentSettings["sponsorAccess"][] = ["none", "read", "full"];

/** The agent the call's path names, or a refusal if there is none. */
async function agentAsked(event: Parameters<OperationHandler>[0], deployment: Parameters<OperationHandler>[1]): Promise<Agent | ReturnType<typeof refusal>> {
  const id = event.pathParameters?.agent ?? "";
  const agent = await findActor(deployment.table, id);
  if (agent?.kind !== "agent") return refusal(404, `There is no agent ${JSON.stringify(id)}. List the agents you sponsor to find its ID.`);
  return agent;
}

/** Whether the actor answers for the agent: its sponsor or an admin, who may remove and pause it. */
const sponsorOrAdmin = (actor: Actor, agent: Agent) => actor.id === agent.sponsor || actor.admin;

export const removeAgent: OperationHandler = async (event, deployment, actor) => {
  // Not even with approval, since removal erases another sponsor's mailboxes for good.
  if (actor!.kind === "agent") return refusal(403, "Agents can't remove agents, even with approval. Ask the agent's sponsor or a human admin.");
  const agent = await agentAsked(event, deployment);
  if ("statusCode" in agent) return agent;
  if (!sponsorOrAdmin(actor!, agent)) return refusal(403, "Only the agent's sponsor and admins can remove it. Ask its sponsor.");
  const alert = await alertUnlessSponsor(deployment.table, actor!, agent, "removedBy", (who) => ({
    what: `${who} removed ${agent.name}, with its mailboxes.`,
    urgent: `${agent.name} was removed by ${who}`,
  }));
  const mailboxes = await removeAgentWithMailboxes(deployment, { agent, by: actor!.id, items: alert });
  await syncRecipients(deployment.table, deployment.receiving);
  return { statusCode: 200, body: { agent, mailboxes } satisfies components["schemas"]["AgentRemoval"] };
};

/** The agent as a preview names it, with its sponsor. */
async function agentNamed(table: Table, agent: Agent): Promise<string> {
  const sponsor = await findActor(table, agent.sponsor);
  return `the agent ${agent.name}, whose sponsor is ${sponsor?.kind === "human" ? sponsor.email : "removed"}`;
}

export const changeAgent: OperationHandler = async (event, deployment, actor) => {
  // Not even with approval, so people stay in charge of who is an admin.
  if (actor!.kind === "agent") return refusal(403, "Agents can't change who is an admin, even with approval. Ask the agent's sponsor.");
  const agent = await agentAsked(event, deployment);
  if ("statusCode" in agent) return agent;
  if (actor!.id !== agent.sponsor) return refusal(403, "Only the agent's sponsor can make it an admin or take it away. Ask them to.");
  const admin = jsonBody(event)?.admin;
  if (typeof admin !== "boolean") return refusal(400, "Give admin as true to make the agent an admin, or false to take it away.");
  const notAdmin = refusal(403, "Only an admin can make their agent an admin, and you aren't one. Ask an admin to make you one first.");
  if (admin && !actor!.admin) return notAdmin;
  let changed: Agent | undefined;
  try {
    // Taking it away withdraws its setup changes still waiting.
    changed = await (admin ? changeAgentAdmin(deployment.table, { agent, admin, by: actor!.id }) : takeAgentAdminAway(deployment.table, { agent, by: actor!.id }));
  } catch (error) {
    if (error instanceof SponsorNotAdmin) return notAdmin;
    throw error;
  }
  return changed === undefined ? removedMeanwhile(agent) : { statusCode: 200, body: changed satisfies components["schemas"]["Agent"] };
};

export const pauseAgent = setupOperation("pauseAgent", async (event, deployment, actor) => {
  const agent = await agentAsked(event, deployment);
  if ("statusCode" in agent) return agent;
  // An agent admin pauses other agents, and its sponsor pauses it.
  if (!sponsorOrAdmin(actor, agent) || actor.id === agent.id) return refusal(403, "Only the agent's sponsor and admins can pause it. Ask its sponsor.");
  return {
    preview:
      agent.paused !== undefined
        ? []
        : [`Pauses ${await agentNamed(deployment.table, agent)}. Its key is refused and its approved sends are held until a human unpauses it.`],
    run: async () => {
      const alert = await alertUnlessSponsor(deployment.table, actor, agent, "pausedBy", (who) => ({
        what: `${who} paused ${agent.name}. Its approved sends are held, and unpausing sends them.`,
        urgent: `${agent.name} was paused by ${who}`,
      }));
      const paused = await pause(deployment.table, { agent, by: actor.id, items: alert });
      return paused === undefined ? removedMeanwhile(agent) : { statusCode: 200, body: paused satisfies components["schemas"]["Agent"] };
    },
  };
});

export const unpauseAgent: OperationHandler = async (event, deployment, actor) => {
  const agent = await agentAsked(event, deployment);
  if ("statusCode" in agent) return agent;
  // Only a human unpauses, so no agent admin undoes a pause, Duva's included (ADR-0021).
  if (actor!.kind !== "human" || !sponsorOrAdmin(actor!, agent)) return refusal(403, "Only the agent's sponsor and human admins can unpause it. Ask its sponsor.");
  const unpaused = await unpause(deployment.table, { agent, by: actor!.id });
  if (unpaused === undefined) return removedMeanwhile(agent);
  // Each unpause releases what is held, so unpausing again finishes what one that stopped partway left.
  await releaseHeldSends(deployment.table, agent);
  await deployment.waitingSends.release(agent.id);
  return { statusCode: 200, body: unpaused satisfies components["schemas"]["Agent"] };
};

/**
 * The writes of the urgent alert to the agent's sponsor that the actor paused or removed it, to
 * write with what it did, or none if the actor is its sponsor, who knows.
 */
async function alertUnlessSponsor(table: Table, actor: Actor, agent: Agent, kind: "pausedBy" | "removedBy", did: (who: string) => { what: string; urgent: string }) {
  if (actor.id === agent.sponsor) return [];
  return alertWrites(table, { kind, agent, by: actor.id, ...did(await actorNamed(table, actor.id)) });
}

const removedMeanwhile = (agent: Agent) => refusal(404, `The agent ${JSON.stringify(agent.id)} was removed meanwhile.`);

/** The answer to every call with a paused agent's key, naming who paused it. The first call of each pause is an alert to its sponsor. */
export async function pausedRefusal(table: Table, agent: Agent & { paused: Pause }) {
  const what = `${agent.name}'s key was used while it is paused, and Duva refused it.`;
  await raiseAlert(table, { kind: "keyUsedWhilePaused", agent, what }, { source: `key-used#${agent.id}#${agent.paused.at}` });
  return refusal(403, `This agent is paused by ${await actorNamed(table, agent.paused.by)}. Ask its sponsor to unpause it.`);
}
