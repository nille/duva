// The organization, its actors, mailboxes and addresses, and its change feed, in Duva's one table.
// Each change to the setup is written in one transaction with its change-feed entry.
import { randomUUID } from "node:crypto";
import { ConditionalCheckFailedException, TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { DeleteCommand, GetCommand, PutCommand, QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import type { components } from "@duva/openapi";
import { agentKeyHash, newAgentKey } from "./agent-keys.ts";
import type { Humans } from "./user-pool.ts";
import type { Table } from "./deployment.ts";
import { changesAfter, entryKey, type Feed, recordChanges, recordInFeeds } from "./feed.ts";
import { defaultMailboxAgentModel, defaultModelRegion } from "./agent-models.ts";
import { defaultSearchLanguages } from "./languages.ts";
import { documents, isNew, pk, sk, type TransactItem } from "./table.ts";

export type Actor = components["schemas"]["Actor"];
export type Human = components["schemas"]["Human"];
export type Agent = components["schemas"]["Agent"];
export type Mailbox = components["schemas"]["Mailbox"];
export type OrganizationChange = components["schemas"]["OrganizationChange"];
export type OrganizationSettings = components["schemas"]["OrganizationSettings"];
export type AgentSettings = components["schemas"]["AgentSettings"];
export type Group = components["schemas"]["Group"];
export type CatchAll = components["schemas"]["CatchAll"];

/** Whether the actor is an admin, which only a human can be (ADR-0030). */
export const isAdmin = (actor: Actor | undefined): boolean => actor?.kind === "human" && actor.admin;
/** A change as its maker describes it, before the feed gives it a position, a time and its actor. */
type ChangeDetails = OrganizationChange extends infer Change ? (Change extends unknown ? Omit<Change, "position" | "at" | "actor"> : never) : never;

const organizationKey = { [pk]: "organization", [sk]: "organization" };
const actorKey = (id: string) => ({ [pk]: `actor#${id}`, [sk]: "actor" });
// Each agent is listed in its sponsor's partition, so a human's agents are one query away.
const sponsoredKey = (sponsor: string, agent: string) => ({ [pk]: `actor#${sponsor}`, [sk]: `agent#${agent}` });
// An agent's settings are an item of their own beside it, which counts up its version as the organization's settings do.
const agentSettingsKey = (agent: string) => ({ [pk]: `actor#${agent}`, [sk]: "settings" });
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
export const mailboxFeed = (mailbox: string): Feed => ({
  counter: mailboxKey(mailbox),
  partition: `${mailboxKey(mailbox)[pk]}#changes`,
  missing: `The mailbox ${mailbox} is missing.`,
});
// A mailbox's Screener switch is an item of its own in the mailbox's partition. Mailboxes from before
// the Screener have none until setup gives them one.
export const screenerKey = (mailbox: string) => ({ [pk]: mailboxKey(mailbox)[pk]!, [sk]: "screener" });
// Each mailbox is listed in its owner's partition, so an actor's mailboxes are one query away.
const ownedKey = (owner: string, mailbox: string) => ({ [pk]: `actor#${owner}`, [sk]: `mailbox#${mailbox}` });
// Every domain is in one partition. Organizations from before it list their first domain there once
// setup has run, and until then only on the organization's item.
const domainsPartition = "organization#domains";
const domainKey = (domain: string) => ({ [pk]: domainsPartition, [sk]: `domain#${domain}` });
// Every address is in one partition, so the receipt rules' recipients are one query away.
const addressesPartition = "organization#addresses";
const addressKey = (address: string) => ({ [pk]: addressesPartition, [sk]: `address#${address}` });
// Each group's members and policies are an item of their own, beside its address in the addresses partition.
const groupKey = (address: string) => ({ [pk]: `group#${address}`, [sk]: "group" });
// Every mailbox is listed in one partition, those left with no address too. Mailboxes from before
// the listing are found through their addresses, and listed when they lose one.
const mailboxesPartition = "organization#mailboxes";
const mailboxListedKey = (id: string) => ({ [pk]: mailboxesPartition, [sk]: `mailbox#${id}` });
const mailboxListedPrefix = mailboxListedKey("")[sk];
// The settings are an item of their own, so changing one doesn't contend with the organization's feed.
// Each change counts up its version, which a write that relies on the settings checks.
export const settingsKey = { [pk]: "organization", [sk]: "settings" };
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
 * Once the first admin has been removed, setting up again does only that, whoever `admin` is, and
 * returns one of the admins the organization has.
 */
export async function setUpOrganization(
  { table, humans }: { table: Table; humans: Humans },
  { domain, admin }: { domain: string; admin: string },
): Promise<Human> {
  const db = documents(table);
  const existing = await firstAdmin(table);
  if (existing === null) {
    // The first admin was removed since (ADR-0020), which leaves the organization to the admins it has.
    await listFirstDomain(table);
    await moveHumans({ table, humans });
    return (await allHumans(table)).find((human) => human.admin)!;
  }
  if (existing !== undefined) {
    if (existing.email !== admin) throw new Error(`The organization's first admin is ${existing.email}, so it can't be ${admin}.`);
    // Organizations set up before humans were listed didn't list their first admin.
    await db.send(new PutCommand({ TableName: table.name, Item: humanListedKey(existing.id) }));
    await listFirstDomain(table);
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
          { Put: { TableName: table.name, Item: { ...organizationKey, domain, firstAdmin: actor.id, domainsListed: true, position: changes.length }, ...isNew } },
          { Put: { TableName: table.name, Item: { ...domainKey(domain), domain } } },
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
    if (winner === undefined || winner === null) throw error;
    if (winner.email !== admin) throw new Error(`The organization's first admin is ${winner.email}, so it can't be ${admin}.`);
    return winner;
  }
  return actor;
}

/** The organization's first admin, null if they have been removed, or undefined if the organization isn't set up. */
async function firstAdmin(table: Table): Promise<Human | null | undefined> {
  const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: organizationKey }));
  if (Item === undefined) return undefined;
  const actor = await findActor(table, Item.firstAdmin as string);
  if (actor === undefined) return null;
  if (actor.kind !== "human") throw new Error("The organization's first admin isn't a human.");
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
  const id = randomUUID();
  const key = newAgentKey();
  const hash = agentKeyHash(key);
  const agent = await addAgentWith(table, { id, name, sponsor, keyHash: hash, items: [{ Put: { TableName: table.name, Item: { ...agentKeyKey(hash), agent: id }, ...isNew } }] });
  return { agent, key };
}

/**
 * Adds an agent with the human `sponsor` as its sponsor and no key yet, with the `items` for its ID
 * written too, and returns it. It gets its key from issueAgentKey.
 */
export function addKeylessAgent(table: Table, { name, sponsor, mailbox, items }: { name: string; sponsor: string; mailbox?: string; items: (agent: string) => TransactItem[] }): Promise<Agent> {
  const id = randomUUID();
  return addAgentWith(table, { id, name, sponsor, mailbox, items: items(id) });
}

