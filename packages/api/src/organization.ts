// The organization, its actors, mailboxes and addresses, and its change feed, in Duva's one table.
// Each change to the setup is written in one transaction with its change-feed entry.
import { randomUUID } from "node:crypto";
import { ConditionalCheckFailedException, TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { GetCommand, PutCommand, QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import type { components } from "@duva/openapi";
import { agentKeyHash, newAgentKey } from "./agent-keys.ts";
import type { Humans } from "./user-pool.ts";
import type { Table } from "./deployment.ts";
import { changesAfter, entryKey, type Feed, recordChanges } from "./feed.ts";
import { documents, isNew, pk, sk, type TransactItem } from "./table.ts";

export type Actor = components["schemas"]["Actor"];
export type Human = components["schemas"]["Human"];
export type Agent = components["schemas"]["Agent"];
export type Mailbox = components["schemas"]["Mailbox"];
export type OrganizationChange = components["schemas"]["OrganizationChange"];
/** A change as its maker describes it, before the feed gives it a position, a time and its actor. */
type ChangeDetails = OrganizationChange extends infer Change ? (Change extends unknown ? Omit<Change, "position" | "at" | "actor"> : never) : never;

const organizationKey = { [pk]: "organization", [sk]: "organization" };
const actorKey = (id: string) => ({ [pk]: `actor#${id}`, [sk]: "actor" });
// Each agent is listed in its sponsor's partition, so a human's agents are one query away.
const sponsoredKey = (sponsor: string, agent: string) => ({ [pk]: `actor#${sponsor}`, [sk]: `agent#${agent}` });
// Every human is listed in one partition, so the organization's humans are one query away.
const humansPartition = "organization#humans";
const humanListedKey = (id: string) => ({ [pk]: humansPartition, [sk]: `human#${id}` });
const humanListedPrefix = humanListedKey("")[sk];
// The sub of each human's Cognito user points at their actor, so the authorizer finds it in one
// read. A human keeps their actor when Duva moves to a new user pool, where their sub is new.
const signInKey = (sub: string) => ({ [pk]: `signIn#${sub}`, [sk]: "signIn" });
const signInItem = (sub: string, actor: string) => ({ ...signInKey(sub), actor });
// Only a hash of an agent's key is stored. It points at the agent, so the authorizer finds it in one read.
const agentKeyKey = (hash: string) => ({ [pk]: `key#${hash}`, [sk]: "key" });
// A mailbox's own partition also holds its mail and the position of its change feed.
export const mailboxKey = (id: string) => ({ [pk]: `mailbox#${id}`, [sk]: "mailbox" });
// Each mailbox is listed in its owner's partition, so an actor's mailboxes are one query away.
const ownedKey = (owner: string, mailbox: string) => ({ [pk]: `actor#${owner}`, [sk]: `mailbox#${mailbox}` });
// Every address is in one partition, so the receipt rule's recipients are one query away.
const addressesPartition = "organization#addresses";
const addressKey = (address: string) => ({ [pk]: addressesPartition, [sk]: `address#${address}` });
const organizationFeed: Feed = {
  counter: organizationKey,
  partition: "organization#changes",
  missing: "The organization isn't set up. Run duva deploy.",
};

/**
 * Sets up the organization for its first domain, with the human at `admin` as its first admin.
 * The changes are attributed to that admin, the person running duva deploy, so each has exactly
 * one actor (ADR-0001). Setting up again with the same admin changes nothing, except that a human
 * the user pool doesn't have gets a Cognito user there, as after Duva moved to a new user pool.
 */
export async function setUpOrganization(
  { table, humans }: { table: Table; humans: Humans },
  { domain, admin }: { domain: string; admin: string },
): Promise<Human> {
  const db = documents(table);
  const existing = await firstAdmin(table);
  if (existing !== undefined) {
    if (existing.email !== admin) throw new Error(`The organization's first admin is ${existing.email}, so it can't be ${admin}.`);
    // Organizations set up before humans were listed didn't list their first admin.
    await db.send(new PutCommand({ TableName: table.name, Item: humanListedKey(existing.id) }));
    await moveHumans({ table, humans });
    return existing;
  }

  const sub = await humans.add(admin);
  const actor: Human = { id: sub, kind: "human", email: admin, admin: true };
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
          { Put: { TableName: table.name, Item: humanListedKey(actor.id) } },
          { Put: { TableName: table.name, Item: signInItem(sub, actor.id) } },
          ...changes.map((change, index) => ({
            Put: {
              TableName: table.name,
              Item: { ...entryKey(organizationFeed, index + 1), ...change, position: index + 1, at, actor: actor.id },
              ...isNew,
            },
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
 * Gives every human in the organization a Cognito user in the user pool, and points its sub at
 * their actor. Their actor, and with it their mailboxes and history, stays theirs. Humans the user
 * pool already has keep their Cognito user.
 */
async function moveHumans({ table, humans }: { table: Table; humans: Humans }): Promise<void> {
  // One at a time, which keeps well inside Cognito's quotas.
  for (const human of await allHumans(table)) {
    const sub = await humans.add(human.email);
    await documents(table)
      .send(
        new PutCommand({
          TableName: table.name,
          Item: signInItem(sub, human.id),
          ConditionExpression: `attribute_not_exists(${pk}) OR actor = :actor`,
          ExpressionAttributeValues: { ":actor": human.id },
        }),
      )
      .catch((error: unknown) => {
        if (!(error instanceof ConditionalCheckFailedException)) throw error;
        throw new Error(`${human.email} and another human differ only in case, which the user pool takes as one address, so setup can't move them.`);
      });
  }
}

/** The human whose Cognito user has the sub, or undefined if it is no human's. */
export async function findHumanBySignIn(table: Table, sub: string): Promise<Human | undefined> {
  const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: signInKey(sub), ConsistentRead: true }));
  const actor = Item === undefined ? undefined : await findActor(table, Item.actor as string);
  return actor?.kind === "human" ? actor : undefined;
}

/**
 * Adds the human at `email`, who can then sign in, as an actor added by the actor `by`. Throws
 * HumanExists if the organization already has the human.
 */
export async function addHumanToOrganization({ table, humans }: { table: Table; humans: Humans }, { email, by }: { email: string; by: string }): Promise<Human> {
  // The first admin's address is kept as deploy was given it, so an address that differs only in
  // case would give the same person two actors.
  if ((await allHumans(table)).some((human) => human.email.toLowerCase() === email.toLowerCase())) throw new HumanExists();
  // The user pool gives a human who can already sign in the sub they had, so their actor is there too.
  const sub = await humans.add(email);
  const actor: Human = { id: sub, kind: "human", email, admin: false };
  await recordChange(table, by, { type: "actorAdded", added: actor }, [
    { Put: { TableName: table.name, Item: signInItem(sub, actor.id), ...isNew } },
    { Put: { TableName: table.name, Item: { ...actorKey(actor.id), ...actor }, ...isNew } },
    { Put: { TableName: table.name, Item: humanListedKey(actor.id) } },
  ]).catch((error: unknown) => {
    const reasons = error instanceof TransactionCanceledException ? (error.CancellationReasons ?? []) : [];
    const exists = [reasons[2], reasons[3]].some((reason) => reason?.Code === "ConditionalCheckFailed");
    throw exists ? new HumanExists() : error;
  });
  return actor;
}

/** The organization already has the human. */
export class HumanExists extends Error {}

/** The organization's humans. */
export async function allHumans(table: Table): Promise<Human[]> {
  const ids: string[] = [];
  let start: Record<string, unknown> | undefined;
  do {
    const page = await documents(table).send(
      new QueryCommand({
        TableName: table.name,
        KeyConditionExpression: `${pk} = :humans`,
        ExpressionAttributeValues: { ":humans": humansPartition },
        ConsistentRead: true,
        ExclusiveStartKey: start,
      }),
    );
    for (const item of page.Items ?? []) ids.push((item[sk] as string).slice(humanListedPrefix.length));
    start = page.LastEvaluatedKey;
  } while (start !== undefined);
  const humans = await Promise.all(ids.map((id) => findActor(table, id)));
  return humans.filter((human): human is Human => human?.kind === "human");
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

/** The organization's domain, which every address is on. */
export async function organizationDomain(table: Table): Promise<string> {
  const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: organizationKey }));
  if (Item === undefined) throw new Error(organizationFeed.missing);
  return Item.domain as string;
}

/**
 * Adds a personal mailbox owned by the actor `owner`, with the address as its default address, on
 * behalf of the actor `by`. Throws AddressTaken if another mailbox has the address.
 */
export async function addMailbox(table: Table, { owner, address, by }: { owner: string; address: string; by: string }): Promise<Mailbox> {
  const mailbox: Mailbox = { id: randomUUID(), kind: "personal", owner, defaultAddress: address };
  await recordChanges(table, organizationFeed, {
    by,
    changes: [
      { type: "mailboxAdded", mailbox },
      { type: "addressAdded", address, mailbox: mailbox.id },
    ] satisfies ChangeDetails[],
    items: [
      // The mailbox's feed starts at 0.
      { Put: { TableName: table.name, Item: { ...mailboxKey(mailbox.id), ...mailbox, position: 0 }, ...isNew } },
      { Put: { TableName: table.name, Item: { ...ownedKey(owner, mailbox.id) }, ...isNew } },
      { Put: { TableName: table.name, Item: { ...addressKey(address), address, mailbox: mailbox.id }, ...isNew } },
    ],
  }).catch((error: unknown) => {
    const taken = error instanceof TransactionCanceledException && error.CancellationReasons?.[5]?.Code === "ConditionalCheckFailed";
    throw taken ? new AddressTaken() : error;
  });
  return mailbox;
}

/** Another mailbox has the address. */
export class AddressTaken extends Error {}

/** The mailbox with the ID, or undefined if the organization has none. */
export async function findMailbox(table: Table, id: string): Promise<Mailbox | undefined> {
  const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: mailboxKey(id), ConsistentRead: true }));
  return Item === undefined ? undefined : mailboxOf(Item as Mailbox);
}

