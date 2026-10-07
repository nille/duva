// Who may do what in a mailbox. Every mailbox operation asks this one check, which answers from
// three relations (ADR-0015): the owner, the sponsor in its agent's mailbox, and the agent in the
// sponsor's mailboxes its sponsor access covers. No other actor reaches a mailbox.
import { type OperationHandler, refusal } from "./api.ts";
import type { Deployment } from "./deployment.ts";
import type { components } from "@duva/openapi";
import { groupsSentAsBy } from "./group-mail.ts";
import { type Actor, type AgentSettings, agentSettings, findActor, findMailbox, type Mailbox, ownedMailboxes, sponsoredAgents } from "./organization.ts";

/** What an operation does in a mailbox, which the actor needs to be allowed. */
export type Ability = "read" | "organize" | "trash" | "draft" | "send" | "emptyTrash" | "switchScreener";

// The sponsor acts as owner of its agent's mailbox, except that the agent drafts and sends there itself.
const sponsorAbilities: Ability[] = ["read", "organize", "trash", "emptyTrash", "switchScreener"];

type SponsorAccess = AgentSettings["sponsorAccess"];

// What each sponsor access lets the agent do, each all the one before does and more. Send lets it do
// all a sponsor does in their own mailbox but empty Trash.
const sponsorAccessAbilities: Record<SponsorAccess, Ability[]> = {
  none: [],
  read: ["read"],
  organize: ["read", "organize", "trash"],
  draft: ["read", "organize", "trash", "draft"],
  send: ["read", "organize", "trash", "draft", "send"],
};

// What the agent's refusal says it can't do, for each ability sponsor access can give, and the access that gives it.
const abilityWords: Record<Exclude<Ability, "emptyTrash" | "switchScreener">, { words: string; access: SponsorAccess }> = {
  read: { words: "read your sponsor's mailbox", access: "read" },
  organize: { words: "organize your sponsor's mailbox", access: "organize" },
  trash: { words: "move threads to Trash or back in your sponsor's mailbox", access: "organize" },
  draft: { words: "write or change drafts in your sponsor's mailbox", access: "draft" },
  send: { words: "send as your sponsor", access: "send" },
};

/** Whether the sponsor access lets the agent do what the ability names in its sponsor's mailbox. */
export const sponsorAccessAllows = (sponsorAccess: SponsorAccess, ability: Ability) => sponsorAccessAbilities[sponsorAccess].includes(ability);

/** The agent's sponsor access in its sponsor's mailbox with the ID: its access if its settings cover the mailbox, or none. */
export const sponsorAccessIn = ({ sponsorAccess, sponsorMailboxes }: Pick<AgentSettings, "sponsorAccess" | "sponsorMailboxes">, mailbox: string): SponsorAccess =>
  sponsorMailboxes === null || sponsorMailboxes.includes(mailbox) ? sponsorAccess : "none";

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
    const sponsorAccess = sponsorAccessIn((await agentSettings(deployment.table, actor.id)).settings, mailbox.id);
    if (sponsorAccessAllows(sponsorAccess, ability)) return mailbox;
    if (ability === "emptyTrash") return refusal(403, "Only your sponsor can empty their Trash. Ask them to.");
    if (ability === "switchScreener") return refusal(403, "Only your sponsor can switch their Screener. Ask them to.");
    if (sponsorAccess === "none") return refusal(403, "Your sponsor hasn't given you sponsor access to this mailbox of theirs. Ask them for read access.");
    const { words, access } = abilityWords[ability];
    return refusal(403, `Your sponsor access is ${sponsorAccess}, which doesn't let you ${words}. Ask your sponsor for ${access} access.`);
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
 * and for an agent with sponsor access its sponsor's, with that access. Each lists the groups its
 * owner can send as.
 */
export async function mailboxesReadBy(deployment: Deployment, actor: Actor): Promise<components["schemas"]["ListedMailbox"][]> {
  const agents = actor.kind === "human" ? await sponsoredAgents(deployment.table, actor.id) : [];
  const owners = [actor.id, ...agents.map(({ id }) => id)];
  const owned = async (owner: string) => {
    const groups = await groupsSentAsBy(deployment.table, owner);
    return (await ownedMailboxes(deployment.table, owner)).map((mailbox) => ({ ...mailbox, groups }));
  };
  const mailboxes: components["schemas"]["ListedMailbox"][] = (await Promise.all(owners.map(owned))).flat();
  if (actor.kind === "agent") {
    const { settings } = await agentSettings(deployment.table, actor.id);
    for (const mailbox of await owned(actor.sponsor)) {
      const sponsorAccess = sponsorAccessIn(settings, mailbox.id);
      if (sponsorAccess !== "none") mailboxes.push({ ...mailbox, sponsorAccess });
    }
  }
  return mailboxes;
}