async function addAgentWith(
  table: Table,
  { id, name, sponsor, mailbox, keyHash, items }: { id: string; name: string; sponsor: string; mailbox?: string; keyHash?: string; items: TransactItem[] },
): Promise<Agent> {
  const agent: Agent = { id, kind: "agent", name, sponsor, ...(mailbox !== undefined && { mailbox }) };
  await recordChange(table, sponsor, { type: "actorAdded", added: agent }, [
    { Put: { TableName: table.name, Item: { ...actorKey(agent.id), ...agent, ...(keyHash !== undefined && { keyHash }) }, ...isNew } },
    { Put: { TableName: table.name, Item: { ...sponsoredKey(sponsor, agent.id) }, ...isNew } },
    ...items,
  ]);
  return agent;
}

/**
 * Gives the agent added without a key its first key, with the `items` written too, and returns it.
 * Throws KeyChanged if it has one already, as when its sponsor rotated it first, or was removed.
 */
export async function issueAgentKey(table: Table, { agent, items }: { agent: string; items: TransactItem[] }): Promise<string> {
  const key = newAgentKey();
  const hash = agentKeyHash(key);
  await documents(table)
    .send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: table.name,
              Key: actorKey(agent),
              UpdateExpression: "SET keyHash = :hash",
              ConditionExpression: `attribute_exists(${pk}) AND attribute_not_exists(keyHash)`,
              ExpressionAttributeValues: { ":hash": hash },
            },
          },
          { Put: { TableName: table.name, Item: { ...agentKeyKey(hash), agent }, ...isNew } },
          ...items,
        ],
      }),
    )
    .catch((error: unknown) => {
      const changed = error instanceof TransactionCanceledException && error.CancellationReasons?.[0]?.Code === "ConditionalCheckFailed";
      throw changed ? new KeyChanged() : error;
    });
  return key;
}

/**
 * Gives the agent a new key, on behalf of the actor `by`, and returns it. The old key's hash is
 * deleted in the same transaction, so the authorizer refuses it from then on.
 */
export async function replaceAgentKey(table: Table, { agent, by }: { agent: string; by: string }): Promise<string> {
  const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: actorKey(agent), ConsistentRead: true }));
  if (Item?.kind !== "agent") throw new Error(`${agent} isn't an agent.`);
  // An agent approved through an access request has no key until it collects one.
  const old = Item.keyHash as string | undefined;
  const key = newAgentKey();
  const hash = agentKeyHash(key);
  const rotation = recordChange(table, by, { type: "agentKeyRotated", agent }, [
    {
      // If another rotation got there first, this one fails rather than leave two keys working.
      Update: {
        TableName: table.name,
        Key: actorKey(agent),
        UpdateExpression: "SET keyHash = :new",
        ...(old === undefined
          ? { ConditionExpression: "attribute_not_exists(keyHash)", ExpressionAttributeValues: { ":new": hash } }
          : { ConditionExpression: "keyHash = :old", ExpressionAttributeValues: { ":new": hash, ":old": old } }),
      },
    },
    ...(old === undefined ? [] : [{ Delete: { TableName: table.name, Key: agentKeyKey(old) } }]),
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

/** The actor ID Duva's own changes are recorded under, such as pausing an agent whose mail hurts the domain (ADR-0021). */
export const duva = "duva";

/**
 * Pauses the agent, on behalf of the actor `by`, or Duva, saying why if Duva did, with the `items`
 * written too, and returns it. The pause is one change in the organization's change feed. Pausing
 * a paused agent records nothing, and writes no items. Returns undefined if the agent was removed.
 */
export function pauseAgent(table: Table, { agent, by, reason, items = [] }: { agent: Agent; by: string; reason?: string; items?: TransactItem[] }): Promise<Agent | undefined> {
  const paused = { by, at: new Date().toISOString(), ...(reason !== undefined && { reason }) };
  return changePause(table, agent, by, items, {
    type: "agentPaused",
    done: (current) => current.paused !== undefined,
    update: { UpdateExpression: "SET paused = :paused", ConditionExpression: `attribute_exists(${pk}) AND attribute_not_exists(paused)`, ExpressionAttributeValues: { ":paused": paused } },
  });
}

/**
 * Unpauses the agent, on behalf of the actor `by`, and returns it. The unpause is one change in
 * the organization's change feed. Unpausing an agent that isn't paused records nothing. Its held sends are released apart from this. Returns
 * undefined if the agent was removed.
 */
export function unpauseAgent(table: Table, { agent, by }: { agent: Agent; by: string }): Promise<Agent | undefined> {
  return changePause(table, agent, by, [], {
    type: "agentUnpaused",
    done: (current) => current.paused === undefined,
    update: { UpdateExpression: "REMOVE paused", ConditionExpression: "attribute_exists(paused)" },
  });
}

/** Writes the pause or unpause with its change and the items, unless it is done already, and returns the agent as it is then, if it still is one. */
async function changePause(
  table: Table,
  agent: Agent,
  by: string,
  items: TransactItem[],
  { type, done, update }: { type: "agentPaused" | "agentUnpaused"; done: (current: Agent) => boolean; update: { UpdateExpression: string; ConditionExpression: string; ExpressionAttributeValues?: Record<string, unknown> } },
): Promise<Agent | undefined> {
  for (let attempt = 1; ; attempt++) {
    const current = await findActor(table, agent.id);
    if (current?.kind !== "agent") return undefined;
    if (done(current)) return current;
    try {
      await recordChange(table, by, { type, agent: agent.id }, [{ Update: { TableName: table.name, Key: actorKey(agent.id), ...update } }, ...items]);
    } catch (error) {
      // A pause or unpause at the same time got there first, so the agent is read again.
      if (!(error instanceof TransactionCanceledException) || attempt === 10) throw error;
      continue;
    }
    return (await findActor(table, agent.id)) as Agent | undefined;
  }
}

/** The check that the agent isn't paused, for a write that would let its mail go out. */
export function agentUnpaused(table: Table, agent: string): TransactItem {
  return { ConditionCheck: { TableName: table.name, Key: actorKey(agent), ConditionExpression: "attribute_not_exists(paused)" } };
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

/** The agent's sponsor has no mailbox, whose change feed would record a change to the agent's settings. */
export class NowhereToRecord extends Error {}

/** What each of an agent's settings is until its sponsor changes it. */
export const defaultAgentSettings: AgentSettings = {
  sponsorAccess: "none",
  sponsorMailboxes: null,
  approvalAsSponsor: true,
  disclosureLineAsSponsor: true,
  sendsPerHour: 100,
  newRecipientsPerDay: 50,
};

/** Each of an agent's send limits, with the organization's setting that caps it. */
export const limitCaps = { sendsPerHour: "agentSendsPerHourCap", newRecipientsPerDay: "agentNewRecipientsPerDayCap" } as const;

/** A send limit given is above the organization's cap. */
export class OverCap extends Error {
  readonly limit: keyof typeof limitCaps;
  readonly cap: number;
  constructor(limit: keyof typeof limitCaps, cap: number) {
    super(`${limit} is over the cap of ${cap}.`);
    this.limit = limit;
    this.cap = cap;
  }
}

/**
 * The agent's settings, each with its default until its sponsor changed it, with the version a
 * write that relies on them checks. Settings from before agents owned no mailboxes and were no
 * admins (ADR-0030), such as approvalForSetup, are left out.
 */
export async function agentSettings(table: Table, agent: string): Promise<ReadSettings<AgentSettings>> {
  const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: agentSettingsKey(agent), ConsistentRead: true }));
  const settings = Object.fromEntries(Object.entries(defaultAgentSettings).map(([name, value]) => [name, Item?.[name] ?? value])) as AgentSettings;
  // Send was called full until the levels between read and send came.
  if ((settings.sponsorAccess as string) === "full") settings.sponsorAccess = "send";
  return { settings, version: (Item?.version as number | undefined) ?? 0 };
}

