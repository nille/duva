import type { components } from "@duva/openapi";
import { jsonBody, type OperationHandler, refusal } from "./api.ts";
import { mailboxFor } from "./access.ts";
import { isEmailAddress } from "./email-address.ts";
import { isPublicMailProvider } from "./mail-providers.ts";
import { decide, removeDecision, type Sender, screenedSenders, screenerOf, switchScreener as switchMailboxScreener } from "./screening.ts";
import { unsubscribeFrom } from "./unsubscribing.ts";

export const getScreener: OperationHandler = async (event, deployment, actor) => {
  const mailbox = await mailboxFor(event, deployment, actor!, "read");
  if ("statusCode" in mailbox) return mailbox;
  return { statusCode: 200, body: (await screenerOf(deployment.table, mailbox.id)) satisfies components["schemas"]["Screener"] };
};

export const switchScreener: OperationHandler = async (event, deployment, actor) => {
  const mailbox = await mailboxFor(event, deployment, actor!, "switchScreener");
  if ("statusCode" in mailbox) return mailbox;
  const on = jsonBody(event)?.on;
  if (typeof on !== "boolean") return refusal(400, "Give on as true to switch the Screener on, or false to switch it off.");
  await switchMailboxScreener(deployment.table, { mailbox: mailbox.id, on, by: actor!.id });
  return { statusCode: 200, body: (await screenerOf(deployment.table, mailbox.id)) satisfies components["schemas"]["Screener"] };
};

/** The address or the domain in the call's body, in lower case, or the refusal if it gives neither or a domain no decision can be on. */
function senderIn(body: Record<string, unknown> | undefined): Sender | ReturnType<typeof refusal> {
  const { address, domain } = body ?? {};
  if ((address === undefined) === (domain === undefined)) return refusal(400, "Give the sender's address, like grace@example.org, or a domain, like example.org, but not both.");
  if (address !== undefined) {
    const given = typeof address === "string" ? address.trim() : "";
    if (!isEmailAddress(given)) return refusal(400, `${JSON.stringify(given)} isn't an email address. Give the sender's address, like grace@example.org.`);
    return { address: given.toLowerCase() };
  }
  const given = domainIn(domain);
  if (given === undefined) return refusal(400, `${JSON.stringify(domain)} isn't a domain. Give one like example.org, without an @.`);
  if (isPublicMailProvider(given)) return refusal(400, `${given} is a public mail provider, where anyone can have an address. Let in or block the sender's address instead.`);
  return { domain: given };
}

/** The domain given, in lower case without a final dot, or undefined if it isn't one. */
function domainIn(given: unknown): string | undefined {
  const domain = typeof given === "string" ? given.trim().toLowerCase().replace(/\.$/, "") : "";
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain) ? domain : undefined;
}

/**
 * Lets in or blocks the address or domain in the call's body, for those who may organize the
 * mailbox. A block also unsubscribes from the sender's mail, once the decision has been made.
 */
const deciding =
  (decision: components["schemas"]["ScreeningDecisionKind"]): OperationHandler =>
  async (event, deployment, actor) => {
    const mailbox = await mailboxFor(event, deployment, actor!, "organize");
    if ("statusCode" in mailbox) return mailbox;
    const sender = senderIn(jsonBody(event));
    if ("statusCode" in sender) return sender;
    const decided = await decide(deployment.table, { mailbox: mailbox.id, sender, decision, by: actor!.id });
    if (decision === "letIn") return { statusCode: 200, body: decided satisfies components["schemas"]["ScreeningDecision"] };
    const unsubscribe = await unsubscribeFrom(deployment, { mailbox: mailbox.id, sender, by: actor!.id });
    return { statusCode: 200, body: { ...decided, unsubscribe } satisfies components["schemas"]["ScreeningDecision"] };
  };

export const letInSender = deciding("letIn");
export const blockSender = deciding("block");

export const listScreenedSenders: OperationHandler = async (event, deployment, actor) => {
  const mailbox = await mailboxFor(event, deployment, actor!, "read");
  if ("statusCode" in mailbox) return mailbox;
  return { statusCode: 200, body: { senders: await screenedSenders(deployment.table, mailbox.id) } satisfies components["schemas"]["ScreenedSenderList"] };
};

export const removeScreenedSender: OperationHandler = async (event, deployment, actor) => {
  const mailbox = await mailboxFor(event, deployment, actor!, "organize");
  if ("statusCode" in mailbox) return mailbox;
  const given = (event.pathParameters?.sender ?? "").trim().toLowerCase();
  const sender = given.includes("@") ? { address: given } : { domain: domainIn(given) ?? given };
  const removed = await removeDecision(deployment.table, { mailbox: mailbox.id, sender, by: actor!.id });
  if (removed === undefined) return refusal(404, `The mailbox hasn't let in or blocked ${JSON.stringify(given)}. List its screened senders to find one.`);
  return { statusCode: 200, body: removed satisfies components["schemas"]["ScreeningDecision"] };
};
