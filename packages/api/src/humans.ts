import type { components } from "@duva/openapi";
import { jsonBody, type OperationHandler, refusal } from "./api.ts";
import { isEmailAddress } from "./email-address.ts";
import {
  addHumanToOrganization,
  allHumans,
  changeAdmin,
  findActor,
  forgetSignIn,
  handOverMailbox,
  type Human,
  HumanExists,
  isAdmin,
  LastAdmin,
  type Mailbox,
  NotAHuman,
  ownedMailboxes,
  removeHumanFromOrganization,
  sponsoredAgents,
} from "./organization.ts";
import { giveMailboxAgent } from "./mailbox-agents.ts";
import { syncRecipients } from "./receiving.ts";
import { deleteMailboxes, removeAgentWithApprovals } from "./removal.ts";

export const addHuman: OperationHandler = async (event, deployment, actor) => {
  if (!isAdmin(actor)) return refusal(403, "Only admins can add humans. Ask an admin to add them.");
  const body = jsonBody(event);
  const given = typeof body?.email === "string" ? body.email.trim() : "";
  // Addresses are kept in lower case, so one human never gets two actors by case alone.
  const email = given.toLowerCase();
  if (!isEmailAddress(email) || email.length > 254) {
    return refusal(400, `${JSON.stringify(given)} isn't an email address. Give the address the human will sign in with, like grace@example.com.`);
  }
  const exists = () => refusal(409, `${email} is already a human in the organization. List the humans to find their ID.`);
  if ((await allHumans(deployment.table)).some((human) => human.email === email)) return exists();
  try {
    const human = await addHumanToOrganization(deployment, { email, by: actor!.id });
    return { statusCode: 201, body: human satisfies components["schemas"]["Human"] };
  } catch (error) {
    if (!(error instanceof HumanExists)) throw error;
    return exists();
  }
};

export const listHumans: OperationHandler = async (_event, deployment, actor) => {
  if (!isAdmin(actor)) return refusal(403, "Only admins can list the organization's humans. Ask an admin who has access.");
  return { statusCode: 200, body: { humans: await allHumans(deployment.table) } satisfies components["schemas"]["HumanList"] };
};

export const removeHuman: OperationHandler = async (event, deployment, actor) => {
  if (!isAdmin(actor)) return refusal(403, "Only admins can remove humans. Ask an admin to remove them.");
  const human = await humanAsked(event, deployment);
  if ("statusCode" in human) return human;
  const mailboxes = await ownedMailboxes(deployment.table, human.id);
  const agents = await sponsoredAgents(deployment.table, human.id);
  const removal = (removed: boolean) => ({ statusCode: 200, body: { human, mailboxes, agents, removed } satisfies components["schemas"]["HumanRemoval"] });
  const body = jsonBody(event) ?? {};
  if (body.dryRun === true) return removal(false);

  const choices = await choicesIn(body, deployment, human, mailboxes);
  if ("statusCode" in choices) return choices;
  const lastAdmin = lastAdminRefusal(human);
  if (human.admin && !(await allHumans(deployment.table)).some(({ id, admin }) => admin && id !== human.id)) return lastAdmin;

  for (const agent of agents) await removeAgentWithApprovals(deployment.table, { agent, by: actor!.id });
  try {
    for (const mailbox of choices.handOver) {
      await handOverMailbox(deployment.table, { mailbox, to: choices.handTo!.id, by: actor!.id });
      // Its mailbox agent went with its sponsor, so the new owner gets one of their own.
      await giveMailboxAgent(deployment.table, { ...mailbox, owner: choices.handTo!.id });
    }
  } catch (error) {
    if (!(error instanceof NotAHuman)) throw error;
    return refusal(409, `${choices.handTo!.email} was removed meanwhile. Run the removal again with another human in handTo.`);
  }
  await deleteMailboxes(deployment, { mailboxes: choices.delete, by: actor!.id });
  await syncRecipients(deployment.table, deployment.receiving);
  try {
    await removeHumanFromOrganization(deployment.table, { human, by: actor!.id });
  } catch (error) {
    if (error instanceof LastAdmin) return lastAdmin;
    throw error;
  }
  // Their sessions already stop at the authorizer, and from here on they can't sign in or renew one.
  const sub = await deployment.humans.remove(human.email);
  if (sub !== undefined) await forgetSignIn(deployment.table, sub);
  return removal(true);
};

