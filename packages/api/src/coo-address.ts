// Coo's address (ADR-0040): each human's Coo has an address of the organization, by default their
// default address's local part with -coo, on its domain, or -coo2 and on where that's taken. It is
// listed in the receipt rules as any address, but delivers to the human's Coo rather than to a
// mailbox, so Coo still owns none (ADR-0030). It comes with the human's first mailbox, or from
// setup for those who had one before, an admin can change it, and it goes with the human. Its human
// lists who may mail it beside their own addresses, in their partition, so the list goes with them.
import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import type { components } from "@duva/openapi";
import { addressGiven, addressTaken } from "./addresses.ts";
import type { Table } from "./deployment.ts";
import { domainOf, isEmailAddress } from "./email-address.ts";
import { jsonBody, type OperationHandler, refusal } from "./operation-handler.ts";
import {
  actorKey,
  addressKey,
  addressTarget,
  aliasDomains,
  allHumans,
  duva,
  findActor,
  type Human,
  isAdmin,
  mailboxesInOrder,
  mirroredAddress,
  ownedMailboxes,
  recordChange,
} from "./organization.ts";
import { syncRecipients } from "./receiving.ts";
import { documents, isNew, pk, sk } from "./table.ts";

type CooAddress = components["schemas"]["CooAddress"];

// Which address the human's Coo has, in their partition.
const pointerKey = (human: string) => ({ [pk]: actorKey(human)[pk]!, [sk]: "coo-address" });
// Whom the human lets mail it beside their own addresses.
const sendersKey = (human: string) => ({ [pk]: actorKey(human)[pk]!, [sk]: "coo-senders" });

/** The most addresses a human lists beside their own. */
const mostSenders = 100;

/** The address of the human's Coo, or undefined if it has none. */
export async function cooAddressOf(table: Table, human: string): Promise<string | undefined> {
  const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: pointerKey(human), ConsistentRead: true }));
  return Item?.address as string | undefined;
}

/**
 * Gives the human's Coo its address, if they have a personal mailbox and it has none: the local
 * part of their first mailbox's default address with -coo, or the first of -coo2 and on that the
 * organization doesn't have. Returns the address it got, or undefined if it got none. The receipt
 * rules are the caller's to follow.
 */
export async function giveCooAddress(table: Table, human: string): Promise<string | undefined> {
  if ((await cooAddressOf(table, human)) !== undefined) return undefined;
  const found = await findActor(table, human);
  if (found?.kind !== "human") return undefined;
  const first = mailboxesInOrder(await ownedMailboxes(table, human), found.email).find(({ defaultAddress }) => defaultAddress !== undefined);
  if (first === undefined) return undefined;
  const address = first.defaultAddress!;
  const local = address.slice(0, address.lastIndexOf("@"));
  for (let number = 1; number <= 100; number++) {
    const candidate = `${local}-coo${number === 1 ? "" : number}@${domainOf(address)}`;
    // An address is at most 64 characters before the @, which every mail server takes.
    if (candidate.lastIndexOf("@") > 64) return undefined;
    if ((await addressTarget(table, candidate)) !== undefined) continue;
    try {
      await recordChange(table, duva, { type: "cooAddressChanged", human, address: candidate }, [
        { Put: { TableName: table.name, Item: { ...addressKey(candidate), address: candidate, coo: human }, ...isNew } },
        { Put: { TableName: table.name, Item: { ...pointerKey(human), address: candidate }, ...isNew } },
      ]);
      return candidate;
    } catch (error) {
      const reasons = error instanceof TransactionCanceledException ? (error.CancellationReasons ?? []) : [];
      // Another call gave the Coo its address first.
      if (reasons[3]?.Code === "ConditionalCheckFailed") return undefined;
      // Another address took the candidate meanwhile.
      if (reasons[2]?.Code !== "ConditionalCheckFailed") throw error;
    }
  }
  return undefined;
}

/**
 * Gives every human with a personal mailbox their Coo's address, as the setup after a deploy does,
 * and says which got one other than -coo. Run again, it gives none twice.
 */
export async function giveCooAddresses(table: Table, log: (line: string) => void = console.log): Promise<void> {
  for (const human of await allHumans(table)) {
    const given = await giveCooAddress(table, human.id);
    if (given !== undefined && !/-coo@/.test(given)) log(`${human.email}'s Coo got the address ${given}, since the one ending -coo was taken.`);
  }
}

/** The humans with a personal mailbox whose Coo has no address, as a setup that didn't finish leaves them. */
export async function cooAddressesLeft(table: Table): Promise<Human[]> {
  const left: Human[] = [];
  for (const human of await allHumans(table)) {
    if ((await ownedMailboxes(table, human.id)).length > 0 && (await cooAddressOf(table, human.id)) === undefined) left.push(human);
  }
  return left;
}

/** Frees the address of the human's Coo, as when the human goes, on behalf of the actor `by`. The receipt rules are the caller's to follow. */
export async function freeCooAddress(table: Table, { human, by }: { human: string; by: string }): Promise<void> {
  const before = await cooAddressOf(table, human);
  if (before === undefined) return;
  await recordChange(table, by, { type: "cooAddressChanged", human, before }, [
    { Delete: { TableName: table.name, Key: addressKey(before), ConditionExpression: "coo = :human", ExpressionAttributeValues: { ":human": human } } },
    { Delete: { TableName: table.name, Key: pointerKey(human), ConditionExpression: "address = :before", ExpressionAttributeValues: { ":before": before } } },
  ]).catch((error: unknown) => {
    // Freed meanwhile.
    if (!(error instanceof TransactionCanceledException)) throw error;
  });
}

