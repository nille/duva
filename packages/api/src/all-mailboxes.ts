// All mailboxes (ADR-0033): every mailbox an actor can read, taken together, beside each one alone:
// a human's own, and an agent's sponsor's that its sponsor access covers. Each view reads each
// mailbox's own listing a page at a time and merges them in the view's order, a count adds up the
// mailboxes' counts, and a search searches each mailbox's own index (ADR-0007). Each thread names
// its mailbox and the address it came to. A thread, a draft or a message is acted on in its own
// mailbox: Duva finds which, and hands the call to the operation on that mailbox, so each rule of
// one mailbox holds as it is there. A message delivered to two of them is two copies, so two threads.
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import type { components } from "@duva/openapi";
import { type Ability, mailboxesReadBy, mailboxFor } from "./access.ts";
import { jsonBody, type OperationHandler, refusal } from "./api.ts";
import { getAttachment, stopSharing } from "./attachments.ts";
import type { Deployment } from "./deployment.ts";
import { draftsIn, findDraft } from "./drafting.ts";
import { createDraft, deleteDraft, editDraft, getDraft, sendDraft, sendDraftNow } from "./drafts.ts";
import { builtInLabels, createLabel, hasOwnLabel, labelNamed, listLabels, NameTaken } from "./labels.ts";
import {
  type AcrossCursor,
  inbox,
  isPosition,
  type Listing,
  listings,
  mailboxChanges,
  recipientOf,
  screener,
  storedMessage,
  type StoredSummary,
  summaryOf,
  threadsListedAcross,
  threadsPerPage,
  threadSummary,
  type ThreadList,
  trash,
  unreadWithLabel,
} from "./mail.ts";
import { getThread, labelMailboxThreads, markThreadsRead, markThreadsUnread, threadsGiven } from "./mailboxes.ts";
import { type Actor, aliasDomains, findActor, isAddressOf } from "./organization.ts";
import { newMailFromOf } from "./preferences.ts";
import { cancelReminders, remindThreads } from "./reminders.ts";
import { screenerOf } from "./screening.ts";
import { foundIn, pageRefused, searchAsked } from "./search.ts";

type AllMailboxesThread = components["schemas"]["AllMailboxesThread"];
type AllMailboxesLabel = components["schemas"]["AllMailboxesLabel"];
type Event = Parameters<OperationHandler>[0];

/** The call as the operation on one mailbox takes it: in the mailbox, with the body if one is given. */
const inMailbox = (event: Event, mailbox: string, body?: Record<string, unknown>): APIGatewayProxyEventV2 => ({
  ...event,
  pathParameters: { ...event.pathParameters, mailbox },
  ...(body !== undefined && { body: JSON.stringify(body), isBase64Encoded: false }),
});

/** The first of the mailboxes the actor can read that `has` finds what the call names in, or undefined if none. */
async function mailboxHolding(deployment: Deployment, actor: Actor, has: (mailbox: string) => Promise<unknown>): Promise<string | undefined> {
  const holding = await Promise.all((await mailboxesReadBy(deployment, actor)).map(async ({ id }) => ((await has(id)) === undefined ? undefined : id)));
  return holding.find((id) => id !== undefined);
}

/** The thread as All mailboxes lists it, with its mailbox and the address it came to. */
const acrossOf = async (deployment: Deployment, mailbox: string, thread: StoredSummary): Promise<AllMailboxesThread> => ({
  ...summaryOf(thread),
  mailbox,
  recipient: await recipientOf(deployment.table, mailbox, thread),
});

// A cursor of All mailboxes holds each mailbox's place, as JSON.
const cursorAt = (places: object) => Buffer.from(JSON.stringify(places)).toString("base64url");
function placesIn(next: string, valid: (place: unknown) => boolean): Record<string, never> | undefined {
  try {
    const places: unknown = JSON.parse(Buffer.from(next, "base64url").toString());
    return typeof places === "object" && places !== null && !Array.isArray(places) && Object.values(places).every(valid) ? (places as Record<string, never>) : undefined;
  } catch {
    return undefined;
  }
}

