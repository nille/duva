// Coo, the mailbox agent every human's mailbox has (ADR-0027), a duva, Swedish for dove. It sits in
// its nest at the side column's head, where Duva's wordmark was, and is the mark of the mailbox agent
// wherever it appears, as the diamond is any other agent's. It bobs its head only while it works, a
// turn of Ask Coo or a label's task, and speaks up only with news worth a glance: new mail since the
// human last looked, a draft of its waiting for their approval, or a task done. What it said goes
// away once they look.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { DuvaClient } from "@duva/client";
import type { components } from "@duva/openapi";
import type { MailboxChange } from "./feed.ts";
import { strings } from "./strings.ts";
import { hrefOf, threadHref } from "./views.tsx";

type Approval = components["schemas"]["Approval"];

const copy = strings.coo;

/** The IDs of the mailbox agents the human sponsors, which are drawn as Coo. */
export const MailboxAgentsContext = createContext<ReadonlySet<string>>(new Set());

/** Whether the agent is one of the human's mailbox agents, so Coo. */
export const useIsCoo = (agent: string | undefined) => {
  const coos = useContext(MailboxAgentsContext);
  return agent !== undefined && coos.has(agent);
};

/**
 * Coo, a pigeon's portrait in one line with round ends, open at the bottom, in the color around it
 * (`.impeccable/previews/coo/mark`): its head and neck, the shoulder of its wing, a ring eye, the
 * bill and its gape line, and a highlight on the crown. In full, a .75 line on a 32 unit grid, for
 * 48px and up, and `small`, for 16 to 24px, a 1.6 line without the gape line. The portrait is a
 * group of its own, which bobs while Coo works.
 */
const CooPortrait = ({ small }: { small: boolean }) => (
  <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth={small ? "1.6" : ".75"} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <g className="coo-portrait">
      <path d="M6.4 22.6C9.8 20.4 12.2 17.6 13.6 13.6 15 9.4 17.2 6.4 20.8 6.2 23.4 6 25 7.6 25.6 9.6" />
      <path d="M25.4 9.6 29 11.6 25.2 12.6C24.6 11.6 24.7 10.4 25.4 9.6Z" />
      {!small && <path d="M25.3 11.4 28.6 11.6" />}
      <path d="M25 12.8C23.8 15.4 24 19 24.8 22.6 25.3 24.8 25.4 26.4 25.4 27.4" />
      <path d="M11.6 19.2C15 17.4 19 17.8 20.4 20.6 21.4 22.6 21.1 25.4 20.3 27.2" />
      <circle cx="22.3" cy="10" r={small ? ".85" : ".8"} />
      <path d="M17 12.6C17.6 10.9 18.5 10 19.6 9.6" />
    </g>
  </svg>
);

/** Coo as the mailbox agent's mark, 16 to 24px. */
export const CooMark = () => <CooPortrait small />;

/**
 * Coo in its nest at the side column's head, a link to Ask Coo. Its name is Duva's, with how Coo is,
 * and while Coo works its head bobs, as a walking pigeon's does. The nest is woven in Coo's own line.
 */
export function Nest({ href, working }: { href: string; working: boolean }) {
  return (
    <a className={working ? "nest nest-working" : "nest"} href={href} aria-label={copy.nest(working)}>
      <svg viewBox="0 0 56 48" aria-hidden="true">
        <svg x="7" y="-3.2" width="44" height="44" viewBox="0 0 32 32" overflow="visible">
          <CooPortrait small={false} />
        </svg>
        {/* The nest's back rim either side of Coo, then its woven bowl in front, open at the top for Coo to sit in. */}
        <g className="nest-line">
          <path d="M6 33.4c2.6-1.6 6.4-2.4 9.6-2.8M42.4 30.8c3.4.5 6 1.4 7.6 2.6" />
          <path d="M3.5 33.2c6.4 2.6 42.6 2.6 49 0-.6 8.6-10 13.6-24.5 13.6S4.1 41.8 3.5 33.2Z" />
          <path className="nest-weave" d="M5.5 37.2c9 2.7 36 2.7 45 0M8.6 41c8 2.4 30.8 2.4 38.8 0" />
          <path d="M1.6 34.4 4.4 33.6M51.6 33.5l2.6 1" />
        </g>
      </svg>
    </a>
  );
}

/** What Coo has to say, each part linked to where the human looks at it. */
export interface CooNews {
  /** New mail in the mailbox's Inbox since the human last looked there, by whom, newest first. */
  mail: { thread: string; from?: string }[];
  /** How many of Coo's drafts in the mailbox wait for the human's approval since they last looked at Approvals. */
  drafts: number;
  /** Tasks Coo did in the mailbox since the human last looked, newest first. */
  tasks: { task: string; thread: string; label?: string; subject?: string }[];
}

