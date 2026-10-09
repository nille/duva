// An agent's activity: one list of its events, newest first, across days, each opening into all that
// was recorded on it. The events come from change feeds, read whole each time: those of its sponsor's
// mailboxes for what concerns the agent, and the organization's for changes to it or by it, with
// the alerts about it its sponsor got. So they reach back to the agent's start and need no storage
// of their own. A mailbox agent's are those of the mailbox agents merged into it too (ADR-0033).
import type { components } from "@duva/openapi";
import { alertSaid, changeSaid, type MessageNamed } from "./activity-words.ts";
import { type OperationHandler, refusal } from "./api.ts";
import { actorNamed, alertsAbout } from "./alerting.ts";
import type { Table } from "./deployment.ts";
import { findDraft } from "./drafting.ts";
import { mergedInto } from "./mailbox-agents.ts";
import { changesPerPage } from "./feed.ts";
import { mailboxChanges, storedMessage } from "./mail.ts";
import { type Actor, type Agent, duva, findActor, isAdmin, organizationChanges, ownedMailboxes } from "./organization.ts";
import { threadTasks } from "./tasks.ts";

type Change = components["schemas"]["MailboxChange"] | components["schemas"]["OrganizationChange"];
type Alert = components["schemas"]["Alert"];
type Kind = components["schemas"]["AgentEventKind"];
type AgentEvent = components["schemas"]["AgentEvent"];

/** An event in the agent's activity: a change, with the mailbox whose feed recorded it unless the organization's did, or an alert. */
type Entry = ({ mailbox?: string; change: Change } | { alert: Alert }) & {
  id: string;
  /** Where it sorts among the activity's events, by time and then by feed and position. */
  key: string;
  kind: Kind;
  failed: boolean;
};

/** How many events one page lists at most, and unless the call says. */
const eventsAtMost = 100;
const eventsPerPage = 50;

/** The kind of each change in an agent's activity. A change of a type not listed is setup. */
const kinds: Partial<Record<Change["type"], Kind>> = {
  conversationTurn: "conversations",
  labelPromptSet: "tasks",
  labelPromptRemoved: "tasks",
  taskGiven: "tasks",
  taskStarted: "tasks",
  taskEnded: "tasks",
  agentHandedOver: "tasks",
  messageReceived: "draftsAndSends",
  draftWritten: "draftsAndSends",
  draftChanged: "draftsAndSends",
  draftDeleted: "draftsAndSends",
  sendAsked: "draftsAndSends",
  messageSent: "draftsAndSends",
  sendFailed: "draftsAndSends",
  sendUnclear: "draftsAndSends",
  feedbackReceived: "draftsAndSends",
  approvalAsked: "approvals",
  approvalWithdrawn: "approvals",
  approvalDecided: "approvals",
  approvalUndone: "approvals",
  threadRead: "organizing",
  threadUnread: "organizing",
  threadLabelsChanged: "organizing",
  reminderSet: "organizing",
  reminderCancelled: "organizing",
  threadBack: "organizing",
  labelCreated: "organizing",
  labelRenamed: "organizing",
  labelDeleted: "organizing",
  threadErased: "organizing",
  senderScreened: "screening",
  screenedSenderRemoved: "screening",
  senderDeliverySet: "screening",
  senderDeliveryRemoved: "screening",
  screenerSwitched: "screening",
  messageDropped: "screening",
  unsubscribeAttempted: "unsubscribes",
  agentPaused: "pausesAndLimits",
  agentUnpaused: "pausesAndLimits",
  agentSettingsChanged: "pausesAndLimits",
  sendWaitingForLimit: "pausesAndLimits",
  sentNow: "pausesAndLimits",
};
const allKinds: Kind[] = ["conversations", "tasks", "draftsAndSends", "approvals", "organizing", "screening", "unsubscribes", "pausesAndLimits", "alerts", "setup"];

/** Whether the change failed: a send SES refused, bounced, didn't send after all or never answered, a turn or a task that couldn't finish, or an unsubscribe that didn't work. */
function failedOf(change: Change): boolean {
  switch (change.type) {
    case "sendFailed":
    case "sendUnclear":
      return true;
    case "feedbackReceived":
      // A complaint is the recipient's word on mail that arrived, and a soft bounce may yet arrive.
      return change.feedback.kind === "hardBounce" || change.feedback.kind === "reject";
    case "taskEnded":
      return change.outcome === "failed";
    case "conversationTurn":
      return change.outcome !== "answered";
    case "unsubscribeAttempted":
      return change.outcome === "notOffered" || change.outcome === "failed";
    default:
      return false;
  }
}

