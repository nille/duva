// Removing actors and deleting mailboxes (ADR-0020). A deleted mailbox's addresses go at once, in
// the transaction that lists it for the eraser, which erases its mail as emptying Trash does.
import type { Deployment, Table } from "./deployment.ts";
import { withdrawPendingApprovals } from "./drafting.ts";
import { mailboxErasure } from "./erasure.ts";
import { forgetMailboxLogo } from "./own-logos.ts";
import { syncRecipients } from "./receiving.ts";
import { type Agent, allMailboxes, deleteMailbox, duva, findActor, findMailbox, type Mailbox, ownedMailboxes, removeAgentFromOrganization } from "./organization.ts";
import type { TransactItem } from "./table.ts";

/** Deletes the mailbox, on behalf of the actor `by`, and hands it to the eraser. */
async function eraseMailbox({ table, eraser }: Pick<Deployment, "table" | "eraser">, mailbox: string, by: string): Promise<void> {
  const deleted = { mailbox, by };
  await deleteMailbox(table, { mailbox, by, items: [mailboxErasure(table, deleted)] });
  await eraser.eraseMailbox(deleted);
}

/**
 * Deletes the mailboxes, on behalf of the actor `by`, and hands each to the eraser. The receipt
 * rule follows its addresses once the caller syncs it.
 */
export async function deleteMailboxes(deployment: Deployment, { mailboxes, by }: { mailboxes: Mailbox[]; by: string }): Promise<void> {
  for (const mailbox of mailboxes) {
    await eraseMailbox(deployment, mailbox.id, by);
    await forgetMailboxLogo(deployment, mailbox.id);
  }
}

/**
 * Removes the agent, on behalf of the actor `by`: its sends waiting for approval are withdrawn,
 * and its key stops working, with the `items` written as it stops.
 */
export async function removeAgentWithApprovals(table: Table, { agent, by, items = [] }: { agent: Agent; by: string; items?: TransactItem[] }): Promise<void> {
  const mailboxes = await ownedMailboxes(table, agent.sponsor);
  await withdrawPendingApprovals(table, { agent, mailboxes: mailboxes.map(({ id }) => id), by });
  await removeAgentFromOrganization(table, { agent, by, items });
}

/** The mailboxes agents own, each with its agent, as before the setup that erases them. */
export async function agentsMailboxes(table: Table): Promise<{ mailbox: Mailbox; agent: Agent }[]> {
  const owned: { mailbox: Mailbox; agent: Agent }[] = [];
  for (const id of await allMailboxes(table)) {
    const mailbox = await findMailbox(table, id);
    const owner = mailbox === undefined ? undefined : await findActor(table, mailbox.owner);
    if (owner?.kind === "agent") owned.push({ mailbox: mailbox!, agent: owner });
  }
  return owned;
}

/**
 * Erases every mailbox an agent owns, as the setup after the deploy that stops agents owning
 * mailboxes does (ADR-0030): Duva withdraws the agent's sends waiting there, deletes the mailbox,
 * which frees its addresses and takes them out of the groups they were members of, and has the
 * eraser erase its mail and index. Each is recorded in the organization's change feed under Duva.
 * Run again, it finishes what a run left.
 */
export async function eraseAgentsMailboxes(deployment: Pick<Deployment, "table" | "eraser" | "receiving">): Promise<void> {
  const { table } = deployment;
  for (const { mailbox, agent } of await agentsMailboxes(table)) {
    await withdrawPendingApprovals(table, { agent, mailboxes: [mailbox.id], by: duva });
    // An agent's mailbox has no logo of its own, which only a human sets.
    await eraseMailbox(deployment, mailbox.id, duva);
  }
  // Each run syncs the receipt rules, so one that stopped before syncing them is finished.
  await syncRecipients(table, deployment.receiving);
}
