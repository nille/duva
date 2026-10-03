// Mail for the writes measurement (#18) to write.
import type { Message } from "./search.ts";

// Each message carries a word no other message has, so a search for it
// finds that message alone, and business prose to embed and index
// like real mail: about 1,200 characters, a little under the benchmark's
// 261 tokens on average. Twenty sentences in rotation make the bodies, so
// they repeat, and their vectors sit closer together than real mail's.
export const tokenOf = (id: string) => `zq${id.replace(/[^a-z0-9]/gi, "").toLowerCase()}`;

const sentences = [
  "Please find the revised schedule for the pipeline expansion below.",
  "We still need sign-off from legal before the contract goes out.",
  "The gas desk reported higher volumes into California this week.",
  "Can you confirm the numbers in the quarterly forecast before Friday?",
  "I spoke with the counterparty and they agreed to the new terms.",
  "Let me know if the meeting on Tuesday still works for your team.",
  "Attached is the summary of the trading positions as of yesterday.",
  "The credit group wants a review of the exposure to that customer.",
  "Our travel plans for the conference in Houston are confirmed.",
  "The invoice for last month's transport capacity is overdue.",
  "Thanks for the quick turnaround on the draft agreement.",
  "We should discuss the budget for next year at the offsite.",
  "The regulatory filing is due at the end of the month.",
  "Could you forward the latest version of the presentation?",
  "The power plant outage will affect deliveries for two days.",
  "Please update the risk report with the new curve before noon.",
  "I will be out of the office until Monday with limited email.",
  "The board asked for a briefing on the restructuring plan.",
  "Here are my comments on the term sheet, mostly minor edits.",
  "The storage facility is at ninety percent of its capacity.",
];

export function generatedMessage(run: string, n: number): Message {
  const id = `${run}-${n}`;
  const pick = (i: number) => sentences[(n * 7 + i * 3) % sentences.length]!;
  const paragraph = (from: number) => Array.from({ length: 6 }, (_, i) => pick(from + i)).join(" ");
  return {
    id,
    thread: `thread-${run}-${Math.floor(n / 3)}`,
    sender: `writer${n % 5}@example.com`,
    recipients: ["mailbox@example.com"],
    subject: `${pick(0).split(" ").slice(0, 5).join(" ")} ${tokenOf(id)}`,
    date: new Date(),
    labels: ["Inbox"],
    hasAttachment: n % 10 === 0,
    text: `Hi,\n\n${paragraph(1)}\n\n${paragraph(7)} Reference ${tokenOf(id)}.\n\n${paragraph(13)}\n\nBest regards,\nWriter ${n % 5}`,
  };
}
