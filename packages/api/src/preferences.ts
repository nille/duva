// A human's preferences: how Duva shows things to them, and the models their mailbox agent thinks
// with, from those admins allow (ADR-0035). They are the human's alone, so no change feed records
// them, and they sit beside the human's actor in its partition.
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { components } from "@duva/openapi";
import { jsonBody, type OperationHandler, refusal } from "./api.ts";
import type { Table } from "./deployment.ts";
import { mailboxAgentModels, type MailboxAgentModel } from "./agent-models.ts";
import { type Human, type Mailbox, organizationSettings, type OrganizationSettings, ownedMailboxes } from "./organization.ts";
import { documents, pk, sk } from "./table.ts";

type Preferences = components["schemas"]["Preferences"];

const preferencesKey = (human: string) => ({ [pk]: `actor#${human}`, [sk]: "preferences" });

/** The preferences that aren't a choice among a few values, whose defaults come from elsewhere or are none. */
const notChosen = ["timeZone", "opensOn", "newMailFrom", "cooEverydayModel", "cooHarderModel"] as const;

/** The human's choice of each of their mailbox agent's models, and the organization's default it keeps unless they choose. */
const cooModels = { cooEverydayModel: "mailboxAgentModel", cooHarderModel: "mailboxAgentHarderModel" } as const;

/** Each preference with choices, the first its default until the human changes it. */
const choices: { [Name in Exclude<keyof Preferences, (typeof notChosen)[number]>]: Preferences[Name][] } = {
  hourCycle: ["locale", "h12", "h23"],
  dateFormat: ["locale", "iso", "dayMonth", "monthDay"],
  mailView: ["html", "text"],
  keyboardShortcuts: ["on", "off"],
  cooSpeaksUp: ["on", "off"],
  cooLearnsFromMail: ["on", "off"],
};
const chosen = Object.keys(choices) as (keyof typeof choices)[];
const names: string[] = [...chosen, ...notChosen];

/** What opensOn names for All mailboxes (ADR-0033). */
const allMailboxes = "all";

/**
 * The preferences an item holds, each with its default if the human never changed it. The time
 * zone has no default, so a client can tell that the human never chose one, nor have Coo's models,
 * which hold only while admins allow them. Where the web app opens, and new mail's address, hold
 * only while they name one of the human's mailboxes.
 */
function preferencesOf(item: Record<string, unknown> | undefined, human: Human, mailboxes: Mailbox[], allowed: MailboxAgentModel[]): Preferences {
  const opensOn = mailboxes.some(({ id }) => id === item?.opensOn) ? (item!.opensOn as string) : allMailboxes;
  const newMailFrom = addressAmong(mailboxes, item?.newMailFrom) ?? defaultNewMailFrom(human, mailboxes);
  return {
    ...(Object.fromEntries(chosen.map((name) => [name, item?.[name] ?? choices[name][0]])) as Pick<Preferences, keyof typeof choices>),
    ...(item?.timeZone !== undefined && { timeZone: item.timeZone as string }),
    opensOn,
    ...(newMailFrom !== undefined && { newMailFrom }),
    ...Object.fromEntries(Object.keys(cooModels).flatMap((name) => (allowed.includes(item?.[name] as MailboxAgentModel) ? [[name, item![name]]] : []))),
  };
}

/** The everyday and harder models the human's mailbox agent thinks with: those they chose while admins allow them, or else the organization's. */
export async function cooModelsOf(table: Table, human: string, settings: OrganizationSettings): Promise<{ everyday: MailboxAgentModel; harder: MailboxAgentModel }> {
  const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: preferencesKey(human), ConsistentRead: true }));
  const chosen = (name: keyof typeof cooModels) => (settings.mailboxAgentAllowedModels.includes(Item?.[name] as MailboxAgentModel) ? (Item![name] as MailboxAgentModel) : settings[cooModels[name]]);
  return { everyday: chosen("cooEverydayModel"), harder: chosen("cooHarderModel") };
}

/** The address as one of the mailboxes has it, in any case, or undefined if none has it. */
const addressAmong = (mailboxes: Mailbox[], address: unknown) =>
  typeof address === "string" ? mailboxes.flatMap(({ addresses }) => addresses).find((each) => each.toLowerCase() === address.toLowerCase()) : undefined;

/** The default address of the mailbox holding the human's sign-in address, or else of their first mailbox with one. */
const defaultNewMailFrom = (human: Human, mailboxes: Mailbox[]) =>
  mailboxes.find(({ addresses }) => addresses.some((address) => address.toLowerCase() === human.email.toLowerCase()))?.defaultAddress ??
  mailboxes.find(({ defaultAddress }) => defaultAddress !== undefined)?.defaultAddress;

