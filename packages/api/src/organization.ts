// The organization, its actors and its change feed, in Duva's one table. Each change to the
// setup is written in one transaction with its change-feed entry.
import { randomUUID } from "node:crypto";
import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import type { components } from "@duva/openapi";
import { agentKeyHash, newAgentKey } from "./agent-keys.ts";
import type { Humans } from "./humans.ts";
import { tableKey } from "./infrastructure.ts";
import type { Table } from "./deployment.ts";

export type Actor = components["schemas"]["Actor"];
export type Human = components["schemas"]["Human"];
export type Agent = components["schemas"]["Agent"];
export type OrganizationChange = components["schemas"]["OrganizationChange"];
/** A change as its maker describes it, before the feed gives it a position, a time and its actor. */
type ChangeDetails = OrganizationChange extends infer Change ? (Change extends unknown ? Omit<Change, "position" | "at" | "actor"> : never) : never;

const { partitionKey: pk, sortKey: sk } = tableKey;
const organizationKey = { [pk]: "organization", [sk]: "organization" };
const actorKey = (id: string) => ({ [pk]: `actor#${id}`, [sk]: "actor" });
// Each agent is listed in its sponsor's partition, so a human's agents are one query away.
const sponsoredKey = (sponsor: string, agent: string) => ({ [pk]: `actor#${sponsor}`, [sk]: `agent#${agent}` });
// Only a hash of an agent's key is stored. It points at the agent, so the authorizer finds it in one read.
const agentKeyKey = (hash: string) => ({ [pk]: `key#${hash}`, [sk]: "key" });
const changesPartition = "organization#changes";
// Positions are zero-padded in the sort key, so the feed sorts in position order.
const changeKey = (position: number) => ({ [pk]: changesPartition, [sk]: `change#${String(position).padStart(12, "0")}` });

// A put with this condition only adds an item, and fails if it is already there.
const isNew = { ConditionExpression: `attribute_not_exists(${pk})` };

/** How many changes one read of the change feed lists at most. */
export const changesPerPage = 100;

/**
 * Sets up the organization for its first domain, with the human at `admin` as its first admin.
 * The changes are attributed to that admin, the person running duva deploy, so each has exactly
 * one actor (ADR-0001). Setting up again with the same admin changes nothing.
 */
export async function setUpOrganization(
  { table, humans }: { table: Table; humans: Humans },
  { domain, admin }: { domain: string; admin: string },
): Promise<Human> {
  const db = documents(table);
  const existing = await firstAdmin(table);
  if (existing !== undefined) {
    if (existing.email !== admin) throw new Error(`The organization's first admin is ${existing.email}, so it can't be ${admin}.`);
    return existing;
  }

  const actor: Human = { id: await humans.add(admin), kind: "human", email: admin, admin: true };
  const at = new Date().toISOString();
  const changes: ChangeDetails[] = [
    { type: "organizationAdded" },
    { type: "domainAdded", domain },
    { type: "actorAdded", added: actor },
  ];
  try {
    await db.send(
      new TransactWriteCommand({
        TransactItems: [
          { Put: { TableName: table.name, Item: { ...organizationKey, domain, firstAdmin: actor.id, position: changes.length }, ...isNew } },
          { Put: { TableName: table.name, Item: { ...actorKey(actor.id), ...actor }, ...isNew } },
          ...changes.map((change, index) => ({
            Put: { TableName: table.name, Item: { ...changeKey(index + 1), ...change, position: index + 1, at, actor: actor.id }, ...isNew },
          })),
        ],
      }),
    );
  } catch (error) {
    // If another setup got there first, whether it set up the same admin decides the outcome.
    const winner = error instanceof TransactionCanceledException ? await firstAdmin(table) : undefined;
    if (winner === undefined) throw error;
    if (winner.email !== admin) throw new Error(`The organization's first admin is ${winner.email}, so it can't be ${admin}.`);
    return winner;
  }
  return actor;
}