/** The mailboxes the actor owns. */
export async function ownedMailboxes(table: Table, owner: string): Promise<Mailbox[]> {
  const { [pk]: partition, [sk]: prefix } = ownedKey(owner, "");
  const { Items = [] } = await documents(table).send(
    new QueryCommand({
      TableName: table.name,
      KeyConditionExpression: `${pk} = :owner AND begins_with(${sk}, :mailbox)`,
      ExpressionAttributeValues: { ":owner": partition, ":mailbox": prefix },
    }),
  );
  const mailboxes = await Promise.all(Items.map((item) => findMailbox(table, (item[sk] as string).slice(prefix.length))));
  return mailboxes.filter((mailbox) => mailbox !== undefined);
}

/** The mailbox the address delivers to, or undefined if the organization has no such address. */
export async function mailboxAt(table: Table, address: string): Promise<string | undefined> {
  const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: addressKey(address), ConsistentRead: true }));
  return Item?.mailbox as string | undefined;
}

/** Every address in the organization. */
export async function allAddresses(table: Table): Promise<string[]> {
  const addresses: string[] = [];
  let start: Record<string, unknown> | undefined;
  do {
    const page = await documents(table).send(
      new QueryCommand({
        TableName: table.name,
        KeyConditionExpression: `${pk} = :addresses`,
        ExpressionAttributeValues: { ":addresses": addressesPartition },
        ConsistentRead: true,
        ExclusiveStartKey: start,
      }),
    );
    for (const item of page.Items ?? []) addresses.push(item.address as string);
    start = page.LastEvaluatedKey;
  } while (start !== undefined);
  return addresses;
}

/** The mailbox an item stores, in the order the contract lists its fields. */
const mailboxOf = ({ id, kind, owner, defaultAddress }: Mailbox): Mailbox => ({ id, kind, owner, defaultAddress });

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

/** Records one change to the setup in the organization's change feed, with the items it writes. */
function recordChange(table: Table, by: string, change: ChangeDetails, items: TransactItem[]): Promise<void> {
  return recordChanges(table, organizationFeed, { by, changes: [change], items });
}

/** The organization's changes after the position, oldest first, at most changesPerPage of them. */
export async function organizationChanges(table: Table, after: number): Promise<OrganizationChange[]> {
  const changes = await changesAfter(table, organizationFeed, after);
  for (const change of changes) {
    if (change.added !== undefined) change.added = actorOf(change.added as Record<string, unknown>);
    if (change.mailbox !== undefined && typeof change.mailbox === "object") change.mailbox = mailboxOf(change.mailbox as Mailbox);
  }
  return changes as OrganizationChange[];
}
