// Remind me's presets, as times on a time zone's clock. Kept here, beside the contract that names
// them, so the API and the web app count them alike.
import type { components } from "./schema.gen.ts";

type Preset = components["schemas"]["ReminderPreset"];

/** The presets, in the order they are offered. */
export const reminderPresets: readonly Preset[] = ["laterToday", "tomorrowMorning", "nextWeek"];

/** How soon a thread can come back at the earliest, in milliseconds. */
export const soonestReminder = 60_000;

/**
 * The time the preset gives from now, on the time zone's clock: later today three hours on, on
 * the hour after unless that is on the hour, tomorrow morning 8:00 tomorrow, and next week 8:00
 * next Monday.
 */
export function presetAt(preset: Preset, now: Date, timeZone: string): Date {
  if (preset === "laterToday") {
    const later = new Date(now.getTime() + 3 * 3_600_000);
    const clock = clockIn(later, timeZone);
    return clock.minute === 0 && clock.second === 0 ? later : onClock({ ...clock, hour: clock.hour + 1, minute: 0 }, timeZone);
  }
  const today = clockIn(now, timeZone);
  const days = preset === "tomorrowMorning" ? 1 : (8 - today.weekday) % 7 || 7;
  return onClock({ year: today.year, month: today.month, day: today.day + days, hour: 8 }, timeZone);
}

/** The time as the time zone's clock shows it, to the minute, as a date and time field holds it: 2026-10-08T08:00. */
export function clockValue(at: Date, timeZone: string): string {
  const { year, month, day, hour, minute } = clockIn(at, timeZone);
  const two = (number: number) => String(number).padStart(2, "0");
  return `${year}-${two(month)}-${two(day)}T${two(hour)}:${two(minute)}`;
}

/** The time when the time zone's clock shows the date and time a field holds, as 2026-10-08T08:00, or undefined if it holds none. */
export function fromClockValue(value: string, timeZone: string): Date | undefined {
  const [, year, month, day, hour, minute] = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)$/.exec(value)?.map(Number) ?? [];
  return year === undefined ? undefined : onClock({ year, month: month!, day: day!, hour: hour!, minute }, timeZone);
}

/** What the time zone's clock shows at the time. Weekdays count from Sunday, 0. */
function clockIn(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric", weekday: "short" }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((each) => each.type === type)!.value;
  return {
    year: Number(part("year")),
    month: Number(part("month")),
    day: Number(part("day")),
    hour: Number(part("hour")),
    minute: Number(part("minute")),
    second: Number(part("second")),
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(part("weekday")),
  };
}

/** The time when the time zone's clock shows the hour and minute of the day, which may run past the month's days or the day's hours. */
function onClock({ year, month, day, hour, minute = 0 }: { year: number; month: number; day: number; hour: number; minute?: number }, timeZone: string): Date {
  const wanted = Date.UTC(year, month - 1, day, hour, minute);
  const offset = (at: number) => {
    const clock = clockIn(new Date(at), timeZone);
    return Date.UTC(clock.year, clock.month - 1, clock.day, clock.hour, clock.minute, clock.second) - Math.floor(at / 1000) * 1000;
  };
  // The offset at the guess, then at the time it gives, which differ only across a change of clocks.
  const guess = wanted - offset(wanted);
  return new Date(wanted - offset(guess));
}
