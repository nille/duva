// Coo paying with its human's cards (ADR-0039, #162). A card pays on its own only on the sites its
// human named for it, by the address the browser reports for the page (#171), and within the
// per-payment and per-month limits they set, while the organization lets mailbox agents pay; a card
// without limits never pays. Above a limit, or on another site, the payment waits in its human's
// Approvals, keeping the page and what the run was given, and once they approve it, which adds a new
// site to the card, a fresh run goes back to the page and pays it (payment-runs.ts), as would a
// later run of the turn or task that asked, once. No other run pays it, and left unpaid for 24
// hours, the approval lapses, so a leftover approval never pays for a run that didn't ask (#183).
// Each payment is recorded with the run that made it, a turn of Ask Coo or a label's task, in the
// same transaction as the card's month and the change in the mailbox's feed that Coo's activity and
// bubble show, so a run that runs again, as a retried task or Think harder, never pays twice. Coo
// reads its human's payments, so it says how each stands (#184), and each decision on one is listed
// in its human's approval log, with what became of it (#186).
import { randomUUID } from "node:crypto";
import { ConditionalCheckFailedException, TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import type { SchedulerClient } from "@aws-sdk/client-scheduler";
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { components } from "@duva/openapi";
import type { Table } from "./deployment.ts";
import { decisionKey, listDecision } from "./decisions.ts";
import { recordChanges } from "./feed.ts";
import { scheduleOnce, type ScheduleGroup } from "./limits.ts";
import { type OperationHandler, refusal } from "./operation-handler.ts";
import { actorKey, type Agent, duva, findActor, mailboxFeed } from "./organization.ts";
import type { RunIdentity } from "./run-tokens.ts";
import {
  amountOf,
  othersRefused as secretsRefused,
  deleteStoredSecret,
  findSecret,
  monthKey,
  paysOn,
  recordUse,
  secretKey,
  type SecretPartName,
  type SecretRun,
  secretOf,
  spentIn,
  type StoredSecret,
  thisMonth,
  useItem,
} from "./secrets.ts";
import { allItems, documents, isNew, pk, sk, type TransactItem } from "./table.ts";

type Payment = components["schemas"]["Payment"];

/** What a browsing run of Coo's was asked with: its goal, the values it may type and the names of the secrets it may have typed in. */
export interface Asked {
  goal: string;
  values: string[];
  secrets: string[];
}

/**
 * What a payment that waits keeps of the way back to it, for the fresh run that goes back to pay it
 * once approved: the page's address, and what the run that asked was asked with.
 */
export type WayBack = Asked & { page: string };

/**
 * A payment as stored, its amount in hundredths of its currency, while it waits its way back, and
 * once approved, when a run went back for it, and what that run cost, in US cents (#184).
 */
export interface StoredPayment extends Omit<Payment, "amount"> {
  human: string;
  amount: number;
  wayBack?: WayBack;
  wentBackAt?: string;
  wentBackCost?: number;
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

/** How long an approval lasts unpaid: 24 hours after it was given, it lapses (#183). */
const approvalLasts = 24 * 60 * 60 * 1000;

/** Now less 24 hours: an approval given at or before it has lapsed. */
const lapseLine = () => new Date(Date.now() - approvalLasts).toISOString();

/** The payment's state, lapsed once it was approved 24 hours ago and not paid, even before the sender has it lapse. */
const stateOf = ({ state, decidedAt }: StoredPayment): Payment["state"] => (state === "approved" && Date.parse(decidedAt!) + approvalLasts <= Date.now() ? "lapsed" : state);

/** The payment as the contract gives it, with none of what only Duva keeps. */
export const paymentOf = (stored: StoredPayment): Payment => {
  const { id, agent, card, cardName, site, amount, currency, for: what, at, decidedAt, paidAt, notMade, mailbox, run, newSite, aboveLimits } = stored;
  return {
    id,
    agent,
    state: stateOf(stored),
    card,
    cardName,
    site,
    amount: amountOf(amount),
    currency,
    for: what,
    at,
    ...(decidedAt !== undefined && { decidedAt }),
    ...(paidAt !== undefined && { paidAt }),
    ...(notMade !== undefined && { notMade: { at: notMade.at, said: notMade.said } }),
    mailbox,
    run,
    ...(newSite && { newSite }),
    ...(aboveLimits && { aboveLimits }),
  };
};

/** The run as the secret's history and the payment name it. */
export const runOf = ({ turn, task, mailbox, thread }: RunIdentity): SecretRun => (task === undefined ? { turn: turn! } : { task, mailbox, ...(thread !== undefined && { thread }) });

async function storedPayment(table: Table, human: string, id: string): Promise<StoredPayment | undefined> {
  const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: paymentKey(human, id), ConsistentRead: true }));
  return Item as StoredPayment | undefined;
}

