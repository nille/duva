// What the admins' sheets in Settings share: calling Duva for a change, saying why one failed, and
// naming a mailbox by the actor that owns it.
import type { components } from "@duva/openapi";
import { strings } from "./strings.ts";

type Mailbox = components["schemas"]["Mailbox"];
type Actor = components["schemas"]["Actor"];

export interface Answer<Data> {
  data?: Data;
  error?: { message?: string };
  response?: Response;
}

/** The call's answer, with no response when Duva couldn't be reached. */
export const attempt = <Data>(call: Promise<Answer<Data>>): Promise<Answer<Data>> => call.catch(() => ({}));

/**
 * Makes the change the call asks for. Answers what Duva answered, or why it failed in words: Duva's
 * own reason for a refusal, which says what to do, or the error. Answers nothing when the session
 * has ended, after `onSignedOut`.
 */
export async function change<Data>(call: Promise<Answer<Data>>, onSignedOut: () => void): Promise<{ data: Data } | { failed: string } | undefined> {
  const answer = await attempt(call);
  if (answer.data !== undefined) return { data: answer.data };
  if (answer.response === undefined) return { failed: strings.setup.unreachable };
  const status = answer.response.status;
  if (status === 401) return void onSignedOut();
  return { failed: status >= 400 && status < 500 && answer.error?.message !== undefined ? answer.error.message : strings.setup.failed(status) };
}

/** The organization's mailboxes, and the actors that own them. */
export interface Mailboxes {
  mailboxes: Mailbox[];
  owners: Actor[];
}

/** The actor that owns the mailbox. */
const ownerOf = (mailbox: Mailbox, { owners }: Mailboxes) => owners.find(({ id }) => id === mailbox.owner);

/** Whether an agent owns the mailbox. */
export const isAgents = (mailbox: Mailbox, listed: Mailboxes) => ownerOf(mailbox, listed)?.kind === "agent";

/** The name a mailbox goes by: its owner's, a human's address or an agent's name. */
export function ownerName(mailbox: Mailbox, listed: Mailboxes): string {
  const owner = ownerOf(mailbox, listed);
  return owner === undefined ? (mailbox.defaultAddress ?? mailbox.id) : owner.kind === "human" ? owner.email : owner.name;
}

/** The mailboxes humans' first, by address, then agents', by name. */
export function byOwner(listed: Mailboxes): Mailbox[] {
  const rank = (mailbox: Mailbox) => (isAgents(mailbox, listed) ? 1 : 0);
  return [...listed.mailboxes].sort((a, b) => rank(a) - rank(b) || ownerName(a, listed).localeCompare(ownerName(b, listed)) || a.id.localeCompare(b.id));
}
