// Sign-in links and recovery addresses (ADR-0041). Each human has a recovery address outside the
// organization's domains, where Duva mails a link that signs them in once, within 30 minutes: when
// they're added, when they ask for one on the sign-in page, or when an admin sends one. A link is a
// Cognito custom authentication challenge: the API answers it with the link's token, and the
// trigger Lambda, which only the user pool may invoke, checks the token against the hash the table
// keeps and deletes it, so it works once. Managed login offers no custom challenge, so the web app
// follows links through the API (docs/aws.md). A human changes their recovery address by
// following a link mailed to the new one.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { DeleteCommand, GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { type components, recoveryLinkRoute, signInLinkRoute } from "@duva/openapi";
import type { Deployment, Table } from "./deployment.ts";
import { domainOf, isEmailAddress } from "./email-address.ts";
import { signInLinkPrefix, signInSender, timeToLiveAttribute } from "./infrastructure.ts";
import { buildMail } from "./mime.ts";
import { jsonBody, type OperationHandler, refusal } from "./operation-handler.ts";
import { actorKey, allDomains, allHumans, findActor, firstAdmin, type Human, isAdmin, organizationDomain } from "./organization.ts";
import { Refused } from "./outbound.ts";
import { countUp, limitKey } from "./request-limits.ts";
import { documents, pk, sk } from "./table.ts";

type LinkMailed = components["schemas"]["LinkMailed"];
type SignInSession = components["schemas"]["SignInSession"];

/** How long a link works after Duva mailed it. */
export const linkLifetime = 30 * 60_000;
/**
 * How many links one address gets in 10 minutes by asking on the sign-in page, how many one caller
 * may ask for, and how many new recovery addresses one human may have mailed.
 */
const linksPerAddress = 3;
const asksPerCaller = 10;
const changesPerHuman = 3;
/** How long asking for a link takes at least, so the time it takes says nothing about who is a human in Duva. */
const askTakes = 1_000;

const linkKey = (hash: string) => ({ [pk]: `${signInLinkPrefix}${hash}`, [sk]: "signInLink" });
const recoveryKey = (human: string) => ({ ...actorKey(human), [sk]: "recovery" });
const changeKey = (hash: string) => ({ [pk]: `recoveryChange#${hash}`, [sk]: "recoveryChange" });
const hashed = (token: string) => createHash("sha256").update(token).digest("base64url");

/** The human's recovery address, or undefined if they have none, as humans added before recovery addresses. */
export async function recoveryAddressOf(table: Table, human: string): Promise<string | undefined> {
  const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: recoveryKey(human), ConsistentRead: true }));
  return Item?.address as string | undefined;
}

/** Gives the human the recovery address, in place of any they had, or only if they have none. */
export async function keepRecoveryAddress(table: Table, human: string, address: string, { ifNone = false } = {}): Promise<void> {
  await documents(table)
    .send(
      new UpdateCommand({
        TableName: table.name,
        Key: recoveryKey(human),
        UpdateExpression: "SET address = :address",
        ...(ifNone && { ConditionExpression: "attribute_not_exists(address)" }),
        ExpressionAttributeValues: { ":address": address },
      }),
    )
    .catch((error: unknown) => {
      if (!(ifNone && error instanceof ConditionalCheckFailedException)) throw error;
    });
}

/** What mailing a sign-in link takes of the deployment. */
type Mailing = Pick<Deployment, "table" | "webUrl" | "signInSender" | "outbound">;

/**
 * Gives the first admin the recovery address duva deploy names, if they have none, and mails their
 * first sign-in link there, once, as setup does after each deploy. Returns the admin with what it
 * mailed this time. While SES refuses the link, as before it has verified the domain, nothing is
 * mailed, and the next setup tries again. Throws if the address is on one of the organization's domains.
 */
