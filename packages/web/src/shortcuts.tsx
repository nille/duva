// Keyboard shortcuts, as Gmail has them wherever Duva has the action: single keys that move through a
// list, pick, open, archive, trash, spam, label, set aside and mark its threads read or unread, reply to,
// forward or leave the thread open, undo what was just done, write and search, g and a letter to
// go to a view, and ? for a sheet listing them all. None acts while the human types in a field. A
// stray key, or a word said to speech input, would set them off, so a human can turn them all off
// on You (WCAG 2.1.4).
import { type RefObject, useContext, useEffect, useId, useRef } from "react";
import type { DuvaClient } from "@duva/client";
import type { components } from "@duva/openapi";
import { PreferencesContext } from "./dates.ts";
import { changeFor, type Done, type Labelled, markRead, organize, type Place, SessionEnded } from "./organize.tsx";
import { useBeside } from "./panes.tsx";
import { strings } from "./strings.ts";
import { hrefOf } from "./views.tsx";

type Mailbox = components["schemas"]["Mailbox"];

/** Whether the key went to a field that takes text, where it is typed rather than a shortcut. A checkbox or a button takes no letters. */
const typedInField = (target: EventTarget | null) =>
  target instanceof Element && target.closest("textarea, select, [contenteditable]:not([contenteditable=false]), input:not([type=checkbox], [type=radio], [type=button], [type=submit], [type=reset])") !== null;

/** The chords, as g then i, and how long the second key has to finish one after the first. */
const chordsKnown = new Set(["g i", "g t", "g d", "g a"]);
const chordStarts = new Set(Array.from(chordsKnown, (chord) => chord.split(" ")[0]!));
const chordTime = 1_500;

/** The key that started a chord, and when, until the next key finishes it. */
let started: { key: string; at: number } | undefined;

/** The key as the shortcuts name it: a letter by its case with Shift, whatever Caps Lock says, so u is u and Shift+U is U. */
const keyOf = (event: KeyboardEvent) => (/^[a-z]$/i.test(event.key) ? (event.shiftKey ? event.key.toUpperCase() : event.key.toLowerCase()) : event.key);

/** The chord each key press finished, as "g i", so the key's own shortcut doesn't act on it too. */
const chords = new WeakMap<KeyboardEvent, string>();

// Every key outside a field goes through here first, so each hook below sees the chord it finished.
document.addEventListener(
  "keydown",
  (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing || event.key === "Shift") return;
    const start = started;
    started = undefined;
    if (typedInField(event.target)) return;
    const chord = start === undefined ? undefined : `${start.key} ${keyOf(event)}`;
    if (chord !== undefined && chordsKnown.has(chord) && event.timeStamp - start!.at < chordTime) chords.set(event, chord);
    else if (chordStarts.has(keyOf(event))) started = { key: keyOf(event), at: event.timeStamp };
  },
  { capture: true },
);

/**
 * Calls the handler of each key named that the human presses outside a field, without Ctrl, Alt or
 * Meta, while their shortcuts are on and no sheet is open over the page. A key is named as the
 * browser names it, so Shift+U is "U", and a chord by its keys in turn, as "g i". A key that
 * finishes a chord acts only as the chord. A key whose handler is undefined does what it would
 * without shortcuts.
 */
export function useShortcuts(keys: Record<string, (() => void) | undefined>) {
  const { keyboardShortcuts } = useContext(PreferencesContext);
  const current = useRef(keys);
  current.current = keys;
  useEffect(() => {
    if (keyboardShortcuts === "off") return;
    const pressed = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing || event.defaultPrevented) return;
      if (typedInField(event.target) || document.querySelector("dialog[open]") !== null) return;
      // Escape closes what is open over the page first, as a menu or a slip, which close themselves. A letter's quoted text open stays.
      if (event.key === "Escape" && document.querySelector('[aria-expanded="true"]:not(article *)') !== null) return;
      const handler = current.current[chords.get(event) ?? keyOf(event)];
      if (handler === undefined) return;
      event.preventDefault();
      handler();
    };
    document.addEventListener("keydown", pressed);
    return () => document.removeEventListener("keydown", pressed);
  }, [keyboardShortcuts]);
}

