// Changes to the organization's setup, which an agent admin's wait for its sponsor's approval
// unless the sponsor switched that off. Each setup operation is planned first, from the setup as it
// is: the plan says what the change would do, and runs it. An agent admin's call keeps the plan's
// preview in a setup approval, and approving plans the call again, as the agent, and runs it.
import { randomUUID } from "node:crypto";
import { ConditionalCheckFailedException, TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { GetCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import type { components, OperationId } from "@duva/openapi";
import { handlers, jsonBody, type OperationHandler, refusal } from "./api.ts";
import type { Deployment, Table } from "./deployment.ts";
import { maxNote } from "./drafting.ts";
import { type Actor, type Agent, agentAdminUnpaused, agentSettings, type Mailbox, changeAgentAdmin, findActor, recordChange, sponsoredAgents } from "./organization.ts";
import { documents, isNew, pk, sk } from "./table.ts";

export type SetupApproval = components["schemas"]["SetupApproval"];
type SetupOperation = components["schemas"]["SetupOperation"];
type SetupResult = components["schemas"]["SetupResult"];
type Answer = Awaited<ReturnType<OperationHandler>>;

/** A setup change as planned from the setup as it is: what it would do, in sentences, and what makes it. */
export interface SetupPlan {
  preview: string[];
  run: () => Promise<Answer>;
}

/** Plans the call's setup change for the actor, or refuses it, as its operation would. */
export type SetupPlanner = (event: APIGatewayProxyEventV2, deployment: Deployment, actor: Actor) => Promise<SetupPlan | Answer>;

/** The items as a preview lists them, as "a, b and c". */
export const listed = (items: string[]) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);

/** The actor as a preview names it: an agent by its name, a human by their address. */
export const actorNamed = (actor: Actor) => (actor.kind === "agent" ? `the agent ${actor.name}` : actor.email);

/** The mailbox as a preview names it: by its owner, the agent's name or the human's address, and its default address. */
export async function mailboxNamed(table: Table, mailbox: Mailbox): Promise<string> {
  const owner = await findActor(table, mailbox.owner);
  const whose = owner === undefined ? "a removed actor's" : owner.kind === "agent" ? `${owner.name}'s` : `${owner.email}'s`;
  return `${whose} mailbox ${mailbox.defaultAddress === undefined ? "with no address" : `at ${mailbox.defaultAddress}`}`;
}

/** A setup operation's handler, with the planner that approving its setup approval plans the call with again. */
export type SetupHandler = OperationHandler & { planner: SetupPlanner };

/**
 * The handler of a setup operation, which the planner plans. An agent admin's change waits for its
 * sponsor's approval unless the sponsor switched that off, and is answered with 202 and the setup
 * approval. A change that would change nothing needs none.
 */
// Modules make their handlers with it as they load, some while this one waits for its own imports,
// so it uses nothing of this module's until it is called. Its own handlers are function
// declarations, so api.ts can list them whichever module loads first.
export function setupOperation(operationId: OperationId, planner: SetupPlanner): SetupHandler {
  const handler: OperationHandler = async (event, deployment, actor) => {
    const plan = await planner(event, deployment, actor!);
    if (!("run" in plan)) return plan;
    if (actor!.kind === "human" || plan.preview.length === 0 || !(await agentSettings(deployment.table, actor!.id)).settings.approvalForSetup) return plan.run();
    const approval = await askForSetup(deployment.table, { agent: actor!, operation: operationOf(operationId, event), preview: plan.preview });
    return { statusCode: 202, body: approval satisfies SetupApproval };
  };
  return Object.assign(handler, { planner });
}

/** The call as the setup approval keeps it, to make it again once approved. */
function operationOf(operationId: OperationId, event: APIGatewayProxyEventV2): SetupOperation {
  const path = event.pathParameters ?? {};
  const body = jsonBody(event);
  return { operationId, ...(Object.keys(path).length > 0 && { path: path as Record<string, string> }), ...(body !== undefined && { body }) };
}

/** The call the setup approval keeps, as the operation's handler takes it. */
const eventOf = ({ path, body }: SetupOperation) =>
  ({ pathParameters: path ?? {}, queryStringParameters: {}, body: body === undefined ? undefined : JSON.stringify(body), isBase64Encoded: false }) as unknown as APIGatewayProxyEventV2;

const approvalKey = (id: string) => ({ [pk]: `setupApproval#${id}`, [sk]: "setupApproval" });
// Each pending setup approval is listed in its approver's partition, newest last, until it is decided.
const pendingPrefix = "setupPending#";
const pendingKey = (approver: string, askedAt: string, id: string) => ({ [pk]: `actor#${approver}`, [sk]: `${pendingPrefix}${askedAt}#${id}` });

/** Keeps the agent's setup change, with its preview, for its sponsor to decide, recorded in the organization's change feed under the agent. */
async function askForSetup(table: Table, { agent, operation, preview }: { agent: Agent; operation: SetupOperation; preview: string[] }): Promise<SetupApproval> {
  const approval: SetupApproval = { id: randomUUID(), state: "pending", agent: agent.id, approver: agent.sponsor, operation, preview, askedAt: new Date().toISOString() };
  await recordChange(table, agent.id, { type: "setupAsked", approval: approval.id, operation, preview }, [
    { Put: { TableName: table.name, Item: { ...approvalKey(approval.id), ...approval }, ...isNew } },
    { Put: { TableName: table.name, Item: pendingKey(approval.approver, approval.askedAt, approval.id) } },
  ]);
  return approval;
}

/** The setup approval with the ID, or undefined if there is none. */
async function findSetupApproval(table: Table, id: string): Promise<SetupApproval | undefined> {
  const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: approvalKey(id), ConsistentRead: true }));
  return Item === undefined ? undefined : setupApprovalOf(Item as SetupApproval);
}

