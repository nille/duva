// Ask Coo: a human's conversation with their mailbox agent (ADR-0027), one conversation, asked from
// one of their mailboxes or from All mailboxes (ADR-0033). The web app posts each turn to the
// conversation Lambda, through the web app's CloudFront distribution, which checks the human, gives
// the run its token, runs the agent on AgentCore and streams what it says and does back as it goes.
// The turns are kept in the human's partition, so they go with them, and each names the threads its
// run read, so it goes with them too, with the human's turn it answered (#172). It also names the
// threads that the turns its run had in view read themselves, since its answer may repeat theirs,
// but not those they went with in turn, so erasing a thread reaches no further than a run reads back (#178).
import { randomUUID } from "node:crypto";
import { BatchWriteCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { components, ConversationEvent } from "@duva/openapi";
import { type AgentAction, idsIn, type RunPayload, writing } from "./agent-loop.ts";
import type { MailboxAgentModel } from "./agent-models.ts";
import { type AgentRuntime, centsOf, handoverRecorded, monthOf, noMailboxAgent, recordingMailbox, type RunEnd, runMailboxAgent, runtimeMissing, spentIn, startRun } from "./agent-runs.ts";
import { actorNamed } from "./alerting.ts";
import { type OperationHandler, refusal } from "./operation-handler.ts";
import type { Table } from "./deployment.ts";
import { recordChanges } from "./feed.ts";
import { isOwnAddress } from "./coo-address.ts";
import { cooRequestsErased } from "./coo-requests.ts";
import { indexedLanguages, wordsLanguage } from "./languages.ts";
import { mailboxAgentIn, mailboxAgentOf, turnKey, turnPrefix } from "./mailbox-agents.ts";
import { firstMemoryNoted } from "./memories.ts";
import { type Actor, type Agent, allHumans, type Human, isAdmin, mailboxFeed, organizationSettings, ownedMailboxes } from "./organization.ts";
import type { Embedder } from "./titan.ts";
import { tokenHeader } from "./infrastructure.ts";
import { documents, pk, sk } from "./table.ts";
import { eraseTurns, keepTurnSources, threadsNamed, type TurnSource } from "./turn-sources.ts";

export type ConversationTurn = components["schemas"]["ConversationTurn"];

export type { AgentRuntime, ConversationEvent };


const sourceKey = ({ mailbox, thread }: TurnSource) => `${mailbox}#${thread}`;
/** The sources, each once. */
const distinct = (sources: TurnSource[]) => [...new Map(sources.map((source) => [sourceKey(source), source])).values()];

/** The most turns a conversation shows, and the most the agent reads back. */
const turnsKept = 100;
const turnsRead = 20;
// The longest turn a human may ask, in characters.
const longestWords = 10_000;
// The most of a request by mail Coo reads, its forwarded mail and attachments included, in characters.
const longestMail = 30_000;

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
  /** The threads the turns in its run's history read themselves, which it goes with too, absent from a turn prepared before #178. */
  inView?: TurnSource[];
}

/**
 * A request that came by mail to the human's Coo's address (ADR-0040): the ID SES gave it, the
 * address that mailed it, and what the run reads beside its text, its forwarded mail and attachments.
 */
export interface ByMail {
  request: string;
  from: string;
  beside: string;
}

/**
 * Checks that the human may ask their mailbox agent, from the mailbox or All mailboxes, and writes
 * their turn, or refuses with what to do instead. Thinking harder asks from where the turn it answers
 * again was asked. `available` is whether AgentCore runs mailbox agents in the region. A request by
 * mail is a turn from All mailboxes marked with its sender, whose run reads what came beside its text.
 */
