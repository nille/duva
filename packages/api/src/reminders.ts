// Remind me: an actor sets a thread aside until a time, and it comes back to the top of the Inbox.
// The API asks EventBridge Scheduler, as the sender does for send limits, to invoke the sender
// with the thread at that time, and the sender brings it back if it is still set aside until then.
import { createHash } from "node:crypto";
import type { SchedulerClient } from "@aws-sdk/client-scheduler";
import { type components, presetAt, reminderPresets, soonestReminder } from "@duva/openapi";
import { jsonBody, type OperationHandler, refusal } from "./api.ts";
import { mailboxFor } from "./access.ts";
import { scheduleOnce, type ScheduleGroup } from "./limits.ts";
import { endReminders, setThreadsAside, threadsSetAside } from "./mail.ts";
import { listing, noThread, threadsGiven } from "./mailboxes.ts";
import type { Actor } from "./organization.ts";
import { timeZoneNamed, timeZoneOf } from "./preferences.ts";

type Preset = components["schemas"]["ReminderPreset"];

/** What the sender is invoked with when a thread's time comes: the thread, and the time it was set aside until. */
export interface ReminderDue {
  mailbox: string;
  thread: string;
  at: string;
}

/** The event that invokes the sender when a reminder is due. */
export interface RemindEvent {
  remind: ReminderDue;
}

/** Has the sender handed a thread when its reminder is due. EventBridge Scheduler's, or a stand-in in tests. */
export interface Reminders {
  remindAt(due: ReminderDue): Promise<void>;
}

/**
 * One-time schedules in the sender's schedule group. A schedule's name holds the thread and the
 * second, so asking twice for the same time makes one. Changing a reminder leaves the old schedule
 * to run, and the sender finds the thread no longer set aside until then.
 */
export function eventBridgeReminders(scheduler: SchedulerClient, schedule: ScheduleGroup): Reminders {
  return {
    async remindAt(due) {
      // A schedule's name is at most 64 characters, so the thread is named by a hash.
      const thread = createHash("sha256").update(`${due.mailbox}#${due.thread}`).digest("hex").slice(0, 32);
      await scheduleOnce(scheduler, schedule, { name: (second) => `remind-${thread}-${second}`, at: new Date(due.at), input: { remind: due } satisfies RemindEvent });
    },
  };
}

const whenGiven = "Give at, the time the threads come back, or preset: laterToday, tomorrowMorning or nextWeek.";

export const remindThreads: OperationHandler = async (event, deployment, actor) => {
  const mailbox = await mailboxFor(event, deployment, actor!, "organize");
  if ("statusCode" in mailbox) return mailbox;
  const body = jsonBody(event);
  const threads = threadsGiven(body);
  if ("statusCode" in threads) return threads;
  if ((body?.at === undefined) === (body?.preset === undefined)) return refusal(400, whenGiven);
  let at: Date;
  if (body!.at !== undefined) {
    const given = body!.at;
    at = new Date(typeof given === "string" ? given : NaN);
    if (typeof given !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d+)?)?(Z|[+-]\d\d:\d\d)$/i.test(given) || Number.isNaN(at.getTime())) {
      return refusal(400, `${JSON.stringify(given)} isn't a time. Give at as an ISO 8601 date and time with its offset, such as 2026-10-08T08:00:00+02:00.`);
    }
    if (at.getTime() < Date.now() + soonestReminder) return refusal(400, "That time is less than a minute from now. Give a later one.");
  } else {
    const preset = body!.preset as Preset;
    if (!reminderPresets.includes(preset)) return refusal(400, `${JSON.stringify(preset)} isn't a preset. Give preset as laterToday, tomorrowMorning or nextWeek.`);
    let timeZone: string | undefined;
    if (body!.timeZone !== undefined) {
      timeZone = timeZoneNamed(body!.timeZone);
      if (timeZone === undefined) return refusal(400, `${JSON.stringify(body!.timeZone)} isn't a time zone. Give timeZone as an IANA name, such as Europe/Stockholm.`);
    }
    at = presetAt(preset, new Date(), timeZone ?? (await timeZoneFor(deployment.table, actor!)));
  }
  // Scheduled first, so a thread is never set aside without the schedule that brings it back. A
  // schedule for a thread left as it was finds it not due, and does nothing.
  const until = new Date(Math.floor(at.getTime() / 1000) * 1000).toISOString();
  for (const thread of threads) await deployment.reminders.remindAt({ mailbox: mailbox.id, thread, at: until });
  const set = await setThreadsAside(deployment.table, { mailbox: mailbox.id, threads, at, by: actor!.id });
  if ("missing" in set) return noThread(set.missing);
  if ("hidden" in set) {
    return refusal(
      409,
      set.hidden.length === 1
        ? `The thread ${JSON.stringify(set.hidden[0])} is in Spam or Trash, or waits in the Screener, so it can't be set aside, and no thread was. Move it to the Inbox first.`
        : `The threads ${set.hidden.map((id) => JSON.stringify(id)).join(", ")} are in Spam or Trash, or wait in the Screener, so they can't be set aside, and no thread was. Move them to the Inbox first.`,
    );
  }
  return { statusCode: 200, body: set satisfies components["schemas"]["ThreadList"] };
};

export const cancelReminders: OperationHandler = async (event, deployment, actor) => {
  const mailbox = await mailboxFor(event, deployment, actor!, "organize");
  if ("statusCode" in mailbox) return mailbox;
  const threads = threadsGiven(jsonBody(event));
  if ("statusCode" in threads) return threads;
  const cancelled = await endReminders(deployment.table, { mailbox: mailbox.id, threads, by: actor!.id });
  if ("missing" in cancelled) return noThread(cancelled.missing);
  return { statusCode: 200, body: cancelled satisfies components["schemas"]["ThreadList"] };
};

export const listReminders = listing(threadsSetAside);

/** The time zone presets count in for the actor: a human's preference, an agent's sponsor's, or UTC. */
async function timeZoneFor(table: Parameters<typeof timeZoneOf>[0], actor: Actor): Promise<string> {
  return (await timeZoneOf(table, actor.kind === "human" ? actor.id : actor.sponsor)) ?? "UTC";
}
