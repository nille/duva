// Mailbox agents (ADR-0027, ADR-0033): every human with a personal mailbox has one agent Duva hosts,
// Coo, which they sponsor and which works in all their personal mailboxes, with the sponsor access
// they give it. Before one per human, each mailbox had its own, which deploy's setup merges into one.
import { ConditionalCheckFailedException, TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { GetCommand, QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { sponsorAccessAllows, sponsorAccessIn } from "./access.ts";
import { withdrawPendingApprovals } from "./drafting.ts";
import type { Table } from "./deployment.ts";
import { recordInFeeds } from "./feed.ts";
import {
  actorKey,
  addKeylessAgent,
  type Agent,
  type AgentSettings,
  agentSettings,
  agentSettingsKey,
  allHumans,
  defaultAgentSettings,
  duva,
  findActor,
  firstAgentSettings,
  type Human,
  type Mailbox,
  mailboxFeed,
  mailboxesInOrder,
  mailboxKey,
  organizationFeed,
  ownedMailboxes,
  renameAgent,
} from "./organization.ts";
import { documents, isNew, pk, sk, type TransactItem } from "./table.ts";

/** What every mailbox agent is called, which its mail's disclosure names. Its sponsor can't rename it. */
export const mailboxAgentName = "Coo";

/**
 * A mailbox agent's settings until its sponsor changes them: read, search, organize and draft, and
 * every send waiting for their approval, from their address with the disclosure's line, in all their
 * personal mailboxes, those admins give them later too.
 */
export const mailboxAgentSettings: AgentSettings = { ...defaultAgentSettings, sponsorAccess: "send" };

// Which agent is the human's mailbox agent, in their partition.
const pointerKey = (human: string) => ({ [pk]: actorKey(human)[pk]!, [sk]: "mailboxAgent" });
// Which agent was a mailbox's own before one per human, in the mailbox's partition.
const mailboxPointerKey = (mailbox: string) => ({ [pk]: mailboxKey(mailbox)[pk]!, [sk]: "mailboxAgent" });
// Each agent merged into the human's one, in that one's partition, so its activity is the one's too.
const mergedKey = (agent: string, merged: string) => ({ [pk]: actorKey(agent)[pk]!, [sk]: `merged#${merged}` });
const mergedPrefix = mergedKey("", "")[sk];

/** The human's mailbox agent, or undefined if they have none, as before their first personal mailbox. */
export async function mailboxAgentOf(table: Table, human: string): Promise<Agent | undefined> {
  const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: pointerKey(human), ConsistentRead: true }));
  if (Item === undefined) return undefined;
  const agent = await findActor(table, Item.agent as string);
  return agent?.kind === "agent" && agent.sponsor === human ? agent : undefined;
}

/**
 * The mailbox agent that works in the mailbox: its owner's, or between the deploy that brings one
 * per human and its setup, the mailbox's own from before, so it goes on working until the merge.
 */
export async function mailboxAgentIn(table: Table, mailbox: Mailbox): Promise<Agent | undefined> {
  return (await mailboxAgentOf(table, mailbox.owner)) ?? (await agentBefore(table, mailbox));
}

/** The mailbox's own mailbox agent from before one per human, until setup merges it. */
async function agentBefore(table: Table, mailbox: Mailbox): Promise<Agent | undefined> {
  const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: mailboxPointerKey(mailbox.id), ConsistentRead: true }));
  const agent = Item === undefined ? undefined : await findActor(table, Item.agent as string);
  return agent?.kind === "agent" && agent.sponsor === mailbox.owner ? agent : undefined;
}

/** The IDs of the mailbox agents merged into the agent, whose activity is its own too. */
export async function mergedInto(table: Table, agent: string): Promise<string[]> {
  const { Items = [] } = await documents(table).send(
    new QueryCommand({
      TableName: table.name,
      KeyConditionExpression: `${pk} = :agent AND begins_with(${sk}, :merged)`,
      ExpressionAttributeValues: { ":agent": actorKey(agent)[pk], ":merged": mergedPrefix },
      ConsistentRead: true,
    }),
  );
  return Items.map((item) => (item[sk] as string).slice(mergedPrefix.length));
}

/**
 * Gives the human their mailbox agent, which they sponsor, if they have a personal mailbox and none
 * yet, as when an admin creates their first or hands them one. One named before mailbox agents were
 * called Coo is renamed. Giving it again changes nothing.
 */