export async function setUpFirstAdmin(deployment: Mailing, admin: Human, recovery: string | undefined): Promise<components["schemas"]["HumanAdded"]> {
  const { table } = deployment;
  // Once the first admin was removed, setup returns another admin, who keeps their own.
  if (recovery && (await firstAdmin(table))?.id === admin.id) {
    const given = await recoveryAddressGiven(table, recovery, "--recovery");
    if ("statusCode" in given) throw new Error(given.body.message);
    await keepRecoveryAddress(table, admin.id, given.address, { ifNone: true });
  }
  const to = await recoveryAddressOf(table, admin.id);
  if (to === undefined) return admin;
  try {
    // Claimed first, so two setups never mail it twice.
    await documents(table).send(
      new UpdateCommand({ TableName: table.name, Key: recoveryKey(admin.id), UpdateExpression: "SET firstLinkMailed = :mailed", ConditionExpression: "attribute_not_exists(firstLinkMailed)", ExpressionAttributeValues: { ":mailed": true } }),
    );
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) return { ...admin, recoveryAddress: to };
    throw error;
  }
  let signInLink: LinkMailed | undefined;
  try {
    signInLink = await unlessRefused(mailSignInLink(deployment, admin, to));
  } finally {
    // The next setup mails a link that wasn't mailed.
    if (signInLink === undefined) await documents(table).send(new UpdateCommand({ TableName: table.name, Key: recoveryKey(admin.id), UpdateExpression: "REMOVE firstLinkMailed" }));
  }
  return { ...admin, recoveryAddress: to, ...(signInLink && { signInLink }) };
}

/**
 * The address given, in lower case, if it can be a recovery address: one address, outside every
 * domain of the organization, or a refusal that says what to give.
 */
export async function recoveryAddressGiven(table: Table, given: unknown, name = "recoveryAddress"): Promise<{ address: string } | ReturnType<typeof refusal>> {
  const address = typeof given === "string" ? given.trim().toLowerCase() : "";
  if (!isEmailAddress(address) || address.length > 254) {
    return refusal(400, `Give ${name} as an address outside the organization, such as a Gmail address, where Duva mails sign-in links.`);
  }
  if ((await allDomains(table)).some(({ domain }) => domain === domainOf(address))) {
    return refusal(400, `${address} is on the organization's domain ${domainOf(address)}. Give ${name} as an address outside the organization, so a sign-in link reaches its human even when they can't sign in to Duva.`);
  }
  return { address };
}

/** What the mailing gives, or undefined if SES refused it, which is logged, as in the SES sandbox to an address it hasn't verified. */
export async function unlessRefused<T>(mailing: Promise<T>): Promise<T | undefined> {
  try {
    return await mailing;
  } catch (error) {
    if (!(error instanceof Refused)) throw error;
    console.error(error);
    return undefined;
  }
}

/**
 * A new token, kept only as its hash under `key` with `item`, which the table deletes once it has
 * expired, and when that is.
 */
async function newToken(table: Table, key: (hash: string) => Record<string, string>, item: Record<string, unknown>): Promise<{ token: string; expiresAt: string }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + linkLifetime);
  await documents(table).send(new PutCommand({ TableName: table.name, Item: { ...key(hashed(token)), ...item, expiresAt: expiresAt.toISOString(), [timeToLiveAttribute]: Math.ceil(expiresAt.getTime() / 1000) } }));
  return { token, expiresAt: expiresAt.toISOString() };
}

/**
 * Mails the human a sign-in link at the address, their recovery address, from no-reply@ the sign-in
 * domain, and returns where it went and until when. Throws Refused if SES refused it.
 */
export async function mailSignInLink(deployment: Mailing, human: Human, to: string): Promise<LinkMailed> {
  // Cognito's triggers know the human by the address they sign in with, in any case.
  const { token, expiresAt } = await newToken(deployment.table, linkKey, { email: human.email.toLowerCase(), human: human.id });
  await mailFromDuva(deployment, {
    to,
    subject: "Sign in to Duva",
    text:
      `Follow this link to sign in to Duva as ${human.email}:\n\n${deployment.webUrl}/${signInLinkRoute}${token}\n\n` +
      "It works once, for 30 minutes. Then Duva asks you to register a passkey, so you can sign in without a link.\n\n" +
      "Duva mailed it here because this is your recovery address. If you didn't ask for it, you can ignore it.",
  });
  return { to, expiresAt };
}

/** Mails Duva's own message to one address, from no-reply@ the sign-in domain. Throws Refused if SES refused it. */
async function mailFromDuva(deployment: Mailing, { to, subject, text }: { to: string; subject: string; text: string }): Promise<void> {
  // Until SES has verified the first domain, Cognito sends codes itself, and SES refuses to send from it.
  const domain = (await deployment.signInSender.domain()) ?? (await organizationDomain(deployment.table));
  const raw = buildMail({
    messageId: `<${randomUUID()}@${domain}>`,
    from: { name: "Duva", address: signInSender(domain) },
    to: [{ address: to }],
    cc: [],
    subject,
    date: new Date(),
    references: [],
    headers: [["Auto-Submitted", "auto-generated"]],
    text,
    attachments: [],
  });
  await deployment.outbound.send(raw, { to: [to], cc: [], bcc: [] });
}

