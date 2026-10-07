import { type components, isPublicMailProvider } from "@duva/openapi";
import { jsonBody, type OperationHandler, refusal } from "./api.ts";
import { mailboxFor } from "./access.ts";
import { isEmailAddress } from "./email-address.ts";
import { senderErasure } from "./erasure.ts";
import { hasOwnLabel } from "./labels.ts";
import { decide, type Delivery, removeDecision, type Sender, screenedSenders, screenerOf, senderSheet, switchScreener as switchMailboxScreener } from "./screening.ts";
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

/** The address or the domain in the call's path, in lower case, or the refusal if it is neither, or a domain no decision can be on. */
function senderIn(event: Parameters<OperationHandler>[0]): Sender | ReturnType<typeof refusal> {
  const given = (event.pathParameters?.sender ?? "").trim();
  if (given.includes("@")) {
    if (!isEmailAddress(given)) return refusal(400, `${JSON.stringify(given)} isn't an email address. Give the sender's address, like grace@example.org.`);
    return { address: given.toLowerCase() };
  }
  const domain = domainIn(given);
  if (domain === undefined) return refusal(400, `${JSON.stringify(given)} isn't an address or a domain. Give one like grace@example.org, or example.org for everyone there.`);
  if (isPublicMailProvider(domain)) return refusal(400, `${domain} is a public mail provider, where anyone can have an address. Decide on the sender's address instead.`);
  return { domain };
}

/** The domain given, in lower case without a final dot, or undefined if it isn't one. */
function domainIn(given: string): string | undefined {
  const domain = given.toLowerCase().replace(/\.$/, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain) ? domain : undefined;
}

const deliveries: Delivery[] = ["inbox", "feed", "paperTrail", "label", "nowhere"];

export const getSender: OperationHandler = async (event, deployment, actor) => {
  const mailbox = await mailboxFor(event, deployment, actor!, "read");
  if ("statusCode" in mailbox) return mailbox;
  const sender = senderIn(event);
  if ("statusCode" in sender) return sender;
  return { statusCode: 200, body: (await senderSheet(deployment.table, mailbox.id, sender)) satisfies components["schemas"]["SenderSheet"] };
};

/**
 * Decides where the address's or domain's mail goes, for those who may organize the mailbox, or
 * for nowhere, which erases their threads, those who may erase its mail. Nowhere also unsubscribes
 * from the sender's mail, once the decision has been made, and then hands the eraser their threads.
 */
export const setSenderDelivery: OperationHandler = async (event, deployment, actor) => {
  const { delivery, label } = jsonBody(event) ?? {};
  if (!deliveries.includes(delivery as Delivery)) return refusal(400, "Give delivery as inbox, feed, paperTrail, label or nowhere.");
  const mailbox = await mailboxFor(event, deployment, actor!, delivery === "nowhere" ? "erase" : "organize");
  if ("statusCode" in mailbox) return mailbox;
  const sender = senderIn(event);
  if ("statusCode" in sender) return sender;
  if (delivery !== "label" && label !== undefined) return refusal(400, "Give a label only with delivery label.");
  if (delivery === "label" && (typeof label !== "string" || !(await hasOwnLabel(deployment.table, mailbox.id, label)))) {
    return refusal(400, "Give label as the ID of one of the mailbox's own labels. List its labels to find one.");
  }
  const by = actor!.id;
  const nowhere = delivery === "nowhere";
  const decided = await decide(deployment.table, {
    mailbox: mailbox.id,
    sender,
    delivery: delivery as Delivery,
    ...(typeof label === "string" && { label }),
    by,
    also: nowhere ? [senderErasure(deployment.table, { mailbox: mailbox.id, sender, by })] : [],
  });
  if (!nowhere) return { statusCode: 200, body: decided satisfies components["schemas"]["ScreeningDecision"] };
  const unsubscribe = await unsubscribeFrom(deployment, { mailbox: mailbox.id, sender, by });
  await deployment.eraser.eraseSender({ mailbox: mailbox.id, sender, by });
  return { statusCode: 200, body: { ...decided, unsubscribe } satisfies components["schemas"]["ScreeningDecision"] };
};

export const listSenders: OperationHandler = async (event, deployment, actor) => {
  const mailbox = await mailboxFor(event, deployment, actor!, "read");
  if ("statusCode" in mailbox) return mailbox;
  return { statusCode: 200, body: { senders: await screenedSenders(deployment.table, mailbox.id) } satisfies components["schemas"]["ScreenedSenderList"] };
};

export const removeSenderDelivery: OperationHandler = async (event, deployment, actor) => {
  const mailbox = await mailboxFor(event, deployment, actor!, "organize");
  if ("statusCode" in mailbox) return mailbox;
  const sender = senderIn(event);
  if ("statusCode" in sender) return sender;
  const removed = await removeDecision(deployment.table, { mailbox: mailbox.id, sender, by: actor!.id });
  if (removed === undefined) return refusal(404, `The mailbox hasn't decided where mail from ${"address" in sender ? sender.address : sender.domain} goes. List its senders to find one.`);
  return { statusCode: 200, body: removed satisfies components["schemas"]["ScreeningDecision"] };
};
