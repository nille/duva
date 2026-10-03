// #19's harness: picks Titan V2's dimension. It reads the benchmark mailbox
// without writing to it, keeps what it embeds in .data/models/, and creates
// one stack of its own, duva-search-spike-models, which `down` deletes.
//
//   node harness/models.ts export     the mailbox's embedded text and Titan vectors, from the benchmark table into .data/models/
//   node harness/models.ts questions  sample messages and have an LLM write a question each one answers, into harness/questions.json
//   node harness/models.ts quality    recall at 10 and MRR at each dimension, into results/19-quality.json
//   node harness/models.ts up         create the stack: one Lambda that embeds queries
//   node harness/models.ts latency    query-embedding latency from that Lambda, into results/19-latency.json
//   node harness/models.ts down       delete the stack
//
// Cohere Embed v4, the ticket's quality reference, stays unmeasured: Bedrock
// refuses every AWS Marketplace model in the spike's account (README).
//
// Run it with AWS_PROFILE set to the spike's account.
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BedrockRuntimeClient, ConverseCommand, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import {
  CloudFormationClient,
  CreateStackCommand,
  DeleteStackCommand,
  DescribeStacksCommand,
  waitUntilStackCreateComplete,
  waitUntilStackDeleteComplete,
} from "@aws-sdk/client-cloudformation";
import {
  GetFunctionConfigurationCommand,
  InvokeCommand,
  LambdaClient,
  UpdateFunctionConfigurationCommand,
  waitUntilFunctionUpdatedV2,
} from "@aws-sdk/client-lambda";
import { S3Client } from "@aws-sdk/client-s3";
import * as lancedb from "@lancedb/lancedb";
import { titanModelId } from "../src/titan.ts";
import { Vectors, cosine, quality, truncate } from "./retrieval.ts";

const region = "eu-north-1";
const root = new URL("..", import.meta.url).pathname;
const data = join(root, ".data/models");
const questionsFile = join(root, "harness/questions.json");
const stackName = "duva-search-spike-models";
const functionName = "duva-search-spike-models";

const bedrock = new BedrockRuntimeClient({ region, retryMode: "adaptive", maxAttempts: 20 });
const cloudFormation = new CloudFormationClient({ region });
const lambda = new LambdaClient({ region });

// Titan V2's sizes. At a smaller one it gives the first components of its
// 1,024 vector, renormalized, so each message is embedded once, at 1,024,
// and cut to the others (see retrieval.ts).
const largest = 1024;
const dimensionsMeasured = [256, 512, 1024];

// On-demand prices per million tokens in eu-north-1, from the AWS Price List
// on 2026-10-03: Titan's input, and the question writer's input and output.
const usdPerMillionTokens = { titan: 0.021, writerInput: 0.363, writerOutput: 2.992 };

interface Usage {
  requests: number;
  inputTokens: number;
}

// Titan takes one text per request.
async function embed(texts: string[], dimensions: number, usage: Usage) {
  return Promise.all(
    texts.map(async (text) => {
      const response = await bedrock.send(
        new InvokeModelCommand({
          modelId: titanModelId,
          contentType: "application/json",
          accept: "application/json",
          body: JSON.stringify({ inputText: text, dimensions, normalize: true }),
        }),
      );
      const body = JSON.parse(Buffer.from(response.body).toString("utf8"));
      usage.requests++;
      usage.inputTokens += body.inputTextTokenCount;
      return Float32Array.from(body.embedding as number[]);
    }),
  );
}

// What the search module embedded for each message, in the order of the
// vector files.
interface EmbeddedMessage {
  id: string;
  language: "English" | "Swedish";
  text: string;
}

type Language = EmbeddedMessage["language"];

interface Question {
  messageId: string;
  language: Language;
  question: string;
  wordOverlap: number;
}

const messagesFile = join(data, "messages.json");
const titanFile = join(data, "titan-1024.f32");

function readMessages(): EmbeddedMessage[] {
  if (!existsSync(messagesFile)) throw new Error("Run `node harness/models.ts export` first.");
  return JSON.parse(readFileSync(messagesFile, "utf8"));
}