export async function giveMailboxAgent(table: Table, human: string): Promise<void> {
  if ((await findActor(table, human))?.kind !== "human") return;
  const current = await mailboxAgentOf(table, human);
  if (current !== undefined) {
    if (current.name !== mailboxAgentName) await renameAgent(table, current.id, mailboxAgentName);
    return;
  }
  if ((await ownedMailboxes(table, human)).length === 0) return;
  const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: pointerKey(human), ConsistentRead: true }));
  // If another call gave them one first, this one gives none.
  const asRead =
    Item === undefined
      ? { ConditionExpression: `attribute_not_exists(${pk})` }
      : { ConditionExpression: "#agent = :read", ExpressionAttributeNames: { "#agent": "agent" }, ExpressionAttributeValues: { ":read": Item.agent } };
  await addKeylessAgent(table, {
    name: mailboxAgentName,
    sponsor: human,
    mailboxAgent: true,
    items: (agent) => [firstAgentSettings(table, agent, mailboxAgentSettings), { Put: { TableName: table.name, Item: { ...pointerKey(human), agent }, ...asRead } }],
  }).catch((error: unknown) => {
    if (!(error instanceof TransactionCanceledException || error instanceof ConditionalCheckFailedException)) throw error;
  });
}

/**
 * Gives every human with a personal mailbox their mailbox agent, as the setup after a deploy does,
 * once the mailbox agents from before one per human are merged. Run again, it finishes what a run left.
 */
export async function giveMailboxAgents(table: Table): Promise<void> {
  await mergeMailboxAgents(table);
  for (const human of await allHumans(table)) await giveMailboxAgent(table, human.id);
}

const accessOrder: AgentSettings["sponsorAccess"][] = ["none", "read", "organize", "draft", "send"];

/**
 * Makes each human's mailbox agents from before one per human one (ADR-0033), once, as the setup
 * after the deploy that brings it does. The one is the human's mailbox agent if they have one, else
 * the first paused, else the first in the order the web app lists the mailboxes. It works in all
 * their personal mailboxes, with settings none of them had more of, and its sends waiting for
 * approval where it may no longer send are withdrawn. The others are merged into it: what they did
 * stays theirs, their sends under way still go out, unpausing it unpauses them, and its activity is
 * theirs too. Their conversations become one. Recorded in the organization's change feed and in each of the human's
 * personal mailboxes', under Duva. Run again, it finishes what a run left.
 */
export async function mergeMailboxAgents(table: Table): Promise<void> {
  for (const human of await allHumans(table)) {
    await mergeConversations(table, human.id);
    const mailboxes = mailboxesInOrder(await ownedMailboxes(table, human.id), human.email);
    const before = (await Promise.all(mailboxes.map(async (mailbox) => ({ mailbox, agent: await agentBefore(table, mailbox) })))).filter(
      (each): each is { mailbox: Mailbox; agent: Agent } => each.agent !== undefined,
    );
    if (before.length > 0) await merge(table, human, mailboxes, before);
  }
}

async function merge(table: Table, human: Human, mailboxes: Mailbox[], before: { mailbox: Mailbox; agent: Agent }[]): Promise<void> {
  const already = await mailboxAgentOf(table, human.id);
  const one = already ?? (before.find(({ agent }) => agent.paused !== undefined) ?? before[0]!).agent;
  const read = new Map(await Promise.all([...new Set([one.id, ...before.map(({ agent }) => agent.id)])].map(async (id) => [id, await agentSettings(table, id)] as const)));
  // Each mailbox's access is what its own agent had there, or the human's one, made before setup, had.
  const speakers = mailboxes.map((mailbox) => {
    const own = before.find((each) => each.mailbox.id === mailbox.id)?.agent ?? one;
    const { settings } = read.get(own.id)!;
    return { mailbox, settings, access: sponsorAccessIn(settings, mailbox.id) };
  });
  const covered = speakers.filter(({ access }) => access !== "none");
  const settings: AgentSettings = {
    sponsorAccess: covered.reduce<AgentSettings["sponsorAccess"]>((least, { access }) => (accessOrder.indexOf(access) < accessOrder.indexOf(least) ? access : least), covered.length === 0 ? "none" : "send"),
    sponsorMailboxes: covered.length === mailboxes.length ? null : covered.map(({ mailbox }) => mailbox.id),
    approvalAsSponsor: speakers.some(({ settings }) => settings.approvalAsSponsor),
    disclosureLineAsSponsor: speakers.some(({ settings }) => settings.disclosureLineAsSponsor),
    sendsPerHour: Math.min(...speakers.map(({ settings }) => settings.sendsPerHour)),
    newRecipientsPerDay: Math.min(...speakers.map(({ settings }) => settings.newRecipientsPerDay)),
  };
  const merged = before.filter(({ agent }) => agent.id !== one.id);
  const kept = before.find(({ agent }) => agent.id === one.id);
  const { version } = read.get(one.id)!;
  const items: TransactItem[] = [
    already === undefined
      ? { Put: { TableName: table.name, Item: { ...pointerKey(human.id), agent: one.id }, ...isNew } }
      : { ConditionCheck: { TableName: table.name, Key: pointerKey(human.id), ConditionExpression: "#agent = :one", ExpressionAttributeNames: { "#agent": "agent" }, ExpressionAttributeValues: { ":one": one.id } } },
    {
      Update: {
        TableName: table.name,
        Key: actorKey(one.id),
        UpdateExpression: "SET mailboxAgent = :yes, #name = :name REMOVE mailbox",
        ConditionExpression: `attribute_exists(${pk})`,
        ExpressionAttributeNames: { "#name": "name" },
        ExpressionAttributeValues: { ":yes": true, ":name": mailboxAgentName },
      },
    },
    {
      Put: {
        TableName: table.name,
        Item: { ...agentSettingsKey(one.id), ...settings, version: version + 1 },
        ConditionExpression: version === 0 ? `attribute_not_exists(${pk})` : "version = :version",
        ...(version > 0 && { ExpressionAttributeValues: { ":version": version } }),
      },
    },
    ...(kept === undefined ? [] : [releasePointer(table, kept)]),
    ...merged.flatMap((each): TransactItem[] => [
      {
        Update: {
          TableName: table.name,
          Key: actorKey(each.agent.id),
          UpdateExpression: "SET mergedInto = :one, #name = :name",
          ConditionExpression: `attribute_exists(${pk})`,
          ExpressionAttributeNames: { "#name": "name" },
          ExpressionAttributeValues: { ":one": one.id, ":name": mailboxAgentName },
        },
      },
      releasePointer(table, each),
      { Put: { TableName: table.name, Item: { ...mergedKey(one.id, each.agent.id) } } },
    ]),
  ];
  const change = { type: "mailboxAgentsMerged", agent: one.id, human: human.id, merged: merged.map(({ agent }) => agent.id) };
  await recordInFeeds(table, [{ feed: organizationFeed, changes: [change] }, ...mailboxes.map((mailbox) => ({ feed: mailboxFeed(mailbox.id), changes: [change] }))], { by: duva, items }).catch((error: unknown) => {
    // Another setup at the same time merged them first.
    if (!(error instanceof TransactionCanceledException)) throw error;
  });
  // As lowering its sponsor access does. A send asked for that this leaves, as when setup stopped here, the sender refuses.
  const unsendable = mailboxes.filter(({ id }) => !sponsorAccessAllows(sponsorAccessIn(settings, id), "send")).map(({ id }) => id);
  if (unsendable.length > 0) await withdrawPendingApprovals(table, { agent: one, mailboxes: unsendable, by: duva });
}

