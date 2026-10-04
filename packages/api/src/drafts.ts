import type { components } from "@duva/openapi";
import { jsonBody, type OperationHandler, refusal } from "./api.ts";
import { isEmailAddress } from "./email-address.ts";
import type { Deployment } from "./deployment.ts";
import {
  addDraft,
  AlreadyApproved,
  AlreadyDecided,
  AlreadyWaiting,
  type Approval,
  approvalOf,
  approve,
  askToSend,
  changeDraft,
  draftsIn,
  findApproval,
  findDraft,
  pendingApprovals,
  reject,
} from "./drafting.ts";
import { findMessage } from "./mail.ts";
import { readableMailbox } from "./mailboxes.ts";
import type { Actor, Mailbox } from "./organization.ts";

type EmailAddress = components["schemas"]["EmailAddress"];

const maxText = 50000;
const maxSubject = 998;
const maxNote = 2000;

export const createDraft: OperationHandler = async (event, deployment, actor) => {
  const mailbox = await ownMailbox(event, deployment, actor!);
  if ("statusCode" in mailbox) return mailbox;
  const body = jsonBody(event) ?? {};
  const given = fieldsIn(body);
  if ("statusCode" in given) return given;
  if (given.text === undefined) return refusal(400, "Give the draft's text.");

  let content;
  if (typeof body.answers === "string") {
    const original = await findMessage(deployment.table, deployment.mailBucket, mailbox.id, body.answers);
    if (original === undefined) return refusal(404, `The mailbox has no message ${JSON.stringify(body.answers)}. Read its threads to find the message to reply to.`);
    const { message, thread, replyTo } = original;
    content = {
      answers: message.id,
      thread,
      // A reply goes from the address the original was sent to, plus tag kept.
      from: message.recipient,
      to: given.to ?? (replyTo.length > 0 ? replyTo : [message.from]),
      subject: given.subject ?? `Re: ${message.subject.replace(/^(\s*re\s*:\s*)+/i, "")}`,
      text: given.text,
    };
  } else {
    if (given.to === undefined || given.subject === undefined) {
      return refusal(400, "A new message needs recipients and a subject. To reply to a message instead, give its ID as answers.");
    }
    content = { from: mailbox.defaultAddress, to: given.to, subject: given.subject, text: given.text };
  }
  return { statusCode: 201, body: (await addDraft(deployment.table, { mailbox: mailbox.id, by: actor!.id, content })) satisfies components["schemas"]["Draft"] };
};

/** The mailbox with the ID in the call's path, if the actor owns it, since only its owner drafts in it. */
async function ownMailbox(event: Parameters<OperationHandler>[0], deployment: Deployment, actor: Actor): Promise<Mailbox | ReturnType<typeof refusal>> {
  const mailbox = await readableMailbox(event, deployment, actor);
  if ("statusCode" in mailbox) return mailbox;
  if (mailbox.owner !== actor.id) return refusal(403, "Only the mailbox's owner can write drafts in it and ask to send them. For an agent's mailbox, the agent's sponsor decides its sends in approvals.");
  return mailbox;
}

