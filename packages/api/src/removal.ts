// Removing actors and deleting mailboxes (ADR-0020). A deleted mailbox's addresses go at once, in
// the transaction that lists it for the eraser, which erases its mail as emptying Trash does.
import type { Deployment } from "./deployment.ts";
import { withdrawPendingApprovals } from "./drafting.ts";
import { mailboxErasure } from "./erasure.ts";
import { withdrawSetupApprovals } from "./setup.ts";
import { type Agent, deleteMailbox, type Mailbox, ownedMailboxes, removeAgentFromOrganization } from "./organization.ts";
import type { TransactItem } from "./table.ts";

/**
 * Deletes the mailboxes, on behalf of the actor `by`, and hands each to the eraser. The receipt
 * rule follows its addresses once the caller syncs it.
 */
export async function deleteMailboxes(deployment: Deployment, { mailboxes, by }: { mailboxes: Mailbox[]; by: string }): Promise<void> {
  for (const mailbox of mailboxes) {
    const deleted = { mailbox: mailbox.id, by };
    await deleteMailbox(deployment.table, { mailbox: mailbox.id, by, items: [mailboxErasure(deployment.table, deleted)] });
    await deployment.eraser.eraseMailbox(deleted);
  }
}

/**
 * Removes the agent, on behalf of the actor `by`: its sends and setup changes waiting for approval are withdrawn,
 * its mailboxes deleted and its key stops working, with the `items` written as it stops. Returns
 * its mailboxes.
 */
export async function removeAgentWithMailboxes(deployment: Deployment, { agent, by, items = [] }: { agent: Agent; by: string; items?: TransactItem[] }): Promise<Mailbox[]> {
  const mailboxes = await ownedMailboxes(deployment.table, agent.id);
  const sponsors = await ownedMailboxes(deployment.table, agent.sponsor);
  await withdrawPendingApprovals(deployment.table, { agent, mailboxes: [...mailboxes, ...sponsors].map(({ id }) => id), by });
  await withdrawSetupApprovals(deployment.table, { agent, by });
  await deleteMailboxes(deployment, { mailboxes, by });
  await removeAgentFromOrganization(deployment.table, { agent, by, items });
  return mailboxes;
}
