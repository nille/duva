// Ask Coo: a human's conversation with their mailbox agent (ADR-0027), one conversation, asked from
// one of their mailboxes or from All mailboxes (ADR-0033). The web app posts each turn to the
// conversation Lambda, through the web app's CloudFront distribution, which checks the human, gives
// the run its token, runs the agent on AgentCore and streams what it says and does back as it goes.
// The turns are kept in the human's partition, so they go with them.
import { randomUUID } from "node:crypto";
import { BatchWriteCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { components, ConversationEvent } from "@duva/openapi";
import { type AgentAction, type RunPayload, writing } from "./agent-loop.ts";
import type { MailboxAgentModel } from "./agent-models.ts";
import { type AgentRuntime, monthOf, noMailboxAgent, recordingMailbox, type RunEnd, runMailboxAgent, runtimeMissing, spentIn, startRun } from "./agent-runs.ts";
import { actorNamed } from "./alerting.ts";
import { type OperationHandler, refusal } from "./api.ts";
import type { Table } from "./deployment.ts";
import { recordChanges } from "./feed.ts";
import { mailboxAgentIn, mailboxAgentOf, turnKey, turnPrefix } from "./mailbox-agents.ts";
import { type Actor, type Agent, allHumans, type Human, isAdmin, mailboxFeed, organizationSettings, ownedMailboxes } from "./organization.ts";
import type { Embedder } from "./titan.ts";
import { tokenHeader } from "./infrastructure.ts";
import { documents, pk, sk } from "./table.ts";

export type ConversationTurn = components["schemas"]["ConversationTurn"];

export type { AgentRuntime, ConversationEvent };


/** The most turns a conversation shows, and the most the agent reads back. */
const turnsKept = 100;
const turnsRead = 20;
// The longest turn a human may ask, in characters.
const longestWords = 10_000;

/** An answer to a turn: a refusal, or the stream of what happens. */
export type TurnAnswer = { statusCode: number; body: { message: string } } | { statusCode: 200; events: AsyncIterable<ConversationEvent> };

/**
 * What a turn asks: the mailbox it is asked from, by ID, or none for All mailboxes, and the human's
 * words, or with `harder`, that the harder model answer the last turn again, as Think harder does.
 */
export interface TurnAsked {
  mailbox?: unknown;
  words?: unknown;
  harder?: unknown;
}

/**
 * A turn the human's words are written for, ready to run: what the run is given and what it is
 * counted against. It is plain JSON, so a Lambda can hand it to another to run.
 */
export interface PreparedTurn {
  payload: Omit<RunPayload, "token">;
  turn: ConversationTurn;
  human: Human;
  agent: Agent;
  month: string;
  /** The organization's spend cap on the mailbox agents, in US dollars. */
  cap: number;
  /** Whether it answers the human's last turn again, with the harder model. */
  harder?: boolean;
}

/**
 * Checks that the human may ask their mailbox agent, from the mailbox or All mailboxes, and writes
 * their turn, or refuses with what to do instead. Thinking harder asks from where the turn it answers
 * again was asked. `available` is whether AgentCore runs mailbox agents in the region.
 */
export async function prepareTurn({ table, region, apiUrl, available }: { table: Table; region: string; apiUrl: string; available: boolean }, human: Human, asked: TurnAsked): Promise<PreparedTurn | { statusCode: number; body: { message: string } }> {
  if (!available) return refusal(503, runtimeMissing(region));
  const harder = asked.harder === true;
  const words = typeof asked.words === "string" ? asked.words.trim() : "";
  if (!harder && (words === "" || words.length > longestWords)) return refusal(400, `Ask Coo something, in at most ${longestWords} characters.`);
  // Thinking harder answers the human's last turn again, with what came before it.
  const turns = await turnsOf(table, human.id, turnsRead + 2);
  const asking = turns.findLastIndex(({ from }) => from === "human");
  if (harder && (asking === -1 || turns.at(-1)!.from !== "agent")) return refusal(409, "There's no answer to think harder about. Ask Coo something first.");
  const own = await ownedMailboxes(table, human.id);
  // Thinking harder about a turn asked from a mailbox that is no longer theirs asks from All mailboxes.
  const from = harder ? own.find(({ id }) => id === turns[asking]!.mailbox)?.id : asked.mailbox === undefined || asked.mailbox === null ? undefined : asked.mailbox;
  const mailbox = own.find(({ id }) => id === from);
  if (from !== undefined && mailbox === undefined) return refusal(404, "That isn't one of your mailboxes. Ask Coo from one of yours, or from All mailboxes.");
  const agent = mailbox === undefined ? await mailboxAgentOf(table, human.id) : await mailboxAgentIn(table, mailbox);
  if (agent === undefined) return refusal(404, noMailboxAgent);
  if (agent.paused !== undefined) return refusal(409, `Your mailbox agent is paused by ${await actorNamed(table, agent.paused.by)}. Unpause it in Settings to ask it.`);
  const started = await startRun(table, { agent, mailbox, mailboxes: own, owner: human.email, region, apiUrl, job: harder ? "harder" : "conversation" });
  if ("refused" in started) return refusal(409, started.refused);
  const { start, month, cap } = started;
  const history = (harder ? turns.slice(0, asking) : turns).slice(-turnsRead);
  const turn = harder ? turns[asking]! : await addTurn(table, human, { from: "human", ...(mailbox !== undefined && { mailbox: mailbox.id }), text: words, actions: [] });
  const payload: Omit<RunPayload, "token"> = {
    ...start,
    history: history.map(({ from, text, actions }) => ({ from, text: from === "agent" && actions.length > 0 ? `${text}\n\n(${actionsRead(actions)})` : text })),
    words: turn.text,
  };
  return { payload, turn, human, agent, month, cap, ...(harder && { harder }) };
}

/**
 * Runs the prepared turn on the runtime, saying what happens as it goes, and writes the agent's
 * turn when it ends, with the turn's routing, which it keeps with the words' embedding (#132).
 */
export async function* runTurn(table: Table, runtime: AgentRuntime, embedder: Embedder, { payload, turn, human, agent, month, cap, harder }: PreparedTurn): AsyncGenerator<ConversationEvent> {
  yield { type: "turn", turn };
  const ran = runMailboxAgent(table, { agent, payload, runtime, month, cap });
  let next = await ran.next();
  for (; !next.done; next = await ran.next()) yield next.value;
  const { text, actions, outcome, model, cost, decision, handover } = next.value;
  const answer: Omit<ConversationTurn, "id" | "at"> = {
    from: "agent",
    ...(payload.mailbox !== undefined && { mailbox: payload.mailbox }),
    text,
    actions,
    outcome,
    model,
    ...(decision && { decision }),
    ...(handover && { handover }),
    ...(harder && { harder }),
  };
  const answered = await addTurn(table, human, answer, turn.at);
  // Recorded before the stream ends, so a reader that stops at done still leaves it in the feed.
  const change = { ...turnTaken(agent, human, turn.text, next.value, payload.model.model, harder), ...(payload.mailbox === undefined && { allMailboxes: true }) };
  await recordChanges(table, mailboxFeed(recordingMailbox(payload)), { by: agent.id, changes: [change], items: [] });
  yield { type: "done", turn: answered };
  await keepRouting(table, embedder, human, turn, { month, harder, decision, handover, alone: payload.model.model === payload.model.harder });
}

/** The longest part of the human's words a turn's change in the feed keeps, in characters. */
const askedKept = 120;

/**
 * The change a turn records in the mailbox's feed, so the agent's activity shows it: what the human
 * asked, what the agent touched, the models that answered, and what it cost (#133).
 */
function turnTaken(agent: Agent, human: Human, words: string, { actions, outcome, cost, handover }: RunEnd, first: MailboxAgentModel, harder?: boolean) {
  const touched = (pick: (action: AgentAction) => string[]) => [...new Set(actions.filter(({ ok }) => ok).flatMap(pick))];
  return {
    type: "conversationTurn" as const,
    agent: agent.id,
    human: human.id,
    asked: words.length > askedKept ? `${words.slice(0, askedKept)}…` : words,
    threads: touched(({ threads }) => threads ?? []),
    // Only the drafts it wrote, not those it read (#135).
    drafts: touched(({ operation, draft }) => (draft === undefined || !writing.has(operation) ? [] : [draft])),
    models: handover === undefined ? [first] : [handover.from, handover.to],
    ...(handover !== undefined && { handover }),
    ...(harder && { harder }),
    outcome,
    // Cents, to a thousandth of one.
    cost: Math.round(cost * 100_000) / 1000,
  };
}

const routingKey = (human: string, turn: string) => ({ [pk]: `actor#${human}`, [sk]: `routing#${turn}` });

/**
 * Keeps how the human's turn was routed, labelled as a learned router will read it: the everyday
 * model took it, the decider sent it on, the everyday model handed it over and why, the harder
 * model took it as the one that answers, or its owner had the harder model think harder about it,
 * with its words' Titan embedding. It is kept in the
 * human's partition, so it goes with them, and nothing leaves the account (ADR-0002). A turn kept
 * without its embedding, as when Titan fails, is still counted.
 */
async function keepRouting(
  table: Table,
  embedder: Embedder,
  human: Human,
  turn: ConversationTurn,
  { month, harder, decision, handover, alone }: { month: string; harder?: boolean; decision?: ConversationTurn["decision"]; handover?: ConversationTurn["handover"]; alone: boolean },
) {
  if (harder) {
    await documents(table).send(
      new UpdateCommand({ TableName: table.name, Key: routingKey(human.id, turn.id), UpdateExpression: "SET thoughtHarder = :yes", ConditionExpression: "attribute_exists(#pk)", ExpressionAttributeNames: { "#pk": pk }, ExpressionAttributeValues: { ":yes": true } }),
    ).catch((error: unknown) => console.error(error));
    return;
  }
  const embedding = await embedder
    .embed([turn.text])
    .then(([vector]) => new Uint8Array(vector!.buffer, vector!.byteOffset, vector!.byteLength))
    .catch((error: unknown) => void console.error(error));
  // With the harder model also the one that answers, nothing was routed.
  const label = handover?.reason ?? (alone ? "harder" : "everyday");
  await documents(table).send(
    new PutCommand({ TableName: table.name, Item: { ...routingKey(human.id, turn.id), at: turn.at, month, label, ...(decision && { decision }), ...(embedding && { embedding }) } }),
  );
}

/** How many of the organization's turns the month's routing counts, by how they went. */
async function routingIn(table: Table, month: string): Promise<components["schemas"]["MailboxAgentRouting"]> {
  const routing: components["schemas"]["MailboxAgentRouting"] = {
    month,
    turns: 0,
    everyday: 0,
    harder: 0,
    decided: 0,
    handedOver: { writing: 0, failedCalls: 0, stepBudget: 0, askedForHelp: 0, answerCheck: 0 },
    thoughtHarder: 0,
    embedded: 0,
  };
  for (const human of await allHumans(table)) {
    let after: Record<string, unknown> | undefined;
    do {
      const page = await documents(table).send(
        new QueryCommand({
          TableName: table.name,
          KeyConditionExpression: `${pk} = :human AND begins_with(${sk}, :routing)`,
          FilterExpression: "#month = :month",
          ExpressionAttributeNames: { "#month": "month" },
          ExpressionAttributeValues: { ":human": `actor#${human.id}`, ":routing": "routing#", ":month": month },
          ProjectionExpression: "#month, label, thoughtHarder, embedding",
          ExclusiveStartKey: after,
        }),
      );
      for (const item of page.Items ?? []) {
        routing.turns++;
        if (item.embedding !== undefined) routing.embedded++;
        if (item.thoughtHarder === true) routing.thoughtHarder++;
        else if (item.label === "everyday" || item.label === "harder" || item.label === "decided") routing[item.label as "everyday" | "harder" | "decided"]++;
        else routing.handedOver[item.label as keyof typeof routing.handedOver]++;
      }
      after = page.LastEvaluatedKey;
    } while (after !== undefined);
  }
  return routing;
}

export const getMailboxAgentRouting: OperationHandler = async (_event, deployment, actor) => {
  if (!isAdmin(actor)) return refusal(403, "Only admins can read how the mailbox agents' turns were routed. Ask an admin.");
  return { statusCode: 200, body: await routingIn(deployment.table, monthOf(new Date())) };
};

/**
 * The conversation Lambda's logic. A turn is the human's access token in `x-duva-token` and a JSON
 * body with the mailbox it is asked from, if not All mailboxes, and their words. Each turn is a run of its own, in a session of its own.
 * `fetch` reaches Duva's API. Where AgentCore isn't, there is no `runtime`, and every turn is refused.
 * `run` runs a turn prepared elsewhere, as the MCP endpoint prepares one.
 */
export function createConversation({
  table,
  region,
  apiUrl,
  fetch: call = fetch,
  runtime,
  embedder,
}: {
  table: Table;
  region: string;
  apiUrl: string;
  fetch?: (request: Request) => Promise<Response>;
  runtime: AgentRuntime | undefined;
  embedder: Embedder;
}) {
  return {
    async turn({ headers, body }: { headers: Record<string, string | undefined>; body: string }): Promise<TurnAnswer> {
      // The API's one authorizer says whom the token is, so the Lambda asks the API.
      const asker = await call(new Request(`${apiUrl}/whoami`, { headers: { authorization: `Bearer ${headers[tokenHeader] ?? ""}` } }))
        .then(async (response) => (response.ok ? ((await response.json()) as Actor) : undefined))
        .catch(() => undefined);
      const human = asker?.kind === "human" ? asker : undefined;
      if (human === undefined) return refusal(401, "Duva didn't accept your session. Sign in again.");
      const asked = (() => {
        try {
          return JSON.parse(body) as TurnAsked;
        } catch {
          return {};
        }
      })();
      const prepared = await prepareTurn({ table, region, apiUrl, available: runtime !== undefined }, human, asked);
      if ("statusCode" in prepared) return prepared;
      return { statusCode: 200, events: runTurn(table, runtime!, embedder, prepared) };
    },
    run: (prepared: PreparedTurn) => runTurn(table, runtime!, embedder, prepared),
  };
}

/** What an agent's turn did, as the agent reads it back later. */
export const actionsRead = (actions: AgentAction[], who = "You") =>
  `${who} used ${actions.map(({ operation, ok, threads, draft }) => `${operation}${threads ? ` on thread ${threads.join(", ")}` : ""}${draft ? ` with draft ${draft}` : ""}${ok ? "" : " (refused)"}`).join("; ")}.`;

/** Writes a turn of the human's conversation, after the time given if any, and returns it. */
async function addTurn(table: Table, human: Human, turn: Omit<ConversationTurn, "id" | "at">, after?: string): Promise<ConversationTurn> {
  const now = new Date();
  const at = new Date(after === undefined ? now : Math.max(now.getTime(), new Date(after).getTime() + 1)).toISOString();
  const written: ConversationTurn = { id: randomUUID(), at, ...turn };
  await documents(table).send(new PutCommand({ TableName: table.name, Item: { ...turnKey(human.id, at, written.id), ...written } }));
  return written;
}

/** The last turns of the human's conversation, oldest first. */
export async function turnsOf(table: Table, human: string, limit: number): Promise<ConversationTurn[]> {
  const { Items = [] } = await documents(table).send(
    new QueryCommand({
      TableName: table.name,
      KeyConditionExpression: `${pk} = :human AND begins_with(${sk}, :turns)`,
      ExpressionAttributeValues: { ":human": `actor#${human}`, ":turns": turnPrefix },
      ScanIndexForward: false,
      Limit: limit,
      ConsistentRead: true,
    }),
  );
  return Items.reverse().map(
    ({ id, at, from, mailbox, text, actions, outcome, model, decision, handover, harder }) =>
      ({ id, at, from, ...(mailbox !== undefined && { mailbox }), text, actions, ...(outcome !== undefined && { outcome }), ...(model !== undefined && { model }), ...(decision !== undefined && { decision }), ...(handover !== undefined && { handover }), ...(harder !== undefined && { harder }) }) as ConversationTurn,
  );
}

/** The human's mailbox agent, if the actor is a human who has one, or a refusal. */
async function conversationAsked(deployment: Parameters<OperationHandler>[1], actor: Parameters<OperationHandler>[2]) {
  if (actor!.kind !== "human") return refusal(403, "Only a human talks with their mailbox agent. Ask your sponsor.");
  const agent = await mailboxAgentOf(deployment.table, actor!.id);
  if (agent !== undefined) return { agent };
  if ((await ownedMailboxes(deployment.table, actor!.id)).length === 0) return refusal(404, "You have no mailbox, so no mailbox agent. Ask an admin to create a mailbox for you.");
  return refusal(404, noMailboxAgent);
}

export const getMailboxAgent: OperationHandler = async (_event, deployment, actor) => {
  const asked = await conversationAsked(deployment, actor);
  if ("statusCode" in asked) return asked;
  const turns = await turnsOf(deployment.table, actor!.id, turnsKept);
  return { statusCode: 200, body: { agent: asked.agent, turns } satisfies components["schemas"]["MailboxAgentConversation"] };
};

export const clearConversation: OperationHandler = async (_event, deployment, actor) => {
  const asked = await conversationAsked(deployment, actor);
  if ("statusCode" in asked) return asked;
  const { table } = deployment;
  for (;;) {
    const { Items = [] } = await documents(table).send(
      new QueryCommand({
        TableName: table.name,
        KeyConditionExpression: `${pk} = :human AND begins_with(${sk}, :turns)`,
        ExpressionAttributeValues: { ":human": `actor#${actor!.id}`, ":turns": turnPrefix },
        ProjectionExpression: `${pk}, ${sk}`,
        Limit: 25,
        ConsistentRead: true,
      }),
    );
    if (Items.length === 0) break;
    await documents(table).send(new BatchWriteCommand({ RequestItems: { [table.name]: Items.map((Key) => ({ DeleteRequest: { Key } })) } }));
  }
  return { statusCode: 200, body: { agent: asked.agent, turns: [] } satisfies components["schemas"]["MailboxAgentConversation"] };
};

export const getMailboxAgentSpend: OperationHandler = async (_event, deployment, actor) => {
  if (!isAdmin(actor)) return refusal(403, "Only admins can read what the mailbox agents spent. Ask an admin.");
  const month = monthOf(new Date());
  const { settings } = await organizationSettings(deployment.table, deployment.region);
  return { statusCode: 200, body: { month, spent: await spentIn(deployment.table, month), cap: settings.mailboxAgentSpendCap } satisfies components["schemas"]["MailboxAgentSpend"] };
};