/** The setup approvals waiting for the approver, newest first. */
export async function pendingSetupApprovals(table: Table, approver: string): Promise<SetupApproval[]> {
  const ids: string[] = [];
  let start: Record<string, unknown> | undefined;
  do {
    const page = await documents(table).send(
      new QueryCommand({
        TableName: table.name,
        KeyConditionExpression: `${pk} = :approver AND begins_with(${sk}, :pending)`,
        ExpressionAttributeValues: { ":approver": pendingKey(approver, "", "")[pk], ":pending": pendingPrefix },
        ScanIndexForward: false,
        ConsistentRead: true,
        ExclusiveStartKey: start,
      }),
    );
    for (const item of page.Items ?? []) ids.push((item[sk] as string).split("#").at(-1)!);
    start = page.LastEvaluatedKey;
  } while (start !== undefined);
  const approvals = await Promise.all(ids.map((id) => findSetupApproval(table, id)));
  return approvals.filter((approval) => approval?.state === "pending") as SetupApproval[];
}

/** The setup approval as the contract lists its fields. */
const setupApprovalOf = ({ id, state, agent, approver, operation, preview, askedAt, decidedAt, note, result }: SetupApproval): SetupApproval => ({
  id,
  state,
  agent,
  approver,
  operation,
  preview,
  askedAt,
  ...(decidedAt !== undefined && { decidedAt }),
  ...(note !== undefined && { note }),
  ...(result !== undefined && { result }),
});

/** The setup approval was decided or withdrawn first. */
class AlreadyDecided extends Error {}

/** The agent was paused, or stopped being an admin, before the approval was decided. */
class AgentChanged extends Error {}

/**
 * Decides the pending setup approval, on behalf of the actor `by`, with the change in the
 * organization's change feed, and returns it decided. Approving holds only while the agent is an
 * admin and isn't paused, and throws AgentChanged if it isn't. Throws AlreadyDecided if another
 * decision came first.
 */
