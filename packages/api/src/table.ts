// What every module that stores in Duva's one table shares.
import { BatchGetCommand, DynamoDBDocumentClient, QueryCommand, type TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import type { Table } from "./deployment.ts";
import { tableKey } from "./infrastructure.ts";

export const { partitionKey: pk, sortKey: sk } = tableKey;

export type Key = Record<string, string>;

export type TransactItem = NonNullable<ConstructorParameters<typeof TransactWriteCommand>[0]["TransactItems"]>[number];

// A put with this condition only adds an item, and fails if it is already there.
export const isNew = { ConditionExpression: `attribute_not_exists(${pk})` };

export function documents(table: Table) {
  return DynamoDBDocumentClient.from(table.client, { marshallOptions: { removeUndefinedValues: true } });
}

/** Every item there is at the keys, each asked once, read consistently in batches as DynamoDB takes them, with only the attributes named if any are. */
export async function itemsAt(table: Table, wanted: Key[], attributes?: string[]): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  const names = attributes === undefined ? undefined : Object.fromEntries(attributes.map((name, index) => [`#a${index}`, name]));
  for (let start = 0; start < wanted.length; start += 100) {
    let asked = wanted.slice(start, start + 100);
    while (asked.length > 0) {
      const { Responses = {}, UnprocessedKeys = {} } = await documents(table).send(
        new BatchGetCommand({ RequestItems: { [table.name]: { Keys: asked, ConsistentRead: true, ...(names !== undefined && { ProjectionExpression: Object.keys(names).join(", "), ExpressionAttributeNames: names }) } } }),
      );
      items.push(...(Responses[table.name] ?? []));
      asked = (UnprocessedKeys[table.name]?.Keys ?? []) as Key[];
    }
  }
  return items;
}

/** Every item the query finds, all its pages read. */
export async function allItems(table: Table, query: Omit<ConstructorParameters<typeof QueryCommand>[0], "TableName">): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  let start: Record<string, unknown> | undefined;
  do {
    const page = await documents(table).send(new QueryCommand({ TableName: table.name, ConsistentRead: true, ...query, ExclusiveStartKey: start }));
    items.push(...(page.Items ?? []));
    start = page.LastEvaluatedKey;
  } while (start !== undefined);
  return items;
}