/** The changes of kinds Duva no longer records, from when agents could be admins (ADR-0030), which are no part of activity. */
const retired = new Set<Change["type"]>(["agentAdminChanged", "setupAsked", "setupApproved", "setupRejected", "setupWithdrawn"]);

/** Every change in a feed, read a page at a time from the start. */
async function wholeFeed<Read extends { position: number }>(read: (after: number) => Promise<Read[]>): Promise<Read[]> {
  const all: Read[] = [];
  for (;;) {
    const page = await read(all.at(-1)?.position ?? 0);
    all.push(...page);
    if (page.length < changesPerPage) return all;
  }
}

const field = (change: Change, name: string) => (change as unknown as Record<string, unknown>)[name];

/** The agent and the mailbox agents merged into it, whose events are its own. */
async function selves(table: Table, agent: Agent): Promise<Set<string>> {
  return new Set([agent.id, ...(agent.mailboxAgent ? await mergedInto(table, agent.id) : [])]);
}

/** Every event in the agent's activity, newest first. */
async function activityOf(table: Table, agent: Agent): Promise<Entry[]> {
  const sponsors = await ownedMailboxes(table, agent.sponsor);
  const ids = await selves(table, agent);
  const entries: Entry[] = [];
  const add = (mailbox: string | undefined, change: Change) => {
    const feed = mailbox ?? "organization";
    entries.push({ mailbox, change, id: `${feed}:${change.position}`, key: `${change.at}|${feed}|${String(change.position).padStart(12, "0")}`, kind: kinds[change.type] ?? "setup", failed: failedOf(change) });
  };
  // A change to the agent's settings is in each of its sponsor's mailboxes, with the same time and
  // actor, and counts once.
  const settingsChanged = new Set<string>();
  const once = (change: Change) => {
    if (change.type !== "agentSettingsChanged") return true;
    const copy = `${change.at}|${change.actor}|${change.agent}`;
    if (settingsChanged.has(copy)) return false;
    settingsChanged.add(copy);
    return true;
  };
  const [organization, alerts, ...feeds] = await Promise.all([
    wholeFeed((after) => organizationChanges(table, after)),
    Promise.all([...ids].map((id) => alertsAbout(table, agent.sponsor, id))).then((each) => each.flat()),
    ...sponsors.map(({ id }) => wholeFeed(async (after) => (await mailboxChanges(table, id, after, true)).changes)),
  ]);
  sponsors.forEach(({ id }, index) => {
    const changes = feeds[index]!;
    // What the agent did, its drafts' lives, and changes to the agent.
    const drafts = new Set(changes.filter((change) => change.type === "draftWritten" && ids.has(change.actor!)).map((change) => field(change, "draft")));
    for (const change of changes) {
      const concerns = ("actor" in change && ids.has(change.actor!)) || ids.has(field(change, "agent") as string) || drafts.has(field(change, "draft"));
      // A turn of Ask Coo keeps its handover, so the handover isn't an event of its own, and a merge is the organization's.
      const counted = !(change.type === "agentHandedOver" && change.task === undefined) && change.type !== "mailboxAgentsMerged";
      if (concerns && counted && once(change)) add(id, change);
    }
  });
  for (const change of organization) {
    if (retired.has(change.type)) continue;
    const about = [field(change, "agent"), (field(change, "added") as Actor | undefined)?.id, (field(change, "removed") as Actor | undefined)?.id] as (string | undefined)[];
    if (ids.has(field(change, "actor") as string) || about.some((id) => id !== undefined && ids.has(id))) add(undefined, change);
  }
  for (const alert of alerts) entries.push({ alert, id: `alert:${alert.id}`, key: `${alert.at}|alert|${alert.id}`, kind: "alerts", failed: false });
  return entries.sort((a, b) => (a.key < b.key ? 1 : -1));
}

/**
 * The IDs of the events that wait for the agent's sponsor: each approval's newest change, while it
 * asks or was undone, so the send waits again, and each alert they haven't seen.
 */
function waitingForSponsor(entries: Entry[]): Set<string> {
  const settled = new Set<string>();
  const waiting = new Set<string>();
  // Newest first, so the first change of an approval met is its newest.
  for (const entry of entries) {
    if ("alert" in entry) {
      if (!entry.alert.seen) waiting.add(entry.id);
      continue;
    }
    const approval = field(entry.change, "approval") as string | undefined;
    if (approval === undefined || entry.kind !== "approvals" || settled.has(approval)) continue;
    settled.add(approval);
    if (entry.change.type === "approvalAsked" || entry.change.type === "approvalUndone") waiting.add(entry.id);
  }
  return waiting;
}

