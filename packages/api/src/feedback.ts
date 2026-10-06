// The feedback Lambda, which SNS invokes with what SES reports about the messages it sent through
// Duva's configuration set: bounces, complaints and rejects. Each finds the message the sender sent
// by the ID SES gave it, and is recorded on the message and its send, and in the mailbox's change
// feed, once however often SNS delivers it. Duva pauses an agent after one complaint about its
// mail, or 5 hard bounces of it within an hour, across its mailboxes (ADR-0021), with an urgent
// alert to its sponsor. Each hard bounce, complaint and reject of an agent's mail is an alert too.
// A hard bounce of one of the organization's own addresses comes from SES receiving not knowing it
// yet, so Duva takes it off SES's suppression list again, and never counts it or alerts about it.
import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { GetCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { SNSEvent } from "aws-lambda";
import { alertItems, alertWrites, type NewAlert } from "./alerting.ts";
import type { Table } from "./deployment.ts";
import { feedbackOnSend, sentBySes, sesMessagePartition } from "./drafting.ts";
import { recordChanges } from "./feed.ts";
import { timeToLiveAttribute } from "./infrastructure.ts";
import { feedbackOnMessage, type SendFeedback } from "./mail.ts";
import { type Agent, duva, findActor, mailboxFeed, pauseAgent } from "./organization.ts";
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
/** How many hard bounces of an agent's mail within an hour make the alert of each urgent. */
const urgentHardBounces = 3;
const hour = 3600_000;

// Each hard bounce of an agent's mail is kept in its partition, by when it happened, for as long as it counts.
const hardBouncePrefix = "hard-bounce#";
const hardBounceKey = (agent: string, at: string, sesMessageId: string, recipient: string) => ({
  [pk]: `actor#${agent}`,
  [sk]: `${hardBouncePrefix}${at}#${sesMessageId}#${recipient.toLowerCase()}`,
});

// Until when the agent's urgent bounces were mailed to its sponsor.
const bouncesMailedKey = (agent: string) => ({ [pk]: `actor#${agent}`, [sk]: "alerts#bounces-mailed" });

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
  const link = { mailbox: sent.mailbox, ...(onMessage !== undefined && { thread: onMessage.thread }), message: sent.message, draft: sent.draft };
  const alert = agent === undefined ? [] : await feedbackAlert(table, { agent, feedback, local, link });
  const items = [claim, ...(onMessage === undefined ? [] : [onMessage.item]), ...(onSend === undefined ? [] : [onSend]), ...counted, ...alert];
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

  const tooMany = feedback.kind === "hardBounce" && agent !== undefined && counted.length > 0 && hourWith(await hardBounces(table, agent.id, feedback.at), feedback.at, hardBouncesToPause);
  if (agent !== undefined && (feedback.kind === "complaint" || tooMany)) {
    const why = feedback.kind === "complaint" ? "a complaint about its mail" : `${hardBouncesToPause} hard bounces of its mail within an hour`;
    const what = `Duva paused ${agent.name} after ${why}, so it can't hurt the domain. Its approved sends are held, and unpausing sends them, so look at them first.`;
    await pauseAgent(table, { agent, by: duva, items: await alertWrites(table, { kind: "autoPaused", agent, what, urgent: `Duva paused ${agent.name}` }) });
  }
  await documents(table).send(new UpdateCommand({ TableName: table.name, Key: claimKey, UpdateExpression: "SET checked = :checked", ExpressionAttributeValues: { ":checked": true } }));
}

/**
 * The writes of the alert to the agent's sponsor about what SES reported of its mail: a hard
 * bounce, urgent if it makes 3 or more within an hour, mailed once an hour, a complaint, which is urgent, or a reject,
 * which failed the send. A soft bounce raises none, nor a hard bounce of only the organization's
 * own addresses.
 */
async function feedbackAlert(
  table: Table,
  { agent, feedback, local, link }: { agent: Agent; feedback: SendFeedback; local: string[]; link: NewAlert["link"] },
) {
  const recipients = feedback.recipients.join(", ");
  if (feedback.kind === "hardBounce") {
    const bounced = feedback.recipients.filter((recipient) => !local.includes(recipient));
    if (bounced.length === 0) return [];
    // This bounce isn't counted yet, so each of its recipients is added.
    const times = [...(await hardBounces(table, agent.id, feedback.at)), ...bounced.map(() => Date.parse(feedback.at))];
    const what = `Mail from ${agent.name} to ${bounced.join(", ")} hard-bounced, so the address takes no mail.`;
    if (!hourWith(times, feedback.at, urgentHardBounces)) return alertWrites(table, { kind: "bounced", agent, what, link });
    const alert = { kind: "bounced" as const, agent, what, link, urgent: `Mail from ${agent.name} bounced` };
    // Urgent bounces are mailed once an hour at most, and not while the agent is paused, whose own alert says why.
    const { Item: mailed } = await documents(table).send(new GetCommand({ TableName: table.name, Key: bouncesMailedKey(agent.id), ConsistentRead: true }));
    const mailedUntil = mailed?.until as string | undefined;
    if (agent.paused !== undefined || (mailedUntil !== undefined && mailedUntil > feedback.at)) return alertItems(table, alert);
    const until = new Date(Date.parse(feedback.at) + hour).toISOString();
    const mailing: TransactItem = { Put: { TableName: table.name, Item: { ...bouncesMailedKey(agent.id), until, [timeToLiveAttribute]: Math.floor(Date.parse(until) / 1000) + 3600 } } };
    return [mailing, ...(await alertWrites(table, alert))];
  }
  if (feedback.kind === "complaint") {
    return alertWrites(table, { kind: "complained", agent, what: `${recipients} complained about mail from ${agent.name}.`, link, urgent: `A complaint about mail from ${agent.name}` });
  }
  if (feedback.kind === "reject") {
    const what = `SES rejected ${agent.name}'s message to ${recipients}${feedback.reason === undefined ? "." : `: ${feedback.reason}`}`;
    return alertWrites(table, { kind: "sendFailed", agent, what, link });
  }
  return [];
}

/**
 * Whether some hour that includes the time saw at least `count` of the times. Every such hour is
 * checked, since SNS may deliver a later bounce before an earlier one.
 */
function hourWith(times: number[], at: string, count: number): boolean {
  const time = Date.parse(at);
  // Each hour starting at a bounce no more than an hour before the time includes the time.
  return times.some((first) => first <= time && first >= time - hour && times.filter((each) => each >= first && each <= first + hour).length >= count);
}

/** When each hard bounce of the agent's mail within an hour of the time happened, one for each recipient. */
async function hardBounces(table: Table, agent: string, at: string): Promise<number[]> {
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
  return times;
}
