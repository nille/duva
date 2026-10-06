// Admins give mailboxes addresses, remove them and choose each mailbox's default address. The
// receipt rules follow every change before it is answered, so mail to a removed address is refused
// from then on.
import type { components } from "@duva/openapi";
import { jsonBody, type OperationHandler, refusal } from "./api.ts";
import type { Deployment } from "./deployment.ts";
import {
  addAddress as addStoredAddress,
  AddressTaken,
  allAddresses,
  allDomains,
  chooseDefaultAddress,
  findGroup,
  findMailbox,
  NotItsAddress,
  removeAddress as removeStoredAddress,
  removeMember,
} from "./organization.ts";
import { maxAddresses, ruleRecipients, syncRecipients } from "./receiving.ts";

const onlyAdmins = () => refusal(403, "Only admins can change the organization's addresses. Ask an admin to.");

/**
 * The address given, in lower case, if the organization can have it and has room for it, or a
 * refusal that says why not. Addresses are on standalone domains, and each of its alias domains
 * mirrors them.
 */
export async function addressGiven(deployment: Deployment, given: unknown): Promise<string | ReturnType<typeof refusal>> {
  const trimmed = typeof given === "string" ? given.trim() : "";
  const domains = await allDomains(deployment.table);
  const standalone = domains.filter(({ aliasOf }) => aliasOf === undefined).map(({ domain }) => domain);
  const address = trimmed.toLowerCase();
  const at = address.lastIndexOf("@");
  const local = address.slice(0, at);
  const domain = domains.find((each) => each.domain === address.slice(at + 1));
  const example = `hermes@${standalone[0] ?? "example.com"}`;
  if (at < 0 || local === "" || domain === undefined) {
    const listed = standalone.length > 1 ? `${standalone.slice(0, -1).join(", ")} or ${standalone.at(-1)}` : standalone.join("");
    return refusal(400, `${JSON.stringify(trimmed)} isn't an address on ${listed}. Give one like ${example}.`);
  }
  if (domain.aliasOf !== undefined) {
    return refusal(400, `${domain.domain} is an alias domain, which mirrors every address on ${domain.aliasOf}. Give ${local}@${domain.aliasOf}, and mail to ${local}@${domain.domain} reaches it too.`);
  }
  if (local.includes("+")) {
    return refusal(400, `An address can't have a plus tag. Give ${local.split("+")[0]}@${domain.domain}, and mail to its tagged addresses reaches it too.`);
  }
  // Letters, digits and . _ -, with no dot at either end or two in a row, which every mail server takes.
  if (!/^[a-z0-9_-]+(\.[a-z0-9_-]+)*$/.test(local) || local.length > 64) {
    return refusal(400, `${JSON.stringify(trimmed)} isn't an address Duva can create. Use letters, digits, dots, hyphens and underscores before the @.`);
  }
  // SES's receipt rules list at most this many recipients in all, and the domain's alias domains each mirror the address.
  const mirrors = domains.filter(({ aliasOf }) => aliasOf === domain.domain).length;
  if ((await ruleRecipients(deployment.table)).length + 1 + mirrors > maxAddresses) {
    return refusal(409, `The organization receives mail for ${maxAddresses} addresses, those its alias domains mirror included, as many as Duva can. Remove one first.`);
  }
  return address;
}

/** The refusal of a taken address, after repairing the receipt rules, in case SES failed when it was added. */
export async function addressTaken(deployment: Deployment, address: string) {
  await syncRecipients(deployment.table, deployment.receiving);
  return refusal(409, `${address} is taken. Give another address.`);
}

export const addAddress: OperationHandler = async (event, deployment, actor) => {
  if (!actor?.admin) return onlyAdmins();
  const body = jsonBody(event);
  const address = await addressGiven(deployment, body?.address);
  if (typeof address !== "string") return address;
  const mailbox = typeof body?.mailbox === "string" ? await findMailbox(deployment.table, body.mailbox) : undefined;
  if (mailbox === undefined) return refusal(400, `There is no mailbox ${JSON.stringify(body?.mailbox ?? "")}. Give the ID of the mailbox the address is for.`);
  try {
    await addStoredAddress(deployment.table, { mailbox: mailbox.id, address, by: actor.id });
  } catch (error) {
    if (error instanceof AddressTaken) return addressTaken(deployment, address);
    throw error;
  }
  await syncRecipients(deployment.table, deployment.receiving);
  return { statusCode: 201, body: { address, mailbox: mailbox.id } satisfies components["schemas"]["Address"] };
};

export const listAddresses: OperationHandler = async (_event, deployment, actor) => {
  if (!actor?.admin) return refusal(403, "Only admins can list the organization's addresses.");
  return { statusCode: 200, body: { addresses: await allAddresses(deployment.table) } satisfies components["schemas"]["AddressList"] };
};

export const removeAddress: OperationHandler = async (event, deployment, actor) => {
  if (!actor?.admin) return onlyAdmins();
  const address = (event.pathParameters?.address ?? "").trim().toLowerCase();
  if ((await findGroup(deployment.table, address)) !== undefined) return refusal(409, `${address} is a group's address. Delete the group to remove it.`);
  const removed = await removeStoredAddress(deployment.table, { address, by: actor.id });
  // Done even when it's gone, in case SES failed when it was removed.
  await syncRecipients(deployment.table, deployment.receiving);
  if (removed === undefined) return refusal(404, `The organization has no address ${JSON.stringify(address)}. List its addresses to find it.`);
  await removeMember(deployment.table, { address, by: actor.id });
  return { statusCode: 200, body: removed satisfies components["schemas"]["Address"] };
};

export const changeMailbox: OperationHandler = async (event, deployment, actor) => {
  if (!actor?.admin) return refusal(403, "Only admins can choose a mailbox's default address. Ask an admin to.");
  const id = event.pathParameters?.mailbox ?? "";
  const mailbox = await findMailbox(deployment.table, id);
  if (mailbox === undefined) return refusal(404, `There is no mailbox ${JSON.stringify(id)}. List the organization's addresses to find its ID.`);
  const given = jsonBody(event)?.defaultAddress;
  const address = typeof given === "string" ? given.trim().toLowerCase() : "";
  try {
    const changed = await chooseDefaultAddress(deployment.table, { mailbox: id, address, by: actor.id });
    return { statusCode: 200, body: changed satisfies components["schemas"]["Mailbox"] };
  } catch (error) {
    if (!(error instanceof NotItsAddress)) throw error;
    if (mailbox.addresses.length === 0) return refusal(400, "The mailbox has no address. Add one, and it becomes the default address.");
    return refusal(400, `${JSON.stringify(address)} isn't one of the mailbox's addresses, which are ${mailbox.addresses.join(", ")}. Give one of them as defaultAddress.`);
  }
};
