// Requests mailed to a Coo's address (ADR-0040), as Duva keeps them: each in its human's partition,
// under the ID SES gave the mail, with its raw message in the mail bucket under coo/, so both go
// with the conversation and the human. A code Coo mailed a sender who wasn't proven is kept beside
// them, hashed, until it is used, or the eraser's daily run finds its hour over and drops the
// requests that waited for it, unverified. Every event is a mailToCoo change in the feed of the
// first of the human's mailboxes, naming their Coo, and keeps none of what the mail says.
import { BatchWriteCommand, DeleteCommand, GetCommand, PutCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBStreamEvent } from "aws-lambda";
import type { components } from "@duva/openapi";
import { ConditionalCheckFailedException, TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { automatic } from "./away-messages.ts";
import { mayAskCoo } from "./coo-address.ts";
import type { Table } from "./deployment.ts";
import { recordChanges } from "./feed.ts";
import { cooRequestsPrefix } from "./infrastructure.ts";
import type { MailBucket } from "./mail-bucket.ts";
import { mailboxAgentOf } from "./mailbox-agents.ts";
import { actorKey, allHumans, findActor, type Human, mailboxesInOrder, mailboxFeed, mailboxKey, ownedMailboxes } from "./organization.ts";
import type { ParsedMail } from "./mime.ts";
import { documents, isNew, pk, sk, type TransactItem } from "./table.ts";
import type { TaskRunner } from "./tasks.ts";

type MailToCoo = components["schemas"]["MailToCoo"];

/**
 * Where a request stands: received, waiting for the runner; refused, from a sender who may not
 * ask; verifying, waiting for its code; verifies, a reply that brought a code, which is no request
 * of its own; taken, proven and waiting to run; running; answered; failed, as when SES didn't send
 * the answer; expired, its code never came back.
 */
export type RequestState = "received" | "refused" | "verifying" | "verifies" | "taken" | "running" | "answered" | "failed" | "expired";

/** A request by mail, as kept. */
export interface CooRequest {
  /** The ID SES gave the mail. */
  id: string;
  human: string;
  state: RequestState;
  /** The From address, in lower case, which Coo always answers. */
  from: string;
  /** Whether the mail proved its sender, by DMARC or as Duva's own send, so it needs no code. */
  proven: boolean;
  /** When SES received it, as an ISO time. */
  receivedAt: string;
  subject: string;
  /** The Message-IDs of the thread Coo answers in, oldest first: the request's own and those it continued, then Coo's mail. */
  thread: string[];
  /** The code it waits for, for one that wasn't proven. */
  code?: string;
}

/** A code Coo mailed a sender, as kept: hashed, with its salt, and how many replies brought another. */
export interface CooCode {
  id: string;
  from: string;
  salt: string;
  hash: string;
  /** When the request it was mailed for was received, which its hour counts from. */
  sentAt: string;
  /** The Message-ID SES gave the mail with the code, which a reply answers. */
  messageId: string;
  attempts: number;
  state: "open" | "used" | "void";
}

/** How long a code works, in milliseconds. */
export const codeWorks = 60 * 60_000;

export const requestKey = (human: string, id: string) => ({ [pk]: actorKey(human)[pk]!, [sk]: `coo-request#${id}` });
export const codeKey = (human: string, id: string) => ({ [pk]: actorKey(human)[pk]!, [sk]: `coo-code#${id}` });
/** Where the mail bucket keeps the request's raw message. */
export const rawKeyOf = (human: string, id: string) => `${cooRequestsPrefix}${human}/${id}`;

async function inPartition<Item>(table: Table, human: string, prefix: string): Promise<Item[]> {
  const items: Item[] = [];
  let start: Record<string, unknown> | undefined;
  do {
    const page = await documents(table).send(
      new QueryCommand({
        TableName: table.name,
        KeyConditionExpression: `${pk} = :human AND begins_with(${sk}, :prefix)`,
        ExpressionAttributeValues: { ":human": actorKey(human)[pk], ":prefix": prefix },
        ConsistentRead: true,
        ExclusiveStartKey: start,
      }),
    );
    items.push(...((page.Items ?? []) as Item[]));
    start = page.LastEvaluatedKey;
  } while (start !== undefined);
  return items;
}

/** The human's requests by mail. */
export const requestsOf = (table: Table, human: string) => inPartition<CooRequest>(table, human, "coo-request#");
/** The codes Coo mailed for the human's requests. */
export const codesOf = (table: Table, human: string) => inPartition<CooCode>(table, human, "coo-code#");

export async function findRequest(table: Table, human: string, id: string): Promise<CooRequest | undefined> {
  const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: requestKey(human, id), ConsistentRead: true }));
  return Item as CooRequest | undefined;
}