/** The session the link's token signs its human in with, once, or undefined if the link has expired or was used. */
async function sessionFromLink(deployment: Deployment, token: string): Promise<SignInSession | undefined> {
  const { Item } = await documents(deployment.table).send(new GetCommand({ TableName: deployment.table.name, Key: linkKey(hashed(token)), ConsistentRead: true }));
  if (Item === undefined || Date.parse(Item.expiresAt as string) <= Date.now()) return undefined;
  return deployment.humans.signInWithLink(Item.email as string, token);
}

/** What Cognito gives a custom challenge's triggers, and takes back, as far as Duva reads it. */
export interface ChallengeEvent {
  triggerSource: string;
  request: {
    userAttributes: Record<string, string>;
    session?: { challengeName: string; challengeResult: boolean }[];
    challengeAnswer?: string;
  };
  response: Record<string, unknown>;
}

/**
 * The custom challenge's three triggers, in one Lambda: a sign-in that answers one challenge with
 * a link's token, which must be the human's, unexpired and unused, gets tokens.
 */
export function signInLinkTriggers(table: Table) {
  return async (event: ChallengeEvent): Promise<ChallengeEvent> => {
    const { request, response } = event;
    if (event.triggerSource === "DefineAuthChallenge_Authentication") {
      const [first, ...more] = request.session ?? [];
      // One answer, and only to Duva's challenge.
      if (first === undefined) Object.assign(response, { challengeName: "CUSTOM_CHALLENGE", issueTokens: false, failAuthentication: false });
      else Object.assign(response, first.challengeName === "CUSTOM_CHALLENGE" && first.challengeResult && more.length === 0 ? { issueTokens: true, failAuthentication: false } : { issueTokens: false, failAuthentication: true });
    } else if (event.triggerSource === "CreateAuthChallenge_Authentication") {
      // Cognito refuses every answer to a challenge with no private parameters (docs/aws.md).
      Object.assign(response, { publicChallengeParameters: {}, privateChallengeParameters: { challenge: "signInLink" }, challengeMetadata: "SIGN_IN_LINK" });
    } else if (event.triggerSource === "VerifyAuthChallengeResponse_Authentication") {
      response.answerCorrect = await usedUp(table, request.challengeAnswer ?? "", (request.userAttributes.email ?? "").toLowerCase());
    }
    return event;
  };
}

/** Deletes the link the token is the end of, if it is the human's at `email` and unexpired, and says whether it was. */
async function usedUp(table: Table, token: string, email: string): Promise<boolean> {
  try {
    await documents(table).send(
      new DeleteCommand({
        TableName: table.name,
        Key: linkKey(hashed(token)),
        ConditionExpression: "email = :email AND expiresAt > :now",
        ExpressionAttributeValues: { ":email": email, ":now": new Date().toISOString() },
      }),
    );
    return true;
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) return false;
    throw error;
  }
}

/** Why SES refused to mail the link, and what to do. */
const refusedLink = (to: string, error: Refused) =>
  refusal(409, `SES refused to mail ${to}: ${error.message} In the SES sandbox, Duva mails only addresses SES has verified, so verify it in SES or request production access.`);

export const askForSignInLink: OperationHandler = async (event, deployment) => {
  const asked = Date.now();
  const given = jsonBody(event)?.email;
  const email = typeof given === "string" ? given.trim().toLowerCase() : "";
  if (!isEmailAddress(email)) return refusal(400, "Give email as the address you sign in to Duva with.");
  if ((await countUp(deployment.table, limitKey("signInLinkAsks", event.requestContext.http.sourceIp, asked))) > asksPerCaller) {
    return refusal(429, `Your address asked for ${asksPerCaller} sign-in links in the last 10 minutes. Wait 10 minutes and ask again.`);
  }
  // Every address gets the same answer, in the same time, so it says nothing about who is a human in
  // Duva, or has a recovery address. The limit counts the address given, whoever it is.
  if ((await countUp(deployment.table, limitKey("signInLinks", hashed(email), asked))) <= linksPerAddress) {
    try {
      const human = (await allHumans(deployment.table)).find((each) => each.email.toLowerCase() === email);
      const to = human === undefined ? undefined : await recoveryAddressOf(deployment.table, human.id);
      if (human !== undefined && to !== undefined) await mailSignInLink(deployment, human, to);
    } catch (error) {
      console.error(error);
    }
  }
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, asked + askTakes - Date.now())));
  return refusal(202, "If the address signs in to Duva, Duva mailed a sign-in link to its recovery address. It works once, for 30 minutes.");
};

