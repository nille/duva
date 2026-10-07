// Following the change feeds of the mailboxes the signed-in human can read, and an admin's of the
// organization too, so the web app learns about new mail, approval requests and sends without
// reloading. It polls for now; a stream comes later.
import { useEffect, useRef } from "react";
import type { DuvaClient } from "@duva/client";
import type { components } from "@duva/openapi";

export type Change = components["schemas"]["MailboxChange"];
export type OrganizationChange = components["schemas"]["OrganizationChange"];

/** A change, with the mailbox it was made in. */
export interface MailboxChange {
  mailbox: string;
  change: Change;
}

/** The changes that alter what the Approvals view shows: a request, its decision, or how its send went. */
export const approvalChanges = new Set<Change["type"]>(["approvalAsked", "approvalWithdrawn", "approvalDecided", "approvalUndone", "messageSent", "sendFailed", "sendUnclear"]);

/** The changes that alter what a mailbox's threads show: mail in or out, read state, labels, Remind me and erasure. */
export const mailChanges = new Set<Change["type"]>(["messageReceived", "messageSent", "threadRead", "threadUnread", "threadLabelsChanged", "reminderSet", "reminderCancelled", "threadBack", "threadErased"]);

/** The changes to a mailbox's Screener: its decisions on senders, and switching it. */
export const screenerChanges = new Set<Change["type"]>(["senderScreened", "screenedSenderRemoved", "senderDeliverySet", "senderDeliveryRemoved", "screenerSwitched"]);

/** The changes to a mailbox's own labels. */
export const labelChanges = new Set<Change["type"]>(["labelCreated", "labelRenamed", "labelDeleted"]);

/** The changes that alter a mailbox's drafts: writing, deleting and sending them, and erasing the threads they sent in. */
export const draftChanges = new Set<Change["type"]>(["draftWritten", "draftChanged", "draftDeleted", "sendAsked", "approvalAsked", "approvalDecided", "approvalUndone", "sendFailed", "sendUnclear", "threadErased"]);

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

/** The organization's changes that alter which mailboxes a human reads, or the addresses they show with. */
export const mailboxSetupChanges = new Set<OrganizationChange["type"]>(["mailboxAdded", "mailboxHandedOver", "mailboxDeleted", "actorRemoved", "addressAdded", "addressRemoved", "defaultAddressChanged"]);

/**
 * The feeds of every mailbox the client can read, and the organization's if `organization`, each
 * followed from where this browser left off. Positions are kept in localStorage, so opening the
 * web app again doesn't read a feed from the start. `mailboxes` gives the mailboxes as the caller
 * last listed them, so the feeds don't list them on every read.
 */
