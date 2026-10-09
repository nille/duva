// Organizing threads with labels: archiving, Spam, Trash and the human's own labels, on one thread
// or several, and setting them aside in Remind me. Every change but cancelling a reminder can be undone at once.
// In All mailboxes each thread is organized in its own mailbox, and a label of the human's own is
// given by its name, which Duva finds, or makes, in each thread's mailbox (ADR-0033).
import { useContext, useEffect, useId, useRef, useState } from "react";
import type { DuvaClient } from "@duva/client";
import { clockValue, type components, fromClockValue, presetAt, reminderPresets, soonestReminder } from "@duva/openapi";
import { PreferencesContext, useDates } from "./dates.ts";
import { acrossOf, type AllMailboxes, isAll } from "./mailboxes.tsx";
import { useShortcuts } from "./shortcuts.tsx";
import { strings } from "./strings.ts";

export type Label = components["schemas"]["Label"];
type Mailbox = components["schemas"]["Mailbox"];

/** A thread as organizing needs it: its ID and labels, and its reminder while it is set aside. */
export interface Labelled {
  id: string;
  labels: string[];
  reminder?: { at: string };
}

/** What a human did to threads, said once it's done, and how to take it back. */
export interface Done {
  message: string;
  undo?: () => Promise<boolean>;
}

/** Thrown when Duva answers 401, so the human must sign in again. */
export class SessionEnded extends Error {}

/**
 * Adds and removes labels on the threads, and answers the threads as they are now, or undefined if
 * Duva couldn't change them. Throws SessionEnded if the session has ended.
 */
async function relabel(client: DuvaClient, mailbox: Mailbox | AllMailboxes, threads: string[], change: { add?: string[]; remove?: string[] }): Promise<Labelled[] | undefined> {
  const body = { threads, ...change };
  if (isAll(mailbox)) {
    const { data, response } = await client.POST("/all-mailboxes/threads/labels", { body }).catch(() => ({ data: undefined, response: undefined }));
    if (response?.status === 401) throw new SessionEnded();
    return data?.threads.map((thread) => acrossOf(mailbox, thread));
  }
  const { data, response } = await client.POST("/mailboxes/{mailbox}/threads/labels", { params: { path: { mailbox: mailbox.id } }, body }).catch(() => ({ data: undefined, response: undefined }));
  if (response?.status === 401) throw new SessionEnded();
  return data?.threads;
}

/**
 * Changes the threads' labels, and answers what was done with how to undo it, or undefined if Duva
 * couldn't. Undoing gives each thread back the labels it had, in one request per kind of change.
 */
export async function organize(
  client: DuvaClient,
  mailbox: Mailbox | AllMailboxes,
  threads: Labelled[],
  change: { add?: string[]; remove?: string[] },
  message: (count: number) => string,
): Promise<Done | undefined> {
  const after = await relabel(
    client,
    mailbox,
    threads.map(({ id }) => id),
    change,
  );
  if (after === undefined) return undefined;
  const undo = async () => {
    const inverses = new Map<string, { add: string[]; remove: string[]; threads: string[] }>();
    for (const was of threads) {
      const is = after.find(({ id }) => id === was.id)?.labels ?? was.labels;
      const add = was.labels.filter((label) => !is.includes(label));
      // A thread that wasn't in the Inbox goes back archived, also from Trash or Spam.
      const remove = [...is.filter((label) => !was.labels.includes(label)), ...(was.labels.includes("inbox") || is.includes("inbox") ? [] : ["inbox"])];
      if (add.length === 0 && remove.length === 0) continue;
      const key = JSON.stringify([add, remove]);
      const inverse = inverses.get(key) ?? { add, remove, threads: [] };
      inverse.threads.push(was.id);
      inverses.set(key, inverse);
    }
    for (const { threads: ids, ...inverse } of inverses.values()) {
      if ((await relabel(client, mailbox, ids, inverse)) === undefined) return false;
    }
    return true;
  };
  return { message: message(threads.length), undo };
}

/**
 * Marks the threads read or unread, and answers what was done, or undefined if Duva couldn't.
 * Throws SessionEnded if the session has ended.
 */
