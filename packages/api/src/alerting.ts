// Alerts: notices to a sponsor that one of their agents needs them. Each is in the sponsor's
// partition, so removing the agent keeps it, by when it was raised, with a count there of those
// the sponsor hasn't seen, in all and per agent. An alert is written in the transaction of what
// raised it where it can be, or else on condition that what raised it raised none before, so a
// retry never raises it twice. An urgent alert to a sponsor with a mailbox is also mailed there:
// the table's stream hands it to the sender, which sends it from Duva's system address.
import { randomUUID } from "node:crypto";
import { ConditionalCheckFailedException, TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { GetCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { components } from "@duva/openapi";
import type { Table } from "./deployment.ts";
import type { Limits } from "./limits.ts";
import { type Agent, duva, findActor, ownedMailboxes } from "./organization.ts";
import { timeToLiveAttribute } from "./infrastructure.ts";
import { documents, isNew, pk, sk, type TransactItem } from "./table.ts";

export type Alert = components["schemas"]["Alert"];

const partition = (sponsor: string) => `actor#${sponsor}`;
const alertPrefix = "alert#";
const alertKey = (sponsor: string, id: string) => ({ [pk]: partition(sponsor), [sk]: `${alertPrefix}${id}` });
// The counts of unseen alerts sort after every alert, so listing them reads none.
const unseenKey = (sponsor: string, agent?: string) => ({ [pk]: partition(sponsor), [sk]: agent === undefined ? "alerts-unseen" : `alerts-unseen#${agent}` });
const raisedKey = (sponsor: string, source: string) => ({ [pk]: partition(sponsor), [sk]: `alert-raised#${source}` });
// What raised an alert is kept for 90 days, longer than any pause it stands for should last.
const raisedFor = 90 * 24 * 60 * 60;

/** The write that counts the alert seen or unseen in the count under the key. */
const counting = (table: Table, key: Record<string, string>, by: 1 | -1): TransactItem => ({
  Update: { TableName: table.name, Key: key, UpdateExpression: "ADD unseen :by", ExpressionAttributeValues: { ":by": by } },
});

/** An alert to raise: what happened to the agent, with who did it and where it is, if there is one. */
export interface NewAlert {
  kind: Alert["kind"];
  agent: Pick<Agent, "id" | "name" | "sponsor">;
  what: string;
  by?: string;
  link?: Pick<Alert, "mailbox" | "thread" | "message" | "draft">;
  /** The subject of the mail an urgent alert is, which makes it urgent. */
  urgent?: string;
}

/**
 * The writes that raise the alert, unseen. An urgent one is also mailed to the sponsor's default
 * address, if they have a mailbox, once the sender takes it from the table's stream. With a
 * `source`, the alert is raised only if nothing raised one for that source before.
 */
export async function alertWrites(table: Table, alert: NewAlert, source?: string): Promise<TransactItem[]> {
  const mailTo = alert.urgent === undefined ? undefined : (await ownedMailboxes(table, alert.agent.sponsor)).find(({ defaultAddress }) => defaultAddress !== undefined)?.defaultAddress;
  return alertItems(table, alert, { mailTo, source });
}

/**
 * The writes that raise the alert, as alertWrites gives them, where an urgent one is mailed only
 * to `mailTo`, so one without is never mailed.
 */
export function alertItems(table: Table, { kind, agent, what, by, link, urgent }: NewAlert, { mailTo, source }: { mailTo?: string; source?: string } = {}): TransactItem[] {
  const at = new Date().toISOString();
  // Alerts sort by when they were raised, so the ID starts with it.
  const id = `${at}~${randomUUID().slice(0, 8)}`;
  return [
    ...(source === undefined ? [] : [{ Put: { TableName: table.name, Item: { ...raisedKey(agent.sponsor, source), [timeToLiveAttribute]: Math.floor(Date.now() / 1000) + raisedFor }, ...isNew } }]),
    {
      Put: {
        TableName: table.name,
        Item: {
          ...alertKey(agent.sponsor, id),
          id,
          kind,
          agent: agent.id,
          agentName: agent.name,
          at,
          what,
          urgent: urgent !== undefined,
          seen: false,
          by,
          ...link,
          ...(urgent !== undefined && mailTo !== undefined && { mail: "pending", mailTo, subject: urgent }),
        },
      },
    },
    counting(table, unseenKey(agent.sponsor), 1),
    counting(table, unseenKey(agent.sponsor, agent.id), 1),
  ];
}

/**
 * Raises the alert, with the checks, unless a check fails or something raised one for the source
 * before, when it raises none.
 */
export async function raiseAlert(table: Table, alert: NewAlert, { source, checks = [] }: { source?: string; checks?: TransactItem[] } = {}): Promise<void> {
  try {
    await documents(table).send(new TransactWriteCommand({ TransactItems: [...checks, ...(await alertWrites(table, alert, source))] }));
  } catch (error) {
    const reasons = error instanceof TransactionCanceledException ? (error.CancellationReasons ?? []) : [];
    if (!reasons.some((reason) => reason.Code === "ConditionalCheckFailed")) throw error;
  }
}

/** How many of what there are, as a number with a noun that is singular for one. */
const counted = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** How an agent's send limit reads, as in "100 sends an hour". */
export const limitRead = (limit: keyof Limits, value: number) =>
  limit === "sendsPerHour" ? `${counted(value, "send", "sends")} an hour` : `${counted(value, "new recipient", "new recipients")} a day`;

/** How an agent's send limits read together. */
export const limitsRead = (limits: Limits) => `${limitRead("sendsPerHour", limits.sendsPerHour)} and ${limitRead("newRecipientsPerDay", limits.newRecipientsPerDay)}`;

/** How an actor who did something to an agent reads in an alert: a human by their address, an agent by its name. */
export async function actorNamed(table: Table, id: string): Promise<string> {
  if (id === duva) return "Duva";
  const actor = await findActor(table, id);
  // Only an admin can leave while the agent stays, since its sponsor's removal removes it.
  return actor?.kind === "human" ? actor.email : (actor?.name ?? "an admin who has since left");
}

/** A page of the sponsor's alerts, newest first, about the agent if one is given, with how many of those they haven't seen. */
export async function alertsPage(table: Table, sponsor: string, { agent, limit, after }: { agent?: string; limit: number; after?: string }) {
  const alerts: Alert[] = [];
  let start: Record<string, unknown> | undefined;
  let more = false;
  do {
    const page = await documents(table).send(
      new QueryCommand({
        TableName: table.name,
        KeyConditionExpression: `${pk} = :sponsor AND ${sk} BETWEEN :from AND :to`,
        ...(agent !== undefined && { FilterExpression: "#agent = :agent", ExpressionAttributeNames: { "#agent": "agent" } }),
        ExpressionAttributeValues: {
          ":sponsor": partition(sponsor),
          ":from": alertPrefix,
          ":to": after === undefined ? `${alertPrefix}\uffff` : `${alertPrefix}${after}`,
          ...(agent !== undefined && { ":agent": agent }),
        },
        ScanIndexForward: false,
        ConsistentRead: true,
        ExclusiveStartKey: start,
      }),
    );
    for (const item of page.Items ?? []) {
      if (item.id === after) continue;
      if (alerts.length === limit) {
        more = true;
        break;
      }
      alerts.push(alertOf(item));
    }
    start = page.LastEvaluatedKey;
  } while (start !== undefined && !more);
  return { alerts, unseen: await unseenAlerts(table, sponsor, agent), ...(more && { next: alerts.at(-1)!.id }) };
}

/** When each of the sponsor's alerts about the agent raised since the time was raised. */
export async function alertTimes(table: Table, sponsor: string, agent: string, since: string): Promise<string[]> {
  const times: string[] = [];
  let start: Record<string, unknown> | undefined;
  do {
    const page = await documents(table).send(
      new QueryCommand({
        TableName: table.name,
        KeyConditionExpression: `${pk} = :sponsor AND ${sk} BETWEEN :from AND :to`,
        FilterExpression: "#agent = :agent",
        ProjectionExpression: "#at",
        ExpressionAttributeNames: { "#agent": "agent", "#at": "at" },
        ExpressionAttributeValues: { ":sponsor": partition(sponsor), ":from": `${alertPrefix}${since}`, ":to": `${alertPrefix}\uffff`, ":agent": agent },
        ExclusiveStartKey: start,
      }),
    );
    for (const item of page.Items ?? []) times.push(item.at as string);
    start = page.LastEvaluatedKey;
  } while (start !== undefined);
  return times;
}

/** How many of the sponsor's alerts, about the agent if one is given, they haven't seen. */
export async function unseenAlerts(table: Table, sponsor: string, agent?: string): Promise<number> {
  const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: unseenKey(sponsor, agent), ConsistentRead: true }));
  return (Item?.unseen as number | undefined) ?? 0;
}

