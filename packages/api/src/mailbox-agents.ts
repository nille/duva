// Mailbox agents (ADR-0027): every human's personal mailbox has an agent Duva hosts, which its owner
// sponsors and which works only in that mailbox, with the sponsor access they give it.
import { ConditionalCheckFailedException, TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import type { Table } from "./deployment.ts";
import {
  addKeylessAgent,
  type Agent,
  type AgentSettings,
  allMailboxes,
  defaultAgentSettings,
  findActor,
  findMailbox,
  firstAgentSettings,
  type Mailbox,
  mailboxKey,
} from "./organization.ts";
import { documents, pk, sk } from "./table.ts";

/** What every mailbox agent is called, which its mail's disclosure names. */
export const mailboxAgentName = "Mailbox agent";

/**
 * A mailbox agent's settings until its owner changes them: read, search, organize and draft, and
 * every send waiting for the owner's approval, from their address with the disclosure's line.
 */
export const mailboxAgentSettings = (mailbox: string): AgentSettings => ({ ...defaultAgentSettings, sponsorAccess: "send", sponsorMailboxes: [mailbox] });

// Which agent is a mailbox's mailbox agent, in the mailbox's partition.
const pointerKey = (mailbox: string) => ({ [pk]: mailboxKey(mailbox)[pk]!, [sk]: "mailboxAgent" });

/** The mailbox's mailbox agent, or undefined if it has none, as before the setup that gives it one. */
export async function mailboxAgentOf(table: Table, mailbox: string): Promise<Agent | undefined> {
  const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: pointerKey(mailbox), ConsistentRead: true }));
  if (Item === undefined) return undefined;
  const agent = await findActor(table, Item.agent as string);
  return agent?.kind === "agent" && agent.mailbox === mailbox ? agent : undefined;
}

/**
 * Gives the mailbox its mailbox agent, sponsored by its owner, if a human owns it and it has none
 * with that sponsor, as when the mailbox was handed over, whose agent went with its sponsor. Giving
 * it again changes nothing.
 */
export async function giveMailboxAgent(table: Table, mailbox: Mailbox): Promise<void> {
  const owner = await findActor(table, mailbox.owner);
  if (owner?.kind !== "human") return;
  const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: pointerKey(mailbox.id), ConsistentRead: true }));
  const current = Item === undefined ? undefined : await findActor(table, Item.agent as string);
  if (current?.kind === "agent" && current.sponsor === owner.id) return;
  // If another call gave it one first, this one gives none.
  const asRead =
    Item === undefined
      ? { ConditionExpression: `attribute_not_exists(${pk})` }
      : { ConditionExpression: "#agent = :read", ExpressionAttributeNames: { "#agent": "agent" }, ExpressionAttributeValues: { ":read": Item.agent } };
  await addKeylessAgent(table, {
    name: mailboxAgentName,
    sponsor: owner.id,
    mailbox: mailbox.id,
    items: (agent) => [
      firstAgentSettings(table, agent, mailboxAgentSettings(mailbox.id)),
      { Put: { TableName: table.name, Item: { ...pointerKey(mailbox.id), agent }, ...asRead } },
    ],
  }).catch((error: unknown) => {
    if (!(error instanceof TransactionCanceledException || error instanceof ConditionalCheckFailedException)) throw error;
  });
}

/** Gives every human's mailbox its mailbox agent, as the setup after the deploy that brings them does. Run again, it finishes what a run left. */
export async function giveMailboxAgents(table: Table): Promise<void> {
  for (const id of await allMailboxes(table)) {
    const mailbox = await findMailbox(table, id);
    if (mailbox !== undefined) await giveMailboxAgent(table, mailbox);
  }
}

/** The human-owned mailboxes that have no mailbox agent, as a deploy that didn't finish its setup leaves them. */
export async function mailboxesWithoutAgents(table: Table): Promise<Mailbox[]> {
  const without: Mailbox[] = [];
  for (const id of await allMailboxes(table)) {
    const mailbox = await findMailbox(table, id);
    if (mailbox === undefined || (await findActor(table, mailbox.owner))?.kind !== "human") continue;
    if ((await mailboxAgentOf(table, id)) === undefined) without.push(mailbox);
  }
  return without;
}
