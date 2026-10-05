// A mailbox's labels: the built-in Inbox, Spam and Trash, and the labels the mailbox's readers make.
// Threads list their labels by ID, so renaming a label leaves its threads as they are.
import { randomUUID } from "node:crypto";
import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { components } from "@duva/openapi";
import type { Table } from "./deployment.ts";
import { recordChanges } from "./feed.ts";
import { type Cursor, cursorOf, inbox, labelThreads, spam, threadsMarkedAtOnce, threadsWithLabel, trash, unreadWithLabel } from "./mail.ts";
import { mailboxFeed, mailboxKey } from "./organization.ts";
import { documents, isNew, pk, sk } from "./table.ts";

export type Label = components["schemas"]["Label"];

/** The built-in labels, in the order they are listed. */
export const builtInLabels = [
  { id: inbox, name: "Inbox" },
  { id: spam, name: "Spam" },
  { id: trash, name: "Trash" },
];

/** Names a label can't have, since the web app shows them beside the labels: the built-in labels' and the listings'. */
const reserved = new Set([...builtInLabels.map(({ name }) => name), "All mail", "Sent"].map((name) => name.toLowerCase()));

const partition = (mailbox: string) => mailboxKey(mailbox)[pk]!;
const labelKey = (mailbox: string, label: string) => ({ [pk]: partition(mailbox), [sk]: `label#${label}` });
// Each name points at its label, so no two labels in a mailbox share one, in any case.
const nameKey = (mailbox: string, name: string) => ({ [pk]: partition(mailbox), [sk]: `label-name#${name.toLowerCase()}` });

/** Thrown when the name is another label's, or one a label can't have. */
export class NameTaken extends Error {}

/** The mailbox's own label with the ID, or undefined if it has none. */
async function ownLabel(table: Table, mailbox: string, id: string): Promise<{ id: string; name: string } | undefined> {
  const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: labelKey(mailbox, id), ConsistentRead: true }));
  return Item === undefined ? undefined : { id: Item.id as string, name: Item.name as string };
}

/** Whether the mailbox has a label with the ID, built in or its own. */
export async function hasLabel(table: Table, mailbox: string, id: string): Promise<boolean> {
  return builtInLabels.some((label) => label.id === id) || (await ownLabel(table, mailbox, id)) !== undefined;
}

/** The mailbox's labels, built in first and then its own by name, each with how many unread threads it lists. */
export async function listLabels(table: Table, mailbox: string): Promise<Label[]> {
  const { Items = [] } = await documents(table).send(
    new QueryCommand({
      TableName: table.name,
      KeyConditionExpression: `${pk} = :mailbox AND begins_with(${sk}, :label)`,
      ExpressionAttributeValues: { ":mailbox": partition(mailbox), ":label": labelKey(mailbox, "")[sk] },
      ConsistentRead: true,
    }),
  );
  const own = Items.map((item) => ({ id: item.id as string, name: item.name as string })).sort((a, b) => a.name.localeCompare(b.name));
  const labels = [...builtInLabels.map((label) => ({ ...label, builtIn: true })), ...own.map((label) => ({ ...label, builtIn: false }))];
  return Promise.all(labels.map(async (label) => ({ ...label, unread: await unreadWithLabel(table, mailbox, label.id) })));
}

/** Creates a label in the mailbox, recorded in its change feed under the actor `by`. Throws NameTaken if the name is taken. */
export async function createLabel(table: Table, { mailbox, name, by }: { mailbox: string; name: string; by: string }): Promise<Label> {
  if (reserved.has(name.toLowerCase())) throw new NameTaken();
  const id = randomUUID();
  try {
    await recordChanges(table, mailboxFeed(mailbox), {
      by,
      changes: [{ type: "labelCreated", label: id, name }],
      items: [
        { Put: { TableName: table.name, Item: { ...nameKey(mailbox, name), label: id }, ...isNew } },
        { Put: { TableName: table.name, Item: { ...labelKey(mailbox, id), id, name }, ...isNew } },
      ],
    });
  } catch (error) {
    throw nameTaken(error, 2);
  }
  return { id, name, builtIn: false, unread: 0 };
}