async function firstAdmin(table: Table): Promise<Human | undefined> {
  const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: organizationKey }));
  if (Item === undefined) return undefined;
  const actor = await findActor(table, Item.firstAdmin as string);
  if (actor?.kind !== "human") throw new Error("The organization's first admin is missing.");
  return actor;
}

/**
 * Adds the human at `email`, who can then sign in, as an actor added by the actor `by`. Until
 * admins can add humans, only the test harness does.
 */
export async function addHuman({ table, humans }: { table: Table; humans: Humans }, { email, by }: { email: string; by: string }) {
  const actor: Human = { id: await humans.add(email), kind: "human", email, admin: false };
  await recordChange(table, by, { type: "actorAdded", added: actor }, [
    { Put: { TableName: table.name, Item: { ...actorKey(actor.id), ...actor }, ...isNew } },
  ]);
  return actor;
}

/** Adds an agent with the human `sponsor` as its sponsor, and returns it with its key, which only its hash outlives. */
export async function addAgent(table: Table, { name, sponsor }: { name: string; sponsor: string }): Promise<{ agent: Agent; key: string }> {
  const agent: Agent = { id: randomUUID(), kind: "agent", name, sponsor, admin: false };
  const key = newAgentKey();
  const hash = agentKeyHash(key);
  await recordChange(table, sponsor, { type: "actorAdded", added: agent }, [
    { Put: { TableName: table.name, Item: { ...actorKey(agent.id), ...agent, keyHash: hash }, ...isNew } },
    { Put: { TableName: table.name, Item: { ...sponsoredKey(sponsor, agent.id) }, ...isNew } },
    { Put: { TableName: table.name, Item: { ...agentKeyKey(hash), agent: agent.id }, ...isNew } },
  ]);
  return { agent, key };
}

/**
 * Gives the agent a new key, on behalf of the actor `by`, and returns it. The old key's hash is
 * deleted in the same transaction, so the authorizer refuses it from then on.
 */
export async function replaceAgentKey(table: Table, { agent, by }: { agent: string; by: string }): Promise<string> {
  const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: actorKey(agent), ConsistentRead: true }));
  const old = Item?.keyHash as string | undefined;
  if (old === undefined) throw new Error(`${agent} isn't an agent.`);
  const key = newAgentKey();
  const hash = agentKeyHash(key);
  const rotation = recordChange(table, by, { type: "agentKeyRotated", agent }, [
    {
      // If another rotation got there first, this one fails rather than leave two keys working.
      Update: {
        TableName: table.name,
        Key: actorKey(agent),
        UpdateExpression: "SET keyHash = :new",
        ConditionExpression: "keyHash = :old",
        ExpressionAttributeValues: { ":new": hash, ":old": old },
      },
    },
    { Delete: { TableName: table.name, Key: agentKeyKey(old) } },
    { Put: { TableName: table.name, Item: { ...agentKeyKey(hash), agent }, ...isNew } },
  ]);
  await rotation.catch((error: unknown) => {
    const changed = error instanceof TransactionCanceledException && error.CancellationReasons?.[2]?.Code === "ConditionalCheckFailed";
    throw changed ? new KeyChanged() : error;
  });
  return key;
}

/** Another rotation replaced the agent's key first, so the key this one would give out never worked. */
export class KeyChanged extends Error {}

/** The agent whose key it is, or undefined if it is no agent's current key. */
export async function findAgentByKey(table: Table, key: string): Promise<Agent | undefined> {
  const hash = agentKeyHash(key);
  // Consistent reads, so a rotated key is refused at once.
  const { Item: keyItem } = await documents(table).send(new GetCommand({ TableName: table.name, Key: agentKeyKey(hash), ConsistentRead: true }));
  if (keyItem === undefined) return undefined;
  const { Item } = await documents(table).send(
    new GetCommand({ TableName: table.name, Key: actorKey(keyItem.agent as string), ConsistentRead: true }),
  );
  return Item?.keyHash === hash ? (actorOf(Item) as Agent) : undefined;
}