export async function prepareTurn(
  { table, region, apiUrl, available }: { table: Table; region: string; apiUrl: string; available: boolean },
  human: Human,
  asked: TurnAsked,
  mail?: ByMail,
): Promise<PreparedTurn | { statusCode: number; body: { message: string } }> {
  if (!available) return refusal(503, runtimeMissing(region));
  const harder = asked.harder === true;
  const given = typeof asked.words === "string" ? asked.words.trim() : "";
  // A request by mail is read as far as Coo reads one, however long.
  const words = mail === undefined ? given : given.slice(0, longestMail);
  if (!harder && (words === "" || words.length > longestWords) && mail === undefined) return refusal(400, `Ask Coo something, in at most ${longestWords} characters.`);
  // Thinking harder answers the human's last turn again, with what came before it, unless that turn
  // or the last answer was erased with mail its run read. No run reads an erased turn.
  const stored = await storedTurns(table, human.id, turnsRead + 2);
  const recent = stored.map(({ turn }) => turn);
  const readable = stored.filter(({ turn }) => turn.erased !== true);
  const turns = readable.map(({ turn }) => turn);
  const asking = turns.findLastIndex(({ from }) => from === "human");
  const erasedLast = recent.at(-1)?.erased === true || recent.findLast(({ from }) => from === "human")?.erased === true;
  if (harder && (asking === -1 || erasedLast || turns.at(-1)!.from !== "agent")) return refusal(409, "There's no answer to think harder about. Ask Coo something first.");
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
  const viewed = (harder ? readable.slice(0, asking) : readable).slice(-turnsRead);
  const history = viewed.map(({ turn }) => turn);
  const turn = harder
    ? turns[asking]!
    : await addTurn(table, human, { from: "human", ...(mailbox !== undefined && { mailbox: mailbox.id }), text: words, actions: [], ...(mail !== undefined && { byMail: mail.from }) }, { ...(mail !== undefined && { request: mail.request }) });
  // A request mailed from any of the human's own addresses is theirs (#188).
  const fromOwn = mail === undefined || (await isOwnAddress(table, human, mail.from));
  // Told to answer in the language its human writes in, Claude Sonnet 5.5 answered English requests
  // in Swedish or German after a handover in #184's real run, and told it by name, it held (#188).
  const { settings } = await organizationSettings(table);
  const language = wordsLanguage(turn.text, indexedLanguages(settings.searchLanguages));
  const payload: Omit<RunPayload, "token"> = {
    ...start,
    ...(!fromOwn && { askedBy: mail!.from }),
    ...(language !== undefined && { language }),
    history: history.map((each) => ({ from: each.from, text: each.text, ...(each.from === "agent" && didIn(each)) })),
    words: mail === undefined ? turn.text : mailedWords(human, mail, turn.text, fromOwn),
  };
  return { payload, turn, human, agent, month, cap, ...(harder && { harder }), inView: distinct(viewed.flatMap(({ read }) => read)) };
}

/** What the run reads of a request by mail: who sent it, its text and what came beside it, as far as Coo reads one. `own` is whether it came from one of the human's own addresses. */
const mailedWords = (human: Human, { from, beside }: ByMail, text: string, own: boolean) =>
  [
    `${from} mailed this to your address${own ? "" : `, which ${human.email} lets them do`}. Your answer is mailed back to ${from}, with what you did.`,
    "",
    text === "" ? "(The mail has no text.)" : text,
    ...(beside === "" ? [] : ["", beside]),
  ]
    .join("\n")
    .slice(0, longestMail);

/**
 * Runs the prepared turn on the runtime, saying what happens as it goes, and writes the agent's
 * turn when it ends, naming the threads its run read and its text names by ID, and those the turns
 * it had in view read themselves (#178), with the turn's routing, which it keeps with the words'
 * embedding (#132). If one of those threads was erased meanwhile, the turn and the human's it
 * answered are erased as they are written (#172).
 */