// The benchmark table holds each message's Titan vector at 1,024 dimensions,
// and its subject and text in the columns of its language. The text the
// module embedded is rebuilt from them as lancedb-search.ts builds it.
async function exportMailbox() {
  const bucket = (await stackOutputs("duva-search-spike"))?.Bucket;
  if (!bucket) throw new Error("The duva-search-spike stack, which holds the benchmark mailbox, isn't up.");
  Object.assign(process.env, await credentialsEnv());
  const db = await lancedb.connect(`s3://${bucket}/tables`, { storageOptions: { region } });
  const table = await db.openTable("benchmark");
  const started = performance.now();
  const rows: { message: EmbeddedMessage; vector: Float32Array }[] = [];
  const columns = ["id", "subject_en", "text_en", "subject_sv", "text_sv", "vector"];
  for await (const batch of table.query().select(columns)) {
    for (const r of batch.toArray()) {
      const swedish = Boolean(r.subject_sv || r.text_sv);
      const subject: string = swedish ? r.subject_sv : r.subject_en;
      const text: string = swedish ? r.text_sv : r.text_en;
      rows.push({
        message: { id: r.id, language: swedish ? "Swedish" : "English", text: `${subject}\n\n${text.slice(0, 2_000)}`.trim() || "(empty)" },
        vector: Float32Array.from(r.vector.toArray() as Float32Array),
      });
    }
  }
  rows.sort((a, b) => (a.message.id < b.message.id ? -1 : 1));
  mkdirSync(data, { recursive: true });
  writeFileSync(messagesFile, JSON.stringify(rows.map((r) => r.message)));
  const vectors = new Float32Array(rows.length * largest);
  rows.forEach((r, i) => vectors.set(r.vector, i * largest));
  writeFileSync(titanFile, vectors);
  return { messages: rows.length, readMs: performance.now() - started, version: await table.version() };
}

// A few hundred messages, picked by a hash of their ids so the same ones come
// out on every run. English ones shorter than a few lines are passed over,
// and so are those the writer finds nothing to ask about. The Swedish ones
// come from the generated mail, which is short, rather than the Enron
// messages written in other languages that the module stems as Swedish.
const sampleSize = { English: 260, Swedish: 40 };
const minimumTextLength = 300;
const isCandidate = { English: (m: EmbeddedMessage) => m.language === "English" && m.text.length >= minimumTextLength, Swedish: (m: EmbeddedMessage) => m.id.startsWith("sv-") };
// Amazon's own Nova 2 Lite, since Bedrock refuses every model sold through AWS
// Marketplace, Claude included, in this account.
const writerModelId = "eu.amazon.nova-2-lite-v1:0";
const writerPrompt = `Here is an email from someone's mailbox. Write one question that this email answers, the way the mailbox's owner would ask it when searching for this email months later.

- Write the question in the email's language.
- Use your own words. Don't copy any phrase from the email, and use other words for its key terms wherever you can.
- Refer to people and companies by their role, not their name.
- Make it specific enough that this email answers it and most other emails in a busy mailbox don't.

Reply with the question alone, without a label or an explanation. If the email has nothing a question could ask about, like a bare list of names or a forward without text, reply SKIP.

The email:

`;

async function writeQuestions() {
  const messages = readMessages();
  const order = (id: string) => createHash("sha256").update(`19:${id}`).digest("hex");
  const usage = { requests: 0, inputTokens: 0, outputTokens: 0 };
  const questions: Question[] = [];
  for (const language of ["English", "Swedish"] as const) {
    const candidates = messages
      .filter(isCandidate[language])
      .sort((a, b) => (order(a.id) < order(b.id) ? -1 : 1));
    const picked: typeof questions = [];
    let next = 0;
    while (picked.length < sampleSize[language]) {
      const batch = candidates.slice(next, next + sampleSize[language] - picked.length);
      if (batch.length === 0) throw new Error(`Only ${picked.length} ${language} messages have a question.`);
      next += batch.length;
      const written = await inParallel(batch, 8, async (m) => {
        const response = await bedrock.send(
          new ConverseCommand({
            modelId: writerModelId,
            messages: [{ role: "user", content: [{ text: writerPrompt + m.text }] }],
            inferenceConfig: { maxTokens: 200 },
          }),
        );
        usage.requests++;
        usage.inputTokens += response.usage?.inputTokens ?? 0;
        usage.outputTokens += response.usage?.outputTokens ?? 0;
        return parseQuestion(response.output?.message?.content?.[0]?.text ?? "SKIP");
      });
      batch.forEach((m, i) => {
        const question = written[i];
        if (!question) return;
        picked.push({ messageId: m.id, language, question, wordOverlap: wordOverlap(question, m.text) });
      });
    }
    questions.push(...picked);
  }
  const usd = (usage.inputTokens * usdPerMillionTokens.writerInput + usage.outputTokens * usdPerMillionTokens.writerOutput) / 1e6;
  const file = { writtenAt: new Date().toISOString(), writer: writerModelId, prompt: writerPrompt, minimumTextLength, usage: { ...usage, usd }, questions };
  writeFileSync(questionsFile, JSON.stringify(file, null, 2) + "\n");
  const overlap = questions.reduce((s, q) => s + q.wordOverlap, 0) / questions.length;
  return { questions: questions.length, meanWordOverlap: overlap, usage: file.usage };
}

