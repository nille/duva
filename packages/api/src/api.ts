import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { type Operation, operations, type OperationId } from "@duva/openapi";
import { addAddress, changeMailbox, listAddresses, removeAddress } from "./addresses.ts";
import { getAttachment } from "./attachments.ts";
import { changeAgentSettings, createAgent, getAgentSettings, listAgents, removeAgent, rotateAgentKey } from "./agents.ts";
import type { AuthorizerContext } from "./authorizer.ts";
import { addDomain, changeDomain, getDomain, listDomains, removeDomain } from "./domains.ts";
import { listOrganizationChanges } from "./changes.ts";
import { createDraft, deleteDraft, editDraft, getDraft, listApprovals, listDrafts, rejectApproval, sendApproval, sendDraft } from "./drafts.ts";
import { changeGroup, createGroup, deleteGroup, getGroup, listGroups } from "./groups.ts";
import { addHuman, changeHuman, listHumans, removeHuman } from "./humans.ts";
import {
  createMailbox,
  createMailboxLabel,
  deleteMailboxLabel,
  emptyMailboxTrash,
  getMailbox,
  getThread,
  labelMailboxThreads,
  listAllMail,
  listMailboxChanges,
  listMailboxes,
  listMailboxLabels,
  listSentThreads,
  listThreads,
  markThreadsRead,
  markThreadsUnread,
  renameMailboxLabel,
} from "./mailboxes.ts";
import type { Deployment } from "./deployment.ts";
import { type Actor, actorOf } from "./organization.ts";
import { changePreferences, getPreferences } from "./preferences.ts";
import { searchMailbox } from "./search.ts";
import { blockSender, getScreener, letInSender, listScreenedSenders, removeScreenedSender, switchScreener } from "./screener.ts";
import { changeOrganizationSettings, getOrganizationSettings, previewRetention } from "./settings.ts";
import { getStatus } from "./status.ts";
import { whoami } from "./whoami.ts";

/**
 * Handles one operation. `actor` is the actor the authorizer resolved the call to, and is
 * undefined only for operations that need no sign-in.
 */
export type OperationHandler = (
  event: APIGatewayProxyEventV2,
  deployment: Deployment,
  actor: Actor | undefined,
) => Promise<{ statusCode: number; body: unknown }>;

const handlers: Record<OperationId, OperationHandler> = {
  getStatus,
  whoami,
  listOrganizationChanges,
  getOrganizationSettings,
  changeOrganizationSettings,
  previewRetention,
  getPreferences,
  changePreferences,
  addHuman,
  listHumans,
  changeHuman,
  removeHuman,
  createAgent,
  listAgents,
  removeAgent,
  rotateAgentKey,
  getAgentSettings,
  changeAgentSettings,
  addAddress,
  listAddresses,
  removeAddress,
  createGroup,
  listGroups,
  getGroup,
  changeGroup,
  deleteGroup,
  addDomain,
  listDomains,
  getDomain,
  changeDomain,
  removeDomain,
  createMailbox,
  listMailboxes,
  getMailbox,
  changeMailbox,
  listMailboxChanges,
  listThreads,
  listSentThreads,
  markThreadsRead,
  markThreadsUnread,
  labelThreads: labelMailboxThreads,
  getThread,
  listAllMail,
  searchMailbox,
  listLabels: listMailboxLabels,
  createLabel: createMailboxLabel,
  renameLabel: renameMailboxLabel,
  deleteLabel: deleteMailboxLabel,
  emptyTrash: emptyMailboxTrash,
  getScreener,
  switchScreener,
  letInSender,
  blockSender,
  listScreenedSenders,
  removeScreenedSender,
  getAttachment,
  createDraft,
  listDrafts,
  getDraft,
  editDraft,
  deleteDraft,
  sendDraft,
  listApprovals,
  sendApproval,
  rejectApproval,
};

const operationByRouteKey = new Map<string, Operation>(operations.map((operation) => [operation.routeKey, operation]));

/** The API's Lambda handler. API Gateway has one route per operation, so the route key names the operation. */
export function createApi(deployment: Deployment) {
  return async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
    const operation = operationByRouteKey.get(event.routeKey);
    if (operation === undefined) throw new Error(`No operation has the route ${event.routeKey}`);
    const passed = (event.requestContext as { authorizer?: { lambda?: Partial<AuthorizerContext> } }).authorizer?.lambda?.actor;
    const actor = passed && actorOf(passed);
    // The authorizer guards every route that needs sign-in, so a call without an actor here is a deployment bug.
    if (operation.signIn && actor === undefined) throw new Error(`${operation.operationId} was called without an actor`);
    const { statusCode, body } = await handlers[operation.operationId](event, deployment, actor);
    return { statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
  };
}

/** The call's JSON body, or undefined if it has none that parses. */
export function jsonBody(event: APIGatewayProxyEventV2): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body ?? "", "base64").toString() : (event.body ?? ""));
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** An answer that the call can't be done, with what to do about it. */
export const refusal = (statusCode: number, message: string) => ({ statusCode, body: { message } });
