// What each event in an agent's activity says, in one line: who did it, then what happened. These
// are the words the web app's activity shows and the CLI gives. For an admin who isn't the sponsor,
// the change comes without what the mail says, as names, notes and addresses, so the line does too.
import type { components } from "@duva/openapi";

type Change = components["schemas"]["MailboxChange"] | components["schemas"]["OrganizationChange"];
type Alert = components["schemas"]["Alert"];
type Model = components["schemas"]["MailboxAgentModel"];

/** Who the line names: `who` the actor of the change, or the human who asked in a turn of Ask Coo, `agent` the agent's name, and `you` whether `who` is the reader. */
export interface Named {
  who: string;
  agent: string;
  you: boolean;
}

/** A message a line names, as its mailbox keeps it: who sent it, to whom, and the address it reached. */
export interface MessageNamed {
  from: string;
  to: string[];
  recipient: string;
}

export const models: Record<Model, string> = {
  "anthropic.claude-sonnet-5-5": "Claude Sonnet 5.5",
  "anthropic.claude-haiku-4-5-20251001-v1:0": "Claude Haiku 4.5",
  "anthropic.claude-opus-5-5": "Claude Opus 5.5",
  "amazon.nova-2-lite-v1:0": "Amazon Nova 2 Lite",
  "amazon.nova-pro-v1:0": "Amazon Nova Pro",
  "amazon.nova-lite-v1:0": "Amazon Nova Lite",
};

export const handoverWhy: Record<components["schemas"]["Handover"]["reason"], string> = {
  decided: "it looked like more than a quick question",
  writing: "it came to writing mail that may be sent",
  failedCalls: "Duva refused two of the first model's steps",
  stepBudget: "the first model hadn't finished after 6 steps",
  askedForHelp: "the first model asked for help",
  answerCheck: "the first model's answer didn't hold up",
};

/** Why an unsubscribe didn't work, as a line says it in parentheses. */
const unsubscribeWhy: Record<components["schemas"]["UnsubscribeReason"], string> = {
  noMail: "there's no mail from them",
  spam: "all their mail is spam",
  noOneClick: "their mail offers no one-click unsubscribe",
  notSigned: "their unsubscribe header isn't signed",
  notAllowed: "their link isn't a web page Duva opens",
  notPublic: "their link's server isn't on the internet",
  unreachable: "their server couldn't be reached",
  timedOut: "their server didn't answer in time",
  refused: "their server refused",
  tooManyRedirects: "their link redirected too many times",
  notDone: "the page didn't unsubscribe",
  notSent: "the request couldn't be sent",
  ownDomain: "their mail comes from the organization's own domain, which is never bounced",
  notDmarc: "their mail didn't pass DMARC",
  noEnvelopeSender: "Duva doesn't know where their bounces go",
  tooLate: "their newest mail is more than 24 hours old, so their next message is bounced as it arrives",
  notBounceable: "their mail didn't pass DMARC, or has nowhere to bounce to",
};

/** What an alert of each kind is about, as an admin who isn't the sponsor reads it, without what the alert said. */
const alertAbout: Record<Alert["kind"], string> = {
  sendFailed: "a send failed",
  bounced: "a message bounced",
  complained: "a recipient complained",
  limitReached: "its sends wait for the send limits",
  pausedBy: "it was paused",
  limitsChangedBy: "its limits were lowered",
  removedBy: "it was removed",
  keyUsedWhilePaused: "its key was used while it is paused",
  autoPaused: "Duva paused it",
  spendCapReached: "it stopped at the spend cap",
  taskFailed: "a task failed",
};

/** Why the agent didn't bounce a sender's mail, as the sender's sheet says it too. SES's words, when it refused, are the sponsor's alone. */
function whyNotBounced(change: Extract<Change, { type: "unsubscribeAttempted" }>, agent: string): string {
  switch (change.reason) {
    case "ownDomain":
      return "It comes from the organization's own domain, which is never bounced.";
    case "notDmarc":
      return "It didn't pass DMARC.";
    case "noEnvelopeSender":
      return "Duva doesn't know where their bounces go.";
    case "tooLate":
      return `Their newest mail is more than 24 hours old, so ${agent} bounces their next message as it arrives.`;
    case "refused":
      return change.detail === undefined ? "SES refused." : `SES refused: ${change.detail}`;
    default:
      return "It didn't pass DMARC, or has nowhere to bounce to.";
  }
}

/** The names in a list as a sentence lists them: "A", "A and B", "A, B and C". */
const list = (names: string[]) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

/** The line of an alert: what it said, for its sponsor, or for anyone else, whom it went to and what it was about. */
export const alertSaid = (alert: Alert, reader: { sponsor: true } | { sponsor: false; sponsorName: string }) =>
  reader.sponsor ? alert.what : `Duva alerted ${reader.sponsorName} that ${alertAbout[alert.kind]}.`;