/**
 * The keys of a list of threads, each a line `li[data-thread]` with its link: j and k move the
 * focus to the next and previous line, which a screen reader reads, o opens the line at the cursor,
 * as Enter does, and x picks it or leaves it, as its checkbox does. The cursor is the line with the
 * focus, or the one that last had it. e archives, # moves to Trash and ! marks as spam the threads
 * picked or, with none picked, the thread at the cursor, which stays where it was when the human
 * comes back to the list from a thread, where the list offers that, and says so as its buttons do.
 * Shift+I and Shift+U mark them read and unread, l asks `onLabels` to open the labels for them,
 * and b `onRemind` to open Remind me, picking the cursor's thread first if none is. Beside an open thread, those keys are the thread's,
 * and while the list is out of sight, as when the thread takes the column, no key is its. If the
 * cursor's thread leaves the list, the cursor moves on to the next thread, or the one before it at the end.
 */
export function useThreadKeys<Thread extends Labelled>({
  list,
  client,
  mailbox,
  threads,
  picked,
  place,
  onPick,
  onLabels,
  onRemind,
  onDone,
  onSignedOut,
}: {
  list: RefObject<HTMLElement | null>;
  client: DuvaClient;
  mailbox: Mailbox;
  threads: Thread[];
  picked: Thread[];
  place: Place;
  /** Picks the thread, or leaves it if it is picked. */
  onPick: (id: string) => void;
  /** Opens the labels for the threads picked, once the thread at the cursor is picked if none was. */
  onLabels: () => void;
  /** Opens Remind me for the threads picked, as onLabels opens the labels. */
  onRemind: () => void;
  onDone: (done: Done, moved: boolean) => void;
  onSignedOut: () => void;
}) {
  const cursor = useRef(lastCursor);
  // The threads after the cursor's, then those before it, nearest first, for where it moves on to.
  const after = useRef<string[]>([]);
  const acting = useRef(false);

  useEffect(() => {
    const element = list.current;
    if (element === null) return;
    const focused = (event: FocusEvent) => {
      const line = (event.target as Element).closest<HTMLElement>("li[data-thread]");
      if (line !== null) cursor.current = lastCursor = line.dataset.thread;
    };
    element.addEventListener("focusin", focused);
    return () => element.removeEventListener("focusin", focused);
  });

  const line = (id: string | undefined) => (id === undefined ? null : (list.current?.querySelector<HTMLElement>(`li[data-thread="${CSS.escape(id)}"] a.thread`) ?? null));

  // A cursor whose thread left the list moves on, if the focus went with it.
  useEffect(() => {
    if (cursor.current === undefined || threads.some(({ id }) => id === cursor.current)) return;
    const next = after.current.find((id) => threads.some((thread) => thread.id === id));
    // Where to move on to holds for the one action it was worked out for.
    after.current = [];
    if (next === undefined || !(document.activeElement === document.body || document.activeElement === null)) return;
    line(next)?.focus();
  }, [threads]);

  const move = (step: 1 | -1) => {
    const lines = Array.from(list.current?.querySelectorAll<HTMLElement>("li[data-thread]") ?? []);
    if (lines.length === 0) return;
    const at = lines.findIndex((each) => each.dataset.thread === cursor.current);
    // From outside the list, as from the title on coming back, the first key goes to the cursor's line.
    const inside = list.current?.contains(document.activeElement) === true;
    const to = at === -1 ? 0 : inside ? Math.min(Math.max(at + step, 0), lines.length - 1) : at;
    lines[to]!.querySelector<HTMLElement>("a.thread")?.focus();
  };

  const atCursor = () => threads.filter(({ id }) => id === cursor.current);
  const targets = () => (picked.length > 0 ? picked : atCursor());

  /** Does what `perform` does to the targets, then says it, and for a move works out where the cursor moves on to. */
  const act = async (chosen: Thread[], perform: () => Promise<Done | undefined>, moved: boolean) => {
    if (chosen.length === 0 || acting.current) return;
    const at = threads.findIndex(({ id }) => id === cursor.current);
    after.current =
      at === -1 || !moved ? [] : [...threads.slice(at + 1), ...threads.slice(0, at).reverse()].map(({ id }) => id).filter((id) => !chosen.some((target) => target.id === id));
    acting.current = true;
    try {
      const done = await perform();
      onDone(done ?? { message: strings.organize.failed }, moved && done !== undefined);
    } catch (error) {
      if (!(error instanceof SessionEnded)) throw error;
      onSignedOut();
    } finally {
      acting.current = false;
    }
  };

  const relabel = (action: "archive" | "trash" | "spam") => {
    const chosen = targets();
    const what = changeFor(action, chosen, place);
    if (what !== undefined) void act(chosen, () => organize(client, mailbox.id, chosen, what.change, what.message), true);
  };

  const mark = (read: boolean) => {
    const chosen = targets();
    void act(chosen, () => markRead(client, mailbox.id, chosen, read), false);
  };

  const { thread } = useBeside();
  const shown = (key: () => void) => () => {
    if (list.current?.checkVisibility() === true) key();
  };
  const own = (key: () => void) => (thread ? undefined : shown(key));
  useShortcuts({
    j: shown(() => move(1)),
    k: shown(() => move(-1)),
    o: shown(() => line(cursor.current)?.click()),
    x: shown(() => cursor.current !== undefined && threads.some(({ id }) => id === cursor.current) && onPick(cursor.current)),
    e: own(() => relabel("archive")),
    "#": own(() => relabel("trash")),
    "!": own(() => relabel("spam")),
    I: own(() => mark(true)),
    U: own(() => mark(false)),
    l: own(() => {
      if (picked.length === 0 && atCursor().length === 0) return;
      if (picked.length === 0) onPick(cursor.current!);
      onLabels();
    }),
    b: own(() => {
      if (picked.length === 0 && atCursor().length === 0) return;
      if (picked.length === 0) onPick(cursor.current!);
      onRemind();
    }),
  });
}