export const getAllMailboxes: OperationHandler = async (_event, deployment, actor) => {
  const mailboxes = await Promise.all((await mailboxesReadBy(deployment, actor!)).map(async (mailbox) => ({ ...mailbox, unread: await unreadWithLabel(deployment.table, mailbox.id, inbox) })));
  return { statusCode: 200, body: { mailboxes, unread: mailboxes.reduce((sum, { unread }) => sum + unread, 0) } satisfies components["schemas"]["AllMailboxes"] };
};

export const listAllMailboxesChanges: OperationHandler = async (event, deployment, actor) => {
  const query = event.queryStringParameters ?? {};
  const after = query.after === undefined ? {} : placesIn(query.after, (place) => Number.isInteger(place) && (place as number) >= 0);
  if (after === undefined) return refusal(400, `${JSON.stringify(query.after)} isn't a position. Give after as the position an answer ended at, or leave it out to list from the start.`);
  const withSpam = query.spam ?? "false";
  if (withSpam !== "true" && withSpam !== "false") return refusal(400, `${JSON.stringify(withSpam)} isn't true or false. Give spam as true to list spam arrivals too.`);
  const mailboxes = await Promise.all(
    (await mailboxesReadBy(deployment, actor!)).map(async ({ id }) => ({ mailbox: id, ...(await mailboxChanges(deployment.table, id, after[id] ?? 0, withSpam === "true")) })),
  );
  const position = cursorAt(Object.fromEntries(mailboxes.map(({ mailbox, position }) => [mailbox, position])));
  return { statusCode: 200, body: { mailboxes, position } satisfies components["schemas"]["AllMailboxesChangePage"] };
};

/**
 * A handler that answers a page of a view of All mailboxes: the listing `listingIn` gives in each
 * mailbox, or none in a mailbox it gives undefined for.
 */
const view =
  (listingIn: (deployment: Deployment, mailbox: string, event: Event) => Promise<Listing | undefined>): OperationHandler =>
  async (event, deployment, actor) => {
    const query = event.queryStringParameters ?? {};
    const limit = query.limit ?? String(threadsPerPage);
    if (!/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > threadsPerPage) {
      return refusal(400, `${JSON.stringify(limit)} isn't a limit Duva takes. Give limit as a whole number from 1 to ${threadsPerPage}.`);
    }
    const after: AcrossCursor | undefined = query.after === undefined ? {} : placesIn(query.after, (place) => place === null || place === "" || (typeof place === "string" && isPosition(place)));
    if (after === undefined) return pageRefused(query.after!);
    const mailboxes = await mailboxesReadBy(deployment, actor!);
    const listed = (await Promise.all(mailboxes.map(async ({ id }) => ({ id, listing: await listingIn(deployment, id, event) })))).filter(
      (each): each is { id: string; listing: Listing } => each.listing !== undefined,
    );
    const { threads, next } = await threadsListedAcross(deployment.table, listed, { limit: Number(limit), after });
    return {
      statusCode: 200,
      body: {
        threads: await Promise.all(threads.map((thread) => acrossOf(deployment, thread.mailbox, thread))),
        ...(next !== undefined && { next: cursorAt(next) }),
      } satisfies components["schemas"]["AllMailboxesThreadList"],
    };
  };

/** The ID of the mailbox's label the view asks for: a built-in label's ID, or a label's name in any case. */
async function labelAsked(deployment: Deployment, mailbox: string, event: Event): Promise<string | undefined> {
  const label = event.queryStringParameters?.label ?? inbox;
  if (label === screener || builtInLabels.some(({ id }) => id === label)) return label;
  return labelNamed(deployment.table, mailbox, label);
}

export const listAllMailboxesThreads = view(async (deployment, mailbox, event) => {
  const label = await labelAsked(deployment, mailbox, event);
  return label === undefined ? undefined : listings.label(label);
});
export const listAllMailboxesSentThreads = view(async () => listings.sent);
export const listAllMailboxesAllMail = view(async () => listings.allMail);
export const listAllMailboxesReminders = view(async () => listings.reminders);

