import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { type Operation, operations, type OperationId } from "@duva/openapi";
import { approveAccessRequest, askForAccess, collectAccess, declineAccessRequest, getAccessRequest } from "./access-requests.ts";
import { addAddress, changeMailbox, listAddresses, removeAddress } from "./addresses.ts";
import * as allMailboxes from "./all-mailboxes.ts";
import { getAgentEvent, listAgentEvents } from "./activity.ts";
import { listApprovalLog } from "./approval-log.ts";
import { listAlerts, markAlertsSeen } from "./alerts.ts";
import { getAttachment, stopSharing } from "./attachments.ts";
import { changeAgentSettings, createAgent, getAgentSettings, listAgents, listOrganizationAgents, pauseAgent, pausedRefusal, removeAgent, rotateAgentKey, unpauseAgent } from "./agents.ts";
import type { AuthorizerContext } from "./authorizer.ts";
import { changeCooAddress, changeCooSenders, getCooAddress } from "./coo-address.ts";
import { clearConversation, getMailboxAgent, getMailboxAgentRouting, getMailboxAgentSpend, signCooOut } from "./conversation.ts";
import { addDomain, changeDomain, clearCatchAll, getDomain, listDomains, removeDomain, setCatchAll } from "./domains.ts";
import { listOrganizationChanges } from "./changes.ts";
import { createDraft, deleteDraft, editDraft, getDraft, listApprovals, listDrafts, rejectApproval, sendApproval, sendDraft, sendDraftNow, undoApproval } from "./drafts.ts";
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
  listOrganizationMailboxes,
  listMailboxLabels,
  listSentThreads,
  listThreads,
  markThreadsRead,
  markThreadsUnread,
  renameMailboxLabel,
  setMailboxLabelPrompt,
  removeMailboxLabelPrompt,
} from "./mailboxes.ts";
import type { Deployment } from "./deployment.ts";
import { getMessageHeaders } from "./message-headers.ts";
import { correctMemory, forgetMemories, forgetMemory, keepMemory, listMemories } from "./memories.ts";
import { actorOf } from "./organization.ts";
import { getDomainLogo, getMailboxLogo, removeDomainLogo, removeLogoCertificate, removeMailboxLogo, setDomainLogo, setLogoCertificate, setMailboxLogo } from "./own-logos.ts";
import { changePreferences, getPreferences } from "./preferences.ts";
import { approvePayment, declinePayment, deleteSecret, listPayments } from "./payments.ts";
import { useSecret } from "./secret-uses.ts";
import { addSecret, changeSecret, getSecret, listSecrets, revealSecret } from "./secrets.ts";
import { suggest } from "./suggestions.ts";
import { changeAwayMessage, getAwayMessage } from "./away-messages.ts";
import { changeSignature, getSignature } from "./signatures.ts";
import { cancelReminders, listReminders, remindThreads } from "./reminders.ts";
import { searchMailbox } from "./search.ts";
import { getScreener, getSender, listSenders, removeSenderDelivery, setSenderDelivery, switchScreener } from "./screener.ts";
import { changeOrganizationSettings, getOrganizationSettings, listMailboxAgentModels, previewRetention } from "./settings.ts";
import { getStatus } from "./status.ts";
import { changeDraftAttachment, completeUpload, getDraftAttachment, getUpload, removeDraftAttachment, startUpload } from "./uploads.ts";
import { whoami } from "./whoami.ts";
import type { OperationHandler } from "./operation-handler.ts";

export const handlers: Record<OperationId, OperationHandler> = {
  getStatus,
  whoami,
  listOrganizationChanges,
  getOrganizationSettings,
  listMailboxAgentModels,
  getMailboxAgentSpend,
  getMailboxAgentRouting,
  changeOrganizationSettings,
  previewRetention,
  getPreferences,
  suggest,
  changePreferences,
  getAwayMessage,
  changeAwayMessage,
  getSignature,
  changeSignature,
  listMemories,
  keepMemory,
  forgetMemories,
  correctMemory,
  forgetMemory,
  addHuman,
  listHumans,
  changeHuman,
  removeHuman,
  createAgent,
  listAgents,
  listOrganizationAgents,
  removeAgent,
  rotateAgentKey,
  pauseAgent,
  unpauseAgent,
  getAgentSettings,
  changeAgentSettings,
  getAgentEvent,
  listAgentEvents,
  askForAccess,
  collectAccess,
  getAccessRequest,
  approveAccessRequest,
  declineAccessRequest,
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
  setCatchAll,
  clearCatchAll,
  getDomainLogo,
  setDomainLogo,
  removeDomainLogo,
  setLogoCertificate,
  removeLogoCertificate,
  getMailboxLogo,
  setMailboxLogo,
  removeMailboxLogo,
  createMailbox,
  listMailboxes,
  listOrganizationMailboxes,
  getMailbox,
  changeMailbox,
  listMailboxChanges,
  listThreads,
  listSentThreads,
  markThreadsRead,
  markThreadsUnread,
  labelThreads: labelMailboxThreads,
  getThread,
  remindThreads,
  cancelReminders,
  listReminders,
  listAllMail,
  searchMailbox,
  listLabels: listMailboxLabels,
  createLabel: createMailboxLabel,
  renameLabel: renameMailboxLabel,
  deleteLabel: deleteMailboxLabel,
  setLabelPrompt: setMailboxLabelPrompt,
  removeLabelPrompt: removeMailboxLabelPrompt,
  emptyTrash: emptyMailboxTrash,
  getMailboxAgent,
  clearConversation,
  signCooOut,
  listSecrets,
  addSecret,
  getSecret,
  changeSecret,
  deleteSecret,
  revealSecret,
  useSecret,
  getCooAddress,
  changeCooSenders,
  changeCooAddress,
  getScreener,
  switchScreener,
  listSenders,
  getSender,
  setSenderDelivery,
  removeSenderDelivery,
  getAttachment,
  stopSharing,
  getMessageHeaders,
  createDraft,
  startUpload,
  getUpload,
  completeUpload,
  getDraftAttachment,
  changeDraftAttachment,
  removeDraftAttachment,
  listDrafts,
  getDraft,
  editDraft,
  deleteDraft,
  sendDraft,
  sendDraftNow,
  ...allMailboxes,
  listAlerts,
  markAlertsSeen,
  listApprovals,
  listApprovalLog,
  sendApproval,
  rejectApproval,
  undoApproval,
  listPayments,
  approvePayment,
  declinePayment,
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
    const { statusCode, body } = actor?.kind === "agent" && actor.paused !== undefined ? await pausedRefusal(deployment.table, { ...actor, paused: actor.paused }) : await handlers[operation.operationId](event, deployment, actor);
    return { statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
  };
}