const quiet: CooNews = { mail: [], drafts: 0, tasks: [] };

/**
 * Coo's speech bubble under the nest, while it has news and its human lets it speak up. It lies in
 * the page's flow, so it never covers what is under it, and screen readers hear it politely.
 */
export function CooSays({ news, base, onTasksSeen }: { news: CooNews; base: string; onTasksSeen: () => void }) {
  const { mail, drafts, tasks } = news;
  const said = mail.length > 0 || drafts > 0 || tasks.length > 0;
  // The live region stays in the page while Coo is quiet, so a screen reader hears what it then says.
  return (
    <div className="coo-say" role="status">
      {said && (
        <p className="coo-says">
          <span className="coo-says-coo">{copy.coo}</span>
          {drafts > 0 && <> <a href="#/approvals">{copy.drafts(drafts)}</a></>}
          {mail.length > 0 && <> <a href={hrefOf({ label: "inbox" }, base)}>{copy.mail(mail.length, names(mail.flatMap(({ from }) => (from === undefined ? [] : [from]))))}</a></>}
          {tasks.length > 0 && (
            <>
              {" "}
              <a href={threadHref(tasks[0]!.thread, { label: "inbox" }, base)} onClick={onTasksSeen}>
                {copy.tasks(tasks.length, tasks[0]!.subject, tasks[0]!.label)}
              </a>
            </>
          )}
        </p>
      )}
    </div>
  );
}

/** Who sent the mail, each once, newest first. */
const names = (from: string[]) => [...new Set(from)];

// How long a task Coo started counts as under way without word of its end, as when its run was
// lost: as long as a run's token works (ADR-0027).
const taskRunsFor = 20 * 60_000;

// When the human last looked at what Coo speaks of, kept in this browser. Asked first, it is now,
// so a first visit has looked at everything before it.
const lookedKey = (what: string) => `duva.coo.looked.${what}`;
function lookedSince(what: string): number {
  const stored = Number(localStorage.getItem(lookedKey(what)));
  if (stored > 0) return stored;
  return look(what);
}
function look(what: string): number {
  const now = Date.now();
  localStorage.setItem(lookedKey(what), String(now));
  return now;
}

/** Where the human is looking now, which ends the news about it. */
export interface Looking {
  /** The mailbox whose Inbox they are on. */
  inbox?: string;
  approvals: boolean;
  /** The thread they have open. */
  thread?: string;
}

/**
 * How Coo is: whether it works, from the turns of Ask Coo under way and the tasks the feeds say it
 * started and hasn't ended, and its news in `mailbox`, from what the feeds and Approvals say. Call
 * `onChanges` with every read of the feeds, `onApprovals` with what waits for the human, and
 * `onAsking` as a turn starts and ends.
 */
