// Measures the suggestion models (#156) from a Lambda in eu-north-1, as the API calls them: each
// model on the drafts in suggestion-drafts.json, built into prompts by the API's own code, several
// times over, for the latency, how often the suggestion is what the writer went on to write, and
// the cost. It creates a throwaway role and Lambda, tagged as the project's (#176), and deletes them
// before it ends. The results go to docs/research/suggestion-measurements.json, which
// docs/research/suggestions.md reads.
//
//   AWS_REGION=eu-north-1 AWS_PROFILE=... node scripts/measure-suggestions.ts [runs]
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { CreateRoleCommand, DeleteRoleCommand, DeleteRolePolicyCommand, IAMClient, PutRolePolicyCommand } from "@aws-sdk/client-iam";
import { CreateFunctionCommand, DeleteFunctionCommand, InvokeCommand, LambdaClient, waitUntilFunctionActiveV2 } from "@aws-sdk/client-lambda";
import { zipSync } from "fflate";
import { type SuggestionModel, suggestionCost, suggestionModels } from "@duva/api/agent-models";
import { projectTag } from "@duva/api/infrastructure";
import { restOf, suggestionPrompt, suggestionTokens } from "@duva/api/suggestions";

const region = "eu-north-1";
if (process.env.AWS_REGION !== region) throw new Error(`Run it with AWS_REGION=${region}, where the Lambda measures from.`);
const runs = Number(process.argv[2] ?? 3);

interface Draft {
  id: string;
  language: string;
  kind: string;
  to: string[];
  subject: string;
  message?: { from: string; date: string; subject: string; text: string };
  text: string;
  wrote: string;
}
const set = JSON.parse(readFileSync(new URL("suggestion-drafts.json", import.meta.url), "utf8")) as { writer: string; style: string; memories: string[]; drafts: Draft[] };

const prompts = set.drafts.map((draft) => {
  const built = suggestionPrompt({
    text: draft.text,
    subject: draft.subject,
    from: set.writer,
    to: draft.to,
    cc: [],
    ...(draft.message !== undefined && { message: { kind: draft.kind === "forward" ? ("forwards" as const) : ("answers" as const), ...draft.message } }),
    memories: set.memories,
    style: set.style,
  });
  if (built === undefined) throw new Error(`Draft ${draft.id} begins no sentence.`);
  return { draft, ...built };
});

// The Lambda calls Converse as bedrockSuggester does, one call after another, timing each.
const handler = `
import { BedrockRuntimeClient, ConverseCommand, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
const clients = new Map();
const clientIn = (region) => { if (!clients.has(region)) clients.set(region, new BedrockRuntimeClient({ region, maxAttempts: 1 })); return clients.get(region); };
export const handler = async ({ calls }) => {
  const results = [];
  for (const call of calls) {
    const started = performance.now();
    try {
      if (call.embed !== undefined) {
        await clientIn(call.region).send(new InvokeModelCommand({ modelId: "amazon.titan-embed-text-v2:0", contentType: "application/json", accept: "application/json", body: JSON.stringify({ inputText: call.embed, dimensions: 1024, normalize: true }) }));
        results.push({ ms: performance.now() - started });
        continue;
      }
      const { output, usage } = await clientIn(call.region).send(new ConverseCommand({
        modelId: call.modelId,
        system: [{ text: call.system }],
        messages: [{ role: "user", content: [{ text: call.prompt }] }],
        inferenceConfig: { maxTokens: call.maxTokens, temperature: 0 },
        ...(call.extra && { additionalModelRequestFields: call.extra }),
      }));
      const text = (output?.message?.content ?? []).filter((block) => block.text !== undefined).map((block) => block.text).join("");
      results.push({ ms: performance.now() - started, text, inputTokens: usage?.inputTokens ?? 0, outputTokens: usage?.outputTokens ?? 0 });
    } catch (error) {
      results.push({ ms: performance.now() - started, error: String(error) });
    }
  }
  return results;
};`;

const zipped = (source: string) => zipSync({ "index.mjs": new TextEncoder().encode(source) });

type Result = { ms: number; text?: string; inputTokens?: number; outputTokens?: number; error?: string };

