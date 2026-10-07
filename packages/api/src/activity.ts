// An agent's activity: its daily summaries, and each day's timeline. Both come from change feeds,
// read whole each time: those of the agent's mailboxes, its sponsor's for what concerns the agent,
// and the organization's for changes to it or by it, with the alerts about it its sponsor got. So
// they reach back to the agent's start and need no storage of their own.
import type { components } from "@duva/openapi";
import { type OperationHandler, refusal } from "./api.ts";
import { alertTimes } from "./alerting.ts";
import type { Table } from "./deployment.ts";
import { findDraft } from "./drafting.ts";
import { changesPerPage } from "./feed.ts";
import { mailboxChanges } from "./mail.ts";
import { type Actor, type Agent, findActor, organizationChanges, ownedMailboxes } from "./organization.ts";
import { timeZoneNamed, timeZoneOf } from "./preferences.ts";

type Change = components["schemas"]["MailboxChange"] | components["schemas"]["OrganizationChange"];
type Summary = components["schemas"]["ActivitySummary"];

/** A change in the agent's activity, with the mailbox whose feed recorded it, unless the organization's did. */
interface Entry {
  mailbox?: string;
  change: Change;
  /** Where it sorts among the activity's entries, by time and then by feed and position. */
  key: string;
}

/** How many days one read of the summaries covers at most. */
const daysAtMost = 367;
/** How many days the summaries cover unless the call says. */
const defaultDays = 30;
/** How many entries one page of a timeline lists at most. */
const entriesPerPage = 100;

/** The changes Duva counts as organizing, when the agent makes them. */
const organizing = new Set<Change["type"]>(["threadRead", "threadUnread", "threadLabelsChanged", "reminderSet", "reminderCancelled", "labelCreated", "labelRenamed", "labelDeleted"]);
/** The changes Duva counts as screening, when the agent makes them. */
const screening = new Set<Change["type"]>(["senderScreened", "screenedSenderRemoved", "screenerSwitched"]);

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

/** Every entry in the agent's activity, in no particular order. */
async function activityOf(table: Table, agent: Agent): Promise<Entry[]> {
  const [own, sponsors] = await Promise.all([ownedMailboxes(table, agent.id), ownedMailboxes(table, agent.sponsor)]);
  const ownIds = new Set(own.map(({ id }) => id));
  const entries: Entry[] = [];
  const add = (mailbox: string | undefined, change: Change) =>
    entries.push({ mailbox, change, key: `${change.at}|${mailbox ?? "organization"}|${String(change.position).padStart(12, "0")}` });
  // A change to the agent's settings is in each of its sponsor's mailboxes, or each of its own,
  // with the same time and actor, and counts once.
  const settingsChanged = new Set<string>();
  const once = (change: Change) => {
    if (change.type !== "agentSettingsChanged") return true;
    const copy = `${change.at}|${change.actor}|${change.agent}`;
    if (settingsChanged.has(copy)) return false;
    settingsChanged.add(copy);
    return true;
  };
  const feeds = await Promise.all([
    ...[...own, ...sponsors].map(({ id }) => wholeFeed(async (after) => (await mailboxChanges(table, id, after, true)).changes)),
    wholeFeed((after) => organizationChanges(table, after)),
  ]);
  const organization = feeds.pop()!;
  [...own, ...sponsors].forEach(({ id }, index) => {
    const changes = feeds[index]!;
    if (ownIds.has(id)) {
      // The organization's feed has each pause once, where its mailboxes' have it once each.
      for (const change of changes) if (change.type !== "agentPaused" && change.type !== "agentUnpaused" && once(change)) add(id, change);
      return;
    }
    // In its sponsor's mailbox: what the agent did, its drafts' lives, and changes to the agent.
    const drafts = new Set(changes.filter((change) => change.type === "draftWritten" && change.actor === agent.id).map((change) => field(change, "draft")));
    for (const change of changes) {
      const concerns = ("actor" in change && change.actor === agent.id) || field(change, "agent") === agent.id || drafts.has(field(change, "draft"));
      if (concerns && once(change)) add(id, change);
    }
  });
  for (const change of organization) {
    const about = [field(change, "agent"), (field(change, "added") as Actor | undefined)?.id, (field(change, "removed") as Actor | undefined)?.id, field(change, "from")];
    const mailbox = field(change, "mailbox");
    const itsMailbox = typeof mailbox === "string" ? ownIds.has(mailbox) : (mailbox as { owner?: string } | undefined)?.owner === agent.id;
    if (field(change, "actor") === agent.id || about.includes(agent.id) || itsMailbox) add(undefined, change);
  }
  return entries;
}

