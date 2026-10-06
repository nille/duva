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
  BeingSent,
  changeDraft,
  deleteDraft as deleteStoredDraft,
  draftsIn,
  findApproval,
  findDraft,
  NoRecipient,
  notFrom,
  pendingApprovals,
  reject,
  SendNotAllowed,
} from "./drafting.ts";
import { attachmentLinks } from "./attachments.ts";
import { findMessage } from "./mail.ts";
import { mailboxFor } from "./access.ts";
import { type Actor, isAddressOf, type Mailbox } from "./organization.ts";

type EmailAddress = components["schemas"]["EmailAddress"];
type Message = components["schemas"]["Message"];

const maxText = 50000;
const maxSubject = 998;
const maxNote = 2000;

export const createDraft: OperationHandler = async (event, deployment, actor) => {
  const mailbox = await mailboxFor(event, deployment, actor!, "draft");
  if ("statusCode" in mailbox) return mailbox;
  const body = jsonBody(event) ?? {};
  const given = fieldsIn(body);
  if ("statusCode" in given) return given;
  if (body.replyAll !== undefined && (typeof body.replyAll !== "boolean" || typeof body.answers !== "string")) {
    return refusal(400, "Give replyAll as true or false, with the ID of the message to reply to as answers.");
  }
  if (body.forwards !== undefined && (typeof body.forwards !== "string" || body.answers !== undefined)) {
    return refusal(400, "Give forwards as the ID of the message to forward, without answers. A draft replies or forwards, not both.");
  }

  if (mailbox.defaultAddress === undefined) return noAddress();
  // A reply or a forward goes from the address the original was sent to, plus tag kept, while the mailbox has it.
  const fromOriginal = (message: Message) => (isAddressOf(mailbox, message.recipient) ? message.recipient : mailbox.defaultAddress!);

  let content;
  if (typeof body.forwards === "string") {
    const original = await findMessage(deployment.table, deployment.mailBucket, mailbox.id, body.forwards);
    if (original === undefined) return refusal(404, `The mailbox has no message ${JSON.stringify(body.forwards)}. Read its threads to find the message to forward.`);
    const { message, thread } = original;
    content = {
      forwards: message.id,
      thread,
      from: fromOriginal(message),
      to: given.to ?? [],
      cc: given.cc ?? [],
      bcc: given.bcc ?? [],
      subject: given.subject ?? `Fwd: ${message.subject.replace(/^(\s*fwd?\s*:\s*)+/i, "")}`,
      text: given.text ?? forwardedText(message),
      attachments: message.attachments,
    };
  } else if (typeof body.answers === "string") {
    const original = await findMessage(deployment.table, deployment.mailBucket, mailbox.id, body.answers);
    if (original === undefined) return refusal(404, `The mailbox has no message ${JSON.stringify(body.answers)}. Read its threads to find the message to reply to.`);
    const { message, thread, replyTo } = original;
    const others = othersThan(mailbox);
    // A reply goes to the original's sender, unless the mailbox sent it, and then to its recipients.
    const sender = others(replyTo.length > 0 ? replyTo : [message.from]);
    const to = others(sender.length > 0 ? [...sender, ...(body.replyAll === true ? message.to : [])] : message.to);
    const cc = body.replyAll === true ? others(message.cc).filter(({ address }) => !to.some((each) => sameAddress(each.address, address))) : [];
    content = {
      answers: message.id,
      thread,
      from: fromOriginal(message),
      to: given.to ?? to,
      cc: given.cc ?? cc,
      bcc: given.bcc ?? [],
      subject: given.subject ?? `Re: ${message.subject.replace(/^(\s*re\s*:\s*)+/i, "")}`,
      text: given.text ?? "",
    };
  } else {
    content = { from: mailbox.defaultAddress, to: given.to ?? [], cc: given.cc ?? [], bcc: given.bcc ?? [], subject: given.subject ?? "", text: given.text ?? "" };
  }
  return { statusCode: 201, body: (await addDraft(deployment.table, { mailbox: mailbox.id, by: actor!.id, content })) satisfies components["schemas"]["Draft"] };
};

