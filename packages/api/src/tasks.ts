// Tasks (ADR-0029): a label's prompt gives the mailbox agent a task for each message that gets the
// label, by hand, by an agent or by a sender's delivery. The table's stream hands the task giver
// each change that adds a label, and the giver hands each task it gives to the task runner, which
// runs the mailbox agent on it as the conversation Lambda runs a turn. A task is kept under its
// thread, so it is erased with it, and its key is its message's and its label's, so each message
// gets one task per label.
import { randomUUID } from "node:crypto";
import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { InvokeCommand, type LambdaClient } from "@aws-sdk/client-lambda";
import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { components } from "@duva/openapi";
import type { DynamoDBStreamEvent } from "aws-lambda";
import type { AgentAction } from "./agent-loop.ts";
import { type AgentRuntime, capRefusal, runMailboxAgent, runtimeMissing, startRun } from "./agent-runs.ts";
import { raiseAlert } from "./alerting.ts";
import type { Table } from "./deployment.ts";
import { recordChanges } from "./feed.ts";
import { labelPrompt, nameOfLabel } from "./labels.ts";
import { newestMessage } from "./mail.ts";
import { mailboxAgentIn, mergedInto } from "./mailbox-agents.ts";
import { type Agent, allMailboxes, duva, findActor, findMailbox, type Mailbox, mailboxFeed, mailboxKey } from "./organization.ts";
import { documents, isNew, pk, sk } from "./table.ts";
import type { UnsubscribeJob } from "./unsubscribing.ts";

export type Task = components["schemas"]["Task"];

/** Which task the runner is to run: the one the label gave for the message in the thread. */
export interface TaskRef {
  mailbox: string;
  thread: string;
  message: string;
  label: string;
}

/**
 * Hands the task runner a task, which it runs if it still waits, or what one-click left of
 * unsubscribing from a sender (ADR-0031). The task runner Lambda, invoked asynchronously, or a
 * stand-in in tests.
 */
export interface TaskRunner {
  run(task: TaskRef): Promise<void>;
  unsubscribe(job: UnsubscribeJob): Promise<void>;
}

/** What the task runner Lambda is invoked with: a task, or an unsubscribe. */
export type TaskRunnerEvent = TaskRef | { unsubscribe: UnsubscribeJob };

/** The task runner Lambda, invoked asynchronously. Lambda is set to retry none, since a run that started has acted on the mail. */
export function lambdaTaskRunner(lambda: LambdaClient, functionName: string): TaskRunner {
  const invoke = (event: TaskRunnerEvent) => lambda.send(new InvokeCommand({ FunctionName: functionName, InvocationType: "Event", Payload: JSON.stringify(event) })).then(() => undefined);
  return { run: invoke, unsubscribe: (job) => invoke({ unsubscribe: job }) };
}

// A task sorts under its thread, and nothing else in the mailbox starts with its prefix.
export const taskPrefix = (mailbox: string, thread: string) => ({ [pk]: mailboxKey(mailbox)[pk]!, [sk]: `task#${thread}#` });
const taskKey = ({ mailbox, thread, message, label }: TaskRef) => {
  const prefix = taskPrefix(mailbox, thread);
  return { ...prefix, [sk]: `${prefix[sk]}${message}#${label}` };
};

// The most of the agent's words a note keeps, in characters.
const longestNote = 4000;
// How long a task's run goes at most, short of Lambda's 15 minutes, in milliseconds.
const longestRun = 14 * 60_000;
// The most of the thread the agent is given, in characters, as it reads the answers of its tools.
const longestThread = 30_000;

/** The thread's tasks, oldest first. */
export async function threadTasks(table: Table, mailbox: string, thread: string): Promise<Task[]> {
  const prefix = taskPrefix(mailbox, thread);
  const { Items = [] } = await documents(table).send(
    new QueryCommand({
      TableName: table.name,
      KeyConditionExpression: `${pk} = :mailbox AND begins_with(${sk}, :tasks)`,
      ExpressionAttributeValues: { ":mailbox": prefix[pk], ":tasks": prefix[sk] },
      ConsistentRead: true,
    }),
  );
  return Items.map(taskOf).sort((a, b) => a.givenAt.localeCompare(b.givenAt));
}

