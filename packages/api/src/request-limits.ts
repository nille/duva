// Limits on calls that need no sign-in, such as access requests (ADR-0024) and sign-in links
// (ADR-0041): each counts calls in a 10-minute window, under a key of the limit and who it counts.
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { Table } from "./deployment.ts";
import { timeToLiveAttribute } from "./infrastructure.ts";
import { documents, pk, sk } from "./table.ts";

/** The window each limit counts in. */
export const limitWindow = 10 * 60_000;

/** Where the limit counts for whom, in the window `now` is in. */
export const limitKey = (limit: string, who: string, now: number) => ({ [pk]: `limit#${limit}#${who}`, [sk]: String(Math.floor(now / limitWindow) * limitWindow) });

/** Counts one more against the limit, and returns how many are counted in its window now. */
export async function countUp(table: Table, key: Record<string, string>): Promise<number> {
  const { Attributes } = await documents(table).send(
    new UpdateCommand({
      TableName: table.name,
      Key: key,
      UpdateExpression: "ADD #count :one SET #expires = :expires",
      ExpressionAttributeNames: { "#count": "count", "#expires": timeToLiveAttribute },
      ExpressionAttributeValues: { ":one": 1, ":expires": Math.ceil((Number(key[sk]) + 2 * limitWindow) / 1000) },
      ReturnValues: "UPDATED_NEW",
    }),
  );
  return Attributes?.count as number;
}

/** How many are counted against the limit in its window. */
export async function countOf(table: Table, key: Record<string, string>): Promise<number> {
  const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: key, ConsistentRead: true }));
  return (Item?.count as number | undefined) ?? 0;
}