/** The agents the actor sponsors. */
export async function sponsoredAgents(table: Table, sponsor: string): Promise<Agent[]> {
  const { [pk]: partition, [sk]: prefix } = sponsoredKey(sponsor, "");
  const { Items = [] } = await documents(table).send(
    new QueryCommand({
      TableName: table.name,
      KeyConditionExpression: `${pk} = :sponsor AND begins_with(${sk}, :agent)`,
      ExpressionAttributeValues: { ":sponsor": partition, ":agent": prefix },
    }),
  );
  const agents = await Promise.all(Items.map((item) => findActor(table, (item[sk] as string).slice(prefix.length))));
  return agents.filter((agent): agent is Agent => agent?.kind === "agent");
}

/** The actor with the ID, or undefined if the organization has none. */
export async function findActor(table: Table, id: string): Promise<Actor | undefined> {
  const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: actorKey(id), ConsistentRead: true }));
  return Item === undefined ? undefined : actorOf(Item);
}

/**
 * The actor an item stores, without what only Duva may see, such as an agent's key hash, and in
 * the order the contract lists its fields, which neither DynamoDB nor API Gateway keeps.
 */
export function actorOf(item: Record<string, unknown>): Actor {
  const actor = item as Actor;
  if (actor.kind === "agent") return { id: actor.id, kind: actor.kind, name: actor.name, sponsor: actor.sponsor, admin: actor.admin };
  return { id: actor.id, kind: actor.kind, email: actor.email, admin: actor.admin };
}

type TransactItem = NonNullable<ConstructorParameters<typeof TransactWriteCommand>[0]["TransactItems"]>[number];

/**
 * Writes the items with the change's entry in the change feed, in one transaction, attributed to
 * the actor `by`. The organization item holds the feed's last position, and each change claims
 * the next one, so concurrent changes retry until each has its own.
 */
async function recordChange(table: Table, by: string, change: ChangeDetails, items: TransactItem[]): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: organizationKey, ConsistentRead: true }));
    if (Item === undefined) throw new Error("The organization isn't set up. Run duva deploy.");
    const position = (Item.position as number) + 1;
    try {
      await documents(table).send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Update: {
                TableName: table.name,
                Key: organizationKey,
                UpdateExpression: "SET #position = :next",
                ConditionExpression: "#position = :current",
                ExpressionAttributeNames: { "#position": "position" },
                ExpressionAttributeValues: { ":next": position, ":current": position - 1 },
              },
            },
            {
              Put: {
                TableName: table.name,
                Item: { ...changeKey(position), ...change, position, at: new Date().toISOString(), actor: by },
                ...isNew,
              },
            },
            ...items,
          ],
        }),
      );
      return;
    } catch (error) {
      // Only a change that lost the race for the position tries again.
      const lost = error instanceof TransactionCanceledException && error.CancellationReasons?.[0]?.Code === "ConditionalCheckFailed";
      if (!lost || attempt === 10) throw error;
    }
  }
}

/** The organization's changes after the position, oldest first, at most changesPerPage of them. */
export async function organizationChanges(table: Table, after: number): Promise<OrganizationChange[]> {
  const { Items = [] } = await documents(table).send(
    new QueryCommand({
      TableName: table.name,
      KeyConditionExpression: `${pk} = :feed AND ${sk} > :after`,
      ExpressionAttributeValues: { ":feed": changesPartition, ":after": changeKey(after)[sk] },
      Limit: changesPerPage,
    }),
  );
  // DynamoDB keeps no attribute order, so each change is rebuilt in the order the contract lists.
  return Items.map(({ [pk]: _pk, [sk]: _sk, position, at, actor, type, ...details }) => {
    if (details.added !== undefined) details.added = actorOf(details.added);
    return { position, at, actor, type, ...details } as OrganizationChange;
  });
}

function documents(table: Table) {
  return DynamoDBDocumentClient.from(table.client);
}
