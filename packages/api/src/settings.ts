import type { components } from "@duva/openapi";
import { actorNamed, alertItems, limitsRead } from "./alerting.ts";
import { jsonBody, type OperationHandler, refusal } from "./api.ts";
import { threadsPastRetention } from "./erasure.ts";
import { indexMailboxes } from "./indexing.ts";
import { type Language, languages } from "./languages.ts";
import { type MailboxAgentModel, mailboxAgentModels, type MailboxAgentProfile, mailboxAgentProfiles, type MailboxAgentRegion, mailboxAgentRegions, profileRunsIn } from "./agent-models.ts";
import { changeSettings, defaultSettings, isAdmin, lowerLimitsToCaps, organizationSettings, type OrganizationSettings } from "./organization.ts";

/** Whether the value is a send limit or a cap on one: a whole number from 1 to 10,000. */
export const isLimit = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 10_000;

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
  agentSendsPerHourCap: { takes: isLimit, refusal: "Give agentSendsPerHourCap as a whole number from 1 to 10000." },
  agentNewRecipientsPerDayCap: { takes: isLimit, refusal: "Give agentNewRecipientsPerDayCap as a whole number from 1 to 10000." },
  undoWindowSeconds: {
    takes: (value): value is number => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 120,
    refusal: "Give undoWindowSeconds as a whole number of seconds from 0 to 120.",
  },
  mailboxAgentModel: {
    takes: (value): value is MailboxAgentModel => typeof value === "string" && value in mailboxAgentModels,
    refusal: `Give mailboxAgentModel as one of ${Object.keys(mailboxAgentModels).join(", ")}.`,
  },
  mailboxAgentProfile: {
    takes: (value): value is MailboxAgentProfile => mailboxAgentProfiles.includes(value as MailboxAgentProfile),
    refusal: `Give mailboxAgentProfile as ${mailboxAgentProfiles.join(", ")}.`,
  },
  mailboxAgentRegion: {
    takes: (value): value is MailboxAgentRegion => mailboxAgentRegions.includes(value as MailboxAgentRegion),
    refusal: `Give mailboxAgentRegion as one of ${mailboxAgentRegions.join(", ")}.`,
  },
  mailboxAgentSpendCap: {
    takes: (value): value is number => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 10_000,
    refusal: "Give mailboxAgentSpendCap as a whole number of US dollars from 0 to 10000.",
  },
};

export const getOrganizationSettings: OperationHandler = async (_event, deployment) => {
  const { settings } = await organizationSettings(deployment.table, deployment.region);
  return { statusCode: 200, body: settings satisfies components["schemas"]["OrganizationSettings"] };
};

export const changeOrganizationSettings: OperationHandler = async (event, deployment, actor) => {
  if (!isAdmin(actor)) return refusal(403, "Only admins can change the organization's settings. Ask an admin to change them.");
  const body = jsonBody(event) ?? {};
  const names = Object.keys(defaultSettings);
  const unknown = Object.keys(body).find((name) => !names.includes(name));
  if (unknown !== undefined) return refusal(400, `The organization has no setting ${JSON.stringify(unknown)}. Its settings are ${names.join(", ")}.`);
  if (Object.keys(body).length === 0) return refusal(400, `Give a setting to change: ${names.join(", ")}.`);
  const refused = (Object.keys(body) as (keyof OrganizationSettings)[]).find((name) => !values[name].takes(body[name]));
  if (refused !== undefined) return refusal(400, values[refused].refusal);
  const changes = body as Partial<OrganizationSettings>;
  const { settings: current } = await organizationSettings(deployment.table, deployment.region);
  const profile = changes.mailboxAgentProfile ?? current.mailboxAgentProfile;
  const region = changes.mailboxAgentRegion ?? current.mailboxAgentRegion;
  if (!profileRunsIn(profile, region)) {
    return refusal(400, `The ${profile} profile runs only from ${profile === "eu" ? "an EU" : "a US"} region, and ${region} isn't one. Give mailboxAgentRegion as one, or mailboxAgentProfile as global.`);
  }
  // Kept in one order, so a list is the same list however it was given.
  if (changes.searchLanguages !== undefined) changes.searchLanguages = languages.filter((language) => changes.searchLanguages!.includes(language));
  const settings = await changeSettings(deployment.table, { by: actor!.id, changes, region: deployment.region });
  // Each mailbox's index files mail by language, so the indexer rebuilds those whose languages are
  // no longer the ones mail is indexed in.
  if (changes.searchLanguages !== undefined) await indexMailboxes(deployment.table, deployment.indexQueue);
  // Each change to a cap does it, so a change again finishes what one that stopped partway left.
  // Each agent whose limits it lowers is an alert to its sponsor, unless they lowered it themselves.
  if ("agentSendsPerHourCap" in body || "agentNewRecipientsPerDayCap" in body) {
    const who = await actorNamed(deployment.table, actor!.id);
    await lowerLimitsToCaps(deployment.table, actor!.id, (agent, after) =>
      agent.sponsor === actor!.id
        ? []
        : alertItems(deployment.table, { kind: "limitsChangedBy", agent, by: actor!.id, what: `${who} lowered the organization's caps, so ${agent.name}'s limits are now ${limitsRead(after)}.` }),
    );
  }
  return { statusCode: 200, body: settings satisfies components["schemas"]["OrganizationSettings"] };
};

export const previewRetention: OperationHandler = async (event, deployment, actor) => {
  if (!isAdmin(actor)) return refusal(403, "Only admins can preview the retention period. Ask an admin.");
  const given = event.queryStringParameters?.retentionDays ?? "";
  const retentionDays = /^\d+$/.test(given) ? Number(given) : undefined;
  if (!values.retentionDays.takes(retentionDays)) return refusal(400, values.retentionDays.refusal);
  const threads = await threadsPastRetention(deployment.table, retentionDays, new Date());
  return { statusCode: 200, body: { retentionDays, threads } satisfies components["schemas"]["RetentionPreview"] };
};
