// Settings, each group on a sheet of its own: the organization's, which admins choose for everyone,
// then for admins its domains, its mailboxes' addresses, its people and its groups, then the human's
// own preferences, which only they choose, then the Screener of their mailbox and their agents',
// then a sponsor's agents'.
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import type { DuvaClient } from "@duva/client";
import type { components } from "@duva/openapi";
import { AddressesSheet } from "./addresses.tsx";
import { AgentSettingsSheet } from "./agent-settings.tsx";
import { Choice } from "./setting-parts.tsx";
import { datesFor, type Preferences } from "./dates.ts";
import { DomainsSheet } from "./domains.tsx";
import { GroupsSheet } from "./groups.tsx";
import type { AgentMailbox } from "./mailboxes.tsx";
import { PeopleSheet } from "./people.tsx";
import { strings } from "./strings.ts";

type OrganizationSettings = components["schemas"]["OrganizationSettings"];
type Language = components["schemas"]["SearchLanguage"];
type Mailbox = components["schemas"]["Mailbox"];

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

  // A value can be a list, so values are compared as JSON.
  const unchanged = read.status !== "read" || chosen === undefined || Object.entries(chosen).every(([name, value]) => JSON.stringify(read.values[name as keyof Values]) === JSON.stringify(value));
  return { read, chosen, choose, saving, save, load, unchanged };
}

/**
 * The settings view. Every human can read the organization's settings, but only an admin changes
 * them. `mailboxes` are the human's own and their agents', once they are listed.
 */
export function Settings({
  client,
  admin,
  email,
  mailboxes,
  onPreferences,
  onSignedOut,
}: {
  client: DuvaClient;
  admin: boolean;
  email: string;
  mailboxes: { mine?: Mailbox; agents: AgentMailbox[] } | undefined;
  onPreferences: (preferences: Preferences) => void;
  onSignedOut: () => void;
}) {
  const screened = mailboxes === undefined ? [] : [...(mailboxes.mine === undefined ? [] : [{ mailbox: mailboxes.mine }]), ...mailboxes.agents];
  useEffect(() => {
    document.title = strings.title(strings.settings.title);
  }, []);
  // A change on one of the admins' sheets can change what the others show, so all read again after each.
  const [setupChanges, setSetupChanges] = useState(0);
  const setupChanged = useCallback(() => setSetupChanges((count) => count + 1), []);

  return (
    <main className="desk">
      <div className="desk-head">
        <h1 tabIndex={-1} className="view-title">
          {strings.settings.title}
        </h1>
      </div>
      <OrganizationSheet client={client} admin={admin} onSignedOut={onSignedOut} />
      {admin && <DomainsSheet client={client} changes={setupChanges} onChange={setupChanged} onSignedOut={onSignedOut} />}
      {admin && <AddressesSheet client={client} changes={setupChanges} onChange={setupChanged} onSignedOut={onSignedOut} />}
      {admin && <PeopleSheet client={client} me={email} changes={setupChanges} onChange={setupChanged} onSignedOut={onSignedOut} />}
      {admin && <GroupsSheet client={client} changes={setupChanges} onChange={setupChanged} onSignedOut={onSignedOut} />}
      <YouSheet client={client} onPreferences={onPreferences} onSignedOut={onSignedOut} />
      {screened.length > 0 && <ScreenerSheet key={screened.map(({ mailbox }) => mailbox.id).join()} client={client} mailboxes={screened} onSignedOut={onSignedOut} />}
      <AgentSettingsSheet client={client} email={email} onSignedOut={onSignedOut} />
    </main>
  );
}

/** The languages search knows, as the contract lists them. */
const searchLanguages: Language[] = ["English", "Swedish", "Danish"];

/** Mail in these is indexed in its own language whatever the list says, so only the others rebuild the indexes. */
const alwaysIndexed: Language[] = ["English", "Swedish"];