async function storedPayments(table: Table, human: string): Promise<StoredPayment[]> {
  const items = (await allItems(table, {
    KeyConditionExpression: `${pk} = :human AND begins_with(${sk}, :payment)`,
    ExpressionAttributeValues: { ":human": actorKey(human)[pk], ":payment": paymentPrefix },
  })) as unknown as StoredPayment[];
  return items.sort((a, b) => b.at.localeCompare(a.at));
}

/** The payments the human's Coo made or asked for in the run of their turn, newest first, as a request by mail reports them (ADR-0040). */
export async function paymentsOfTurn(table: Table, human: string, turn: string): Promise<Payment[]> {
  return (await storedPayments(table, human)).filter(({ run }) => run.turn === turn).map(paymentOf);
}

/** The human's Coo's payments they approved or declined, newest first, as their approval log lists them (#186). */
export async function decidedPayments(table: Table, human: string): Promise<Payment[]> {
  return (await storedPayments(table, human)).filter(({ decidedAt }) => decidedAt !== undefined).map(paymentOf);
}

/** The human's Coo's payment with the ID, if there is one. */
export async function findPayment(table: Table, human: string, id: string): Promise<Payment | undefined> {
  const payment = await storedPayment(table, human, id);
  return payment === undefined ? undefined : paymentOf(payment);
}

/**
 * Takes the approved payment's way back, once: the payment as it was, with its way back, which it
 * keeps no longer, unless it waited from before payments kept one. Undefined if it isn't approved,
 * or a run went back for it, or paid it, already, or the approval lapsed.
 */
export async function takeWayBack(table: Table, human: string, id: string): Promise<StoredPayment | undefined> {
  try {
    const { Attributes } = await documents(table).send(
      new UpdateCommand({
        TableName: table.name,
        Key: paymentKey(human, id),
        UpdateExpression: "SET wentBackAt = :at REMOVE wayBack",
        ConditionExpression: "#state = :approved AND attribute_not_exists(wentBackAt) AND decidedAt > :lapsed",
        ExpressionAttributeNames: { "#state": "state" },
        ExpressionAttributeValues: { ":approved": "approved", ":at": new Date().toISOString(), ":lapsed": lapseLine() },
        ReturnValues: "ALL_OLD",
      }),
    );
    return Attributes as StoredPayment;
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) return undefined;
    throw error;
  }
}

/**
 * The item that keeps on the approved payment why the run that went back couldn't pay it, and what
 * that run cost, only while it is still approved, or lapsed as the run went on, so nothing is said
 * of one paid meanwhile.
 */
export const keepNotMade = (table: Table, { human, id }: Pick<StoredPayment, "human" | "id">, ended: NonNullable<Payment["notMade"]>, cost?: number): TransactItem => ({
  Update: {
    TableName: table.name,
    Key: paymentKey(human, id),
    UpdateExpression: `SET notMade = :notMade${cost === undefined ? "" : ", wentBackCost = :cost"}`,
    ConditionExpression: "#state IN (:approved, :lapsed)",
    ExpressionAttributeNames: { "#state": "state" },
    ExpressionAttributeValues: { ":approved": "approved", ":lapsed": "lapsed", ":notMade": ended, ...(cost !== undefined && { ":cost": cost }) },
  },
});

/** Keeps what the run that went back to pay the payment cost, in US cents, once it paid it, which Coo's activity shows with the payment. */
export async function keepWentBackCost(table: Table, { human, id }: Pick<StoredPayment, "human" | "id">, cost: number): Promise<void> {
  try {
    await documents(table).send(
      new UpdateCommand({ TableName: table.name, Key: paymentKey(human, id), UpdateExpression: "SET wentBackCost = :cost", ConditionExpression: `attribute_exists(${pk})`, ExpressionAttributeValues: { ":cost": cost } }),
    );
  } catch (error) {
    // A payment that went with its card or its human meanwhile keeps nothing.
    if (!(error instanceof ConditionalCheckFailedException)) throw error;
  }
}

/** What the run that went back to pay the payment cost, in US cents, if that run paid it. */
export async function costOfGoingBack(table: Table, { human, id }: Pick<StoredPayment, "human" | "id">): Promise<number | undefined> {
  const payment = await storedPayment(table, human, id);
  return payment?.state === "paid" && payment.notMade === undefined ? payment.wentBackCost : undefined;
}