/** The write of the agent's first settings, for the transaction that adds it. */
export const firstAgentSettings = (table: Table, agent: string, settings: AgentSettings): TransactItem => ({
  Put: { TableName: table.name, Item: { ...agentSettingsKey(agent), ...settings, version: 1 }, ...isNew },
});

/** The check that the agent's settings are still as read, for a write that relies on them. */
export function agentSettingsUnchanged(table: Table, agent: string, read: ReadSettings<AgentSettings>): TransactItem {
  return { ConditionCheck: { TableName: table.name, Key: agentSettingsKey(agent), ...atVersion(read) } };
}

/**
 * Changes the agent's settings, on behalf of its sponsor, or of the admin `by` who lowered a cap
 * below its send limits, and returns them all. The ones whose value changes are one change, with
 * their old and new values, in the change feed of each of the sponsor's mailboxes. Giving a
 * setting the value it has records nothing. Throws OverCap for a send limit over the
 * organization's cap, which holds only while the caps are still as read, and NowhereToRecord if
 * the sponsor has no mailbox for their change. The
 * `items` of the change, given its settings as they are after it, are written with it.
 */
export async function changeAgentSettings(
  table: Table,
  { agent, changes, by = agent.sponsor, items = () => [] }: { agent: Agent; changes: Partial<AgentSettings>; by?: string; items?: (after: AgentSettings) => TransactItem[] },
): Promise<AgentSettings> {
  const mailboxes = await ownedMailboxes(table, agent.sponsor);
  // A cap's lowering is in the organization's change feed even when no mailbox's has it.
  if (mailboxes.length === 0 && by === agent.sponsor) throw new NowhereToRecord();
  for (let attempt = 1; ; attempt++) {
    const caps = await organizationSettings(table);
    for (const limit of Object.keys(limitCaps) as (keyof typeof limitCaps)[]) {
      const cap = caps.settings[limitCaps[limit]];
      if ((changes[limit] ?? 0) > cap) throw new OverCap(limit, cap);
    }
    const read = await agentSettings(table, agent.id);
    const names = (Object.keys(defaultAgentSettings) as (keyof AgentSettings)[]).filter(
      (name) => changes[name] !== undefined && JSON.stringify(changes[name]) !== JSON.stringify(read.settings[name]),
    );
    if (names.length === 0) return read.settings;
    const settings = { ...read.settings, ...changes };
    const change = {
      type: "agentSettingsChanged",
      agent: agent.id,
      before: Object.fromEntries(names.map((name) => [name, read.settings[name]])),
      after: Object.fromEntries(names.map((name) => [name, settings[name]])),
    };
    try {
      await recordInFeeds(table, mailboxes.map(({ id }) => ({ feed: mailboxFeed(id), changes: [change] })), {
        by,
        items: [{ Put: { TableName: table.name, Item: { ...agentSettingsKey(agent.id), ...settings, version: read.version + 1 }, ...atVersion(read) } }, settingsUnchanged(table, caps), ...items(settings)],
      });
      return settings;
    } catch (error) {
      // The sponsor changed the settings, or an admin the caps, at the same time, so they are read
      // again. The items come after each feed's counter and change.
      const reasons = error instanceof TransactionCanceledException ? (error.CancellationReasons ?? []) : [];
      const changed = [reasons[2 * mailboxes.length], reasons[2 * mailboxes.length + 1]].some((reason) => reason?.Code === "ConditionalCheckFailed");
      if (!changed || attempt === 10) throw error;
    }
  }
}

/** The organization's first domain, which deploy brought, even if an admin has removed it since. */
export async function organizationDomain(table: Table): Promise<string> {
  const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: organizationKey }));
  if (Item === undefined) throw new Error(organizationFeed.missing);
  return Item.domain as string;
}

/**
 * One of the organization's domains, with the standalone domain it mirrors if it is an alias
 * domain, or its catch-all if it is a standalone domain with one.
 */
export interface OrganizationDomain {
  domain: string;
  aliasOf?: string;
  catchAll?: CatchAll;
}

/**
 * Lists the first domain with the domains admins add, in an organization from before they could,
 * once, so an admin's removal of it later lasts.
 */
async function listFirstDomain(table: Table): Promise<void> {
  const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: organizationKey, ConsistentRead: true }));
  if (Item === undefined || Item.domainsListed === true) return;
  await documents(table).send(
    new TransactWriteCommand({
      TransactItems: [
        { Put: { TableName: table.name, Item: { ...domainKey(Item.domain as string), domain: Item.domain } } },
        { Update: { TableName: table.name, Key: organizationKey, UpdateExpression: "SET domainsListed = :listed", ExpressionAttributeValues: { ":listed": true } } },
      ],
    }),
  );
}

/** The organization's domains, in alphabetical order. */
export async function allDomains(table: Table): Promise<OrganizationDomain[]> {
  const db = documents(table);
  const [{ Items = [] }, { Item: organization }] = await Promise.all([
    db.send(new QueryCommand({ TableName: table.name, KeyConditionExpression: `${pk} = :domains`, ExpressionAttributeValues: { ":domains": domainsPartition }, ConsistentRead: true })),
    db.send(new GetCommand({ TableName: table.name, Key: organizationKey, ConsistentRead: true })),
  ]);
  const domains: OrganizationDomain[] = Items.map(({ domain, aliasOf, catchAll }) => ({ domain, ...(aliasOf !== undefined && { aliasOf }), ...(catchAll !== undefined && { catchAll: catchAllOf(catchAll) }) }));
  // Until setup lists it, the first domain is only on the organization's item.
  if (organization !== undefined && organization.domainsListed !== true && !domains.some(({ domain }) => domain === organization.domain)) {
    domains.push({ domain: organization.domain as string });
  }
  return domains.sort((a, b) => a.domain.localeCompare(b.domain));
}

/** Each alias domain of the organization, with the standalone domain it mirrors. */
export async function aliasDomains(table: Table): Promise<Map<string, string>> {
  return new Map((await allDomains(table)).flatMap(({ domain, aliasOf }) => (aliasOf === undefined ? [] : [[domain, aliasOf] as const])));
}

/**
 * Adds the domain, on behalf of the admin `by`, as an alias domain of `aliasOf` if given, or a
 * standalone domain. Throws DomainTaken if the organization has it, and NotStandalone if `aliasOf`
 * isn't one of its standalone domains.
 */
export async function addDomain(table: Table, { domain, aliasOf, by }: { domain: string; aliasOf?: string; by: string }): Promise<void> {
  await listFirstDomain(table);
  const items: TransactItem[] = [{ Put: { TableName: table.name, Item: { ...domainKey(domain), domain, ...(aliasOf !== undefined && { aliasOf }) }, ...isNew } }];
  // The standalone domain must still be one, and no alias, when the alias is added.
  if (aliasOf !== undefined) {
    items.push({ ConditionCheck: { TableName: table.name, Key: domainKey(aliasOf), ConditionExpression: `attribute_exists(${pk}) AND attribute_not_exists(aliasOf)` } });
  }
  await recordChange(table, by, { type: "domainAdded", domain, ...(aliasOf !== undefined && { aliasOf }) }, items).catch((error: unknown) => {
    const reasons = error instanceof TransactionCanceledException ? (error.CancellationReasons ?? []) : [];
    if (reasons[2]?.Code === "ConditionalCheckFailed") throw new DomainTaken();
    if (reasons[3]?.Code === "ConditionalCheckFailed") throw new NotStandalone();
    throw error;
  });
}

