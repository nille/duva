// The approval log's listing: each decision on an agent's send is listed in its approver's
// partition, sorted by when it was decided, so a sponsor's log is one query away. A decision made
// again, as a send approved after all, moves its listing to its new time, and an approval undone
// leaves the log while it waits again. The listing goes with the approval record when erasure
// erases it (ADR-0014). Each decision on a payment of Coo's is listed beside them, in its human's
// partition, which the payment goes with (#186).
import type { Table } from "./deployment.ts";
import { pk, sk, type TransactItem } from "./table.ts";

/** What a listing names: the approval of a send, or a payment, and who decided it about which agent. */
export type Decision = { agent: string; agentName: string; decidedBy: string; decidedAt: string } & ({ approval: string } | { payment: string });

export const decisionPrefix = "decided#";
/** Where the decision on the approval or the payment with the ID is listed in its approver's log. */
export const decisionKey = (approver: string, decidedAt: string, decided: string) => ({ [pk]: `actor#${approver}`, [sk]: `${decisionPrefix}${decidedAt}#${decided}` });

/** The write that lists the decision in its approver's log. */
export const listDecision = (table: Table, approver: string, decision: Decision): TransactItem => ({
  Put: { TableName: table.name, Item: { ...decisionKey(approver, decision.decidedAt, "approval" in decision ? decision.approval : decision.payment), ...decision } },
});

/** The write that takes the decision made at the time off its approver's log. */
export const unlistDecision = (table: Table, approver: string, decidedAt: string, approval: string): TransactItem => ({
  Delete: { TableName: table.name, Key: decisionKey(approver, decidedAt, approval) },
});