export async function markRead(client: DuvaClient, mailbox: Mailbox | AllMailboxes, threads: Labelled[], read: boolean): Promise<Done | undefined> {
  const body = { threads: threads.map(({ id }) => id) };
  const { data, response } = await (
    isAll(mailbox)
      ? read
        ? client.POST("/all-mailboxes/threads/read", { body })
        : client.POST("/all-mailboxes/threads/unread", { body })
      : read
        ? client.POST("/mailboxes/{mailbox}/threads/read", { params: { path: { mailbox: mailbox.id } }, body })
        : client.POST("/mailboxes/{mailbox}/threads/unread", { params: { path: { mailbox: mailbox.id } }, body })
  ).catch(() => ({ data: undefined, response: undefined }));
  if (response?.status === 401) throw new SessionEnded();
  if (data === undefined) return undefined;
  return { message: (read ? strings.organize.markedRead : strings.organize.markedUnread)(threads.length) };
}

/** Where threads are being organized: a listing of a label, All mail, or one thread. */
export type Place = { label: string } | { all: true } | { thread: true };

/** Whether the threads are in Spam or Trash, by the label listed or, elsewhere, by every thread's own labels. */
function whereOf(threads: Labelled[], place: Place): "spam" | "trash" | undefined {
  const every = (label: string) => threads.length > 0 && threads.every((thread) => thread.labels.includes(label));
  if ("label" in place) return place.label === "spam" || place.label === "trash" ? place.label : undefined;
  return every("trash") ? "trash" : every("spam") && !threads.some((thread) => thread.labels.includes("trash")) ? "spam" : undefined;
}

/**
 * What archiving the threads, moving them to Trash or marking them as spam changes, and how it is
 * said, as the Archive, Move to Trash and Mark as spam buttons do, or undefined where that button
 * isn't offered: archiving outside the Inbox, Spam and Trash, Trash for threads already in it, and
 * spam for threads in Spam or Trash.
 */
export function changeFor(
  action: "archive" | "trash" | "spam",
  threads: Labelled[],
  place: Place,
): { change: { add?: string[]; remove?: string[] }; message: (count: number) => string } | undefined {
  const where = whereOf(threads, place);
  if (threads.length === 0 || where === "trash") return undefined;
  if (action === "trash") return { change: { add: ["trash"] }, message: strings.organize.trashed };
  if (action === "spam") return where === "spam" ? undefined : { change: { add: ["spam"] }, message: strings.organize.spammed };
  if (where === "spam" || !threads.some((thread) => thread.labels.includes("inbox"))) return undefined;
  return { change: { remove: ["inbox"] }, message: strings.organize.archived };
}

/**
 * The buttons that organize the threads, chosen by where they are: Spam offers not spam and
 * Trash, Trash offers restore, and anywhere else archive or move to the Inbox, spam, Trash and
 * labels. `onDone` hears what was done, and whether the threads left where they were, as archiving,
 * Spam, Trash and restoring take them out of a thread's view. `onSignedOut` hears that the session ended.
 * Each button whose action has a key shows its cap, in a list and, with `keys`, in a thread, where l
 * opens the labels too. In a list, each time `labelsAsked` grows past 0 the labels open, as l asks
 * there, and they open at once if it is past 0 when the buttons first show. Remind me, offered
 * where Archive is or the threads are set aside, opens with b as the labels do with l.
 */
