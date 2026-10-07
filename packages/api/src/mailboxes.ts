import type { components } from "@duva/openapi";
import { jsonBody, type OperationHandler, refusal } from "./api.ts";
import { mailboxesReadBy, mailboxFor } from "./access.ts";
import type { Deployment } from "./deployment.ts";
import { AddressTaken, addMailbox, allMailboxes, findActor, findMailbox, isAdmin } from "./organization.ts";
import { addressGiven, addressTaken } from "./addresses.ts";
import { builtInLabels, changeLabelPrompt, createLabel, deleteLabel, hasLabel, labelWithId, listLabels, longestPrompt, NameTaken, promptedBuiltIns, renameLabel } from "./labels.ts";
import { noMailboxAgent } from "./agent-runs.ts";
import { attachmentLinks } from "./attachments.ts";
import { allMail, type Cursor, cursorOf, inbox, labelThreads, mailboxChanges, markThreads, readThread, spam, threadsMarkedAtOnce, threadsPerPage, sentThreads, threadsWithLabel, trash, unreadWithLabel } from "./mail.ts";
import { recordEmptying } from "./erasure.ts";
import { giveMailboxAgent, mailboxAgentOf } from "./mailbox-agents.ts";
import { threadTasks } from "./tasks.ts";
import { syncRecipients } from "./receiving.ts";
import { groupsSentAsBy } from "./group-mail.ts";

export const createMailbox: OperationHandler = async (event, deployment, actor) => {
  if (!isAdmin(actor)) return refusal(403, "Only admins can create mailboxes. Ask an admin to create one.");
  const body = jsonBody(event);
  const ownerId = typeof body?.owner === "string" ? body.owner : "";
  const owner = await findActor(deployment.table, ownerId);
  // Agents work in their sponsors' mailboxes, with sponsor access, and own none (ADR-0030).
  if (owner?.kind === "agent") return refusal(400, "Agents own no mailboxes. Give the ID of a human, and have them give the agent sponsor access to theirs.");
  if (owner === undefined) return refusal(400, `There is no human ${JSON.stringify(ownerId)}. Give the ID of the human who will own the mailbox.`);
  const address = await addressGiven(deployment, body?.address);
  if (typeof address !== "string") return address;
  try {
    const mailbox = await addMailbox(deployment.table, { owner: owner.id, address, by: actor!.id });
    await giveMailboxAgent(deployment.table, mailbox);
    await syncRecipients(deployment.table, deployment.receiving);
    return { statusCode: 201, body: mailbox satisfies components["schemas"]["Mailbox"] };
  } catch (error) {
    if (!(error instanceof AddressTaken)) throw error;
    return addressTaken(deployment, address);
  }
};

export const listMailboxes: OperationHandler = async (_event, deployment, actor) => ({
  statusCode: 200,
  body: { mailboxes: await mailboxesReadBy(deployment, actor!) } satisfies components["schemas"]["MailboxList"],
});

export const listOrganizationMailboxes: OperationHandler = async (_event, deployment, actor) => {
  if (!isAdmin(actor)) return refusal(403, "Only admins can list the organization's mailboxes. Ask an admin who has access.");
  const mailboxes = (await Promise.all((await allMailboxes(deployment.table)).map((id) => findMailbox(deployment.table, id)))).filter((mailbox) => mailbox !== undefined);
  const owners = await Promise.all([...new Set(mailboxes.map(({ owner }) => owner))].map((id) => findActor(deployment.table, id)));
  return {
    statusCode: 200,
    body: { mailboxes, owners: owners.filter((owner) => owner !== undefined) } satisfies components["schemas"]["OrganizationMailboxList"],
  };
};

export const getMailbox: OperationHandler = async (event, deployment, actor) => {
  const mailbox = await mailboxFor(event, deployment, actor!, "read");
  if ("statusCode" in mailbox) return mailbox;
  const unread = await unreadWithLabel(deployment.table, mailbox.id, inbox);
  const groups = await groupsSentAsBy(deployment.table, mailbox.owner);
  return { statusCode: 200, body: { ...mailbox, groups, unread } satisfies components["schemas"]["MailboxWithCounts"] };
};