/** The thread the cursor was last on in any list, so coming back to the list from it finds it there. */
let lastCursor: string | undefined;

/**
 * The shortcuts of the whole web app: c writes with `write`, Escape and u close with `close` where
 * there is something to close, as a thread is, g then i, t, d or a go to the Inbox, Sent, Drafts
 * or All mail of the mailbox whose Inbox is at `base`, Drafts only where it is listed, and ? opens
 * the sheet listing every shortcut, which `sheetOpen` says is open, as the status strip's key opens
 * it too. Shift+A opens Ask your agent with `ask`. `/` is the search box's own, and z the line that says what was just done.
 */
export function Shortcuts({
  write,
  close,
  views,
  ask,
  sheetOpen,
  onSheet,
}: {
  write?: () => void;
  close?: () => void;
  /** Where the mailbox open is, and whether it lists Drafts. */
  views?: { base: string; drafts: boolean };
  /** Opens Ask your agent, for the human's own mailbox open or their first. */
  ask?: () => void;
  sheetOpen: boolean;
  onSheet: (open: boolean) => void;
}) {
  const go = (href: string) => () => void (location.hash = href);
  useShortcuts({
    c: write,
    Escape: close,
    u: close,
    "?": () => onSheet(true),
    "g i": views && go(hrefOf({ label: "inbox" }, views.base)),
    "g t": views && go(hrefOf({ sent: true }, views.base)),
    "g d": views?.drafts === true ? go(`${views.base}drafts`) : undefined,
    "g a": views && go(hrefOf({ all: true }, views.base)),
    A: ask,
  });
  return sheetOpen ? <ShortcutsSheet onClose={() => onSheet(false)} /> : null;
}