/** The address new mail written in All mailboxes starts from, as the human's preference says, or undefined while they have no mailbox. */
export async function newMailFromOf(table: Table, human: Human): Promise<string | undefined> {
  const [{ Item }, mailboxes] = await Promise.all([
    documents(table).send(new GetCommand({ TableName: table.name, Key: preferencesKey(human.id), ConsistentRead: true })),
    ownedMailboxes(table, human.id),
  ]);
  return preferencesOf(Item, human, mailboxes, []).newMailFrom;
}

/** Whether the human's Coo learns from mail it reads, which it does unless they switch it off (ADR-0036). */
export async function learnsFromMail(table: Table, human: string): Promise<boolean> {
  const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: preferencesKey(human), ConsistentRead: true }));
  return Item?.cooLearnsFromMail !== "off";
}

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
  const [{ Item }, mailboxes, { settings }] = await Promise.all([
    documents(table).send(new GetCommand({ TableName: table.name, Key: preferencesKey(actor.id), ConsistentRead: true })),
    ownedMailboxes(table, actor.id),
    organizationSettings(table),
  ]);
  return { statusCode: 200, body: preferencesOf(Item, actor, mailboxes, settings.mailboxAgentAllowedModels) satisfies components["schemas"]["Preferences"] };
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
  if (body.timeZone !== undefined && body.timeZone !== null) {
    const timeZone = timeZoneNamed(body.timeZone);
    if (timeZone === undefined) return refusal(400, `${JSON.stringify(body.timeZone)} isn't a time zone. Give timeZone as an IANA name, such as Europe/Stockholm.`);
    body.timeZone = timeZone;
  }
  const { table } = deployment;
  const [mailboxes, { settings }] = await Promise.all([ownedMailboxes(table, actor.id), organizationSettings(table)]);
  const allowed = settings.mailboxAgentAllowedModels;
  for (const name of Object.keys(cooModels) as (keyof typeof cooModels)[]) {
    if (body[name] !== undefined && body[name] !== null && !allowed.includes(body[name] as MailboxAgentModel)) {
      const named = allowed.map((model) => `${model} (${mailboxAgentModels[model].name})`).join(", ");
      return refusal(400, `${JSON.stringify(body[name])} isn't a model admins allow. Give ${name} as one of ${named}, or null to keep the organization's default.`);
    }
  }
  if (body.opensOn !== undefined && body.opensOn !== allMailboxes && !mailboxes.some(({ id }) => id === body.opensOn)) {
    return refusal(400, `${JSON.stringify(body.opensOn)} isn't one of your mailboxes. Give opensOn as all, for All mailboxes, or the ID of one of yours, which listing your mailboxes gives.`);
  }
  if (body.newMailFrom !== undefined && body.newMailFrom !== null) {
    const address = addressAmong(mailboxes, body.newMailFrom);
    if (address === undefined) return refusal(400, `${JSON.stringify(body.newMailFrom)} isn't one of your addresses. Give newMailFrom as an address of one of your mailboxes, which listing your mailboxes gives.`);
    body.newMailFrom = address;
  }
  // Each preference is set on its own, so two changes at once to different ones both hold. The time
  // zone, the address or a model given as null is removed, so the human has none, or the default, again.
  const changes = Object.entries(body).map(([name, value], index) => ({ name, value, index }));
  const set = changes.filter(({ value }) => value !== null);
  const removed = changes.filter(({ value }) => value === null);
  const { Attributes } = await documents(table).send(
    new UpdateCommand({
      TableName: table.name,
      Key: preferencesKey(actor.id),
      UpdateExpression: [
        ...(set.length > 0 ? [`SET ${set.map(({ index }) => `#name${index} = :value${index}`).join(", ")}`] : []),
        ...(removed.length > 0 ? [`REMOVE ${removed.map(({ index }) => `#name${index}`).join(", ")}`] : []),
      ].join(" "),
      ExpressionAttributeNames: Object.fromEntries(changes.map(({ name, index }) => [`#name${index}`, name])),
      ...(set.length > 0 && { ExpressionAttributeValues: Object.fromEntries(set.map(({ value, index }) => [`:value${index}`, value])) }),
      ReturnValues: "ALL_NEW",
    }),
  );
  return { statusCode: 200, body: preferencesOf(Attributes, actor, mailboxes, allowed) satisfies components["schemas"]["Preferences"] };
};
