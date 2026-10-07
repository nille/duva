// Access requests: a self-hosted agent asks a human for access with a code it shows them, the human
// approves it in Duva, which makes them its sponsor, and the agent collects its key (ADR-0024). The
// agent asks and collects without sign-in, since it has no key yet, so codes are short-lived, used
// once, and limited so they can't be guessed.
import { createHash, randomBytes, randomInt } from "node:crypto";
import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { components } from "@duva/openapi";
import { jsonBody, type OperationHandler, refusal } from "./api.ts";
import { nameIn, notSponsorsMailboxes, sponsorAccesses } from "./agents.ts";
import type { Table } from "./deployment.ts";
import { timeToLiveAttribute } from "./infrastructure.ts";
import {
  addKeylessAgent,
  type AgentSettings,
  changeAgentSettings,
  defaultAgentSettings,
  findActor,
  type Human,
  issueAgentKey,
  KeyChanged,
  ownedMailboxes,
} from "./organization.ts";
import { documents, pk, sk } from "./table.ts";

type AccessWanted = components["schemas"]["AccessWanted"];

/** How long a code works. */
const lifetime = 10 * 60_000;
/** How long after its code expired an approved request still gives its key. */
const collectFor = 60 * 60_000;
/** How many seconds the agent waits between tries to collect its key. */
const interval = 5;
/** The window each limit counts in, and how many each allows in it: requests from an address, and codes a human gives that no request waits with. */
const limitWindow = 10 * 60_000;
const asksPerWindow = 10;
const missesPerWindow = 10;

// Letters no one mistakes for another, without vowels, so no code spells a word: 20^8 codes.
const codeLetters = "BCDFGHJKLMNPQRSTVWXZ";
const codeLength = 8;
const wanted: AccessWanted[] = ["read", "organize", "draft", "send"];

// Approving moves a request through approving while the agent's settings are written, so the agent
// collects no key before it has the access its sponsor chose.
type State = "waiting" | "approving" | "approved" | "declined" | "collected";

/** An access request as stored, under its code without the dash. */
interface StoredRequest {
  code: string;
  secretHash: string;
  name: string;
  from: { address: string; host?: string };
  /** The addresses the agent asked for, or none if it asked for every mailbox of whoever approves. */
  mailboxes: string[];
  wants: AccessWanted;
  expiresAt: string;
  state: State;
  /** The agent its approval created. */
  agent?: string;
}

const requestKey = (code: string) => ({ [pk]: `accessRequest#${code}`, [sk]: "accessRequest" });
const limitKey = (limit: string, who: string, now: number) => ({ [pk]: `limit#${limit}#${who}`, [sk]: String(Math.floor(now / limitWindow) * limitWindow) });

const shown = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;
const hashed = (secret: string) => createHash("sha256").update(secret).digest("base64url");
/** The code as stored, from the code given in any case, with or without the dash, or undefined if it can't be one. */
const codeOf = (given: string) => {
  const code = given.toUpperCase().replace(/[\s-]/g, "");
  return code.length === codeLength && [...code].every((letter) => codeLetters.includes(letter)) ? code : undefined;
};

