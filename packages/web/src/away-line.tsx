// What the status strip says while the human's away message is on (#155), a link to it on
// Preferences. Apart from the sheet, which Settings loads only when first opened.
import type { components } from "@duva/openapi";
import { useDates } from "./dates.ts";
import { strings } from "./strings.ts";

export type AwayMessage = components["schemas"]["AwayMessage"];

/** Where the away message's sheet is. */
const awayHref = "#/settings/you";

/** What the status strip says while the away message is on: until the last day, from the first, or that the human is away. */
export function AwayLine({ away }: { away: AwayMessage | undefined }) {
  const { date } = useDates();
  if (away === undefined || !away.on) return null;
  // A day at noon is that day in any time zone the browser is in.
  const at = (day: string) => date(new Date(`${day}T12:00:00`), true);
  const said = away.lastDay === undefined ? strings.away.strip.away : away.away ? strings.away.strip.until(at(away.lastDay)) : strings.away.strip.from(at(away.firstDay!));
  return (
    <a href={awayHref} className="strip-away">
      {said}
    </a>
  );
}