/** The mailbox's tasks that wait, as a pause leaves them. */
export async function waitingTasks(table: Table, mailbox: string): Promise<TaskRef[]> {
  const { Items = [] } = await documents(table).send(
    new QueryCommand({
      TableName: table.name,
      KeyConditionExpression: `${pk} = :mailbox AND begins_with(${sk}, :tasks)`,
      FilterExpression: "#state = :waiting",
      ExpressionAttributeNames: { "#state": "state" },
      ExpressionAttributeValues: { ":mailbox": mailboxKey(mailbox)[pk], ":tasks": "task#", ":waiting": "waiting" },
      ConsistentRead: true,
    }),
  );
  return Items.map(({ thread, message, label }) => ({ mailbox, thread, message, label }));
}

/** The tasks that have worked since before the time, longer than any run lasts, across every mailbox, as check-deployment.ts reads them. */
export async function tasksWorkingSince(table: Table, before: string): Promise<(TaskRef & { startedAt: string })[]> {
  const stuck: (TaskRef & { startedAt: string })[] = [];
  for (const mailbox of await allMailboxes(table)) {
    const { Items = [] } = await documents(table).send(
      new QueryCommand({
        TableName: table.name,
        KeyConditionExpression: `${pk} = :mailbox AND begins_with(${sk}, :tasks)`,
        FilterExpression: "#state = :working AND startedAt < :before",
        ExpressionAttributeNames: { "#state": "state" },
        ExpressionAttributeValues: { ":mailbox": mailboxKey(mailbox)[pk], ":tasks": "task#", ":working": "working", ":before": before },
        ConsistentRead: true,
      }),
    );
    stuck.push(...Items.map(({ thread, message, label, startedAt }) => ({ mailbox, thread, message, label, startedAt })));
  }
  return stuck;
}

const taskOf = ({ id, label, labelName, prompt, message, agent, state, givenAt, givenBy, startedAt, endedAt, note, actions, handover }: Record<string, unknown>) =>
  ({
    id,
    label,
    labelName,
    prompt,
    message,
    agent,
    state,
    givenAt,
    givenBy,
    ...(startedAt !== undefined && { startedAt }),
    ...(endedAt !== undefined && { endedAt }),
    ...(note !== undefined && { note }),
    ...(actions !== undefined && { actions }),
    ...(handover !== undefined && { handover }),
  }) as Task;

async function readTask(table: Table, ref: TaskRef): Promise<(Task & { thread: string }) | undefined> {
  const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: taskKey(ref), ConsistentRead: true }));
  return Item === undefined ? undefined : { ...taskOf(Item), thread: Item.thread as string };
}

// What a mailbox's feed partition has before and after the mailbox's ID.
const [start = "", end = ""] = mailboxFeed("\0").partition.split("\0");
const feedPartition = { start, end };

/** The labels each change in the stream adds to a message, as the task giver reads them. */
type Labelled = TaskRef & { by: string };

/** What a change in a mailbox's change feed, as the table's stream gives it, adds to which message. */
async function labelledBy(table: Table, record: DynamoDBStreamEvent["Records"][number]): Promise<Labelled[]> {
  const image = record.dynamodb?.NewImage ?? {};
  const mailbox = (record.dynamodb?.Keys?.[pk]?.S ?? "").slice(feedPartition.start.length, -feedPartition.end.length);
  const thread = image.thread?.S;
  if (thread === undefined) return [];
  if (image.type?.S === "messageReceived" && image.deliveredTo?.S !== undefined && image.message?.S !== undefined) {
    return [{ mailbox, thread, message: image.message.S, label: image.deliveredTo.S, by: duva }];
  }
  if (image.type?.S !== "threadLabelsChanged") return [];
  const added = (image.added?.L ?? []).flatMap(({ S }) => (S === undefined ? [] : [S]));
  if (added.length === 0) return [];
  // The thread's newest message when the label was added, though more may have come since.
  const message = await newestMessage(table, mailbox, thread, image.at?.S);
  if (message === undefined) return [];
  return added.map((label) => ({ mailbox, thread, message, label, by: image.actor?.S ?? duva }));
}

/**
 * The task giver's handler, which the table's stream invokes with each change that adds a label in
 * a mailbox: each added label with a prompt gives the mailbox's mailbox agent a task, which it hands
 * to the runner. Run again, it gives no task twice, and hands the runner again those that still wait.
 */
export function createTaskGiver({ table, runner }: { table: Table; runner: TaskRunner }) {
  return async (event: DynamoDBStreamEvent): Promise<void> => {
    for (const record of event.Records) {
      for (const labelled of await labelledBy(table, record)) {
        const { by, ...ref } = labelled;
        const prompt = await labelPrompt(table, ref.mailbox, ref.label);
        if (prompt === undefined) continue;
        const mailbox = await findMailbox(table, ref.mailbox);
        const agent = mailbox === undefined ? undefined : await mailboxAgentIn(table, mailbox);
        const labelName = await nameOfLabel(table, ref.mailbox, ref.label);
        if (agent === undefined || labelName === undefined) continue;
        if (await giveTask(table, ref, { prompt, labelName, agent, by })) await runner.run(ref);
      }
    }
  };
}

