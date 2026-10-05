// Following the change feeds of the mailboxes the signed-in human can read, so the web app learns
// about new mail, approval requests and sends without reloading. It polls for now; a stream comes later.
import { useEffect, useRef } from "react";
import type { DuvaClient } from "@duva/client";
import type { components } from "@duva/openapi";

export type Change = components["schemas"]["MailboxChange"];

/** A change, with the mailbox it was made in. */
export interface MailboxChange {
  mailbox: string;
  change: Change;
}

/** The changes that alter what the Approvals view shows: a request, its decision, or how its send went. */
export const approvalChanges = new Set<Change["type"]>(["approvalAsked", "approvalWithdrawn", "approvalDecided", "messageSent", "sendFailed", "sendUnclear"]);

/** The changes that alter what a mailbox's threads show: mail in or out, read state, labels and erasure. */
export const mailChanges = new Set<Change["type"]>(["messageReceived", "messageSent", "threadRead", "threadUnread", "threadLabelsChanged", "threadErased"]);

/** The changes to a mailbox's own labels. */
export const labelChanges = new Set<Change["type"]>(["labelCreated", "labelRenamed", "labelDeleted"]);

/** The changes that alter a mailbox's drafts: writing, deleting and sending them, and erasing the threads they sent in. */
export const draftChanges = new Set<Change["type"]>(["draftWritten", "draftChanged", "draftDeleted", "sendAsked", "approvalAsked", "approvalDecided", "sendFailed", "sendUnclear", "threadErased"]);

/** How often the signed-in app reads the change feeds while its tab is visible, unless config.json says otherwise. */
export const defaultPollInterval = 5_000;

/**
 * How often it reads them while its tab is hidden, so the tab's title keeps counting new mail.
 * Browsers slow a hidden tab's timers to about once a minute anyway. A tab left open in the
 * background costs a few requests a minute, which keeps idle cost near zero (ADR-0006).
 */
export const defaultHiddenPollInterval = 30_000;

/** Thrown when Duva answers 401, so the human must sign in again. */
export class SignedOut extends Error {
  constructor() {
    super("The session has ended.");
    this.name = "SignedOut";
  }
}

/**
 * The feeds of every mailbox the client can read, each followed from where this browser left off.
 * Positions are kept in localStorage, so opening the web app again doesn't read a feed from the start.
 */
function mailboxFeeds(client: DuvaClient) {
  const positions = new Map<string, number>();
  const key = (mailbox: string) => `duva.feed.${mailbox}`;

  /**
   * Reads every mailbox's feed to its end. Answers the changes read, and how to keep the new
   * positions once the caller has acted on them, so a failure there loses nothing.
   */
  async function catchUp(): Promise<{ changes: MailboxChange[]; keep: () => void }> {
    const { data: list, response } = await client.GET("/mailboxes");
    if (response.status === 401) throw new SignedOut();
    if (list === undefined) throw new Error(`Duva answered ${response.status} listing mailboxes.`);
    const changes: MailboxChange[] = [];
    const read = new Map<string, number>();
    for (const { id } of list.mailboxes) {
      let after = positions.get(id) ?? Number(localStorage.getItem(key(id)) ?? 0);
      for (;;) {
        const { data: page, response } = await client.GET("/mailboxes/{mailbox}/changes", { params: { path: { mailbox: id }, query: { after } } });
        if (response.status === 401) throw new SignedOut();
        if (page === undefined) throw new Error(`Duva answered ${response.status} reading a mailbox's changes.`);
        changes.push(...page.changes.map((change) => ({ mailbox: id, change })));
        if (page.position === after) break;
        after = page.position;
      }
      read.set(id, after);
    }
    return {
      changes,
      keep() {
        for (const [id, after] of read) {
          positions.set(id, after);
          localStorage.setItem(key(id), String(after));
        }
      },
    };
  }

  return { catchUp };
}

/** Hands a view each read's changes until it calls the function returned. A view that throws keeps the read from counting, so its changes come again. */
export type Follow = (listener: (changes: MailboxChange[]) => Promise<void>) => () => void;

/** How the last read of the feeds went. */
export type Connection = { ok: true; at: Date } | { ok: false } | undefined;

/**
 * Reads the feeds every few seconds while the tab is visible, less often while it is hidden, and at
 * once when it becomes visible again. Hands `onChanges` what each read found, `first` on the first read, which also passes
 * everything that happened while the app was closed. Stops when the session has ended.
 */
export function useFeeds(
  client: DuvaClient,
  {
    interval = defaultPollInterval,
    hiddenInterval = defaultHiddenPollInterval,
    onChanges,
    onConnection,
    onSignedOut,
  }: {
    interval?: number;
    hiddenInterval?: number;
    onChanges: (changes: MailboxChange[], first: boolean) => Promise<void> | void;
    onConnection: (connection: Connection) => void;
    onSignedOut: () => void;
  },
) {
  // The latest callbacks, so the loop doesn't restart when the caller renders.
  const callbacks = useRef({ onChanges, onConnection, onSignedOut });
  callbacks.current = { onChanges, onConnection, onSignedOut };

  useEffect(() => {
    let stopped = false;
    let running = false;
    // Whether the tab became visible during a read, which may have started before what arrived meanwhile.
    let visibleDuringRead = false;
    let first = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const feeds = mailboxFeeds(client);
    const tick = async () => {
      if (running || stopped) return;
      running = true;
      visibleDuringRead = false;
      clearTimeout(timer);
      try {
        const { changes, keep } = await feeds.catchUp();
        if (stopped) return;
        await callbacks.current.onChanges(changes, first);
        keep();
        first = false;
        if (!stopped) callbacks.current.onConnection({ ok: true, at: new Date() });
      } catch (error) {
        if (stopped) return;
        if (error instanceof SignedOut) {
          stopped = true;
          callbacks.current.onSignedOut();
        } else {
          callbacks.current.onConnection({ ok: false });
        }
      } finally {
        running = false;
      }
      if (!stopped) timer = setTimeout(() => void tick(), visibleDuringRead ? 0 : document.hidden ? hiddenInterval : interval);
    };
    const onVisibility = () => {
      if (document.hidden) return;
      if (running) visibleDuringRead = true;
      else void tick();
    };
    void tick();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [client, interval, hiddenInterval]);
}