/** The text a forward starts with: room to write, then the original's header fields and its text, quoted. */
function forwardedText(message: Message): string {
  const list = (addresses: EmailAddress[]) => addresses.map(({ name, address }) => (name ? `${name} <${address}>` : address)).join(", ");
  const quoted = message.text === "" ? [] : message.text.split("\n").map((line) => (line === "" ? ">" : `> ${line}`));
  return [
    "",
    "",
    "Forwarded message",
    `From: ${list([message.from])}`,
    `Date: ${new Date(message.date).toUTCString()}`,
    `Subject: ${message.subject}`,
    ...(message.to.length > 0 ? [`To: ${list(message.to)}`] : []),
    ...(message.cc.length > 0 ? [`Cc: ${list(message.cc)}`] : []),
    "",
    ...quoted,
  ].join("\n");
}

const noAddress = () => refusal(409, "The mailbox has no address, so it can't send mail. Ask an admin to give it one.");

/** Whether two addresses are the same, ignoring case. */
const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** The addresses that aren't one of the mailbox's own, with or without a plus tag, each once. */
const othersThan =
  (mailbox: Mailbox) =>
  (list: EmailAddress[]): EmailAddress[] => {
    const kept: EmailAddress[] = [];
    for (const each of list) {
      if (isAddressOf(mailbox, each.address) || kept.some(({ address }) => sameAddress(address, each.address))) continue;
      kept.push(each);
    }
    return kept;
  };

type Fields = { to?: EmailAddress[]; cc?: EmailAddress[]; bcc?: EmailAddress[]; subject?: string; text?: string };

/** The recipients, subject and text the body gives, each checked, or why one doesn't fit. A list of recipients can be empty. */
function fieldsIn(body: Record<string, unknown>): Fields | ReturnType<typeof refusal> {
  const { subject, text } = body;
  if (text !== undefined && (typeof text !== "string" || text.length > maxText)) return refusal(400, `Give the text as at most ${maxText} characters.`);
  if (subject !== undefined && (typeof subject !== "string" || subject.length > maxSubject || /[\r\n]/.test(subject))) {
    return refusal(400, `Give the subject as one line of at most ${maxSubject} characters.`);
  }
  const fields: Fields = { subject, text };
  for (const name of ["to", "cc", "bcc"] as const) {
    const list = body[name];
    if (list === undefined) continue;
    const addresses = Array.isArray(list) ? list.map((address) => (typeof address === "string" ? address.trim() : "")) : [""];
    const wrong = addresses.find((address) => !isEmailAddress(address));
    if (wrong !== undefined) return refusal(400, `${JSON.stringify(wrong)} isn't an email address. Give each recipient's address in ${name}, like grace@example.org.`);
    fields[name] = addresses.map((address) => ({ address }));
  }
  return fields;
}

export const listDrafts: OperationHandler = async (event, deployment, actor) => {
  const mailbox = await mailboxFor(event, deployment, actor!, "read");
  if ("statusCode" in mailbox) return mailbox;
  return { statusCode: 200, body: { drafts: await draftsIn(deployment.table, mailbox.id) } satisfies components["schemas"]["DraftList"] };
};

export const getDraft: OperationHandler = async (event, deployment, actor) => {
  const mailbox = await mailboxFor(event, deployment, actor!, "read");
  if ("statusCode" in mailbox) return mailbox;
  const draft = await findDraft(deployment.table, mailbox.id, event.pathParameters?.draft ?? "");
  if (draft === undefined) return noDraft(event);
  return { statusCode: 200, body: draft satisfies components["schemas"]["Draft"] };
};

