// Suggestions (#156): the rest of the sentence a human is writing, which the composer offers in grey
// after the cursor once they pause. It is a fast path, one small model call from the API, never a
// run of Coo, and it draws on the draft so far, its subject and recipients, the message it answers
// or forwards, what Coo remembers of the human, and their style note. The models were measured
// for it (docs/research/suggestions.md), and admins choose among those. Its cost counts toward the
// mailbox agents' spend cap.
import { randomUUID } from "node:crypto";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { components } from "@duva/openapi";
import { addSpend, capRefusal, monthOf, spentIn } from "./agent-runs.ts";
import { type SuggestionModel, suggestionCost, suggestionModels } from "./agent-models.ts";
import { jsonBody, type OperationHandler, refusal } from "./operation-handler.ts";
import type { Table } from "./deployment.ts";
import type { MailBucket } from "./mail-bucket.ts";
import { findMessage, screener, spam, threadSummary } from "./mail.ts";
import { keepStyleNote, memoriesFor } from "./memories.ts";
import { actorKey, organizationSettings, ownedMailboxes } from "./organization.ts";
import { learnsFromMail, suggestionsOn } from "./preferences.ts";
import { documents, pk, sk } from "./table.ts";
import type { Embedder } from "./titan.ts";

/** One small model call: what it is told and asked, and what it answered, with its tokens. */
export type Suggester = (request: { model: SuggestionModel; system: string; prompt: string; maxTokens: number; seconds: number }) => Promise<{ text: string; inputTokens: number; outputTokens: number }>;

const clients = new Map<string, BedrockRuntimeClient>();

/**
 * The suggestion models on Bedrock, each called with Converse as the deployment in the region calls
 * it, at temperature 0, gpt-oss with little reasoning, which it otherwise spends its tokens on. The
 * SDK makes one attempt, since a suggestion late is one not wanted, and gives up after `seconds`.
 */
export function bedrockSuggester({ region: deployed }: { region: string }): Suggester {
  return async ({ model, system, prompt, maxTokens, seconds }) => {
    const { modelId, region } = suggestionModels[model].call(deployed);
    const client = clients.get(region) ?? new BedrockRuntimeClient({ region, maxAttempts: 1 });
    clients.set(region, client);
    const { output, usage } = await client.send(
      new ConverseCommand({
        modelId,
        system: [{ text: system }],
        messages: [{ role: "user", content: [{ text: prompt }] }],
        inferenceConfig: { maxTokens, temperature: 0 },
        ...(model === "openai.gpt-oss-20b-1:0" && { additionalModelRequestFields: { reasoning_effort: "low" } }),
      }),
      { abortSignal: AbortSignal.timeout(seconds * 1000) },
    );
    const text = (output?.message?.content ?? []).flatMap((block) => (block.text === undefined ? [] : [block.text])).join("");
    return { text, inputTokens: usage?.inputTokens ?? 0, outputTokens: usage?.outputTokens ?? 0 };
  };
}

/** What a suggestion is made from. */
export interface SuggestionInput {
  /** The draft's text up to the cursor. */
  text: string;
  subject: string;
  from: string;
  to: string[];
  cc: string[];
  /** The message the draft answers or forwards, if it does. */
  message?: { kind: "answers" | "forwards"; from: string; date: string; subject: string; text: string };
  /** What Coo remembers of the human that matters here, most alike first. */
  memories: string[];
  /** How the human writes, from their style note, if Coo has one. */
  style?: string;
}

/** The longest stretch of the message answered, and of the draft, that a suggestion reads, from their ends. */
const longestMessage = 3000;
const longestDraft = 3000;