/** The recipients, subject and text the body gives, each checked, or why one doesn't fit. */
function fieldsIn(body: Record<string, unknown>): { to?: EmailAddress[]; subject?: string; text?: string } | ReturnType<typeof refusal> {
  const { to, subject, text } = body;
  if (text !== undefined && (typeof text !== "string" || text.length > maxText)) return refusal(400, `Give the text as at most ${maxText} characters.`);
  if (subject !== undefined && (typeof subject !== "string" || subject.length > maxSubject || /[\r\n]/.test(subject))) {
    return refusal(400, `Give the subject as one line of at most ${maxSubject} characters.`);
  }
  if (to === undefined) return { subject, text };
  const addresses = Array.isArray(to) ? to.map((address) => (typeof address === "string" ? address.trim() : "")) : [];
  const wrong = addresses.find((address) => !isEmailAddress(address));
  if (addresses.length === 0 || wrong !== undefined) {
    return refusal(400, `${wrong === undefined ? "Give at least one recipient" : `${JSON.stringify(wrong)} isn't an email address`}. Give each recipient's address, like grace@example.org.`);
  }
  return { to: addresses.map((address) => ({ address })), subject, text };
}

export const listDrafts: OperationHandler = async (event, deployment, actor) => {
  const mailbox = await readableMailbox(event, deployment, actor!);
  if ("statusCode" in mailbox) return mailbox;
  return { statusCode: 200, body: { drafts: await draftsIn(deployment.table, mailbox.id) } satisfies components["schemas"]["DraftList"] };
};

export const getDraft: OperationHandler = async (event, deployment, actor) => {
  const mailbox = await readableMailbox(event, deployment, actor!);
  if ("statusCode" in mailbox) return mailbox;
  const draft = await findDraft(deployment.table, mailbox.id, event.pathParameters?.draft ?? "");
  if (draft === undefined) return noDraft(event);
  return { statusCode: 200, body: draft satisfies components["schemas"]["Draft"] };
};

export const editDraft: OperationHandler = async (event, deployment, actor) => {
  const mailbox = await ownMailbox(event, deployment, actor!);
  if ("statusCode" in mailbox) return mailbox;
  const changes = fieldsIn(jsonBody(event) ?? {});
  if ("statusCode" in changes) return changes;
  if (Object.values(changes).every((value) => value === undefined)) return refusal(400, "Give the draft's new recipients, subject or text.");
  try {
    const draft = await changeDraft(deployment.table, { mailbox: mailbox.id, id: event.pathParameters?.draft ?? "", by: actor!.id, changes });
    if (draft === undefined) return noDraft(event);
    return { statusCode: 200, body: draft satisfies components["schemas"]["Draft"] };
  } catch (error) {
    if (error instanceof AlreadyApproved) return approvedRefusal(error);
    throw error;
  }
};

export const sendDraft: OperationHandler = async (event, deployment, actor) => {
  const mailbox = await ownMailbox(event, deployment, actor!);
  if ("statusCode" in mailbox) return mailbox;
  // An agent's send from its own mailbox needs its sponsor's approval. Humans can't send from theirs yet.
  if (actor!.kind !== "agent") return refusal(403, "Only agents can ask to send from their mailboxes yet.");
  try {
    const draft = await askToSend(deployment.table, { mailbox: mailbox.id, id: event.pathParameters?.draft ?? "", agent: actor! });
    if (draft === undefined) return noDraft(event);
    return { statusCode: 202, body: draft satisfies components["schemas"]["Draft"] };
  } catch (error) {
    if (error instanceof AlreadyWaiting) return refusal(409, "The draft already waits for approval. Change it to withdraw the request, or wait for the decision.");
    if (error instanceof AlreadyApproved) return approvedRefusal(error);
    throw error;
  }
};

export const listApprovals: OperationHandler = async (_event, deployment, actor) => {
  const approvals = await pendingApprovals(deployment.table, actor!.id);
  return {
    statusCode: 200,
    body: { approvals: await Promise.all(approvals.map((approval) => withOriginal(deployment, approval))) } satisfies components["schemas"]["ApprovalList"],
  };
};

const approvedRefusal = (error: AlreadyApproved) =>
  refusal(409, `The draft was approved and ${approvedOutcomes[error.state]}, so it can't change or be sent again. Write a new draft instead.`);

// What became of an approved draft, by its send's state.
const approvedOutcomes: Partial<Record<AlreadyApproved["state"], string>> = {
  approved: "is about to be sent",
  sending: "is being sent",
  sent: "sent",
  unclear: "may have been sent, which a human checks",
};

export const sendApproval: OperationHandler = async (event, deployment, actor) => {
  const approval = await decidable(event, deployment, actor!);
  if ("statusCode" in approval) return approval;
  const edits = fieldsIn(jsonBody(event) ?? {});
  if ("statusCode" in edits) return edits;
  const edited = Object.values(edits).some((value) => value !== undefined);
  return decided(deployment, () => approve(deployment.table, { approval, by: actor!.id, edits: edited ? edits : undefined }), 202);
};

export const rejectApproval: OperationHandler = async (event, deployment, actor) => {
  const approval = await decidable(event, deployment, actor!);
  if ("statusCode" in approval) return approval;
  const given = jsonBody(event)?.note;
  const note = typeof given === "string" ? given.trim() : "";
  if (note === "" || note.length > maxNote) return refusal(400, `Give a note of 1 to ${maxNote} characters that says what the agent should change.`);
  return decided(deployment, () => reject(deployment.table, { approval, by: actor!.id, note }), 200);
};

/** The approval with the ID in the call's path, if the actor is its approver, since only they decide it. */
async function decidable(event: Parameters<OperationHandler>[0], deployment: Deployment, actor: Actor): Promise<Approval | ReturnType<typeof refusal>> {
  const id = event.pathParameters?.approval ?? "";
  const approval = await findApproval(deployment.table, id);
  if (approval === undefined) return refusal(404, `There is no approval ${JSON.stringify(id)}. List the approvals waiting for you to find its ID.`);
  if (actor.kind === "agent") return refusal(403, "Agents can't decide approvals, their own included. The agent's sponsor decides.");
  if (approval.approver !== actor.id) return refusal(403, "Only the approver can decide this approval. The agent's sponsor is its approver.");
  return approval;
}

/** The answer to a decision: the approval as decided, or 409 if another decision came first. */
async function decided(deployment: Deployment, decide: () => Promise<Approval>, statusCode: number) {
  try {
    return { statusCode, body: (await withOriginal(deployment, await decide())) satisfies components["schemas"]["Approval"] };
  } catch (error) {
    if (error instanceof AlreadyDecided) return refusal(409, `The approval was already ${error.approval.state}, so it can't be decided again.`);
    throw error;
  }
}

/** The approval with the message its draft replies to, if it is a reply and the mailbox still has it. */
async function withOriginal(deployment: Deployment, approval: Approval): Promise<Approval> {
  if (approval.draft.answers === undefined) return approval;
  const original = await findMessage(deployment.table, deployment.mailBucket, approval.mailbox, approval.draft.answers);
  return approvalOf(approval, original?.message);
}

const noDraft = (event: Parameters<OperationHandler>[0]) =>
  refusal(404, `The mailbox has no draft ${JSON.stringify(event.pathParameters?.draft ?? "")}. List its drafts to find one.`);