// The writer sometimes labels its question, or explains why it skips.
function parseQuestion(reply: string): string | undefined {
  if (/^\W*SKIP/.test(reply)) return undefined;
  return reply.replace(/^\W*(question|fråga)\W*:\W*/i, "").trim();
}

// The share of the question's words of four letters or more that the
// message also uses: how far the writer kept off its wording.
function wordOverlap(question: string, text: string): number {
  const words = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4);
  const inText = new Set(words(text));
  const asked = [...new Set(words(question))];
  return asked.length ? asked.filter((w) => inText.has(w)).length / asked.length : 0;
}

function readVectors(): Vectors {
  if (!existsSync(titanFile)) throw new Error("Run `node harness/models.ts export` first.");
  return new Vectors(readFloats(titanFile), largest);
}

function readFloats(file: string): Float32Array {
  const bytes = readFileSync(file);
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
}

interface Questions {
  questions: Question[];
  usage: { usd: number };
}

function readQuestions(): Questions {
  if (!existsSync(questionsFile)) throw new Error("Run `node harness/models.ts questions` first.");
  return JSON.parse(readFileSync(questionsFile, "utf8"));
}

// Every question's target ranked against all 100,000 messages at each
// dimension, and the margin between each and 1,024.
async function measureQuality() {
  const messages = readMessages();
  const { questions, usage: writerUsage } = readQuestions();
  const indexOf = new Map(messages.map((m, i) => [m.id, i]));
  const targets = questions.map((q) => indexOf.get(q.messageId)!);
  const vectors = readVectors();
  const queryUsage = { requests: 0, inputTokens: 0 };
  const embeddedQuestions = await inParallel(questions, 16, async (q) => (await embed([q.question], largest, queryUsage))[0]!);

  const configs = [];
  for (const dimensions of dimensionsMeasured) {
    const started = performance.now();
    const queries = embeddedQuestions.map((v) => truncate(v, dimensions));
    const ranks = targets.map((target, i) => vectors.rank(queries[i]!, target, dimensions));
    const byLanguage = (language: Language) => quality(ranks.filter((_, i) => questions[i]!.language === language));
    configs.push({ model: titanModelId, dimensions, all: quality(ranks), English: byLanguage("English"), Swedish: byLanguage("Swedish"), ranks, rankMs: performance.now() - started });
    console.error(`${dimensions} dimensions: MRR ${quality(ranks).mrr.toFixed(3)}`);
  }
  const reference = configs.find((c) => c.dimensions === largest)!;
  const margins = configs.map((c) => ({ dimensions: c.dimensions, ...pairedMargin(c.ranks, reference.ranks) }));
  const titanLoad = JSON.parse(readFileSync(join(root, "results/16-mailbox.json"), "utf8")).embedding;

  const report = {
    measuredAt: new Date().toISOString(),
    region,
    mailbox: { messages: messages.length, swedish: messages.filter((m) => m.language === "Swedish").length },
    questions: { count: questions.length, English: questions.filter((q) => q.language === "English").length, Swedish: questions.filter((q) => q.language === "Swedish").length, meanWordOverlap: mean(questions.map((q) => q.wordOverlap)) },
    method: "Exact cosine ranking of each question's target against every message, at the first d components of Titan's 1,024 vector, renormalized. MRR over the whole ranking. Margins are against 1,024, with 95% intervals from 10,000 paired bootstrap resamples of the questions.",
    unmeasured: { model: "eu.cohere.embed-v4:0", reason: "Bedrock refuses every AWS Marketplace model in this account, since its Marketplace agreements terminate seconds after acceptance. Nicklas chose Titan without the reference." },
    dimensionsAreTruncations: await checkTruncation(messages, vectors),
    quality: configs.map(({ ranks, ...c }) => c),
    margins,
    cost: {
      embedding: { ...titanLoad, tokensPerMessage: titanLoad.inputTokens / messages.length, usdPerMessage: titanLoad.usd / messages.length, source: "results/16-mailbox.json" },
      // Dimensions cost nothing to embed, but each vector takes four bytes a dimension in the table.
      vectorBytesPer100k: Object.fromEntries(dimensionsMeasured.map((d) => [d, d * 4 * 100_000])),
      questions: { usd: writerUsage.usd },
      queries: { ...queryUsage, usd: (queryUsage.inputTokens * usdPerMillionTokens.titan) / 1e6 },
    },
    ranks: Object.fromEntries(configs.map((c) => [c.dimensions, c.ranks])),
    questionIds: questions.map((q) => q.messageId),
  };
  mkdirSync(join(root, "results"), { recursive: true });
  writeFileSync(join(root, "results/19-quality.json"), JSON.stringify(report, null, 2) + "\n");
  const { ranks, questionIds, ...summary } = report;
  return summary;
}