export const listMailboxChanges: OperationHandler = async (event, deployment, actor) => {
  const mailbox = await mailboxFor(event, deployment, actor!, "read");
  if ("statusCode" in mailbox) return mailbox;
  const given = event.queryStringParameters?.after ?? "0";
  if (!/^\d+$/.test(given)) return refusal(400, `${JSON.stringify(given)} isn't a position. Give after as a whole number from 0.`);
  const withSpam = event.queryStringParameters?.spam ?? "false";
  if (withSpam !== "true" && withSpam !== "false") return refusal(400, `${JSON.stringify(withSpam)} isn't true or false. Give spam as true to list spam arrivals too.`);
  return { statusCode: 200, body: await mailboxChanges(deployment.table, mailbox.id, Number(given), withSpam === "true") };
};

/** Where the page the call asks for starts and how long it is, or a refusal if it asks for one no listing gives. */
function pageAsked(event: Parameters<OperationHandler>[0]): { limit: number; after?: Cursor } | ReturnType<typeof refusal> {
  const query = event.queryStringParameters ?? {};
  const limit = query.limit ?? String(threadsPerPage);
  if (!/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > threadsPerPage) {
    return refusal(400, `${JSON.stringify(limit)} isn't a limit Duva takes. Give limit as a whole number from 1 to ${threadsPerPage}.`);
  }
  const after = query.after === undefined ? undefined : cursorOf(query.after);
  if (query.after !== undefined && after === undefined) {
    return refusal(400, `${JSON.stringify(query.after)} isn't where a page starts. Give after as the next of the page before, or leave it out for the first page.`);
  }
  return { limit: Number(limit), after };
}

/** A handler that answers a page of the threads `list` gives, for those who can read the mailbox. */
export const listing =
  (list: (table: Deployment["table"], mailbox: string, page: { limit: number; after?: Cursor }, event: Parameters<OperationHandler>[0]) => Promise<components["schemas"]["ThreadList"]>): OperationHandler =>
  async (event, deployment, actor) => {
    const mailbox = await mailboxFor(event, deployment, actor!, "read");
    if ("statusCode" in mailbox) return mailbox;
    const page = pageAsked(event);
    if ("statusCode" in page) return page;
    return { statusCode: 200, body: await list(deployment.table, mailbox.id, page, event) };
  };

export const listThreads = listing((table, mailbox, page, event) => threadsWithLabel(table, mailbox, event.queryStringParameters?.label ?? inbox, page));
export const listSentThreads = listing(sentThreads);
export const listAllMail = listing(allMail);

/** The thread IDs in the call's body, without repeats, or a refusal if it doesn't give 1 to threadsMarkedAtOnce of them. */
export function threadsGiven(body: Record<string, unknown> | undefined): string[] | ReturnType<typeof refusal> {
  const threads = body?.threads;
  if (!Array.isArray(threads) || threads.length === 0 || threads.length > threadsMarkedAtOnce || !threads.every((thread) => typeof thread === "string")) {
    return refusal(400, `Give threads as a list of 1 to ${threadsMarkedAtOnce} thread IDs.`);
  }
  return [...new Set(threads)];
}

export const noThread = (missing: string[]) =>
  refusal(404, `The mailbox has no thread ${missing.map((id) => JSON.stringify(id)).join(", ")}, so no thread was changed. List its threads to find their IDs.`);

/** Marks the threads in the call's body unread, or read, as their mailbox's reader asks. */
const markingThreads =
  (unread: boolean): OperationHandler =>
  async (event, deployment, actor) => {
    const mailbox = await mailboxFor(event, deployment, actor!, "organize");
    if ("statusCode" in mailbox) return mailbox;
    const threads = threadsGiven(jsonBody(event));
    if ("statusCode" in threads) return threads;
    const marked = await markThreads(deployment.table, { mailbox: mailbox.id, threads, unread, by: actor!.id });
    if ("missing" in marked) return noThread(marked.missing);
    return { statusCode: 200, body: marked satisfies components["schemas"]["ThreadList"] };
  };

export const markThreadsRead = markingThreads(false);
export const markThreadsUnread = markingThreads(true);

export const getThread: OperationHandler = async (event, deployment, actor) => {
  const mailbox = await mailboxFor(event, deployment, actor!, "read");
  if ("statusCode" in mailbox) return mailbox;
  const id = event.pathParameters?.thread ?? "";
  const thread = await readThread(deployment.table, deployment.mailBucket, mailbox.id, id, attachmentLinks(deployment, mailbox.id));
  if (thread === undefined) return refusal(404, `The mailbox has no thread ${JSON.stringify(id)}. List its threads to find one.`);
  const tasks = await threadTasks(deployment.table, mailbox.id, id);
  return { statusCode: 200, body: { ...thread, ...(tasks.length > 0 && { tasks }) } satisfies components["schemas"]["Thread"] };
};

