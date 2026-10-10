// The models measured on Coo's evaluation (#149, ADR-0035), for scripts/generate.ts: each model a
// setup ran alone, with what a task cost from the tokens recorded in coo-answers.json, and its
// success by kind of work from the table in docs/research/coo-models.md, since only the graders'
// replay can tell success, and the doc keeps what it found.
import { readFile } from "node:fs/promises";
import { costOf, type MailboxAgentModel } from "../packages/api/src/agent-models.ts";

export const answersPath = "packages/api/test/coo-answers.json";
export const researchPath = "docs/research/coo-models.md";

/** A recorded step: a model call and what it gave, or the decider's decision. */
type Step = { model?: MailboxAgentModel; events?: { usage?: { inputTokens: number; outputTokens: number } }[] };

const kinds = { Conversation: "conversation", Drafting: "drafting", Triage: "triage", "Label task": "labelTask", Refusal: "refusal" } as const;

/** The generated module's text, or why it can't be generated. */
export async function measuredModelsSource(root: URL, header: string): Promise<string> {
  const answers = JSON.parse(await readFile(new URL(answersPath, root), "utf8")) as Record<string, Step[]>;
  const success = successBySetup(await readFile(new URL(researchPath, root), "utf8"));
  const setups = new Map<string, { models: Set<MailboxAgentModel>; cost: number; runs: number }>();
  for (const [key, steps] of Object.entries(answers)) {
    const name = key.split(" | ")[0]!;
    const setup = setups.get(name) ?? { models: new Set(), cost: 0, runs: 0 };
    setups.set(name, setup);
    setup.runs += 1;
    for (const { model, events = [] } of steps) {
      if (model === undefined) continue;
      setup.models.add(model);
      // The evaluation calls each model as a deployment in eu-north-1 does.
      for (const { usage } of events) if (usage !== undefined) setup.cost += costOf(usage, model, "eu-north-1");
    }
  }
  const measured: Record<string, unknown> = {};
  for (const [name, { models, cost, runs }] of setups) {
    // Only a setup that ran one model alone measures that model.
    if (models.size !== 1) continue;
    const [model] = models;
    if (model! in measured) throw new Error(`Two setups in ${answersPath} ran ${model} alone. Keep one.`);
    const rates = success.get(name);
    if (rates === undefined) throw new Error(`${researchPath} has no row for ${name} in its table of success by kind of work. Add it.`);
    measured[model!] = { success: rates, costPerTask: Math.round((cost / runs) * 1_000_000) / 1_000_000 };
  }
  return `${header}/** Each model Coo's evaluation measured, its success by kind of work from 0 to 1, and its cost per task in US dollars. */\nexport const measuredModels = ${JSON.stringify(measured, null, 2)} as const;\n`;
}

/** The rates in the doc's table of success by kind of work, by setup. */
function successBySetup(research: string): Map<string, Record<string, number>> {
  const section = research.split(/^## /m).find((part) => part.startsWith("Success, by kind of work"));
  const rows = (section ?? "").split("\n").filter((line) => line.startsWith("|")).map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()));
  const [head, , ...body] = rows;
  if (head === undefined) throw new Error(`${researchPath} has no table under "## Success, by kind of work".`);
  const columns = head.flatMap((name, index) => (name in kinds ? [[index, kinds[name as keyof typeof kinds]] as const] : []));
  return new Map(body.map(([name, ...cells]) => [name!, Object.fromEntries(columns.map(([index, kind]) => [kind, Number(cells[index - 1])]))]));
}
