// Ask Coo: a human's conversation with their mailbox's mailbox agent (ADR-0027). The web app
// posts each turn to the conversation Lambda, through the web app's CloudFront distribution, which
// checks the human, gives the run its token, runs the agent on AgentCore and streams what it says
// and does back as it goes. The turns are kept in the human's partition, so they go with them.
import { randomUUID } from "node:crypto";
import { BatchWriteCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { components, ConversationEvent } from "@duva/openapi";
import type { AgentAction, RunPayload } from "./agent-loop.ts";
import { type AgentRuntime, monthOf, noMailboxAgent, runMailboxAgent, runtimeMissing, spentIn, startRun } from "./agent-runs.ts";
import { actorNamed } from "./alerting.ts";
import { type OperationHandler, refusal } from "./api.ts";
import type { Table } from "./deployment.ts";
import { mailboxAgentOf } from "./mailbox-agents.ts";
import { type Actor, type Agent, findMailbox, type Human, isAdmin, type Mailbox, organizationSettings } from "./organization.ts";
import { tokenHeader } from "./infrastructure.ts";
import { documents, pk, sk } from "./table.ts";

export type ConversationTurn = components["schemas"]["ConversationTurn"];

export type { AgentRuntime, ConversationEvent };


/** The most turns a conversation shows, and the most the agent reads back. */
const turnsKept = 100;
const turnsRead = 20;
// The longest turn a human may ask, in characters.
const longestWords = 10_000;

const turnPrefix = (mailbox: string) => `turn#${mailbox}#`;

/** An answer to a turn: a refusal, or the stream of what happens. */
export type TurnAnswer = { statusCode: number; body: { message: string } } | { statusCode: 200; events: AsyncIterable<ConversationEvent> };

/** What a turn asks: the mailbox whose agent it asks, by ID, and the human's words. */
export interface TurnAsked {
  mailbox?: unknown;
  words?: unknown;
}

/**
 * A turn the human's words are written for, ready to run: what the run is given and what it is
 * counted against. It is plain JSON, so a Lambda can hand it to another to run.
 */
export interface PreparedTurn {
  payload: Omit<RunPayload, "token">;
  turn: ConversationTurn;
  human: Human;
  mailbox: Mailbox;
  agent: Agent;
  month: string;
  /** The organization's spend cap on the mailbox agents, in US dollars. */
  cap: number;
}

/**
 * Checks that the human may ask their mailbox's mailbox agent, and writes their turn, or refuses
 * with what to do instead. `available` is whether AgentCore runs mailbox agents in the region.
 */
export async function prepareTurn({ table, region, apiUrl, available }: { table: Table; region: string; apiUrl: string; available: boolean }, human: Human, asked: TurnAsked): Promise<PreparedTurn | { statusCode: number; body: { message: string } }> {
  if (!available) return refusal(503, runtimeMissing(region));
  const words = typeof asked.words === "string" ? asked.words.trim() : "";
  if (words === "" || words.length > longestWords) return refusal(400, `Ask Coo something, in at most ${longestWords} characters.`);
  const mailbox = typeof asked.mailbox === "string" ? await findMailbox(table, asked.mailbox) : undefined;
  if (mailbox === undefined || mailbox.owner !== human.id) return refusal(404, "That isn't one of your mailboxes. Ask the agent of one of yours.");
  const agent = await mailboxAgentOf(table, mailbox.id);
  if (agent === undefined) return refusal(404, noMailboxAgent);
  if (agent.paused !== undefined) return refusal(409, `Your mailbox agent is paused by ${await actorNamed(table, agent.paused.by)}. Unpause it in Settings to ask it.`);
  const started = await startRun(table, { agent, mailbox, owner: human.email, region, apiUrl });
  if ("refused" in started) return refusal(409, started.refused);
  const { start, month, cap } = started;
  const history = await turnsOf(table, human.id, mailbox.id, turnsRead);
  const turn = await addTurn(table, human, mailbox, { from: "human", text: words, actions: [] });
  const payload: Omit<RunPayload, "token"> = {
    ...start,
    history: history.map(({ from, text, actions }) => ({ from, text: from === "agent" && actions.length > 0 ? `${text}\n\n(${actionsRead(actions)})` : text })),
    words,
  };
  return { payload, turn, human, mailbox, agent, month, cap };
}

/** Runs the prepared turn on the runtime, saying what happens as it goes, and writes the agent's turn when it ends. */
export async function* runTurn(table: Table, runtime: AgentRuntime, { payload, turn, human, mailbox, agent, month, cap }: PreparedTurn): AsyncGenerator<ConversationEvent> {
  yield { type: "turn", turn };
  const ran = runMailboxAgent(table, { agent, payload, runtime, month, cap });
  let next = await ran.next();
  for (; !next.done; next = await ran.next()) yield next.value;
  const { text, actions, outcome } = next.value;
  yield { type: "done", turn: await addTurn(table, human, mailbox, { from: "agent", text, actions, outcome }, turn.at) };
}

/**
 * The conversation Lambda's logic. A turn is the human's access token in `x-duva-token` and a JSON
 * body with the mailbox and their words. Each turn is a run of its own, in a session of its own.
 * `fetch` reaches Duva's API. Where AgentCore isn't, there is no `runtime`, and every turn is refused.
 * `run` runs a turn prepared elsewhere, as the MCP endpoint prepares one.
 */
export function createConversation({ table, region, apiUrl, fetch: call = fetch, runtime }: { table: Table; region: string; apiUrl: string; fetch?: (request: Request) => Promise<Response>; runtime: AgentRuntime | undefined }) {
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
      return { statusCode: 200, events: runTurn(table, runtime!, prepared) };
    },
    run: (prepared: PreparedTurn) => runTurn(table, runtime!, prepared),
  };
}

