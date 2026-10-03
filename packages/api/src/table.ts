// What every module that stores in Duva's one table shares.
import { DynamoDBDocumentClient, type TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
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
