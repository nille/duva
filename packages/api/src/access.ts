// Who may do what in a mailbox. Every mailbox operation asks this one check, which answers from
// two relations (ADR-0015, ADR-0030): the owner, a human, and the agent in its sponsor's mailboxes
// its sponsor access covers. No other actor reaches a mailbox.
import { type OperationHandler, refusal } from "./api.ts";
import type { Deployment } from "./deployment.ts";
import type { components } from "@duva/openapi";
import { groupsSentAsBy } from "./group-mail.ts";
import { type Actor, type AgentSettings, agentSettings, findMailbox, type Mailbox, ownedMailboxes } from "./organization.ts";

/** What an operation does in a mailbox, which the actor needs to be allowed. */
export type Ability = "read" | "organize" | "trash" | "draft" | "send" | "emptyTrash" | "erase" | "switchScreener";

type SponsorAccess = AgentSettings["sponsorAccess"];

// What each sponsor access lets the agent do, each all the one before does and more. Send lets it do
// all a sponsor does in their own mailbox but empty Trash, erase a sender's mail and switch the Screener.
const sponsorAccessAbilities: Record<SponsorAccess, Ability[]> = {
  none: [],
  read: ["read"],
  organize: ["read", "organize", "trash"],
  draft: ["read", "organize", "trash", "draft"],
  send: ["read", "organize", "trash", "draft", "send"],
};

// What the agent's refusal says it can't do, for each ability sponsor access can give, and the access that gives it.
const abilityWords: Record<Exclude<Ability, "emptyTrash" | "erase" | "switchScreener">, { words: string; access: SponsorAccess }> = {
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
  if (actor.kind === "human" && mailbox.owner === actor.id) return mailbox;
  if (actor.kind === "agent" && mailbox.owner === actor.sponsor) {
    const sponsorAccess = sponsorAccessIn((await agentSettings(deployment.table, actor.id)).settings, mailbox.id);
    if (sponsorAccessAllows(sponsorAccess, ability)) return mailbox;
    if (ability === "emptyTrash") return refusal(403, "Only your sponsor can empty their Trash. Ask them to.");
    if (ability === "erase") return refusal(403, "Only your sponsor can send a sender's mail nowhere, since that erases it. Ask them to, or choose another delivery.");
    if (ability === "switchScreener") return refusal(403, "Only your sponsor can switch their Screener. Ask them to.");
    if (sponsorAccess === "none") return refusal(403, "Your sponsor hasn't given you sponsor access to this mailbox of theirs. Ask them for read access.");
    const { words, access } = abilityWords[ability];
    return refusal(403, `Your sponsor access is ${sponsorAccess}, which doesn't let you ${words}. Ask your sponsor for ${access} access.`);
  }
  return refusal(403, "Only the mailbox's owner can read it, and the agents its owner gives sponsor access.");
}

/**
 * The mailboxes the actor can read: a human's own, or an agent's sponsor's that its sponsor
 * access covers, with that access. Each lists the groups its owner can send as.
 */
export async function mailboxesReadBy(deployment: Deployment, actor: Actor): Promise<components["schemas"]["ListedMailbox"][]> {
  const owned = async (owner: string) => {
    const groups = await groupsSentAsBy(deployment.table, owner);
    return (await ownedMailboxes(deployment.table, owner)).map((mailbox) => ({ ...mailbox, groups }));
  };
  if (actor.kind === "human") return owned(actor.id);
  const { settings } = await agentSettings(deployment.table, actor.id);
  return (await owned(actor.sponsor)).flatMap((mailbox) => {
    const sponsorAccess = sponsorAccessIn(settings, mailbox.id);
    return sponsorAccess === "none" ? [] : [{ ...mailbox, sponsorAccess }];
  });
}