/** Each of the threads with the IDs, with the mailbox among the mailboxes it is in, or the IDs none of them has. */
async function threadsFound(deployment: Deployment, mailboxes: string[], ids: string[]): Promise<Map<string, { mailbox: string; thread: StoredSummary }> | { missing: string[] }> {
  const found = new Map<string, { mailbox: string; thread: StoredSummary }>();
  await Promise.all(
    ids.flatMap((id) =>
      mailboxes.map(async (mailbox) => {
        const thread = await threadSummary(deployment.table, mailbox, id);
        if (thread !== undefined) found.set(id, { mailbox, thread });
      }),
    ),
  );
  const missing = ids.filter((id) => !found.has(id));
  return missing.length > 0 ? { missing } : found;
}

const noThread = (missing: string[]) =>
  refusal(404, `None of the mailboxes you can read has a thread ${missing.map((id) => JSON.stringify(id)).join(", ")}, so no thread was changed. List All mailboxes' threads to find their IDs.`);

/**
 * A handler that acts on the threads in the call's body, each in its own mailbox, with the
 * operation on one mailbox, given the body `bodyIn` makes for the mailbox. The actor needs the
 * ability in each of the mailboxes first, so lacking it in one changes nothing in another. The
 * body is checked in the first mailbox before anything changes, but a refusal only a later
 * mailbox gives, as for a thread of its in Spam, leaves the earlier ones changed.
 */
const acting =
  (
    handler: OperationHandler,
    ability: (body: Record<string, unknown> | undefined) => Ability,
    bodyIn: (deployment: Deployment, mailbox: string, body: Record<string, unknown>, actor: Actor) => Promise<Record<string, unknown> | undefined> = async (_d, _m, body) => body,
  ): OperationHandler =>
  async (event, deployment, actor) => {
    const body = jsonBody(event);
    const ids = threadsGiven(body);
    if ("statusCode" in ids) return ids;
    const found = await threadsFound(deployment, (await mailboxesReadBy(deployment, actor!)).map(({ id }) => id), ids);
    if ("missing" in found) return noThread(found.missing);
    const byMailbox = Map.groupBy(ids, (id) => found.get(id)!.mailbox);
    for (const mailbox of byMailbox.keys()) {
      const allowed = await mailboxFor(inMailbox(event, mailbox), deployment, actor!, ability(body));
      if ("statusCode" in allowed) return allowed;
    }
    const changed = new Map<string, components["schemas"]["ThreadSummary"]>();
    for (const [mailbox, threads] of byMailbox) {
      const given = await bodyIn(deployment, mailbox, { ...body, threads }, actor!);
      // Nothing to do in this mailbox, so its threads stay as they are.
      if (given === undefined) continue;
      const answer = await handler(inMailbox(event, mailbox, given), deployment, actor);
      if (answer.statusCode !== 200) return answer;
      for (const thread of (answer.body as ThreadList).threads) changed.set(thread.id, thread);
    }
    const threads = await Promise.all(
      ids.map(async (id) => {
        const { mailbox, thread } = found.get(id)!;
        return { ...(changed.get(id) ?? summaryOf(thread)), mailbox, recipient: await recipientOf(deployment.table, mailbox, thread) };
      }),
    );
    return { statusCode: 200, body: { threads } satisfies components["schemas"]["AllMailboxesThreadList"] };
  };

const organizing = () => "organize" as const;

export const markAllMailboxesThreadsRead = acting(markThreadsRead, organizing);
export const markAllMailboxesThreadsUnread = acting(markThreadsUnread, organizing);
export const remindAllMailboxesThreads = acting(remindThreads, organizing);
export const cancelAllMailboxesReminders = acting(cancelReminders, organizing);

// Moving threads to Trash and back is an ability of its own, as it is in one mailbox.
export const labelAllMailboxesThreads = acting(
  labelMailboxThreads,
  (body) => ([body?.add, body?.remove].some((labels) => Array.isArray(labels) && labels.includes(trash)) ? "trash" : "organize"),
  async (deployment, mailbox, body, actor) => {
    const [add, remove] = await Promise.all([labelsIn(deployment, mailbox, body.add, actor), labelsIn(deployment, mailbox, body.remove)]);
    // Removing only names the mailbox has no label of leaves its threads as they are.
    const asked = [body.add, body.remove].some((labels) => Array.isArray(labels) && labels.length > 0);
    const none = [add, remove].every((labels) => labels === undefined || (Array.isArray(labels) && labels.length === 0));
    return asked && none ? undefined : { ...body, ...(add !== undefined && { add }), ...(remove !== undefined && { remove }) };
  },
);