/** The organization already has the domain. */
export class DomainTaken extends Error {}

/** The domain an alias domain was to mirror isn't one of the organization's standalone domains. */
export class NotStandalone extends Error {}

/** Removes the domains, on behalf of the admin `by`, each a change of its own. Their addresses are removed beforehand. */
export async function removeDomains(table: Table, { domains, by }: { domains: string[]; by: string }): Promise<void> {
  await listFirstDomain(table);
  await recordChanges(table, organizationFeed, {
    by,
    changes: domains.map((domain) => ({ type: "domainRemoved", domain })) satisfies ChangeDetails[],
    items: domains.map((domain) => ({ Delete: { TableName: table.name, Key: domainKey(domain) } })),
  });
}

/** The catch-all an item stores, as the contract has it. */
const catchAllOf = ({ mailbox, group }: CatchAll): CatchAll => (mailbox !== undefined ? { mailbox } : { group: group! });

const sameCatchAll = (a: CatchAll | undefined, b: CatchAll | undefined) => a?.mailbox === b?.mailbox && a?.group === b?.group;

/**
 * Makes the mailbox or group the standalone domain's catch-all, or clears it without one, on
 * behalf of the admin `by`, and records nothing if it already is. Throws NotStandalone if the
 * organization doesn't have the domain as a standalone domain, and NoCatchAll if it has no such
 * mailbox or group.
 */
export async function setCatchAll(table: Table, { domain, catchAll, by }: { domain: string; catchAll?: CatchAll; by: string }): Promise<void> {
  await listFirstDomain(table);
  const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: domainKey(domain), ConsistentRead: true }));
  if (Item === undefined || Item.aliasOf !== undefined) throw new NotStandalone();
  if (sameCatchAll(Item.catchAll as CatchAll | undefined, catchAll)) return;
  const write: TransactItem = {
    Update: {
      TableName: table.name,
      Key: domainKey(domain),
      UpdateExpression: catchAll === undefined ? "REMOVE catchAll" : "SET catchAll = :catchAll",
      ConditionExpression: `attribute_exists(${pk}) AND attribute_not_exists(aliasOf)`,
      ...(catchAll !== undefined && { ExpressionAttributeValues: { ":catchAll": catchAll } }),
    },
  };
  // The mailbox or group must still be there when it becomes the catch-all, so its deletion clears it.
  const target: TransactItem[] =
    catchAll === undefined
      ? []
      : catchAll.mailbox !== undefined
        ? [{ ConditionCheck: { TableName: table.name, Key: mailboxKey(catchAll.mailbox), ConditionExpression: `attribute_exists(${pk}) AND attribute_not_exists(deleted)` } }]
        : [{ ConditionCheck: { TableName: table.name, Key: groupKey(catchAll.group!), ConditionExpression: `attribute_exists(${pk})` } }];
  await recordChange(table, by, { type: "catchAllChanged", domain, ...(catchAll !== undefined && { catchAll }) }, [write, ...target]).catch((error: unknown) => {
    const reasons = error instanceof TransactionCanceledException ? (error.CancellationReasons ?? []) : [];
    if (reasons[2]?.Code === "ConditionalCheckFailed") throw new NotStandalone();
    if (reasons[3]?.Code === "ConditionalCheckFailed") throw new NoCatchAll();
    throw error;
  });
}

/**
 * What the catch-all is, a mailbox, by its ID, or a group, or undefined if there is none or it is
 * gone, as when its deletion stopped before clearing it.
 */
export async function catchAllTarget(table: Table, catchAll: CatchAll | undefined): Promise<{ mailbox: string } | { group: Group } | undefined> {
  if (catchAll?.mailbox !== undefined) return (await findMailbox(table, catchAll.mailbox)) === undefined ? undefined : { mailbox: catchAll.mailbox };
  const group = catchAll?.group === undefined ? undefined : await findGroup(table, catchAll.group);
  return group === undefined ? undefined : { group };
}

/** The organization has no such mailbox or group for a catch-all. */
export class NoCatchAll extends Error {}

/** Clears every catch-all that is the mailbox or the group, which is gone, on behalf of the actor `by`. */
async function clearCatchAlls(table: Table, { catchAll, by }: { catchAll: CatchAll; by: string }): Promise<void> {
  for (const { domain } of (await allDomains(table)).filter((each) => sameCatchAll(each.catchAll, catchAll))) {
    await recordChange(table, by, { type: "catchAllChanged", domain }, [
      {
        Update: {
          TableName: table.name,
          Key: domainKey(domain),
          UpdateExpression: "REMOVE catchAll",
          ConditionExpression: "catchAll.#kind = :target",
          ExpressionAttributeNames: { "#kind": catchAll.mailbox !== undefined ? "mailbox" : "group" },
          ExpressionAttributeValues: { ":target": catchAll.mailbox ?? catchAll.group },
        },
      },
    ]).catch((error: unknown) => {
      // Another admin changed it meanwhile, or the domain is gone.
      if (!(error instanceof TransactionCanceledException && error.CancellationReasons?.[2]?.Code === "ConditionalCheckFailed")) throw error;
    });
  }
}

/** Records that sign-in codes come from the domain from now on, as chosen by the admin `by`. */
export async function recordSignInDomain(table: Table, { domain, by }: { domain: string; by: string }): Promise<void> {
  await recordChange(table, by, { type: "signInDomainChanged", domain }, []);
}

/**
 * Adds a personal mailbox owned by the human `owner`, with the address as its default address and
 * its Screener on, on behalf of the actor `by`. Throws AddressTaken if another mailbox has the
 * address.
 */
export async function addMailbox(table: Table, { owner, address, by }: { owner: string; address: string; by: string }): Promise<Mailbox> {
  const mailbox: Mailbox = { id: randomUUID(), kind: "personal", owner, defaultAddress: address, addresses: [address] };
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
      { Put: { TableName: table.name, Item: { ...screenerKey(mailbox.id), state: "on" } } },
      { Put: { TableName: table.name, Item: mailboxListedKey(mailbox.id) } },
    ],
  }).catch((error: unknown) => {
    const taken = error instanceof TransactionCanceledException && error.CancellationReasons?.[5]?.Code === "ConditionalCheckFailed";
    throw taken ? new AddressTaken() : error;
  });
  return mailbox;
}

/** Another mailbox has the address. */
export class AddressTaken extends Error {}

/** An address and the mailbox it delivers to. */
export type Address = components["schemas"]["Address"];

/**
 * Gives the mailbox the address, on behalf of the actor `by`. A mailbox with no address takes it as
 * its default address. Throws AddressTaken if the organization has the address already.
 */
export async function addAddress(table: Table, { mailbox, address, by }: { mailbox: string; address: string; by: string }): Promise<void> {
  await changingAddresses(table, mailbox, by, ({ addresses, defaultAddress }) => ({
    addresses: [...addresses, address],
    defaultAddress: defaultAddress ?? address,
    changes: [{ type: "addressAdded", address, mailbox }],
    items: [{ Put: { TableName: table.name, Item: { ...addressKey(address), address, mailbox }, ...isNew } }],
  })).catch((error: unknown) => {
    if (error instanceof ItemChanged) throw new AddressTaken();
    throw error;
  });
}