export const askForAccess: OperationHandler = async (event, deployment) => {
  const body = jsonBody(event) ?? {};
  const unknown = Object.keys(body).find((name) => !["name", "host", "mailboxes", "wants"].includes(name));
  if (unknown !== undefined) return refusal(400, `An access request has no ${JSON.stringify(unknown)}. Give name, host, mailboxes and wants.`);
  const host = body.host;
  if (host !== undefined && (typeof host !== "string" || host.trim() === "" || host.length > 253)) return refusal(400, "Give host as the name of the computer the agent runs on.");
  const name = body.name === undefined ? (typeof host === "string" ? host.trim().slice(0, 64) : "Agent") : nameIn(body);
  if (name === undefined) return refusal(400, "Give the agent a name of 1 to 64 characters.");
  const mailboxes = body.mailboxes ?? [];
  if (!Array.isArray(mailboxes) || mailboxes.length > 20 || mailboxes.some((address) => typeof address !== "string" || !address.includes("@"))) {
    return refusal(400, "Give mailboxes as the addresses of up to 20 mailboxes the agent asks for.");
  }
  const wants = body.wants ?? "read";
  if (!wanted.includes(wants as AccessWanted)) return refusal(400, `Give wants as ${wanted.slice(0, -1).join(", ")} or ${wanted.at(-1)}.`);

  const address = event.requestContext.http.sourceIp;
  if ((await countUp(deployment.table, limitKey("asks", address, Date.now()))) > asksPerWindow) {
    return refusal(429, `Your address asked for ${asksPerWindow} codes in the last 10 minutes. Wait 10 minutes and ask again.`);
  }
  const secret = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + lifetime).toISOString();
  // A code taken by a request that hasn't expired is drawn again.
  for (;;) {
    const code = Array.from({ length: codeLength }, () => codeLetters[randomInt(codeLetters.length)]).join("");
    const request: StoredRequest = {
      code,
      secretHash: hashed(secret),
      name,
      from: { address, ...(typeof host === "string" && { host: host.trim() }) },
      mailboxes: [...new Set((mailboxes as string[]).map((address) => address.trim().toLowerCase()))],
      wants: wants as AccessWanted,
      expiresAt,
      state: "waiting",
    };
    const taken = await documents(deployment.table)
      .send(
        new PutCommand({
          TableName: deployment.table.name,
          Item: { ...requestKey(code), ...request, [timeToLiveAttribute]: Math.ceil((Date.parse(expiresAt) + collectFor) / 1000) },
          // An approved request keeps its code until its key is collected.
          ConditionExpression: `attribute_not_exists(${pk}) OR (expiresAt < :now AND #state <> :approved)`,
          ExpressionAttributeNames: { "#state": "state" },
          ExpressionAttributeValues: { ":now": new Date().toISOString(), ":approved": "approved" },
        }),
      )
      .then(
        () => false,
        (error: unknown) => {
          if ((error as Error).name === "ConditionalCheckFailedException") return true;
          throw error;
        },
      );
    if (taken) continue;
    return { statusCode: 201, body: { code: shown(code), deviceCode: `${code}.${secret}`, expiresAt, interval } satisfies components["schemas"]["AccessRequestStarted"] };
  }
};

export const collectAccess: OperationHandler = async (event, deployment) => {
  const deviceCode = jsonBody(event)?.deviceCode;
  if (typeof deviceCode !== "string") return refusal(400, "Give the deviceCode asking for access gave.");
  const [given = "", secret = ""] = deviceCode.split(".");
  const code = codeOf(given);
  const request = code === undefined ? undefined : await storedRequest(deployment.table, code);
  const askAgain = "Ask for access again with duva login --agent.";
  if (request === undefined || request.secretHash !== hashed(secret)) return refusal(404, `No access request has this device code. ${askAgain}`);
  switch (request.state) {
    case "waiting":
    case "approving":
      if (expired(request)) return refusal(404, `The code ${shown(request.code)} expired before anyone approved it. ${askAgain}`);
      return refusal(202, `The code ${shown(request.code)} waits for a human to approve it. Try again in ${interval} seconds.`);
    case "declined":
      return refusal(403, `The human declined the access request ${shown(request.code)}. Ask them why before asking again.`);
    case "collected":
      return refusal(404, `The key for the access request ${shown(request.code)} was collected already. Ask your sponsor to rotate your key if you lost it.`);
    case "approved": {
      if (Date.now() > Date.parse(request.expiresAt) + collectFor) return refusal(404, `The key for the access request ${shown(request.code)} wasn't collected in time. Ask your sponsor to rotate your key.`);
      const agentId = request.agent!;
      try {
        const key = await issueAgentKey(deployment.table, { agent: agentId, items: [moved(deployment.table, request.code, "approved", "collected")] });
        const agent = await findActor(deployment.table, agentId);
        if (agent?.kind !== "agent") return refusal(404, `The agent the access request ${shown(request.code)} created was removed. ${askAgain}`);
        return { statusCode: 200, body: { agent, key } satisfies components["schemas"]["AgentWithKey"] };
      } catch (error) {
        if (error instanceof KeyChanged || error instanceof TransactionCanceledException) {
          return refusal(404, `The agent the access request ${shown(request.code)} created has a key already, or was removed. Ask your sponsor for its key.`);
        }
        throw error;
      }
    }
  }
};