/** The human's own addresses, which may always mail their Coo: their sign-in address and their personal mailboxes', in the order the web app lists the mailboxes. */
export async function ownAddressesOf(table: Table, human: Human): Promise<string[]> {
  const addresses = mailboxesInOrder(await ownedMailboxes(table, human.id), human.email).flatMap(({ addresses }) => addresses);
  return [...new Set([human.email.toLowerCase(), ...addresses])];
}

/** The addresses the human listed beside their own, in alphabetical order. */
export async function listedSenders(table: Table, human: string): Promise<string[]> {
  const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: sendersKey(human), ConsistentRead: true }));
  return (Item?.senders as string[] | undefined) ?? [];
}

/**
 * Whether the address is one of the human's own, with or without a plus tag, or on an alias domain
 * that mirrors it, so Coo speaks to it as to them (#188).
 */
export async function isOwnAddress(table: Table, human: Human, address: string): Promise<boolean> {
  const from = address.toLowerCase();
  const [own, aliases] = await Promise.all([ownAddressesOf(table, human), aliasDomains(table)]);
  return own.includes(from) || own.includes(mirroredAddress(from, aliases));
}

/** Whether the address may mail the human's Coo: one of their own, or one they listed. */
export async function mayAskCoo(table: Table, human: Human, address: string): Promise<boolean> {
  const [own, listed] = await Promise.all([isOwnAddress(table, human, address), listedSenders(table, human.id)]);
  return own || listed.includes(address.toLowerCase());
}

async function cooAddressRead(table: Table, human: Human): Promise<CooAddress> {
  const [address, ownAddresses, allowedSenders] = await Promise.all([cooAddressOf(table, human.id), ownAddressesOf(table, human), listedSenders(table, human.id)]);
  return { ...(address !== undefined && { address }), ownAddresses, allowedSenders };
}

/** The human asking about their own Coo's address, or a refusal. */
async function ownCoo(table: Table, actor: Parameters<OperationHandler>[2]): Promise<Human | ReturnType<typeof refusal>> {
  if (actor?.kind !== "human") return refusal(403, "Only a human has a Coo with an address. Ask your sponsor.");
  if ((await ownedMailboxes(table, actor.id)).length === 0) return refusal(404, "You have no mailbox, so no Coo. Ask an admin to create a mailbox for you.");
  return actor;
}

export const getCooAddress: OperationHandler = async (_event, deployment, actor) => {
  const human = await ownCoo(deployment.table, actor);
  if ("statusCode" in human) return human;
  return { statusCode: 200, body: await cooAddressRead(deployment.table, human) };
};

export const changeCooSenders: OperationHandler = async (event, deployment, actor) => {
  const human = await ownCoo(deployment.table, actor);
  if ("statusCode" in human) return human;
  const given = jsonBody(event)?.allowedSenders;
  if (!Array.isArray(given)) return refusal(400, "Give allowedSenders as a list of addresses, like [\"assistant@example.org\"].");
  const senders = new Set<string>();
  for (const each of given) {
    const address = typeof each === "string" ? each.trim().toLowerCase() : "";
    if (!isEmailAddress(address)) return refusal(400, `${JSON.stringify(each)} isn't an address. Give each sender as an address, like assistant@example.org.`);
    senders.add(address);
  }
  if (senders.size > mostSenders) return refusal(400, `List at most ${mostSenders} senders. Your own addresses needn't be listed.`);
  await documents(deployment.table).send(new PutCommand({ TableName: deployment.table.name, Item: { ...sendersKey(human.id), senders: [...senders].sort() } }));
  return { statusCode: 200, body: await cooAddressRead(deployment.table, human) };
};

export const changeCooAddress: OperationHandler = async (event, deployment, actor) => {
  if (!isAdmin(actor)) return refusal(403, "Only admins can change a Coo's address. Ask an admin to.");
  const id = event.pathParameters?.human ?? "";
  const human = await findActor(deployment.table, id);
  if (human?.kind !== "human") return refusal(404, `There is no human ${JSON.stringify(id)}. List the humans to find their ID.`);
  if ((await ownedMailboxes(deployment.table, human.id)).length === 0) return refusal(409, `${human.email} has no mailbox, so no Coo. Create a mailbox for them first.`);
  const address = await addressGiven(deployment, jsonBody(event)?.address);
  if (typeof address !== "string") return address;
  const { table } = deployment;
  const before = await cooAddressOf(table, human.id);
  try {
    await recordChange(table, actor!.id, { type: "cooAddressChanged", human: human.id, address, ...(before !== undefined && { before }) }, [
      { Put: { TableName: table.name, Item: { ...addressKey(address), address, coo: human.id }, ...isNew } },
      before === undefined
        ? { Put: { TableName: table.name, Item: { ...pointerKey(human.id), address }, ...isNew } }
        : { Put: { TableName: table.name, Item: { ...pointerKey(human.id), address }, ConditionExpression: "address = :before", ExpressionAttributeValues: { ":before": before } } },
      ...(before === undefined ? [] : [{ Delete: { TableName: table.name, Key: addressKey(before), ConditionExpression: "coo = :human", ExpressionAttributeValues: { ":human": human.id } } }]),
    ]);
  } catch (error) {
    const reasons = error instanceof TransactionCanceledException ? (error.CancellationReasons ?? []) : [];
    if (reasons[2]?.Code === "ConditionalCheckFailed") return addressTaken(deployment, address);
    if (reasons.slice(3).some(({ Code }) => Code === "ConditionalCheckFailed")) return refusal(409, `${human.email}'s Coo's address changed meanwhile. Try again.`);
    throw error;
  }
  // SES takes mail to the new address, and refuses mail to the one before, before the call is answered.
  await syncRecipients(table, deployment.receiving);
  return { statusCode: 200, body: { address, coo: human.id } satisfies components["schemas"]["Address"] };
};
