// Following the change feeds of the mailboxes the signed-in human can read, so the web app learns
// about new approval requests and sends without reloading. It polls for now; a stream comes later.
import type { DuvaClient } from "@duva/client";
import type { components } from "@duva/openapi";

type Change = components["schemas"]["MailboxChange"];

/** The changes that alter what the Approvals view shows: a request, its decision, or how its send went. */
const approvalChanges = new Set<Change["type"]>(["approvalAsked", "approvalWithdrawn", "approvalDecided", "messageSent", "sendFailed", "sendUnclear"]);

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
export function mailboxFeeds(client: DuvaClient) {
  const positions = new Map<string, number>();
  const key = (mailbox: string) => `duva.feed.${mailbox}`;

  /**
   * Reads every mailbox's feed to its end. Answers whether any change touched an approval, and how
   * to keep the new positions once the caller has acted on that, so a failure there loses nothing.
   */
  async function catchUp(): Promise<{ touched: boolean; keep: () => void }> {
    const { data: list, response } = await client.GET("/mailboxes");
    if (response.status === 401) throw new SignedOut();
    if (list === undefined) throw new Error(`Duva answered ${response.status} listing mailboxes.`);
    let touched = false;
    const read = new Map<string, number>();
    for (const { id } of list.mailboxes) {
      let after = positions.get(id) ?? Number(localStorage.getItem(key(id)) ?? 0);
      for (;;) {
        const { data: page, response } = await client.GET("/mailboxes/{mailbox}/changes", { params: { path: { mailbox: id }, query: { after } } });
        if (response.status === 401) throw new SignedOut();
        if (page === undefined) throw new Error(`Duva answered ${response.status} reading a mailbox's changes.`);
        touched ||= page.changes.some((change) => approvalChanges.has(change.type));
        if (page.position === after) break;
        after = page.position;
      }
      read.set(id, after);
    }
    return {
      touched,
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
