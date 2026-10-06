// Settings, each group on a sheet of its own: the organization's, which admins choose for everyone,
// then the human's own preferences, which only they choose, then a sponsor's agents'.
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import type { DuvaClient } from "@duva/client";
import type { components } from "@duva/openapi";
import { AgentSettingsSheet } from "./agent-settings.tsx";
import { datesFor, type Preferences } from "./dates.ts";
import { strings } from "./strings.ts";

type OrganizationSettings = components["schemas"]["OrganizationSettings"];

type Read<Values> = { status: "loading" } | { status: "failed"; message: string } | { status: "read"; values: Values };
type Saving = { status: "idle" } | { status: "saving" } | { status: "saved" } | { status: "failed"; message: string };
type Answer<Values> = Promise<{ data?: Values; response: Response }>;

/** What a sheet says when Duva can't read or save its values. */
interface SheetCopy {
  failed: (status: number) => string;
  unreachable: string;
  saveFailed: (status: number) => string;
  saveUnreachable: string;
}

interface SheetState<Values> {
  read: Read<Values>;
  /** The values as chosen, once they are read. */
  chosen?: Values;
  choose(changes: Partial<Values>): void;
  saving: Saving;
  save(): Promise<void>;
  load(): Promise<void>;
  /** Whether every choice is as saved, so there is nothing to save. */
  unchanged: boolean;
}

/**
 * A sheet's values as Duva has them, and as the human chooses them until they save. `read` and
 * `write` call Duva, and `onSaved` hears of what Duva saved.
 */
function useSheet<Values extends object>({
  read: readValues,
  write,
  copy,
  onSaved,
  onSignedOut,
}: {
  read: () => Answer<Values>;
  write: (values: Values) => Answer<Values>;
  copy: SheetCopy;
  onSaved?: (values: Values) => void;
  onSignedOut: () => void;
}): SheetState<Values> {
  const [read, setRead] = useState<Read<Values>>({ status: "loading" });
  const [chosen, setChosen] = useState<Values>();
  const [saving, setSaving] = useState<Saving>({ status: "idle" });

  // A sheet reads once when it opens, with the call it was first given.
  const first = useRef({ readValues, copy });
  const load = useCallback(async () => {
    const { readValues, copy } = first.current;
    setRead({ status: "loading" });
    const { data, response } = await readValues().catch(() => ({ data: undefined, response: undefined }));
    if (response?.status === 401) return onSignedOut();
    if (data === undefined) return setRead({ status: "failed", message: response === undefined ? copy.unreachable : copy.failed(response.status) });
    setRead({ status: "read", values: data });
    setChosen(data);
  }, [onSignedOut]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (chosen === undefined) return;
    setSaving({ status: "saving" });
    const { data, response } = await write(chosen).catch(() => ({ data: undefined, response: undefined }));
    if (response?.status === 401) return onSignedOut();
    if (data === undefined) return setSaving({ status: "failed", message: response === undefined ? copy.saveUnreachable : copy.saveFailed(response.status) });
    setRead({ status: "read", values: data });
    setSaving({ status: "saved" });
    onSaved?.(data);
  };

  const choose = (changes: Partial<Values>) => {
    setChosen((current) => (current === undefined ? current : { ...current, ...changes }));
    setSaving({ status: "idle" });
  };

  const unchanged = read.status !== "read" || chosen === undefined || Object.entries(chosen).every(([name, value]) => read.values[name as keyof Values] === value);
  return { read, chosen, choose, saving, save, load, unchanged };
}

/** The settings view. Every human can read the organization's settings, but only an admin changes them. */
export function Settings({
  client,
  admin,
  email,
  onPreferences,
  onSignedOut,
}: {
  client: DuvaClient;
  admin: boolean;
  email: string;
  onPreferences: (preferences: Preferences) => void;
  onSignedOut: () => void;
}) {
  useEffect(() => {
    document.title = strings.title(strings.settings.title);
  }, []);

  return (
    <main className="desk">
      <div className="desk-head">
        <h1 tabIndex={-1} className="view-title">
          {strings.settings.title}
        </h1>
      </div>
      <OrganizationSheet client={client} admin={admin} onSignedOut={onSignedOut} />
      <YouSheet client={client} onPreferences={onPreferences} onSignedOut={onSignedOut} />
      <AgentSettingsSheet client={client} email={email} onSignedOut={onSignedOut} />
    </main>
  );
}

function OrganizationSheet({ client, admin, onSignedOut }: { client: DuvaClient; admin: boolean; onSignedOut: () => void }) {
  const sheet = useSheet<OrganizationSettings>({
    read: () => client.GET("/organization/settings"),
    write: (settings) => client.PATCH("/organization/settings", { body: settings }),
    copy: strings.settings,
    onSignedOut,
  });
  const copy = strings.settings.erasure;
  return (
    <Sheet id="organization-settings" name={strings.settings.organization} lead={strings.settings.organizationLead} sheet={sheet}>
      {(chosen) => (
        <>
          <fieldset disabled={!admin}>
            <legend>{copy.legend}</legend>
            <p className="setting-lead">{copy.lead}</p>
            {([false, true] as const).map((value) => (
              <Choice
                key={String(value)}
                name="erasureErasesApprovals"
                checked={chosen.erasureErasesApprovals === value}
                onChoose={() => sheet.choose({ erasureErasesApprovals: value })}
                label={value ? copy.erase : copy.keep}
                hint={value ? copy.eraseHint : copy.keepHint}
              />
            ))}
          </fieldset>
          {admin ? <SaveRow sheet={sheet} saved={strings.settings.saved} /> : <p className="setting-foot">{strings.settings.onlyAdmins}</p>}
        </>
      )}
    </Sheet>
  );
}

