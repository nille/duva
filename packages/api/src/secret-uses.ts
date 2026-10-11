// A browsing run of Coo's using one of its human's secrets (ADR-0039, #162): the run's runtime asks
// for a part, with its run's token, which never reaches a model, and types what Duva answers into
// the page through the browser. Only a run of a human's own Coo, for a turn of Ask Coo or a label's
// task, gets one, and only of its own human's secrets. Each use is recorded in the secret's history
// with the site and the run, and a card's part first pays (payments.ts).
import type { components } from "@duva/openapi";
import { bearerToken } from "./authorizer.ts";
import { jsonBody, type OperationHandler, refusal } from "./operation-handler.ts";
import { organizationSettings } from "./organization.ts";
import { payWith, runOf } from "./payments.ts";
import { cooBrowses } from "./preferences.ts";
import { runOfToken } from "./run-tokens.ts";
import { findSecret, hundredthsOf, isCurrency, openParts, partIn, partsOf, recordUse, type SecretPartName } from "./secrets.ts";

export const useSecret: OperationHandler = async (event, { table, secretKeys }, actor) => {
  const token = bearerToken(event.headers?.authorization) ?? "";
  const run = actor?.kind === "agent" && actor.mailboxAgent === true ? await runOfToken(table, token) : undefined;
  if (actor?.kind !== "agent" || run === undefined) return refusal(403, "Only a browsing run of a human's own Coo uses their secrets, and types them without reading them.");
  const { settings } = await organizationSettings(table);
  if (!settings.mailboxAgentBrowsing || !(await cooBrowses(table, actor.sponsor))) return refusal(403, "Browsing is off for this Coo, so it uses no secrets.");
  const secret = await findSecret(table, actor.sponsor, event.pathParameters?.secret ?? "");
  if (secret === undefined) return refusal(404, "Your human has no such secret.");
  const body = jsonBody(event) ?? {};
  const part = body.part as SecretPartName;
  if (!partsOf[secret.kind].includes(part)) return refusal(400, `${secret.name} is a ${secret.kind}, whose parts are ${partsOf[secret.kind].join(", ")}.`);
  const site = typeof body.site === "string" ? body.site.trim().toLowerCase() : "";
  if (!/^[a-z0-9.-]+\.[a-z0-9-]+$/.test(site)) return refusal(400, "Give site as the domain of the page the part goes into, as example.com.");
  const parts = await openParts(secretKeys, secret);
  const value = partIn(parts, part);
  if (value === undefined) return refusal(409, `${secret.name} has no ${part === "code" ? "one-time-code seed" : part}.`);
  if (secret.kind === "card") {
    const amount = hundredthsOf(body.amount);
    if (amount === undefined || amount === 0 || !isCurrency(body.currency)) return refusal(400, "Give the payment's amount and currency, as the page shows them, like 49.90 and SEK.");
    const what = typeof body.for === "string" ? body.for.trim().slice(0, 200) : "";
    if (what === "") return refusal(400, "Give for: what the payment is for, in a few words.");
    const paying = await payWith(table, { card: secret, part, agent: actor, run, site, amount, currency: body.currency, what, organizationPays: settings.mailboxAgentPayments });
    if ("refused" in paying) return refusal(409, paying.refused);
    if ("waiting" in paying) return { statusCode: 202, body: paying.waiting };
  } else await recordUse(table, secret, { at: new Date().toISOString(), kind: "filled", site, part, run: runOf(run) });
  return { statusCode: 200, body: { value } satisfies components["schemas"]["SecretPart"] };
};
