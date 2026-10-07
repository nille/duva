import type { components } from "@duva/openapi";
import { jsonBody, type OperationHandler, refusal } from "./api.ts";
import { isEmailAddress } from "./email-address.ts";
import type { Deployment } from "./deployment.ts";
import {
  addDraft,
  AgentPaused,
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
  DraftMovedOn,
  draftsIn,
  draftToSend,
  findApproval,
  findDraft,
  NoRecipient,
  NotUndoable,
  NotWaitingForLimit,
  pendingApprovals,
  reject,
  SendNotAllowed,
  sendNow,
  maxNote,
  undo,
  unsendableFrom,
} from "./drafting.ts";
import { attachmentLinks } from "./attachments.ts";
import { fromStanding, groupsSentAsBy } from "./group-mail.ts";
import { pendingSetupApprovals } from "./setup.ts";
import { findMessage } from "./mail.ts";
import { mailboxFor } from "./access.ts";
import { type Actor, aliasDomains, findActor, isAddressOf, type Mailbox } from "./organization.ts";

type EmailAddress = components["schemas"]["EmailAddress"];
type Message = components["schemas"]["Message"];

const maxText = 50000;
const maxSubject = 998;

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
  const chosen = body.from === undefined ? undefined : await fromGiven(deployment, mailbox, body.from);
  if (typeof chosen === "object") return chosen;
  // A reply or a forward goes from the address the original was sent to, plus tag kept, while the
  // mailbox has it, an alias domain's mirror of one of its addresses included. Group mail came to
  // the group's address, so a reply to it goes from the member's own.
  const aliases = await aliasDomains(deployment.table);
  const fromOriginal = (message: Message) => chosen ?? (isAddressOf(mailbox, message.recipient, aliases) ? message.recipient : mailbox.defaultAddress!);

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
    // A reply sent as a group leaves the group out of its recipients, as the mailbox's own addresses are.
    const others = othersThan(mailbox, aliases, chosen);
    // A reply goes to the original's sender, unless the mailbox sent it, or another member sent it
    // as a group, and then to its recipients.
    const sender = message.sentBy === undefined && message.sentAs === undefined ? others(replyTo.length > 0 ? replyTo : [message.from]) : [];
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
    content = { from: chosen ?? mailbox.defaultAddress, to: given.to ?? [], cc: given.cc ?? [], bcc: given.bcc ?? [], subject: given.subject ?? "", text: given.text ?? "" };
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

/**
 * The address given to send from, in lower case, if it is one of the mailbox's or a group its
 * owner is a member of, or else a refusal that says why not: 403 for another group.
 */
async function fromGiven(deployment: Deployment, mailbox: Mailbox, given: unknown): Promise<string | ReturnType<typeof refusal>> {
  const from = typeof given === "string" ? given.trim().toLowerCase() : "";
  if (!isEmailAddress(from)) return refusal(400, `${JSON.stringify(given)} isn't an address. Give from as one of the mailbox's addresses, like ${mailbox.defaultAddress}.`);
  const standing = await fromStanding(deployment.table, mailbox, from);
  if (standing === "notMember") return refusal(403, `Only members of ${from} can send as it. Ask an admin to add the mailbox's owner to the group.`);
  if (standing === "none") {
    return refusal(400, `${from} isn't one of the mailbox's addresses or a group its owner is a member of. Give one of ${[...mailbox.addresses, ...(await groupsSentAsBy(deployment.table, mailbox.owner))].join(", ")}.`);
  }
  return from;
}

/** Whether two addresses are the same, ignoring case. */
const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** The addresses that aren't one of the mailbox's own, with or without a plus tag, or the address it sends from, each once. */
const othersThan =
  (mailbox: Mailbox, aliases: Map<string, string>, from: string | undefined) =>
  (list: EmailAddress[]): EmailAddress[] => {
    const kept: EmailAddress[] = [];
    for (const each of list) {
      if (isAddressOf(mailbox, each.address, aliases) || sameAddress(each.address, from ?? "") || kept.some(({ address }) => sameAddress(address, each.address))) continue;
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
  const body = jsonBody(event) ?? {};
  const fields = fieldsIn(body);
  if ("statusCode" in fields) return fields;
  const from = body.from === undefined ? undefined : await fromGiven(deployment, mailbox, body.from);
  if (typeof from === "object") return from;
  const changes = { ...fields, from };
  if (Object.values(changes).every((value) => value === undefined)) return refusal(400, "Give the draft's new From, recipients, Cc, Bcc, subject or text.");
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
    if (error instanceof BeingSent) return refusal(409, "The draft is being sent, or waits for the agent's send limits, so it can't be deleted. Read it again later to see how the send went.");
    throw error;
  }
};