/** The sentence the text ends in, as written so far: what follows the last sentence's end or line break. */
export function sentenceBegun(text: string): string {
  const ends = [...text.matchAll(/[.!?]["')\]]*\s+|\n/g)];
  const last = ends.at(-1);
  return last === undefined ? text.trimStart() : text.slice(last.index + last[0].length);
}

const suggesting = [
  "You help a person write an email by finishing the sentence they are writing, as they would write it.",
  "Answer with that one sentence and nothing else: first the words they wrote of it so far, exactly as written, then the rest, ending where the sentence ends. If they stopped in the middle of a word, finish the word.",
  "Keep it short, as most sentences end within a few words, and add no detail that the email, what it answers and what you know of them don't give.",
  "Write in the language and tone of their draft, as they write. Never begin another sentence, and add no quotes or explanation.",
  "If you can't tell how the sentence goes on, answer with nothing.",
].join(" ");

/** What the model is told and asked for the input, and the sentence it finishes, or undefined where no sentence is begun. */
export function suggestionPrompt(input: SuggestionInput): { system: string; prompt: string; begun: string } | undefined {
  const begun = sentenceBegun(input.text);
  if (begun.trim() === "") return undefined;
  const { message } = input;
  const parts = [
    `From: ${input.from}`,
    ...(input.to.length > 0 ? [`To: ${input.to.join(", ")}`] : []),
    ...(input.cc.length > 0 ? [`Cc: ${input.cc.join(", ")}`] : []),
    `Subject: ${input.subject}`,
    ...(message === undefined
      ? []
      : [`The email ${message.kind === "answers" ? "answers" : "forwards"} this message from ${message.from}, sent ${message.date}, with the subject ${message.subject}:\n<message>\n${message.text.slice(0, longestMessage)}\n</message>`]),
    ...(input.memories.length > 0 ? [`What you know of the writer:\n${input.memories.map((memory) => `- ${memory}`).join("\n")}`] : []),
    ...(input.style === undefined ? [] : [`How the writer writes:\n${input.style}`]),
    `Their draft so far:\n<draft>\n${input.text.slice(-longestDraft)}\n</draft>`,
    `The sentence they are writing, so far: ${begun}`,
  ];
  return { system: suggesting, prompt: parts.join("\n\n"), begun };
}

/** The most tokens a suggestion's answer takes: a long sentence, and room for gpt-oss's little reasoning. */
export const suggestionTokens = 200;

/**
 * The rest of the sentence from the model's answer, which repeats the sentence begun, and sometimes
 * the draft before it: what follows its first repetition at a word's start, up to the sentence's end, or undefined if
 * the answer doesn't go on from what was written.
 */
export function restOf(answer: string, begun: string): string | undefined {
  const written = begun.trimStart();
  if (written === "") return undefined;
  // Where it is repeated: at a word's start, so a short "I" isn't found inside "Hi".
  const lower = answer.toLowerCase();
  let at = lower.indexOf(written.toLowerCase());
  while (at > 0 && /[\p{L}\p{N}]/u.test(answer[at - 1]!)) at = lower.indexOf(written.toLowerCase(), at + 1);
  if (at === -1) return undefined;
  const rest = answer.slice(at + written.length).replace(/\s*<\/draft>[\s\S]*$/, "");
  // One sentence only, on its line.
  const end = rest.match(/[.!?]["')\]”»]*(?=\s|$)|\n/);
  const sentence = (end === null ? rest : rest.slice(0, end.index! + (end[0] === "\n" ? 0 : end[0].length))).trimEnd();
  return sentence.trim() === "" ? undefined : sentence;
}

/** How many memories besides the style note a suggestion reads. */
const memoriesRead = 5;

// The vectors of what memories were last searched by, as each draft's subject and message stay the
// same while its human writes, so most of its suggestions wait for no embedding.
const embedded = new Map<string, Promise<Float32Array>>();
const embeddedKept = 200;

function embeddingOf(embedder: Embedder, text: string): Promise<Float32Array> {
  const kept = embedded.get(text);
  if (kept !== undefined) return kept;
  const embedding = embedder.embed([text]).then(([vector]) => vector!);
  embedded.set(text, embedding);
  embedding.catch(() => embedded.delete(text));
  if (embedded.size > embeddedKept) embedded.delete(embedded.keys().next().value!);
  return embedding;
}

// The human's latest ask for a suggestion, which supersedes any before it still being answered.
const askedKey = (human: string) => ({ [pk]: actorKey(human)[pk]!, [sk]: "suggestion-asked" });

const addressesIn = (value: unknown) => (Array.isArray(value) && value.length <= 50 && value.every((address) => typeof address === "string") ? (value as string[]) : undefined);

export const suggest: OperationHandler = async (event, { table, mailBucket, embedder, suggester }, actor) => {
  if (actor?.kind !== "human") return refusal(403, "Only humans get suggestions, as they write in their own mailboxes.");
  const mailbox = event.pathParameters?.mailbox ?? "";
  const body = jsonBody(event) ?? {};
  const { text, subject = "", answers, forwards } = body;
  if (typeof text !== "string" || text.length > 50_000) return refusal(400, "Give text as the draft's text up to the cursor, in at most 50000 characters.");
  if (typeof subject !== "string") return refusal(400, "Give subject as the draft's subject.");
  const [to, cc] = [addressesIn(body.to ?? []), addressesIn(body.cc ?? [])];
  if (to === undefined || cc === undefined) return refusal(400, "Give to and cc as lists of at most 50 addresses each.");
  if ((answers !== undefined && typeof answers !== "string") || (forwards !== undefined && typeof forwards !== "string") || (answers !== undefined && forwards !== undefined)) {
    return refusal(400, "Give answers as the ID of the message a reply answers, or forwards as the ID of the message a forward forwards, not both.");
  }
  const [mailboxes, { settings }, on] = await Promise.all([ownedMailboxes(table, actor.id), organizationSettings(table), suggestionsOn(table, actor.id)]);
  const own = mailboxes.find(({ id }) => id === mailbox);
  if (own === undefined) return refusal(403, "You get suggestions only in your own mailboxes. Write from one of them.");
  if (!settings.suggestions) return refusal(409, "An admin switched suggestions off for the organization.");
  if (!on) return refusal(409, "You switched suggestions off. Switch them on in your preferences.");
  const cap = settings.mailboxAgentSpendCap;
  if (cap === 0) return refusal(409, "An admin turned the mailbox agents off, with a spend cap of $0, which suggestions count toward. Ask one to raise it.");
  const month = monthOf(new Date());
  if ((await spentIn(table, month)) >= cap) return refusal(409, capRefusal(cap));
  const id = (answers ?? forwards) as string | undefined;
  const found = id === undefined ? undefined : await findMessage(table, mailBucket, mailbox, id);
  if (id !== undefined && found === undefined) return refusal(404, `There is no message ${JSON.stringify(id)} in this mailbox. Give the ID of the message the draft answers or forwards.`);

  const asked = randomUUID();
  await documents(table).send(new PutCommand({ TableName: table.name, Item: { ...askedKey(actor.id), asked } }));
  const message = found?.message;
  const about = [subject, ...to, message?.text.slice(0, 1000) ?? ""].join("\n").trim();
  const { style, memories } = await memoriesFor(table, actor.id, () => embeddingOf(embedder, about === "" ? text.slice(0, 1000) : about), memoriesRead);
  const prompt = suggestionPrompt({
    text,
    subject,
    from: actor.email,
    to,
    cc,
    ...(message !== undefined && {
      message: { kind: answers !== undefined ? "answers" : "forwards", from: message.from.name === undefined ? message.from.address : `${message.from.name} <${message.from.address}>`, date: message.date, subject: message.subject, text: message.text },
    }),
    memories,
    ...(style !== undefined && { style }),
  });
  // Asked again meanwhile, as when the human typed on, it answers nothing, before the model costs anything if it can.
  const superseded = async () => (await documents(table).send(new GetCommand({ TableName: table.name, Key: askedKey(actor.id), ConsistentRead: true }))).Item?.asked !== asked;
  if (prompt === undefined || (await superseded())) return { statusCode: 200, body: {} satisfies components["schemas"]["Suggestion"] };
  const model = settings.suggestionModel;
  const answer = await suggester({ model, system: prompt.system, prompt: prompt.prompt, maxTokens: suggestionTokens, seconds: 5 }).catch((error: unknown) => void console.error(error));
  if (answer === undefined) return { statusCode: 200, body: {} satisfies components["schemas"]["Suggestion"] };
  await addSpend(table, month, suggestionCost(answer, model));
  const rest = (await superseded()) ? undefined : restOf(answer.text, prompt.begun);
  return { statusCode: 200, body: { ...(rest !== undefined && { suggestion: rest }) } satisfies components["schemas"]["Suggestion"] };
};

/** How many messages a human sends between updates of their style note. */
export const sentPerStyleNote = 10;

// The messages a human sent since their style note was last updated, by mailbox and message.
const sentKey = (human: string) => ({ [pk]: actorKey(human)[pk]!, [sk]: "style-sent" });

const styleNoting = [
  "You read emails a person sent and describe how they write, so their later emails can be finished in their words.",
  "Say how they greet people and sign off, and their tone, for each language they write in, in a few short sentences, with their own words in quotes.",
  "Say nothing about what the emails are about, nor anyone's name but theirs in a sign-off. Answer with the description alone, in English, in at most 400 characters.",
].join(" ");

/**
 * Notes that the human sent the message from the mailbox, and after every tenth since their style
 * note was last updated, has the suggestion model read those ten and keeps what it says of how they
 * write as their style note, naming the messages' threads (#156). A set of the messages makes a
 * retried note count once, and a claim on the full set has only one sender write the note, which
 * puts them back if its call fails. Nothing
 * is noted while they have learning from mail off, or the mailbox agents are at their spend cap,
 * which the call counts toward.
 */
export async function noteSent(
  { table, mailBucket, embedder, suggester }: { table: Table; mailBucket: MailBucket; embedder: Embedder; suggester: Suggester },
  { human, mailbox, message }: { human: string; mailbox: string; message: string },
): Promise<void> {
  if (!(await learnsFromMail(table, human))) {
    // What was sent before learning stopped teaches nothing once it starts again.
    await documents(table).send(new UpdateCommand({ TableName: table.name, Key: sentKey(human), UpdateExpression: "REMOVE sent" }));
    return;
  }
  const { Attributes } = await documents(table).send(
    new UpdateCommand({ TableName: table.name, Key: sentKey(human), UpdateExpression: "ADD sent :message", ExpressionAttributeValues: { ":message": new Set([`${mailbox} ${message}`]) }, ReturnValues: "ALL_NEW" }),
  );
  if ((Attributes?.sent as Set<string>).size < sentPerStyleNote) return;
  const { settings } = await organizationSettings(table);
  const month = monthOf(new Date());
  if ((await spentIn(table, month)) >= settings.mailboxAgentSpendCap) return;
  let claimed: Set<string>;
  try {
    const { Attributes: old } = await documents(table).send(
      new UpdateCommand({ TableName: table.name, Key: sentKey(human), UpdateExpression: "REMOVE sent", ConditionExpression: "size(sent) >= :all", ExpressionAttributeValues: { ":all": sentPerStyleNote }, ReturnValues: "ALL_OLD" }),
    );
    claimed = old!.sent as Set<string>;
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) return;
    throw error;
  }
  // A message erased since it was sent teaches nothing, nor one in Spam or a mailbox handed to another human since.
  const owned = new Set((await ownedMailboxes(table, human)).map(({ id }) => id));
  const sent = (await Promise.all([...claimed].map(async (entry) => {
    const [from, id] = entry.split(" ") as [string, string];
    if (!owned.has(from)) return undefined;
    const found = await findMessage(table, mailBucket, from, id);
    const labels = found === undefined ? [] : ((await threadSummary(table, from, found.thread))?.labels ?? [screener]);
    return found && !labels.includes(screener) && !labels.includes(spam) ? { mailbox: from, thread: found.thread, message: found.message } : undefined;
  }))).filter((each) => each !== undefined).toSorted((a, b) => (a.message.date < b.message.date ? -1 : 1));
  if (sent.length === 0) return;
  const prompt = sent.map(({ message }, at) => `<email number="${at + 1}">\nSubject: ${message.subject}\n\n${message.text.slice(0, 2000)}\n</email>`).join("\n\n");
  const model = settings.suggestionModel;
  const answer = await suggester({ model, system: styleNoting, prompt, maxTokens: 400, seconds: 30 }).catch(async (error: unknown) => {
    // The messages claimed wait for the next send instead.
    await documents(table).send(new UpdateCommand({ TableName: table.name, Key: sentKey(human), UpdateExpression: "ADD sent :claimed", ExpressionAttributeValues: { ":claimed": claimed } }));
    throw error;
  });
  await addSpend(table, month, suggestionCost(answer, model));
  const described = answer.text.trim();
  if (described === "") return;
  const threads = [...new Map(sent.map(({ mailbox: where, thread, message }) => [`${where} ${thread}`, { mailbox: where, thread, subject: message.subject }])).values()];
  await keepStyleNote(table, embedder, human, `Writing style: ${described}`, threads);
}
