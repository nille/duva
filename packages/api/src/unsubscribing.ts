// Unsubscribing on block (ADR-0016): only by RFC 8058 one-click, from the sender's newest mail that
// SES didn't judge to be spam, and only when a DKIM signature that SES found passing covers both
// unsubscribe headers, so no one but the signer can have put the URL there. Never by mailto, and
// never by a link in the body. SES heads each raw copy it stores with its verdicts, the spam verdict
// and an Authentication-Results with a DKIM result per signature, and those come first.
import type { Table } from "./deployment.ts";
import { recordChanges } from "./feed.ts";
import type { MailBucket } from "./mail-bucket.ts";
import { receivedFrom } from "./mail.ts";
import { mailboxFeed } from "./organization.ts";
import { type Sender, screenedSenders } from "./screening.ts";
import type { Unsubscribe, Unsubscriber } from "./unsubscriber.ts";

/** How many of the sender's newest messages are read for one SES didn't judge to be spam. */
const messagesRead = 10;

/**
 * Unsubscribes the mailbox from the sender's mail by one-click, if their newest mail that SES
 * didn't judge to be spam offers it, on behalf of the actor `by`, who blocked the sender. For a
 * domain, that is the newest mail from an address on exactly that domain, except those the mailbox
 * let in, since their own decision beats the block. Records the outcome in the mailbox's change
 * feed, and returns it.
 */
export async function unsubscribeFrom(
  { table, mailBucket, unsubscriber }: { table: Table; mailBucket: MailBucket; unsubscriber: Unsubscriber },
  { mailbox, sender, by }: { mailbox: string; sender: Sender; by: string },
): Promise<Unsubscribe> {
  const from = "address" in sender ? (address: string) => address === sender.address : await onDomain(table, mailbox, sender.domain);
  const outcome = await unsubscribe(mailBucket, unsubscriber, await receivedFrom(table, mailbox, from));
  await recordChanges(table, mailboxFeed(mailbox), { by, changes: [{ type: "unsubscribeAttempted", ...sender, ...outcome }], items: [] });
  return outcome;
}

/** Whether an address is on exactly the domain, and the mailbox hasn't let it in. */
async function onDomain(table: Table, mailbox: string, domain: string): Promise<(address: string) => boolean> {
  const letIn = new Set((await screenedSenders(table, mailbox)).flatMap((decided) => ("address" in decided && decided.decision === "letIn" ? [decided.address] : [])));
  return (address) => address.slice(address.lastIndexOf("@") + 1) === domain && !letIn.has(address);
}

async function unsubscribe(mailBucket: MailBucket, unsubscriber: Unsubscriber, received: { rawKey: string }[]): Promise<Unsubscribe> {
  let sawSpam = false;
  for (const { rawKey } of received.slice(0, messagesRead)) {
    const raw = await mailBucket.get(rawKey);
    if (raw === undefined) continue;
    const offer = oneClickOffered(fieldsOf(raw));
    if (offer === "spam") {
      sawSpam = true;
      continue;
    }
    if (offer === "noOneClick" || offer === "notSigned") return { outcome: "notOffered", reason: offer };
    return unsubscriber.post(offer.url);
  }
  return { outcome: "notOffered", reason: sawSpam ? "spam" : "noMail" };
}

/** A header field: its name in lower case, and its value unfolded. */
interface Field {
  name: string;
  value: string;
}

/** The header fields of the raw message, in order. */
function fieldsOf(raw: Uint8Array): Field[] {
  const text = new TextDecoder().decode(raw);
  const end = text.search(/\r?\n\r?\n/);
  const header = end < 0 ? text : text.slice(0, end);
  return header
    .split(/\r?\n(?![ \t])/)
    .map((field) => {
      const colon = field.indexOf(":");
      return { name: field.slice(0, colon).trim().toLowerCase(), value: field.slice(colon + 1).replace(/\r?\n[ \t]/g, " ").trim() };
    })
    .filter(({ name }) => name !== "");
}

/**
 * The one-click URL the message offers, or why it offers none: SES judged it to be spam, it has no
 * https List-Unsubscribe with List-Unsubscribe-Post One-Click, each exactly once, or no signature
 * that passed covers both.
 */
function oneClickOffered(fields: Field[]): { url: string } | "spam" | "noOneClick" | "notSigned" {
  const first = (name: string) => fields.find((field) => field.name === name)?.value;
  if (first("x-ses-spam-verdict")?.toUpperCase() === "FAIL") return "spam";
  const all = (name: string) => fields.filter((field) => field.name === name).map(({ value }) => value);
  const [unsubscribe, ...moreUnsubscribe] = all("list-unsubscribe");
  const [post, ...morePost] = all("list-unsubscribe-post");
  if (unsubscribe === undefined || post === undefined || moreUnsubscribe.length > 0 || morePost.length > 0) return "noOneClick";
  if (post.toLowerCase() !== "list-unsubscribe=one-click") return "noOneClick";
  const url = [...unsubscribe.matchAll(/<([^>]*)>/g)].map(([, uri]) => uri!.replace(/\s/g, "")).find((uri) => /^https:\/\//i.test(uri));
  if (url === undefined || !URL.canParse(url)) return "noOneClick";
  return signedPassing(fields) ? { url } : "notSigned";
}

/**
 * Whether a DKIM signature covers both unsubscribe headers, and every DKIM result SES gave for its
 * domain passed. SES's Authentication-Results is the first, and names each signature by its
 * identity, which is on the signature's domain or under it. So a signature that fails beside a
 * passing one of the same domain refuses both.
 */
function signedPassing(fields: Field[]): boolean {
  const results = fields.find(({ name }) => name === "authentication-results")?.value.split(";").map((part) => part.trim());
  if (results?.[0]?.toLowerCase() !== "amazonses.com") return false;
  const dkim = results.flatMap((result) => {
    const verdict = /^dkim=(\w+)/i.exec(result)?.[1]?.toLowerCase();
    if (verdict === undefined || verdict === "none") return [];
    const identity = /\bheader\.[id]=(\S+)/i.exec(result)?.[1];
    return [{ passed: verdict === "pass", domain: identity?.slice(identity.lastIndexOf("@") + 1).toLowerCase() }];
  });
  // A failed result that names no signature could be any of them.
  if (dkim.some(({ passed, domain }) => !passed && domain === undefined)) return false;
  return fields
    .filter(({ name }) => name === "dkim-signature")
    .some(({ value }) => {
      const tags = new Map(value.split(";").map((tag) => tag.replace(/\s/g, "").split("=", 2) as [string, string]).map(([name, tagged = ""]) => [name.toLowerCase(), tagged]));
      const signed = (tags.get("h") ?? "").toLowerCase().split(":");
      const domain = tags.get("d")?.toLowerCase();
      if (domain === undefined || !signed.includes("list-unsubscribe") || !signed.includes("list-unsubscribe-post")) return false;
      const ofDomain = dkim.filter((result) => result.domain === domain || result.domain?.endsWith(`.${domain}`));
      return ofDomain.length > 0 && ofDomain.every(({ passed }) => passed);
    });
}
