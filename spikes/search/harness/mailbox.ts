// The benchmark mailbox: 100,000 messages, of which 97,000 come from the
// Enron corpus and 3,000 are generated Swedish mail. Threads come from
// subjects and the people on them, and labels are assigned per thread in
// shares a real mailbox has.
// The same corpus file gives the same mailbox on every run.
import { createHash } from "node:crypto";
import type { Message } from "../src/search.ts";
import { messages as corpus, type CorpusMessage } from "./enron.ts";
import { swedishMessages } from "./swedish.ts";

export const mailboxSize = { enron: 97_000, swedish: 3_000 };

// Each label's share of threads. Spam and Trash threads carry nothing else.
// Of the rest, a few are in the Inbox and most are archived, which leaves
// them without it. User labels sit on top, independently.
export const labelShares = {
  Spam: 0.03,
  Trash: 0.05,
  Inbox: 0.12,
  user: { Projects: 0.08, Finance: 0.06, Important: 0.04, Legal: 0.03, Travel: 0.02 },
};

export async function benchmarkMailbox(corpusFile: string): Promise<Message[]> {
  const enron = await sample(corpusFile, mailboxSize.enron);
  const dates = enron.map((m) => m.date.getTime()).sort((a, b) => a - b);
  const between = { from: new Date(dates[0]!), to: new Date(dates.at(-1)!) };
  const all = [...enron, ...swedishMessages(mailboxSize.swedish, between)];
  return all.map(withThreadAndLabels).sort((a, b) => a.date.getTime() - b.date.getTime());
}

// The messages with the lowest ids, which are hashes of their content, so the
// sample spreads over every employee's mailbox and every year. Only the lowest
// half of the hash range is held while reading, to bound memory.
async function sample(corpusFile: string, size: number): Promise<CorpusMessage[]> {
  const kept: CorpusMessage[] = [];
  for await (const message of corpus(corpusFile)) {
    if (message.id < "enron-8") kept.push(message);
  }
  if (kept.length < size) throw new Error(`The corpus gave ${kept.length} messages, fewer than ${size}.`);
  return kept.sort((a, b) => (a.id < b.id ? -1 : 1)).slice(0, size);
}

// The corpus has no In-Reply-To headers to follow, so a thread is a subject
// without its reply and forward prefixes, among the same people: a reply
// swaps sender and recipient but keeps the set. A common subject like
// "meeting" between other people is another thread.
function withThreadAndLabels(message: CorpusMessage): Message {
  const topic = message.subject.replace(/^((re|fw|fwd|sv|vb)\s*:\s*)+/i, "").trim().toLowerCase();
  const people = [...new Set([message.sender, ...message.recipients])].sort().join(",");
  const thread = topic ? `thread-${hash(`${topic}\n${people}`).toString(16)}` : `thread-${message.id}`;
  return { ...message, thread, labels: labels(thread) };
}

function labels(thread: string): string[] {
  const roll = share(thread, "built-in");
  if (roll < labelShares.Spam) return ["Spam"];
  if (roll < labelShares.Spam + labelShares.Trash) return ["Trash"];
  const labels = share(thread, "Inbox") < labelShares.Inbox ? ["Inbox"] : [];
  for (const [label, s] of Object.entries(labelShares.user)) {
    if (share(thread, label) < s) labels.push(label);
  }
  return labels;
}

// A number in [0, 1) that is the same for the same thread and purpose.
function share(thread: string, purpose: string): number {
  return hash(`${purpose}\n${thread}`) / 2 ** 32;
}

function hash(text: string): number {
  return createHash("sha256").update(text).digest().readUInt32BE(0);
}