/** The agent the call's path names, if the actor may read its activity. */
async function activityAsked(event: Parameters<OperationHandler>[0], table: Table, actor: Actor): Promise<Agent | ReturnType<typeof refusal>> {
  const id = event.pathParameters?.agent ?? "";
  const agent = await findActor(table, id);
  if (agent?.kind !== "agent") return refusal(404, `There is no agent ${JSON.stringify(id)}. List the agents you sponsor to find its ID.`);
  if (actor.id !== agent.sponsor && !isAdmin(actor)) return refusal(403, "Only the agent's sponsor and admins can read its activity. Ask its sponsor.");
  return agent;
}

/**
 * The fields of a change in a mailbox that say nothing of what its mail says, which an admin who
 * isn't the sponsor reads. Any other field is left out, so a field added later stays out until
 * it is listed here.
 */
const mailFree = new Set(["position", "at", "actor", "type", "task", "thread", "message", "draft", "approval", "decision", "label", "added", "removed", "spam", "screened", "delivery", "delivered", "agent", "before", "after", "on", "letIn", "outcome", "status", "feedback", "human", "threads", "drafts", "models", "handover", "harder", "cost", "method", "until", "setAsideAt", "allMailboxes", "merged"]);
/** The fields of what SES reported about a send that say nothing of its recipients. */
const feedbackFree = new Set(["kind", "at", "reason"]);
/** The fields of a handover that say nothing of the mail, as what the everyday model said in asking for help can. */
const handoverFree = new Set(["reason", "from", "to"]);

/** The change without what its mail says. SES's reason for refusing a send can name its recipients, so it goes too. */
function withoutMail(change: Change): Change {
  const kept = Object.fromEntries(Object.entries(change).filter(([name]) => mailFree.has(name)));
  if (kept.feedback !== undefined) kept.feedback = Object.fromEntries(Object.entries(kept.feedback as object).filter(([name]) => feedbackFree.has(name)));
  if (kept.handover !== undefined) kept.handover = Object.fromEntries(Object.entries(kept.handover as object).filter(([name]) => handoverFree.has(name)));
  if (change.type !== "sendFailed" && "reason" in change) kept.reason = change.reason;
  return kept as unknown as Change;
}

/** Where a page starts, from the next of the page before, or undefined if no page gives that. */
function startOf(after: string): string | undefined {
  const key = Buffer.from(after, "base64url").toString();
  return /^\d{4}-\d{2}-\d{2}T[^|]+\|[^|]+\|[^|]+$/.test(key) ? key : undefined;
}

/**
 * What the reader reads of the activity's events: each change as they may read it, with its thread,
 * a task's note for the sponsor, and the line it says, its actors named as the reader knows them.
 */
