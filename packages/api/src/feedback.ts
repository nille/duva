// The feedback Lambda, which SNS invokes with what SES reports about the messages it sent through
// Duva's configuration set: bounces, complaints and rejects. Each finds the message the sender sent
// by the ID SES gave it, and is recorded on the message and its send, and in the mailbox's change
// feed, once however often SNS delivers it. Duva pauses an agent after one complaint about its
// mail, or 5 hard bounces of it within an hour, across its mailboxes (ADR-0021). The urgent alert
// ADR-0021 sends its sponsor comes with alerts, in #82. A hard bounce of one of the organization's
// own addresses comes from SES receiving not knowing it yet, so Duva takes it off SES's suppression
// list again, and never counts it.
import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { GetCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { SNSEvent } from "aws-lambda";
import type { Table } from "./deployment.ts";
import { feedbackOnSend, sentBySes, sesMessagePartition } from "./drafting.ts";
import { recordChanges } from "./feed.ts";
import { timeToLiveAttribute } from "./infrastructure.ts";
import { feedbackOnMessage, type SendFeedback } from "./mail.ts";
import { duva, findActor, mailboxFeed, pauseAgent } from "./organization.ts";
import { localRecipients } from "./receiving.ts";
import type { SuppressionList } from "./suppression.ts";
import { documents, isNew, pk, sk, type TransactItem } from "./table.ts";

/** An event SES publishes for a message it sent, as its event publishing writes it. Only what Duva reads. */
interface SesEvent {
  eventType: string;
  mail: { messageId: string; timestamp: string; destination: string[] };
  bounce?: { bounceType: string; bounceSubType?: string; bouncedRecipients: { emailAddress: string }[]; timestamp: string; feedbackId: string };
  complaint?: { complainedRecipients: { emailAddress: string }[]; timestamp: string; feedbackId: string; complaintFeedbackType?: string };
  reject?: { reason?: string };
}

/** How many hard bounces of an agent's mail within an hour pause it (ADR-0021). */
const hardBouncesToPause = 5;
const hour = 3600_000;

// Each hard bounce of an agent's mail is kept in its partition, by when it happened, for as long as it counts.
const hardBouncePrefix = "hard-bounce#";
const hardBounceKey = (agent: string, at: string, sesMessageId: string, recipient: string) => ({
  [pk]: `actor#${agent}`,
  [sk]: `${hardBouncePrefix}${at}#${sesMessageId}#${recipient.toLowerCase()}`,
});

export function createFeedback({ table, suppressionList }: { table: Table; suppressionList: SuppressionList }) {
  return async (event: SNSEvent): Promise<void> => {
    for (const record of event.Records) await recordFeedback(table, suppressionList, JSON.parse(record.Sns.Message) as SesEvent);
  };
}

/** What SES reported, with the ID it gave the report, or undefined for an event Duva doesn't read. */
function feedbackOf({ eventType, mail, bounce, complaint, reject }: SesEvent): { feedback: SendFeedback; id: string } | undefined {
  const reported = feedbackAsSesGaveIt({ eventType, mail, bounce, complaint, reject });
  // Times are compared as text, so each is written as Duva writes them.
  return reported && { ...reported, feedback: { ...reported.feedback, at: new Date(reported.feedback.at).toISOString() } };
}

function feedbackAsSesGaveIt({ eventType, mail, bounce, complaint, reject }: SesEvent): { feedback: SendFeedback; id: string } | undefined {
  const reasoned = (reason: string | undefined) => (reason === undefined ? {} : { reason });
  if (eventType === "Bounce" && bounce !== undefined) {
    // Only a permanent bounce says the address takes no mail. A transient or undetermined one may pass.
    const kind = bounce.bounceType === "Permanent" ? "hardBounce" : "softBounce";
    const recipients = bounce.bouncedRecipients.map(({ emailAddress }) => emailAddress);
    return { id: bounce.feedbackId, feedback: { kind, at: bounce.timestamp, recipients, ...reasoned(bounce.bounceSubType) } };
  }
  if (eventType === "Complaint" && complaint !== undefined) {
    const recipients = complaint.complainedRecipients.map(({ emailAddress }) => emailAddress);
    return { id: complaint.feedbackId, feedback: { kind: "complaint", at: complaint.timestamp, recipients, ...reasoned(complaint.complaintFeedbackType) } };
  }
  // SES rejects a message once at most, and gives the reject no time of its own.
  if (eventType === "Reject") return { id: "reject", feedback: { kind: "reject", at: mail.timestamp, recipients: mail.destination, ...reasoned(reject?.reason) } };
  return undefined;
}

/**
 * Records what SES reported about the message, unless it was recorded already, and pauses the
 * agent whose send it was if its mail now hurts the domain. Messages the sender didn't send, as a
 * group's copies to its external members, are left alone, but for taking the organization's own
 * addresses that hard-bounced off SES's suppression list.
 */
async function recordFeedback(table: Table, suppressionList: SuppressionList, event: SesEvent): Promise<void> {
  const reported = feedbackOf(event);
  if (reported === undefined) return;
  const { id } = reported;
  const local = reported.feedback.kind === "hardBounce" ? await localRecipients(table, reported.feedback.recipients) : [];
  // Whether SES keeps the case a bounce gives is unknown, so both are taken off.
  for (const address of new Set(local.flatMap((each) => [each, each.toLowerCase()]))) await suppressionList.remove(address);
  const feedback: SendFeedback = local.length === 0 ? reported.feedback : { ...reported.feedback, localRecipients: local };
  const sesMessageId = event.mail.messageId;
  const sent = await sentBySes(table, sesMessageId);
  if (sent === undefined) return;
  const actor = await findActor(table, sent.by);
  const agent = actor?.kind === "agent" ? actor : undefined;

  const onMessage = await feedbackOnMessage(table, sent.mailbox, sent.message, feedback);
  const onSend = await feedbackOnSend(table, sent, feedback);
  // Each report is claimed once, so a delivery SNS repeats records nothing more. The claim notes
  // when the pause was checked, so only a delivery that stopped before then checks again, and a
  // repeat of an old complaint never pauses an agent its sponsor has since unpaused.
  const claimKey = { [pk]: sesMessagePartition(sesMessageId), [sk]: `feedback#${id}` };
  const claim: TransactItem = { Put: { TableName: table.name, Item: claimKey, ...isNew } };
  // An agent's hard bounces of recipients other than the organization's count for an hour, and the table forgets them a while after.
  const expires = Math.floor((Date.parse(feedback.at) + 2 * hour) / 1000);
  const counted: TransactItem[] =
    agent === undefined || feedback.kind !== "hardBounce"
      ? []
      : feedback.recipients
          .filter((recipient) => !local.includes(recipient))
          .map((recipient) => ({
            Put: { TableName: table.name, Item: { ...hardBounceKey(agent.id, feedback.at, sesMessageId, recipient), [timeToLiveAttribute]: expires } },
          }));
  const items = [claim, ...(onMessage === undefined ? [] : [onMessage.item]), ...(onSend === undefined ? [] : [onSend]), ...counted];
  try {
    if (onMessage === undefined) await documents(table).send(new TransactWriteCommand({ TransactItems: items }));
    else {
      const change = { type: "feedbackReceived", draft: sent.draft, thread: onMessage.thread, message: sent.message, feedback };
      await recordChanges(table, mailboxFeed(sent.mailbox), { by: undefined, changes: [change], items });
    }
  } catch (error) {
    const reasons = error instanceof TransactionCanceledException ? (error.CancellationReasons ?? []) : [];
    // The claim comes after the feed's counter and its one change, if it has one.
    const claimed = reasons[onMessage === undefined ? 0 : 2]?.Code === "ConditionalCheckFailed";
    if (!claimed) throw error;
    const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: claimKey, ConsistentRead: true }));
    if (Item?.checked === true) return;
  }

  if (agent !== undefined && (feedback.kind === "complaint" || (feedback.kind === "hardBounce" && counted.length > 0 && (await tooManyHardBounces(table, agent.id, feedback.at))))) {
    await pauseAgent(table, { agent, by: duva });
  }
  await documents(table).send(new UpdateCommand({ TableName: table.name, Key: claimKey, UpdateExpression: "SET checked = :checked", ExpressionAttributeValues: { ":checked": true } }));
}