/** What EventBridge Scheduler hands the sender when a payment's approval has lasted its 24 hours. */
export interface PaymentLapseEvent {
  lapse: { human: string; payment: string };
}

/** Has the sender let an approved payment lapse once its approval has lasted. EventBridge Scheduler's, or a stand-in in tests. */
export interface PaymentLapses {
  lapseAt(lapse: PaymentLapseEvent["lapse"], at: Date): Promise<void>;
}

/** One-time schedules in the sender's schedule group, one per payment approved, named by the payment. */
export function eventBridgePaymentLapses(scheduler: SchedulerClient, schedule: ScheduleGroup): PaymentLapses {
  return {
    lapseAt: (lapse, at) => scheduleOnce(scheduler, schedule, { name: (second) => `lapse-${lapse.payment}-${second}`, at, input: { lapse } satisfies PaymentLapseEvent }),
  };
}

/**
 * Has the approved payment, still unpaid, lapse: it pays nowhere after, and its way back goes,
 * recorded in its mailbox's feed by Duva, which Coo's activity shows. One paid meanwhile, or gone
 * with its card, stays as it is, and so does one whose 24 hours aren't over, as when the schedule
 * of an approval that lost a race to another ran first.
 */
export async function lapsePayment(table: Table, { human, payment: id }: PaymentLapseEvent["lapse"]): Promise<void> {
  const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: paymentKey(human, id), ConsistentRead: true }));
  const payment = Item as StoredPayment | undefined;
  if (payment?.state !== "approved") return;
  try {
    await recordChanges(table, mailboxFeed(payment.mailbox), {
      by: duva,
      changes: [{ type: "paymentLapsed", agent: payment.agent, payment: id, cardName: payment.cardName, site: payment.site, amount: amountOf(payment.amount), currency: payment.currency, for: payment.for }],
      items: [
        {
          Update: {
            TableName: table.name,
            Key: paymentKey(human, id),
            UpdateExpression: "SET #state = :lapsed REMOVE wayBack",
            ConditionExpression: "#state = :approved AND decidedAt <= :line",
            ExpressionAttributeNames: { "#state": "state" },
            ExpressionAttributeValues: { ":lapsed": "lapsed", ":approved": "approved", ":line": lapseLine() },
          },
        },
      ],
    });
  } catch (error) {
    // Paid meanwhile, or not yet due. recordChanges gives the items' cancellation reasons after the counter's and the one change's.
    if (!(error instanceof TransactionCanceledException) || error.CancellationReasons?.[2]?.Code !== "ConditionalCheckFailed") throw error;
  }
}

/** The card's payments not yet paid or declined, which go with the card, with the approval log's listings of those approved. */
export async function openPayments(table: Table, card: StoredSecret): Promise<Record<string, unknown>[]> {
  return (await storedPayments(table, card.human))
    .filter(({ card: of, state }) => of === card.id && (state === "waiting" || state === "approved"))
    .flatMap(({ id, decidedAt }) => [paymentKey(card.human, id), ...(decidedAt === undefined ? [] : [decisionKey(card.human, decidedAt, id)])]);
}

/** What a card's part costs: a payment, which the run may make, waits for, or is refused. */
export type Paying = { paid: true } | { waiting: Payment } | { refused: string };

/**
 * Pays with the card, for the run, on the site, as a part of it is typed into the page there, at the
 * address the browser reports: once per run on a site, on the card's sites within its limits, or as
 * its human approved the payment this turn or task asked for, until the approval lapses. A part
 * typed again in the same session pays nothing more. A payment that waits keeps its way back: the
 * page, and what the run was `asked` with. `organizationPays` is whether the organization lets
 * mailbox agents pay.
 */
