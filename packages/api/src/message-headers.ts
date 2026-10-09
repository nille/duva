// A message's full header block, as a human reads it under Show headers (#145): every field of the
// raw message in the mail bucket, in order and unfolded, with SES's own fields above the sender's.
import type { components } from "@duva/openapi";
import { mailboxFor } from "./access.ts";
import { type OperationHandler, refusal } from "./api.ts";
import { sentPrefix } from "./infrastructure.ts";
import { storedMessage } from "./mail.ts";
import { headerFields } from "./mime.ts";

export const getMessageHeaders: OperationHandler = async (event, deployment, actor) => {
  const mailbox = await mailboxFor(event, deployment, actor!, "read");
  if ("statusCode" in mailbox) return mailbox;
  const id = event.pathParameters?.message ?? "";
  const stored = await storedMessage(deployment.table, mailbox.id, id);
  if (stored === undefined) return refusal(404, `The mailbox has no message ${JSON.stringify(id)}. Read its threads to find the message.`);
  const raw = await deployment.mailBucket.get(stored.rawKey);
  if (raw === undefined) throw new Error(`The raw message ${stored.rawKey} is missing from the mail bucket.`);
  // SES gave mail Duva sent a Message-ID of its own in place of the one Duva wrote (docs/aws.md), so it shows the one it went out with.
  const sent = stored.rawKey.startsWith(sentPrefix) && stored.messageId !== undefined;
  const headers = headerFields(raw).map((field) => (sent && field.name.toLowerCase() === "message-id" ? { name: field.name, value: stored.messageId! } : field));
  return { statusCode: 200, body: { headers } satisfies components["schemas"]["MessageHeaders"] };
};