/** The update that moves the request from the state it is in to the next, with any fields given, only while it is in that one. */
export function requestMoved(table: Table, request: Pick<CooRequest, "human" | "id">, from: RequestState, to: RequestState, also: Record<string, unknown> = {}): TransactItem {
  const fields: Record<string, unknown> = { state: to, ...also };
  const names = Object.keys(fields);
  return {
    Update: {
      TableName: table.name,
      Key: requestKey(request.human, request.id),
      UpdateExpression: `SET ${names.map((_, index) => `#f${index} = :f${index}`).join(", ")}`,
      ConditionExpression: "#state = :from",
      ExpressionAttributeNames: { "#state": "state", ...Object.fromEntries(names.map((name, index) => [`#f${index}`, name])) },
      ExpressionAttributeValues: { ":from": from, ...Object.fromEntries(names.map((name, index) => [`:f${index}`, fields[name]])) },
    },
  };
}

/**
 * Moves the request from the state it is in to the next, with any fields given. Returns false if
 * it was in another, as when another run moved it first.
 */
export async function moveRequest(table: Table, request: Pick<CooRequest, "human" | "id">, from: RequestState, to: RequestState, also: Record<string, unknown> = {}): Promise<boolean> {
  return written(table, [requestMoved(table, request, from, to, also)]);
}

/** Writes the items in one transaction. Returns false if one's condition failed, as when another run wrote first. */
async function written(table: Table, items: TransactItem[]): Promise<boolean> {
  try {
    await documents(table).send(new TransactWriteCommand({ TransactItems: items }));
    return true;
  } catch (error) {
    if (error instanceof TransactionCanceledException && error.CancellationReasons?.some(({ Code }) => Code === "ConditionalCheckFailed")) return false;
    throw error;
  }
}

/**
 * Records the event in the feed of the first of the human's mailboxes, naming their Coo, attributed
 * to it, or to no actor for mail that simply arrived or a code's hour that ended, in one transaction
 * with the items. Without a mailbox or a Coo, there is nowhere to record it, and only the items are
 * written. Returns false if one of the items' conditions failed, so nothing was.
 */
export async function noteMailToCoo(
  table: Table,
  human: Human,
  event: Omit<MailToCoo, "position" | "at" | "actor" | "type" | "agent" | "human">,
  { byCoo = true, items = [] }: { byCoo?: boolean; items?: TransactItem[] } = {},
): Promise<boolean> {
  const [agent, owned] = await Promise.all([mailboxAgentOf(table, human.id), ownedMailboxes(table, human.id)]);
  const first = mailboxesInOrder(owned, human.email)[0];
  if (agent === undefined || first === undefined) return items.length === 0 || written(table, items);
  try {
    await recordChanges(table, mailboxFeed(first.id), { by: byCoo ? agent.id : undefined, changes: [{ type: "mailToCoo", agent: agent.id, human: human.id, ...event }], items });
    return true;
  } catch (error) {
    // recordChanges gives the items' reasons after the feed's counter and the one change's.
    if (error instanceof TransactionCanceledException && error.CancellationReasons?.slice(2).some(({ Code }) => Code === "ConditionalCheckFailed")) return false;
    throw error;
  }
}

/** The writes that erase the human's request by mail, and list its raw message for the eraser with `raw`, as its turn goes with a thread it read (#172). */
export const requestErasure = (table: Table, human: string, id: string, raw: (rawKey: string) => TransactItem): TransactItem[] => [
  { Delete: { TableName: table.name, Key: requestKey(human, id) } },
  raw(rawKeyOf(human, id)),
];

/** Erases the human's request by mail and its raw message, as its turn went with mail its run read while it ran (#172). */
export async function eraseCooRequest(table: Table, mailBucket: MailBucket, human: string, id: string): Promise<void> {
  await mailBucket.erase(rawKeyOf(human, id));
  await documents(table).send(new DeleteCommand({ TableName: table.name, Key: requestKey(human, id) }));
}

/** The human whose requests by mail are erased, and their IDs as read before, which the eraser is handed. */
export interface CooRequestsErased {
  human: string;
  requests: string[];
}

/** What the eraser is handed to erase the human's requests by mail, as read now. */
export async function cooRequestsErased(table: Table, human: string): Promise<CooRequestsErased> {
  return { human, requests: (await requestsOf(table, human)).map(({ id }) => id) };
}

/**
 * Erases the human's requests by mail, their raw messages and the codes mailed for them, as starting
 * a new conversation, or removing the human, does, those given by ID among them.
 */
