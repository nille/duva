// Who may do what in a mailbox. Every mailbox operation asks this one check, which answers from
// three relations (ADR-0015): the owner, the sponsor in its agent's mailbox, and the agent in its
// sponsor's mailbox with read or full sponsor access. No other actor reaches a mailbox.
import { type OperationHandler, refusal } from "./api.ts";
import type { Deployment } from "./deployment.ts";
import type { components } from "@duva/openapi";
import { type Actor, type AgentSettings, agentSettings, findActor, findMailbox, type Mailbox, ownedMailboxes, sponsoredAgents } from "./organization.ts";

/** What an operation does in a mailbox, which the actor needs to be allowed. */
export type Ability = "read" | "organize" | "trash" | "draft" | "send" | "emptyTrash";

// The sponsor acts as owner of its agent's mailbox, except that the agent drafts and sends there itself.
const sponsorAbilities: Ability[] = ["read", "organize", "trash", "emptyTrash"];

// What each sponsor access lets the agent do. Full does more once later releases let it.
const sponsorAccessAbilities: Record<AgentSettings["sponsorAccess"], Ability[]> = { none: [], read: ["read"], full: ["read"] };

// What the agent's refusal says it can't do, for each ability sponsor access can give.
const abilityWords: Record<Exclude<Ability, "emptyTrash">, string> = {
  read: "read your sponsor's mailbox",
  organize: "organize your sponsor's mailbox",
  trash: "move threads to Trash or back in your sponsor's mailbox",
  draft: "write or change drafts in your sponsor's mailbox",
  send: "send as your sponsor",
};

/**
 * The mailbox with the ID in the call's path, if the actor may do what the ability names there,
 * or a refusal that says what the actor is missing. Admins have no say here.
 */
export async function mailboxFor(
  event: Parameters<OperationHandler>[0],
  deployment: Deployment,
  actor: Actor,
  ability: Ability,
): Promise<Mailbox | ReturnType<typeof refusal>> {
  const id = event.pathParameters?.mailbox ?? "";
  const mailbox = await findMailbox(deployment.table, id);
  if (mailbox === undefined) return refusal(404, `There is no mailbox ${JSON.stringify(id)}. List the mailboxes you can read to find its ID.`);
  if (mailbox.owner === actor.id) return mailbox;
  if (actor.kind === "agent" && mailbox.owner === actor.sponsor) {
    const { sponsorAccess } = (await agentSettings(deployment.table, actor.id)).settings;
    if (sponsorAccessAbilities[sponsorAccess].includes(ability)) return mailbox;
    if (ability === "emptyTrash") return refusal(403, "Only your sponsor can empty their Trash. Ask them to.");
    if (sponsorAccess === "none") return refusal(403, "Your sponsor hasn't given you sponsor access to their mailbox. Ask them for read access.");
    if (sponsorAccess === "read") return refusal(403, `Your sponsor access is read, which doesn't let you ${abilityWords[ability]}. Ask your sponsor for full access.`);
    return refusal(403, `Full sponsor access doesn't let you ${abilityWords[ability]} yet. Ask your sponsor to do it.`);
  }
  const owner = await findActor(deployment.table, mailbox.owner);
  if (owner?.kind === "agent" && owner.sponsor === actor.id) {
    if (sponsorAbilities.includes(ability)) return mailbox;
    return refusal(403, "Only the mailbox's owner can write drafts in it and ask to send them. For an agent's mailbox, the agent's sponsor decides its sends in approvals.");
  }
  return refusal(403, "Only the mailbox's owner can read it, its sponsor if an agent owns it, and the agents its owner gives sponsor access.");
}

/**
 * The mailboxes the actor can read: its own, then for a human those of the agents they sponsor,
 * and for an agent with sponsor access its sponsor's, with that access.
 */
export async function mailboxesReadBy(deployment: Deployment, actor: Actor): Promise<components["schemas"]["ListedMailbox"][]> {
  const agents = actor.kind === "human" ? await sponsoredAgents(deployment.table, actor.id) : [];
  const owners = [actor.id, ...agents.map(({ id }) => id)];
  const mailboxes: components["schemas"]["ListedMailbox"][] = (await Promise.all(owners.map((owner) => ownedMailboxes(deployment.table, owner)))).flat();
  if (actor.kind === "agent") {
    const { sponsorAccess } = (await agentSettings(deployment.table, actor.id)).settings;
    if (sponsorAccess !== "none") mailboxes.push(...(await ownedMailboxes(deployment.table, actor.sponsor)).map((mailbox) => ({ ...mailbox, sponsorAccess })));
  }
  return mailboxes;
}