function OrganizationSheet({ client, admin, onSignedOut }: { client: DuvaClient; admin: boolean; onSignedOut: () => void }) {
  // The settings as they were before the last save, so "Saved" can say what changes from now on.
  const before = useRef<OrganizationSettings>(undefined);
  const sheet = useSheet<OrganizationSettings>({
    read: () => client.GET("/organization/settings"),
    write: (settings) => {
      before.current = sheet.read.status === "read" ? sheet.read.values : undefined;
      // Only an agent's change waits for approval, so a human's answer is the settings.
      return client.PATCH("/organization/settings", { body: settings }) as Answer<OrganizationSettings>;
    },
    copy: strings.settings,
    onSignedOut,
  });
  const [daysValid, setDaysValid] = useState(true);
  const copy = strings.settings.erasure;
  const languagesCopy = strings.settings.searchLanguages;
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
          <Retention
            client={client}
            admin={admin}
            chosen={chosen.retentionDays}
            saved={sheet.read.status === "read" ? sheet.read.values.retentionDays : chosen.retentionDays}
            onChoose={(retentionDays) => {
              setDaysValid(retentionDays !== undefined);
              if (retentionDays !== undefined) sheet.choose({ retentionDays });
            }}
          />
          <fieldset disabled={!admin}>
            <legend>{languagesCopy.legend}</legend>
            <p className="setting-lead">{languagesCopy.lead}</p>
            <div className="choices-short">
              {searchLanguages.map((language) => (
                <label className="choice" key={language}>
                  <input
                    type="checkbox"
                    checked={chosen.searchLanguages.includes(language)}
                    onChange={(event) =>
                      sheet.choose({ searchLanguages: searchLanguages.filter((each) => (each === language ? event.target.checked : chosen.searchLanguages.includes(each))) })
                    }
                  />
                  <span className="choice-text">
                    <span className="choice-name">{languagesCopy.names[language]}</span>
                    {!alwaysIndexed.includes(language) && <span className="hint">{languagesCopy.rebuildsHint}</span>}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          {admin ? (
            <SaveRow sheet={sheet} saved={savedCopy(before.current, sheet.read.status === "read" ? sheet.read.values : undefined)} invalid={!daysValid} />
          ) : (
            <p className="setting-foot">{strings.settings.onlyAdmins}</p>
          )}
        </>
      )}
    </Sheet>
  );
}

/** What "Saved" says about the settings that changed: when each applies from. */
function savedCopy(before: OrganizationSettings | undefined, after: OrganizationSettings | undefined): string {
  if (before === undefined || after === undefined) return strings.settings.saved([]);
  const indexed = (settings: OrganizationSettings) => settings.searchLanguages.filter((language) => !alwaysIndexed.includes(language)).join();
  return strings.settings.saved([
    ...(before.erasureErasesApprovals !== after.erasureErasesApprovals ? ["erasure" as const] : []),
    ...(before.retentionDays !== after.retentionDays ? ["retention" as const] : []),
    ...(before.searchLanguages.join() !== after.searchLanguages.join() ? ["languages" as const] : []),
    ...(indexed(before) !== indexed(after) ? ["indexes" as const] : []),
  ]);
}

/** The retention period typed, if it is a whole number of days Duva takes, from 7 to 365. */
function daysOf(text: string): number | undefined {
  const days = /^\d+$/.test(text.trim()) ? Number(text.trim()) : undefined;
  return days !== undefined && days >= 7 && days <= 365 ? days : undefined;
}

type Preview = { status: "none" } | { status: "counting" } | { status: "counted"; threads: number; days: number } | { status: "failed" };

/**
 * How many days Trash and Spam keep a thread, as a field of whole days. Shortening it reaches back,
 * so a shorter period than the saved one counts, for an admin, the threads saving it would erase.
 * `onChoose` hears of each valid period, and of an invalid one as undefined.
 */
function Retention({ client, admin, chosen, saved, onChoose }: { client: DuvaClient; admin: boolean; chosen: number; saved: number; onChoose: (days: number | undefined) => void }) {
  const copy = strings.settings.retention;
  const [text, setText] = useState(String(chosen));
  const [preview, setPreview] = useState<Preview>({ status: "none" });
  const days = daysOf(text);
  const valid = days !== undefined;
  const shorter = admin && valid && days < saved;

  useEffect(() => {
    if (!shorter) return setPreview({ status: "none" });
    setPreview({ status: "counting" });
    let current = true;
    // Typing a number passes through shorter ones, so it counts only once the typing pauses.
    const counting = setTimeout(() => {
      void client
        .GET("/organization/settings/retention-preview", { params: { query: { retentionDays: days } } })
        .then(({ data }) => current && setPreview(data === undefined ? { status: "failed" } : { status: "counted", threads: data.threads, days }))
        .catch(() => current && setPreview({ status: "failed" }));
    }, 300);
    return () => {
      current = false;
      clearTimeout(counting);
    };
  }, [client, shorter, days]);

  return (
    <fieldset disabled={!admin}>
      <legend>{copy.legend}</legend>
      <p className="setting-lead">{copy.lead}</p>
      <div className="retention">
        <input
          type="text"
          inputMode="numeric"
          aria-label={copy.legend}
          aria-describedby="retention-hint"
          aria-invalid={!valid}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            onChoose(daysOf(event.target.value));
          }}
        />
        <span>{copy.days}</span>
      </div>
      {valid ? (
        <p id="retention-hint" className="hint">
          {copy.hint}
        </p>
      ) : (
        <p id="retention-hint" className="field-error">
          {copy.invalid}
        </p>
      )}
      {preview.status !== "none" && (
        <p className="setting-note" role="status">
          {preview.status === "counting" ? copy.counting : preview.status === "failed" ? copy.countFailed : copy.erases(preview.threads, preview.days)}
        </p>
      )}
    </fieldset>
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

