// The mailbox agent unsubscribing harder, for a sender whose mail goes nowhere, once one-click
// didn't (ADR-0031). It goes on by itself, in order: on the List-Unsubscribe page, by mailing the
// List-Unsubscribe address, by an unsubscribe link in the body, and as a last resort by bouncing
// the message as if the address were unknown. It stops at the first method that works, and once it
// bounces, it bounces each later message. Every attempt is recorded under the agent, in the
// mailbox's change feed and on the sender's decision, and stops if the decision changed meanwhile,
// as when the sender was set back to the Inbox. Choosing nowhere was the owner's consent, so
// nothing waits for an approval, but a paused agent, or one its owner gave no access, does nothing.
import { sponsorAccessIn } from "./access.ts";
import { type AgentRuntime, capRefusal, runMailboxAgent, runtimeMissing, startRun } from "./agent-runs.ts";
import type { Table } from "./deployment.ts";
import { sendUnsubscribeRequest } from "./drafting.ts";
import { domainOf } from "./email-address.ts";
import { BounceRefused, type Bounces, claim } from "./group-mail.ts";
import { mailboxAgentIn } from "./mailbox-agents.ts";
import { type Agent, agentSettings, allDomains, findActor, findMailbox, type Mailbox } from "./organization.ts";
import { decisionOn, leaseUnsubscribing, noteUnsubscribe, type ScreenedSender } from "./screening.ts";
import type { Offer } from "./unsubscribe-offers.ts";
import type { UnsubscribeJob } from "./unsubscribing.ts";

type Method = NonNullable<ScreenedSender["unsubscribe"]>["method"];
type Attempt = Omit<NonNullable<ScreenedSender["unsubscribe"]>, "method" | "at" | "actor">;

/** How long after receiving a message SES bounces it, in milliseconds (docs/aws.md). */
const bounceWindow = 24 * 60 * 60_000;
/** How long the runner starts browser attempts for, short of Lambda's 15 minutes, in milliseconds. */
const browsingFor = 9 * 60_000;
/** How long a run holds the lease on a sender, past Lambda's 15 minutes, so one that stopped partway doesn't hold it for good. */
const leasedFor = 16 * 60_000;

/** The methods after one-click, in the order the agent tries them. */
const methods: Exclude<Method, "oneClick">[] = ["page", "mailto", "link", "bounce"];

/**
 * The runner's handler for each job one-click left: runs the methods in order, until one works,
 * or for a sender it bounces already, only the bounce. One run at a time goes through the methods
 * for a sender, and a job that finds another going leaves the sender to it. Each message is
 * bounced once, whichever run gets to it.
 */
export function createUnsubscribeRunner({ table, region, apiUrl, runtime, bounces }: { table: Table; region: string; apiUrl: string; runtime: AgentRuntime | undefined; bounces: Bounces }) {
  return async (job: UnsubscribeJob): Promise<void> => {
    const started = Date.now();
    const current = async () => {
      const decided = await decisionOn(table, job.mailbox, job.sender);
      return decided?.delivery === "nowhere" && decided.decidedAt === job.decidedAt ? decided : undefined;
    };
    // A run before it may have worked meanwhile, for a message dropped earlier.
    const decided = await current();
    if (decided === undefined || decided.unsubscribe?.outcome === "unsubscribed" || decided.unsubscribe?.outcome === "requested") return;
    const working = await workingAgent(table, job.mailbox);
    if (working === undefined) return;
    const { agent, mailbox, owner } = working;
    const browse = async (url: string): Promise<Attempt> => {
      if (runtime === undefined) return { outcome: "failed", reason: "notDone", detail: runtimeMissing(region) };
      const run = await startRun(table, { agent, mailbox, mailboxes: [mailbox], owner, region, apiUrl, job: "unsubscribe" });
      if ("refused" in run) return { outcome: "failed", reason: "notDone", detail: run.refused };
      const ran = runMailboxAgent(table, { agent, payload: { ...run.start, history: [], words: "", unsubscribe: { url, address: job.offer.recipient } }, runtime, month: run.month, cap: run.cap });
      let next = await ran.next();
      while (!next.done) next = await ran.next();
      const { verdict, outcome } = next.value;
      if (verdict?.unsubscribed === true) return { outcome: "unsubscribed", detail: verdict.detail };
      return { outcome: "failed", reason: "notDone", detail: verdict?.detail ?? (outcome === "capReached" ? capRefusal(run.cap) : "The model or the runtime failed partway.") };
    };
    const attempt = async (method: (typeof methods)[number]): Promise<Attempt | undefined> => {
      const { offer } = job;
      const browsing = Date.now() - started < browsingFor;
      if (method === "page") return offer.page === undefined || !browsing ? undefined : browse(offer.page);
      if (method === "link") {
        let tried: Attempt | undefined;
        for (const link of offer.links) {
          if (Date.now() - started >= browsingFor || !(await current())) break;
          tried = await browse(link);
          if (tried.outcome === "unsubscribed") break;
        }
        return tried;
      }
      if (method === "mailto") return offer.mailto === undefined ? undefined : mail(table, { agent, mailbox, offer, mailto: offer.mailto });
      return bounce(table, bounces, offer, job.mailbox);
    };
    const note = (method: Method, tried: Attempt) =>
      noteUnsubscribe(table, {
        mailbox: job.mailbox,
        sender: job.sender,
        decidedAt: job.decidedAt,
        unsubscribe: { method, ...tried, at: new Date().toISOString(), actor: agent.id },
        change: { ...job.sender, method, ...tried },
        by: agent.id,
      });
    if (bouncing(decided)) {
      const tried = await attempt("bounce");
      if (tried !== undefined) await note("bounce", tried);
      return;
    }
    const release = await leaseUnsubscribing(table, job, new Date(started + leasedFor));
    if (release === undefined) return;
    try {
      for (const method of methods) {
        if ((await current()) === undefined) return;
        const tried = await attempt(method);
        if (tried === undefined) continue;
        if (!(await note(method, tried)) || tried.outcome !== "failed") return;
      }
    } finally {
      await release();
    }
  };
}