/**
 * What the body says happens to each of the human's mailboxes, or a refusal if it doesn't say it
 * for each exactly once, or names no other human to hand them to.
 */
async function choicesIn(
  body: Record<string, unknown>,
  deployment: Parameters<OperationHandler>[1],
  human: Human,
  mailboxes: Mailbox[],
): Promise<{ handTo?: Human; handOver: Mailbox[]; delete: Mailbox[] } | ReturnType<typeof refusal>> {
  const ids = (name: "handOver" | "delete") => (body[name] === undefined ? [] : Array.isArray(body[name]) && body[name].every((id) => typeof id === "string") ? body[name] : undefined);
  const handOver = ids("handOver");
  const deleted = ids("delete");
  if (handOver === undefined || deleted === undefined) return refusal(400, "Give handOver and delete as lists of mailbox IDs.");
  const given = [...handOver, ...deleted];
  const repeated = given.find((id, index) => given.indexOf(id) !== index);
  if (repeated !== undefined) return refusal(400, `${JSON.stringify(repeated)} is given twice. Give each mailbox once, in handOver or in delete.`);
  const unknown = given.find((id) => !mailboxes.some((mailbox) => mailbox.id === id));
  if (unknown !== undefined) return refusal(400, `${JSON.stringify(unknown)} isn't one of ${human.email}'s mailboxes. Run the removal with dryRun to list them.`);
  const missing = mailboxes.filter(({ id }) => !given.includes(id));
  if (missing.length > 0) {
    return refusal(400, `Say what happens to each of ${human.email}'s mailboxes. Give ${missing.map(({ id }) => id).join(", ")} in handOver or delete.`);
  }
  const chosen = (list: string[]) => mailboxes.filter(({ id }) => list.includes(id));
  if (handOver.length === 0) return { handOver: [], delete: chosen(deleted) };
  const handTo = typeof body.handTo === "string" ? await findActor(deployment.table, body.handTo) : undefined;
  if (handTo?.kind !== "human" || handTo.id === human.id) {
    return refusal(400, `Give handTo as the ID of another human, who gets the mailboxes in handOver. List the humans to find their IDs.`);
  }
  return { handTo, handOver: chosen(handOver), delete: chosen(deleted) };
}

export const changeHuman: OperationHandler = async (event, deployment, actor) => {
  if (!isAdmin(actor)) return refusal(403, "Only admins can change who is an admin. Ask an admin to.");
  const human = await humanAsked(event, deployment);
  if ("statusCode" in human) return human;
  const admin = jsonBody(event)?.admin;
  if (typeof admin !== "boolean") return refusal(400, "Give admin as true to make the human an admin, or false to take it away.");
  try {
    const changed = await changeAdmin(deployment.table, { human, admin, by: actor!.id });
    return { statusCode: 200, body: changed satisfies components["schemas"]["Human"] };
  } catch (error) {
    if (!(error instanceof LastAdmin)) throw error;
    return lastAdminRefusal(human);
  }
};

const lastAdminRefusal = (human: Human) => refusal(409, `${human.email} is the organization's last admin. Make another human an admin first.`);

/** The human the call's path names, or a refusal if there is none. */
async function humanAsked(event: Parameters<OperationHandler>[0], deployment: Parameters<OperationHandler>[1]): Promise<Human | ReturnType<typeof refusal>> {
  const id = event.pathParameters?.human ?? "";
  const human = await findActor(deployment.table, id);
  if (human?.kind !== "human") return refusal(404, `There is no human ${JSON.stringify(id)}. List the humans to find their ID.`);
  return human;
}