export const followSignInLink: OperationHandler = async (event, deployment) => {
  const token = jsonBody(event)?.token;
  if (typeof token !== "string" || token === "") return refusal(400, `Give token as the end of the sign-in link, after ${signInLinkRoute}.`);
  const session = await sessionFromLink(deployment, token);
  if (session === undefined) return refusal(404, "This sign-in link has expired or was used. Ask for a new one on the sign-in page.");
  return { statusCode: 200, body: session };
};

export const sendSignInLink: OperationHandler = async (event, deployment, actor) => {
  if (!isAdmin(actor)) return refusal(403, "Only admins can send a human a sign-in link. They can ask for one on the sign-in page.");
  const id = event.pathParameters?.human ?? "";
  const human = await findActor(deployment.table, id);
  if (human?.kind !== "human") return refusal(404, `There is no human ${JSON.stringify(id)}. List the humans to find their ID.`);
  const to = await recoveryAddressOf(deployment.table, human.id);
  if (to === undefined) return refusal(409, `${human.email} has no recovery address, so Duva has nowhere to mail a link. They add one in Settings.`);
  try {
    return { statusCode: 200, body: await mailSignInLink(deployment, human, to) };
  } catch (error) {
    if (!(error instanceof Refused)) throw error;
    return refusedLink(to, error);
  }
};

export const changeRecoveryAddress: OperationHandler = async (event, deployment, actor) => {
  if (actor?.kind !== "human") return refusal(403, "Only humans have a recovery address, and each changes their own in Settings.");
  const given = await recoveryAddressGiven(deployment.table, jsonBody(event)?.address, "address");
  if ("statusCode" in given) return given;
  if ((await countUp(deployment.table, limitKey("recoveryChanges", actor.id, Date.now()))) > changesPerHuman) {
    return refusal(429, `Duva mailed ${changesPerHuman} new recovery addresses of yours in the last 10 minutes. Follow the link in one, or wait 10 minutes.`);
  }
  const { token, expiresAt } = await newToken(deployment.table, changeKey, { human: actor.id, address: given.address });
  try {
    await mailFromDuva(deployment, {
      to: given.address,
      subject: "Confirm your recovery address",
      text:
        `Follow this link to make this address the recovery address of ${actor.email}, where Duva mails sign-in links:\n\n` +
        `${deployment.webUrl}/${recoveryLinkRoute}${token}\n\nIt works once, for 30 minutes. If you didn't ask for it, you can ignore it.`,
    });
  } catch (error) {
    if (!(error instanceof Refused)) throw error;
    return refusedLink(given.address, error);
  }
  return { statusCode: 202, body: { to: given.address, expiresAt } satisfies LinkMailed };
};

export const confirmRecoveryAddress: OperationHandler = async (event, deployment) => {
  const token = jsonBody(event)?.token;
  if (typeof token !== "string" || token === "") return refusal(400, `Give token as the end of the link, after ${recoveryLinkRoute}.`);
  const expired = refusal(404, "This link has expired or was used. Change your recovery address in Settings again.");
  let change: Record<string, unknown> | undefined;
  try {
    ({ Attributes: change } = await documents(deployment.table).send(
      new DeleteCommand({
        TableName: deployment.table.name,
        Key: changeKey(hashed(token)),
        ConditionExpression: "expiresAt > :now",
        ExpressionAttributeValues: { ":now": new Date().toISOString() },
        ReturnValues: "ALL_OLD",
      }),
    ));
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) return expired;
    throw error;
  }
  // A human removed meanwhile has no recovery address to change.
  if (change === undefined || (await findActor(deployment.table, change.human as string))?.kind !== "human") return expired;
  await keepRecoveryAddress(deployment.table, change.human as string, change.address as string);
  return { statusCode: 200, body: { address: change.address as string } satisfies components["schemas"]["RecoveryAddress"] };
};

