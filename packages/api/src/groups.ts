// Admins create groups, change their members and policies, and delete them. A group is an address,
// so the receipt rules follow every change of addresses before it is answered, as for a mailbox's.
import type { components } from "@duva/openapi";
import { addressGiven, addressTaken } from "./addresses.ts";
import { jsonBody, type OperationHandler, refusal } from "./api.ts";
import { domainOf, isEmailAddress } from "./email-address.ts";
import type { Deployment } from "./deployment.ts";
import {
  addGroup,
  addressTarget,
  AddressTaken,
  allGroups,
  changeGroup as changeStoredGroup,
  findGroup,
  type Group,
  NoGroup,
  organizationDomain,
  removeGroup,
  removeMember,
} from "./organization.ts";
import { syncRecipients } from "./receiving.ts";

const sendPolicies: Group["sendPolicy"][] = ["anyone", "organization", "members"];
const replyTos: Group["replyTo"][] = ["sender", "group"];

const onlyAdmins = () => refusal(403, "Only admins can change the organization's groups. Ask an admin to.");

/**
 * The members given, in lower case and each once, if each is an address the group can have, or a
 * refusal that says why not. A member on the organization's domain must be one of its addresses.
 */
async function membersGiven(deployment: Deployment, group: string, given: unknown): Promise<string[] | ReturnType<typeof refusal>> {
  if (!Array.isArray(given)) return refusal(400, "Give members as a list of addresses.");
  const domain = await organizationDomain(deployment.table);
  const members: string[] = [];
  for (const each of given) {
    const member = typeof each === "string" ? each.trim().toLowerCase() : "";
    if (!isEmailAddress(member)) {
      return refusal(400, `${JSON.stringify(each)} isn't an address. Give each member as an address, like grace@${domain} or linus@example.org.`);
    }
    if (member === group) return refusal(400, `A group can't have itself as a member. Leave ${group} out of its members.`);
    if (domainOf(member) === domain) {
      if (member.split("@")[0]!.includes("+")) return refusal(400, `A member on ${domain} can't have a plus tag. Give ${member.split("+")[0]}@${domain}.`);
      if ((await addressTarget(deployment.table, member)) === undefined) {
        return refusal(400, `${member} isn't one of the organization's addresses. Give a mailbox's or a group's address, or add it first.`);
      }
    }
    if (!members.includes(member)) members.push(member);
  }
  return members;
}

/** The policies given, each where given, or a refusal if one isn't a choice there is. */
function policiesGiven(body: Record<string, unknown> | undefined): Partial<Pick<Group, "sendPolicy" | "replyTo">> | ReturnType<typeof refusal> {
  const { sendPolicy, replyTo } = body ?? {};
  if (sendPolicy !== undefined && !sendPolicies.includes(sendPolicy as Group["sendPolicy"])) {
    return refusal(400, `${JSON.stringify(sendPolicy)} isn't a send policy. Give sendPolicy as ${sendPolicies.join(", ")}.`);
  }
  if (replyTo !== undefined && !replyTos.includes(replyTo as Group["replyTo"])) {
    return refusal(400, `${JSON.stringify(replyTo)} isn't a Reply-To choice. Give replyTo as ${replyTos.join(" or ")}.`);
  }
  return { ...(sendPolicy !== undefined && { sendPolicy: sendPolicy as Group["sendPolicy"] }), ...(replyTo !== undefined && { replyTo: replyTo as Group["replyTo"] }) };
}

const isRefusal = (value: unknown): value is ReturnType<typeof refusal> => typeof value === "object" && value !== null && "statusCode" in value;

const notFound = (address: string) => refusal(404, `The organization has no group ${JSON.stringify(address)}. List its groups to find it.`);

const groupIn = (event: Parameters<OperationHandler>[0]) => (event.pathParameters?.group ?? "").trim().toLowerCase();

export const createGroup: OperationHandler = async (event, deployment, actor) => {
  if (!actor?.admin) return onlyAdmins();
  const body = jsonBody(event);
  const address = await addressGiven(deployment, body?.address);
  if (typeof address !== "string") return address;
  const members = await membersGiven(deployment, address, body?.members);
  if (isRefusal(members)) return members;
  const policies = policiesGiven(body);
  if (isRefusal(policies)) return policies;
  const group: Group = { address, members, sendPolicy: "anyone", replyTo: "sender", ...policies };
  try {
    await addGroup(deployment.table, { group, by: actor.id });
  } catch (error) {
    if (error instanceof AddressTaken) return addressTaken(deployment, address);
    throw error;
  }
  await syncRecipients(deployment.table, deployment.receiving);
  return { statusCode: 201, body: group satisfies components["schemas"]["Group"] };
};

export const listGroups: OperationHandler = async (_event, deployment, actor) => {
  if (!actor?.admin) return refusal(403, "Only admins can list the organization's groups. Ask an admin to.");
  return { statusCode: 200, body: { groups: await allGroups(deployment.table) } satisfies components["schemas"]["GroupList"] };
};

export const getGroup: OperationHandler = async (event, deployment, actor) => {
  if (!actor?.admin) return refusal(403, "Only admins can read the organization's groups. Ask an admin to.");
  const group = await findGroup(deployment.table, groupIn(event));
  if (group === undefined) return notFound(groupIn(event));
  return { statusCode: 200, body: group satisfies components["schemas"]["Group"] };
};

export const changeGroup: OperationHandler = async (event, deployment, actor) => {
  if (!actor?.admin) return onlyAdmins();
  const address = groupIn(event);
  const stored = await findGroup(deployment.table, address);
  if (stored === undefined) return notFound(address);
  const body = jsonBody(event);
  const members = body?.members === undefined ? stored.members : await membersGiven(deployment, address, body.members);
  if (isRefusal(members)) return members;
  const policies = policiesGiven(body);
  if (isRefusal(policies)) return policies;
  const group: Group = { ...stored, members, ...policies };
  const unchanged = group.members.join() === stored.members.join() && group.sendPolicy === stored.sendPolicy && group.replyTo === stored.replyTo;
  if (unchanged) return { statusCode: 200, body: stored };
  try {
    await changeStoredGroup(deployment.table, { group, by: actor.id });
  } catch (error) {
    if (error instanceof NoGroup) return notFound(address);
    throw error;
  }
  return { statusCode: 200, body: group satisfies components["schemas"]["Group"] };
};

export const deleteGroup: OperationHandler = async (event, deployment, actor) => {
  if (!actor?.admin) return onlyAdmins();
  const address = groupIn(event);
  const removed = await removeGroup(deployment.table, { address, by: actor.id });
  // Done even when it's gone, in case SES failed when it was removed.
  await syncRecipients(deployment.table, deployment.receiving);
  if (removed === undefined) return notFound(address);
  await removeMember(deployment.table, { address, by: actor.id });
  return { statusCode: 200, body: removed satisfies components["schemas"]["Group"] };
};