/**
 * Whether some hour that includes the time saw enough hard bounces of the agent's mail to pause
 * it. Every such hour is checked, since SNS may deliver a later bounce before an earlier one.
 */
async function tooManyHardBounces(table: Table, agent: string, at: string): Promise<boolean> {
  const time = Date.parse(at);
  const from = new Date(time - hour).toISOString();
  const to = new Date(time + hour).toISOString();
  const times: number[] = [];
  let start: Record<string, unknown> | undefined;
  do {
    const page = await documents(table).send(
      new QueryCommand({
        TableName: table.name,
        KeyConditionExpression: `${pk} = :agent AND ${sk} BETWEEN :from AND :to`,
        ExpressionAttributeValues: { ":agent": `actor#${agent}`, ":from": `${hardBouncePrefix}${from}`, ":to": `${hardBouncePrefix}${to}#\uffff` },
        ProjectionExpression: "#sk",
        ExpressionAttributeNames: { "#sk": sk },
        ConsistentRead: true,
        ExclusiveStartKey: start,
      }),
    );
    for (const item of page.Items ?? []) times.push(Date.parse(String(item[sk]).slice(hardBouncePrefix.length).split("#")[0]!));
    start = page.LastEvaluatedKey;
  } while (start !== undefined);
  // Each hour starting at a bounce no more than an hour before the time includes the time.
  return times.some((first) => first <= time && times.filter((each) => each >= first && each <= first + hour).length >= hardBouncesToPause);
}
