// Coo paying with its human's cards (ADR-0039, #162). A card pays on its own only within the
// per-payment and per-month limits its human set, while the organization lets mailbox agents pay;
// a card without limits never pays. Above a limit, the payment waits in its human's Approvals, and
// once they approve it, the next run that pays its amount on the site with the card pays it, once. Each
// payment is recorded with the run that made it, a turn of Ask Coo or a label's task, in the same
// transaction as the card's month and the change in the mailbox's feed that Coo's activity and
// bubble show, so a run that runs again, as a retried task or Think harder, never pays twice.
import { randomUUID } from "node:crypto";
import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import type { components } from "@duva/openapi";
import type { Table } from "./deployment.ts";
import { recordChanges } from "./feed.ts";
import { type OperationHandler, refusal } from "./operation-handler.ts";
import { actorKey, type Agent, mailboxFeed } from "./organization.ts";
import type { RunIdentity } from "./run-tokens.ts";
import { amountOf, othersRefused as secretsRefused, deleteStoredSecret, findSecret, monthKey, recordUse, type SecretPartName, type SecretRun, secretOf, spentIn, type StoredSecret, thisMonth, useItem } from "./secrets.ts";
import { allItems, documents, isNew, pk, sk, type TransactItem } from "./table.ts";

type Payment = components["schemas"]["Payment"];

/** A payment as stored, its amount in hundredths of its currency. */
interface StoredPayment extends Omit<Payment, "amount"> {
  human: string;
  amount: number;
}

const paymentPrefix = "payment#";
const paymentKey = (human: string, payment: string) => ({ [pk]: actorKey(human)[pk]!, [sk]: `${paymentPrefix}${payment}` });
/**
 * What a run paid, or asked to pay, on a site with a card: its payment, and the session that made
 * it, which a run of the same turn or task again doesn't share.
 */
const runPaymentKey = (human: string, run: RunIdentity, card: string, site: string) => ({
  [pk]: actorKey(human)[pk]!,
  [sk]: `payment-run#${run.task === undefined ? `turn#${run.turn}` : `task#${run.task}`}#${card}#${site}`,
});

export const paymentOf = ({ human: _, amount, ...payment }: StoredPayment): Payment => ({ ...payment, amount: amountOf(amount) });

/** The run as the secret's history and the payment name it. */
export const runOf = ({ turn, task, mailbox, thread }: RunIdentity): SecretRun => (task === undefined ? { turn: turn! } : { task, mailbox, ...(thread !== undefined && { thread }) });

async function storedPayments(table: Table, human: string): Promise<StoredPayment[]> {
  const items = (await allItems(table, {
    KeyConditionExpression: `${pk} = :human AND begins_with(${sk}, :payment)`,
    ExpressionAttributeValues: { ":human": actorKey(human)[pk], ":payment": paymentPrefix },
  })) as unknown as StoredPayment[];
  return items.sort((a, b) => b.at.localeCompare(a.at));
}

/** The card's payments not yet paid or declined, which go with the card. */
export async function openPayments(table: Table, card: StoredSecret): Promise<Record<string, unknown>[]> {
  return (await storedPayments(table, card.human)).filter(({ card: of, state }) => of === card.id && (state === "waiting" || state === "approved")).map((payment) => paymentKey(card.human, payment.id));
}

/** What a card's part costs: a payment, which the run may make, waits for, or is refused. */
export type Paying = { paid: true } | { waiting: Payment } | { refused: string };

/**
 * Pays with the card, for the run, on the site, as a part of it is typed into the page there: once
 * per run on a site, within its limits or as its human approved. A part typed again in the same
 * session pays nothing more. `organizationPays` is whether the organization lets mailbox agents pay.
 */