export function useCoo({
  client,
  mailbox,
  own,
  coos,
  looking,
  onSignedOut,
}: {
  client: DuvaClient;
  /** The mailbox whose news Coo says. */
  mailbox?: string;
  /** The IDs of the human's own mailboxes, whose feeds are followed. */
  own: readonly string[];
  coos: ReadonlySet<string>;
  looking: Looking;
  onSignedOut: () => void;
}) {
  const [asking, setAsking] = useState(0);
  const [started, setStarted] = useState<ReadonlyMap<string, number>>(new Map());
  const [arrived, setArrived] = useState<{ mailbox: string; thread: string; message: string; from?: string }[]>([]);
  const [done, setDone] = useState<{ mailbox: string; task: string; thread: string; label?: string; subject?: string }[]>([]);
  const [waiting, setWaiting] = useState<Approval[]>([]);
  const [approvalsLooked, setApprovalsLooked] = useState(() => lookedSince("approvals"));
  // The clock, read again with each read of the feeds, so a task whose end was lost stops counting.
  const [now, setNow] = useState(Date.now);

  /** Fills in who sent each new message and what each task was, from its thread. */
  const describe = useCallback(
    async (mailbox: string, thread: string) => {
      const { data, response } = await client.GET("/mailboxes/{mailbox}/threads/{thread}", { params: { path: { mailbox, thread } } }).catch(() => ({ data: undefined, response: undefined }));
      if (response?.status === 401) return onSignedOut();
      if (data === undefined) return;
      setArrived((current) =>
        current.map((each) => {
          const message = each.thread === thread ? data.messages.find(({ id }) => id === each.message) : undefined;
          return message === undefined ? each : { ...each, from: message.from.name || message.from.address };
        }),
      );
      setDone((current) =>
        current.map((each) => {
          const task = each.thread === thread ? data.tasks?.find(({ id }) => id === each.task) : undefined;
          return task === undefined ? each : { ...each, label: task.labelName, subject: data.subject };
        }),
      );
    },
    [client, onSignedOut],
  );

  // A mailbox first seen in this browser has been looked at now, so its past is no news.
  useEffect(() => {
    for (const id of own) for (const what of ["mail", "tasks"]) lookedSince(`${what}.${id}`);
  }, [own]);

  const onChanges = useCallback(
    (changes: MailboxChange[]) => {
      setNow(Date.now());
      const arrivals: typeof arrived = [];
      const ended: typeof done = [];
      const starts = new Map<string, number>();
      const ends = new Set<string>();
      for (const { mailbox, change } of changes) {
        const at = Date.parse(change.at);
        // Only mail that came to the Inbox is news, not what the Screener, Spam or a delivery took.
        if (change.type === "messageReceived" && change.spam === undefined && change.screened === undefined && change.delivered === undefined && at > lookedSince(`mail.${mailbox}`)) {
          arrivals.push({ mailbox, thread: change.thread, message: change.message });
        } else if (change.type === "taskStarted") {
          starts.set(change.task, at);
          ends.delete(change.task);
        } else if (change.type === "taskEnded") {
          starts.delete(change.task);
          ends.add(change.task);
          if (change.outcome === "done" && at > lookedSince(`tasks.${mailbox}`)) ended.push({ mailbox, task: change.task, thread: change.thread });
        }
      }
      if (starts.size > 0 || ends.size > 0) setStarted((current) => new Map([...[...current].filter(([task]) => !ends.has(task)), ...starts]));
      // A read the app couldn't act on comes again, so what it already has isn't news twice.
      if (arrivals.length > 0) setArrived((current) => [...arrivals.filter(({ message }) => !current.some((each) => each.message === message)).toReversed(), ...current]);
      if (ended.length > 0) setDone((current) => [...ended.filter(({ task }) => !current.some((each) => each.task === task)).toReversed(), ...current]);
      for (const { mailbox, thread } of new Map([...arrivals, ...ended].map((each) => [`${each.mailbox}/${each.thread}`, each])).values()) void describe(mailbox, thread);
    },
    [describe],
  );

  const onApprovals = useCallback((approvals: Approval[]) => setWaiting(approvals), []);
  const onAsking = useCallback((running: boolean) => setAsking((current) => current + (running ? 1 : -1)), []);

  // Where the human looks ends the news about it, while the page is in sight.
  const [visible, setVisible] = useState(!document.hidden);
  useEffect(() => {
    const changed = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", changed);
    return () => document.removeEventListener("visibilitychange", changed);
  }, []);
  const { inbox, approvals, thread } = looking;
  const hasMail = arrived.some((each) => each.mailbox === inbox);
  // Leaving counts as looking until then too, since the feeds may bring what the human saw there later.
  useEffect(() => {
    if (!visible || inbox === undefined) return;
    look(`mail.${inbox}`);
    if (hasMail) setArrived((current) => current.filter((each) => each.mailbox !== inbox));
    return () => void look(`mail.${inbox}`);
  }, [visible, inbox, hasMail]);
  useEffect(() => {
    if (!visible || !approvals) return;
    setApprovalsLooked(look("approvals"));
    return () => setApprovalsLooked(look("approvals"));
  }, [visible, approvals, waiting]);
  const hasTask = done.some((each) => each.thread === thread);
  useEffect(() => {
    if (visible && thread !== undefined && hasTask) setDone((current) => current.filter((each) => each.thread !== thread));
  }, [visible, thread, hasTask]);
  const tasksSeen = useCallback(() => {
    if (mailbox === undefined) return;
    look(`tasks.${mailbox}`);
    setDone((current) => current.filter((each) => each.mailbox !== mailbox));
  }, [mailbox]);

  const news = useMemo<CooNews>(() => {
    if (mailbox === undefined) return quiet;
    return {
      mail: arrived.filter((each) => each.mailbox === mailbox),
      drafts: waiting.filter((approval) => approval.mailbox === mailbox && coos.has(approval.agent) && Date.parse(approval.askedAt) > approvalsLooked).length,
      tasks: done.filter((each) => each.mailbox === mailbox),
    };
  }, [mailbox, arrived, waiting, coos, approvalsLooked, done]);
  const working = asking > 0 || [...started.values()].some((at) => now - at < taskRunsFor);
  return { working, news, onChanges, onApprovals, onAsking, tasksSeen };
}