// The labels of a mailbox's own have UUIDs for IDs.
const labelId = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

/**
 * The IDs in the mailbox of the labels given, each a built-in label's ID, one of the mailbox's own
 * IDs or a label's name. A name the mailbox has no label of is left out, or with `creator`, created
 * there, as the label the threads get. Anything but a list of strings is given back as it is.
 */
async function labelsIn(deployment: Deployment, mailbox: string, given: unknown, creator?: Actor): Promise<unknown> {
  if (!Array.isArray(given) || !given.every((label) => typeof label === "string")) return given;
  const ids: string[] = [];
  for (const label of given as string[]) {
    if (builtInLabels.some(({ id }) => id === label) || (await hasOwnLabel(deployment.table, mailbox, label))) {
      ids.push(label);
      continue;
    }
    const named = await labelNamed(deployment.table, mailbox, label);
    const name = label.trim();
    if (named !== undefined) ids.push(named);
    // Another mailbox's label ID names no label here, so it makes none. A name a label can't have is left for the operation to refuse.
    else if (labelId.test(label)) continue;
    else if (creator === undefined) continue;
    else if (name === "" || name.length > 100) ids.push(label);
    else {
      try {
        ids.push((await createLabel(deployment.table, { mailbox, name, by: creator.id })).id);
      } catch (error) {
        // Another call created it meanwhile.
        if (!(error instanceof NameTaken)) throw error;
        const created = await labelNamed(deployment.table, mailbox, name);
        if (created !== undefined) ids.push(created);
      }
    }
  }
  return ids;
}

export const getAllMailboxesThread: OperationHandler = async (event, deployment, actor) => {
  const id = event.pathParameters?.thread ?? "";
  const found = await threadsFound(deployment, (await mailboxesReadBy(deployment, actor!)).map(({ id }) => id), [id]);
  if ("missing" in found) return refusal(404, `None of the mailboxes you can read has a thread ${JSON.stringify(id)}. List All mailboxes' threads to find one.`);
  const { mailbox, thread } = found.get(id)!;
  const answer = await getThread(inMailbox(event, mailbox), deployment, actor);
  if (answer.statusCode !== 200) return answer;
  return {
    statusCode: 200,
    body: { ...(answer.body as components["schemas"]["Thread"]), mailbox, recipient: await recipientOf(deployment.table, mailbox, thread) } satisfies components["schemas"]["AllMailboxesThreadDetail"],
  };
};

export const searchAllMailboxes: OperationHandler = async (event, deployment, actor) => {
  const asked = searchAsked(event);
  if ("statusCode" in asked) return asked;
  const after: Record<string, number | null> | undefined = asked.after === undefined ? {} : placesIn(asked.after, (place) => place === null || (Number.isInteger(place) && (place as number) >= 0));
  if (after === undefined) return pageRefused(asked.after!);
  const mailboxes = (await mailboxesReadBy(deployment, actor!)).map(({ id }) => id);
  const searched = await Promise.all(
    mailboxes.filter((mailbox) => after[mailbox] !== null).map(async (mailbox) => ({ mailbox, from: after[mailbox] ?? 0, found: await foundIn(deployment, mailbox, { ...asked, from: after[mailbox] ?? 0 }) })),
  );
  const missing = searched.map(({ found }) => ("missing" in found ? found.missing : undefined));
  if (searched.length > 0 && missing.every((name) => name !== undefined)) {
    return refusal(400, `None of the mailboxes you can read has a label ${JSON.stringify(missing[0])}. List All mailboxes' labels to see their names.`);
  }
  const results = searched.flatMap(({ mailbox, from, found }) => ("missing" in found ? [] : [{ mailbox, from, ...found, taken: 0 }]));
  // Each mailbox's results are merged by their rank there, best first, or by their newest mail when sorted by newest, mailboxes in order on a tie.
  const page: { mailbox: string; found: (typeof results)[number]["results"][number] }[] = [];
  while (page.length < asked.limit) {
    const heads = results.filter(({ results, taken }) => taken < results.length);
    if (heads.length === 0) break;
    const head = (each: (typeof heads)[number]) => each.results[each.taken]!;
    const first = heads.reduce((best, each) =>
      (asked.sort === "newest" ? head(each).summary.latestAt > head(best).summary.latestAt : head(each).next < head(best).next) ? each : best,
    );
    page.push({ mailbox: first.mailbox, found: head(first) });
    first.taken++;
  }
  const next: Record<string, number | null> = Object.fromEntries(mailboxes.map((mailbox) => [mailbox, null]));
  for (const { mailbox, from, results: found, end, total, taken } of results) {
    const at = taken === found.length ? end : taken === 0 ? from : found[taken - 1]!.next;
    next[mailbox] = at < total ? at : null;
  }
  return {
    statusCode: 200,
    body: {
      results: await Promise.all(
        page.map(async ({ mailbox, found: { result, summary } }) => ({ ...result, thread: { ...result.thread, mailbox, recipient: await recipientOf(deployment.table, mailbox, summary) } })),
      ),
      ...(Object.values(next).some((at) => at !== null) && { next: cursorAt(next) }),
    } satisfies components["schemas"]["AllMailboxesSearchResults"],
  };
};

