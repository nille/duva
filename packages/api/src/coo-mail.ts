// Mail to a Coo's address (ADR-0040). The inbound handler hands each message SES delivered to one
// here: mail from a sender its human doesn't allow, or automatic mail, is dropped and noted, and the
// rest is kept for the task runner, which settles the proof and runs Coo. A request whose DMARC
// passed for its From domain, or, from the organization's own addresses, that Duva sent, is taken at
// once. Any other waits, while Coo mails the From address a one-time code, kept hashed, and is taken
// when a reply from that address brings the code back within an hour, whatever its DMARC. A reply
// that answers the code's mail with another code counts as an attempt, and the fifth voids the code.
// A taken request is a turn of the human's Ask Coo, from All mailboxes, marked with its sender,
// whose run reads its text, its forwarded mail and its attachments. Coo answers by mail from its
// address, to the From address and never a Reply-To, in the request's thread, with what it did and
// how each action went, and the disclosure. A send that waits for the human is followed up with
// another mail in the thread once it is decided. Nothing is filed in any mailbox.
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { operations } from "@duva/openapi";
import { PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { AgentAction } from "./agent-loop.ts";
import { capRefusal, type AgentRuntime } from "./agent-runs.ts";
import { prepareTurn, runTurn, type ConversationTurn } from "./conversation.ts";
import { cooAddressOf } from "./coo-address.ts";
import {
  awaitDecision,
  codeKey,
  type CooCode,
  type CooRequest,
  codesOf,
  codeWorks,
  findRequest,
  type CooMailJob,
  type FollowUp,
  humanOf,
  moveRequest,
  noteMailToCoo,
  rawKeyOf,
  requestKey,
  requestMoved,
  requestsOf,
  takeFollowUp,
} from "./coo-requests.ts";
import type { Table } from "./deployment.ts";
import { findDraft } from "./drafting.ts";
import { findPayment, paymentsOfTurn } from "./payments.ts";
import type { MailBucket } from "./mail-bucket.ts";
import { mailboxAgentName } from "./mailbox-agents.ts";
import { buildMail, disclosureHeader, type ParsedMail, parseMail } from "./mime.ts";
import { type Human, ownedMailboxes } from "./organization.ts";
import { type Outbound, Refused } from "./outbound.ts";
import { systemMailRecord } from "./sending.ts";
import { documents, isNew, type TransactItem } from "./table.ts";
import type { Embedder } from "./titan.ts";

/** The most replies that bring another code before the code is void. */
const attemptsAllowed = 5;
/** How many of a message's six-digit numbers are tried as a code. */
const numbersTried = 3;

const hashOf = (salt: string, code: string) => createHash("sha256").update(`${salt}:${code}`).digest("hex");

/** The Message-ID SES gives a message it sends with the ID, in the region (docs/aws.md). */
const sesMessageIdOf = (sesMessageId: string, region: string) => `<${sesMessageId}@${region}.amazonses.com>`;

/** What the task runner settles and runs requests by mail with. */
export interface CooMailRunner {
  table: Table;
  region: string;
  apiUrl: string;
  runtime: AgentRuntime | undefined;
  embedder: Embedder;
  outbound: Outbound;
  mailBucket: MailBucket;
}

/** The task runner's handler for mail to Coo: settles a request and runs it, or follows up a send that waited. */
export function createCooMail(runner: CooMailRunner) {
  return async (job: CooMailJob): Promise<void> => {
    if ("followUp" in job) return followUp(runner, job.followUp);
    const request = await findRequest(runner.table, job.human, job.request);
    const human = await humanOf(runner.table, job.human);
    if (request?.state !== "received" || human === undefined) return;
    const raw = await runner.mailBucket.get(rawKeyOf(human.id, request.id));
    if (raw === undefined) return;
    const parsed = await parseMail(raw);
    if (await verifies(runner, human, request, parsed)) return;
    if (request.proven) {
      if (await moveRequest(runner.table, request, "received", "taken")) await run(runner, human, { ...request, state: "taken" });
      return;
    }
    await askForCode(runner, human, request);
  };
}

/**
 * Whether the message is a reply about a code Coo mailed its sender, rather than a request: one that
 * brings the code back, or answers the code's mail. In time, the code takes the requests that waited
 * for it. Late, or with another code, it is noted, and the requests go on waiting. Only the first few
 * numbers of a message are tried, and any other message from the sender that brings numbers while a
 * code is open counts as an attempt too, so forged mail can't guess its way through the codes.
 */
async function verifies(runner: CooMailRunner, human: Human, request: CooRequest, parsed: ParsedMail): Promise<boolean> {
  const { table } = runner;
  const codes = (await codesOf(table, human.id)).filter(({ from, state }) => from === request.from && state !== "used");
  const given = [...new Set(`${parsed.subject}\n${parsed.text}`.match(/\b\d{6}\b/g) ?? [])].slice(0, numbersTried);
  const brought = codes.find(({ salt, hash }) => given.some((code) => hashOf(salt, code) === hash));
  const code = brought ?? codes.find(({ messageId }) => parsed.answers.includes(messageId));
  if (code === undefined) {
    // A new request, which still costs a guess if it brings numbers.
    if (given.length > 0) for (const open of codes.filter(({ state }) => state === "open")) await countAttempt(table, human, open);
    return false;
  }
  if (!(await moveRequest(table, request, "received", "verifies"))) return true;
  // A reply about a code is no request, so it isn't kept.
  await runner.mailBucket.erase(rawKeyOf(human.id, request.id));
  const late = code.state === "void" || Date.parse(request.receivedAt) > Date.parse(code.sentAt) + codeWorks;
  const waiting = async () => (await requestsOf(table, human.id)).filter((each) => each.code === code.id && each.state === "verifying");
  if (late) {
    for (const each of await waiting()) await noteMailToCoo(table, human, { request: each.id, from: request.from, event: "lateCode" });
    return true;
  }
  if (brought === undefined) {
    await countAttempt(table, human, code);
    for (const each of await waiting()) await noteMailToCoo(table, human, { request: each.id, from: request.from, event: "wrongCode" });
    return true;
  }
  const used: TransactItem = {
    Update: { TableName: table.name, Key: codeKey(human.id, code.id), UpdateExpression: "SET #state = :used", ConditionExpression: "#state = :open", ExpressionAttributeNames: { "#state": "state" }, ExpressionAttributeValues: { ":used": "used", ":open": "open" } },
  };
  const [first, ...more] = await waiting();
  // The code is used with the first request it takes, so of two replies that bring it, one takes them.
  for (const each of [first, ...more]) {
    if (each === undefined) break;
    const items = [requestMoved(table, each, "verifying", "taken"), ...(each === first ? [used] : [])];
    if (!(await noteMailToCoo(table, human, { request: each.id, from: each.from, event: "verified" }, { items }))) {
      if (each === first) return true;
      continue;
    }
    await run(runner, human, { ...each, state: "taken" });
  }
  return true;
}

/** Counts a reply that didn't bring the code, which voids it at the last attempt allowed. */
async function countAttempt(table: Table, human: Human, code: CooCode): Promise<void> {
  await documents(table)
    .send(
      new UpdateCommand({
        TableName: table.name,
        Key: codeKey(human.id, code.id),
        UpdateExpression: "ADD attempts :one",
        ConditionExpression: "#state = :open",
        ExpressionAttributeNames: { "#state": "state" },
        ExpressionAttributeValues: { ":one": 1, ":open": "open" },
        ReturnValues: "ALL_NEW",
      }),
    )
    .then(({ Attributes }) =>
      (Attributes?.attempts as number) >= attemptsAllowed
        ? documents(table).send(
            new UpdateCommand({ TableName: table.name, Key: codeKey(human.id, code.id), UpdateExpression: "SET #state = :void", ConditionExpression: "#state = :open", ExpressionAttributeNames: { "#state": "state" }, ExpressionAttributeValues: { ":void": "void", ":open": "open" } }),
          )
        : undefined,
    )
    .catch((error: unknown) => {
      // Used or void meanwhile.
      if (!(error instanceof ConditionalCheckFailedException)) throw error;
    });
}

/**
 * Has the request wait for a code: one Coo mailed its sender within the hour, or a new one, which
 * it mails them now, in the request's thread. One code a sender at a time, so forged mail can't
 * make Coo mail a sender many.
 */
async function askForCode(runner: CooMailRunner, human: Human, request: CooRequest): Promise<void> {
  const { table } = runner;
  const open = (await codesOf(table, human.id)).find(({ from, state, sentAt }) => from === request.from && state === "open" && Date.parse(request.receivedAt) <= Date.parse(sentAt) + codeWorks);
  if (open !== undefined) {
    await noteMailToCoo(table, human, { request: request.id, from: request.from, event: "verifying", codeMailed: false }, { items: [requestMoved(table, request, "received", "verifying", { code: open.id })] });
    return;
  }
  // Claimed before the code is mailed, so a request handed over again never mails a second one.
  if (!(await moveRequest(table, request, "received", "verifying"))) return;
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const text = [
    `I got a request from ${request.from}, but couldn't tell it was really yours, so I've done nothing yet.`,
    "",
    `If you sent it, reply to this mail within an hour, keeping this code in it: ${code}`,
    "",
    "If you didn't, ignore this mail, and nothing happens.",
  ].join("\n");
  const sent = await mail(runner, human, request, { text });
  if (sent === undefined) {
    await moveRequest(table, request, "verifying", "failed");
    return;
  }
  const salt = randomBytes(16).toString("hex");
  const kept: CooCode = { id: randomUUID(), from: request.from, salt, hash: hashOf(salt, code), sentAt: request.receivedAt, messageId: sent, attempts: 0, state: "open" };
  await noteMailToCoo(
    table,
    human,
    { request: request.id, from: request.from, event: "verifying", codeMailed: true },
    {
      items: [
        { Put: { TableName: table.name, Item: { ...codeKey(human.id, kept.id), ...kept }, ...isNew } },
        requestMoved(table, request, "verifying", "verifying", { code: kept.id, thread: [...request.thread, sent] }),
        systemMailRecord(table, sesIdOf(sent)),
      ],
    },
  );
}

const sesIdOf = (messageId: string) => messageId.slice(1, messageId.indexOf("@"));

/** The operations that send a draft, whose send may wait for the human. */
const sending = new Set(["sendDraft", "sendAllMailboxesDraft"]);
/** The states of a draft's send that wait for something to be decided. */
const undecided = new Set(["waiting", "approved", "waitingForLimit", "sending"]);

/**
 * Runs the taken request as a turn of the human's Ask Coo, from All mailboxes, and mails the answer,
 * with what Coo did, to the request's From. A send that waits is followed up once decided.
 */
async function run(runner: CooMailRunner, human: Human, request: CooRequest): Promise<void> {
  const { table, mailBucket } = runner;
  if (!(await moveRequest(table, request, "taken", "running"))) return;
  const raw = await mailBucket.get(rawKeyOf(human.id, request.id));
  const parsed = raw === undefined ? undefined : await parseMail(raw);
  const words = parsed === undefined ? "" : [parsed.subject === "" ? undefined : `Subject: ${parsed.subject}`, parsed.text].filter((each) => each !== undefined).join("\n\n");
  const prepared = await prepareTurn(
    { table, region: runner.region, apiUrl: runner.apiUrl, available: runner.runtime !== undefined },
    human,
    { words },
    { from: request.from, beside: parsed === undefined ? "" : await besideOf(parsed) },
  );
  let answer: ConversationTurn | undefined;
  if (!("statusCode" in prepared)) for await (const event of runTurn(table, runner.runtime!, runner.embedder, prepared)) if (event.type === "done") answer = event.turn;
  const said =
    "statusCode" in prepared
      ? prepared.body.message
      : answer === undefined || answer.outcome === "failed"
        ? `${answer?.text.trim() ?? ""}\n\nI couldn't finish this, as the model or the runtime failed partway. Mail me again to try once more.`.trim()
        : answer.outcome === "capReached"
          ? `${answer.text.trim()}\n\n${capRefusal(prepared.cap)}`.trim()
          : answer.text.trim();
  const results = answer === undefined || "statusCode" in prepared ? [] : await resultsOf(runner, human, request, prepared.turn.id, answer);
  const text = results.length === 0 ? said : `${said}\n\nWhat I did:\n${results.map((line) => `- ${line}`).join("\n")}`;
  const sent = await mail(runner, human, request, { text });
  if (sent === undefined) {
    await moveRequest(table, request, "running", "failed");
    return;
  }
  await noteMailToCoo(table, human, { request: request.id, from: request.from, event: "answered", results }, { items: [requestMoved(table, request, "running", "answered", { thread: [...request.thread, sent] }), systemMailRecord(table, sesIdOf(sent))] });
}

/**
 * What Coo did in the turn that answered the request's, each action that changed something with how
 * it went, its browsing, its payments and its web searches, as its mail says it. What waits for the
 * human is followed up once it is decided.
 */
async function resultsOf(runner: CooMailRunner, human: Human, request: CooRequest, asked: string, answer: ConversationTurn): Promise<string[]> {
  const whose = request.from === human.email ? "your" : `${human.email}'s`;
  const results: string[] = [];
  for (const action of answer.actions) {
    // What only read changed nothing, so the mail leaves it out.
    if (operations.find(({ operationId }) => operationId === action.operation)?.method === "get") continue;
    const what = action.what.replace(/\.$/, "");
    if (!action.ok) {
      results.push(`Not done: ${what}. ${action.message ?? ""}`.trim());
      continue;
    }
    const waits = sending.has(action.operation) && action.draft !== undefined ? await waitingSend(runner, human, action) : undefined;
    if (waits === undefined) results.push(`Done: ${what}.`);
    else {
      await awaitDecision(runner.table, waits, request);
      results.push(waits.state === "waiting" ? `${what}: it waits for ${whose} approval. I'll write again once it's decided.` : `${what}: it goes out shortly. I'll write again once it's sent.`);
    }
  }
  for (const { site, said } of answer.browsed ?? []) results.push(`Browsed ${site}: ${said}`);
  for (const payment of (await paymentsOfTurn(runner.table, human.id, asked)).toReversed()) {
    const what = `${payment.amount} ${payment.currency} on ${payment.site} with ${payment.cardName}, for ${payment.for}`;
    if (payment.state === "paid") results.push(`Paid ${what}.`);
    else if (payment.state === "waiting") {
      await awaitDecision(runner.table, { mailbox: payment.mailbox, payment: payment.id }, request);
      results.push(`Paying ${what}: it's above the card's limits, so it waits for ${whose} approval. I'll write again once it's decided.`);
    }
  }
  for (const { query } of answer.searches ?? []) results.push(`Searched the web for ${JSON.stringify(query)}.`);
  return results;
}

/** The draft the action asked to send, if its send is still to be decided, with the mailbox it is in. */
async function waitingSend({ table }: CooMailRunner, human: Human, action: AgentAction): Promise<{ mailbox: string; draft: string; state: string } | undefined> {
  const mailboxes = action.mailbox === undefined ? (await ownedMailboxes(table, human.id)).map(({ id }) => id) : [action.mailbox];
  for (const mailbox of mailboxes) {
    const state = (await findDraft(table, mailbox, action.draft!))?.send?.state;
    if (state !== undefined) return undecided.has(state) ? { mailbox, draft: action.draft!, state } : undefined;
  }
  return undefined;
}

/** Mails the requester how a send or a payment that waited was decided, in the request's thread, once. */
async function followUp(runner: CooMailRunner, followed: FollowUp): Promise<void> {
  const { table } = runner;
  const taken = await takeFollowUp(table, followed);
  if (taken === undefined) return;
  const [request, human] = await Promise.all([findRequest(table, taken.human, taken.id), humanOf(table, taken.human)]);
  if (request === undefined || human === undefined) return;
  const who = request.from === human.email ? "You" : human.email;
  const line = "draft" in followed ? await sendDecided(runner, followed.mailbox, followed.draft, followed.outcome, who) : await paymentDecided(runner, human, followed.payment, followed.outcome, who);
  const sent = await mail(runner, human, request, { text: line });
  if (sent === undefined) return;
  await documents(table).send(new UpdateCommand({ TableName: table.name, Key: requestKey(human.id, request.id), UpdateExpression: "SET thread = list_append(thread, :sent)", ExpressionAttributeValues: { ":sent": [sent] } }));
  const about = "draft" in followed ? { draft: followed.draft } : { payment: followed.payment };
  await noteMailToCoo(table, human, { request: request.id, from: request.from, event: "followedUp", ...about, outcome: followed.outcome, results: [line] }, { items: [systemMailRecord(table, sesIdOf(sent))] });
}

/** How the draft's send was decided, as Coo's mail says it. */
async function sendDecided({ table }: CooMailRunner, mailbox: string, draft: string, outcome: FollowUp["outcome"], who: string): Promise<string> {
  const found = await findDraft(table, mailbox, draft);
  const named = found === undefined ? "the mail I wrote" : `the mail ${found.subject === "" ? "with no subject" : JSON.stringify(found.subject)} to ${found.to.map(({ address }) => address).join(", ") || "no one"}`;
  const Named = `${named.charAt(0).toUpperCase()}${named.slice(1)}`;
  return outcome === "rejected" ? `${who} didn't approve ${named}, so it wasn't sent.` : outcome === "failed" ? `${Named} couldn't be sent.` : `${Named} was sent.`;
}

/** How the payment was decided, as Coo's mail says it. An approved one is paid by a later run, which is said once it is. */
async function paymentDecided({ table }: CooMailRunner, human: Human, id: string, outcome: FollowUp["outcome"], who: string): Promise<string> {
  const payment = await findPayment(table, human.id, id);
  const what = payment === undefined ? "the payment" : `${payment.amount} ${payment.currency} on ${payment.site}`;
  if (outcome === "declined") return `${who} declined paying ${what}, so I didn't pay it.`;
  if (outcome === "paid") return `I paid ${what}${payment === undefined ? "" : ` with ${payment.cardName}`}, as approved.`;
  return `${who} approved paying ${what}. Mail me to go on, and I'll pay it.`;
}

/**
 * Mails the text from the Coo's address to the request's From, never a Reply-To, in its thread,
 * with the disclosure, and returns the Message-ID SES gave it, or undefined if SES didn't send it,
 * which is noted. A Coo with no address answers from none.
 */
async function mail(runner: CooMailRunner, human: Human, request: CooRequest, { text }: { text: string }): Promise<string | undefined> {
  const { table, outbound, region } = runner;
  const from = await cooAddressOf(table, human.id);
  if (from === undefined) {
    await noteMailToCoo(table, human, { request: request.id, from: request.from, event: "replyFailed" });
    return undefined;
  }
  const naming = `${mailboxAgentName} for ${human.email}`;
  const raw = buildMail({
    // SES replaces it with one of its own (docs/aws.md).
    messageId: `<${randomUUID()}@${from.slice(from.lastIndexOf("@") + 1)}>`,
    from: { name: mailboxAgentName, address: from },
    to: [{ address: request.from }],
    cc: [],
    subject: /^re:/i.test(request.subject) ? request.subject : `Re: ${request.subject}`,
    date: new Date(),
    ...(request.thread.length > 0 && { inReplyTo: request.thread.at(-1)! }),
    references: request.thread,
    headers: [
      [disclosureHeader, naming],
      ["Auto-Submitted", "auto-replied"],
    ],
    text: `${text}\n\nSent by ${naming}`,
    attachments: [],
  });
  try {
    return sesMessageIdOf(await outbound.send(raw, { to: [request.from], cc: [], bcc: [] }), region);
  } catch (error) {
    console.error(error);
    if (!(error instanceof Refused)) throw error;
    await noteMailToCoo(table, human, { request: request.id, from: request.from, event: "replyFailed" });
    return undefined;
  }
}

/** Media types of attachments Coo reads as text, beside text/*. */
const textual = /^(text\/.+|application\/(json|xml|csv|x-yaml|yaml|ics|x-ndjson))$/i;

/** What the request carries beside its text, for Coo to read: each forwarded mail, with what it carries, and each attachment it can read as text, and the others by name. */
async function besideOf(parsed: ParsedMail, depth = 0): Promise<string> {
  const parts: string[] = [];
  for (const [index, part] of parsed.parts.entries()) {
    const name = part.name ?? `attachment ${index + 1}`;
    if (part.type.toLowerCase() === "message/rfc822" && depth < 3) {
      const forwarded = await parseMail(part.content);
      const head = [`From: ${forwarded.from?.address ?? "unknown"}`, `Subject: ${forwarded.subject}`, ...(forwarded.date === undefined ? [] : [`Date: ${forwarded.date}`])].join("\n");
      const inner = await besideOf(forwarded, depth + 1);
      parts.push([`A forwarded mail, ${name}:`, head, "", forwarded.text, ...(inner === "" ? [] : ["", inner])].join("\n"));
    } else if (textual.test(part.type) || /\.(txt|csv|md|json|ics|vcf|xml|ya?ml|log)$/i.test(name)) {
      parts.push(`The attachment ${name} (${part.type}):\n${new TextDecoder().decode(part.content).replace(/\r\n?/g, "\n")}`);
    } else {
      parts.push(`The attachment ${name} (${part.type}, ${part.content.byteLength} bytes), which you can't read.`);
    }
  }
  return parts.join("\n\n");
}