export const sendDraft: OperationHandler = async (event, deployment, actor) => {
  const mailbox = await mailboxFor(event, deployment, actor!, "send");
  if ("statusCode" in mailbox) return mailbox;
  const id = event.pathParameters?.draft ?? "";
  const asked = await findDraft(deployment.table, mailbox.id, id);
  if (asked !== undefined) {
    const standing = await fromStanding(deployment.table, mailbox, asked.from);
    const unsendable = unsendableFrom(standing, asked.from);
    if (unsendable !== undefined) return refusal(standing === "notMember" ? 403 : 409, unsendable);
  }
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

export const sendDraftNow: OperationHandler = async (event, deployment, actor) => {
  const mailbox = await mailboxFor(event, deployment, actor!, "read");
  if ("statusCode" in mailbox) return mailbox;
  const id = event.pathParameters?.draft ?? "";
  const draft = await draftToSend(deployment.table, mailbox.id, id);
  if (draft === undefined) return noDraft(event);
  const status = draft.send;
  const agentId = status?.approval === undefined ? status?.by : (await findApproval(deployment.table, status.approval))?.agent;
  const agent = agentId === undefined ? undefined : await findActor(deployment.table, agentId);
  if (agent?.kind === "agent" && agent.sponsor !== actor!.id) return refusal(403, "Only the agent's sponsor can send its mail now, past its send limits. Ask them to.");
  const notWaiting = refusal(409, "The draft isn't waiting for the agent's send limits, so there is nothing to send now. Read it to see where its send stands.");
  if (agent?.kind !== "agent" || status?.state !== "waitingForLimit") return notWaiting;
  try {
    const sent = await sendNow(deployment.table, { mailbox: mailbox.id, id, agent: agent.id, by: actor!.id });
    return { statusCode: 202, body: sent satisfies components["schemas"]["Draft"] };
  } catch (error) {
    if (error instanceof NotWaitingForLimit) return notWaiting;
    throw error;
  }
};

export const listApprovals: OperationHandler = async (_event, deployment, actor) => {
  const approvals = await pendingApprovals(deployment.table, actor!.id);
  return {
    statusCode: 200,
    body: {
      approvals: await Promise.all(approvals.map((approval) => withOriginal(deployment, approval))),
      setupApprovals: await pendingSetupApprovals(deployment.table, actor!.id),
    } satisfies components["schemas"]["ApprovalList"],
  };
};

const approvedRefusal = (error: AlreadyApproved) => refusal(409, `The draft ${approvedOutcomes[error.state]}, so it can't change or be sent again. Write a new draft instead.`);

// What became of an approved draft, by its send's state.
const approvedOutcomes: Partial<Record<AlreadyApproved["state"], string>> = {
  approved: "is about to be sent",
  waitingForLimit: "waits for the agent's send limits",
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

export const undoApproval: OperationHandler = async (event, deployment, actor) => {
  const approval = await decidable(event, deployment, actor!);
  if ("statusCode" in approval) return approval;
  try {
    return { statusCode: 200, body: (await withOriginal(deployment, await undo(deployment.table, { approval, by: actor!.id }))) satisfies components["schemas"]["Approval"] };
  } catch (error) {
    if (!(error instanceof NotUndoable)) throw error;
    return refusal(409, "The approval can't be undone: it isn't approved, its undo window is over, or the sender already took it. Read the draft to see where its send stands.");
  }
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
    if (error instanceof AgentPaused) return refusal(409, "The agent is paused, so its sends can't be approved. Unpause it first, or reject this with a note.");
    if (error instanceof DraftMovedOn) return refusal(409, "The agent changed the draft, deleted it or asked again since you rejected it, so it can't be sent after all. Any new request waits for you.");
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