export const labelMailboxThreads: OperationHandler = async (event, deployment, actor) => {
  const body = jsonBody(event);
  // Moving threads to Trash and back is an ability of its own.
  const trashing = [body?.add, body?.remove].some((labels) => Array.isArray(labels) && labels.includes(trash));
  const mailbox = await mailboxFor(event, deployment, actor!, trashing ? "trash" : "organize");
  if ("statusCode" in mailbox) return mailbox;
  const threads = threadsGiven(body);
  if ("statusCode" in threads) return threads;
  const [add, remove] = [body?.add ?? [], body?.remove ?? []];
  if (!isList(add) || !isList(remove) || add.length + remove.length === 0) {
    return refusal(400, "Give add, remove or both as lists of label IDs, such as inbox, spam, trash or one of the mailbox's own.");
  }
  const both = add.find((label) => remove.includes(label));
  if (both !== undefined) return refusal(400, `${JSON.stringify(both)} is in both add and remove. Give each label in one of them.`);
  if (add.includes(inbox) && (add.includes(spam) || add.includes(trash))) {
    return refusal(400, "Adding inbox takes a thread out of Spam and Trash, so it can't be given with spam or trash in add.");
  }
  for (const label of [...add, ...remove]) {
    if (!(await hasLabel(deployment.table, mailbox.id, label))) return refusal(400, `The mailbox has no label ${JSON.stringify(label)}. List its labels to find their IDs.`);
  }
  const labelled = await labelThreads(deployment.table, { mailbox: mailbox.id, threads, add: [...new Set(add)], remove: [...new Set(remove)], by: actor!.id });
  if ("missing" in labelled) return noThread(labelled.missing);
  return { statusCode: 200, body: labelled satisfies components["schemas"]["ThreadList"] };
};

const isList = (value: unknown): value is string[] => Array.isArray(value) && value.every((each) => typeof each === "string");

export const listMailboxLabels: OperationHandler = async (event, deployment, actor) => {
  const mailbox = await mailboxFor(event, deployment, actor!, "read");
  if ("statusCode" in mailbox) return mailbox;
  return { statusCode: 200, body: { labels: await listLabels(deployment.table, mailbox.id) } satisfies components["schemas"]["LabelList"] };
};

/** The label name in the call's body, trimmed, or a refusal if it gives none Duva takes. */
function nameGiven(event: Parameters<OperationHandler>[0]): string | ReturnType<typeof refusal> {
  const given = jsonBody(event)?.name;
  const name = typeof given === "string" ? given.trim() : "";
  if (name === "" || name.length > 100) return refusal(400, "Give the label a name of 1 to 100 characters.");
  return name;
}

const nameRefused = (name: string) => refusal(409, `The mailbox has a label named ${JSON.stringify(name)} already, or the name is a built-in one. Give another name.`);

export const createMailboxLabel: OperationHandler = async (event, deployment, actor) => {
  const mailbox = await mailboxFor(event, deployment, actor!, "organize");
  if ("statusCode" in mailbox) return mailbox;
  const name = nameGiven(event);
  if (typeof name !== "string") return name;
  try {
    return { statusCode: 201, body: (await createLabel(deployment.table, { mailbox: mailbox.id, name, by: actor!.id })) satisfies components["schemas"]["Label"] };
  } catch (error) {
    if (error instanceof NameTaken) return nameRefused(name);
    throw error;
  }
};

/** The mailbox's own label the call's path names, or a refusal if it names a built-in label. */
function ownLabelAsked(event: Parameters<OperationHandler>[0], doing: string): string | ReturnType<typeof refusal> {
  const label = event.pathParameters?.label ?? "";
  if (builtInLabels.some(({ id }) => id === label)) {
    return refusal(400, `${JSON.stringify(label)} is a built-in label, so it can't be ${doing}. Give the ID of one of the mailbox's own labels.`);
  }
  return label;
}

const noLabel = (label: string) => refusal(404, `The mailbox has no label ${JSON.stringify(label)}. List its labels to find their IDs.`);

