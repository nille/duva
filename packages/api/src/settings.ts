import type { components } from "@duva/openapi";
import { jsonBody, type OperationHandler, refusal } from "./api.ts";
import { threadsPastRetention } from "./erasure.ts";
import { indexMailboxes } from "./indexing.ts";
import { type Language, languages } from "./languages.ts";
import type { Deployment } from "./deployment.ts";
import { listed, setupOperation } from "./setup.ts";
import { agentSettings, allHumans, changeSettings, defaultSettings, limitCaps, lowerLimitsToCaps, organizationSettings, type OrganizationSettings, sponsoredAgents } from "./organization.ts";

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
};

export const getOrganizationSettings: OperationHandler = async (_event, deployment) => {
  const { settings } = await organizationSettings(deployment.table);
  return { statusCode: 200, body: settings satisfies components["schemas"]["OrganizationSettings"] };
};

export const changeOrganizationSettings = setupOperation("changeOrganizationSettings", async (event, deployment, actor) => {
  if (!actor.admin) return refusal(403, "Only admins can change the organization's settings. Ask an admin to change them.");
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
  return {
    preview: await settingsPreview(deployment, changes),
    run: async () => {
      const settings = await changeSettings(deployment.table, { by: actor.id, changes });
      // Each mailbox's index files mail by language, so the indexer rebuilds those whose languages are
      // no longer the ones mail is indexed in.
      if (changes.searchLanguages !== undefined) await indexMailboxes(deployment.table, deployment.indexQueue);
      // Each change to a cap does it, so a change again finishes what one that stopped partway left.
      if ("agentSendsPerHourCap" in body || "agentNewRecipientsPerDayCap" in body) await lowerLimitsToCaps(deployment.table, actor.id);
      return { statusCode: 200, body: settings satisfies components["schemas"]["OrganizationSettings"] };
    },
  };
});

/** What changing the settings does, a sentence for each that changes. */
async function settingsPreview(deployment: Deployment, changes: Partial<OrganizationSettings>): Promise<string[]> {
  const { settings } = await organizationSettings(deployment.table);
  const preview: string[] = [];
  const { retentionDays, erasureErasesApprovals, searchLanguages } = changes;
  if (retentionDays !== undefined && retentionDays !== settings.retentionDays) {
    const threads = retentionDays < settings.retentionDays ? await threadsPastRetention(deployment.table, retentionDays, new Date()) : 0;
    preview.push(`Keeps threads in Trash and Spam ${retentionDays} days, instead of ${settings.retentionDays}.`);
    if (threads > 0) preview.push(`${threads === 1 ? "1 thread there is older than that, which the eraser erases" : `${threads} threads there are older than that, which the eraser erases`} for good.`);
  }
  if (erasureErasesApprovals !== undefined && erasureErasesApprovals !== settings.erasureErasesApprovals) {
    preview.push(`Erasing a thread ${erasureErasesApprovals ? "also erases" : "keeps"} the approval records of the agents' sends in it.`);
  }
  if (searchLanguages !== undefined && searchLanguages.join() !== settings.searchLanguages.join()) {
    preview.push(`Searches mail in ${listed(searchLanguages)}, instead of ${listed(settings.searchLanguages)}, which rebuilds every mailbox's search index.`);
  }
  for (const [limit, cap] of Object.entries(limitCaps) as [keyof typeof limitCaps, (typeof limitCaps)[keyof typeof limitCaps]][]) {
    const value = changes[cap];
    if (value === undefined || value === settings[cap]) continue;
    preview.push(`Caps each agent's ${capNames[cap]} at ${value}, instead of ${settings[cap]}.`);
    if (value > settings[cap]) continue;
    const above: string[] = [];
    for (const human of await allHumans(deployment.table)) {
      for (const agent of await sponsoredAgents(deployment.table, human.id)) if ((await agentSettings(deployment.table, agent.id)).settings[limit] > value) above.push(agent.name);
    }
    if (above.length > 0) preview.push(`It lowers the ${capNames[cap]} of ${listed(above)} to ${value}.`);
  }
  return preview;
}

// What each cap limits, as a preview says it.
const capNames = { agentSendsPerHourCap: "sends an hour", agentNewRecipientsPerDayCap: "new recipients a day" } as const;

export const previewRetention: OperationHandler = async (event, deployment, actor) => {
  if (!actor?.admin) return refusal(403, "Only admins can preview the retention period. Ask an admin.");
  const given = event.queryStringParameters?.retentionDays ?? "";
  const retentionDays = /^\d+$/.test(given) ? Number(given) : undefined;
  if (!values.retentionDays.takes(retentionDays)) return refusal(400, values.retentionDays.refusal);
  const threads = await threadsPastRetention(deployment.table, retentionDays, new Date());
  return { statusCode: 200, body: { retentionDays, threads } satisfies components["schemas"]["RetentionPreview"] };
};
