// The organization, its actors and its change feed, in Duva's one table. Each change to the
// setup is written in one transaction with its change-feed entry.
import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import type { components } from "@duva/openapi";
import type { Humans } from "./humans.ts";
import { tableKey } from "./infrastructure.ts";
import type { Table } from "./deployment.ts";

export type Actor = components["schemas"]["Actor"];
export type OrganizationChange = components["schemas"]["OrganizationChange"];
/** A change as its maker describes it, before the feed gives it a position, a time and its actor. */
type ChangeDetails = OrganizationChange extends infer Change ? (Change extends unknown ? Omit<Change, "position" | "at" | "actor"> : never) : never;

const { partitionKey: pk, sortKey: sk } = tableKey;
const organizationKey = { [pk]: "organization", [sk]: "organization" };
const actorKey = (id: string) => ({ [pk]: `actor#${id}`, [sk]: "actor" });
const changesPartition = "organization#changes";
// Positions are zero-padded in the sort key, so the feed sorts in position order.
const changeKey = (position: number) => ({ [pk]: changesPartition, [sk]: `change#${String(position).padStart(12, "0")}` });

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
): Promise<Actor> {
  const db = documents(table);
  const existing = await firstAdmin(table);
  if (existing !== undefined) {
    if (existing.email !== admin) throw new Error(`The organization's first admin is ${existing.email}, so it can't be ${admin}.`);
    return existing;
  }

  const actor: Actor = { id: await humans.add(admin), kind: "human", email: admin, admin: true };
  const at = new Date().toISOString();
  const changes: ChangeDetails[] = [
    { type: "organizationAdded" },
    { type: "domainAdded", domain },
    { type: "actorAdded", added: actor },
  ];
  const isNew = { ConditionExpression: `attribute_not_exists(${pk})` };
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

async function firstAdmin(table: Table): Promise<Actor | undefined> {
  const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: organizationKey }));
  if (Item === undefined) return undefined;
  const actor = await findActor(table, Item.firstAdmin as string);
  if (actor === undefined) throw new Error("The organization's first admin is missing.");
  return actor;
}

/** The actor with the ID, or undefined if the organization has none. */
export async function findActor(table: Table, id: string): Promise<Actor | undefined> {
  const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: actorKey(id) }));
  if (Item === undefined) return undefined;
  const { id: actorId, kind, email, admin } = Item as Actor;
  return { id: actorId, kind, email, admin };
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
  return Items.map(({ [pk]: _pk, [sk]: _sk, position, at, actor, type, ...details }) => ({ position, at, actor, type, ...details }) as OrganizationChange);
}

function documents(table: Table) {
  return DynamoDBDocumentClient.from(table.client);
}