/** Marks the sponsor's alerts with the IDs seen, each once. IDs of none of theirs are left alone. */
export async function seeAlerts(table: Table, sponsor: string, ids: string[]): Promise<void> {
  for (const id of new Set(ids)) {
    const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: alertKey(sponsor, id), ConsistentRead: true }));
    if (Item === undefined || Item.seen === true) continue;
    try {
      await documents(table).send(
        new TransactWriteCommand({
          TransactItems: [
            { Update: { TableName: table.name, Key: alertKey(sponsor, id), UpdateExpression: "SET seen = :seen", ConditionExpression: "seen = :unseen", ExpressionAttributeValues: { ":seen": true, ":unseen": false } } },
            counting(table, unseenKey(sponsor), -1),
            counting(table, unseenKey(sponsor, Item.agent as string), -1),
          ],
        }),
      );
    } catch (error) {
      // Marked seen at the same time, it is counted once.
      if (!(error instanceof TransactionCanceledException && error.CancellationReasons?.[0]?.Code === "ConditionalCheckFailed")) throw error;
    }
  }
}

/** An alert as an item stores it, in the order the contract lists its fields. */
const alertOf = ({ id, kind, agent, agentName, at, what, urgent, seen, by, mailbox, thread, message, draft }: Record<string, unknown>): Alert =>
  ({
    id,
    kind,
    agent,
    agentName,
    at,
    what,
    urgent,
    seen,
    ...(by !== undefined && { by }),
    ...(mailbox !== undefined && { mailbox }),
    ...(thread !== undefined && { thread }),
    ...(message !== undefined && { message }),
    ...(draft !== undefined && { draft }),
  }) as Alert;