export async function* runTurn(table: Table, runtime: AgentRuntime, embedder: Embedder, { payload, turn, human, agent, month, cap, harder, inView = [] }: PreparedTurn): AsyncGenerator<ConversationEvent> {
  yield { type: "turn", turn };
  // The threads it read are found as it reads them, so one erased before it ends is still found.
  const mailboxes = payload.mailboxes.map(({ id }) => id);
  const sources = new Map<string, TurnSource>();
  const read = async (ids: string[]) => {
    for (const source of await threadsNamed(table, mailboxes, ids)) sources.set(sourceKey(source), source);
  };
  const ran = runMailboxAgent(table, { agent, payload, runtime, month, cap, turn: turn.id, read });
  let next = await ran.next();
  for (; !next.done; next = await ran.next()) yield next.value;
  const { text, actions, searches, browsed, outcome, model, cost, decision, handover } = next.value;
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
    ...(turn.byMail !== undefined && { byMail: turn.byMail }),
    // Its first memory from mail, kept in this turn or a task before it, is said once (ADR-0036).
    ...((await firstMemoryNoted(table, human.id)) && { firstMemory: true }),
    ...(searches && { searches }),
    ...(browsed && { browsed }),
  };
  await read(idsIn(text));
  const own = [...sources.values()];
  const written = await addTurn(table, human, answer, { after: turn.at, read: own });
  const kept = await keepTurnSources(table, { human: human.id, asked: turn, answer: written }, distinct([...own, ...inView]));
  if (!kept) await eraseTurns(table, human.id, [turn, written]);
  const answered = kept ? written : erasedTurn(written);
  // Recorded before the stream ends, so a reader that stops at done still leaves it in the feed.
  const change = { ...turnTaken(agent, human, turn, next.value, payload.model.model, harder), ...(payload.mailbox === undefined && { allMailboxes: true }) };
  await recordChanges(table, mailboxFeed(recordingMailbox(payload)), { by: agent.id, changes: [change], items: [] });
  yield { type: "done", turn: answered };
  await keepRouting(table, embedder, human, turn, { month, harder, decision, handover, alone: payload.model.model === payload.model.harder });
}

/** The longest part of the human's words a turn's change in the feed keeps, in characters. */
const askedKept = 120;

/**
 * The change a turn records in the mailbox's feed, so the agent's activity shows it: what the human
 * asked, or who mailed it, what the agent touched, the models that answered, and what it cost (#133).
 * A request by mail's words are the mail's, which go with it, so its change keeps none (#178).
 */