async function decide(table: Table, approval: SetupApproval, by: string, decision: { state: "approved" } | { state: "rejected"; note: string } | { state: "withdrawn" }): Promise<SetupApproval> {
  const decided: SetupApproval = { ...approval, ...decision, decidedAt: new Date().toISOString() };
  const change = { approval: approval.id, agent: approval.agent };
  await recordChange(
    table,
    by,
    decision.state === "approved" ? { type: "setupApproved", ...change } : decision.state === "rejected" ? { type: "setupRejected", ...change, note: decision.note } : { type: "setupWithdrawn", ...change },
    [
      {
        Put: {
          TableName: table.name,
          Item: { ...approvalKey(approval.id), ...decided },
          ConditionExpression: "#state = :pending",
          ExpressionAttributeNames: { "#state": "state" },
          ExpressionAttributeValues: { ":pending": "pending" },
        },
      },
      { Delete: { TableName: table.name, Key: pendingKey(approval.approver, approval.askedAt, approval.id) } },
      ...(decision.state === "approved"
        ? [
            agentAdminUnpaused(table, approval.agent),
          ]
        : []),
    ],
  ).catch((error: unknown) => {
    // The approval comes after the feed's counter and the one change, then the pending listing, then the agent's check.
    const reasons = error instanceof TransactionCanceledException ? (error.CancellationReasons ?? []) : [];
    if (reasons[2]?.Code === "ConditionalCheckFailed") throw new AlreadyDecided();
    if (reasons[4]?.Code === "ConditionalCheckFailed") throw new AgentChanged();
    throw error;
  });
  return decided;
}

/**
 * Withdraws the agent's setup approvals still waiting, on behalf of the actor `by`, as when it
 * stops being an admin or is removed.
 */
export async function withdrawSetupApprovals(table: Table, { agent, by }: { agent: Agent; by: string }): Promise<void> {
  for (const approval of await pendingSetupApprovals(table, agent.sponsor)) {
    if (approval.agent !== agent.id) continue;
    await decide(table, approval, by, { state: "withdrawn" }).catch((error: unknown) => {
      if (!(error instanceof AlreadyDecided)) throw error;
    });
  }
}

/**
 * Takes the agent's admin away, on behalf of the actor `by`, and withdraws its setup approvals
 * still waiting. Each time does it, so taking it away again finishes what one that stopped partway left.
 */
export async function takeAgentAdminAway(table: Table, { agent, by }: { agent: Agent; by: string }): Promise<Agent | undefined> {
  const changed = await changeAgentAdmin(table, { agent, admin: false, by });
  await withdrawSetupApprovals(table, { agent, by });
  return changed;
}

/** Takes away the admin of each agent the human sponsors, on behalf of the actor `by`, since the human isn't one. */
export async function takeSponsoredAdminAway(table: Table, { human, by }: { human: string; by: string }): Promise<void> {
  for (const agent of await sponsoredAgents(table, human)) await takeAgentAdminAway(table, { agent, by });
}

/** The setup approval with the ID in the call's path, or a refusal if there is none. */
async function setupApprovalAsked(event: APIGatewayProxyEventV2, table: Table): Promise<SetupApproval | Answer> {
  const id = event.pathParameters?.approval ?? "";
  const approval = await findSetupApproval(table, id);
  return approval ?? refusal(404, `There is no setup approval ${JSON.stringify(id)}. List the approvals waiting for you to find its ID.`);
}

/** The setup approval with the ID in the call's path, if the actor is its approver, since only they decide it. */
async function decidable(event: APIGatewayProxyEventV2, table: Table, actor: Actor): Promise<SetupApproval | Answer> {
  const approval = await setupApprovalAsked(event, table);
  if (!("id" in approval)) return approval;
  if (actor.kind === "agent") return refusal(403, "Agents can't decide setup approvals, their own included. The agent's sponsor decides.");
  if (approval.approver !== actor.id) return refusal(403, "Only the agent's sponsor can decide this setup approval.");
  if (approval.state !== "pending") return refusal(409, `The setup approval was already ${approval.state}, so it can't be decided again.`);
  return approval;
}

export async function getSetupApproval(...[event, deployment, actor]: Parameters<OperationHandler>): Promise<Answer> {
  const approval = await setupApprovalAsked(event, deployment.table);
  if (!("id" in approval)) return approval;
  if (actor!.id !== approval.agent && actor!.id !== approval.approver) return refusal(403, "Only the agent that asked and its sponsor can read this setup approval.");
  return { statusCode: 200, body: approval satisfies SetupApproval };
}