/** What an agent's turn did, as the agent reads it back later. */
export const actionsRead = (actions: AgentAction[], who = "You") =>
  `${who} used ${actions.map(({ operation, ok, threads, draft }) => `${operation}${threads ? ` on thread ${threads.join(", ")}` : ""}${draft ? ` with draft ${draft}` : ""}${ok ? "" : " (refused)"}`).join("; ")}.`;

/** Writes a turn of the human's conversation in the mailbox, after the time given if any, and returns it. */
async function addTurn(table: Table, human: Human, mailbox: Mailbox, turn: Omit<ConversationTurn, "id" | "at">, after?: string): Promise<ConversationTurn> {
  const now = new Date();
  const at = new Date(after === undefined ? now : Math.max(now.getTime(), new Date(after).getTime() + 1)).toISOString();
  const written: ConversationTurn = { id: randomUUID(), at, ...turn };
  await documents(table).send(new PutCommand({ TableName: table.name, Item: { [pk]: `actor#${human.id}`, [sk]: `${turnPrefix(mailbox.id)}${at}#${written.id}`, ...written } }));
  return written;
}

/** The last turns of the human's conversation in the mailbox, oldest first. */
export async function turnsOf(table: Table, human: string, mailbox: string, limit: number): Promise<ConversationTurn[]> {
  const { Items = [] } = await documents(table).send(
    new QueryCommand({
      TableName: table.name,
      KeyConditionExpression: `${pk} = :human AND begins_with(${sk}, :turns)`,
      ExpressionAttributeValues: { ":human": `actor#${human}`, ":turns": turnPrefix(mailbox) },
      ScanIndexForward: false,
      Limit: limit,
      ConsistentRead: true,
    }),
  );
  return Items.reverse().map(({ id, at, from, text, actions, outcome }) => ({ id, at, from, text, actions, ...(outcome !== undefined && { outcome }) }) as ConversationTurn);
}

/** The mailbox's mailbox agent and the conversation with it, if the actor owns the mailbox, or a refusal. */
async function conversationAsked(event: Parameters<OperationHandler>[0], deployment: Parameters<OperationHandler>[1], actor: Parameters<OperationHandler>[2]) {
  const id = event.pathParameters?.mailbox ?? "";
  const mailbox = await findMailbox(deployment.table, id);
  if (mailbox === undefined) return refusal(404, `There is no mailbox ${JSON.stringify(id)}. List the mailboxes you can read to find its ID.`);
  if (mailbox.owner !== actor!.id) return refusal(403, "Only the mailbox's owner talks with its mailbox agent.");
  const agent = await mailboxAgentOf(deployment.table, mailbox.id);
  if (agent === undefined) return refusal(404, noMailboxAgent);
  return { mailbox, agent };
}

export const getMailboxAgent: OperationHandler = async (event, deployment, actor) => {
  const asked = await conversationAsked(event, deployment, actor);
  if ("statusCode" in asked) return asked;
  const turns = await turnsOf(deployment.table, actor!.id, asked.mailbox.id, turnsKept);
  return { statusCode: 200, body: { agent: asked.agent, turns } satisfies components["schemas"]["MailboxAgentConversation"] };
};

export const clearConversation: OperationHandler = async (event, deployment, actor) => {
  const asked = await conversationAsked(event, deployment, actor);
  if ("statusCode" in asked) return asked;
  const { table } = deployment;
  for (;;) {
    const { Items = [] } = await documents(table).send(
      new QueryCommand({
        TableName: table.name,
        KeyConditionExpression: `${pk} = :human AND begins_with(${sk}, :turns)`,
        ExpressionAttributeValues: { ":human": `actor#${actor!.id}`, ":turns": turnPrefix(asked.mailbox.id) },
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
