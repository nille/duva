// Organizing threads with labels: archiving, Spam, Trash and the human's own labels, on one thread
// or several. Every change can be undone at once, since it only moves labels.
import { useEffect, useId, useRef, useState } from "react";
import type { DuvaClient } from "@duva/client";
import type { components } from "@duva/openapi";
import { useShortcuts } from "./shortcuts.tsx";
import { strings } from "./strings.ts";

export type Label = components["schemas"]["Label"];
type Mailbox = components["schemas"]["Mailbox"];

/** A thread as organizing needs it: its ID and labels. */
export interface Labelled {
  id: string;
  labels: string[];
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
async function relabel(client: DuvaClient, mailbox: string, threads: string[], change: { add?: string[]; remove?: string[] }): Promise<Labelled[] | undefined> {
  const { data, response } = await client
    .POST("/mailboxes/{mailbox}/threads/labels", { params: { path: { mailbox } }, body: { threads, ...change } })
    .catch(() => ({ data: undefined, response: undefined }));
  if (response?.status === 401) throw new SessionEnded();
  return data?.threads;
}

/**
 * Changes the threads' labels, and answers what was done with how to undo it, or undefined if Duva
 * couldn't. Undoing gives each thread back the labels it had, in one request per kind of change.
 */
export async function organize(
  client: DuvaClient,
  mailbox: string,
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

/** Where threads are being organized: a listing of a label, All mail, or one thread. */
export type Place = { label: string } | { all: true } | { thread: true };

/** Whether the threads are in Spam or Trash, by the label listed or, elsewhere, by every thread's own labels. */
function whereOf(threads: Labelled[], place: Place): "spam" | "trash" | undefined {
  const every = (label: string) => threads.length > 0 && threads.every((thread) => thread.labels.includes(label));
  if ("label" in place) return place.label === "spam" || place.label === "trash" ? place.label : undefined;
  return every("trash") ? "trash" : every("spam") && !threads.some((thread) => thread.labels.includes("trash")) ? "spam" : undefined;
}

/**
 * What archiving the threads or moving them to Trash changes, and how it is said, as the Archive and
 * Move to Trash buttons do, or undefined where that button isn't offered: archiving outside the
 * Inbox, Spam and Trash, and Trash for threads already in it.
 */
export function changeFor(action: "archive" | "trash", threads: Labelled[], place: Place): { change: { add?: string[]; remove?: string[] }; message: (count: number) => string } | undefined {
  const where = whereOf(threads, place);
  if (threads.length === 0 || where === "trash") return undefined;
  if (action === "trash") return { change: { add: ["trash"] }, message: strings.organize.trashed };
  if (where === "spam" || !threads.some((thread) => thread.labels.includes("inbox"))) return undefined;
  return { change: { remove: ["inbox"] }, message: strings.organize.archived };
}

/**
 * The buttons that organize the threads, chosen by where they are: Spam offers not spam and
 * Trash, Trash offers restore, and anywhere else archive or move to the Inbox, spam, Trash and
 * labels. `onDone` hears what was done, and whether the threads left where they were, as archiving,
 * Spam, Trash and restoring take them out of a thread's view. `onSignedOut` hears that the session ended.
 * With `keys`, as in a thread, each button whose action has a key shows its cap, and l opens the labels.
 */
export function OrganizeActions({
  client,
  mailbox,
  threads,
  labels,
  place,
  keys = false,
  onDone,
  onSignedOut,
}: {
  client: DuvaClient;
  mailbox: Mailbox;
  threads: Labelled[];
  labels: Label[];
  place: Place;
  keys?: boolean;
  onDone: (done: Done, moved: boolean) => void;
  onSignedOut: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const has = (label: string) => threads.some((thread) => thread.labels.includes(label));
  const where = whereOf(threads, place);
  // Archive and Move to Trash do what e and # do.
  const archive = changeFor("archive", threads, place);
  const trash = changeFor("trash", threads, place);

  const act = async (change: { add?: string[]; remove?: string[] }, message: (count: number) => string, moved = true) => {
    setBusy(true);
    setFailed(false);
    try {
      const done = await organize(client, mailbox.id, threads, change, message);
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
  // The key that does what the button does, said to a screen reader by the button and shown as its cap.
  const key = (pressed: string) => (keys ? { "aria-keyshortcuts": pressed } : {});
  const cap = (shown: string) => keys && <kbd aria-hidden="true">{shown}</kbd>;
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
          <button type="button" className="button button-small" disabled={busy} {...key("#")} onClick={() => void act({ add: ["trash"] }, t.trashed)}>
            {cap("#")}
            {t.trash}
          </button>
        </>
      ) : (
        <>
          {archive !== undefined && (
            <button type="button" className="button button-small" disabled={busy} {...key("e")} onClick={() => void act(archive.change, archive.message)}>
              <ArchiveIcon />
              {cap("e")}
              {t.archive}
            </button>
          )}
          {threads.some((thread) => !thread.labels.includes("inbox")) && (
            <button type="button" className="button button-small" disabled={busy} onClick={() => void act({ add: ["inbox"] }, t.inboxed, false)}>
              {t.moveToInbox}
            </button>
          )}
          <button type="button" className="button button-small" disabled={busy} {...key("!")} onClick={() => void act({ add: ["spam"] }, t.spammed)}>
            {cap("!")}
            {t.spam}
          </button>
          {trash !== undefined && (
            <button type="button" className="button button-small" disabled={busy} {...key("#")} onClick={() => void act(trash.change, trash.message)}>
              <TrashIcon />
              {cap("#")}
              {t.trash}
            </button>
          )}
          <LabelPicker
            client={client}
            mailbox={mailbox}
            threads={threads}
            labels={labels}
            disabled={busy}
            failed={failed}
            keyed={keys}
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
  keyed,
  onToggle,
  onSignedOut,
}: {
  client: DuvaClient;
  mailbox: Mailbox;
  threads: Labelled[];
  labels: Label[];
  disabled: boolean;
  failed: boolean;
  /** Whether l opens the labels, as in a thread, with its cap on the button. */
  keyed: boolean;
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
  useShortcuts({ l: keyed && !disabled ? () => setOpen(true) : undefined });

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
        aria-keyshortcuts={keyed ? "l" : undefined}
        disabled={disabled}
        onClick={() => setOpen(!open)}
      >
        <LabelIcon />
        {keyed && <kbd aria-hidden="true">l</kbd>}
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

/** A form that creates a label in the mailbox, telling the human if the name is taken. */
export function NewLabel({
  client,
  mailbox,
  compact = false,
  onCreated,
  onCancel,
  onSignedOut,
}: {
  client: DuvaClient;
  mailbox: Mailbox;
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

const LabelIcon = () => (
  <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M2.5 2.5h5.2l5.8 5.8-5.2 5.2-5.8-5.8zM5.5 5.5h.01" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
