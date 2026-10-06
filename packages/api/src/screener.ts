import type { components } from "@duva/openapi";
import { jsonBody, type OperationHandler, refusal } from "./api.ts";
import { mailboxFor } from "./access.ts";
import { isEmailAddress } from "./email-address.ts";
import { decide, screenerOf, switchScreener as switchMailboxScreener } from "./screening.ts";

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

/** Lets in or blocks the address in the call's body, for those who may organize the mailbox. */
const deciding =
  (decision: components["schemas"]["ScreeningDecisionKind"]): OperationHandler =>
  async (event, deployment, actor) => {
    const mailbox = await mailboxFor(event, deployment, actor!, "organize");
    if ("statusCode" in mailbox) return mailbox;
    const given = jsonBody(event)?.address;
    const address = typeof given === "string" ? given.trim() : "";
    if (!isEmailAddress(address)) return refusal(400, `${JSON.stringify(address)} isn't an email address. Give the sender's address, like grace@example.org.`);
    const decided = await decide(deployment.table, { mailbox: mailbox.id, address, decision, by: actor!.id });
    return { statusCode: 200, body: decided satisfies components["schemas"]["ScreeningDecision"] };
  };

export const letInSender = deciding("letIn");
export const blockSender = deciding("block");
