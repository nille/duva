// A run of a mailbox agent (ADR-0027): what a turn of Ask Coo and a task (ADR-0029) share.
// Each run gets a token of its own, runs on AgentCore in a session of its own, and counts what its
// model calls cost toward the organization's spend cap for the month.
import { randomUUID } from "node:crypto";
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { AgentAction, Decision, Handover, RunEvent, RunPayload } from "./agent-loop.ts";
import { costOf, type MailboxAgentModel } from "./agent-models.ts";
import { raiseAlert } from "./alerting.ts";
import type { Table } from "./deployment.ts";
import { sponsorAccessIn } from "./access.ts";
import { type Agent, agentSettings, type Mailbox, mailboxesInOrder, mailboxFeed, organizationSettings } from "./organization.ts";
import { recordChanges } from "./feed.ts";
import { cooModelsOf, learnsFromMail } from "./preferences.ts";
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

/** Why no run starts for a human from before mailbox agents, until deploy's setup gives them one. */
export const noMailboxAgent = "You have no mailbox agent yet. Ask an admin to run duva deploy, which gives every human with a mailbox one.";

/**
 * The job a run does, which decides the model it starts with (ADR-0032): a conversation turn, with
 * the everyday model unless the decider finds it complex, a label's task, with the everyday model,
 * and with the harder model a turn its owner asked to think harder, or unsubscribing on a sender's
 * page. Each is the model the agent's human chose, or the organization's default (ADR-0035).
 */
export type Job = "conversation" | "task" | "harder" | "unsubscribe";

/** What every run starts with, before what it is asked. */
export type RunStart = Omit<RunPayload, "token" | "history" | "words" | "task" | "unsubscribe">;

/**
 * What a run of the agent in its owner's mailboxes starts with, asked from one of them or from All
 * mailboxes, with the month it counts toward and the cap, or why it can't start: the agent has no
 * access there, or the mailbox agents are off or at the spend cap, which alerts its sponsor once a
 * month. It works in those of `mailboxes` its sponsor access covers.
 */
export async function startRun(
  table: Table,
  { agent, mailbox, mailboxes, owner, region, apiUrl, job }: { agent: Agent; mailbox?: Mailbox; mailboxes: Mailbox[]; owner: string; region: string; apiUrl: string; job: Job },
): Promise<{ refused: string } | { start: RunStart; month: string; cap: number }> {
  const { settings: given } = await agentSettings(table, agent.id);
  const working = mailboxesInOrder(mailboxes, owner).filter(({ id }) => sponsorAccessIn(given, id) !== "none");
  if (mailbox !== undefined && !working.some(({ id }) => id === mailbox.id)) return { refused: "Your mailbox agent has no access to this mailbox. Give it some in Settings, under Your agents." };
  if (working.length === 0) return { refused: "Your mailbox agent has no access to your mailboxes. Give it some in Settings, under Your agents." };
  // Sponsor access is one level in every mailbox it covers.
  const access = given.sponsorAccess;
  const { settings } = await organizationSettings(table);
  const cap = settings.mailboxAgentSpendCap;
  if (cap === 0) return { refused: "An admin turned the mailbox agents off, with a spend cap of $0. Ask one to raise it." };
  const month = monthOf(new Date());
  const [spent, { everyday, harder }, fromMail] = await Promise.all([spentIn(table, month), cooModelsOf(table, agent.sponsor, settings), learnsFromMail(table, agent.sponsor)]);
  if (spent >= cap) {
    await capReached(table, agent, month, cap);
    return { refused: capRefusal(cap) };
  }
  const start: RunStart = {
    apiUrl,
    ...(mailbox !== undefined && { mailbox: mailbox.id }),
    mailboxes: working.map(({ id, defaultAddress, addresses }) => ({ id, address: defaultAddress ?? addresses[0] ?? "" })),
    owner,
    access,
    approval: given.approvalAsSponsor,
    model: { model: { conversation: everyday, task: everyday, harder, unsubscribe: harder }[job], harder, region },
    ...(job === "conversation" && settings.mailboxAgentDecider && { decide: true }),
    budget: cap - spent,
    learnsFromMail: fromMail,
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
 * they come, and returns what it said and did, an unsubscribe's verdict, and how it ended. Each model call's cost is counted
 * as it comes, so a run cut off still counts what it spent, and a run that reaches the cap alerts
 * the agent's sponsor.
 */
export async function* runMailboxAgent(
  table: Table,
  { agent, payload, runtime, month, cap, about = {} }: { agent: Agent; payload: Omit<RunPayload, "token">; runtime: AgentRuntime; month: string; cap: number; about?: { task?: string; thread?: string } },
): AsyncGenerator<Extract<RunEvent, { type: "text" | "action" | "handedOver" }>, RunEnd> {
  const token = await issueRunToken(table, agent.id);
  let text = "";
  const actions: AgentAction[] = [];
  let outcome: RunOutcome = "failed";
  let verdict: { unsubscribed: boolean; detail: string } | undefined;
  let total = 0;
  let cost = 0;
  let model = payload.model.model;
  let decision: Decision | undefined;
  let handover: Handover | undefined;
  try {
    for await (const event of runtime({ ...payload, token } as RunPayload, `${agent.id}-${randomUUID()}`)) {
      if (event.type === "text") {
        text += event.text;
        yield event;
      } else if (event.type === "action") {
        actions.push(event.action);
        yield event;
      } else if (event.type === "usage") {
        const spent = costOf(event, event.model ?? payload.model.model, payload.model.region);
        cost += spent;
        total = await addSpend(table, month, spent);
      } else if (event.type === "verdict") verdict = { unsubscribed: event.unsubscribed, detail: event.detail };
      else if (event.type === "decided") decision = event.decision;
      else if (event.type === "handedOver") {
        // Text said before the handover was the everyday model's, set aside with its step.
        handover = event.handover;
        model = handover.to;
        await recordChanges(table, mailboxFeed(recordingMailbox(payload)), { by: agent.id, changes: [{ type: "agentHandedOver", agent: agent.id, handover, ...about }], items: [] });
        yield event;
      } else outcome = event.outcome;
    }
  } catch (error) {
    console.error(error);
    outcome = "failed";
  } finally {
    await endRunToken(table, token);
  }
  if (outcome === "capReached" || total >= cap) await capReached(table, agent, month, cap);
  return { text, actions, outcome, model, cost, ...(verdict !== undefined && { verdict }), ...(decision !== undefined && { decision }), ...(handover !== undefined && { handover }) };
}

/**
 * The mailbox whose change feed records the run: the one it was asked from, or for a turn asked
 * from All mailboxes, the first it works in.
 */
export const recordingMailbox = (payload: Pick<RunPayload, "mailbox" | "mailboxes">) => payload.mailbox ?? payload.mailboxes[0]!.id;

/** How a run ended: what it said and did, an unsubscribe's verdict, the model that ended it, what its model calls cost, and how it was routed. */
export interface RunEnd {
  text: string;
  actions: AgentAction[];
  outcome: RunOutcome;
  verdict?: { unsubscribed: boolean; detail: string };
  model: MailboxAgentModel;
  /** In US dollars. */
  cost: number;
  decision?: Decision;
  handover?: Handover;
}