/**
 * Removes the address, on behalf of the actor `by`, and returns it with the mailbox it delivered
 * to, or undefined if the organization has no such address. If it was its mailbox's default
 * address, the mailbox's earliest other address becomes its default, if it has one.
 */
export async function removeAddress(table: Table, { address, by }: { address: string; by: string }): Promise<Address | undefined> {
  for (let attempt = 1; ; attempt++) {
    // Only the organization's own addresses, never one an alias domain mirrors.
    const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: addressKey(address), ConsistentRead: true }));
    const mailbox = Item?.mailbox as string | undefined;
    if (mailbox === undefined) return undefined;
    try {
      await changingAddresses(table, mailbox, by, ({ addresses, defaultAddress }) => {
        const left = addresses.filter((each) => each !== address);
        return {
          addresses: left,
          defaultAddress: defaultAddress === address ? left[0] : defaultAddress,
          changes: [{ type: "addressRemoved", address, mailbox }],
          items: [
            { Delete: { TableName: table.name, Key: addressKey(address), ConditionExpression: "mailbox = :mailbox", ExpressionAttributeValues: { ":mailbox": mailbox } } },
            { Put: { TableName: table.name, Item: mailboxListedKey(mailbox) } },
          ],
        };
      });
      return { address, mailbox };
    } catch (error) {
      // Another admin removed the address meanwhile, and may have given it to another mailbox.
      if (!(error instanceof ItemChanged) || attempt === 10) throw error;
    }
  }
}

/**
 * Makes the address the mailbox's default address, on behalf of the actor `by`, and returns the
 * mailbox. Throws NotItsAddress if the mailbox doesn't have it.
 */
export async function chooseDefaultAddress(table: Table, { mailbox, address, by }: { mailbox: string; address: string; by: string }): Promise<Mailbox> {
  return changingAddresses(table, mailbox, by, ({ addresses }) => {
    if (!addresses.includes(address)) throw new NotItsAddress();
    return { addresses, defaultAddress: address, changes: [], items: [] };
  });
}

/**
 * Whether the address, with or without a plus tag and in any case, is one of the mailbox's, or one
 * an alias domain mirrors, given each alias domain with its standalone domain.
 */
export const isAddressOf = (mailbox: Mailbox, address: string, aliases: Map<string, string>) => mailbox.addresses.includes(mirroredAddress(address, aliases));

/** The mailbox doesn't have the address. */
export class NotItsAddress extends Error {}

/** An item the change relies on is no longer as it was read. */
class ItemChanged extends Error {}

/**
 * Changes the mailbox's addresses and default address as `change` gives them from the mailbox as
 * it is, with the change's own items and changes in the organization's change feed, and a change
 * of default address if there is one. The mailbox is written only if it is still as read, so of
 * two changes at once, the later reads it again. Throws ItemChanged if one of the change's own
 * items fails its condition, and returns the mailbox as changed.
 */
async function changingAddresses(
  table: Table,
  id: string,
  by: string,
  change: (mailbox: Mailbox) => { addresses: string[]; defaultAddress: string | undefined; changes: ChangeDetails[]; items: TransactItem[] },
): Promise<Mailbox> {
  for (let attempt = 1; ; attempt++) {
    const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: mailboxKey(id), ConsistentRead: true }));
    if (Item === undefined) throw new Error(`The mailbox ${id} is missing.`);
    const read = mailboxOf(Item as Mailbox);
    const { addresses, defaultAddress, changes, items } = change(read);
    const chosen: ChangeDetails[] = defaultAddress === read.defaultAddress ? [] : [{ type: "defaultAddressChanged", mailbox: id, defaultAddress }];
    const all = [...changes, ...chosen];
    const changed: Mailbox = { ...read, addresses, defaultAddress };
    if (all.length === 0) return read;
    // A mailbox from before it had several addresses has only its default address.
    const was = (name: string, value: unknown, placeholder: string) => (value === undefined ? `attribute_not_exists(${name})` : `${name} = ${placeholder}`);
    const write: TransactItem = {
      Update: {
        TableName: table.name,
        Key: mailboxKey(id),
        UpdateExpression: defaultAddress === undefined ? "SET addresses = :addresses REMOVE defaultAddress" : "SET addresses = :addresses, defaultAddress = :default",
        ConditionExpression: [was("addresses", Item.addresses, ":read"), was("defaultAddress", Item.defaultAddress, ":readDefault")].join(" AND "),
        ExpressionAttributeValues: {
          ":addresses": addresses,
          ...(defaultAddress !== undefined && { ":default": defaultAddress }),
          ...(Item.addresses !== undefined && { ":read": Item.addresses }),
          ...(Item.defaultAddress !== undefined && { ":readDefault": Item.defaultAddress }),
        },
      },
    };
    try {
      await recordChanges(table, organizationFeed, { by, changes: all, items: [write, ...items] });
      return mailboxOf(changed);
    } catch (error) {
      const reasons = error instanceof TransactionCanceledException ? (error.CancellationReasons ?? []) : [];
      const failed = (index: number) => reasons[1 + all.length + index]?.Code === "ConditionalCheckFailed";
      if (items.some((_, index) => failed(1 + index))) throw new ItemChanged();
      if (!failed(0) || attempt === 10) throw error;
    }
  }
}

/** The mailbox with the ID, or undefined if the organization has none, or has deleted it. */
export async function findMailbox(table: Table, id: string): Promise<Mailbox | undefined> {
  const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: mailboxKey(id), ConsistentRead: true }));
  return Item === undefined || Item.deleted === true ? undefined : mailboxOf(Item as Mailbox);
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

/** The address an address on an alias domain mirrors, or the address itself, in lower case and without its plus tag. */
export function mirroredAddress(address: string, aliases: Map<string, string>): string {
  const untagged = address.toLowerCase().replace(/\+[^@]*@/, "@");
  const at = untagged.lastIndexOf("@");
  const standalone = aliases.get(untagged.slice(at + 1));
  return standalone === undefined ? untagged : `${untagged.slice(0, at)}@${standalone}`;
}

/**
 * Every address SES receives mail for: the organization's own, and the ones each alias domain
 * mirrors, groups' included, each with the mailbox it delivers to or as a group's.
 */
export async function receivingAddresses(table: Table): Promise<Address[]> {
  const [own, aliases] = await Promise.all([allAddresses(table), aliasDomains(table)]);
  const mirrored = [...aliases].flatMap(([alias, standalone]) =>
    own.filter(({ address }) => address.endsWith(`@${standalone}`)).map(({ address, ...target }) => ({ address: `${address.slice(0, address.lastIndexOf("@"))}@${alias}`, ...target })),
  );
  return [...own, ...mirrored];
}

/** Every address in the organization, each with the mailbox it delivers to or as a group's, in alphabetical order. */
export async function allAddresses(table: Table): Promise<Address[]> {
  const addresses: Address[] = [];
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
    for (const item of page.Items ?? []) addresses.push(item.group === true ? { address: item.address as string, group: true } : { address: item.address as string, mailbox: item.mailbox as string });
    start = page.LastEvaluatedKey;
  } while (start !== undefined);
  return addresses;
}