export const listAllMailboxesLabels: OperationHandler = async (_event, deployment, actor) => {
  const mailboxes = await mailboxesReadBy(deployment, actor!);
  const labels = new Map<string, AllMailboxesLabel>();
  for (const [index, mailboxLabels] of (await Promise.all(mailboxes.map(({ id }) => listLabels(deployment.table, id)))).entries()) {
    for (const { id, name, builtIn, unread, prompt } of mailboxLabels) {
      // Labels of one name, in any case, are one label in All mailboxes.
      const key = builtIn ? `builtIn#${id}` : `own#${name.toLowerCase()}`;
      const label = labels.get(key) ?? { id: builtIn ? id : name, name, builtIn, unread: 0, mailboxes: [] };
      label.unread += unread;
      label.mailboxes.push({ mailbox: mailboxes[index]!.id, label: id, unread, ...(prompt !== undefined && { prompt }) });
      labels.set(key, label);
    }
  }
  const all = [...labels.values()];
  return {
    statusCode: 200,
    body: {
      labels: [...all.filter(({ builtIn }) => builtIn), ...all.filter(({ builtIn }) => !builtIn).sort((a, b) => a.name.localeCompare(b.name))],
    } satisfies components["schemas"]["AllMailboxesLabelList"],
  };
};

export const getAllMailboxesScreener: OperationHandler = async (_event, deployment, actor) => {
  const screeners = await Promise.all((await mailboxesReadBy(deployment, actor!)).map(async ({ id }) => ({ mailbox: id, ...(await screenerOf(deployment.table, id)) })));
  const senders = await Promise.all(
    screeners.flatMap(({ mailbox, senders }) =>
      senders.map(async (sender) => ({ mailbox, ...sender, threads: await Promise.all(sender.threads.map((thread) => acrossOf(deployment, mailbox, thread))) })),
    ),
  );
  return {
    statusCode: 200,
    body: {
      mailboxes: screeners.map(({ mailbox, on, decided }) => ({ mailbox, on, decided })),
      senders: senders.sort((a, b) => b.latestAt.localeCompare(a.latestAt)),
    } satisfies components["schemas"]["AllMailboxesScreener"],
  };
};

export const listAllMailboxesDrafts: OperationHandler = async (_event, deployment, actor) => {
  const drafts = await Promise.all((await mailboxesReadBy(deployment, actor!)).map(async ({ id }) => (await draftsIn(deployment.table, id)).map((draft) => ({ ...draft, mailbox: id }))));
  return { statusCode: 200, body: { drafts: drafts.flat().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) } satisfies components["schemas"]["AllMailboxesDraftList"] };
};

/**
 * Drafts a reply or a forward in the original's mailbox, and new mail in the mailbox of the address
 * it goes from: the one given, or else the one the human's preference names, an agent's sponsor's.
 */