/** Gives the task, with its taskGiven change, unless the message has one for the label. Returns whether it waits for the runner. */
async function giveTask(table: Table, ref: TaskRef, { prompt, labelName, agent, by }: { prompt: string; labelName: string; agent: Agent; by: string }): Promise<boolean> {
  const id = randomUUID();
  try {
    await recordChanges(table, mailboxFeed(ref.mailbox), {
      by,
      changes: [{ type: "taskGiven", task: id, thread: ref.thread, message: ref.message, label: ref.label, agent: agent.id }],
      items: [
        {
          Put: {
            TableName: table.name,
            Item: { ...taskKey(ref), id, ...ref, labelName, prompt, agent: agent.id, state: "waiting", givenAt: new Date().toISOString(), givenBy: by },
            ...isNew,
          },
        },
      ],
    });
    return true;
  } catch (error) {
    // recordChanges gives the items' cancellation reasons after the counter's and the one change's.
    if (!(error instanceof TransactionCanceledException) || error.CancellationReasons?.[2]?.Code !== "ConditionalCheckFailed") throw error;
    // Given before, by a run that may have stopped before it handed it over.
    return (await readTask(table, ref))?.state === "waiting";
  }
}

/**
 * Moves the task from the state it is read in to the next, with its change, attributed to the
 * agent. Returns false if it changed meanwhile.
 */
async function moveTask(table: Table, ref: TaskRef, task: Task, change: { from: Task["state"]; to: Task["state"]; also?: Record<string, unknown> }): Promise<boolean> {
  const at = new Date().toISOString();
  const ended = change.to === "done" || change.to === "failed";
  const fields: Record<string, unknown> = { state: change.to, [ended ? "endedAt" : "startedAt"]: at, ...change.also };
  const names = Object.keys(fields);
  try {
    await recordChanges(table, mailboxFeed(ref.mailbox), {
      by: task.agent,
      changes: [ended ? { type: "taskEnded", task: task.id, thread: ref.thread, agent: task.agent, outcome: change.to } : { type: "taskStarted", task: task.id, thread: ref.thread, agent: task.agent }],
      items: [
        {
          Update: {
            TableName: table.name,
            Key: taskKey(ref),
            UpdateExpression: `SET ${names.map((_, index) => `#f${index} = :f${index}`).join(", ")}`,
            ConditionExpression: "#state = :from",
            ExpressionAttributeNames: { "#state": "state", ...Object.fromEntries(names.map((name, index) => [`#f${index}`, name])) },
            ExpressionAttributeValues: { ":from": change.from, ...Object.fromEntries(names.map((name, index) => [`:f${index}`, fields[name]])) },
          },
        },
      ],
    });
    return true;
  } catch (error) {
    if (error instanceof TransactionCanceledException && error.CancellationReasons?.[2]?.Code === "ConditionalCheckFailed") return false;
    throw error;
  }
}

/**
 * The task runner's handler: runs the task if it still waits and its agent isn't paused, which
 * leaves it waiting until unpausing hands it over again. The agent gets the prompt, and the thread
 * as the API answers it with the run's token. A task that can't run, or whose run fails, fails
 * with a note saying why, and alerts the agent's sponsor.
 */
