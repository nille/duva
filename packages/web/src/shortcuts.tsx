// Keyboard shortcuts, as other mail apps have them: single keys that move through a list and open,
// archive or trash its threads, write, search and close, and ? for a sheet listing them all. None acts
// while the human types in a field. A stray key, or a word said to speech input, would set them off,
// so a human can turn them all off on You (WCAG 2.1.4).
import { type RefObject, useContext, useEffect, useId, useRef, useState } from "react";
import type { DuvaClient } from "@duva/client";
import type { components } from "@duva/openapi";
import { PreferencesContext } from "./dates.ts";
import { changeFor, type Done, type Labelled, organize, type Place, SessionEnded } from "./organize.tsx";
import { strings } from "./strings.ts";

type Mailbox = components["schemas"]["Mailbox"];

/** Whether the key went to a field that takes text, where it is typed rather than a shortcut. A checkbox or a button takes no letters. */
const typedInField = (target: EventTarget | null) =>
  target instanceof Element && target.closest("textarea, select, [contenteditable]:not([contenteditable=false]), input:not([type=checkbox], [type=radio], [type=button], [type=submit], [type=reset])") !== null;

/**
 * Calls the handler of each key named that the human presses outside a field, without Ctrl, Alt or
 * Meta, while their shortcuts are on and no sheet is open over the page. A key whose handler is
 * undefined does what it would without shortcuts.
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
      const handler = current.current[event.key];
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
 * focus to the next and previous line, which a screen reader reads, and o opens the line at the
 * cursor, as Enter does. The cursor is the line with the focus, or the one that last had it. e
 * archives and # moves to Trash the threads picked or, with none picked, the thread at the cursor,
 * which stays where it was when the human comes back to the list from a thread,
 * where the list offers that, and says so as its buttons do. If the cursor's thread leaves the list,
 * the cursor moves on to the next thread, or the one before it at the end.
 */
export function useThreadKeys<Thread extends Labelled>({
  list,
  client,
  mailbox,
  threads,
  picked,
  place,
  onDone,
  onSignedOut,
}: {
  list: RefObject<HTMLElement | null>;
  client: DuvaClient;
  mailbox: Mailbox;
  threads: Thread[];
  picked: Thread[];
  place: Place;
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

  const act = async (action: "archive" | "trash") => {
    const targets = picked.length > 0 ? picked : threads.filter(({ id }) => id === cursor.current);
    const what = changeFor(action, targets, place);
    if (what === undefined || acting.current) return;
    const at = threads.findIndex(({ id }) => id === cursor.current);
    after.current = at === -1 ? [] : [...threads.slice(at + 1), ...threads.slice(0, at).reverse()].map(({ id }) => id).filter((id) => !targets.some((target) => target.id === id));
    acting.current = true;
    try {
      const done = await organize(client, mailbox.id, targets, what.change, what.message);
      onDone(done ?? { message: strings.organize.failed }, done !== undefined);
    } catch (error) {
      if (!(error instanceof SessionEnded)) throw error;
      onSignedOut();
    } finally {
      acting.current = false;
    }
  };

  useShortcuts({
    j: () => move(1),
    k: () => move(-1),
    o: () => line(cursor.current)?.click(),
    e: () => void act("archive"),
    "#": () => void act("trash"),
  });
}

/** The thread the cursor was last on in any list, so coming back to the list from it finds it there. */
let lastCursor: string | undefined;

/**
 * The shortcuts of the whole web app: c writes with `write`, Escape closes with `close` where there
 * is something to close, as a thread is, and ? opens the sheet listing every shortcut. `/` is the
 * search box's own.
 */
export function Shortcuts({ write, close }: { write?: () => void; close?: () => void }) {
  const [open, setOpen] = useState(false);
  useShortcuts({ c: write, Escape: close, "?": () => setOpen(true) });
  return open ? <ShortcutsSheet onClose={() => setOpen(false)} /> : null;
}

/** The sheet listing every shortcut, over the page, which Escape and Close put away, back to where the focus was. */
function ShortcutsSheet({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const sheet = dialog.current;
    sheet?.showModal();
    return () => sheet?.close();
  }, []);
  const copy = strings.shortcuts;
  const groups: [string, [string[], string][]][] = [
    [
      copy.inList,
      [
        [["j"], copy.next],
        [["k"], copy.previous],
        [["Enter", "o"], copy.open],
        [["e"], copy.archive],
        [["#"], copy.trash],
      ],
    ],
    [
      copy.anywhere,
      [
        [["c"], copy.write],
        [["/"], copy.search],
        [["Esc"], copy.close],
        [["?"], copy.help],
      ],
    ],
  ];
  return (
    <dialog ref={dialog} className="shortcuts" aria-labelledby={titleId} onClose={onClose}>
      <div className="shortcuts-head">
        <h2 id={titleId}>{copy.title}</h2>
        <button type="button" className="button button-small button-quiet" onClick={() => dialog.current?.close()}>
          {copy.done}
        </button>
      </div>
      <p className="shortcuts-lead">{copy.lead}</p>
      {groups.map(([name, keys]) => (
        <section key={name} className="shortcuts-group" aria-label={name}>
          <h3>{name}</h3>
          <dl>
            {keys.map(([pressed, what]) => (
              <div key={what} className="shortcut">
                <dt>
                  {pressed.map((key, index) => (
                    <span key={key}>
                      {index > 0 && <span className="shortcut-or"> {copy.or} </span>}
                      <kbd>{key}</kbd>
                    </span>
                  ))}
                </dt>
                <dd>{what}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
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