export async function payWith(
  table: Table,
  { card, part, agent, run, site, amount, currency, what, organizationPays }: { card: StoredSecret; part: SecretPartName; agent: Agent; run: RunIdentity; site: string; amount: number; currency: string; what: string; organizationPays: boolean },
): Promise<Paying> {
  const human = card.human;
  const at = new Date().toISOString();
  const paidPart = { at, kind: "filled" as const, site, part, run: runOf(run) };
  const { Item: before } = await documents(table).send(new GetCommand({ TableName: table.name, Key: runPaymentKey(human, run, card.id, site), ConsistentRead: true }));
  if (before !== undefined) {
    const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: paymentKey(human, before.payment as string), ConsistentRead: true }));
    const earlier = Item as StoredPayment | undefined;
    if (earlier?.state === "paid" && before.session === run.session) {
      await recordUse(table, card, paidPart);
      return { paid: true };
    }
    if (earlier?.state === "waiting") return { waiting: paymentOf(earlier) };
    if (earlier?.state === "declined") return { refused: `Its human declined this payment of ${amountOf(earlier.amount)} ${earlier.currency} on ${site}, so it isn't paid.` };
    if (earlier?.state === "paid") return { refused: `This run paid ${amountOf(earlier.amount)} ${earlier.currency} on ${site} with ${card.name} already, so it doesn't pay again.` };
  }
  if (!organizationPays) return { refused: "An admin turned paying off for the organization, so no card pays." };
  const approved = (await storedPayments(table, human)).find((payment) => payment.state === "approved" && payment.card === card.id && payment.site === site && payment.currency === currency && payment.amount === amount);
  const limits = card.limits;
  if (approved === undefined && limits === undefined) return { refused: `${card.name} has no limits set, so it doesn't pay. Its human sets them in Settings, under Secrets.` };
  const record = (payment: StoredPayment, items: TransactItem[]) =>
    recordChanges(table, mailboxFeed(payment.mailbox), {
      by: agent.id,
      changes: [
        payment.state === "waiting"
          ? { type: "paymentAsked", agent: agent.id, payment: payment.id, cardName: card.name, site, amount: amountOf(amount), currency, for: what }
          : { type: "paymentMade", agent: agent.id, payment: payment.id, cardName: card.name, site, amount: amountOf(amount), currency, for: what, ...(approved !== undefined && { approved: true }) },
      ],
      // The items are the claim, the payment, the month if it counts, then the use, as failed reads them.
      items: [
        // The run's claim on the site comes first, so a lost race is told from a full month.
        { Put: { TableName: table.name, Item: { ...runPaymentKey(human, run, card.id, site), payment: payment.id, session: run.session }, ...(before === undefined ? isNew : { ConditionExpression: "payment = :payment", ExpressionAttributeValues: { ":payment": before.payment } }) } },
        ...items,
        useItem(table, card, { ...paidPart, kind: payment.state === "waiting" ? "waited" : "paid", amount: amountOf(amount), currency }),
      ],
    });
  // recordChanges puts the feed's counter and the one change before the items, so an item's
  // cancellation reason is two on from its place among them: the claim's first, the month's second.
  const failed = (error: unknown, item: "claim" | "month") =>
    error instanceof TransactionCanceledException && error.CancellationReasons?.[2 + (item === "claim" ? 0 : 2)]?.Code === "ConditionalCheckFailed";
  const month = (room?: number): TransactItem => ({
    Update: {
      TableName: table.name,
      Key: monthKey(human, card.id, thisMonth()),
      UpdateExpression: "ADD spent :amount",
      ...(room !== undefined && { ConditionExpression: "attribute_not_exists(spent) OR spent <= :room", ExpressionAttributeValues: { ":amount": amount, ":room": room } }),
      ...(room === undefined && { ExpressionAttributeValues: { ":amount": amount } }),
    },
  });
  try {
    if (approved !== undefined) {
      // An approved payment is paid once, outside the limits, and counts toward the month.
      await record({ ...approved, state: "paid" }, [
        {
          Update: {
            TableName: table.name,
            Key: paymentKey(human, approved.id),
            UpdateExpression: "SET #state = :paid, paidAt = :at",
            ConditionExpression: "#state = :approved",
            ExpressionAttributeNames: { "#state": "state" },
            ExpressionAttributeValues: { ":paid": "paid", ":at": at, ":approved": "approved" },
          },
        },
        month(),
      ]);
      return { paid: true };
    }
    const payment: StoredPayment = { id: randomUUID(), human, agent: agent.id, state: "paid", card: card.id, cardName: card.name, site, amount, currency, for: what, at, mailbox: run.mailbox, run: runOf(run) };
    const within = currency === limits!.currency && amount <= limits!.perPayment && (await spentIn(table, card)) + amount <= limits!.perMonth;
    if (within) {
      try {
        await record(payment, [{ Put: { TableName: table.name, Item: { ...paymentKey(human, payment.id), ...payment }, ...isNew } }, month(limits!.perMonth - amount)]);
        return { paid: true };
      } catch (error) {
        // Another payment filled the month meanwhile, so this one waits.
        if (!failed(error, "month")) throw error;
      }
    }
    const waiting: StoredPayment = { ...payment, state: "waiting" };
    await record(waiting, [{ Put: { TableName: table.name, Item: { ...paymentKey(human, waiting.id), ...waiting }, ...isNew } }]);
    return { waiting: paymentOf(waiting) };
  } catch (error) {
    // Another call of the run claimed the site meanwhile, so it goes as that one went.
    if (failed(error, "claim")) return payWith(table, { card, part, agent, run, site, amount, currency, what, organizationPays });
    throw error;
  }
}