/**
 * What the address is: a mailbox's, by the mailbox's ID, or a group, or undefined if the
 * organization has no such address. An address on an alias domain is what the same local part is
 * on its standalone domain.
 */
export async function addressTarget(table: Table, address: string): Promise<{ mailbox: string } | { group: Group } | undefined> {
  const db = documents(table);
  let { Item } = await db.send(new GetCommand({ TableName: table.name, Key: addressKey(address), ConsistentRead: true }));
  const at = address.lastIndexOf("@");
  if (Item === undefined) {
    const { Item: domain } = await db.send(new GetCommand({ TableName: table.name, Key: domainKey(address.slice(at + 1)), ConsistentRead: true }));
    if (domain?.aliasOf === undefined) return undefined;
    ({ Item } = await db.send(new GetCommand({ TableName: table.name, Key: addressKey(`${address.slice(0, at)}@${domain.aliasOf}`), ConsistentRead: true })));
    if (Item === undefined) return undefined;
  }
  if (Item.group !== true) return { mailbox: Item.mailbox as string };
  const group = await findGroup(table, Item.address as string);
  return group === undefined ? undefined : { group };
}

/**
 * Adds the group, with its address, on behalf of the actor `by`. Throws AddressTaken if the
 * organization has the address already.
 */
export async function addGroup(table: Table, { group, by }: { group: Group; by: string }): Promise<void> {
  await recordChange(table, by, { type: "groupAdded", group }, [
    { Put: { TableName: table.name, Item: { ...addressKey(group.address), address: group.address, group: true }, ...isNew } },
    { Put: { TableName: table.name, Item: { ...groupKey(group.address), ...group } } },
  ]).catch((error: unknown) => {
    const taken = error instanceof TransactionCanceledException && error.CancellationReasons?.[2]?.Code === "ConditionalCheckFailed";
    throw taken ? new AddressTaken() : error;
  });
}

/** The group at the address, or undefined if the organization has none there. */
export async function findGroup(table: Table, address: string): Promise<Group | undefined> {
  const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: groupKey(address), ConsistentRead: true }));
  return Item === undefined ? undefined : groupOf(Item as Group);
}

/** The organization's groups, in alphabetical order of their addresses. */
export async function allGroups(table: Table): Promise<Group[]> {
  const groups = await Promise.all((await allAddresses(table)).filter(({ group }) => group).map(({ address }) => findGroup(table, address)));
  return groups.filter((group) => group !== undefined);
}

/**
 * Replaces the group at the group's address with it, on behalf of the actor `by`. Throws NoGroup if
 * the organization has no group there.
 */
export async function changeGroup(table: Table, { group, by }: { group: Group; by: string }): Promise<void> {
  await recordChange(table, by, { type: "groupChanged", group }, [
    { Put: { TableName: table.name, Item: { ...groupKey(group.address), ...group }, ConditionExpression: `attribute_exists(${pk})` } },
  ]).catch((error: unknown) => {
    const gone = error instanceof TransactionCanceledException && error.CancellationReasons?.[2]?.Code === "ConditionalCheckFailed";
    throw gone ? new NoGroup() : error;
  });
}

/** Removes the group and its address, on behalf of the actor `by`, and returns it, or undefined if the organization has no group there. */
export async function removeGroup(table: Table, { address, by }: { address: string; by: string }): Promise<Group | undefined> {
  const group = await findGroup(table, address);
  if (group === undefined) return undefined;
  try {
    await recordChange(table, by, { type: "groupRemoved", address }, [
      { Delete: { TableName: table.name, Key: addressKey(address), ConditionExpression: "#group = :group", ExpressionAttributeNames: { "#group": "group" }, ExpressionAttributeValues: { ":group": true } } },
      { Delete: { TableName: table.name, Key: groupKey(address), ConditionExpression: `attribute_exists(${pk})` } },
    ]);
  } catch (error) {
    // Another admin removed it meanwhile.
    const gone = error instanceof TransactionCanceledException && error.CancellationReasons?.some(({ Code }) => Code === "ConditionalCheckFailed");
    if (gone) return undefined;
    throw error;
  }
  await clearCatchAlls(table, { catchAll: { group: address }, by });
  return group;
}

/**
 * Takes the address out of every group it is a member of, on behalf of the actor `by`, each a change
 * of that group, so whoever gets the address next isn't a member through it.
 */
export async function removeMember(table: Table, { address, by }: { address: string; by: string }): Promise<void> {
  for (const group of await allGroups(table)) {
    if (!group.members.includes(address)) continue;
    await changeGroup(table, { group: { ...group, members: group.members.filter((member) => member !== address) }, by }).catch((error: unknown) => {
      // It was deleted meanwhile, which takes the address out too.
      if (!(error instanceof NoGroup)) throw error;
    });
  }
}

/** The organization has no group at the address. */
export class NoGroup extends Error {}

/** The group an item stores, in the order the contract lists its fields. */
const groupOf = ({ address, members, sendPolicy, replyTo }: Group): Group => ({ address, members, sendPolicy, replyTo });

/** The IDs of every mailbox in the organization, those with no address included. */
export async function allMailboxes(table: Table): Promise<string[]> {
  const mailboxes = new Set<string>();
  let start: Record<string, unknown> | undefined;
  do {
    const page = await documents(table).send(
      new QueryCommand({
        TableName: table.name,
        KeyConditionExpression: `${pk} = :mailboxes`,
        ExpressionAttributeValues: { ":mailboxes": mailboxesPartition },
        ConsistentRead: true,
        ExclusiveStartKey: start,
      }),
    );
    for (const item of page.Items ?? []) mailboxes.add((item[sk] as string).slice(mailboxListedPrefix.length));
    start = page.LastEvaluatedKey;
  } while (start !== undefined);
  for (const { mailbox } of await allAddresses(table)) if (mailbox !== undefined) mailboxes.add(mailbox);
  return [...mailboxes];
}

/**
 * The mailbox an item stores, in the order the contract lists its fields. A mailbox from before it
 * could have several addresses has only its default address.
 */
const mailboxOf = ({ id, kind, owner, defaultAddress, addresses }: Partial<Mailbox>): Mailbox => ({
  id: id!,
  kind: kind!,
  owner: owner!,
  ...(defaultAddress !== undefined && { defaultAddress }),
  addresses: addresses ?? (defaultAddress === undefined ? [] : [defaultAddress]),
});

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
  if (actor.kind === "agent") {
    // An agent stored before agents were never admins (ADR-0030) may still carry admin, which is left out.
    const { id, kind, name, sponsor, paused, mailbox } = actor;
    return {
      id,
      kind,
      name,
      sponsor,
      ...(paused !== undefined && { paused: { by: paused.by, at: paused.at, ...(paused.reason !== undefined && { reason: paused.reason }) } }),
      ...(mailbox !== undefined && { mailbox }),
    };
  }
  return { id: actor.id, kind: actor.kind, email: actor.email, admin: actor.admin };
}

/** Records one change to the setup in the organization's change feed, with the items it writes. */
export function recordChange(table: Table, by: string, change: ChangeDetails, items: TransactItem[]): Promise<void> {
  return recordChanges(table, organizationFeed, { by, changes: [change], items });
}