// The smaller dimensions are cut from the 1,024 vector rather than embedded,
// so this asks Titan for each size directly, for a few messages, and
// compares. At 1,024 it checks the benchmark table's vectors are what Titan
// gives.
async function checkTruncation(messages: EmbeddedMessage[], vectors: Vectors) {
  const sample = [0, 12_345, 50_000, 77_777, messages.length - 1];
  const usage = { requests: 0, inputTokens: 0 };
  const result: Record<number, number> = {};
  for (const dimensions of dimensionsMeasured) {
    const fresh = await embed(sample.map((i) => messages[i]!.text), dimensions, usage);
    result[dimensions] = Math.min(...fresh.map((v, i) => cosine(v, truncate(vectors.vector(sample[i]!), dimensions))));
  }
  return { messages: sample.length, minimumCosineToFresh: result };
}

// How much better a configuration ranks than the reference, question by
// question, with a 95% interval from resampling the questions.
function pairedMargin(ranks: number[], reference: number[]) {
  const reciprocal = (r: number[]) => r.map((x) => 1 / x);
  const top10 = (r: number[]) => r.map((x) => (x <= 10 ? 1 : 0));
  const random = seeded(19);
  const resamples = 10_000;
  const interval = (a: number[], b: number[]) => {
    const differences = a.map((x, i) => x - b[i]!);
    const means = Array.from({ length: resamples }, () => {
      let sum = 0;
      for (let i = 0; i < differences.length; i++) sum += differences[Math.floor(random() * differences.length)]!;
      return sum / differences.length;
    }).sort((x, y) => x - y);
    return { difference: mean(differences), low: means[Math.floor(resamples * 0.025)]!, high: means[Math.floor(resamples * 0.975)]! };
  };
  return {
    mrr: interval(reciprocal(ranks), reciprocal(reference)),
    recallAt10: interval(top10(ranks), top10(reference)),
    better: ranks.filter((r, i) => r < reference[i]!).length,
    worse: ranks.filter((r, i) => r > reference[i]!).length,
  };
}

// Mulberry32, so the intervals come out the same on every run.
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

async function up() {
  if (await stackOutputs(stackName)) return { stack: stackName, existed: true };
  await cloudFormation.send(
    new CreateStackCommand({
      StackName: stackName,
      TemplateBody: readFileSync(join(root, "infra/models-stack.yaml"), "utf8"),
      Capabilities: ["CAPABILITY_NAMED_IAM"],
      Tags: [{ Key: "duva-search-spike", Value: "throwaway" }],
      OnFailure: "DELETE",
    }),
  );
  await waitUntilStackCreateComplete({ client: cloudFormation, maxWaitTime: 900 }, { StackName: stackName });
  return { stack: stackName, created: true };
}

// Each dimension embeds the questions as search queries, from the Lambda: the
// first request in each of several new environments, then every question in
// warm ones. Dimensions take turns, so a slow minute at Bedrock falls on all
// of them.
const coldStarts = 10;
const warmBatch = 50;

