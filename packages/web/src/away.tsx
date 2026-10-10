// The human's away message (#155) on Preferences: one switch for all their mailboxes, the days
// they're away or until they switch it off, the replies' subject, and each mailbox's text. The
// status strip's line is away-line.tsx's, so the strip loads none of Settings.
import { useRef } from "react";
import type { DuvaClient } from "@duva/client";
import type { components } from "@duva/openapi";
import { Choice } from "./setting-parts.tsx";
import { SaveRow, Sheet, useSheet } from "./settings.tsx";
import { strings } from "./strings.ts";

type AwayMessage = components["schemas"]["AwayMessage"];

/** The sheet's values: the switch, whether it has days and which, the subject, and each mailbox's text, empty for none. */
interface Chosen {
  on: boolean;
  days: boolean;
  firstDay: string;
  lastDay: string;
  subject: string;
  texts: Record<string, string>;
  /** Each mailbox's address, as Duva gave it, which names its text. */
  addresses: Record<string, string>;
}

const chosenOf = (away: AwayMessage): Chosen => ({
  on: away.on,
  days: away.firstDay !== undefined,
  firstDay: away.firstDay ?? "",
  lastDay: away.lastDay ?? "",
  subject: away.subject ?? "",
  texts: Object.fromEntries(away.mailboxes.map(({ mailbox, text }) => [mailbox, text ?? ""])),
  addresses: Object.fromEntries(away.mailboxes.map(({ mailbox, address }) => [mailbox, address])),
});

/** Today in the browser, as a date field holds it. */
const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

/** Why the chosen values can't be saved, if they can't. */
function invalidOf(chosen: Chosen): string | undefined {
  const copy = strings.away;
  if (chosen.on && Object.values(chosen.texts).every((text) => text.trim() === "")) return copy.needsText;
  if (!chosen.days) return undefined;
  if (chosen.firstDay === "" || chosen.lastDay === "") return copy.needsDays;
  if (chosen.lastDay < chosen.firstDay) return copy.backwards;
  if (chosen.lastDay < today()) return copy.passed;
  return undefined;
}

export function AwaySheet({ client, onAway, onSignedOut }: { client: DuvaClient; onAway: (away: AwayMessage) => void; onSignedOut: () => void }) {
  const copy = strings.away;
  // The texts as Duva has them, so saving sends only those changed.
  const saved = useRef<Record<string, string>>({});
  const read = (data: AwayMessage | undefined) => {
    if (data === undefined) return undefined;
    const chosen = chosenOf(data);
    saved.current = chosen.texts;
    return chosen;
  };
  const sheet = useSheet<Chosen>({
    read: async () => {
      const { data, response } = await client.GET("/away-message");
      return { data: read(data), response };
    },
    // Only the texts changed are sent. Switching off goes first, so removing the last text never
    // meets a switch still on, and switching on last, once there is a text.
    write: async (chosen) => {
      const texts = Object.entries(chosen.texts).filter(([mailbox, text]) => text !== saved.current[mailbox]).map(([mailbox, text]) => () => client.PATCH("/away-message", { body: { mailbox, text: text.trim() === "" ? null : text } }));
      const rest = () =>
        client.PATCH("/away-message", {
          body: { on: chosen.on, firstDay: chosen.days ? chosen.firstDay : null, lastDay: chosen.days ? chosen.lastDay : null, subject: chosen.subject.trim() === "" ? null : chosen.subject },
        });
      let answer: Awaited<ReturnType<typeof rest>> | undefined;
      for (const call of chosen.on ? [...texts, rest] : [rest, ...texts]) {
        answer = await call();
        if (answer.data === undefined) return { response: answer.response };
      }
      onAway(answer!.data!);
      return { data: read(answer!.data!), response: answer!.response };
    },
    copy,
    onSignedOut,
  });
  return (
    <Sheet id="away" name={copy.title} lead={copy.lead} sheet={sheet}>
      {(chosen) => {
        const invalid = invalidOf(chosen);
        return (
          <>
            <fieldset className="away-switch">
              <legend>{copy.switchLegend}</legend>
              <div className="switch">
                {([true, false] as const).map((on) => (
                  <label key={String(on)}>
                    <input type="radio" name="away-on" checked={chosen.on === on} onChange={() => sheet.choose({ on })} />
                    <span>{on ? copy.on : copy.off}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend>{copy.whenLegend}</legend>
              <p className="setting-lead">{copy.whenLead}</p>
              <Choice name="away-days" checked={!chosen.days} onChoose={() => sheet.choose({ days: false })} label={copy.untilOff} hint={copy.untilOffHint} />
              <Choice name="away-days" checked={chosen.days} onChoose={() => sheet.choose({ days: true })} label={copy.onDays} hint={copy.onDaysHint} />
              {chosen.days && (
                <div className="away-days">
                  <label className="setting-field">
                    {copy.firstDay}
                    <input type="date" value={chosen.firstDay} min={today()} onChange={(event) => sheet.choose({ firstDay: event.target.value })} />
                  </label>
                  <label className="setting-field">
                    {copy.lastDay}
                    <input type="date" value={chosen.lastDay} min={chosen.firstDay || today()} onChange={(event) => sheet.choose({ lastDay: event.target.value })} />
                  </label>
                </div>
              )}
            </fieldset>
            <fieldset>
              <legend>{copy.subjectLegend}</legend>
              <p className="setting-lead">{copy.subjectLead}</p>
              <label className="setting-field away-subject">
                <span className="visually-hidden">{copy.subjectLegend}</span>
                <input type="text" value={chosen.subject} maxLength={200} placeholder={copy.subjectPlaceholder} onChange={(event) => sheet.choose({ subject: event.target.value })} />
              </label>
            </fieldset>
            <fieldset>
              <legend>{copy.textsLegend}</legend>
              <p className="setting-lead">{copy.textsLead}</p>
              <ul className="away-texts">
                {Object.entries(chosen.addresses).map(([mailbox, address]) => (
                  <li key={mailbox}>
                    <label className="setting-field">
                      {copy.textFor(address)}
                      <textarea rows={4} maxLength={5000} value={chosen.texts[mailbox] ?? ""} placeholder={copy.textPlaceholder} onChange={(event) => sheet.choose({ texts: { ...chosen.texts, [mailbox]: event.target.value } })} />
                    </label>
                  </li>
                ))}
              </ul>
              <p className="hint">{copy.coo}</p>
            </fieldset>
            {invalid !== undefined && !sheet.unchanged && <p className="setting-note">{invalid}</p>}
            <SaveRow sheet={sheet} saved={copy.saved} invalid={invalid !== undefined} />
          </>
        );
      }}
    </Sheet>
  );
}
