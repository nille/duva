// A human's preferences: how Duva shows things to them. They only change what the human sees, so no
// change feed records them, and they sit beside the human's actor in its partition.
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { components } from "@duva/openapi";
import { jsonBody, type OperationHandler, refusal } from "./api.ts";
import { documents, pk, sk } from "./table.ts";

type Preferences = components["schemas"]["Preferences"];

const preferencesKey = (human: string) => ({ [pk]: `actor#${human}`, [sk]: "preferences" });

/** Each preference's choices, the first its default until the human changes it. */
const choices: { [Name in keyof Preferences]: Preferences[Name][] } = {
  hourCycle: ["locale", "h12", "h23"],
  dateFormat: ["locale", "iso", "dayMonth", "monthDay"],
};
const names = Object.keys(choices) as (keyof Preferences)[];

/** The preferences an item holds, each with its default if the human never changed it. */
const preferencesOf = (item: Record<string, unknown> | undefined) => Object.fromEntries(names.map((name) => [name, item?.[name] ?? choices[name][0]])) as Preferences;

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
  const unknown = Object.keys(body).find((name) => !(names as string[]).includes(name));
  if (unknown !== undefined) return refusal(400, `Duva has no preference ${JSON.stringify(unknown)}. Its preferences are ${names.join(", ")}.`);
  if (Object.keys(body).length === 0) return refusal(400, `Give a preference to change: ${names.join(", ")}.`);
  for (const name of names) {
    const values: string[] = choices[name];
    if (body[name] !== undefined && !values.includes(body[name] as string)) return refusal(400, `Give ${name} as ${values.slice(0, -1).join(", ")} or ${values.at(-1)}.`);
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