export const createAllMailboxesDraft: OperationHandler = async (event, deployment, actor) => {
  const body = jsonBody(event) ?? {};
  const mailboxes = await mailboxesReadBy(deployment, actor!);
  const original = typeof body.answers === "string" ? body.answers : typeof body.forwards === "string" ? body.forwards : undefined;
  if (original !== undefined) {
    const mailbox = await mailboxHolding(deployment, actor!, (id) => storedMessage(deployment.table, id, original));
    if (mailbox === undefined) {
      return refusal(404, `None of the mailboxes you can read has a message ${JSON.stringify(original)}. Read their threads to find the message to ${original === body.answers ? "reply to" : "forward"}.`);
    }
    return withMailbox(mailbox, await createDraft(inMailbox(event, mailbox), deployment, actor));
  }
  const aliases = await aliasDomains(deployment.table);
  const preferred = await newMailFrom(deployment, actor!);
  const ofAddress = (address: unknown) => (typeof address === "string" ? mailboxes.find((mailbox) => isAddressOf(mailbox, address, aliases)) : undefined);
  // A group's address is no mailbox's, so mail from it is drafted in the mailbox the preference names.
  const mailbox = ofAddress(body.from) ?? ofAddress(preferred) ?? mailboxes[0];
  if (mailbox === undefined) return refusal(403, "You can read no mailbox, so there is none to draft in. Ask an admin for a mailbox, or as an agent, your sponsor for sponsor access.");
  const from = body.from ?? (ofAddress(preferred) === undefined ? undefined : preferred);
  return withMailbox(mailbox.id, await createDraft(inMailbox(event, mailbox.id, { ...body, ...(from !== undefined && { from }) }), deployment, actor));
};

/** The address new mail in All mailboxes starts from: the human's preference, or an agent's sponsor's. */
async function newMailFrom(deployment: Deployment, actor: Actor): Promise<string | undefined> {
  const human = actor.kind === "human" ? actor : await findActor(deployment.table, actor.sponsor);
  return human?.kind === "human" ? newMailFromOf(deployment.table, human) : undefined;
}

/** The answer, with the mailbox it was given in, if it gives a draft. */
const withMailbox = (mailbox: string, answer: Awaited<ReturnType<OperationHandler>>) =>
  answer.statusCode < 300 ? { ...answer, body: { ...(answer.body as components["schemas"]["Draft"]), mailbox } satisfies components["schemas"]["AllMailboxesDraft"] } : answer;

/** A handler that does what the operation on one mailbox does to the draft in the call's path, in the mailbox it is in. */
const onDraft =
  (handler: OperationHandler): OperationHandler =>
  async (event, deployment, actor) => {
    const id = event.pathParameters?.draft ?? "";
    const mailbox = await mailboxHolding(deployment, actor!, (each) => findDraft(deployment.table, each, id));
    if (mailbox === undefined) return refusal(404, `None of the mailboxes you can read has a draft ${JSON.stringify(id)}. List All mailboxes' drafts to find one.`);
    return withMailbox(mailbox, await handler(inMailbox(event, mailbox), deployment, actor));
  };

export const getAllMailboxesDraft = onDraft(getDraft);
export const editAllMailboxesDraft = onDraft(editDraft);
export const deleteAllMailboxesDraft = onDraft(deleteDraft);
export const sendAllMailboxesDraft = onDraft(sendDraft);
export const sendAllMailboxesDraftNow = onDraft(sendDraftNow);

export const getAllMailboxesAttachment: OperationHandler = async (event, deployment, actor) => {
  const id = event.pathParameters?.message ?? "";
  const mailbox = await mailboxHolding(deployment, actor!, (each) => storedMessage(deployment.table, each, id));
  if (mailbox === undefined) return refusal(404, `None of the mailboxes you can read has a message ${JSON.stringify(id)}. Read their threads to find the message.`);
  return getAttachment(inMailbox(event, mailbox), deployment, actor);
};

export const stopSharingInAllMailboxes: OperationHandler = async (event, deployment, actor) => {
  const id = event.pathParameters?.message ?? "";
  const mailbox = await mailboxHolding(deployment, actor!, (each) => storedMessage(deployment.table, each, id));
  if (mailbox === undefined) return refusal(404, `None of the mailboxes you can read has a message ${JSON.stringify(id)}. Read their sent threads to find the message.`);
  return stopSharing(inMailbox(event, mailbox), deployment, actor);
};
