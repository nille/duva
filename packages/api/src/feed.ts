// Change feeds: the organization's, and one per mailbox. Each change is written in one transaction
// with its feed entry, so the feed is the audit trail.
import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { GetCommand, QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import type { Table } from "./deployment.ts";
import { documents, isNew, type Key, pk, sk, type TransactItem } from "./table.ts";

export interface Feed {
  /** The item whose position attribute holds the feed's last position. */
  counter: Key;
  /** The partition the feed's entries are in. */
  partition: string;
  /** What to say when the counter is missing. */
  missing: string;
}

/** How many changes one read of a feed lists at most. */
export const changesPerPage = 100;

// Positions are zero-padded in the sort key, so the feed sorts in position order.
export const entryKey = (feed: Feed, position: number): Key => ({ [pk]: feed.partition, [sk]: `change#${String(position).padStart(12, "0")}` });

/**
 * Writes the items with the changes' entries in the feed, in one transaction, attributed to the
 * actor `by`, or to no actor if it is undefined. The counter holds the feed's last position, and
 * the changes claim the next ones, so concurrent changes retry until each has its own. Items that
 * name where the changes are in the feed are given as a function of the first change's position.
 * If one of the items' conditions fails, the transaction's TransactionCanceledException is thrown,
 * with the items' reasons from index 1 + changes.length on.
 */
export function recordChanges(
  table: Table,
  feed: Feed,
  { by, changes, items }: { by: string | undefined; changes: object[]; items: TransactItem[] | ((first: number) => TransactItem[]) },
): Promise<void> {
  return recordInFeeds(table, [{ feed, changes }], { by, items: typeof items === "function" ? ([first]) => items(first!) : items });
}

/**
 * Writes the items with changes in several feeds, as recordChanges does with one, in one
 * transaction. Items are given as a function of each feed's first position, in the feeds' order.
 * If one of the items' conditions fails, its reason comes after each feed's counter and changes.
 */
export async function recordInFeeds(
  table: Table,
  feeds: { feed: Feed; changes: object[] }[],
  { by, items }: { by: string | undefined; items: TransactItem[] | ((firsts: number[]) => TransactItem[]) },
): Promise<void> {
  // Where each feed's counter is among the transaction's items, and so among its reasons.
  const counters = feeds.map((_, index) => feeds.slice(0, index).reduce((at, { changes }) => at + 1 + changes.length, 0));
  for (let attempt = 1; ; attempt++) {
    const lasts = await Promise.all(feeds.map(({ feed }) => lastPosition(table, feed)));
    const at = new Date().toISOString();
    try {
      await documents(table).send(
        new TransactWriteCommand({
          TransactItems: [
            ...feeds.flatMap(({ feed, changes }, index) => {
              const last = lasts[index]!;
              return [
                {
                  Update: {
                    TableName: table.name,
                    Key: feed.counter,
                    UpdateExpression: "SET #position = :next",
                    ConditionExpression: "#position = :current",
                    ExpressionAttributeNames: { "#position": "position" },
                    ExpressionAttributeValues: { ":next": last + changes.length, ":current": last },
                  },
                },
                ...changes.map((change, offset) => ({
                  Put: {
                    TableName: table.name,
                    Item: { ...entryKey(feed, last + offset + 1), ...change, position: last + offset + 1, at, actor: by },
                    ...isNew,
                  },
                })),
              ];
            }),
            ...(typeof items === "function" ? items(lasts.map((last) => last + 1)) : items),
          ],
        }),
      );
      return;
    } catch (error) {
      // Only a change that lost the race for a position tries again. One that ran into another
      // transaction on the same items is cancelled with TransactionConflict instead, and waits a little.
      const reasons = error instanceof TransactionCanceledException ? (error.CancellationReasons ?? []) : [];
      const conflict = reasons.some(({ Code }) => Code === "TransactionConflict");
      const lost = counters.some((index) => reasons[index]?.Code === "ConditionalCheckFailed");
      if (!(conflict || lost) || attempt === 10) throw error;
      if (conflict) await new Promise((resolve) => setTimeout(resolve, Math.random() * 50 * attempt));
    }
  }
}

/** The feed's last position, 0 before its first change. */
export async function lastPosition(table: Table, feed: Feed): Promise<number> {
  const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: feed.counter, ConsistentRead: true }));
  if (Item === undefined) throw new Error(feed.missing);
  return Item.position as number;
}

/**
 * The feed's entries after the position, oldest first, at most changesPerPage of them, each with
 * its position, time, actor if it has one, type and details, in that order.
 */
export async function changesAfter(table: Table, feed: Feed, after: number): Promise<Record<string, unknown>[]> {
  const { Items = [] } = await documents(table).send(
    new QueryCommand({
      TableName: table.name,
      KeyConditionExpression: `${pk} = :feed AND ${sk} > :after`,
      ExpressionAttributeValues: { ":feed": feed.partition, ":after": entryKey(feed, after)[sk] },
      Limit: changesPerPage,
    }),
  );
  // DynamoDB keeps no attribute order, so each change is rebuilt in the order the contract lists.
  return Items.map(({ [pk]: _pk, [sk]: _sk, position, at, actor, type, ...details }) => ({ position, at, actor, type, ...details }));
}