export async function eraseCooRequests(table: Table, mailBucket: MailBucket, human: string, given: string[] = []): Promise<void> {
  const requests = await requestsOf(table, human);
  for (const id of new Set([...given, ...requests.map(({ id }) => id)])) await mailBucket.erase(rawKeyOf(human, id));
  const keys = [...requests.map(({ id }) => requestKey(human, id)), ...(await codesOf(table, human)).map(({ id }) => codeKey(human, id))];
  for (let start = 0; start < keys.length; start += 25) {
    await documents(table).send(new BatchWriteCommand({ RequestItems: { [table.name]: keys.slice(start, start + 25).map((Key) => ({ DeleteRequest: { Key } })) } }));
  }
}

/**
 * Drops the requests whose code's hour ended before `now` without it coming back, erasing their
 * raw messages, and voids the code, as the eraser's daily run does. Each is noted as never verified.
 */
export async function expireCooRequests(table: Table, mailBucket: MailBucket, now: Date): Promise<void> {
  for (const human of await allHumans(table)) {
    const codes = (await codesOf(table, human.id)).filter(({ state, sentAt }) => state === "open" && Date.parse(sentAt) + codeWorks < now.getTime());
    const requests = await requestsOf(table, human.id);
    // A run that stopped before it kept the code it mailed, or before it mailed one, left its request without one.
    const without = requests.filter(({ state, code, receivedAt }) => state === "verifying" && code === undefined && Date.parse(receivedAt) + codeWorks < now.getTime());
    for (const request of without) await expire(table, mailBucket, human, request);
    for (const code of codes) {
      await documents(table).send(
        new UpdateCommand({ TableName: table.name, Key: codeKey(human.id, code.id), UpdateExpression: "SET #state = :void", ConditionExpression: "#state = :open", ExpressionAttributeNames: { "#state": "state" }, ExpressionAttributeValues: { ":void": "void", ":open": "open" } }),
      ).catch((error: unknown) => {
        if (!(error instanceof ConditionalCheckFailedException)) throw error;
      });
      for (const request of requests.filter((each) => each.code === code.id && each.state === "verifying")) await expire(table, mailBucket, human, request);
    }
  }
}

/** Drops the request that waited for a code, never verified, erasing its raw message. */
async function expire(table: Table, mailBucket: MailBucket, human: Human, request: CooRequest): Promise<void> {
  await mailBucket.erase(rawKeyOf(human.id, request.id));
  await noteMailToCoo(table, human, { request: request.id, from: request.from, event: "neverVerified" }, { byCoo: false, items: [requestMoved(table, request, "verifying", "expired")] });
}

/** The human with the ID, if there still is one. */
export async function humanOf(table: Table, id: string): Promise<Human | undefined> {
  const found = await findActor(table, id);
  return found?.kind === "human" ? found : undefined;
}

/** How a send or a payment that waited for the human was decided, which Coo mails the requester. */
export type FollowedUp = NonNullable<MailToCoo["outcome"]>;

/** What waited at the end of a request's run: a draft's send, or a payment above its card's limits (ADR-0039), in the mailbox whose feed records it. */
export type Waited = { mailbox: string } & ({ draft: string } | { payment: string });

/** What the runner is handed for something that waited, once it is decided. */
export type FollowUp = Waited & { outcome: FollowedUp };

