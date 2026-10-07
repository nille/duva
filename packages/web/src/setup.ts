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

/** The organization's mailboxes, and the humans that own them. */
export interface Mailboxes {
  mailboxes: Mailbox[];
  owners: Actor[];
}

/** The actor that owns the mailbox. */
const ownerOf = (mailbox: Mailbox, { owners }: Mailboxes) => owners.find(({ id }) => id === mailbox.owner);

/** The name a mailbox goes by: its owner's address. */
export function ownerName(mailbox: Mailbox, listed: Mailboxes): string {
  const owner = ownerOf(mailbox, listed);
  return owner === undefined ? (mailbox.defaultAddress ?? mailbox.id) : owner.kind === "human" ? owner.email : owner.name;
}

/** Addresses compared as their characters are, so the order doesn't depend on the browser's language. */
export const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** One owner's mailboxes in the order every sheet numbers them: by default address, those without one last. */
export const ownersOrder = (a: Mailbox, b: Mailbox) =>
  (a.defaultAddress === undefined ? 1 : 0) - (b.defaultAddress === undefined ? 1 : 0) || byText(a.defaultAddress ?? a.id, b.defaultAddress ?? b.id);

/** The mailboxes by their owners' addresses, and each owner's in their order. */
export function byOwner(listed: Mailboxes): Mailbox[] {
  return [...listed.mailboxes].sort((a, b) => ownerName(a, listed).localeCompare(ownerName(b, listed)) || ownersOrder(a, b));
}