/** Only humans have payments, and each sees only their own Coo's. */
const othersRefused = () => refusal(403, "Only humans approve their Coo's payments, each only their own.");

export const listPayments: OperationHandler = async (_event, { table }, actor) => {
  if (actor?.kind !== "human") return othersRefused();
  return { statusCode: 200, body: { payments: (await storedPayments(table, actor.id)).map(paymentOf) } satisfies components["schemas"]["PaymentList"] };
};

/** Approves or declines the payment waiting for the human, recorded in its mailbox's feed under them. */
const decide =
  (approved: boolean): OperationHandler =>
  async (event, { table }, actor) => {
    if (actor?.kind !== "human") return othersRefused();
    const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: paymentKey(actor.id, event.pathParameters?.payment ?? ""), ConsistentRead: true }));
    const payment = Item as StoredPayment | undefined;
    if (payment === undefined) return refusal(404, "Your Coo has no such payment. List the payments to find its ID.");
    const waitingNoMore = () => refusal(409, `That payment was ${payment.state} already. Only a payment waiting for you can be approved or declined.`);
    if (payment.state !== "waiting") return waitingNoMore();
    const at = new Date().toISOString();
    const state = approved ? "approved" : "declined";
    try {
      await recordChanges(table, mailboxFeed(payment.mailbox), {
        by: actor.id,
        changes: [{ type: "paymentDecided", agent: payment.agent, payment: payment.id, approved, site: payment.site, amount: amountOf(payment.amount), currency: payment.currency }],
        items: [
          {
            Update: {
              TableName: table.name,
              Key: paymentKey(actor.id, payment.id),
              UpdateExpression: "SET #state = :state, decidedAt = :at",
              ConditionExpression: "#state = :waiting",
              ExpressionAttributeNames: { "#state": "state" },
              ExpressionAttributeValues: { ":state": state, ":at": at, ":waiting": "waiting" },
            },
          },
        ],
      });
    } catch (error) {
      if (error instanceof TransactionCanceledException && error.CancellationReasons?.[2]?.Code === "ConditionalCheckFailed") return refusal(409, "That payment was decided meanwhile. List the payments to see how.");
      throw error;
    }
    return { statusCode: 200, body: paymentOf({ ...payment, state, decidedAt: at }) satisfies Payment };
  };

export const approvePayment = decide(true);
export const declinePayment = decide(false);

export const deleteSecret: OperationHandler = async (event, { table }, actor) => {
  if (actor?.kind !== "human") return secretsRefused();
  const secret = await findSecret(table, actor.id, event.pathParameters?.secret ?? "");
  if (secret === undefined) return refusal(404, "You have no such secret. List your secrets to find its ID.");
  // A card's payments waiting in Approvals, or approved and not yet paid, go with it.
  await deleteStoredSecret(table, secret, secret.kind === "card" ? await openPayments(table, secret) : []);
  return { statusCode: 200, body: secretOf(secret) satisfies components["schemas"]["Secret"] };
};