export function createTaskRunner({ table, region, apiUrl, fetch: call = fetch, runtime }: { table: Table; region: string; apiUrl: string; fetch?: (request: Request) => Promise<Response>; runtime: AgentRuntime | undefined }) {
  return async (ref: TaskRef): Promise<void> => {
    const given = await readTask(table, ref);
    if (given?.state !== "waiting") return;
    const mailbox = await findMailbox(table, ref.mailbox);
    const owner = mailbox === undefined ? undefined : await findActor(table, mailbox.owner);
    // The owner's mailbox agent does it, if it was given the task or one merged into it was (ADR-0033).
    const working = mailbox === undefined ? undefined : await mailboxAgentIn(table, mailbox);
    const agent = working !== undefined && (working.id === given.agent || (await mergedInto(table, working.id)).includes(given.agent)) ? working : undefined;
    // A pause holds the task, until unpausing hands it over again.
    if (agent?.paused !== undefined) return;
    if (agent === undefined || owner?.kind !== "human" || owner.id !== agent.sponsor) {
      const found = await findActor(table, given.agent);
      if (await moveTask(table, ref, given, { from: "waiting", to: "working" })) await fail(ref, given, found?.kind === "agent" ? found : undefined, "Its mailbox agent went with the mailbox's owner, so no one does it.");
      return;
    }
    const task = { ...given, agent: agent.id };
    if (!(await moveTask(table, ref, task, { from: "waiting", to: "working", also: { agent: agent.id } }))) return;
    try {
      await work(ref, task, agent, mailbox!, owner.email);
    } catch (error) {
      // Whatever stopped it, the task ends, so none stays working.
      console.error(error);
      await fail(ref, task, agent, "Duva failed partway through it.");
    }
  };

  /** Fails the task with the note, and alerts the agent's sponsor, if there is still an agent. */
  async function fail(ref: TaskRef, task: Task, agent: Agent | undefined, note: string, actions?: AgentAction[]) {
    if (!(await moveTask(table, ref, task, { from: "working", to: "failed", also: { note, ...(actions !== undefined && { actions }) } }))) return;
    if (agent === undefined) return;
    const what = `${agent.name} couldn't do a task from the label ${task.labelName}: ${note}`;
    await raiseAlert(table, { kind: "taskFailed", agent, what, link: { mailbox: ref.mailbox, thread: ref.thread, message: ref.message } }, { source: `task#${task.id}` });
  }

  async function work(ref: TaskRef, task: Task, agent: Agent, mailbox: Mailbox, owner: string) {
    if (runtime === undefined) return fail(ref, task, agent, runtimeMissing(region));
    const started = await startRun(table, { agent, mailbox, mailboxes: [mailbox], owner, region, apiUrl, job: "task" });
    if ("refused" in started) return fail(ref, task, agent, started.refused);
    const { start, month, cap } = started;
    let threadUnreadable: string | undefined;
    let outOfTime = false;
    const deadline = Date.now() + longestRun;
    const ran = runMailboxAgent(table, {
      agent,
      payload: { ...start, history: [], words: "", task: { label: task.labelName, prompt: task.prompt } },
      runtime: async function* (run, session) {
        // The thread is read with the run's own token, so the agent is given no more than it may read.
        const answer = await call(new Request(`${apiUrl}/mailboxes/${encodeURIComponent(mailbox.id)}/threads/${encodeURIComponent(ref.thread)}`, { headers: { authorization: `Bearer ${run.token}` } }));
        const thread = await answer.text();
        if (!answer.ok) {
          threadUnreadable = `It couldn't read the thread, as Duva answered ${answer.status}.`;
          return;
        }
        // A run stops short of Lambda's timeout, so the task ends rather than stays working.
        const events = runtime({ ...run, words: taskWords(task, ref, thread) }, session)[Symbol.asyncIterator]();
        try {
          for (;;) {
            let timer: ReturnType<typeof setTimeout> | undefined;
            const late = new Promise<"late">((resolve) => (timer = setTimeout(() => resolve("late"), Math.max(0, deadline - Date.now()))));
            const next = await Promise.race([events.next(), late]).finally(() => clearTimeout(timer));
            if (next === "late") {
              outOfTime = true;
              return;
            }
            if (next.done) return;
            yield next.value;
          }
        } finally {
          void events.return?.();
        }
      },
      month,
      cap,
      about: { task: task.id, thread: ref.thread },
    });
    let next = await ran.next();
    while (!next.done) next = await ran.next();
    const { text, actions, outcome, handover } = next.value;
    if (threadUnreadable !== undefined) return fail(ref, task, agent, threadUnreadable);
    const note = text.trim().slice(0, longestNote);
    if (outcome === "answered") {
      await moveTask(table, ref, task, { from: "working", to: "done", also: { note, actions, ...(handover && { handover }) } });
      return;
    }
    const why = outOfTime ? `It ran out of time, after ${longestRun / 60_000} minutes.` : outcome === "capReached" ? capRefusal(cap) : "The model or the runtime failed partway.";
    await fail(ref, task, agent, note === "" ? why : `${why} It had said: ${note}`, actions);
  }
}

/** What the agent is asked in a task: its prompt, and the thread with the message, as getThread answers it. */
const taskWords = (task: Task, ref: TaskRef, thread: string) =>
  [
    `The prompt of the label ${task.labelName}: ${task.prompt}`,
    "",
    `The message to work on has the ID ${ref.message}, in the thread with the ID ${ref.thread}. Here is the thread, as Duva's getThread answers it:`,
    thread.slice(0, longestThread),
  ].join("\n");