export async function payWith(
  table: Table,
  paying: { card: StoredSecret; part: SecretPartName; agent: Agent; run: RunIdentity; site: string; page: string; asked: Asked; amount: number; currency: string; what: string; organizationPays: boolean },
): Promise<Paying> {
  const { card, part, agent, run, site, page, asked, amount, currency, what, organizationPays } = paying;
  const human = card.human;
  const at = new Date().toISOString();
  const paidPart = { at, kind: "filled" as const, site, part, run: runOf(run) };
  // The card goes only where the browser says the page is, never where the page says it is: no part
  // of it into a page off its sites, even after a part was typed on one, or its human approved paying
  // there, and none into a page anyone between could read or forge.
  const { protocol, hostname: host } = new URL(page);
  if (protocol !== "https:") return { refused: `${card.name} goes only into pages served over https, and this one isn't, so finish without paying.` };
  const onSite = paysOn(card, host);
  const { Item: before } = await documents(table).send(new GetCommand({ TableName: table.name, Key: runPaymentKey(human, run, card.id, site), ConsistentRead: true }));
  let claimed: StoredPayment | undefined;
  if (before !== undefined) {
    const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: paymentKey(human, before.payment as string), ConsistentRead: true }));
    const earlier = Item as StoredPayment | undefined;
    claimed = earlier;
    if (earlier?.state === "paid" && before.session === run.session) {
      if (!onSite) return { refused: `${card.name} goes only into pages on its sites, and ${host} isn't on one. Type it only on the page where its number went in.` };
      await recordUse(table, card, paidPart);
      return { paid: true };
    }
    if (earlier?.state === "waiting") return { waiting: paymentOf(earlier) };
    if (earlier?.state === "declined") return { refused: `Its human declined this payment of ${amountOf(earlier.amount)} ${earlier.currency} on ${site}, so it isn't paid.` };
    if (earlier?.state === "paid") return { refused: `This run paid ${amountOf(earlier.amount)} ${earlier.currency} on ${site} with ${card.name} already, so it doesn't pay again.` };
  }
  if (!organizationPays) return { refused: "An admin turned paying off for the organization, so no card pays." };
  // Only the turn's or task's own approved payment, which a run that goes back for it pays as that
  // turn or task: an approval left from another, as when its page expired, asks again (#183).
  const approved = onSite && claimed !== undefined && stateOf(claimed) === "approved" && claimed.card === card.id && claimed.site === site && claimed.currency === currency && claimed.amount === amount ? claimed : undefined;
  const limits = card.limits;
  if (approved === undefined && limits === undefined) return { refused: `${card.name} has no limits set, so it doesn't pay. Its human sets them in Settings, under Secrets.` };
  const record = (payment: StoredPayment, items: TransactItem[]) =>
    recordChanges(table, mailboxFeed(payment.mailbox), {
      by: agent.id,
      changes: [
        payment.state === "waiting"
          ? { type: "paymentAsked", agent: agent.id, payment: payment.id, cardName: card.name, site, amount: amountOf(amount), currency, for: what, ...(payment.newSite && { newSite: true }), ...(payment.aboveLimits && { aboveLimits: true }) }
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
      // An approved payment is paid once, outside the limits, and counts toward the month. Its way back goes.
      try {
        await record({ ...approved, state: "paid" }, [
          {
            Update: {
              TableName: table.name,
              Key: paymentKey(human, approved.id),
              UpdateExpression: "SET #state = :paid, paidAt = :at REMOVE wayBack",
              ConditionExpression: "#state = :approved AND decidedAt > :lapsed",
              ExpressionAttributeNames: { "#state": "state" },
              ExpressionAttributeValues: { ":paid": "paid", ":at": at, ":approved": "approved", ":lapsed": lapseLine() },
            },
          },
          month(),
        ]);
      } catch (error) {
        // Another run of the turn or task paid it meanwhile, or the approval lapsed, so it goes as
        // that left it: the payment is the item after the claim.
        if (error instanceof TransactionCanceledException && error.CancellationReasons?.[3]?.Code === "ConditionalCheckFailed") return payWith(table, paying);
        throw error;
      }
      return { paid: true };
    }
    const payment: StoredPayment = { id: randomUUID(), human, agent: agent.id, state: "paid", card: card.id, cardName: card.name, site, amount, currency, for: what, at, mailbox: run.mailbox, run: runOf(run) };
    const newSite = !onSite;
    let within = currency === limits!.currency && amount <= limits!.perPayment && (await spentIn(table, card)) + amount <= limits!.perMonth;
    if (within && !newSite) {
      try {
        await record(payment, [{ Put: { TableName: table.name, Item: { ...paymentKey(human, payment.id), ...payment }, ...isNew } }, month(limits!.perMonth - amount)]);
        return { paid: true };
      } catch (error) {
        // Another payment filled the month meanwhile, so this one waits.
        if (!failed(error, "month")) throw error;
        within = false;
      }
    }
    const waiting: StoredPayment = { ...payment, state: "waiting", ...(newSite && { newSite: true }), ...(!within && { aboveLimits: true }), wayBack: { page, ...asked } };
    await record(waiting, [{ Put: { TableName: table.name, Item: { ...paymentKey(human, waiting.id), ...waiting }, ...isNew } }]);
    return { waiting: paymentOf(waiting) };
  } catch (error) {
    // Another call of the run claimed the site meanwhile, so it goes as that one went.
    if (failed(error, "claim")) return payWith(table, paying);
    throw error;
  }
}