/** The alert whose mail the stream record's keys name, if they name one. */
export function alertAt(keys: Record<string, string>): { sponsor: string; id: string } | undefined {
  const sponsor = /^actor#(.+)$/.exec(keys[pk] ?? "")?.[1];
  const key = keys[sk] ?? "";
  const id = key.startsWith(alertPrefix) ? key.slice(alertPrefix.length) : undefined;
  return sponsor === undefined || id === undefined ? undefined : { sponsor, id };
}

/** An urgent alert's mail: where it goes, with its subject and text. */
export interface AlertMail {
  to: string;
  subject: string;
  what: string;
}

/**
 * Moves the alert's mail from pending to sending and returns it, or undefined if it isn't
 * pending. One an earlier run left sending, as when it stopped before SES answered, is marked
 * unclear and never mailed again.
 */
export async function startMailing(table: Table, { sponsor, id }: { sponsor: string; id: string }): Promise<AlertMail | undefined> {
  try {
    const { Attributes } = await documents(table).send(
      new UpdateCommand({
        TableName: table.name,
        Key: alertKey(sponsor, id),
        UpdateExpression: "SET mail = :sending",
        ConditionExpression: "mail = :pending",
        ExpressionAttributeValues: { ":sending": "sending", ":pending": "pending" },
        ReturnValues: "ALL_NEW",
      }),
    );
    return { to: Attributes!.mailTo as string, subject: Attributes!.subject as string, what: Attributes!.what as string };
  } catch (error) {
    if (!(error instanceof ConditionalCheckFailedException)) throw error;
    const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: alertKey(sponsor, id), ConsistentRead: true }));
    if (Item?.mail === "sending") await mailingSettled(table, { sponsor, id }, "unclear");
    return undefined;
  }
}

/** Records how the alert's mail went: sent, refused by SES, or unclear, when SES's answer never came. Duva never mails it again. */
export async function mailingSettled(table: Table, { sponsor, id }: { sponsor: string; id: string }, outcome: "sent" | "failed" | "unclear"): Promise<void> {
  await documents(table).send(new UpdateCommand({ TableName: table.name, Key: alertKey(sponsor, id), UpdateExpression: "SET mail = :outcome", ExpressionAttributeValues: { ":outcome": outcome } }));
}