export const getAccessRequest: OperationHandler = async (event, deployment, actor) => {
  const request = await requestAsked(event, deployment.table, actor);
  if ("statusCode" in request) return request;
  const human = actor as Human;
  const mailboxes = (await ownedMailboxes(deployment.table, human.id)).map((mailbox) => ({ mailbox, asked: askedFor(request, mailbox.addresses) }));
  return {
    statusCode: 200,
    body: { code: shown(request.code), name: request.name, from: request.from, wants: request.wants, mailboxes, expiresAt: request.expiresAt } satisfies components["schemas"]["AccessRequest"],
  };
};

const approvalSettings = ["sponsorAccess", "sponsorMailboxes", "approvalAsSponsor", "disclosureLineAsSponsor"] as const;

export const approveAccessRequest: OperationHandler = async (event, deployment, actor) => {
  const request = await requestAsked(event, deployment.table, actor);
  if ("statusCode" in request) return request;
  const human = actor as Human;
  const body = jsonBody(event) ?? {};
  const unknown = Object.keys(body).find((name) => name !== "name" && !(approvalSettings as readonly string[]).includes(name));
  if (unknown !== undefined) return refusal(400, `An approval has no ${JSON.stringify(unknown)}. Give name, ${approvalSettings.join(", ")}.`);
  const name = body.name === undefined ? request.name : nameIn(body);
  if (name === undefined) return refusal(400, "Give the agent a name of 1 to 64 characters.");
  if (body.sponsorAccess !== undefined && !sponsorAccesses.includes(body.sponsorAccess as AgentSettings["sponsorAccess"])) {
    return refusal(400, `Give sponsorAccess as ${sponsorAccesses.slice(0, -1).join(", ")} or ${sponsorAccesses.at(-1)}.`);
  }
  if (body.sponsorMailboxes !== undefined) {
    const notCovered = await notSponsorsMailboxes(deployment.table, { sponsor: human.id }, body.sponsorMailboxes);
    if (notCovered !== undefined) return notCovered;
  }
  const notOnOrOff = (["approvalAsSponsor", "disclosureLineAsSponsor"] as const).find((name) => body[name] !== undefined && typeof body[name] !== "boolean");
  if (notOnOrOff !== undefined) return refusal(400, `Give ${notOnOrOff} as true to turn it on, or false to turn it off.`);

  const own = await ownedMailboxes(deployment.table, human.id);
  const chosen: Partial<AgentSettings> = {
    sponsorAccess: request.wants,
    // An agent that named no mailbox asks for all of them, as sponsor access covers them while it names none.
    sponsorMailboxes: request.mailboxes.length === 0 ? null : own.filter(({ addresses }) => askedFor(request, addresses)).map(({ id }) => id),
    ...Object.fromEntries(approvalSettings.filter((name) => body[name] !== undefined).map((name) => [name, body[name]])),
  };
  if (Array.isArray(chosen.sponsorMailboxes)) chosen.sponsorMailboxes = [...new Set(chosen.sponsorMailboxes)];
  // A human without a mailbox has nothing to give access to, and no change feed to record settings in.
  const changes = own.length === 0 ? {} : Object.fromEntries(Object.entries(chosen).filter(([setting, value]) => JSON.stringify(value) !== JSON.stringify(defaultAgentSettings[setting as keyof AgentSettings])));

  let agent;
  try {
    agent = await addKeylessAgent(deployment.table, { name, sponsor: human.id, items: (agent) => [moved(deployment.table, request.code, "waiting", "approving", { agent })] });
  } catch (error) {
    if (error instanceof TransactionCanceledException) return refusal(409, `The access request ${shown(request.code)} was approved, declined or expired meanwhile.`);
    throw error;
  }
  if (Object.keys(changes).length > 0) await changeAgentSettings(deployment.table, { agent, changes });
  await documents(deployment.table).send(new UpdateCommand(moved(deployment.table, request.code, "approving", "approved").Update));
  return { statusCode: 201, body: agent satisfies components["schemas"]["Agent"] };
};