function turnTaken(agent: Agent, human: Human, { text: words, byMail }: ConversationTurn, { actions, outcome, cost, handover }: RunEnd, first: MailboxAgentModel, harder?: boolean) {
  const touched = (pick: (action: AgentAction) => string[]) => [...new Set(actions.filter(({ ok }) => ok).flatMap(pick))];
  return {
    type: "conversationTurn" as const,
    agent: agent.id,
    human: human.id,
    ...(byMail === undefined ? { asked: words.length > askedKept ? `${words.slice(0, askedKept)}…` : words } : { byMail }),
    threads: touched(({ threads }) => threads ?? []),
    // Only the drafts it wrote, not those it read (#135).
    drafts: touched(({ operation, draft }) => (draft === undefined || !writing.has(operation) ? [] : [draft])),
    models: handover === undefined ? [first] : [handover.from, handover.to],
    ...(handover !== undefined && { handover: handoverRecorded(handover) }),
    ...(harder && { harder }),
    outcome,
    cost: centsOf(cost),
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

/**
 * What Duva notes of one of the agent's turns in the history a later run reads (#151): when it was
 * given, the operations it used, and each site it browsed with what that run said, quoted. Told
 * less, Claude Haiku 5.5 called an answer wrong that a payment approved since had changed (#184).
 */
function didIn({ at, actions, browsed = [] }: ConversationTurn): { did?: string } {
  const done = [...(actions.length > 0 ? [actionsRead(actions, "you").slice(0, -1)] : []), ...browsed.map(({ site, said }) => `you browsed ${site}, and its run said ${JSON.stringify(said)}`)];
  const said = done.join("; and ");
  return done.length === 0 ? {} : { did: `given at ${at}, ${said}${said.endsWith('"') ? "" : "."}` };
}

/** What an agent's turn did, as the agent reads it back later. */
export const actionsRead = (actions: AgentAction[], who = "You") =>
  `${who} used ${actions.map(({ operation, ok, threads, draft }) => `${operation}${threads ? ` on thread ${threads.join(", ")}` : ""}${draft ? ` with draft ${draft}` : ""}${ok ? "" : " (refused)"}`).join("; ")}.`;

/**
 * Writes a turn of the human's conversation, after the time given if any, and returns it. A request
 * by mail's turn keeps its ID, so the request goes with the turn. An agent's turn keeps the threads
 * its own run read, so the turns that have it in view go with them too (#178).
 */
async function addTurn(
  table: Table,
  human: Human,
  turn: Omit<ConversationTurn, "id" | "at">,
  { after, request, read }: { after?: string; request?: string; read?: TurnSource[] } = {},
): Promise<ConversationTurn> {
  const now = new Date();
  const at = new Date(after === undefined ? now : Math.max(now.getTime(), new Date(after).getTime() + 1)).toISOString();
  const written: ConversationTurn = { id: randomUUID(), at, ...turn };
  await documents(table).send(
    new PutCommand({ TableName: table.name, Item: { ...turnKey(human.id, at, written.id), ...written, ...(request !== undefined && { request }), ...(read !== undefined && read.length > 0 && { read }) } }),
  );
  return written;
}

/** A turn erased with mail its run read, as it is read: when it was and whose, and nothing else (#172). */
const erasedTurn = ({ id, at, from }: Pick<ConversationTurn, "id" | "at" | "from">): ConversationTurn => ({ id, at, from, text: "", actions: [], erased: true });

/** The last turns of the human's conversation, oldest first, those erased with mail they read among them. */
export const turnsOf = async (table: Table, human: string, limit: number): Promise<ConversationTurn[]> => (await storedTurns(table, human, limit)).map(({ turn }) => turn);

/** The last turns of the human's conversation as `turnsOf` gives them, each with the threads its own run read, none for an erased one's. */
async function storedTurns(table: Table, human: string, limit: number): Promise<{ turn: ConversationTurn; read: TurnSource[] }[]> {
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
  return Items.reverse().map(({ id, at, from, mailbox, text, actions, outcome, model, decision, handover, harder, byMail, searches, browsed, erased, read = [] }) =>
    erased === true
      ? { turn: erasedTurn({ id, at, from }), read: [] }
      : {
          turn: {
            id,
            at,
            from,
            ...(mailbox !== undefined && { mailbox }),
            text,
            actions,
            ...(outcome !== undefined && { outcome }),
            ...(model !== undefined && { model }),
            ...(decision !== undefined && { decision }),
            ...(handover !== undefined && { handover }),
            ...(harder !== undefined && { harder }),
            ...(byMail !== undefined && { byMail }),
            ...(searches !== undefined && { searches }),
            ...(browsed !== undefined && { browsed }),
          } as ConversationTurn,
          read: read as TurnSource[],
        },
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
  // The requests mailed to Coo's address, which are turns, go with the conversation, attachments and all (ADR-0040).
  await deployment.eraser.eraseCooRequests(await cooRequestsErased(table, actor!.id));
  return { statusCode: 200, body: { agent: asked.agent, turns: [] } satisfies components["schemas"]["MailboxAgentConversation"] };
};

export const getMailboxAgentSpend: OperationHandler = async (_event, deployment, actor) => {
  if (!isAdmin(actor)) return refusal(403, "Only admins can read what the mailbox agents spent. Ask an admin.");
  const month = monthOf(new Date());
  const { settings } = await organizationSettings(deployment.table);
  return { statusCode: 200, body: { month, spent: await spentIn(deployment.table, month), cap: settings.mailboxAgentSpendCap } satisfies components["schemas"]["MailboxAgentSpend"] };
};

/** Signs the human's Coo out of every site, deleting the browser profile it browses in (ADR-0038). */
export const signCooOut: OperationHandler = async (_event, deployment, actor) => {
  if (actor?.kind !== "human") return refusal(403, "Only humans have a Coo to sign out. Ask a human to sign theirs out.");
  await deployment.browserProfiles.forget(actor.id);
  return { statusCode: 200, body: { signedOutAt: new Date().toISOString() } satisfies components["schemas"]["CooSignedOut"] };
};
