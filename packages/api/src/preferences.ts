// A human's preferences: how Duva shows things to them. They only change what the human sees, so no
// change feed records them, and they sit beside the human's actor in its partition.
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { components } from "@duva/openapi";
import { jsonBody, type OperationHandler, refusal } from "./api.ts";
import type { Table } from "./deployment.ts";
import { documents, pk, sk } from "./table.ts";

type Preferences = components["schemas"]["Preferences"];

const preferencesKey = (human: string) => ({ [pk]: `actor#${human}`, [sk]: "preferences" });

/** Each preference with choices, the first its default until the human changes it. */
const choices: { [Name in Exclude<keyof Preferences, "timeZone">]: Preferences[Name][] } = {
  hourCycle: ["locale", "h12", "h23"],
  dateFormat: ["locale", "iso", "dayMonth", "monthDay"],
  mailView: ["html", "text"],
};
const chosen = Object.keys(choices) as (keyof typeof choices)[];
// The time zone has no default, so a client can tell that the human never chose one.
const names: string[] = [...chosen, "timeZone"];

/** The preferences an item holds, each with its default if the human never changed it. */
const preferencesOf = (item: Record<string, unknown> | undefined) =>
  ({ ...Object.fromEntries(chosen.map((name) => [name, item?.[name] ?? choices[name][0]])), ...(item?.timeZone !== undefined && { timeZone: item.timeZone }) }) as Preferences;

/** The time zone with the name, as an IANA name or UTC, in the case Intl gives it, or undefined if there is none. */
export function timeZoneNamed(name: unknown): string | undefined {
  if (typeof name !== "string" || name === "") return undefined;
  try {
    return new Intl.DateTimeFormat("en", { timeZone: name }).resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

/** The human's time zone, or undefined if they never chose one. */
export async function timeZoneOf(table: Table, human: string): Promise<string | undefined> {
  const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: preferencesKey(human), ConsistentRead: true }));
  return Item?.timeZone as string | undefined;
}

const agentsRefused = () => refusal(403, "Only humans have preferences. An agent's settings are its sponsor's to change.");

export const getPreferences: OperationHandler = async (_event, deployment, actor) => {
  if (actor?.kind !== "human") return agentsRefused();
  const { table } = deployment;
  const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: preferencesKey(actor.id), ConsistentRead: true }));
  return { statusCode: 200, body: preferencesOf(Item) satisfies components["schemas"]["Preferences"] };
};

export const changePreferences: OperationHandler = async (event, deployment, actor) => {
  if (actor?.kind !== "human") return agentsRefused();
  const body = jsonBody(event) ?? {};
  const unknown = Object.keys(body).find((name) => !names.includes(name));
  if (unknown !== undefined) return refusal(400, `Duva has no preference ${JSON.stringify(unknown)}. Its preferences are ${names.join(", ")}.`);
  if (Object.keys(body).length === 0) return refusal(400, `Give a preference to change: ${names.join(", ")}.`);
  for (const name of chosen) {
    const values: string[] = choices[name];
    if (body[name] !== undefined && !values.includes(body[name] as string)) return refusal(400, `Give ${name} as ${values.slice(0, -1).join(", ")} or ${values.at(-1)}.`);
  }
  if (body.timeZone !== undefined) {
    const timeZone = timeZoneNamed(body.timeZone);
    if (timeZone === undefined) return refusal(400, `${JSON.stringify(body.timeZone)} isn't a time zone. Give timeZone as an IANA name, such as Europe/Stockholm.`);
    body.timeZone = timeZone;
  }
  const changes = Object.entries(body);
  // Each preference is set on its own, so two changes at once to different ones both hold.
  const { table } = deployment;
  const { Attributes } = await documents(table).send(
    new UpdateCommand({
      TableName: table.name,
      Key: preferencesKey(actor.id),
      UpdateExpression: `SET ${changes.map((_, index) => `#name${index} = :value${index}`).join(", ")}`,
      ExpressionAttributeNames: Object.fromEntries(changes.map(([name], index) => [`#name${index}`, name])),
      ExpressionAttributeValues: Object.fromEntries(changes.map(([, value], index) => [`:value${index}`, value])),
      ReturnValues: "ALL_NEW",
    }),
  );
  return { statusCode: 200, body: preferencesOf(Attributes) satisfies components["schemas"]["Preferences"] };
};
