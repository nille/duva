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

/** A new token for a run of the mailbox agent, which works until the run ends it, or runTokenLifetime. */
export async function issueRunToken(table: Table, agent: string): Promise<string> {
  const token = runTokenPrefix + randomBytes(32).toString("base64url");
  const until = Date.now() + runTokenLifetime;
  // The time to live deletes it some time after it stops working.
  await documents(table).send(new PutCommand({ TableName: table.name, Item: { ...runKey(agentKeyHash(token)), agent, until, [timeToLiveAttribute]: Math.ceil(until / 1000) }, ...isNew }));
  return token;
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