export function OrganizeActions({
  client,
  mailbox,
  threads,
  labels,
  place,
  keys = false,
  labelsAsked = 0,
  remindAsked = 0,
  onDone,
  onSignedOut,
}: {
  client: DuvaClient;
  mailbox: Mailbox | AllMailboxes;
  threads: Labelled[];
  labels: Label[];
  place: Place;
  /** Whether the thread's keys are on, as a thread says. A list's are always named. */
  keys?: boolean;
  /** How many times the labels were asked for by their key, which opens them each time it grows. */
  labelsAsked?: number;
  /** How many times Remind me was asked for by its key, as `labelsAsked` counts the labels'. */
  remindAsked?: number;
  onDone: (done: Done, moved: boolean) => void;
  onSignedOut: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const has = (label: string) => threads.some((thread) => thread.labels.includes(label));
  const where = whereOf(threads, place);
  // Archive, Move to Trash and Mark as spam do what e, # and ! do.
  const archive = changeFor("archive", threads, place);
  const trash = changeFor("trash", threads, place);
  const spam = changeFor("spam", threads, place);

  const act = async (change: { add?: string[]; remove?: string[] }, message: (count: number) => string, moved = true) => {
    setBusy(true);
    setFailed(false);
    try {
      const done = await organize(client, mailbox, threads, change, message);
      if (done === undefined) setFailed(true);
      else onDone(done, moved);
    } catch (error) {
      if (!(error instanceof SessionEnded)) throw error;
      onSignedOut();
    } finally {
      setBusy(false);
    }
  };

  const t = strings.organize;
  const keyed = useKeyed(keys || !("thread" in place));
  return (
    <>
      {where === "trash" ? (
        <button type="button" className="button button-small" disabled={busy} onClick={() => void act({ remove: ["trash"] }, t.restored)}>
          {t.restore}
        </button>
      ) : where === "spam" ? (
        <>
          <button type="button" className="button button-small" disabled={busy} onClick={() => void act({ remove: ["spam"] }, t.notSpammed)}>
            {t.notSpam}
          </button>
          <button type="button" className="button button-small" disabled={busy} aria-keyshortcuts={keyed("#")} onClick={() => void act({ add: ["trash"] }, t.trashed)}>
            <Cap name={keyed("#")} />
            {t.trash}
          </button>
        </>
      ) : (
        <>
          {archive !== undefined && (
            <button type="button" className="button button-small" disabled={busy} aria-keyshortcuts={keyed("e")} onClick={() => void act(archive.change, archive.message)}>
              <ArchiveIcon />
              <Cap name={keyed("e")} />
              {t.archive}
            </button>
          )}
          {threads.some((thread) => !thread.labels.includes("inbox")) && (
            <button type="button" className="button button-small" disabled={busy} onClick={() => void act({ add: ["inbox"] }, t.inboxed, false)}>
              {t.moveToInbox}
            </button>
          )}
          {spam !== undefined && (
            <button type="button" className="button button-small" disabled={busy} aria-keyshortcuts={keyed("!")} onClick={() => void act(spam.change, spam.message)}>
              <Cap name={keyed("!")} />
              {t.spam}
            </button>
          )}
          {trash !== undefined && (
            <button type="button" className="button button-small" disabled={busy} aria-keyshortcuts={keyed("#")} onClick={() => void act(trash.change, trash.message)}>
              <TrashIcon />
              <Cap name={keyed("#")} />
              {t.trash}
            </button>
          )}
          {(archive !== undefined || threads.some((thread) => thread.reminder !== undefined)) && (
            <RemindPicker
              client={client}
              mailbox={mailbox}
              threads={threads}
              disabled={busy}
              asked={remindAsked}
              keyName={keyed("b")}
              bound={keys}
              onDone={onDone}
              onSignedOut={onSignedOut}
            />
          )}
          <LabelPicker
            client={client}
            mailbox={mailbox}
            threads={threads}
            labels={labels}
            disabled={busy}
            failed={failed}
            asked={labelsAsked}
            keyName={keyed("l")}
            bound={keys}
            onToggle={(label, add) =>
              void act(add ? { add: [label.id] } : { remove: [label.id] }, add ? t.labelled(label.name) : t.unlabelled(label.name), false)
            }
            onSignedOut={onSignedOut}
          />
        </>
      )}
      {failed && (
        <p className="notice notice-alert organize-failed" role="alert">
          {t.failed}
        </p>
      )}
    </>
  );
}

/**
 * A button that opens the human's own labels, each checked if every thread has it and mixed if
 * some do. Checking one adds it to every thread, unchecking removes it. A label can be created there
 * too, and is then added.
 */
function LabelPicker({
  client,
  mailbox,
  threads,
  labels,
  disabled,
  failed,
  asked,
  keyName,
  bound,
  onToggle,
  onSignedOut,
}: {
  client: DuvaClient;
  mailbox: Mailbox | AllMailboxes;
  threads: Labelled[];
  labels: Label[];
  disabled: boolean;
  failed: boolean;
  asked: number;
  /** The key that opens the labels, shown as its cap. */
  keyName?: string;
  /** Whether l itself opens the labels, as in a thread. A list's keys ask through `asked`. */
  bound: boolean;
  onToggle: (label: Label, add: boolean) => void;
  onSignedOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  // What the human just checked or unchecked shows at once, until the threads come back changed or the change fails.
  const [pending, setPending] = useState(new Map<string, boolean>());
  const state = JSON.stringify(threads.map(({ labels }) => labels));
  useEffect(() => setPending(new Map()), [state, failed]);
  const panelId = useId();
  const wrapper = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const own = labels.filter((label) => !label.builtIn);
  useEffect(() => {
    if (asked > 0) setOpen(true);
  }, [asked]);

  useEffect(() => {
    if (!open) return;
    wrapper.current?.querySelector<HTMLInputElement>("input")?.focus();
    const away = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  useShortcuts({ l: bound && !disabled ? () => setOpen(true) : undefined });

  return (
    <div
      className="picker"
      ref={wrapper}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          close();
        }
      }}
    >
      <button
        ref={button}
        type="button"
        className="button button-small"
        aria-expanded={open}
        aria-controls={panelId}
        aria-keyshortcuts={keyName}
        disabled={disabled}
        onClick={() => setOpen(!open)}
      >
        <LabelIcon />
        <Cap name={keyName} />
        {strings.organize.labels}
      </button>
      {open && (
        <div className="picker-panel" id={panelId} role="group" aria-label={strings.organize.labelsFor(threads.length)}>
          {own.length === 0 ? (
            <p className="picker-empty">{strings.organize.noLabels}</p>
          ) : (
            <ul className="picker-labels">
              {own.map((label) => {
                const given = pending.get(label.id);
                const count = given === undefined ? threads.filter((thread) => thread.labels.includes(label.id)).length : given ? threads.length : 0;
                return (
                  <li key={label.id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={count === threads.length}
                        ref={(input) => {
                          if (input) input.indeterminate = count > 0 && count < threads.length;
                        }}
                        onChange={() => {
                          setPending(new Map(pending).set(label.id, count < threads.length));
                          onToggle(label, count < threads.length);
                        }}
                      />
                      <span>{label.name}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          <NewLabel
            client={client}
            mailbox={mailbox}
            compact
            onCreated={(label) => {
              onToggle(label, true);
              close();
            }}
            onSignedOut={onSignedOut}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Sets the threads aside in Remind me, and answers what was done with how to undo it, or undefined
 * if Duva couldn't. Undoing sets those already set aside back to their time, and cancels the
 * others' reminders, leaving out of the Inbox those that weren't in it. Throws SessionEnded if the
 * session has ended.
 */
export async function remindAt(client: DuvaClient, mailbox: Mailbox | AllMailboxes, threads: Labelled[], at: Date, message: string): Promise<Done | undefined> {
  const call = async (answer: Promise<{ data?: { threads: Labelled[] }; response: Response }>) => {
    const { data, response } = await answer.catch(() => ({ data: undefined, response: undefined }));
    if (response?.status === 401) throw new SessionEnded();
    return data?.threads;
  };
  const remind = (body: { threads: string[]; at: string }) =>
    call(isAll(mailbox) ? client.POST("/all-mailboxes/threads/remind", { body }) : client.POST("/mailboxes/{mailbox}/threads/remind", { params: { path: { mailbox: mailbox.id } }, body }));
  const set = await remind({ threads: threads.map(({ id }) => id), at: at.toISOString() });
  if (set === undefined) return undefined;
  const undo = async () => {
    for (const was of threads.filter((thread) => thread.reminder !== undefined)) {
      if ((await remind({ threads: [was.id], at: was.reminder!.at })) === undefined) return false;
    }
    const fresh = threads.filter((thread) => thread.reminder === undefined);
    if (fresh.length === 0) return true;
    if ((await call(cancelling(client, mailbox, fresh.map(({ id }) => id)))) === undefined) return false;
    const archived = fresh.filter((thread) => !thread.labels.includes("inbox")).map(({ id }) => id);
    return archived.length === 0 || (await relabel(client, mailbox, archived, { remove: ["inbox"] })) !== undefined;
  };
  return { message, undo };
}

/** Asks Duva to cancel the reminders of the threads with the IDs. */
const cancelling = (client: DuvaClient, mailbox: Mailbox | AllMailboxes, threads: string[]) =>
  isAll(mailbox)
    ? client.POST("/all-mailboxes/threads/remind/cancel", { body: { threads } })
    : client.POST("/mailboxes/{mailbox}/threads/remind/cancel", { params: { path: { mailbox: mailbox.id } }, body: { threads } });

/** Cancels the threads' reminders, which puts them back in the Inbox, and answers what was done, or undefined if Duva couldn't. */
async function cancelReminders(client: DuvaClient, mailbox: Mailbox | AllMailboxes, threads: Labelled[]): Promise<Done | undefined> {
  const set = threads.filter((thread) => thread.reminder !== undefined);
  const { data, response } = await cancelling(
    client,
    mailbox,
    set.map(({ id }) => id),
  ).catch(() => ({ data: undefined, response: undefined }));
  if (response?.status === 401) throw new SessionEnded();
  if (data === undefined) return undefined;
  return { message: strings.remind.cancelled(set.length) };
}

/** The browser's time zone, which the presets count in unless the human chose another. */
const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * A button that opens Remind me for the threads: the presets, each with the time it gives, counted
 * in the human's time zone, a time of their own on that zone's clock, and for threads already set aside, when they come
 * back and cancelling it. Choosing one sets them aside, which takes them out of the Inbox.
 */
function RemindPicker({
  client,
  mailbox,
  threads,
  disabled,
  asked,
  keyName,
  bound,
  onDone,
  onSignedOut,
}: {
  client: DuvaClient;
  mailbox: Mailbox | AllMailboxes;
  threads: Labelled[];
  disabled: boolean;
  asked: number;
  keyName?: string;
  /** Whether b itself opens Remind me, as in a thread. A list's keys ask through `asked`. */
  bound: boolean;
  onDone: (done: Done, moved: boolean) => void;
  onSignedOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<"idle" | "busy" | "failed" | "past">("idle");
  const preferences = useContext(PreferencesContext);
  const { when } = useDates();
  const [own, setOwn] = useState("");
  const panelId = useId();
  const fieldId = useId();
  const errorId = useId();
  const wrapper = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const t = strings.remind;
  const now = new Date();
  const timeZone = preferences.timeZone ?? browserTimeZone();
  const set = threads.filter((thread) => thread.reminder !== undefined);
  // Only one time is said, the soonest of those set aside, as several threads may each have their own.
  const soonest = set.map((thread) => thread.reminder!.at).sort()[0];

  useEffect(() => {
    if (asked > 0) setOpen(true);
  }, [asked]);
  useEffect(() => {
    if (!open) return;
    setState("idle");
    setOwn(clockValue(presetAt("tomorrowMorning", new Date(), timeZone), timeZone));
    wrapper.current?.querySelector<HTMLButtonElement>(".remind-preset")?.focus();
    const away = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open, timeZone]);
  useShortcuts({ b: bound && !disabled ? () => setOpen(true) : undefined });

  const close = () => {
    setOpen(false);
    button.current?.focus();
  };

  const act = async (perform: () => Promise<Done | undefined>) => {
    setState("busy");
    try {
      const done = await perform();
      if (done === undefined) return setState("failed");
      setOpen(false);
      onDone(done, true);
    } catch (error) {
      if (!(error instanceof SessionEnded)) throw error;
      onSignedOut();
    }
  };
  const remind = (at: Date) => act(() => remindAt(client, mailbox, threads, at, t.setAside(threads.length, when(at))));

  return (
    <div
      className="picker"
      ref={wrapper}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          close();
        }
      }}
    >
      <button
        ref={button}
        type="button"
        className="button button-small"
        aria-expanded={open}
        aria-controls={panelId}
        aria-keyshortcuts={keyName}
        disabled={disabled}
        onClick={() => setOpen(!open)}
      >
        <ClockIcon />
        <Cap name={keyName} />
        {t.button}
      </button>
      {open && (
        <div className="picker-panel remind-panel" id={panelId} role="group" aria-label={t.for(threads.length)}>
          {soonest !== undefined && (
            <p className="remind-now">
              <span>{set.length === threads.length ? t.until(when(new Date(soonest))) : t.someUntil(set.length, when(new Date(soonest)))}</span>
              <button type="button" className="link" disabled={state === "busy"} onClick={() => void act(() => cancelReminders(client, mailbox, threads))}>
                {t.cancel}
              </button>
            </p>
          )}
          <ul className="remind-presets">
            {reminderPresets.map((preset) => {
              const at = presetAt(preset, now, timeZone);
              return (
                <li key={preset}>
                  <button type="button" className="remind-preset" disabled={state === "busy"} onClick={() => void remind(at)}>
                    <span className="remind-preset-name">{t.presets[preset]}</span>
                    <span className="remind-preset-at">{when(at)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <form
            className="remind-own"
            // The picker says itself when a time is past, in its words.
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              const at = fromClockValue(own, timeZone);
              if (at === undefined || at.getTime() < Date.now() + soonestReminder) return setState("past");
              void remind(at);
            }}
          >
            <label htmlFor={fieldId}>{t.own}</label>
            <div className="remind-own-row">
              <input
                id={fieldId}
                type="datetime-local"
                value={own}
                min={clockValue(new Date(), timeZone)}
                aria-invalid={state === "past"}
                aria-describedby={state === "past" ? errorId : undefined}
                onChange={(event) => setOwn(event.target.value)}
              />
              <button type="submit" className="button button-small" disabled={state === "busy"}>
                {t.set}
              </button>
            </div>
          </form>
          {(state === "past" || state === "failed") && (
            <p className="field-error" id={errorId} role="alert">
              {state === "past" ? t.past : t.failed}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * A form that creates a label in the mailbox, telling the human if the name is taken. In All
 * mailboxes it only names the label, which Duva makes in each thread's mailbox once it is added.
 */
export function NewLabel({
  client,
  mailbox,
  compact = false,
  onCreated,
  onCancel,
  onSignedOut,
}: {
  client: DuvaClient;
  mailbox: Mailbox | AllMailboxes;
  compact?: boolean;
  onCreated: (label: Label) => void;
  onCancel?: () => void;
  onSignedOut: () => void;
}) {
  const [name, setName] = useState("");
  const [state, setState] = useState<{ status: "idle" | "busy" } | { status: "failed"; message: string }>({ status: "idle" });
  const fieldId = useId();
  const errorId = useId();

  const create = async () => {
    if (name.trim() === "") return setState({ status: "failed", message: strings.labelForm.missing });
    if (isAll(mailbox)) {
      setName("");
      return onCreated({ id: name.trim(), name: name.trim(), builtIn: false, unread: 0 });
    }
    setState({ status: "busy" });
    const { data, response } = await client
      .POST("/mailboxes/{mailbox}/labels", { params: { path: { mailbox: mailbox.id } }, body: { name: name.trim() } })
      .catch(() => ({ data: undefined, response: undefined }));
    if (response?.status === 401) return onSignedOut();
    if (data === undefined) return setState({ status: "failed", message: labelRefusal(response?.status, name.trim()) });
    setName("");
    setState({ status: "idle" });
    onCreated(data);
  };

  return (
    <form
      className={compact ? "label-form label-form-compact" : "label-form"}
      onSubmit={(event) => {
        event.preventDefault();
        void create();
      }}
    >
      <label htmlFor={fieldId}>{strings.labelForm.newLabel}</label>
      <div className="label-form-row">
        <input
          id={fieldId}
          type="text"
          value={name}
          maxLength={100}
          autoComplete="off"
          aria-invalid={state.status === "failed"}
          aria-describedby={state.status === "failed" ? errorId : undefined}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && onCancel) {
              event.stopPropagation();
              onCancel();
            }
          }}
        />
        <button type="submit" className="button button-small" disabled={state.status === "busy"}>
          {compact ? strings.labelForm.createAndAdd : strings.labelForm.create}
        </button>
        {onCancel && (
          <button type="button" className="button button-small button-quiet" onClick={onCancel}>
            {strings.labelForm.cancel}
          </button>
        )}
      </div>
      {state.status === "failed" && (
        <p className="field-error" id={errorId} role="alert">
          {state.message}
        </p>
      )}
    </form>
  );
}

/** What to tell the human when Duva refused a label's name with the status, or couldn't be reached. */
export function labelRefusal(status: number | undefined, name: string): string {
  if (status === undefined) return strings.labelForm.unreachable;
  if (status === 409) return strings.labelForm.taken(name);
  return strings.labelForm.failed(status);
}

/** The names of the thread's own labels, in the order the mailbox lists them. */
export function ownLabelsOf(thread: Labelled, labels: Label[]): Label[] {
  return labels.filter((label) => !label.builtIn && thread.labels.includes(label.id));
}

const ArchiveIcon = () => (
  <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M2.5 3.5h11v3h-11zM3.5 6.5v6h9v-6M6.5 9h3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const TrashIcon = () => (
  <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M2.5 4.5h11M6 4.5V3h4v1.5M4 4.5l.7 8.5h6.6l.7-8.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const ClockIcon = () => (
  <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM8 5v3.2l2.2 1.4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const LabelIcon = () => (
  <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M2.5 2.5h5.2l5.8 5.8-5.2 5.2-5.8-5.8zM5.5 5.5h.01" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** A control's key, for aria-keyshortcuts and its cap, where `shown` and while the human's shortcuts are on. */
export function useKeyed(shown = true) {
  const { keyboardShortcuts } = useContext(PreferencesContext);
  return (key: string) => (shown && keyboardShortcuts !== "off" ? key : undefined);
}

/** A control's key as its printed cap, which the control names in aria-keyshortcuts, or nothing. */
export const Cap = ({ name }: { name: string | undefined }) => (name === undefined ? null : <kbd aria-hidden="true">{name}</kbd>);
