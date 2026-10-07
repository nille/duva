// Ask your agent: a human's conversation with their mailbox's mailbox agent (ADR-0027). The web app
// posts each turn to the conversation Lambda, through the web app's CloudFront distribution, which
// checks the human, gives the run its token, runs the agent on AgentCore and streams what it says
// and does back as it goes. The turns are kept in the human's partition, so they go with them.
import { randomUUID } from "node:crypto";
import { BatchWriteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { components, ConversationEvent } from "@duva/openapi";
import type { AgentAction, RunEvent, RunPayload } from "./agent-loop.ts";
import { costOf } from "./agent-models.ts";
import { actorNamed, raiseAlert } from "./alerting.ts";
import { type OperationHandler, refusal } from "./api.ts";
import type { Table } from "./deployment.ts";
import { mailboxAgentOf } from "./mailbox-agents.ts";
import { sponsorAccessIn } from "./access.ts";
import { type Actor, type Agent, agentSettings, findMailbox, type Human, type Mailbox, organizationSettings, switchesFor } from "./organization.ts";
import { tokenHeader } from "./infrastructure.ts";
import { endRunToken, issueRunToken } from "./run-tokens.ts";
import { documents, pk, sk } from "./table.ts";

export type ConversationTurn = components["schemas"]["ConversationTurn"];

export type { ConversationEvent };


/** The most turns a conversation shows, and the most the agent reads back. */
const turnsKept = 100;
const turnsRead = 20;
// The longest turn a human may ask, in characters.
const longestWords = 10_000;

const turnPrefix = (mailbox: string) => `turn#${mailbox}#`;
const spendKey = (month: string) => ({ [pk]: "organization", [sk]: `mailbox-agent-spend#${month}` });
const monthOf = (at: Date) => at.toISOString().slice(0, 7);

/** Runs the mailbox agent on AgentCore, in the session, and gives what it says as it goes. */
export type AgentRuntime = (payload: RunPayload, session: string) => AsyncIterable<RunEvent>;

/** An answer to a turn: a refusal, or the stream of what happens. */
export type TurnAnswer = { statusCode: number; body: { message: string } } | { statusCode: 200; events: AsyncIterable<ConversationEvent> };

/**
 * The conversation Lambda's logic. A turn is the human's access token in `x-duva-token` and a JSON
 * body with the mailbox and their words. Each turn is a run of its own, in a session of its own.
 * `fetch` reaches Duva's API. Where AgentCore isn't, there is no `runtime`, and every turn is refused.
 */
export function createConversation({ table, region, apiUrl, fetch: call = fetch, runtime }: { table: Table; region: string; apiUrl: string; fetch?: (request: Request) => Promise<Response>; runtime: AgentRuntime | undefined }) {
  return async ({ headers, body }: { headers: Record<string, string | undefined>; body: string }): Promise<TurnAnswer> => {
    // The API's one authorizer says whom the token is, so the Lambda asks the API.
    const asker = await call(new Request(`${apiUrl}/whoami`, { headers: { authorization: `Bearer ${headers[tokenHeader] ?? ""}` } }))
      .then(async (response) => (response.ok ? ((await response.json()) as Actor) : undefined))
      .catch(() => undefined);
    const human = asker?.kind === "human" ? asker : undefined;
    if (human === undefined) return refusal(401, "Duva didn't accept your session. Sign in again.");
    if (runtime === undefined) return refusal(503, `Mailbox agents run on Amazon Bedrock AgentCore, which isn't in ${region}, where Duva is deployed.`);
    const asked = (() => {
      try {
        return JSON.parse(body) as { mailbox?: unknown; words?: unknown };
      } catch {
        return {};
      }
    })();
    const words = typeof asked.words === "string" ? asked.words.trim() : "";
    if (words === "" || words.length > longestWords) return refusal(400, `Ask your agent something, in at most ${longestWords} characters.`);
    const mailbox = typeof asked.mailbox === "string" ? await findMailbox(table, asked.mailbox) : undefined;
    if (mailbox === undefined || mailbox.owner !== human.id) return refusal(404, "That isn't one of your mailboxes. Ask the agent of one of yours.");
    const agent = await mailboxAgentOf(table, mailbox.id);
    if (agent === undefined) return refusal(404, "This mailbox has no mailbox agent yet. Ask an admin to run duva deploy, which gives every mailbox one.");
    if (agent.paused !== undefined) return refusal(409, `Your mailbox agent is paused by ${await actorNamed(table, agent.paused.by)}. Unpause it in Settings to ask it.`);
    const { settings: given } = await agentSettings(table, agent.id);
    const access = sponsorAccessIn(given, mailbox.id);
    if (access === "none") return refusal(409, "Your mailbox agent has no access to this mailbox. Give it some in Settings, under Your agents.");
    const { settings } = await organizationSettings(table, region);
    if (settings.mailboxAgentSpendCap === 0) return refusal(409, "An admin turned the mailbox agents off, with a spend cap of $0. Ask one to raise it.");
    const month = monthOf(new Date());
    const spent = await spentIn(table, month);
    if (spent >= settings.mailboxAgentSpendCap) {
      await capReached(table, agent, month, settings.mailboxAgentSpendCap);
      return refusal(409, capRefusal(settings.mailboxAgentSpendCap));
    }
    const history = await turnsOf(table, human.id, mailbox.id, turnsRead);
    const turn = await addTurn(table, human, mailbox, { from: "human", text: words, actions: [] });
    const payload: Omit<RunPayload, "token"> = {
      apiUrl,
      mailbox: mailbox.id,
      address: mailbox.defaultAddress ?? mailbox.addresses[0] ?? "",
      owner: human.email,
      access,
      approval: switchesFor(given, true).approval,
      model: { model: settings.mailboxAgentModel, profile: settings.mailboxAgentProfile, region: settings.mailboxAgentRegion },
      budget: settings.mailboxAgentSpendCap - spent,
      history: history.map(({ from, text, actions }) => ({ from, text: from === "agent" && actions.length > 0 ? `${text}\n\n(${actionsRead(actions)})` : text })),
      words,
      now: new Date().toISOString(),
    };
    return { statusCode: 200, events: run(payload, turn) };

    async function* run(payload: Omit<RunPayload, "token">, turn: ConversationTurn): AsyncGenerator<ConversationEvent> {
      yield { type: "turn", turn };
      const token = await issueRunToken(table, agent!.id);
      let text = "";
      const actions: AgentAction[] = [];
      let outcome: ConversationTurn["outcome"] = "failed";
      // Each model call's cost is counted as it comes, so a run cut off still counts what it spent.
      let total = spent;
      try {
        for await (const event of runtime!({ ...payload, token }, `${agent!.id}-${randomUUID()}`)) {
          if (event.type === "text") {
            text += event.text;
            yield event;
          } else if (event.type === "action") {
            actions.push(event.action);
            yield event;
          } else if (event.type === "usage") total = await addSpend(table, month, costOf(event, payload.model.model, payload.model.profile));
          else outcome = event.outcome;
        }
      } catch (error) {
        console.error(error);
        outcome = "failed";
      } finally {
        await endRunToken(table, token);
      }
      if (outcome === "capReached" || total >= settings.mailboxAgentSpendCap) await capReached(table, agent!, month, settings.mailboxAgentSpendCap);
      yield { type: "done", turn: await addTurn(table, human!, mailbox!, { from: "agent", text, actions, outcome }, turn.at) };
    }
  };
}

const capRefusal = (cap: number) => `The mailbox agents reached the organization's spend cap of $${cap} this month. Ask an admin to raise it.`;

/** Alerts the agent's sponsor that its run stopped at the cap, once a month. */
function capReached(table: Table, agent: Agent, month: string, cap: number) {
  return raiseAlert(table, { kind: "spendCapReached", agent, what: `${agent.name} stopped, since the mailbox agents reached the organization's spend cap of $${cap} for ${month}. Ask an admin to raise it.` }, { source: `spend-cap#${month}` });
}

/** What an agent's turn did, as the agent reads it back later. */
const actionsRead = (actions: AgentAction[]) =>
  `You used ${actions.map(({ operation, ok, threads, draft }) => `${operation}${threads ? ` on thread ${threads.join(", ")}` : ""}${draft ? ` with draft ${draft}` : ""}${ok ? "" : " (refused)"}`).join("; ")}.`;

/** Writes a turn of the human's conversation in the mailbox, after the time given if any, and returns it. */
async function addTurn(table: Table, human: Human, mailbox: Mailbox, turn: Omit<ConversationTurn, "id" | "at">, after?: string): Promise<ConversationTurn> {
  const now = new Date();
  const at = new Date(after === undefined ? now : Math.max(now.getTime(), new Date(after).getTime() + 1)).toISOString();
  const written: ConversationTurn = { id: randomUUID(), at, ...turn };
  await documents(table).send(new PutCommand({ TableName: table.name, Item: { [pk]: `actor#${human.id}`, [sk]: `${turnPrefix(mailbox.id)}${at}#${written.id}`, ...written } }));
  return written;
}

/** The last turns of the human's conversation in the mailbox, oldest first. */
async function turnsOf(table: Table, human: string, mailbox: string, limit: number): Promise<ConversationTurn[]> {
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

/** What the mailbox agents spent in the month, in US dollars. */
async function spentIn(table: Table, month: string): Promise<number> {
  const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: spendKey(month), ConsistentRead: true }));
  return (Item?.spent as number | undefined) ?? 0;
}

