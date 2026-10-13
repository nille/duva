// Approving a payment resumes it (#171). Once its human approves a payment of their Coo's that
// waited, above its card's limits or on a site the card didn't name, the task giver hands it to the
// task runner, which starts a fresh browsing run that goes back to the page where it waited, with
// the goal, values and secrets the run that asked was given, and pays it there. The run pays as the
// turn or task that asked, in a session of its own, so the payment is paid once, however many runs
// reach it. Its way back is taken once, and kept no longer. If the run can't pay, as when the page
// expired, or can't start, a paymentNotMade change says why in Coo's activity and bubble, and the
// payment stays approved, so a later run that pays it there with the card still does.
import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import type { DynamoDBStreamEvent } from "aws-lambda";
import { type AgentRuntime, capRefusal, runMailboxAgent, runtimeMissing, startRun } from "./agent-runs.ts";
import type { Table } from "./deployment.ts";
import { recordChanges } from "./feed.ts";
import { mailboxAgentOf } from "./mailbox-agents.ts";
import { findActor, findMailbox, mailboxFeed, ownedMailboxes } from "./organization.ts";
import { stillApproved, type StoredPayment, takeWayBack } from "./payments.ts";
import { amountOf, findSecret } from "./secrets.ts";

/** What the task runner is handed for a payment its human approved: whose, and which. */
export interface PaymentJob {
  human: string;
  payment: string;
}

/** The payment a change in a mailbox's feed, as the table's stream gives it, approves, for the human who did. */
export function approvedPaymentOf(record: DynamoDBStreamEvent["Records"][number]): PaymentJob | undefined {
  const image = record.dynamodb?.NewImage ?? {};
  const [payment, human] = [image.payment?.S, image.actor?.S];
  if (image.type?.S !== "paymentDecided" || image.approved?.BOOL !== true || payment === undefined || human === undefined) return undefined;
  return { human, payment };
}

/** The task runner's handler for each payment approved: goes back to pay it, once, and says why if it couldn't. */
export function createPaymentRunner({ table, region, apiUrl, runtime }: { table: Table; region: string; apiUrl: string; runtime: AgentRuntime | undefined }) {
  return async ({ human, payment: id }: PaymentJob): Promise<void> => {
    const payment = await takeWayBack(table, human, id);
    if (payment === undefined) return;
    const said = await goBack(payment);
    if (said === undefined) return;
    try {
      await recordChanges(table, mailboxFeed(payment.mailbox), {
        by: payment.agent,
        changes: [{ type: "paymentNotMade", agent: payment.agent, payment: payment.id, cardName: payment.cardName, site: payment.site, amount: amountOf(payment.amount), currency: payment.currency, for: payment.for, said }],
        items: [stillApproved(table, payment)],
      });
    } catch (error) {
      // Paid meanwhile, as by a later run of the same turn, which leaves nothing to say. recordChanges
      // gives the items' cancellation reasons after the counter's and the one change's.
      if (!(error instanceof TransactionCanceledException) || error.CancellationReasons?.[2]?.Code !== "ConditionalCheckFailed") throw error;
    }
  };

  /** Runs the fresh browsing run that goes back to pay, and gives what it said, or why it didn't run, or undefined if there is no one left to say it to. */
  async function goBack({ human: id, wayBack, run, ...payment }: StoredPayment): Promise<string | undefined> {
    const human = await findActor(table, id);
    const [agent, mailbox, card] = await Promise.all([mailboxAgentOf(table, id), findMailbox(table, payment.mailbox), findSecret(table, id, payment.card)]);
    if (human?.kind !== "human" || agent === undefined || mailbox === undefined || card === undefined) return undefined;
    if (wayBack === undefined) return `It waited from before ${agent.name} went back to pay by itself. Ask ${agent.name} to pay it, and its next run on the site does.`;
    if (agent.paused !== undefined) return `${agent.name} is paused, so it didn't go back to pay. Ask it to pay once it's unpaused.`;
    if (runtime === undefined) return runtimeMissing(region);
    const started = await startRun(table, { agent, mailbox, mailboxes: await ownedMailboxes(table, id), owner: human.email, region, apiUrl, job: "payment" });
    if ("refused" in started) return started.refused;
    const { start, month, cap } = started;
    if (start.browsing === undefined) return `Browsing is off for ${agent.name}, so it didn't go back to pay. Turn it on in Settings, then ask it to pay.`;
    // The card by its ID, as it may have been renamed since, and the other secrets the run was given that are still there.
    const secrets = [card.name, ...wayBack.secrets.filter((name) => name !== card.name && (start.secrets ?? []).some((each) => each.name === name))];
    const ran = runMailboxAgent(table, {
      agent,
      payload: { ...start, history: [], words: "", payment: { ...wayBack, secrets, cardName: card.name, amount: amountOf(payment.amount), currency: payment.currency, site: payment.site, for: payment.for } },
      runtime,
      month,
      cap,
      // It pays as the run that asked, so the payment it approved is that run's to pay, once.
      ...(run.task === undefined ? { turn: run.turn } : { about: { task: run.task, ...(run.thread !== undefined && { thread: run.thread }) } }),
    });
    let next = await ran.next();
    while (!next.done) next = await ran.next();
    const { browsed, outcome } = next.value;
    return browsed?.[0]?.said ?? (outcome === "capReached" ? capRefusal(cap) : "The model or the runtime failed partway.");
  }
}