const iam = new IAMClient({ region });
const lambda = new LambdaClient({ region });
const name = `duva-suggestion-probe-${randomUUID().slice(0, 8)}`;
const models = Object.keys(suggestionModels) as SuggestionModel[];
const measured: Record<string, unknown> = {};
let roleMade = false;
let functionMade = false;
try {
  const { Role } = await iam.send(
    new CreateRoleCommand({
      RoleName: name,
      Tags: [projectTag],
      AssumeRolePolicyDocument: JSON.stringify({ Version: "2012-10-17", Statement: [{ Effect: "Allow", Principal: { Service: "lambda.amazonaws.com" }, Action: "sts:AssumeRole" }] }),
    }),
  );
  roleMade = true;
  await iam.send(
    new PutRolePolicyCommand({ RoleName: name, PolicyName: "bedrock", PolicyDocument: JSON.stringify({ Version: "2012-10-17", Statement: [{ Effect: "Allow", Action: "bedrock:InvokeModel", Resource: "*" }] }) }),
  );
  // A new role takes a while before Lambda can assume it.
  for (let attempt = 1; !functionMade; attempt++) {
    try {
      await lambda.send(
        new CreateFunctionCommand({ FunctionName: name, Runtime: "nodejs22.x", Handler: "index.handler", Role: Role!.Arn!, Code: { ZipFile: zipped(handler) }, MemorySize: 1024, Timeout: 600, Tags: { [projectTag.Key]: projectTag.Value } }),
      );
      functionMade = true;
    } catch (error) {
      if (attempt === 12) throw error;
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
  await waitUntilFunctionActiveV2({ client: lambda, maxWaitTime: 120 }, { FunctionName: name });
  const invoke = async (calls: unknown[]): Promise<Result[]> => {
    const { Payload, FunctionError } = await lambda.send(new InvokeCommand({ FunctionName: name, Payload: JSON.stringify({ calls }) }));
    const answer = JSON.parse(new TextDecoder().decode(Payload));
    if (FunctionError !== undefined) throw new Error(JSON.stringify(answer));
    return answer as Result[];
  };

  // Titan's embedding of the memories' query, which each suggestion waits for too.
  await invoke(prompts.slice(0, 2).map(({ draft }) => ({ region, embed: draft.subject })));
  const embeddings = await invoke(prompts.map(({ draft }) => ({ region, embed: `${draft.subject}\n${draft.message?.text ?? ""}` })));
  measured.titan = embeddings.map(({ ms }) => ms);

  for (const model of models) {
    const { modelId, region: from } = suggestionModels[model].call(region);
    const call = ({ system, prompt }: { system: string; prompt: string }) => ({
      region: from,
      modelId,
      system,
      prompt,
      maxTokens: suggestionTokens,
      ...(model === "openai.gpt-oss-20b-1:0" && { extra: { reasoning_effort: "low" } }),
    });
    // A warm connection first, as a busy API Lambda has.
    await invoke(prompts.slice(0, 2).map(call));
    const results: (Result & { draft: string; run: number; suggestion?: string })[] = [];
    for (let run = 1; run <= runs; run++) {
      const answered = await invoke(prompts.map(call));
      answered.forEach((result, at) => results.push({ ...result, draft: prompts[at]!.draft.id, run, ...(result.text !== undefined && { suggestion: restOf(result.text, prompts[at]!.begun) }) }));
    }
    measured[model] = results;
    console.error(`${suggestionModels[model].name}: ${results.length} calls`);
  }
} finally {
  if (functionMade) await lambda.send(new DeleteFunctionCommand({ FunctionName: name }));
  if (roleMade) {
    await iam.send(new DeleteRolePolicyCommand({ RoleName: name, PolicyName: "bedrock" })).catch(() => undefined);
    await iam.send(new DeleteRoleCommand({ RoleName: name }));
  }
  console.error(`Deleted ${name}.`);
}

// What a suggestion is scored by: its words, lowercased without punctuation, and whether it starts a new word.
const words = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
const startsWord = (text: string) => /^\s/.test(text);
const percentile = (values: number[], p: number) => {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
};

const summary = models.map((model) => {
  const results = measured[model] as (Result & { draft: string; suggestion?: string })[];
  const wrote = new Map(set.drafts.map(({ id, wrote }) => [id, wrote]));
  let exact = 0;
  let begins = 0;
  let nothing = 0;
  let failed = 0;
  for (const result of results) {
    if (result.error !== undefined) failed++;
    const suggestion = result.suggestion;
    const written = wrote.get(result.draft)!;
    if (suggestion === undefined) {
      nothing++;
      continue;
    }
    const [said, meant] = [words(suggestion), words(written)];
    const sameStart = startsWord(suggestion) === startsWord(written);
    if (sameStart && said.join(" ") === meant.join(" ")) exact++;
    const first = meant.slice(0, 2);
    if (sameStart && first.every((word, at) => said[at] === word)) begins++;
  }
  const ok = results.filter(({ error }) => error === undefined);
  const cost = ok.reduce((sum, result) => sum + suggestionCost({ inputTokens: result.inputTokens!, outputTokens: result.outputTokens! }, model), 0) / ok.length;
  return {
    model,
    name: suggestionModels[model].name,
    calls: results.length,
    failed,
    p50: Math.round(percentile(ok.map(({ ms }) => ms), 50)),
    p95: Math.round(percentile(ok.map(({ ms }) => ms), 95)),
    exact: exact / results.length,
    begins: begins / results.length,
    nothing: nothing / results.length,
    costPerSuggestion: cost,
    inputTokens: Math.round(ok.reduce((sum, { inputTokens }) => sum + inputTokens!, 0) / ok.length),
    outputTokens: Math.round(ok.reduce((sum, { outputTokens }) => sum + outputTokens!, 0) / ok.length),
  };
});
const titan = measured.titan as number[];
const report = { measuredOn: new Date().toISOString().slice(0, 10), region, runs, drafts: set.drafts.length, titan: { p50: Math.round(percentile(titan, 50)), p95: Math.round(percentile(titan, 95)) }, summary, measured };
writeFileSync(new URL("../docs/research/suggestion-measurements.json", import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ titan: report.titan, summary }, null, 2));