/** The organization's changes after the position, oldest first, at most changesPerPage of them. */
export async function organizationChanges(table: Table, after: number): Promise<OrganizationChange[]> {
  const changes = await changesAfter(table, organizationFeed, after);
  for (const change of changes) {
    if (change.added !== undefined) change.added = actorOf(change.added as Record<string, unknown>);
    if (change.removed !== undefined) change.removed = actorOf(change.removed as Record<string, unknown>);
    if (change.mailbox !== undefined && typeof change.mailbox === "object") change.mailbox = mailboxOf(change.mailbox as Mailbox);
    if (change.group !== undefined && typeof change.group === "object") change.group = groupOf(change.group as Group);
  }
  return changes as OrganizationChange[];
}

/** What each setting is until an admin changes it. */
export const defaultSettings: OrganizationSettings = {
  erasureErasesApprovals: false,
  retentionDays: 30,
  searchLanguages: defaultSearchLanguages,
  agentSendsPerHourCap: 100,
  agentNewRecipientsPerDayCap: 50,
  undoWindowSeconds: 30,
  mailboxAgentModel: defaultMailboxAgentModel,
  ...defaultModelRegion("eu-north-1"),
  mailboxAgentSpendCap: 20,
};

/** Settings as read, with the version a write that relies on them checks. */
export interface ReadSettings<Settings = OrganizationSettings> {
  settings: Settings;
  version: number;
}

/**
 * The organization's settings, each with its default until an admin changed it. Where the mailbox
 * agents call their model defaults to what suits the deployment's region, when it is given.
 */
export async function organizationSettings(table: Table, region?: string): Promise<ReadSettings> {
  const { settings, version } = await storedSettings(table);
  const defaults = { ...defaultSettings, ...(region !== undefined && defaultModelRegion(region)) };
  return { settings: { ...defaults, ...settings } as OrganizationSettings, version };
}

/** The settings an admin changed, with the version a write that relies on them checks. */
async function storedSettings(table: Table): Promise<ReadSettings<Partial<OrganizationSettings>>> {
  const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: settingsKey, ConsistentRead: true }));
  const settings = Object.fromEntries(Object.keys(defaultSettings).flatMap((name) => (Item?.[name] === undefined ? [] : [[name, Item[name]]])));
  return { settings, version: (Item?.version as number | undefined) ?? 0 };
}

/** The write that holds only while the settings are still as read. */
export function settingsUnchanged(table: Table, read: ReadSettings): TransactItem {
  return { ConditionCheck: { TableName: table.name, Key: settingsKey, ...atVersion(read) } };
}

const atVersion = ({ version }: { version: number }) => (version === 0 ? isNew : { ConditionExpression: "version = :version", ExpressionAttributeValues: { ":version": version } });

/**
 * Changes the settings, on behalf of the admin `by`, recording the ones whose value changes in
 * the organization's change feed, and returns them all. Giving a setting the value it has records
 * nothing.
 */
export async function changeSettings(table: Table, { by, changes, region }: { by: string; changes: Partial<OrganizationSettings>; region?: string }): Promise<OrganizationSettings> {
  // recordChange gives the items' cancellation reasons after the counter's and the one change's.
  const settingsReason = 2;
  for (let attempt = 1; ; attempt++) {
    const read = await organizationSettings(table, region);
    // A list of languages is a value too, so values are compared as JSON.
    const changed = Object.fromEntries(Object.entries(changes).filter(([name, value]) => JSON.stringify(read.settings[name as keyof OrganizationSettings]) !== JSON.stringify(value)));
    if (Object.keys(changed).length === 0) return read.settings;
    // Only what admins changed is stored, so a default stays the default.
    const stored = (await storedSettings(table)).settings;
    try {
      await recordChange(table, by, { type: "settingsChanged", settings: changed }, [
        { Put: { TableName: table.name, Item: { ...settingsKey, ...stored, ...changed, version: read.version + 1 }, ...atVersion(read) } },
      ]);
      return { ...read.settings, ...changed };
    } catch (error) {
      // Another admin changed the settings since they were read, so they are read again.
      const reasons = error instanceof TransactionCanceledException ? (error.CancellationReasons ?? []) : [];
      if (reasons[settingsReason]?.Code !== "ConditionalCheckFailed" || attempt === 10) throw error;
    }
  }
}

/**
 * Lowers each agent's send limits that are above the organization's caps to them, on behalf of
 * the admin `by` who lowered a cap, each recorded as a change to the agent's settings, with the
 * `items` for the agent written too. Run again, it finishes what an earlier run left.
 */
export async function lowerLimitsToCaps(table: Table, by: string, items: (agent: Agent, after: AgentSettings) => TransactItem[] = () => []): Promise<void> {
  const { settings: caps } = await organizationSettings(table);
  for (const human of await allHumans(table)) {
    for (const agent of await sponsoredAgents(table, human.id)) {
      const { settings } = await agentSettings(table, agent.id);
      const lowered = Object.fromEntries(
        (Object.keys(limitCaps) as (keyof typeof limitCaps)[]).filter((limit) => settings[limit] > caps[limitCaps[limit]]).map((limit) => [limit, caps[limitCaps[limit]]]),
      );
      if (Object.keys(lowered).length > 0) await changeAgentSettings(table, { agent, changes: lowered, by, items: (after) => items(agent, after) });
    }
  }
}

/**
 * Hands the mailbox, with its addresses and mail, to the human `to`, on behalf of the admin `by`.
 * Throws NotAHuman if `to` is no longer a human in the organization.
 */
export async function handOverMailbox(table: Table, { mailbox, to, by }: { mailbox: Mailbox; to: string; by: string }): Promise<void> {
  await recordChange(table, by, { type: "mailboxHandedOver", mailbox: mailbox.id, from: mailbox.owner, to }, [
    {
      Update: {
        TableName: table.name,
        Key: mailboxKey(mailbox.id),
        UpdateExpression: "SET #owner = :to",
        ConditionExpression: "#owner = :from AND attribute_not_exists(deleted)",
        ExpressionAttributeNames: { "#owner": "owner" },
        ExpressionAttributeValues: { ":to": to, ":from": mailbox.owner },
      },
    },
    { Delete: { TableName: table.name, Key: ownedKey(mailbox.owner, mailbox.id) } },
    { Put: { TableName: table.name, Item: ownedKey(to, mailbox.id) } },
    { ConditionCheck: { TableName: table.name, Key: actorKey(to), ConditionExpression: "kind = :human", ExpressionAttributeValues: { ":human": "human" } } },
  ]).catch((error: unknown) => {
    const gone = error instanceof TransactionCanceledException && error.CancellationReasons?.[5]?.Code === "ConditionalCheckFailed";
    throw gone ? new NotAHuman() : error;
  });
}

/** The actor a mailbox was to be handed to isn't a human in the organization. */
export class NotAHuman extends Error {}

/**
 * Deletes the mailbox, on behalf of the actor `by`, with the items that hand its mail to the
 * eraser. Its addresses go at once, so they can be given again, and the mailbox is kept, marked
 * deleted, only as the counter of its change feed, where its erasure is recorded. Its addresses
 * leave every group they were members of.
 */
