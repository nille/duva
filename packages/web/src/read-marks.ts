// The read marks the web app made, which the list, the counts and the tab title show the moment
// they are made, before Duva has them and before the change feeds say so. What the web app reads
// from Duva carries when it was read, and a mark shows in whatever was read before Duva had it, so a
// read on its way when the mark landed shows it too, with no flicker back. A count read while a mark
// was on its way may have it or not, so it is dropped, and the counts are read again once Duva
// answers. A mark Duva refuses shows nowhere.
import { createContext, useContext } from "react";

/**
 * A clock for when something was read from Duva, and when Duva had a mark. It is coarse, so a read
 * started at the time Duva answered a mark was started after the answer, and has it.
 */
export const now = () => performance.now();

/**
 * What Duva had of a thread's read state from a time on: what a read of the thread said, or a mark
 * the web app made, from when Duva answered it, or from Infinity while it's on its way. A mark says
 * when it was sent.
 */
interface Fact {
  unread: boolean;
  at: number;
  sent?: number;
}

/** What the web app knows of a thread's read state: its labels, and the facts in the order they held. */
interface Known {
  labels: readonly string[];
  facts: readonly Fact[];
}

export type ReadState = ReadonlyMap<string, Known>;

const keyOf = (mailbox: string, thread: string) => `${mailbox}/${thread}`;

/** The facts with one more, in the order they held. A mark on its way holds after every fact Duva has. */
const withFact = (facts: readonly Fact[], fact: Fact) => [...facts, fact].sort((a, b) => a.at - b.at);

/** Notes what a read of the thread, started at `at`, said of it. */
export function saw(state: ReadState, mailbox: string, thread: { id: string; labels: readonly string[]; unread: boolean }, at: number): ReadState {
  const known = state.get(keyOf(mailbox, thread.id));
  return new Map(state).set(keyOf(mailbox, thread.id), { labels: thread.labels, facts: withFact(known?.facts ?? [], { unread: thread.unread, at }) });
}

/** Notes a mark on its way, which the thread shows until Duva answers. */
export function marked(state: ReadState, mailbox: string, thread: string, mark: Fact): ReadState {
  const known = state.get(keyOf(mailbox, thread));
  return known === undefined ? state : new Map(state).set(keyOf(mailbox, thread), { ...known, facts: withFact(known.facts, mark) });
}

/** Notes Duva's answer to the mark: it had it from `at`, or it refused it, which leaves it out. */
export function answered(state: ReadState, mailbox: string, thread: string, mark: Fact, at: number | undefined): ReadState {
  const known = state.get(keyOf(mailbox, thread));
  if (known === undefined) return state;
  const others = known.facts.filter((fact) => fact !== mark);
  return new Map(state).set(keyOf(mailbox, thread), { ...known, facts: at === undefined ? others : withFact(others, { ...mark, at }) });
}

/** What a read at `at` said, as far as the facts tell: the last fact that held before it, or, for a read before any, the first. */
const readThen = (facts: readonly Fact[], at: number) => facts.findLast((fact) => fact.at <= at) ?? facts[0];

/** Whether a count of the mailbox read from `start` to `end` may or may not have a mark the web app made, as one on its way then. */
export function overlapsMark(state: ReadState, mailbox: string, start: number, end: number) {
  return [...state].some(([key, { facts }]) => key.startsWith(`${mailbox}/`) && facts.some((fact) => fact.sent !== undefined && fact.sent < end && fact.at > start));
}

/** Whether the thread shows as unread, for a list read at `at` that says `unread`. */
export function unreadOf(state: ReadState, mailbox: string, thread: string, unread: boolean, at: number) {
  const facts = state.get(keyOf(mailbox, thread))?.facts ?? [];
  const last = facts.at(-1);
  return last === undefined || last.at <= at ? unread : last.unread;
}

/**
 * How many unread threads the label counts beyond a count read at `at`, by the marks it didn't
 * have. A label counts a thread in Spam or Trash only if it is one of those.
 */
export function countChange(state: ReadState, mailbox: string, label: string, at: number) {
  let change = 0;
  for (const [key, { labels, facts }] of state) {
    if (!key.startsWith(`${mailbox}/`) || !labels.includes(label)) continue;
    if (label !== "spam" && label !== "trash" && (labels.includes("spam") || labels.includes("trash"))) continue;
    const then = readThen(facts, at)!.unread;
    const shown = facts.at(-1)!.unread;
    change += Number(shown) - Number(then);
  }
  return change;
}

/** Marks a thread read or unread as the human sees it at once, with `send`, whose answer it gives back once Duva answers. */
export type Mark = <Answer extends { response?: { ok: boolean } }>(mailbox: string, thread: string, unread: boolean, send: () => Promise<Answer>) => Promise<Answer>;

export interface ReadMarks {
  state: ReadState;
  /** Notes what a read of a thread, started at `at`, said of it. */
  saw: (mailbox: string, thread: { id: string; labels: readonly string[]; unread: boolean }, at: number) => void;
  mark: Mark;
}

export const ReadMarksContext = createContext<ReadMarks>({ state: new Map(), saw: () => undefined, mark: (_mailbox, _thread, _unread, send) => send() });

export const useReadMarks = () => useContext(ReadMarksContext);