async function measureLatency() {
  const { questions } = readQuestions();
  const texts = questions.map((q) => q.question);
  const results = dimensionsMeasured.map((dimensions) => ({ dimensions, cold: [] as number[], warm: [] as number[] }));
  const started = new Date().toISOString();
  for (let i = 0; i < coldStarts; i++) {
    for (const r of results) {
      await newEnvironment();
      r.cold.push(...(await embedFromLambda(r.dimensions, [texts[i]!])));
    }
  }
  for (let start = 0; start < texts.length; start += warmBatch) {
    for (const r of results) r.warm.push(...(await embedFromLambda(r.dimensions, texts.slice(start, start + warmBatch))));
  }
  const config = await lambda.send(new GetFunctionConfigurationCommand({ FunctionName: functionName }));
  const report = {
    measuredAt: started,
    finishedAt: new Date().toISOString(),
    region,
    function: { memoryMb: config.MemorySize, architecture: config.Architectures?.[0], runtime: config.Runtime },
    method: "Inside the handler, from sending InvokeModel to parsing the vector. Cold is the first request in a new execution environment, which also sets up the client's connection; Lambda's init duration is left out. Warm is every question, 50 to an invocation.",
    model: titanModelId,
    results: results.map((r) => ({ dimensions: r.dimensions, cold: percentiles(r.cold), warm: percentiles(r.warm), coldMs: r.cold, warmMs: r.warm })),
  };
  mkdirSync(join(root, "results"), { recursive: true });
  writeFileSync(join(root, "results/19-latency.json"), JSON.stringify(report, null, 2) + "\n");
  return report.results.map(({ coldMs, warmMs, ...r }) => r);
}

async function embedFromLambda(dimensions: number, queries: string[]): Promise<number[]> {
  const response = await lambda.send(new InvokeCommand({ FunctionName: functionName, Payload: JSON.stringify({ dimensions, queries }) }));
  const payload = JSON.parse(Buffer.from(response.Payload ?? []).toString("utf8"));
  if (response.FunctionError) throw new Error(`${functionName} failed: ${JSON.stringify(payload)}`);
  return payload.ms;
}

// Changing the configuration retires the function's warm environments, so the
// next invocation starts a new one.
async function newEnvironment() {
  await lambda.send(new UpdateFunctionConfigurationCommand({ FunctionName: functionName, Environment: { Variables: { COLD_START: randomUUID() } } }));
  await waitUntilFunctionUpdatedV2({ client: lambda, maxWaitTime: 300 }, { FunctionName: functionName });
}

function percentiles(ms: number[]) {
  const sorted = [...ms].sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]!;
  return { count: ms.length, p50: at(0.5), p95: at(0.95), p99: at(0.99), max: sorted.at(-1)! };
}

async function down() {
  if (!(await stackOutputs(stackName))) return { deleted: false, reason: "There is no stack." };
  await cloudFormation.send(new DeleteStackCommand({ StackName: stackName }));
  await waitUntilStackDeleteComplete({ client: cloudFormation, maxWaitTime: 900 }, { StackName: stackName });
  return { deleted: true, stack: stackName };
}

async function stackOutputs(name: string): Promise<Record<string, string> | undefined> {
  try {
    const { Stacks } = await cloudFormation.send(new DescribeStacksCommand({ StackName: name }));
    return Object.fromEntries((Stacks?.[0]?.Outputs ?? []).map((o) => [o.OutputKey!, o.OutputValue!]));
  } catch (error) {
    if (error instanceof Error && error.message.includes("does not exist")) return undefined;
    throw error;
  }
}

// LanceDB's object store reads credentials from the environment, and doesn't
// follow an SSO profile itself.
async function credentialsEnv(): Promise<Record<string, string>> {
  const credentials = await new S3Client({ region }).config.credentials();
  return {
    AWS_ACCESS_KEY_ID: credentials.accessKeyId,
    AWS_SECRET_ACCESS_KEY: credentials.secretAccessKey,
    ...(credentials.sessionToken ? { AWS_SESSION_TOKEN: credentials.sessionToken } : {}),
  };
}

// Maps each item with at most `concurrency` at a time, keeping their order.
async function inParallel<T, R>(items: T[], concurrency: number, f: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await f(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

function mean(values: number[]): number {
  return values.reduce((s, v) => s + v, 0) / values.length;
}

const commands: Record<string, () => Promise<unknown>> = {
  export: exportMailbox,
  questions: writeQuestions,
  quality: measureQuality,
  up,
  latency: measureLatency,
  down,
};

const command = commands[process.argv[2] ?? ""];
if (!command) {
  console.error(`Usage: node harness/models.ts ${Object.keys(commands).join("|")}`);
  process.exit(1);
}
console.log(JSON.stringify(await command(), null, 2));