function reading(table: Table, agent: Agent, reader: Actor, all: Entry[], ids: Set<string>) {
  const sponsor = reader.id === agent.sponsor;
  const waiting = sponsor ? waitingForSponsor(all) : new Set<string>();
  const names = new Map<string, Promise<string>>();
  const nameOf = (id: string) => {
    if (ids.has(id)) return Promise.resolve(agent.name);
    if (id === reader.id) return Promise.resolve("You");
    if (!names.has(id)) names.set(id, actorNamed(table, id));
    return names.get(id)!;
  };
  // A draft's thread is the one it was sent in, or the one it replies in.
  const sentIn = new Map(all.flatMap((entry) => ("change" in entry && entry.change.type === "messageSent" ? [[`${entry.mailbox}|${entry.change.draft}`, entry.change.thread]] : [])));
  return async (entry: Entry) => {
    const base = { id: entry.id, kind: entry.kind, failed: entry.failed, needsYou: waiting.has(entry.id) };
    if ("alert" in entry) {
      const { alert } = entry;
      const summary = alertSaid(alert, sponsor ? { sponsor: true } : { sponsor: false, sponsorName: await nameOf(agent.sponsor) });
      const event: AgentEvent = { ...base, at: alert.at, type: "alert", actor: duva, ...(alert.mailbox !== undefined && { mailbox: alert.mailbox }), summary };
      return { event, detail: { ...event, ...(alert.mailbox !== undefined && { mailbox: alert.mailbox }), ...(alert.thread !== undefined && { thread: alert.thread }), ...(sponsor && { alert }) } };
    }
    const { mailbox, change: recorded } = entry;
    const draft = field(recorded, "draft") as string | undefined;
    const thread =
      (field(recorded, "thread") as string | undefined) ??
      (mailbox === undefined || draft === undefined ? undefined : (sentIn.get(`${mailbox}|${draft}`) ?? (await findDraft(table, mailbox, draft))?.thread));
    // A task's note is kept with its thread, so the sponsor reads it there.
    const note = sponsor && recorded.type === "taskEnded" && mailbox !== undefined ? (await threadTasks(table, mailbox, recorded.thread)).find(({ id }) => id === recorded.task)?.note : undefined;
    const change = sponsor || mailbox === undefined ? { ...recorded, ...(note !== undefined && { note }) } : withoutMail(recorded);
    const actor = field(recorded, "actor") as string | undefined;
    // A turn names the human who asked it.
    const named = recorded.type === "conversationTurn" ? recorded.human : actor;
    const who = named === undefined ? "Duva" : await nameOf(named);
    const messageId = field(recorded, "message") as string | undefined;
    const message = sponsor && mailbox !== undefined && messageId !== undefined ? await storedMessage(table, mailbox, messageId) : undefined;
    const said: MessageNamed | undefined = message && { from: message.from.name ?? message.from.address, to: message.to.map(({ name, address }) => name ?? address), recipient: message.recipient };
    const summary = changeSaid(change, { who, agent: agent.name, you: named === reader.id }, said);
    // A turn asked from All mailboxes happened in none of them.
    const inMailbox = mailbox !== undefined && !(recorded.type === "conversationTurn" && recorded.allMailboxes === true) ? mailbox : undefined;
    const event: AgentEvent = { ...base, at: recorded.at, type: recorded.type, ...(actor !== undefined && { actor }), ...(inMailbox !== undefined && { mailbox: inMailbox }), summary };
    return { event, detail: { ...event, ...(mailbox !== undefined && { mailbox }), ...(thread !== undefined && { thread }), change } };
  };
}

export const listAgentEvents: OperationHandler = async (event, deployment, actor) => {
  const agent = await activityAsked(event, deployment.table, actor!);
  if ("statusCode" in agent) return agent;
  const query = event.queryStringParameters ?? {};
  const asked = query.kinds === undefined ? undefined : query.kinds.split(",");
  const unknown = asked?.find((kind) => !allKinds.includes(kind as Kind));
  if (unknown !== undefined) return refusal(400, `${JSON.stringify(unknown)} isn't a kind of event. Give kinds from ${allKinds.join(", ")}.`);
  if (query.failed !== undefined && query.failed !== "true" && query.failed !== "false") return refusal(400, `${JSON.stringify(query.failed)} isn't true or false. Give failed as true, or leave it out.`);
  const limit = query.limit ?? String(eventsPerPage);
  if (!/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > eventsAtMost) {
    return refusal(400, `${JSON.stringify(limit)} isn't a limit Duva takes. Give limit as a whole number from 1 to ${eventsAtMost}.`);
  }
  const start = query.after === undefined ? undefined : startOf(query.after);
  if (query.after !== undefined && start === undefined) {
    return refusal(400, `${JSON.stringify(query.after)} isn't where a page starts. Give after as the next of the page before, or leave it out for the first page.`);
  }

  const all = await activityOf(deployment.table, agent);
  const chosen = all.filter(
    ({ key, kind, failed }) => (start === undefined || key < start) && (asked === undefined || asked.includes(kind)) && (query.failed !== "true" || failed),
  );
  const page = chosen.slice(0, Number(limit));
  const read = reading(deployment.table, agent, actor!, all, await selves(deployment.table, agent));
  const events = await Promise.all(page.map(async (entry) => (await read(entry)).event));
  const next = chosen.length > page.length ? Buffer.from(page.at(-1)!.key).toString("base64url") : undefined;
  return { statusCode: 200, body: { events, ...(next !== undefined && { next }) } satisfies components["schemas"]["AgentEventPage"] };
};

export const getAgentEvent: OperationHandler = async (event, deployment, actor) => {
  const agent = await activityAsked(event, deployment.table, actor!);
  if ("statusCode" in agent) return agent;
  const id = event.pathParameters?.event ?? "";
  const all = await activityOf(deployment.table, agent);
  const entry = all.find((each) => each.id === id);
  if (entry === undefined) return refusal(404, `${agent.name} has no event ${JSON.stringify(id)}. List its events to find its ID.`);
  const { detail } = await reading(deployment.table, agent, actor!, all, await selves(deployment.table, agent))(entry);
  return { statusCode: 200, body: detail satisfies components["schemas"]["AgentEventDetail"] };
};