/**
 * Whether each mailbox's Screener is on, by mailbox ID: the human's own, without an agent's name,
 * and each agent's they sponsor.
 */
function ScreenerSheet({ client, mailboxes, onSignedOut }: { client: DuvaClient; mailboxes: { mailbox: Mailbox; agent?: string }[]; onSignedOut: () => void }) {
  const copy = strings.settings.screener;
  const sheet = useSheet<Record<string, boolean>>({
    read: async () => {
      const each = await Promise.all(mailboxes.map(({ mailbox }) => client.GET("/mailboxes/{mailbox}/screener", { params: { path: { mailbox: mailbox.id } } })));
      const unread = each.find(({ data }) => data === undefined);
      return { data: unread === undefined ? Object.fromEntries(each.map(({ data }, index) => [mailboxes[index]!.mailbox.id, data!.on])) : undefined, response: (unread ?? each[0]!).response };
    },
    // Switching a Screener to what it is changes nothing, so every one is switched as chosen, one at a time, stopping at a failure.
    write: async (chosen) => {
      const saved: Record<string, boolean> = {};
      let response = new Response();
      for (const [mailbox, on] of Object.entries(chosen)) {
        const answer = await client.PATCH("/mailboxes/{mailbox}/screener", { params: { path: { mailbox } }, body: { on } });
        response = answer.response;
        if (answer.data === undefined) return { response };
        saved[mailbox] = answer.data.on;
      }
      return { data: saved, response };
    },
    copy,
    onSignedOut,
  });
  return (
    <Sheet id="screener-settings" name={copy.title} lead={copy.lead} sheet={sheet}>
      {(chosen) => (
        <>
          {mailboxes.map(({ mailbox, agent }) => {
            const releasing = sheet.read.status === "read" && sheet.read.values[mailbox.id] === true && chosen[mailbox.id] === false;
            return (
              <fieldset key={mailbox.id}>
                <legend>{agent ?? copy.yours}</legend>
                <p className="setting-lead">{strings.mailboxes.address(mailbox)}</p>
                {([true, false] as const).map((on) => (
                  <Choice
                    key={String(on)}
                    name={`screener-${mailbox.id}`}
                    checked={chosen[mailbox.id] === on}
                    onChoose={() => sheet.choose({ [mailbox.id]: on })}
                    label={on ? copy.on : copy.off}
                    hint={on ? copy.onHint : copy.offHint}
                  />
                ))}
                {releasing && <p className="setting-note">{copy.releasing(agent === undefined ? copy.yourMailbox : copy.agentMailbox(agent))}</p>}
              </fieldset>
            );
          })}
          <SaveRow sheet={sheet} saved={copy.saved} />
        </>
      )}
    </Sheet>
  );
}

/** A sheet: its name and who chooses what's on it, then its settings once they are read. */
function Sheet<Values extends object>({
  id,
  name,
  lead,
  sheet,
  children,
}: {
  id: string;
  name: string;
  lead: string;
  sheet: SheetState<Values>;
  children: (chosen: Values) => ReactNode;
}) {
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

/** Save, which waits until a choice differs from what is saved, and "Saved" beside it once it is. */
function SaveRow<Values extends object>({ sheet, saved, invalid = false }: { sheet: SheetState<Values>; saved: string; invalid?: boolean }) {
  return (
    <div className="setting-foot">
      <button type="submit" className="button button-primary" disabled={sheet.unchanged || invalid || sheet.saving.status === "saving"}>
        {sheet.saving.status === "saving" ? strings.settings.saving : strings.settings.save}
      </button>
      <p role="status" className="setting-saved">
        {sheet.saving.status === "saved" ? saved : ""}
      </p>
    </div>
  );
}