/** Only humans have payments, and each sees only their own Coo's. */
const othersRefused = () => refusal(403, "Only humans approve their Coo's payments, each only their own.");

export const listPayments: OperationHandler = async (_event, { table }, actor) => {
  // A mailbox agent lists its human's, so it can say how each stands (#184).
  const human = actor?.kind === "human" ? actor.id : actor?.kind === "agent" && actor.mailboxAgent === true ? actor.sponsor : undefined;
  if (human === undefined) return refusal(403, "Only humans and their own Coo list their Coo's payments. Ask your sponsor for theirs.");
  return { statusCode: 200, body: { payments: (await storedPayments(table, human)).map(paymentOf) } satisfies components["schemas"]["PaymentList"] };
};

/**
 * Approves or declines the payment waiting for the human, recorded in its mailbox's feed under them,
 * and listed in their approval log (#186). Approving a payment on a site its card doesn't name adds
 * the site to the card, and the change has the task giver hand the payment to a fresh run, which
 * goes back and pays it (payment-runs.ts). The approval lapses 24 hours on, if nothing paid it.
 * Declining drops its way back.
 */
const decide =
  (approved: boolean): OperationHandler =>
  async (event, { table, paymentLapses }, actor) => {
    if (actor?.kind !== "human") return othersRefused();
    const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: paymentKey(actor.id, event.pathParameters?.payment ?? ""), ConsistentRead: true }));
    const payment = Item as StoredPayment | undefined;
    if (payment === undefined) return refusal(404, "Your Coo has no such payment. List the payments to find its ID.");
    const waitingNoMore = () => refusal(409, `That payment was ${payment.state} already. Only a payment waiting for you can be approved or declined.`);
    if (payment.state !== "waiting") return waitingNoMore();
    const at = new Date().toISOString();
    const state = approved ? "approved" : "declined";
    const [card, agent] = await Promise.all([approved && payment.newSite ? findSecret(table, actor.id, payment.card) : undefined, findActor(table, payment.agent)]);
    const siteAdded = card !== undefined && !paysOn(card, payment.site);
    // Scheduled first, so no approval lacks the schedule that has it lapse. One for a payment decided
    // otherwise meanwhile finds it declined, or paid, and does nothing.
    if (approved) await paymentLapses.lapseAt({ human: actor.id, payment: payment.id }, new Date(Date.parse(at) + approvalLasts));
    try {
      await recordChanges(table, mailboxFeed(payment.mailbox), {
        by: actor.id,
        changes: [{ type: "paymentDecided", agent: payment.agent, payment: payment.id, approved, site: payment.site, amount: amountOf(payment.amount), currency: payment.currency, ...(siteAdded && { siteAdded: true }) }],
        items: [
          {
            Update: {
              TableName: table.name,
              Key: paymentKey(actor.id, payment.id),
              UpdateExpression: `SET #state = :state, decidedAt = :at${approved ? "" : " REMOVE wayBack"}`,
              ConditionExpression: "#state = :waiting",
              ExpressionAttributeNames: { "#state": "state" },
              ExpressionAttributeValues: { ":state": state, ":at": at, ":waiting": "waiting" },
            },
          },
          ...(siteAdded
            ? [
                {
                  Update: {
                    TableName: table.name,
                    Key: secretKey(actor.id, card.id),
                    UpdateExpression: "SET sites = list_append(if_not_exists(sites, :none), :site), changedAt = :at",
                    ConditionExpression: `attribute_exists(${pk})`,
                    ExpressionAttributeValues: { ":none": [], ":site": [payment.site], ":at": at },
                  },
                },
              ]
            : []),
          listDecision(table, actor.id, { payment: payment.id, agent: payment.agent, agentName: agent?.kind === "agent" ? agent.name : "", decidedBy: actor.id, decidedAt: at }),
        ],
      });
    } catch (error) {
      // recordChanges gives the items' cancellation reasons after the counter's and the one change's.
      const reasons = error instanceof TransactionCanceledException ? (error.CancellationReasons ?? []) : [];
      if (reasons[2]?.Code === "ConditionalCheckFailed") return refusal(409, "That payment was decided meanwhile. List the payments to see how.");
      if (reasons[3]?.Code === "ConditionalCheckFailed") return refusal(409, "Its card was deleted meanwhile, so nothing pays it. List the payments to see what still waits.");
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