export const declineAccessRequest: OperationHandler = async (event, deployment, actor) => {
  const request = await requestAsked(event, deployment.table, actor);
  if ("statusCode" in request) return request;
  try {
    await documents(deployment.table).send(new UpdateCommand(moved(deployment.table, request.code, "waiting", "declined").Update));
  } catch (error) {
    if ((error as Error).name === "ConditionalCheckFailedException") return refusal(409, `The access request ${shown(request.code)} was approved, declined or expired meanwhile.`);
    throw error;
  }
  return { statusCode: 200, body: { code: shown(request.code) } satisfies components["schemas"]["AccessDeclined"] };
};

/**
 * The request waiting with the code the call's path gives, for a human, or a refusal. Each code a
 * human gives that no request waits with counts, and past the limit every code is refused until the
 * window is over.
 */
async function requestAsked(event: Parameters<OperationHandler>[0], table: Table, actor: Parameters<OperationHandler>[2]): Promise<StoredRequest | ReturnType<typeof refusal>> {
  if (actor?.kind !== "human") return refusal(403, "Only humans approve access requests, and an agent never does. Ask the human who will be its sponsor.");
  const misses = limitKey("misses", actor.id, Date.now());
  const tooMany = refusal(429, `You gave ${missesPerWindow} codes no access request waits with in the last 10 minutes. Wait 10 minutes and try again.`);
  if ((await countOf(table, misses)) >= missesPerWindow) return tooMany;
  const given = event.pathParameters?.code ?? "";
  const code = codeOf(given);
  const request = code === undefined ? undefined : await storedRequest(table, code);
  if (request !== undefined && request.state === "waiting" && !expired(request)) return request;
  await countUp(table, misses);
  return refusal(404, `No access request waits with the code ${JSON.stringify(given)}. A code works for 10 minutes and once. Ask the agent to ask again.`);
}

const expired = (request: StoredRequest) => request.expiresAt <= new Date().toISOString();

/** Whether the agent asked for a mailbox with any of the addresses, as it does for every mailbox when it names none. */
const askedFor = (request: StoredRequest, addresses: string[]) => request.mailboxes.length === 0 || addresses.some((address) => request.mailboxes.includes(address.toLowerCase()));

async function storedRequest(table: Table, code: string): Promise<StoredRequest | undefined> {
  const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: requestKey(code), ConsistentRead: true }));
  return Item as StoredRequest | undefined;
}

/** The update that moves the request from one state to another, if it is in the first and, while it waits, hasn't expired. */
function moved(table: Table, code: string, from: State, to: State, also: Record<string, string> = {}) {
  const names = Object.keys(also);
  return {
    Update: {
      TableName: table.name,
      Key: requestKey(code),
      UpdateExpression: `SET #state = :to${names.map((name) => `, #${name} = :${name}`).join("")}`,
      ConditionExpression: from === "waiting" ? "#state = :from AND expiresAt > :now" : "#state = :from",
      ExpressionAttributeNames: { "#state": "state", ...Object.fromEntries(names.map((name) => [`#${name}`, name])) },
      ExpressionAttributeValues: {
        ":from": from,
        ":to": to,
        ...(from === "waiting" && { ":now": new Date().toISOString() }),
        ...Object.fromEntries(names.map((name) => [`:${name}`, also[name]])),
      },
    },
  };
}

/** Counts one more against the limit, and returns how many are counted in its window now. */
async function countUp(table: Table, key: Record<string, string>): Promise<number> {
  const { Attributes } = await documents(table).send(
    new UpdateCommand({
      TableName: table.name,
      Key: key,
      UpdateExpression: "ADD #count :one SET #expires = :expires",
      ExpressionAttributeNames: { "#count": "count", "#expires": timeToLiveAttribute },
      ExpressionAttributeValues: { ":one": 1, ":expires": Math.ceil((Number(key[sk]) + 2 * limitWindow) / 1000) },
      ReturnValues: "UPDATED_NEW",
    }),
  );
  return Attributes?.count as number;
}

async function countOf(table: Table, key: Record<string, string>): Promise<number> {
  const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: key, ConsistentRead: true }));
  return (Item?.count as number | undefined) ?? 0;
}
