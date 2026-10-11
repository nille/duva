// The tokens a mailbox agent calls Duva with: one per run, which Duva mints when the run starts and
// ends when it ends (ADR-0027). Like an agent's key, only a hash is stored, and it resolves to the agent.
import { DeleteCommand, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { agentKeyHash } from "./agent-keys.ts";
import type { Table } from "./deployment.ts";
import { timeToLiveAttribute } from "./infrastructure.ts";
import { type Agent, findActor } from "./organization.ts";
import { randomBytes } from "node:crypto";
import { documents, isNew, pk, sk } from "./table.ts";

/** How every run token starts, so it is told from an agent's key. */
export const runTokenPrefix = "duva_run_";

/** How long a run token works at most, past the longest run AgentCore answers synchronously. */
export const runTokenLifetime = 20 * 60_000;

const runKey = (hash: string) => ({ [pk]: `run#${hash}`, [sk]: "run" });

/**
 * What a run is, for what it does with its human's secrets (ADR-0039): the turn of Ask Coo it
 * answers, by the human's turn's ID, or the label's task it does, with the mailbox whose change
 * feed records it, and the session it runs in, which a retry of the same turn or task doesn't share.
 */
export interface RunIdentity {
  turn?: string;
  task?: string;
  thread?: string;
  mailbox: string;
  session: string;
}

/**
 * A new token for a run of the mailbox agent, which works until the run ends it, or runTokenLifetime.
 * Only a run given its identity uses its human's secrets.
 */
export async function issueRunToken(table: Table, agent: string, run?: RunIdentity): Promise<string> {
  const token = runTokenPrefix + randomBytes(32).toString("base64url");
  const until = Date.now() + runTokenLifetime;
  // The time to live deletes it some time after it stops working.
  await documents(table).send(new PutCommand({ TableName: table.name, Item: { ...runKey(agentKeyHash(token)), agent, until, ...(run !== undefined && { run }), [timeToLiveAttribute]: Math.ceil(until / 1000) }, ...isNew }));
  return token;
}

/** The identity of the run whose token it is, while it works, if it was given one. */
export async function runOfToken(table: Table, token: string): Promise<RunIdentity | undefined> {
  if (!token.startsWith(runTokenPrefix)) return undefined;
  const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: runKey(agentKeyHash(token)), ConsistentRead: true }));
  if (Item === undefined || (Item.until as number) <= Date.now()) return undefined;
  return Item.run as RunIdentity | undefined;
}

/** The mailbox agent whose run the token is, or undefined if it is no run's that still works. */
export async function findAgentByRunToken(table: Table, token: string): Promise<Agent | undefined> {
  const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: runKey(agentKeyHash(token)), ConsistentRead: true }));
  if (Item === undefined || (Item.until as number) <= Date.now()) return undefined;
  const agent = await findActor(table, Item.agent as string);
  return agent?.kind === "agent" ? agent : undefined;
}

/** Ends the run's token, so it stops working at once. */
export async function endRunToken(table: Table, token: string): Promise<void> {
  await documents(table).send(new DeleteCommand({ TableName: table.name, Key: runKey(agentKeyHash(token)) }));
}