export const editDraft: OperationHandler = async (event, deployment, actor) => {
  const mailbox = await mailboxFor(event, deployment, actor!, "draft");
  if ("statusCode" in mailbox) return mailbox;
  const changes = fieldsIn(jsonBody(event) ?? {});
  if ("statusCode" in changes) return changes;
  if (Object.values(changes).every((value) => value === undefined)) return refusal(400, "Give the draft's new recipients, Cc, Bcc, subject or text.");
  try {
    const draft = await changeDraft(deployment.table, { mailbox: mailbox.id, id: event.pathParameters?.draft ?? "", by: actor!.id, changes });
    if (draft === undefined) return noDraft(event);
    return { statusCode: 200, body: draft satisfies components["schemas"]["Draft"] };
  } catch (error) {
    if (error instanceof AlreadyApproved) return approvedRefusal(error);
    throw error;
  }
};

export const deleteDraft: OperationHandler = async (event, deployment, actor) => {
  const mailbox = await mailboxFor(event, deployment, actor!, "draft");
  if ("statusCode" in mailbox) return mailbox;
  try {
    const draft = await deleteStoredDraft(deployment.table, { mailbox: mailbox.id, id: event.pathParameters?.draft ?? "", by: actor!.id });
    if (draft === undefined) return noDraft(event);
    return { statusCode: 200, body: draft satisfies components["schemas"]["Draft"] };
  } catch (error) {
    if (error instanceof BeingSent) return refusal(409, "The draft is being sent, so it can't be deleted yet. Read it again in a moment to see how the send went.");
    throw error;
  }
};

export const sendDraft: OperationHandler = async (event, deployment, actor) => {
  const mailbox = await mailboxFor(event, deployment, actor!, "send");
  if ("statusCode" in mailbox) return mailbox;
  const id = event.pathParameters?.draft ?? "";
  const asked = await findDraft(deployment.table, mailbox.id, id);
  if (asked !== undefined && !isAddressOf(mailbox, asked.from)) return refusal(409, notFrom(asked.from));
  try {
    const draft = await askToSend(deployment.table, { mailbox, id, actor: actor! });
    if (draft === undefined) return noDraft(event);
    return { statusCode: 202, body: draft satisfies components["schemas"]["Draft"] };
  } catch (error) {
    // The agent's sponsor lowered its access since it was checked, so it is checked again to say what's missing.
    if (error instanceof SendNotAllowed) {
      const refused = await mailboxFor(event, deployment, actor!, "send");
      return "statusCode" in refused ? refused : refusal(409, "Your sponsor changed your sponsor access while you asked to send. Ask again.");
    }
    if (error instanceof NoRecipient) return refusal(400, "The draft has no recipient in To, so it can't be sent. Give it one, then send it.");
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

const approvedRefusal = (error: AlreadyApproved) => refusal(409, `The draft ${approvedOutcomes[error.state]}, so it can't change or be sent again. Write a new draft instead.`);

// What became of an approved draft, by its send's state.
const approvedOutcomes: Partial<Record<AlreadyApproved["state"], string>> = {
  approved: "is about to be sent",
  sending: "is being sent",
  sent: "was sent",
  unclear: "may have been sent, which a human checks",
};

export const sendApproval: OperationHandler = async (event, deployment, actor) => {
  const approval = await decidable(event, deployment, actor!);
  if ("statusCode" in approval) return approval;
  const given = fieldsIn(jsonBody(event) ?? {});
  if ("statusCode" in given) return given;
  if (given.to?.length === 0) return refusal(400, "Give at least one recipient. Give each recipient's address, like grace@example.org.");
  if (given.cc !== undefined || given.bcc !== undefined) return refusal(400, "An approver changes the recipients in To, the subject and the text. Give those, or reject the draft with a note to change its Cc or Bcc.");
  const edits = { to: given.to, subject: given.subject, text: given.text };
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
  const original = await findMessage(deployment.table, deployment.mailBucket, approval.mailbox, approval.draft.answers, attachmentLinks(deployment, approval.mailbox));
  return approvalOf(approval, original?.message);
}

const noDraft = (event: Parameters<OperationHandler>[0]) =>
  refusal(404, `The mailbox has no draft ${JSON.stringify(event.pathParameters?.draft ?? "")}. List its drafts to find one.`);
