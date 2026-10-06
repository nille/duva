import type { components } from "@duva/openapi";
import { jsonBody, type OperationHandler, refusal } from "./api.ts";
import { threadsPastRetention } from "./erasure.ts";
import { indexMailboxes } from "./indexing.ts";
import { type Language, languages } from "./languages.ts";
import { changeSettings, defaultSettings, organizationSettings, type OrganizationSettings } from "./organization.ts";

/** Which values each setting takes, and what refuses one it doesn't. */
const values: { [Name in keyof OrganizationSettings]: { takes: (value: unknown) => value is OrganizationSettings[Name]; refusal: string } } = {
  erasureErasesApprovals: {
    takes: (value) => typeof value === "boolean",
    refusal: "Give erasureErasesApprovals as true to turn it on, or false to turn it off.",
  },
  retentionDays: {
    takes: (value): value is number => Number.isInteger(value) && (value as number) >= 7 && (value as number) <= 365,
    refusal: "Give retentionDays as a whole number of days from 7 to 365.",
  },
  searchLanguages: {
    takes: (value): value is Language[] => Array.isArray(value) && value.every((language) => languages.includes(language)) && new Set(value).size === value.length,
    refusal: `Give searchLanguages as a list of different languages from ${languages.join(", ")}.`,
  },
};

export const getOrganizationSettings: OperationHandler = async (_event, deployment) => {
  const { settings } = await organizationSettings(deployment.table);
  return { statusCode: 200, body: settings satisfies components["schemas"]["OrganizationSettings"] };
};

export const changeOrganizationSettings: OperationHandler = async (event, deployment, actor) => {
  if (!actor?.admin) return refusal(403, "Only admins can change the organization's settings. Ask an admin to change them.");
  const body = jsonBody(event) ?? {};
  const names = Object.keys(defaultSettings);
  const unknown = Object.keys(body).find((name) => !names.includes(name));
  if (unknown !== undefined) return refusal(400, `The organization has no setting ${JSON.stringify(unknown)}. Its settings are ${names.join(", ")}.`);
  if (Object.keys(body).length === 0) return refusal(400, `Give a setting to change: ${names.join(", ")}.`);
  const refused = (Object.keys(body) as (keyof OrganizationSettings)[]).find((name) => !values[name].takes(body[name]));
  if (refused !== undefined) return refusal(400, values[refused].refusal);
  const changes = body as Partial<OrganizationSettings>;
  // Kept in one order, so a list is the same list however it was given.
  if (changes.searchLanguages !== undefined) changes.searchLanguages = languages.filter((language) => changes.searchLanguages!.includes(language));
  const settings = await changeSettings(deployment.table, { by: actor.id, changes });
  // Each mailbox's index files mail by language, so the indexer rebuilds those whose languages are
  // no longer the ones mail is indexed in.
  if (changes.searchLanguages !== undefined) await indexMailboxes(deployment.table, deployment.indexQueue);
  return { statusCode: 200, body: settings satisfies components["schemas"]["OrganizationSettings"] };
};

export const previewRetention: OperationHandler = async (event, deployment, actor) => {
  if (!actor?.admin) return refusal(403, "Only admins can preview the retention period. Ask an admin.");
  const given = event.queryStringParameters?.retentionDays ?? "";
  const retentionDays = /^\d+$/.test(given) ? Number(given) : undefined;
  if (!values.retentionDays.takes(retentionDays)) return refusal(400, values.retentionDays.refusal);
  const threads = await threadsPastRetention(deployment.table, retentionDays, new Date());
  return { statusCode: 200, body: { retentionDays, threads } satisfies components["schemas"]["RetentionPreview"] };
};