// What waited at the end of a request's run points at the request, in the mailbox whose feed records it.
const followUpKey = (waited: Waited) => ({ [pk]: mailboxKey(waited.mailbox)[pk]!, [sk]: `coo-follow-up#${"draft" in waited ? waited.draft : `payment#${waited.payment}`}` });

/** Has Coo mail the requester once what waits for the human is decided. */
export async function awaitDecision(table: Table, waited: Waited, request: Pick<CooRequest, "human" | "id">): Promise<void> {
  await documents(table).send(new PutCommand({ TableName: table.name, Item: { ...followUpKey(waited), human: request.human, request: request.id } }));
}

/**
 * Takes the request the decision is followed up for, once: a second call finds none. A payment
 * approved is said, and followed up again once a later run pays it.
 */
export async function takeFollowUp(table: Table, { outcome, ...waited }: FollowUp): Promise<Pick<CooRequest, "human" | "id"> | undefined> {
  try {
    const { Attributes } = await documents(table).send(
      outcome === "approved"
        ? new UpdateCommand({ TableName: table.name, Key: followUpKey(waited), UpdateExpression: "SET approvedSaid = :yes", ConditionExpression: `attribute_exists(${pk}) AND attribute_not_exists(approvedSaid)`, ExpressionAttributeValues: { ":yes": true }, ReturnValues: "ALL_NEW" })
        : new DeleteCommand({ TableName: table.name, Key: followUpKey(waited), ConditionExpression: `attribute_exists(${pk})`, ReturnValues: "ALL_OLD" }),
    );
    return Attributes === undefined ? undefined : { human: Attributes.human as string, id: Attributes.request as string };
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) return undefined;
    throw error;
  }
}

/**
 * The follow-up a change in a mailbox's feed, as the table's stream gives it, settles, if what it
 * decides waited at the end of a request's run: a draft Coo asked to send was sent, failed, or its
 * approval was rejected, or a payment was approved, declined, or paid as approved.
 */
export async function followUpOf(table: Table, record: DynamoDBStreamEvent["Records"][number]): Promise<FollowUp | undefined> {
  const image = record.dynamodb?.NewImage ?? {};
  const mailbox = /^mailbox#(.+)#changes$/.exec(record.dynamodb?.Keys?.[pk]?.S ?? "")?.[1];
  if (mailbox === undefined) return undefined;
  const { draft, payment } = { draft: image.draft?.S, payment: image.payment?.S };
  const type = image.type?.S;
  const followUp: FollowUp | undefined =
    draft !== undefined && type === "messageSent"
      ? { mailbox, draft, outcome: "sent" }
      : draft !== undefined && type === "sendFailed"
        ? { mailbox, draft, outcome: "failed" }
        : draft !== undefined && type === "approvalDecided" && image.decision?.S === "rejected"
          ? { mailbox, draft, outcome: "rejected" }
          : payment !== undefined && type === "paymentDecided"
            ? { mailbox, payment, outcome: image.approved?.BOOL === true ? "approved" : "declined" }
            : payment !== undefined && type === "paymentMade" && image.approved?.BOOL === true
              ? { mailbox, payment, outcome: "paid" }
              : undefined;
  if (followUp === undefined) return undefined;
  const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: followUpKey(followUp), ConsistentRead: true }));
  return Item === undefined ? undefined : followUp;
}

/** What the task runner is handed: a request to settle and run, or a send that waited, now decided. */
export type CooMailJob = { human: string; request: string } | { followUp: FollowUp };

/** A message SES delivered to the human's Coo's address, as the inbound handler hands it on. */
export interface CooArrival {
  human: string;
  sesMessageId: string;
  raw: Uint8Array;
  parsed: ParsedMail;
  envelopeSender: string;
  /** Whether it proves its sender: DMARC passed for its From domain, or, from the organization's own domains, Duva sent it. */
  proven: boolean;
  receivedAt: string;
}

/**
 * Takes the message for the human's Coo: drops it, noted without what it says, if its sender may not
 * ask, or it is automatic, and otherwise keeps it and hands it to the task runner. An event processed
 * again hands a request that still waits again, and changes nothing else.
 */
export async function receiveForCoo({ table, mailBucket, tasks }: { table: Table; mailBucket: MailBucket; tasks: Pick<TaskRunner, "cooMail"> }, arrival: CooArrival): Promise<void> {
  const human = await humanOf(table, arrival.human);
  if (human === undefined) return;
  const { parsed } = arrival;
  const from = (parsed.from?.address ?? arrival.envelopeSender).toLowerCase();
  const base = { id: arrival.sesMessageId, human: human.id, from, receivedAt: arrival.receivedAt };
  // An away message or a bounce never asks Coo anything, and answering one could go on forever.
  if (automatic(arrival.raw) || !(await mayAskCoo(table, human, from))) {
    const refused = { ...requestKey(human.id, base.id), ...base, state: "refused" };
    await noteMailToCoo(table, human, { request: base.id, from, event: "refused" }, { byCoo: false, items: [{ Put: { TableName: table.name, Item: refused, ...isNew } }] });
    return;
  }
  await mailBucket.put(rawKeyOf(human.id, base.id), arrival.raw);
  const request: CooRequest = {
    ...base,
    state: "received",
    proven: arrival.proven,
    subject: parsed.subject,
    thread: [...parsed.references.filter((each) => each !== parsed.messageId), ...(parsed.messageId === undefined ? [] : [parsed.messageId])],
  };
  if (await claim(table, request)) await tasks.cooMail({ human: human.id, request: base.id });
  else if ((await findRequest(table, human.id, base.id))?.state === "received") await tasks.cooMail({ human: human.id, request: base.id });
}

/** Keeps the request, unless it is kept already. Returns whether it was new. */
async function claim(table: Table, request: Omit<CooRequest, "proven" | "subject" | "thread"> & Partial<CooRequest>): Promise<boolean> {
  try {
    await documents(table).send(new PutCommand({ TableName: table.name, Item: { ...requestKey(request.human, request.id), ...request }, ...isNew }));
    return true;
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) return false;
    throw error;
  }
}