/** The mailbox's owner's mailbox agent, the mailbox and the owner's address, unless it is paused or its owner gave it no access there. */
async function workingAgent(table: Table, mailboxId: string): Promise<{ agent: Agent; mailbox: Mailbox; owner: string } | undefined> {
  const mailbox = await findMailbox(table, mailboxId);
  const agent = mailbox === undefined ? undefined : await mailboxAgentIn(table, mailbox);
  if (agent === undefined || agent.paused !== undefined || mailbox === undefined) return undefined;
  const owner = await findActor(table, mailbox.owner);
  if (owner?.kind !== "human" || owner.id !== agent.sponsor) return undefined;
  if (sponsorAccessIn((await agentSettings(table, agent.id)).settings, mailbox.id) === "none") return undefined;
  return { agent, mailbox, owner: owner.email };
}

/**
 * Mails the unsubscribe address, from the mailbox's address the message was sent to, or its
 * default if that isn't one of its own, with the subject and body the URI gives.
 */
async function mail(table: Table, { agent, mailbox, offer, mailto }: { agent: Agent; mailbox: Mailbox; offer: Offer; mailto: NonNullable<Offer["mailto"]> }): Promise<Attempt> {
  const untagged = offer.recipient.replace(/\+[^@]*@/, "@");
  const from = mailbox.addresses.includes(untagged) ? offer.recipient : (mailbox.defaultAddress ?? mailbox.addresses[0]);
  if (from === undefined) return { outcome: "failed", reason: "notSent", detail: "The mailbox has no address to send from." };
  try {
    await sendUnsubscribeRequest(table, { mailbox: mailbox.id, agent: agent.id, content: { from, to: [{ address: mailto.to }], cc: [], bcc: [], subject: mailto.subject, text: mailto.body } });
    return { outcome: "requested", detail: `Mailed ${mailto.to}.` };
  } catch (error) {
    console.error(error);
    return { outcome: "failed", reason: "notSent", detail: "Duva couldn't write the mail." };
  }
}

/**
 * Has SES bounce the message to its envelope sender with a 5.1.1 for the address it was sent to,
 * so their list sees the address as gone. Never for mail from the organization's own domains,
 * mail that didn't pass DMARC or has no envelope sender, or past SES's 24 hours.
 */
async function bounce(table: Table, bounces: Bounces, offer: Offer, mailbox: string): Promise<Attempt | undefined> {
  const own = new Set((await allDomains(table)).map(({ domain }) => domain));
  if (own.has(domainOf(offer.from)) || (offer.envelopeSender !== undefined && own.has(domainOf(offer.envelopeSender)))) {
    return { outcome: "failed", reason: "ownDomain" };
  }
  if (!offer.dmarcPassed) return { outcome: "failed", reason: "notDmarc" };
  if (offer.envelopeSender === undefined) return { outcome: "failed", reason: "noEnvelopeSender" };
  if (Date.now() - new Date(offer.receivedAt).getTime() > bounceWindow) return { outcome: "failed", reason: "tooLate" };
  // A message handed on twice, as a repeated event or invocation can, is bounced once. A bounce SES refuses isn't tried again.
  const release = await claim(table, offer.sesMessageId, `unsubscribe-bounced#${mailbox}`);
  if (release === undefined) return undefined;
  try {
    await bounces.send({ messageId: offer.sesMessageId, bounceSender: `mailer-daemon@${domainOf(offer.recipient)}`, recipients: [offer.recipient], explanation: "The address doesn't exist.", status: "5.1.1" });
    return { outcome: "bounced" };
  } catch (error) {
    if (!(error instanceof BounceRefused)) {
      await release();
      throw error;
    }
    return { outcome: "failed", reason: "refused", detail: error.message };
  }
}

/** Whether the agent bounces the sender's mail already, so it bounces each later message and tries nothing else. */
export const bouncing = (decided: ScreenedSender) => decided.unsubscribe?.method === "bounce" && decided.unsubscribe.outcome === "bounced";
