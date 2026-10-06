// How the web app shows times and dates: as the browser's language does, unless the human chose an
// hour cycle or a date format of their own in Settings. Month names always follow the browser's language.
import { createContext, useContext, useMemo } from "react";
import type { components } from "@duva/openapi";

export type Preferences = components["schemas"]["Preferences"];

/** The preferences a human has until they choose otherwise, and until theirs are read. */
export const defaultPreferences: Preferences = { hourCycle: "locale", dateFormat: "locale", mailView: "html" };

/** The signed-in human's preferences, which every time and date on the page follows. */
export const PreferencesContext = createContext<Preferences>(defaultPreferences);

export interface Dates {
  /** The time alone. */
  clock(date: Date): string;
  /** The date alone, with its year, or without it when `short` and it is this year's. */
  date(date: Date, short?: boolean): string;
  /** The time alone for today, or the day and time otherwise. */
  when(date: Date): string;
  /** The time alone for today, or else the day alone, as a listing shows it. */
  day(date: Date): string;
  /** The date with its year and the time, as a tooltip shows them. */
  full(date: Date): string;
}

/** How times and dates show with the preferences. */
export function datesFor({ hourCycle, dateFormat }: Preferences): Dates {
  // 12-hour time reads as 2:30 PM, and 24-hour time as 09:05.
  const hours: Intl.DateTimeFormatOptions = hourCycle === "locale" ? { hour: "2-digit" } : { hour: hourCycle === "h12" ? "numeric" : "2-digit", hourCycle };
  const clock = (date: Date) => date.toLocaleTimeString(undefined, { ...hours, minute: "2-digit" });
  const isToday = (date: Date) => date.toDateString() === new Date().toDateString();
  const withYear = (date: Date, short: boolean) => !short || date.getFullYear() !== new Date().getFullYear();
  const date = (date: Date, short = false) => {
    const year = withYear(date, short) ? date.getFullYear() : undefined;
    if (dateFormat === "locale") return date.toLocaleDateString(undefined, { day: "numeric", month: "short", ...(year !== undefined && { year: "numeric" }) });
    if (dateFormat === "iso") {
      const monthDay = `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      return year === undefined ? monthDay : `${year}-${monthDay}`;
    }
    const month = date.toLocaleDateString(undefined, { month: "short" });
    if (dateFormat === "dayMonth") return year === undefined ? `${date.getDate()} ${month}` : `${date.getDate()} ${month} ${year}`;
    return year === undefined ? `${month} ${date.getDate()}` : `${month} ${date.getDate()}, ${year}`;
  };
  // An ISO date and its time read as one timestamp, the others as a date, then a time.
  const dateAndTime = (on: string, at: string) => (dateFormat === "iso" ? `${on} ${at}` : `${on}, ${at}`);
  return {
    clock,
    date,
    when(at) {
      if (isToday(at)) return clock(at);
      if (dateFormat === "locale") return at.toLocaleString(undefined, { day: "numeric", month: "short", ...(withYear(at, true) && { year: "numeric" }), ...hours, minute: "2-digit" });
      return dateAndTime(date(at, true), clock(at));
    },
    day: (at) => (isToday(at) ? clock(at) : date(at, true)),
    full(at) {
      if (dateFormat === "locale") return at.toLocaleString(undefined, hourCycle === "locale" ? undefined : { hourCycle });
      return dateAndTime(date(at), clock(at));
    },
  };
}

/** How times and dates show for the signed-in human. */
export function useDates(): Dates {
  const preferences = useContext(PreferencesContext);
  return useMemo(() => datesFor(preferences), [preferences]);
}