/** Adds what a run cost to the month's spend, and returns the month's spend with it. */
async function addSpend(table: Table, month: string, cost: number): Promise<number> {
  const { Attributes } = await documents(table).send(
    new UpdateCommand({ TableName: table.name, Key: spendKey(month), UpdateExpression: "ADD spent :cost", ExpressionAttributeValues: { ":cost": cost }, ReturnValues: "ALL_NEW" }),
  );
  return Attributes!.spent as number;
}

/** The mailbox's mailbox agent and the conversation with it, if the actor owns the mailbox, or a refusal. */
async function conversationAsked(event: Parameters<OperationHandler>[0], deployment: Parameters<OperationHandler>[1], actor: Parameters<OperationHandler>[2]) {
  const id = event.pathParameters?.mailbox ?? "";
  const mailbox = await findMailbox(deployment.table, id);
  if (mailbox === undefined) return refusal(404, `There is no mailbox ${JSON.stringify(id)}. List the mailboxes you can read to find its ID.`);
  if (mailbox.owner !== actor!.id) return refusal(403, "Only the mailbox's owner talks with its mailbox agent.");
  const agent = await mailboxAgentOf(deployment.table, mailbox.id);
  if (agent === undefined) return refusal(404, "This mailbox has no mailbox agent yet. Ask an admin to run duva deploy, which gives every human's mailbox one.");
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
  if (!actor?.admin) return refusal(403, "Only admins can read what the mailbox agents spent. Ask an admin.");
  const month = monthOf(new Date());
  const { settings } = await organizationSettings(deployment.table, deployment.region);
  return { statusCode: 200, body: { month, spent: await spentIn(deployment.table, month), cap: settings.mailboxAgentSpendCap } satisfies components["schemas"]["MailboxAgentSpend"] };
};