export async function deleteMailbox(table: Table, { mailbox, by, items }: { mailbox: string; by: string; items: TransactItem[] }): Promise<void> {
  let addresses: string[];
  for (let attempt = 1; ; attempt++) {
    const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: mailboxKey(mailbox), ConsistentRead: true }));
    if (Item === undefined || Item.deleted === true) return;
    const { owner, ...read } = mailboxOf(Item as Mailbox);
    addresses = read.addresses;
    try {
      await recordChanges(table, organizationFeed, {
        by,
        changes: [{ type: "mailboxDeleted", mailbox }, ...addresses.map((address) => ({ type: "addressRemoved" as const, address, mailbox }))] satisfies ChangeDetails[],
        items: [
          {
            // An address given or removed meanwhile has the mailbox read again.
            Update: {
              TableName: table.name,
              Key: mailboxKey(mailbox),
              UpdateExpression: "SET deleted = :deleted",
              ConditionExpression: Item.addresses === undefined ? "attribute_not_exists(addresses)" : "addresses = :read",
              ExpressionAttributeValues: { ":deleted": true, ...(Item.addresses !== undefined && { ":read": Item.addresses }) },
            },
          },
          { Delete: { TableName: table.name, Key: ownedKey(owner, mailbox) } },
          { Delete: { TableName: table.name, Key: mailboxListedKey(mailbox) } },
          ...addresses.map((address) => ({
            Delete: { TableName: table.name, Key: addressKey(address), ConditionExpression: "mailbox = :mailbox", ExpressionAttributeValues: { ":mailbox": mailbox } },
          })),
          ...items,
        ],
      });
      break;
    } catch (error) {
      // The mailbox's own item comes after the feed's counter and its changes.
      const reasons = error instanceof TransactionCanceledException ? (error.CancellationReasons ?? []) : [];
      if (reasons[2 + addresses.length]?.Code !== "ConditionalCheckFailed" || attempt === 10) throw error;
    }
  }
  for (const address of addresses) await removeMember(table, { address, by });
  await clearCatchAlls(table, { catchAll: { mailbox }, by });
}

/**
 * Removes the agent, on behalf of the actor `by`, so its key stops working at once, with the
 * `items` written too.
 */
export async function removeAgentFromOrganization(table: Table, { agent, by, items = [] }: { agent: Agent; by: string; items?: TransactItem[] }): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: actorKey(agent.id), ConsistentRead: true }));
    if (Item === undefined) return;
    // An agent approved through an access request has no key until it collects one.
    const hash = Item.keyHash as string | undefined;
    const keyAsRead =
      hash === undefined ? { ConditionExpression: "attribute_not_exists(keyHash)" } : { ConditionExpression: "keyHash = :hash", ExpressionAttributeValues: { ":hash": hash } };
    try {
      await recordChange(table, by, { type: "actorRemoved", removed: agent }, [
        // A rotation at the same time leaves another key, so the removal reads it again.
        { Delete: { TableName: table.name, Key: actorKey(agent.id), ...keyAsRead } },
        ...(hash === undefined ? [] : [{ Delete: { TableName: table.name, Key: agentKeyKey(hash) } }]),
        { Delete: { TableName: table.name, Key: sponsoredKey(agent.sponsor, agent.id) } },
        { Delete: { TableName: table.name, Key: agentSettingsKey(agent.id) } },
        ...items,
      ]);
      break;
    } catch (error) {
      const rotated = error instanceof TransactionCanceledException && error.CancellationReasons?.[2]?.Code === "ConditionalCheckFailed";
      if (!rotated || attempt === 10) throw error;
    }
  }
  await deletePartition(table, actorKey(agent.id)[pk]!);
}

/**
 * Removes the human, on behalf of the admin `by`, so no session of theirs works from then on.
 * Their mailboxes are handed over or deleted, and their agents removed, beforehand. Throws
 * LastAdmin if they are the organization's last admin.
 */
export async function removeHumanFromOrganization(table: Table, { human, by }: { human: Human; by: string }): Promise<void> {
  await keepingAnAdmin(table, human, (anotherAdmin) =>
    recordChange(table, by, { type: "actorRemoved", removed: human }, [
      { Delete: { TableName: table.name, Key: actorKey(human.id), ConditionExpression: `attribute_exists(${pk})` } },
      ...anotherAdmin,
      { Delete: { TableName: table.name, Key: humanListedKey(human.id) } },
    ]),
  );
  // What is left in their partition, such as their preferences, goes too.
  await deletePartition(table, actorKey(human.id)[pk]!);
}

/** Forgets the sub of a removed human's Cognito user, which pointed at their actor. */
export async function forgetSignIn(table: Table, sub: string): Promise<void> {
  await documents(table).send(new DeleteCommand({ TableName: table.name, Key: signInKey(sub) }));
}

/** The human is the organization's last admin, which it always keeps. */
export class LastAdmin extends Error {}

/**
 * Makes the human an admin, or takes it away, on behalf of the admin `by`, and returns them.
 * Giving the flag the value it has records nothing. Throws LastAdmin if it would leave the
 * organization without one.
 */
export async function changeAdmin(table: Table, { human, admin, by }: { human: Human; admin: boolean; by: string }): Promise<Human> {
  if (human.admin === admin) return human;
  const change = (anotherAdmin: TransactItem[]) =>
    recordChange(table, by, { type: "adminChanged", human: human.id, admin }, [
      {
        Update: {
          TableName: table.name,
          Key: actorKey(human.id),
          UpdateExpression: "SET admin = :admin",
          ConditionExpression: "admin = :was",
          ExpressionAttributeValues: { ":admin": admin, ":was": human.admin },
        },
      },
      ...anotherAdmin,
    ]);
  await (admin ? change([]) : keepingAnAdmin(table, human, change));
  return { ...human, admin };
}

/**
 * Writes what takes the human's admin away, if they are an admin, with a check that another
 * human still is, so of two admins taking each other's away at once one fails. Throws LastAdmin
 * if no other human is an admin.
 */
async function keepingAnAdmin(table: Table, human: Human, write: (anotherAdmin: TransactItem[]) => Promise<void>): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    const current = await findActor(table, human.id);
    if (current?.kind !== "human" || !current.admin) return write([]);
    const other = (await allHumans(table)).find(({ id, admin }) => admin && id !== human.id);
    if (other === undefined) throw new LastAdmin();
    // The write's own item comes after the feed's counter and the one change.
    const checkReason = 3;
    try {
      return await write([{ ConditionCheck: { TableName: table.name, Key: actorKey(other.id), ConditionExpression: "admin = :admin", ExpressionAttributeValues: { ":admin": true } } }]);
    } catch (error) {
      // The other admin's was taken away, or they were removed, since they were read, so the admins are read again.
      const reasons = error instanceof TransactionCanceledException ? (error.CancellationReasons ?? []) : [];
      if (reasons[checkReason]?.Code !== "ConditionalCheckFailed" || attempt === 10) throw error;
    }
  }
}

/** Deletes every item in the partition. */
async function deletePartition(table: Table, partition: string): Promise<void> {
  const db = documents(table);
  let start: Record<string, unknown> | undefined;
  do {
    const page = await db.send(
      new QueryCommand({
        TableName: table.name,
        KeyConditionExpression: `${pk} = :partition`,
        ExpressionAttributeValues: { ":partition": partition },
        ConsistentRead: true,
        ExclusiveStartKey: start,
      }),
    );
    for (const item of page.Items ?? []) await db.send(new DeleteCommand({ TableName: table.name, Key: { [pk]: item[pk], [sk]: item[sk] } }));
    start = page.LastEvaluatedKey;
  } while (start !== undefined);
}
