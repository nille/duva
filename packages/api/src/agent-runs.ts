// A run of a mailbox agent (ADR-0027): what a turn of Ask your agent and a task (ADR-0029) share.
// Each run gets a token of its own, runs on AgentCore in a session of its own, and counts what its
// model calls cost toward the organization's spend cap for the month.
import { randomUUID } from "node:crypto";
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { AgentAction, RunEvent, RunPayload } from "./agent-loop.ts";
import { costOf } from "./agent-models.ts";
import { raiseAlert } from "./alerting.ts";
import type { Table } from "./deployment.ts";
import { sponsorAccessIn } from "./access.ts";
import { type Agent, agentSettings, type Mailbox, organizationSettings, switchesFor } from "./organization.ts";
import { endRunToken, issueRunToken } from "./run-tokens.ts";
import { documents, pk, sk } from "./table.ts";

/** Runs the mailbox agent on AgentCore, in the session, and gives what it says as it goes. */
export type AgentRuntime = (payload: RunPayload, session: string) => AsyncIterable<RunEvent>;

/** How a run ended. */
export type RunOutcome = Extract<RunEvent, { type: "end" }>["outcome"];

const spendKey = (month: string) => ({ [pk]: "organization", [sk]: `mailbox-agent-spend#${month}` });

/** The month an instant is in, as YYYY-MM in UTC, which the spend cap counts by. */
export const monthOf = (at: Date) => at.toISOString().slice(0, 7);

/** What the mailbox agents spent in the month, in US dollars. */
export async function spentIn(table: Table, month: string): Promise<number> {
  const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: spendKey(month), ConsistentRead: true }));
  return (Item?.spent as number | undefined) ?? 0;
}

/** Adds what a run cost to the month's spend, and returns the month's spend with it. */
async function addSpend(table: Table, month: string, cost: number): Promise<number> {
  const { Attributes } = await documents(table).send(
    new UpdateCommand({ TableName: table.name, Key: spendKey(month), UpdateExpression: "ADD spent :cost", ExpressionAttributeValues: { ":cost": cost }, ReturnValues: "ALL_NEW" }),
  );
  return Attributes!.spent as number;
}

/** Why no run starts where the stack left the runtime out. */
export const runtimeMissing = (region: string) => `Mailbox agents run on Amazon Bedrock AgentCore, which isn't in ${region}, where Duva is deployed.`;

/** Why no run starts in a mailbox from before mailbox agents, until deploy's setup gives it one. */
export const noMailboxAgent = "This mailbox has no mailbox agent yet. Ask an admin to run duva deploy, which gives every human's mailbox one.";

/** What every run starts with, before what it is asked. */
export type RunStart = Omit<RunPayload, "token" | "history" | "words" | "task">;

/**
 * What a run of the agent in its owner's mailbox starts with, with the month it counts toward and
 * the cap, or why it can't start: the agent has no access there, or the mailbox agents are off or
 * at the spend cap, which alerts its sponsor once a month.
 */
export async function startRun(
  table: Table,
  { agent, mailbox, owner, region, apiUrl }: { agent: Agent; mailbox: Mailbox; owner: string; region: string; apiUrl: string },
): Promise<{ refused: string } | { start: RunStart; month: string; cap: number }> {
  const { settings: given } = await agentSettings(table, agent.id);
  const access = sponsorAccessIn(given, mailbox.id);
  if (access === "none") return { refused: "Your mailbox agent has no access to this mailbox. Give it some in Settings, under Your agents." };
  const { settings } = await organizationSettings(table, region);
  const cap = settings.mailboxAgentSpendCap;
  if (cap === 0) return { refused: "An admin turned the mailbox agents off, with a spend cap of $0. Ask one to raise it." };
  const month = monthOf(new Date());
  const spent = await spentIn(table, month);
  if (spent >= cap) {
    await capReached(table, agent, month, cap);
    return { refused: capRefusal(cap) };
  }
  const start: RunStart = {
    apiUrl,
    mailbox: mailbox.id,
    address: mailbox.defaultAddress ?? mailbox.addresses[0] ?? "",
    owner,
    access,
    approval: switchesFor(given, true).approval,
    model: { model: settings.mailboxAgentModel, profile: settings.mailboxAgentProfile, region: settings.mailboxAgentRegion },
    budget: cap - spent,
    now: new Date().toISOString(),
  };
  return { start, month, cap };
}

export const capRefusal = (cap: number) => `The mailbox agents reached the organization's spend cap of $${cap} this month. Ask an admin to raise it.`;

/** Alerts the agent's sponsor that its run stopped at the cap, once a month. */
export function capReached(table: Table, agent: Agent, month: string, cap: number) {
  return raiseAlert(table, { kind: "spendCapReached", agent, what: `${agent.name} stopped, since the mailbox agents reached the organization's spend cap of $${cap} for ${month}. Ask an admin to raise it.` }, { source: `spend-cap#${month}` });
}

/**
 * Runs the agent with a token of its own, which ends with the run, giving its text and actions as
 * they come, and returns what it said and did, and how it ended. Each model call's cost is counted
 * as it comes, so a run cut off still counts what it spent, and a run that reaches the cap alerts
 * the agent's sponsor.
 */
export async function* runMailboxAgent(
  table: Table,
  { agent, payload, runtime, month, cap }: { agent: Agent; payload: Omit<RunPayload, "token">; runtime: AgentRuntime; month: string; cap: number },
): AsyncGenerator<Extract<RunEvent, { type: "text" | "action" }>, { text: string; actions: AgentAction[]; outcome: RunOutcome }> {
  const token = await issueRunToken(table, agent.id);
  let text = "";
  const actions: AgentAction[] = [];
  let outcome: RunOutcome = "failed";
  let total = 0;
  try {
    for await (const event of runtime({ ...payload, token } as RunPayload, `${agent.id}-${randomUUID()}`)) {
      if (event.type === "text") {
        text += event.text;
        yield event;
      } else if (event.type === "action") {
        actions.push(event.action);
        yield event;
      } else if (event.type === "usage") total = await addSpend(table, month, costOf(event, payload.model.model, payload.model.profile));
      else outcome = event.outcome;
    }
  } catch (error) {
    console.error(error);
    outcome = "failed";
  } finally {
    await endRunToken(table, token);
  }
  if (outcome === "capReached" || total >= cap) await capReached(table, agent, month, cap);
  return { text, actions, outcome };
}