const hourCycles: Preferences["hourCycle"][] = ["locale", "h12", "h23"];
const dateFormats: Preferences["dateFormat"][] = ["locale", "iso", "dayMonth", "monthDay"];
const mailViews: Preferences["mailView"][] = ["html", "text"];

/** The human's own preferences: how times and dates show, each choice with an example built from today, and how mail shows. */
function YouSheet({ client, onPreferences, onSignedOut }: { client: DuvaClient; onPreferences: (preferences: Preferences) => void; onSignedOut: () => void }) {
  const sheet = useSheet<Preferences>({
    read: () => client.GET("/preferences"),
    write: (preferences) => client.PATCH("/preferences", { body: preferences }),
    copy: {
      failed: strings.settings.preferencesFailed,
      unreachable: strings.settings.preferencesUnreachable,
      saveFailed: strings.settings.preferencesSaveFailed,
      saveUnreachable: strings.settings.preferencesSaveUnreachable,
    },
    onSaved: onPreferences,
    onSignedOut,
  });
  // Today in the afternoon, so 12- and 24-hour time differ.
  const today = new Date();
  today.setHours(14, 30, 0, 0);
  const copy = strings.settings;
  return (
    <Sheet id="your-preferences" name={copy.you} lead={copy.youLead} sheet={sheet}>
      {(chosen) => (
        <>
          <fieldset>
            <legend>{copy.hourCycle.legend}</legend>
            <p className="setting-lead">{copy.hourCycle.lead}</p>
            <div className="choices-short">
              {hourCycles.map((hourCycle) => (
                <Choice
                  key={hourCycle}
                  name="hourCycle"
                  checked={chosen.hourCycle === hourCycle}
                  onChoose={() => sheet.choose({ hourCycle })}
                  label={copy.hourCycle[hourCycle]}
                  hint={datesFor({ ...chosen, hourCycle }).clock(today)}
                />
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>{copy.dateFormat.legend}</legend>
            <p className="setting-lead">{copy.dateFormat.lead}</p>
            <div className="choices-short">
              {dateFormats.map((dateFormat) => (
                <Choice
                  key={dateFormat}
                  name="dateFormat"
                  checked={chosen.dateFormat === dateFormat}
                  onChoose={() => sheet.choose({ dateFormat })}
                  label={copy.dateFormat[dateFormat]}
                  hint={datesFor({ ...chosen, dateFormat }).date(today)}
                />
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>{copy.mailView.legend}</legend>
            <p className="setting-lead">{copy.mailView.lead}</p>
            {mailViews.map((mailView) => (
              <Choice
                key={mailView}
                name="mailView"
                checked={chosen.mailView === mailView}
                onChoose={() => sheet.choose({ mailView })}
                label={copy.mailView[mailView]}
                hint={copy.mailView[`${mailView}Hint`]}
              />
            ))}
          </fieldset>
          <SaveRow sheet={sheet} saved={copy.preferencesSaved} />
        </>
      )}
    </Sheet>
  );
}

/** A sheet: its name and who chooses what's on it, then its settings once they are read. */
function Sheet<Values extends object>({ id, name, lead, sheet, children }: { id: string; name: string; lead: string; sheet: SheetState<Values>; children: (chosen: Values) => ReactNode }) {
  return (
    <section className="settings" aria-labelledby={id} aria-busy={sheet.read.status === "loading"}>
      <div className="settings-head">
        <h2 id={id}>{name}</h2>
        <p>{lead}</p>
      </div>
      {sheet.read.status === "failed" ? (
        <div className="notice notice-alert failed-listing" role="alert">
          <p>{sheet.read.message}</p>
          <button type="button" className="button button-small" onClick={() => void sheet.load()}>
            {strings.inbox.retry}
          </button>
        </div>
      ) : (
        sheet.read.status === "read" &&
        sheet.chosen !== undefined && (
          <form
            className="setting"
            onSubmit={(event) => {
              event.preventDefault();
              void sheet.save();
            }}
          >
            {children(sheet.chosen)}
            {sheet.saving.status === "failed" && (
              <p className="notice notice-alert" role="alert">
                {sheet.saving.message}
              </p>
            )}
          </form>
        )
      )}
    </section>
  );
}

function Choice({ name, checked, onChoose, label, hint }: { name: string; checked: boolean; onChoose: () => void; label: string; hint: string }) {
  return (
    <label className="choice">
      <input type="radio" name={name} checked={checked} onChange={onChoose} />
      <span className="choice-text">
        <span className="choice-name">{label}</span>
        <span className="hint">{hint}</span>
      </span>
    </label>
  );
}

/** Save, which waits until a choice differs from what is saved, and "Saved" beside it once it is. */
function SaveRow<Values extends object>({ sheet, saved }: { sheet: SheetState<Values>; saved: string }) {
  return (
    <div className="setting-foot">
      <button type="submit" className="button button-primary" disabled={sheet.unchanged || sheet.saving.status === "saving"}>
        {sheet.saving.status === "saving" ? strings.settings.saving : strings.settings.save}
      </button>
      <p role="status" className="setting-saved">
        {sheet.saving.status === "saved" ? saved : ""}
      </p>
    </div>
  );
}