/** The delete of the mailbox's own pointer at its agent from before, while it still points at it. */
const releasePointer = (table: Table, { mailbox, agent }: { mailbox: Mailbox; agent: Agent }): TransactItem => ({
  Delete: { TableName: table.name, Key: mailboxPointerKey(mailbox.id), ConditionExpression: "#agent = :agent", ExpressionAttributeNames: { "#agent": "agent" }, ExpressionAttributeValues: { ":agent": agent.id } },
});

/** Makes the human's conversations with their mailboxes' agents from before one, each turn naming the mailbox it was asked from. */
async function mergeConversations(table: Table, human: string): Promise<void> {
  for (;;) {
    const { Items = [] } = await documents(table).send(
      new QueryCommand({
        TableName: table.name,
        KeyConditionExpression: `${pk} = :human AND begins_with(${sk}, :turns)`,
        ExpressionAttributeValues: { ":human": actorKey(human)[pk], ":turns": "turn#" },
        Limit: 25,
        ConsistentRead: true,
      }),
    );
    if (Items.length === 0) return;
    for (const item of Items) {
      // Each was kept as turn#<mailbox>#<at>#<id>.
      const mailbox = (item[sk] as string).split("#")[1];
      const { [pk]: partition, [sk]: key, ...turn } = item;
      await documents(table).send(
        new TransactWriteCommand({
          TransactItems: [
            { Put: { TableName: table.name, Item: { ...turnKey(human, turn.at as string, turn.id as string), ...turn, ...(mailbox && { mailbox }) } } },
            { Delete: { TableName: table.name, Key: { [pk]: partition, [sk]: key } } },
          ],
        }),
      );
    }
  }
}

/** Where a turn of the human's conversation with their mailbox agent is kept, in their partition, in order. */
export const turnKey = (human: string, at: string, id: string) => ({ [pk]: actorKey(human)[pk]!, [sk]: `${turnPrefix}${at}#${id}` });
export const turnPrefix = "conversation#";

/**
 * What setup left undone: humans with a personal mailbox and no mailbox agent, and mailboxes whose
 * own mailbox agent from before one per human isn't merged, as a deploy that didn't finish its setup leaves them.
 */
export async function mailboxAgentsLeft(table: Table): Promise<{ without: Human[]; unmerged: Mailbox[] }> {
  const without: Human[] = [];
  const unmerged: Mailbox[] = [];
  for (const human of await allHumans(table)) {
    const mailboxes = await ownedMailboxes(table, human.id);
    if (mailboxes.length > 0 && (await mailboxAgentOf(table, human.id)) === undefined) without.push(human);
    for (const mailbox of mailboxes) if ((await agentBefore(table, mailbox)) !== undefined) unmerged.push(mailbox);
  }
  return { without, unmerged };
}
