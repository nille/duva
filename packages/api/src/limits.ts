// Agents' send limits: how many messages an agent sends in any hour, and to how many new recipients
// in any 24 hours. What counts against them is in the agent's partition: each send when it goes out,
// each recipient it has sent to, and the sends that wait for the limits, oldest first. A counter
// there, which every send that counts and every send that starts to wait writes on condition that it
// is as read, makes two at once take turns. The sender sends what waits once the limits allow, when
// EventBridge Scheduler invokes it at the time it set, or when the API hands it the agent, as
// unpausing and raising a limit do.
import { CreateScheduleCommand, ConflictException, type SchedulerClient } from "@aws-sdk/client-scheduler";
import { InvokeCommand, type LambdaClient } from "@aws-sdk/client-lambda";
import { BatchGetCommand, GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { Table } from "./deployment.ts";
import { timeToLiveAttribute } from "./infrastructure.ts";
import { type AgentSettings, agentSettings, organizationSettings } from "./organization.ts";
import { documents, pk, sk, type TransactItem } from "./table.ts";

const hour = 60 * 60 * 1000;
const day = 24 * hour;

const partition = (agent: string) => `actor#${agent}`;
const counterKey = (agent: string) => ({ [pk]: partition(agent), [sk]: "limits" });
const sentPrefix = "limits#sent#";
const recipientPrefix = "limits#recipient#";
const recipientKey = (agent: string, address: string) => ({ [pk]: partition(agent), [sk]: `${recipientPrefix}${address.toLowerCase()}` });
const waitingPrefix = "limits#waiting#";

/** The agent's send limits, as its settings give them, but never above the organization's caps. */
export type Limits = Pick<AgentSettings, "sendsPerHour" | "newRecipientsPerDay">;

/** What counts against an agent's limits, as read, with the counter's version a send that counts checks. */
export interface Window {
  version: number;
  /** The agent's sends of the last 24 hours, each with how many new recipients it had. */
  sends: { at: number; newRecipients: number }[];
}

/** The agent's limits, each its own setting or the organization's cap if that is lower, as when a lowering of a cap stopped partway. */
export async function limitsOf(table: Table, agent: string): Promise<Limits> {
  const [{ settings }, { settings: caps }] = await Promise.all([agentSettings(table, agent), organizationSettings(table)]);
  return {
    sendsPerHour: Math.min(settings.sendsPerHour, caps.agentSendsPerHourCap),
    newRecipientsPerDay: Math.min(settings.newRecipientsPerDay, caps.agentNewRecipientsPerDayCap),
  };
}

/** What counts against the agent's limits at the time. */
export async function readWindow(table: Table, agent: string, now: Date): Promise<Window> {
  const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: counterKey(agent), ConsistentRead: true }));
  const sends: Window["sends"] = [];
  let start: Record<string, unknown> | undefined;
  do {
    const page = await documents(table).send(
      new QueryCommand({
        TableName: table.name,
        KeyConditionExpression: `${pk} = :agent AND ${sk} BETWEEN :from AND :to`,
        ExpressionAttributeValues: { ":agent": partition(agent), ":from": `${sentPrefix}${new Date(now.getTime() - day).toISOString()}`, ":to": `${sentPrefix}~` },
        ConsistentRead: true,
        ExclusiveStartKey: start,
      }),
    );
    for (const item of page.Items ?? []) sends.push({ at: Date.parse(item.at as string), newRecipients: item.newRecipients as number });
    start = page.LastEvaluatedKey;
  } while (start !== undefined);
  return { version: (Item?.version as number | undefined) ?? 0, sends };
}

/** The addresses the agent hasn't sent to before, from any mailbox, each once, in lower case. */
export async function newRecipients(table: Table, agent: string, addresses: string[]): Promise<string[]> {
  const unique = [...new Set(addresses.map((address) => address.toLowerCase()))];
  const known = new Set<string>();
  // BatchGetItem takes 100 keys at a time.
  for (let first = 0; first < unique.length; first += 100) {
    let keys: Record<string, unknown>[] | undefined = unique.slice(first, first + 100).map((address) => recipientKey(agent, address));
    while (keys !== undefined && keys.length > 0) {
      const { Responses, UnprocessedKeys }: { Responses?: Record<string, Record<string, unknown>[]>; UnprocessedKeys?: Record<string, { Keys?: Record<string, unknown>[] }> } =
        await documents(table).send(new BatchGetCommand({ RequestItems: { [table.name]: { Keys: keys, ConsistentRead: true } } }));
      for (const item of Responses?.[table.name] ?? []) known.add((item[sk] as string).slice(recipientPrefix.length));
      keys = UnprocessedKeys?.[table.name]?.Keys;
    }
  }
  return unique.filter((address) => !known.has(address));
}

/**
 * When the limits allow a send to `fresh` new recipients, if not now: the time the oldest sends
 * that stand in its way leave their windows. It is never, as far as the limits go, if it has more
 * new recipients than the whole daily limit.
 */
export function allowedAt(window: Window, limits: Limits, fresh: number, now: Date): Date | "never" | undefined {
  if (fresh > limits.newRecipientsPerDay) return "never";
  let at = 0;
  const lastHour = window.sends
    .filter((send) => send.at > now.getTime() - hour)
    .map((send) => send.at)
    .sort((a, b) => a - b);
  if (lastHour.length >= limits.sendsPerHour) at = lastHour[lastHour.length - limits.sendsPerHour]! + hour;
  if (fresh > 0) {
    const lastDay = window.sends.filter((send) => send.at > now.getTime() - day && send.newRecipients > 0).sort((a, b) => a.at - b.at);
    let total = lastDay.reduce((sum, send) => sum + send.newRecipients, fresh);
    for (const send of lastDay) {
      if (total <= limits.newRecipientsPerDay) break;
      total -= send.newRecipients;
      at = Math.max(at, send.at + day);
    }
  }
  return at > now.getTime() ? new Date(at) : undefined;
}