function mailboxFeeds(client: DuvaClient, organization: boolean, mailboxes: () => readonly string[]) {
  const positions = new Map<string, number>();
  const key = (mailbox: string) => `duva.feed.${mailbox}`;

  /**
   * Reads every mailbox's feed to its end. Answers the changes read, whether a mailbox couldn't be
   * read anymore, and how to keep the new positions once the caller has acted on them, so a failure
   * there loses nothing.
   */
  async function catchUp(): Promise<{ changes: MailboxChange[]; organization: OrganizationChange[]; gone: boolean; keep: () => void }> {
    const read = new Map<string, number>();
    // The organization's feed is read first, so a mailbox it says was added is followed at once.
    const setup: OrganizationChange[] = [];
    if (organization) {
      let after = positions.get(organizationFeed) ?? Number(localStorage.getItem(key(organizationFeed)) ?? 0);
      for (;;) {
        const { data: page, response } = await client.GET("/organization/changes", { params: { query: { after } } });
        if (response.status === 401) throw new SignedOut();
        // A human who stopped being an admin reads only their mailboxes' feeds from then on.
        if (response.status === 403) break;
        if (page === undefined) throw new Error(`Duva answered ${response.status} reading the organization's changes.`);
        setup.push(...page.changes);
        if (page.position === after) break;
        after = page.position;
      }
      read.set(organizationFeed, after);
    }
    const changes: MailboxChange[] = [];
    let gone = false;
    for (const id of mailboxes()) {
      let after = positions.get(id) ?? Number(localStorage.getItem(key(id)) ?? 0);
      for (;;) {
        const { data: page, response } = await client.GET("/mailboxes/{mailbox}/changes", { params: { path: { mailbox: id }, query: { after } } });
        if (response.status === 401) throw new SignedOut();
        // A mailbox deleted, handed over or no longer sponsored is gone, so the caller lists them again.
        if (response.status === 403 || response.status === 404) {
          gone = true;
          break;
        }
        if (page === undefined) throw new Error(`Duva answered ${response.status} reading a mailbox's changes.`);
        changes.push(...page.changes.map((change) => ({ mailbox: id, change })));
        if (page.position === after) break;
        after = page.position;
      }
      read.set(id, after);
    }
    return {
      changes,
      organization: setup,
      gone,
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

// Where the organization's feed is kept among the mailboxes', whose IDs are UUIDs.
const organizationFeed = "organization";

/**
 * Hands a view each read's changes, the mailboxes' and the organization's, until it calls the
 * function returned. A view that throws keeps the read from counting, so its changes come again.
 */
export type Follow = (listener: (changes: MailboxChange[], organization: OrganizationChange[]) => Promise<void>) => () => void;

/** How the last read of the feeds went. */
export type Connection = { ok: true; at: Date } | { ok: false } | undefined;

/**
 * Reads the feeds every few seconds while the tab is visible, less often while it is hidden, and at
 * once when it becomes visible again, the organization's too for an admin. Hands `onChanges` what
 * each read found, `first` on the first read, which also passes everything that happened while the
 * app was closed, and `gone` when a mailbox in `mailboxes` couldn't be read anymore, so they need
 * listing again. Stops when the session has ended.
 */
export function useFeeds(
  client: DuvaClient,
  {
    interval = defaultPollInterval,
    hiddenInterval = defaultHiddenPollInterval,
    organization = false,
    onChanges,
    mailboxes,
    onConnection,
    onSignedOut,
  }: {
    interval?: number;
    hiddenInterval?: number;
    organization?: boolean;
    /** The IDs of the mailboxes to follow, as the caller last listed them. */
    mailboxes: readonly string[];
    onChanges: (changes: MailboxChange[], first: boolean, organization: OrganizationChange[], gone: boolean) => Promise<void> | void;
    onConnection: (connection: Connection) => void;
    onSignedOut: () => void;
  },
) {
  // The latest callbacks, so the loop doesn't restart when the caller renders.
  const callbacks = useRef({ onChanges, onConnection, onSignedOut });
  callbacks.current = { onChanges, onConnection, onSignedOut };
  const followed = useRef(mailboxes);
  followed.current = mailboxes;
  // Reads at once, or again as soon as the read under way ends, as when the mailboxes are listed anew.
  const readSoon = useRef<() => void>(undefined);

  useEffect(() => {
    let stopped = false;
    let running = false;
    // Whether something asked for a read during one, which may have started before what it was for.
    let askedDuringRead = false;
    let first = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const feeds = mailboxFeeds(client, organization, () => followed.current);
    const tick = async () => {
      if (running || stopped) return;
      running = true;
      askedDuringRead = false;
      clearTimeout(timer);
      try {
        const { changes, organization: setup, gone, keep } = await feeds.catchUp();
        if (stopped) return;
        await callbacks.current.onChanges(changes, first, setup, gone);
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
      if (!stopped) timer = setTimeout(() => void tick(), askedDuringRead ? 0 : document.hidden ? hiddenInterval : interval);
    };
    readSoon.current = () => {
      if (running) askedDuringRead = true;
      else void tick();
    };
    const onVisibility = () => {
      if (!document.hidden) readSoon.current?.();
    };
    void tick();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [client, interval, hiddenInterval, organization]);
  // Mailboxes listed anew are followed from the next read, which comes at once.
  const followedKey = mailboxes.join();
  useEffect(() => {
    readSoon.current?.();
  }, [followedKey]);
}