/** The day an instant is on in the time zone, as YYYY-MM-DD. */
function dayIn(timeZone: string): (at: string) => string {
  const format = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  return (at) => {
    const parts = Object.fromEntries(format.formatToParts(new Date(at)).map(({ type, value }) => [type, value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  };
}

/** The day as a count of days since 1970-01-01, or undefined if it isn't a day written as YYYY-MM-DD. */
function dayNumber(day: string): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return undefined;
  const at = Date.parse(`${day}T00:00:00Z`);
  return Number.isNaN(at) || new Date(at).toISOString().slice(0, 10) !== day ? undefined : at / 86_400_000;
}

const dayOfNumber = (number: number) => new Date(number * 86_400_000).toISOString().slice(0, 10);

/** The agent the call's path names, if the actor may read its activity, and the time zone the call's days are in. */
async function activityAsked(
  event: Parameters<OperationHandler>[0],
  table: Table,
  actor: Actor,
): Promise<{ agent: Agent; timeZone: string } | ReturnType<typeof refusal>> {
  const id = event.pathParameters?.agent ?? "";
  const agent = await findActor(table, id);
  if (agent?.kind !== "agent") return refusal(404, `There is no agent ${JSON.stringify(id)}. List the agents you sponsor to find its ID.`);
  if (actor.id !== agent.sponsor && !actor.admin) return refusal(403, "Only the agent's sponsor and admins can read its activity. Ask its sponsor.");
  const asked = event.queryStringParameters?.timeZone;
  if (asked !== undefined) {
    const timeZone = timeZoneNamed(asked);
    if (timeZone === undefined) return refusal(400, `${JSON.stringify(asked)} isn't a time zone. Give timeZone as an IANA name, such as Europe/Stockholm.`);
    return { agent, timeZone };
  }
  return { agent, timeZone: (actor.kind === "human" ? await timeZoneOf(table, actor.id) : undefined) ?? "UTC" };
}

export const getAgentActivity: OperationHandler = async (event, deployment, actor) => {
  const asked = await activityAsked(event, deployment.table, actor!);
  if ("statusCode" in asked) return asked;
  const { agent, timeZone } = asked;
  const day = dayIn(timeZone);
  const query = event.queryStringParameters ?? {};
  for (const name of ["from", "to"] as const) {
    if (query[name] !== undefined && dayNumber(query[name]) === undefined) return refusal(400, `${JSON.stringify(query[name])} isn't a day. Give ${name} as YYYY-MM-DD.`);
  }
  const to = query.to === undefined ? dayNumber(day(new Date().toISOString()))! : dayNumber(query.to)!;
  const from = query.from === undefined ? to - defaultDays + 1 : dayNumber(query.from)!;
  if (from > to) return refusal(400, "The first day, from, is after the last, to. Give them the other way round.");
  if (to - from + 1 > daysAtMost) return refusal(400, `Ask for at most ${daysAtMost} days at once.`);

  const days = new Map<string, Summary>();
  for (let number = to; number >= from; number--) {
    const summary = { day: dayOfNumber(number), sent: 0, approved: 0, rejected: 0, received: 0, organized: 0, screened: 0, alerts: 0 };
    days.set(summary.day, summary);
  }
  for (const { change } of await activityOf(deployment.table, agent)) {
    const summary = days.get(day(change.at));
    if (summary === undefined) continue;
    const byAgent = "actor" in change && change.actor === agent.id;
    if (change.type === "messageSent" && byAgent) summary.sent++;
    else if (change.type === "approvalDecided") summary[change.decision]++;
    else if (change.type === "messageReceived") summary.received++;
    else if (organizing.has(change.type) && byAgent) summary.organized++;
    else if (screening.has(change.type) && byAgent) summary.screened++;
  }
  // No time zone is more than 14 hours ahead of UTC, so the first day starts after midnight UTC the day before.
  for (const at of await alertTimes(deployment.table, agent.sponsor, agent.id, `${dayOfNumber(from - 1)}T00:00:00.000Z`)) {
    const summary = days.get(day(at));
    if (summary !== undefined) summary.alerts++;
  }
  return { statusCode: 200, body: { timeZone, days: [...days.values()] } satisfies components["schemas"]["ActivitySummaries"] };
};

/**
 * The fields of a change in a mailbox that say nothing of what its mail says, which an admin who
 * isn't the sponsor reads. Any other field is left out, so a field added later stays out until
 * it is listed here.
 */
const mailFree = new Set(["position", "at", "actor", "type", "thread", "message", "draft", "approval", "decision", "label", "added", "removed", "spam", "screened", "agent", "before", "after", "on", "letIn", "outcome", "status", "feedback"]);
/** The fields of what SES reported about a send that say nothing of its recipients. */
const feedbackFree = new Set(["kind", "at", "reason"]);

/** The change without what its mail says. SES's reason for refusing a send can name its recipients, so it goes too. */
function withoutMail(change: Change): Change {
  const kept = Object.fromEntries(Object.entries(change).filter(([name]) => mailFree.has(name)));
  if (kept.feedback !== undefined) kept.feedback = Object.fromEntries(Object.entries(kept.feedback as object).filter(([name]) => feedbackFree.has(name)));
  if (change.type !== "sendFailed" && "reason" in change) kept.reason = change.reason;
  return kept as unknown as Change;
}

/** Where a page of a timeline starts, from the next of the page before, or undefined if no page gives that. */
function startOf(after: string): string | undefined {
  const key = Buffer.from(after, "base64url").toString();
  return /^\d{4}-\d{2}-\d{2}T[^|]+\|[^|]+\|\d{12}$/.test(key) ? key : undefined;
}

export const getAgentActivityDay: OperationHandler = async (event, deployment, actor) => {
  const asked = await activityAsked(event, deployment.table, actor!);
  if ("statusCode" in asked) return asked;
  const { agent, timeZone } = asked;
  const day = event.pathParameters?.day ?? "";
  if (dayNumber(day) === undefined) return refusal(400, `${JSON.stringify(day)} isn't a day. Give the day as YYYY-MM-DD.`);
  const query = event.queryStringParameters ?? {};
  const limit = query.limit ?? String(entriesPerPage);
  if (!/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > entriesPerPage) {
    return refusal(400, `${JSON.stringify(limit)} isn't a limit Duva takes. Give limit as a whole number from 1 to ${entriesPerPage}.`);
  }
  const start = query.after === undefined ? undefined : startOf(query.after);
  if (query.after !== undefined && start === undefined) {
    return refusal(400, `${JSON.stringify(query.after)} isn't where a page starts. Give after as the next of the page before, or leave it out for the first page.`);
  }

  const dayOf = dayIn(timeZone);
  const all = await activityOf(deployment.table, agent);
  const ofDay = all
    .filter(({ change, key }) => dayOf(change.at) === day && (start === undefined || key < start))
    .sort((a, b) => (a.key < b.key ? 1 : -1));
  const page = ofDay.slice(0, Number(limit));
  // A draft's thread is the one it was sent in, or the one it replies in.
  const sentIn = new Map(all.flatMap(({ mailbox, change }) => (change.type === "messageSent" ? [[`${mailbox}|${change.draft}`, change.thread]] : [])));
  const sponsor = actor!.id === agent.sponsor;
  const entries = await Promise.all(
    page.map(async ({ mailbox, change }) => {
      const draft = field(change, "draft") as string | undefined;
      const thread =
        (field(change, "thread") as string | undefined) ??
        (mailbox === undefined || draft === undefined ? undefined : (sentIn.get(`${mailbox}|${draft}`) ?? (await findDraft(deployment.table, mailbox, draft))?.thread));
      return {
        ...(mailbox !== undefined && { mailbox }),
        ...(thread !== undefined && { thread }),
        change: sponsor || mailbox === undefined ? change : withoutMail(change),
      };
    }),
  );
  const next = ofDay.length > page.length ? Buffer.from(page.at(-1)!.key).toString("base64url") : undefined;
  return { statusCode: 200, body: { day, timeZone, entries, ...(next !== undefined && { next }) } satisfies components["schemas"]["ActivityTimeline"] };
};