/** The write that holds only while what counts against the agent's limits is as read, and makes the next write wait its turn. */
export function windowUnchanged(table: Table, agent: string, window: Window): TransactItem {
  return {
    Update: {
      TableName: table.name,
      Key: counterKey(agent),
      UpdateExpression: "SET version = :next",
      ConditionExpression: window.version === 0 ? `attribute_not_exists(${pk})` : "version = :version",
      ExpressionAttributeValues: { ":next": window.version + 1, ...(window.version !== 0 && { ":version": window.version }) },
    },
  };
}

/**
 * The writes that count the agent's send of the message, going out at the time to the new
 * recipients, against its limits, on condition that the window is as read. The send leaves the
 * table a day after it leaves the daily window.
 */
export function counting(table: Table, agent: string, window: Window, { message, at, fresh }: { message: string; at: Date; fresh: string[] }): TransactItem[] {
  return [
    windowUnchanged(table, agent, window),
    {
      Put: {
        TableName: table.name,
        Item: {
          [pk]: partition(agent),
          [sk]: `${sentPrefix}${at.toISOString()}#${message}`,
          at: at.toISOString(),
          newRecipients: fresh.length,
          [timeToLiveAttribute]: Math.ceil((at.getTime() + 2 * day) / 1000),
        },
      },
    },
    ...fresh.map((address) => ({ Put: { TableName: table.name, Item: recipientKey(agent, address) } })),
  ];
}

/** An agent's send that waits for its limits: the draft, in its mailbox, approved at the time. */
export interface WaitingSend {
  mailbox: string;
  draft: string;
  approvedAt: string;
}

/** Where the agent's waiting send is listed, in the order they were approved. */
const waitingKey = (agent: string, { mailbox, draft, approvedAt }: WaitingSend) => ({ [pk]: partition(agent), [sk]: `${waitingPrefix}${approvedAt}#${mailbox}#${draft}` });

/** The write that lists the agent's send among those that wait. */
export const startWaiting = (table: Table, agent: string, waiting: WaitingSend): TransactItem => ({ Put: { TableName: table.name, Item: { ...waitingKey(agent, waiting), ...waiting } } });

/** The write that takes the agent's send off those that wait, once it goes out, fails, or is sent now. */
export const stopWaiting = (table: Table, agent: string, waiting: WaitingSend): TransactItem => ({ Delete: { TableName: table.name, Key: waitingKey(agent, waiting) } });

/** The agent's sends that wait for its limits, the first approved first. */
export async function waitingSends(table: Table, agent: string): Promise<WaitingSend[]> {
  const waiting: WaitingSend[] = [];
  let start: Record<string, unknown> | undefined;
  do {
    const page = await documents(table).send(
      new QueryCommand({
        TableName: table.name,
        KeyConditionExpression: `${pk} = :agent AND begins_with(${sk}, :waiting)`,
        ExpressionAttributeValues: { ":agent": partition(agent), ":waiting": waitingPrefix },
        ConsistentRead: true,
        ExclusiveStartKey: start,
      }),
    );
    for (const item of page.Items ?? []) waiting.push({ mailbox: item.mailbox as string, draft: item.draft as string, approvedAt: item.approvedAt as string });
    start = page.LastEvaluatedKey;
  } while (start !== undefined);
  return waiting;
}

/** The event that has the sender send what waits for the agent's limits, as far as they allow. */
export interface ReleaseEvent {
  release: string;
}

/** Hands the sender an agent whose sends wait, so it sends what the limits allow now. The API's, or a stand-in in tests. */
export interface WaitingSends {
  release(agent: string): Promise<void>;
}

/** The sender Lambda, invoked without waiting. */
export function lambdaWaitingSends(lambda: LambdaClient, functionName: string): WaitingSends {
  return {
    async release(agent) {
      await lambda.send(new InvokeCommand({ FunctionName: functionName, InvocationType: "Event", Payload: JSON.stringify({ release: agent } satisfies ReleaseEvent) }));
    },
  };
}

/** Has the sender handed an agent at a time, when its limits allow what waits. EventBridge Scheduler's, or a stand-in in tests. */
export interface Schedules {
  releaseAt(agent: string, at: Date): Promise<void>;
}

/**
 * One-time schedules in Duva's schedule group, which invoke the sender with the role given, each
 * deleted once it ran. A schedule's name holds the agent and the second, so asking twice for the
 * same time makes one.
 */
export function eventBridgeSchedules(scheduler: SchedulerClient, { group, sender, role }: { group: string; sender: string; role: string }): Schedules {
  return {
    async releaseAt(agent, at) {
      // A time that has passed by the time Scheduler reads it may be refused, so it is never sooner than 10 s from now.
      const second = Math.ceil(Math.max(at.getTime(), Date.now() + 10_000) / 1000);
      try {
        await scheduler.send(
          new CreateScheduleCommand({
            Name: `release-${agent}-${second}`,
            GroupName: group,
            ScheduleExpression: `at(${new Date(second * 1000).toISOString().slice(0, 19)})`,
            ScheduleExpressionTimezone: "UTC",
            FlexibleTimeWindow: { Mode: "OFF" },
            ActionAfterCompletion: "DELETE",
            Target: { Arn: sender, RoleArn: role, Input: JSON.stringify({ release: agent } satisfies ReleaseEvent) },
          }),
        );
      } catch (error) {
        if (!(error instanceof ConflictException)) throw error;
      }
    },
  };
}