export async function approveSetup(...[event, deployment, actor]: Parameters<OperationHandler>): Promise<Answer> {
  const approval = await decidable(event, deployment.table, actor!);
  if (!("id" in approval)) return approval;
  const agent = await findActor(deployment.table, approval.agent);
  // Its removal, or the loss of its admin, withdraws the approval, which this ran into meanwhile.
  if (agent?.kind !== "agent" || !agent.admin) return refusal(409, "The agent is no longer an admin, so its setup change can't be made.");
  if (agent.paused !== undefined) return pausedRefusal();
  const plan = await (handlers[approval.operation.operationId as OperationId] as SetupHandler).planner(eventOf(approval.operation), deployment, agent);
  if (!("run" in plan)) {
    const { message } = plan.body as { message: string };
    return refusal(409, `The change can't be made as the setup is now. Duva would tell the agent: ${message} Reject it with a note instead.`);
  }
  if (JSON.stringify(plan.preview) !== JSON.stringify(approval.preview)) {
    await documents(deployment.table)
      .send(
        new UpdateCommand({
          TableName: deployment.table.name,
          Key: approvalKey(approval.id),
          UpdateExpression: "SET preview = :preview",
          ConditionExpression: "#state = :pending",
          ExpressionAttributeNames: { "#state": "state" },
          ExpressionAttributeValues: { ":preview": plan.preview, ":pending": "pending" },
        }),
      )
      .catch((error: unknown) => {
        // Decided meanwhile, which approving again says.
        if (!(error instanceof ConditionalCheckFailedException)) throw error;
      });
    return refusal(409, "The setup changed since the agent asked, and so did what the change would do. Read its preview again, and approve it again if it still holds.");
  }
  let decided: SetupApproval;
  try {
    decided = await decide(deployment.table, approval, actor!.id, { state: "approved" });
  } catch (error) {
    if (error instanceof AlreadyDecided) return decidedMeanwhile();
    if (error instanceof AgentChanged) return refusal(409, "The agent was paused, or stopped being an admin, meanwhile. Read the approval again.");
    throw error;
  }
  const keep = (result: SetupResult) =>
    documents(deployment.table).send(
      new UpdateCommand({ TableName: deployment.table.name, Key: approvalKey(approval.id), UpdateExpression: "SET #result = :result", ExpressionAttributeNames: { "#result": "result" }, ExpressionAttributeValues: { ":result": result } }),
    );
  let answer: Answer;
  try {
    answer = await plan.run();
  } catch (error) {
    // The approval says so, since it is decided and can't be approved again.
    await keep({ status: 500, body: { message: "Duva failed to make the change. Ask the agent to ask for it again." } });
    throw error;
  }
  const result = { status: answer.statusCode, body: answer.body };
  await keep(result);
  return { statusCode: 200, body: { ...decided, result } satisfies SetupApproval };
}

const decidedMeanwhile = () => refusal(409, "The setup approval was decided meanwhile, so it can't be decided again.");

const pausedRefusal = () =>
  refusal(409, "The agent is paused, so its setup changes can't be approved. Unpause it first, or reject this with a note.");

export async function rejectSetup(...[event, deployment, actor]: Parameters<OperationHandler>): Promise<Answer> {
  const approval = await decidable(event, deployment.table, actor!);
  if (!("id" in approval)) return approval;
  const given = jsonBody(event)?.note;
  const note = typeof given === "string" ? given.trim() : "";
  if (note === "" || note.length > maxNote) return refusal(400, `Give a note of 1 to ${maxNote} characters that says what the agent should change.`);
  try {
    return { statusCode: 200, body: (await decide(deployment.table, approval, actor!.id, { state: "rejected", note })) satisfies SetupApproval };
  } catch (error) {
    if (error instanceof AlreadyDecided) return decidedMeanwhile();
    throw error;
  }
}