export const renameMailboxLabel: OperationHandler = async (event, deployment, actor) => {
  const mailbox = await mailboxFor(event, deployment, actor!, "organize");
  if ("statusCode" in mailbox) return mailbox;
  const label = ownLabelAsked(event, "renamed");
  if (typeof label !== "string") return label;
  const name = nameGiven(event);
  if (typeof name !== "string") return name;
  try {
    const renamed = await renameLabel(deployment.table, { mailbox: mailbox.id, label, name, by: actor!.id });
    return renamed === undefined ? noLabel(label) : { statusCode: 200, body: renamed satisfies components["schemas"]["Label"] };
  } catch (error) {
    if (error instanceof NameTaken) return nameRefused(name);
    throw error;
  }
};

export const deleteMailboxLabel: OperationHandler = async (event, deployment, actor) => {
  const mailbox = await mailboxFor(event, deployment, actor!, "organize");
  if ("statusCode" in mailbox) return mailbox;
  const label = ownLabelAsked(event, "deleted");
  if (typeof label !== "string") return label;
  const deleted = await deleteLabel(deployment.table, { mailbox: mailbox.id, label, by: actor!.id });
  return deleted === undefined ? noLabel(label) : { statusCode: 200, body: deleted satisfies components["schemas"]["Label"] };
};

/** The label whose prompt the call changes, if its actor owns the mailbox and the label can carry one, or a refusal. */
async function promptAsked(event: Parameters<OperationHandler>[0], deployment: Deployment, actor: Parameters<OperationHandler>[2]) {
  const mailbox = await mailboxFor(event, deployment, actor!, "read");
  if ("statusCode" in mailbox) return mailbox;
  // Never an agent, so no agent gives a mailbox agent work (ADR-0029).
  if (actor!.kind !== "human" || mailbox.owner !== actor!.id) return refusal(403, "Only the mailbox's owner gives its labels prompts, since they set its mailbox agent to work. Ask them.");
  const id = event.pathParameters?.label ?? "";
  const label = await labelWithId(deployment.table, mailbox.id, id);
  if (label === undefined) return noLabel(id);
  if (label.builtIn && !promptedBuiltIns.includes(label.id)) {
    return refusal(400, `${label.name} can't carry a prompt. Give the Feed, the Paper Trail or one of the mailbox's own labels one.`);
  }
  if ((await mailboxAgentOf(deployment.table, mailbox.id)) === undefined) {
    return refusal(409, noMailboxAgent);
  }
  return { mailbox, label };
}

export const setMailboxLabelPrompt: OperationHandler = async (event, deployment, actor) => {
  const asked = await promptAsked(event, deployment, actor);
  if ("statusCode" in asked) return asked;
  const given = jsonBody(event)?.prompt;
  const prompt = typeof given === "string" ? given.trim() : "";
  if (prompt === "" || prompt.length > longestPrompt) {
    return refusal(400, `Give the label a prompt of 1 to ${longestPrompt.toLocaleString("en-US")} characters, saying what the mailbox agent is to do with each message that gets it.`);
  }
  await changeLabelPrompt(deployment.table, { mailbox: asked.mailbox.id, label: asked.label.id, prompt, by: actor!.id });
  return { statusCode: 200, body: { ...asked.label, prompt } satisfies components["schemas"]["Label"] };
};

export const removeMailboxLabelPrompt: OperationHandler = async (event, deployment, actor) => {
  const asked = await promptAsked(event, deployment, actor);
  if ("statusCode" in asked) return asked;
  await changeLabelPrompt(deployment.table, { mailbox: asked.mailbox.id, label: asked.label.id, prompt: undefined, by: actor!.id });
  const { prompt: _removed, ...label } = asked.label;
  return { statusCode: 200, body: label satisfies components["schemas"]["Label"] };
};

export const emptyMailboxTrash: OperationHandler = async (event, deployment, actor) => {
  const mailbox = await mailboxFor(event, deployment, actor!, "emptyTrash");
  if ("statusCode" in mailbox) return mailbox;
  const emptiedAt = new Date().toISOString();
  const emptied = { mailbox: mailbox.id, before: emptiedAt, by: actor!.id };
  await recordEmptying(deployment.table, emptied);
  await deployment.eraser.emptyTrash(emptied);
  return { statusCode: 202, body: { emptiedAt } satisfies components["schemas"]["TrashEmptying"] };
};
