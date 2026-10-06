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
  chooseDefaultAddress,
  findMailbox,
  NotItsAddress,
  organizationDomain,
  removeAddress as removeStoredAddress,
} from "./organization.ts";
import { maxAddresses, syncRecipients } from "./receiving.ts";

const onlyAdmins = () => refusal(403, "Only admins can change the organization's addresses. Ask an admin to.");

/**
 * The address given, in lower case, if the organization can have it and has room for it, or a
 * refusal that says why not.
 */
export async function addressGiven(deployment: Deployment, given: unknown): Promise<string | ReturnType<typeof refusal>> {
  const trimmed = typeof given === "string" ? given.trim() : "";
  const domain = await organizationDomain(deployment.table);
  const address = trimmed.toLowerCase();
  const at = address.lastIndexOf("@");
  const local = address.slice(0, at);
  if (at < 0 || local === "" || address.slice(at + 1) !== domain) {
    return refusal(400, `${JSON.stringify(trimmed)} isn't an address on ${domain}. Give one like hermes@${domain}.`);
  }
  if (local.includes("+")) {
    return refusal(400, `An address can't have a plus tag. Give ${local.split("+")[0]}@${domain}, and mail to its tagged addresses reaches it too.`);
  }
  // Letters, digits and . _ -, with no dot at either end or two in a row, which every mail server takes.
  if (!/^[a-z0-9_-]+(\.[a-z0-9_-]+)*$/.test(local) || local.length > 64) {
    return refusal(400, `${JSON.stringify(trimmed)} isn't an address Duva can create. Use letters, digits, dots, hyphens and underscores before the @.`);
  }
  // SES's receipt rules list at most this many recipients in all.
  if ((await allAddresses(deployment.table)).length >= maxAddresses) {
    return refusal(409, `The organization has ${maxAddresses} addresses, as many as Duva can receive mail for. Remove one first.`);
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
  const removed = await removeStoredAddress(deployment.table, { address, by: actor.id });
  // Done even when it's gone, in case SES failed when it was removed.
  await syncRecipients(deployment.table, deployment.receiving);
  if (removed === undefined) return refusal(404, `The organization has no address ${JSON.stringify(address)}. List its addresses to find it.`);
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