/**
 * Renames the mailbox's own label, recorded in its change feed under the actor `by`. Returns
 * undefined if the mailbox has no such label of its own, or it changed meanwhile, and throws
 * NameTaken if the name is taken.
 */
export async function renameLabel(table: Table, { mailbox, label, name, by }: { mailbox: string; label: string; name: string; by: string }): Promise<Label | undefined> {
  const current = await ownLabel(table, mailbox, label);
  if (current === undefined) return undefined;
  const sameName = current.name.toLowerCase() === name.toLowerCase();
  if (!sameName && reserved.has(name.toLowerCase())) throw new NameTaken();
  try {
    await recordChanges(table, mailboxFeed(mailbox), {
      by,
      changes: [{ type: "labelRenamed", label, name }],
      items: [
        // A label renamed to the same name in other capitals keeps its claim on the name.
        ...(sameName
          ? []
          : [
              { Put: { TableName: table.name, Item: { ...nameKey(mailbox, name), label }, ...isNew } },
              { Delete: { TableName: table.name, Key: nameKey(mailbox, current.name) } },
            ]),
        // Only the name read is replaced, so of two renames at once the second fails.
        {
          Put: {
            TableName: table.name,
            Item: { ...labelKey(mailbox, label), id: label, name },
            ConditionExpression: "#name = :current",
            ExpressionAttributeNames: { "#name": "name" },
            ExpressionAttributeValues: { ":current": current.name },
          },
        },
      ],
    });
  } catch (error) {
    // The label was renamed or deleted since it was read.
    if (reasonAt(error, sameName ? 2 : 4) === "ConditionalCheckFailed") return undefined;
    throw nameTaken(error, 2);
  }
  return { id: label, name, builtIn: false, unread: await unreadWithLabel(table, mailbox, label) };
}

/**
 * Removes the mailbox's own label from each of its threads, each recorded in the change feed under
 * the actor `by`, and then deletes it, recorded too. Returns the label as it was, or undefined if
 * the mailbox has no such label of its own. A deletion that stops partway finishes when run again.
 * A thread labelled while the label is being deleted can keep it, since labelling doesn't check
 * the label in the same transaction.
 */
export async function deleteLabel(table: Table, { mailbox, label, by }: { mailbox: string; label: string; by: string }): Promise<Label | undefined> {
  const current = await ownLabel(table, mailbox, label);
  if (current === undefined) return undefined;
  const unread = await unreadWithLabel(table, mailbox, label);
  let after: Cursor | undefined;
  do {
    const page = await threadsWithLabel(table, mailbox, label, { limit: threadsMarkedAtOnce, after, withHidden: true });
    if (page.threads.length > 0) await labelThreads(table, { mailbox, threads: page.threads.map(({ id }) => id), add: [], remove: [label], by });
    after = page.next === undefined ? undefined : cursorOf(page.next);
  } while (after !== undefined);
  await recordChanges(table, mailboxFeed(mailbox), {
    by,
    changes: [{ type: "labelDeleted", label }],
    items: [
      { Delete: { TableName: table.name, Key: labelKey(mailbox, label) } },
      { Delete: { TableName: table.name, Key: nameKey(mailbox, current.name) } },
    ],
  });
  return { ...current, builtIn: false, unread };
}

/** NameTaken if the transaction failed on the name's claim, at the index among its reasons, or else the error. */
function nameTaken(error: unknown, index: number): unknown {
  return reasonAt(error, index) === "ConditionalCheckFailed" ? new NameTaken() : error;
}

/** Why the transaction was cancelled at the index among its reasons, if it was. */
function reasonAt(error: unknown, index: number): string | undefined {
  return error instanceof TransactionCanceledException ? error.CancellationReasons?.[index]?.Code : undefined;
}
