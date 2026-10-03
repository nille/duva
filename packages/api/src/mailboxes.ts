import type { components } from "@duva/openapi";
import { jsonBody, type OperationHandler, refusal } from "./api.ts";
import type { Deployment } from "./deployment.ts";
import { type Actor, AddressTaken, addMailbox, allAddresses, findActor, findMailbox, type Mailbox, organizationDomain, ownedMailboxes, sponsoredAgents } from "./organization.ts";
import { inbox, mailboxChanges, readThread, threadsWithLabel } from "./mail.ts";
import { syncRecipients } from "./receiving.ts";

/** How many addresses the organization can have: SES's limit on one receipt rule's recipients. */
const maxAddresses = 500;

export const createMailbox: OperationHandler = async (event, deployment, actor) => {
  if (!actor?.admin) return refusal(403, "Only admins can create mailboxes. Ask an admin to create one.");
  const body = jsonBody(event);
  const ownerId = typeof body?.owner === "string" ? body.owner : "";
  const owner = await findActor(deployment.table, ownerId);
  if (owner === undefined) return refusal(400, `There is no agent ${JSON.stringify(ownerId)}. Give the ID of the agent that will own the mailbox.`);
  if (owner.kind !== "agent") return refusal(400, "For now only agents can have mailboxes. Give an agent's ID as the owner.");

  const given = typeof body?.address === "string" ? body.address.trim() : "";
  const domain = await organizationDomain(deployment.table);
  const address = given.toLowerCase();
  const at = address.lastIndexOf("@");
  const local = address.slice(0, at);
  if (at < 0 || local === "" || address.slice(at + 1) !== domain) {
    return refusal(400, `${JSON.stringify(given)} isn't an address on ${domain}. Give one like hermes@${domain}.`);
  }
  if (local.includes("+")) {
    return refusal(400, `An address can't have a plus tag. Give ${local.split("+")[0]}@${domain}, and mail to its tagged addresses reaches it too.`);
  }
  // Letters, digits and . _ -, with no dot at either end or two in a row, which every mail server takes.
  if (!/^[a-z0-9_-]+(\.[a-z0-9_-]+)*$/.test(local) || local.length > 64) {
    return refusal(400, `${JSON.stringify(given)} isn't an address Duva can create. Use letters, digits, dots, hyphens and underscores before the @.`);
  }

  // SES takes at most 500 recipients in a receipt rule, and Duva has one rule for now.
  if ((await allAddresses(deployment.table)).length >= maxAddresses) {
    return refusal(409, `The organization has ${maxAddresses} addresses, as many as Duva can receive mail for yet.`);
  }

  try {
    const mailbox = await addMailbox(deployment.table, { owner: owner.id, address, by: actor.id });
    await syncRecipients(deployment.table, deployment.receiving);
    return { statusCode: 201, body: mailbox satisfies components["schemas"]["Mailbox"] };
  } catch (error) {
    if (!(error instanceof AddressTaken)) throw error;
    // If SES failed when the address was created, creating it again repairs the rule.
    await syncRecipients(deployment.table, deployment.receiving);
    return refusal(409, `${address} is taken. Give another address.`);
  }
};

export const listMailboxes: OperationHandler = async (_event, deployment, actor) => {
  const agents = actor!.kind === "human" ? await sponsoredAgents(deployment.table, actor!.id) : [];
  const owners = [actor!.id, ...agents.map(({ id }) => id)];
  const mailboxes = (await Promise.all(owners.map((owner) => ownedMailboxes(deployment.table, owner)))).flat();
  return { statusCode: 200, body: { mailboxes } satisfies components["schemas"]["MailboxList"] };
};

/**
 * The mailbox with the ID in the call's path, if the actor may read it: its owner can, and so can
 * the sponsor of an agent that owns it. Admins can't, unless they are that sponsor.
 */
export async function readableMailbox(
  event: Parameters<OperationHandler>[0],
  deployment: Deployment,
  actor: Actor,
): Promise<Mailbox | ReturnType<typeof refusal>> {
  const id = event.pathParameters?.mailbox ?? "";
  const mailbox = await findMailbox(deployment.table, id);
  if (mailbox === undefined) return refusal(404, `There is no mailbox ${JSON.stringify(id)}. List the mailboxes you can read to find its ID.`);
  if (mailbox.owner === actor.id) return mailbox;
  const owner = await findActor(deployment.table, mailbox.owner);
  if (owner?.kind === "agent" && owner.sponsor === actor.id) return mailbox;
  return refusal(403, "Only the mailbox's owner can read it, and its sponsor if an agent owns it.");
}

export const listMailboxChanges: OperationHandler = async (event, deployment, actor) => {
  const mailbox = await readableMailbox(event, deployment, actor!);
  if ("statusCode" in mailbox) return mailbox;
  const given = event.queryStringParameters?.after ?? "0";
  if (!/^\d+$/.test(given)) return refusal(400, `${JSON.stringify(given)} isn't a position. Give after as a whole number from 0.`);
  const after = Number(given);
  const changes = await mailboxChanges(deployment.table, mailbox.id, after);
  return {
    statusCode: 200,
    body: { changes, position: changes.at(-1)?.position ?? after } satisfies components["schemas"]["MailboxChangePage"],
  };
};

export const listThreads: OperationHandler = async (event, deployment, actor) => {
  const mailbox = await readableMailbox(event, deployment, actor!);
  if ("statusCode" in mailbox) return mailbox;
  const threads = await threadsWithLabel(deployment.table, mailbox.id, event.queryStringParameters?.label ?? inbox);
  return { statusCode: 200, body: { threads } satisfies components["schemas"]["ThreadList"] };
};

export const getThread: OperationHandler = async (event, deployment, actor) => {
  const mailbox = await readableMailbox(event, deployment, actor!);
  if ("statusCode" in mailbox) return mailbox;
  const id = event.pathParameters?.thread ?? "";
  const thread = await readThread(deployment.table, deployment.mailBucket, mailbox.id, id);
  if (thread === undefined) return refusal(404, `The mailbox has no thread ${JSON.stringify(id)}. List its threads to find one.`);
  return { statusCode: 200, body: thread satisfies components["schemas"]["Thread"] };
};