/** Keys pressed together, as Shift and U, or in turn, as g then i. */
type Keys = { together: string[] } | { inTurn: string[] };

const key = (...together: string[]): Keys => ({ together });
const chord = (...inTurn: string[]): Keys => ({ inTurn });

/**
 * The sheet listing every shortcut, over the page, as a legend of printed key caps: each group's
 * keys in one column, what each does beside them. Escape and Close put it away, back to where the
 * focus was.
 */
function ShortcutsSheet({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const sheet = dialog.current;
    sheet?.showModal();
    return () => sheet?.close();
  }, []);
  const copy = strings.shortcuts;
  const groups: [string, [Keys[], string][]][] = [
    [
      copy.inList,
      [
        [[key("j")], copy.next],
        [[key("k")], copy.previous],
        [[key("Enter"), key("o")], copy.open],
        [[key("x")], copy.select],
        [[key("e")], copy.archive],
        [[key("#")], copy.trash],
        [[key("!")], copy.spam],
        [[key("l")], copy.labels],
        [[key("b")], copy.remind],
        [[key("Shift", "I")], copy.markRead],
        [[key("Shift", "U")], copy.markUnread],
      ],
    ],
    [
      copy.inThread,
      [
        [[key("r")], copy.reply],
        [[key("a")], copy.replyAll],
        [[key("f")], copy.forward],
        [[key("e")], copy.archive],
        [[key("#")], copy.trash],
        [[key("!")], copy.spam],
        [[key("l")], copy.labels],
        [[key("b")], copy.remind],
        [[key("Shift", "U")], copy.markUnread],
        [[key("u"), key("Esc")], copy.back],
        [[key("Ctrl", "Enter"), key("⌘", "Enter")], copy.send],
      ],
    ],
    [
      copy.anywhere,
      [
        [[key("c")], copy.write],
        [[key("/")], copy.search],
        [[key("z")], copy.undo],
        [[chord("g", "i")], copy.goInbox],
        [[chord("g", "t")], copy.goSent],
        [[chord("g", "d")], copy.goDrafts],
        [[chord("g", "a")], copy.goAll],
        [[key("Shift", "A")], copy.ask],
        [[key("?")], copy.help],
      ],
    ],
  ];
  return (
    <dialog ref={dialog} className="shortcuts" aria-labelledby={titleId} onClose={onClose}>
      <div className="shortcuts-head">
        <h2 id={titleId}>{copy.title}</h2>
        <button type="button" className="button button-small button-quiet" onClick={() => dialog.current?.close()}>
          {copy.done}
          <kbd aria-hidden="true">Esc</kbd>
        </button>
      </div>
      <p className="shortcuts-lead">{copy.lead}</p>
      <div className="shortcuts-groups">
        {groups.map(([name, keys]) => (
          <section key={name} className="shortcuts-group" aria-label={name}>
            <h3>{name}</h3>
            <dl>
              {keys.map(([pressed, what]) => (
                <div key={what} className="shortcut">
                  <dt>
                    {pressed.map((keys, index) => (
                      <span key={index} className="shortcut-keys">
                        {index > 0 && <span className="shortcut-or"> {copy.or} </span>}
                        <Caps keys={keys} />
                      </span>
                    ))}
                  </dt>
                  <dd>{what}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <p className="shortcuts-off">
        {copy.offBefore}
        <a href="#/settings/you" onClick={() => dialog.current?.close()}>
          {copy.offLink}
        </a>
        {copy.offAfter}
      </p>
    </dialog>
  );
}

/** Keys as caps: together with a plus between them, or in turn with "then". */
function Caps({ keys }: { keys: Keys }) {
  const together = "together" in keys;
  const caps = together ? keys.together : keys.inTurn;
  return (
    <>
      {caps.map((cap, index) => (
        <span key={index} className="shortcut-cap">
          {index > 0 && <span className="shortcut-join"> {together ? "+" : strings.shortcuts.then} </span>}
          <kbd>{cap}</kbd>
        </span>
      ))}
    </>
  );
}