/** What a change in the agent's activity says, in one line. */
export function changeSaid(change: Change, { who, agent, you }: Named, message?: MessageNamed): string {
  const sender = (screened: { address?: string; domain?: string }) => screened.address ?? (screened.domain === undefined ? "a sender" : `everyone at ${screened.domain}`);
  // "Hermes's message", "your message".
  const whose = you ? "your" : `${who}'s`;
  switch (change.type) {
    case "messageReceived": {
      const from = message?.from ?? "Someone";
      const wrote = `${from} wrote to ${message?.recipient ?? agent}`;
      if (change.spam) return `${wrote}, and it went to Spam.`;
      if (change.screened === "waiting") return `${wrote}, and it waits in the Screener.`;
      if (change.screened === "blocked") return `${from}, a blocked sender, wrote to ${message?.recipient ?? agent}, so it went to Trash.`;
      if (change.delivered === "feed") return `${wrote}, and it went to the Feed.`;
      if (change.delivered === "paperTrail") return `${wrote}, and it went to the Paper Trail.`;
      if (change.delivered === "label") return `${wrote}, and it was filed under a label.`;
      return `${wrote}.`;
    }
    case "messageDropped":
      return `Duva dropped a message from ${change.address ?? "a sender whose mail goes nowhere"}.`;
    case "draftWritten":
      return `${who} started a draft.`;
    case "draftChanged":
      return `${who} changed a draft.`;
    case "draftDeleted":
      return `${who} deleted a draft.`;
    case "sendAsked":
      return `${who} sent a draft.`;
    case "approvalAsked":
      return `${who} asked for approval to send.`;
    case "approvalWithdrawn":
      return `Duva withdrew ${agent}'s request for approval.`;
    case "approvalUndone":
      return `${who} undid the approval of ${agent}'s send, so it waits again.`;
    case "approvalDecided": {
      if (change.decision === "rejected") return change.note === undefined ? `${who} rejected ${agent}'s send.` : `${who} rejected ${agent}'s send: “${change.note}”`;
      const edited = change.edits === undefined ? [] : Object.keys(change.edits).map((field) => ({ to: "the recipients", subject: "the subject", text: "the text" })[field] ?? field);
      return edited.length === 0 ? `${who} approved ${agent}'s send.` : `${who} approved ${agent}'s send, changing ${list(edited)}.`;
    }
    case "messageSent":
      return `Duva sent ${whose} message${message === undefined || message.to.length === 0 ? "" : ` to ${list(message.to)}`}.`;
    case "sendWaitingForLimit":
      return `Duva holds a message until ${agent}'s send limits allow it.`;
    case "sentNow":
      return `${who} sent a waiting message now, past the limits.`;
    case "sendFailed":
      return change.reason === undefined ? `Amazon SES refused to send ${whose} message.` : `Amazon SES refused to send ${whose} message: ${change.reason}`;
    case "sendUnclear":
      return `Duva stopped sending ${whose} message before Amazon SES answered.`;
    case "feedbackReceived": {
      const recipients = change.feedback.recipients === undefined || change.feedback.recipients.length === 0 ? undefined : list(change.feedback.recipients);
      const to = recipients === undefined ? "" : ` for ${recipients}`;
      return {
        hardBounce: `Amazon SES reported that a message bounced${to}.`,
        softBounce: `Amazon SES reported that a message bounced for now${to}.`,
        complaint: `Amazon SES reported that ${recipients ?? "a recipient"} marked a message as spam.`,
        reject: "Amazon SES didn't send a message after all.",
      }[change.feedback.kind];
    }
    case "threadRead":
      return `${who} marked a thread read.`;
    case "threadUnread":
      return `${who} marked a thread unread.`;
    case "threadLabelsChanged":
      if (change.added.includes("trash")) return `${who} moved a thread to Trash.`;
      if (change.added.includes("spam")) return `${who} marked a thread as spam.`;
      if (change.removed.includes("trash")) return `${who} restored a thread from Trash.`;
      if (change.removed.includes("spam")) return `${who} marked a thread as not spam.`;
      if (change.added.includes("inbox")) return `${who} moved a thread to the Inbox.`;
      if (change.removed.includes("inbox") && change.added.length === 0) return `${who} archived a thread.`;
      return `${who} changed a thread's labels.`;
    case "reminderSet":
      return `${who} set a thread aside in Remind me.`;
    case "reminderCancelled":
      return `${who} brought a thread back from Remind me.`;
    case "threadBack":
      return "A thread came back from Remind me.";
    case "labelCreated":
      return change.name === undefined ? `${who} created a label.` : `${who} created the label ${change.name}.`;
    case "labelRenamed":
      return change.name === undefined ? `${who} renamed a label.` : `${who} renamed a label to ${change.name}.`;
    case "labelDeleted":
      return `${who} deleted a label.`;
    case "labelPromptSet":
      return `${who} gave a label a prompt for ${agent}.`;
    case "labelPromptRemoved":
      return `${who} removed a label's prompt.`;
    case "taskGiven":
      return who === "Duva" ? `Duva, filing a sender's mail under a label with a prompt, gave ${agent} a task.` : `${who} added a label with a prompt, which gave ${agent} a task.`;
    case "taskStarted":
      return `${who} started a task.`;
    case "conversationTurn": {
      // A turn names the human who asked, then what they asked. How it went follows unless it simply answered.
      const asked = change.asked === undefined ? `${who} asked ${agent} something` : `${who} asked ${agent} “${change.asked}”`;
      if (change.outcome === "failed") return `${asked}, and it couldn't answer.`;
      if (change.outcome === "capReached") return `${asked}, and it stopped at the spend cap.`;
      if (change.drafts.length > 0) return `${asked}, and it wrote ${change.drafts.length === 1 ? "a draft" : `${change.drafts.length} drafts`}.`;
      return change.asked === undefined ? `${asked}.` : asked;
    }
    case "agentHandedOver":
      return `${who} handed ${change.task === undefined ? "a turn" : "a task"} to ${models[change.handover.to]}, since ${handoverWhy[change.handover.reason]}.`;
    case "taskEnded":
      if (change.outcome === "done") return change.note === undefined ? `${who} finished a task.` : `${who} finished a task: “${change.note}”`;
      return change.note === undefined ? `${who} couldn't finish a task.` : `${who} couldn't finish a task: “${change.note}”`;
    case "threadErased":
      return change.actor !== undefined ? `${who} erased a thread for good, emptying Trash.` : "Duva erased a thread for good, after the retention period.";
    case "agentSettingsChanged":
      return `${who} changed ${agent}'s settings.`;
    case "agentPaused":
      return `${who} paused ${agent}.`;
    case "agentUnpaused":
      return `${who} unpaused ${agent}.`;
    case "senderScreened":
      return change.decision === "letIn" ? `${who} let in ${sender(change)}.` : `${who} blocked ${sender(change)}.`;
    case "screenedSenderRemoved":
      return `${who} removed the decision on ${sender(change)}.`;
    case "senderDeliveryRemoved":
      return `${who} removed where mail from ${sender(change)} goes, so they're first-time again.`;
    case "senderDeliverySet": {
      const to = { inbox: "the Inbox", feed: "the Feed", paperTrail: "the Paper Trail", label: "a label", nowhere: "nowhere" }[change.delivery];
      return `${who} sent mail from ${sender(change)} to ${to}.`;
    }
    case "screenerSwitched":
      return change.on ? `${who} switched the Screener on.` : `${who} switched the Screener off.`;
    case "unsubscribeAttempted": {
      const from = sender(change);
      const why = change.reason === undefined ? "" : ` (${unsubscribeWhy[change.reason]})`;
      if (change.method === "page" || change.method === "link") {
        const where = change.method === "page" ? "their opt-out page" : "the link in their mail";
        return change.outcome === "unsubscribed" ? `${who} unsubscribed from ${from} on ${where}.` : `${who} couldn't unsubscribe from ${from} on ${where}${why}.`;
      }
      if (change.method === "mailto") return change.outcome === "requested" ? `${who} mailed the unsubscribe address of ${from}.` : `${who} couldn't mail the unsubscribe address of ${from}${why}.`;
      if (change.method === "bounce") return change.outcome === "bounced" ? `${who} bounced mail from ${from}, so their list sees the address as gone.` : `${who} couldn't bounce mail from ${from}. ${whyNotBounced(change, agent)}`;
      return change.outcome === "unsubscribed" ? `Duva unsubscribed from ${from}.` : `Duva couldn't unsubscribe from ${from}${why}.`;
    }
    case "agentKeyRotated":
      return `${who} rotated ${agent}'s key.`;
    case "mailboxAdded":
      return change.mailbox.defaultAddress === undefined ? `${who} added a mailbox.` : `${who} added a mailbox at ${change.mailbox.defaultAddress}.`;
    case "addressAdded":
      return `${who} added the address ${change.address}.`;
    case "addressRemoved":
      return `${who} removed the address ${change.address}.`;
    case "actorAdded":
      return `${who} added ${change.added.kind === "agent" ? `the agent ${change.added.name}` : change.added.email}.`;
    case "actorRemoved":
      return `${who} removed ${change.removed.kind === "agent" ? `the agent ${change.removed.name}` : change.removed.email}.`;
    // Kinds Duva no longer records, such as an agent admin's setup changes, still read from old feeds.
    default:
      return `${who} changed the organization's setup.`;
  }
}
