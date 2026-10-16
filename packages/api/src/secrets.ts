// Each human's secrets, which their Coo uses but never reads (ADR-0039, #162): a site's login, with
// a one-time-code seed if it has one, a payment card, or any other value. They sit in the human's
// partition, so they go with the human, each value sealed with the stack's own KMS key under an
// encryption context naming the human and the secret, so a sealed value moved to another item
// doesn't open. Only the human reads a secret's name, kind and last four characters, and reveals a
// value again only with a sign-in code just mailed to them. Coo's browsing run has a part typed
// into a page through the browser, outside its model (secret-uses.ts), and every use is listed in
// the secret's history. A card pays only on the sites its human names for it (#171), by the
// address the browser reports for the page, so a look-alike page never gets it.
import { createHmac, randomUUID } from "node:crypto";
import { ConditionalCheckFailedException, TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { DeleteCommand, GetCommand, PutCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { components } from "@duva/openapi";
import { getDomain } from "tldts";
import type { Table } from "./deployment.ts";
import { timeToLiveAttribute } from "./infrastructure.ts";
import type { RunPayload } from "./agent-loop.ts";
import { jsonBody, type OperationHandler, refusal } from "./operation-handler.ts";
import { actorKey, type Actor, type Human } from "./organization.ts";
import { allItems, documents, isNew, pk, sk, type TransactItem } from "./table.ts";

export type Secret = components["schemas"]["Secret"];
export type SecretKind = components["schemas"]["SecretKind"];
export type SecretPartName = components["schemas"]["SecretPartName"];
export type SecretRun = components["schemas"]["SecretRun"];
type SecretUseEntry = components["schemas"]["SecretUseEntry"];

/** Seals and opens secrets' values: with the stack's KMS key in a deployment, a stand-in in tests. */
export interface SecretKeys {
  /** The value sealed, bound to the context, which opening must give again. */
  seal(value: string, context: Record<string, string>): Promise<string>;
  open(sealed: string, context: Record<string, string>): Promise<string>;
}

/** The most secrets a human keeps, and the most uses a secret's history lists. */
const secretsKept = 100;
const usesListed = 500;
const longestName = 60;
const longestPart = 1000;
/** The most sites a card names. */
const sitesNamed = 20;
/** How long a sign-in code mailed for a reveal works, as long as Cognito's sign-in session lasts by default. */
const revealWithin = 3 * 60_000;

const secretPrefix = "secret#";
export const secretKey = (human: string, secret: string) => ({ [pk]: actorKey(human)[pk]!, [sk]: `${secretPrefix}${secret}` });
// Each name is taken once per human, case aside.
const nameKey = (human: string, name: string) => ({ [pk]: actorKey(human)[pk]!, [sk]: `secret-name#${name.toLowerCase()}` });
const usePrefix = (secret: string) => `secret-use#${secret}#`;
export const useKey = (human: string, secret: string, at: string) => ({ [pk]: actorKey(human)[pk]!, [sk]: `${usePrefix(secret)}${at}#${randomUUID()}` });
const revealKey = (human: string, secret: string) => ({ [pk]: actorKey(human)[pk]!, [sk]: `secret-reveal#${secret}` });

/** A login's one-time-code seed, as RFC 6238 takes it. */
interface Seed {
  key: string;
  digits: number;
  period: number;
  algorithm: "sha1" | "sha256" | "sha512";
}

/** A secret's parts, as sealed together. */
export interface Parts {
  username?: string;
  password?: string;
  seed?: Seed;
  number?: string;
  expiry?: string;
  cvc?: string;
  cardholder?: string;
  value?: string;
}

/** A card's limits, in hundredths of their currency. */
export interface Limits {
  currency: string;
  perPayment: number;
  perMonth: number;
}

/** A secret as stored: what its human sees of it, and its parts, sealed. */
export interface StoredSecret {
  id: string;
  human: string;
  name: string;
  kind: SecretKind;
  lastFour: string;
  oneTimeCodes?: true;
  limits?: Limits;
  /** A card's sites, each a host it pays on with its subdomains. */
  sites?: string[];
  addedAt: string;
  changedAt?: string;
  sealed: string;
}

/** The parts each kind has, which a page may be given. */
export const partsOf: Record<SecretKind, SecretPartName[]> = {
  login: ["username", "password", "code"],
  card: ["number", "expiry", "expiryMonth", "expiryYear", "cvc", "cardholder"],
  other: ["value"],
};

/** The fields each kind is given in, as the API takes them. */
const fieldsOf: Record<SecretKind, (keyof Parts | "totpSeed")[]> = {
  login: ["username", "password", "totpSeed"],
  card: ["number", "expiry", "cvc", "cardholder"],
  other: ["value"],
};
const limitFields = ["currency", "perPayment", "perMonth"] as const;

const contextOf = ({ human, id }: Pick<StoredSecret, "human" | "id">) => ({ human, secret: id });

export const sealParts = (keys: SecretKeys, secret: Pick<StoredSecret, "human" | "id">, parts: Parts) => keys.seal(JSON.stringify(parts), contextOf(secret));
export const openParts = async (keys: SecretKeys, secret: StoredSecret): Promise<Parts> => JSON.parse(await keys.open(secret.sealed, contextOf(secret))) as Parts;

/** An amount of money as the API writes it, from hundredths: 4990 as 49.90. */
export const amountOf = (hundredths: number) => `${Math.floor(hundredths / 100)}.${String(hundredths % 100).padStart(2, "0")}`;
/** An amount the API was given, in hundredths, or undefined if it isn't one. */
export function hundredthsOf(amount: unknown): number | undefined {
  if (typeof amount !== "string" || !/^[0-9]{1,9}([.][0-9]{1,2})?$/.test(amount)) return undefined;
  const [whole, fraction = ""] = amount.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}
export const isCurrency = (value: unknown): value is string => typeof value === "string" && /^[A-Z]{3}$/.test(value);

/** The last four characters a secret shows, of a value long enough to keep the rest unknown. */
const lastFourOf = (value: string) => (value.length > 4 ? value.slice(-4) : "");

/** What the secret's human sees of it, with what its card paid this month. */
export function secretOf({ id, name, kind, lastFour, oneTimeCodes, limits, sites, addedAt, changedAt }: StoredSecret, spentThisMonth = 0): Secret {
  return {
    id,
    name,
    kind,
    lastFour,
    ...(oneTimeCodes && { oneTimeCodes }),
    ...(limits !== undefined && {
      limits: { currency: limits.currency, perPayment: amountOf(limits.perPayment), perMonth: amountOf(limits.perMonth), spentThisMonth: amountOf(spentThisMonth) },
    }),
    ...(kind === "card" && { sites: [...new Set(sites ?? [])] }),
    addedAt,
    ...(changedAt !== undefined && { changedAt }),
  };
}

/** The human's secrets, by name. */
export async function storedSecrets(table: Table, human: string): Promise<StoredSecret[]> {
  const items = (await allItems(table, {
    KeyConditionExpression: `${pk} = :human AND begins_with(${sk}, :secret)`,
    ExpressionAttributeValues: { ":human": actorKey(human)[pk], ":secret": secretPrefix },
  })) as unknown as StoredSecret[];
  return items.sort((a, b) => a.name.localeCompare(b.name));
}

export async function findSecret(table: Table, human: string, secret: string): Promise<StoredSecret | undefined> {
  const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: secretKey(human, secret), ConsistentRead: true }));
  return Item as StoredSecret | undefined;
}

/** The item that records a use of the secret in its history. */
export const useItem = (table: Table, secret: Pick<StoredSecret, "human" | "id">, entry: SecretUseEntry): TransactItem => ({
  Put: { TableName: table.name, Item: { ...useKey(secret.human, secret.id, entry.at), ...entry } },
});

/** Records a use of the secret in its history. */
export async function recordUse(table: Table, secret: Pick<StoredSecret, "human" | "id">, entry: SecretUseEntry): Promise<void> {
  await documents(table).send(new PutCommand(useItem(table, secret, entry).Put!));
}

/** The secret's history, newest first. */
async function usesOf(table: Table, secret: StoredSecret): Promise<SecretUseEntry[]> {
  const items = await allItems(table, {
    KeyConditionExpression: `${pk} = :human AND begins_with(${sk}, :uses)`,
    ExpressionAttributeValues: { ":human": actorKey(secret.human)[pk], ":uses": usePrefix(secret.id) },
    ScanIndexForward: false,
  });
  return items.slice(0, usesListed).map(({ [pk]: _, [sk]: __, ...entry }) => entry as SecretUseEntry);
}

/**
 * The one-time code the seed gives at the instant, as RFC 6238 has it: an HMAC of the count of
 * periods since 1970, truncated to its digits.
 */
export function oneTimeCode({ key, digits, period, algorithm }: Seed, at = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / period)));
  const hash = createHmac(algorithm, base32Bytes(key)).update(counter).digest();
  const offset = hash[hash.length - 1]! & 0xf;
  const code = (hash.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return String(code).padStart(digits, "0");
}

const base32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32Bytes(key: string): Buffer {
  let bits = "";
  for (const letter of key) bits += base32.indexOf(letter).toString(2).padStart(5, "0");
  return Buffer.from((bits.match(/.{8}/g) ?? []).map((byte) => parseInt(byte, 2)));
}

/** The seed given: a base32 key, as sites show it, spaced or not, or the otpauth:// URI their QR code holds. */
function seedOf(given: string): Seed | undefined {
  let key = given;
  let [digits, period, algorithm] = [6, 30, "sha1"];
  if (/^otpauth:\/\//i.test(given)) {
    if (!URL.canParse(given)) return undefined;
    const { searchParams } = new URL(given);
    key = searchParams.get("secret") ?? "";
    digits = Number(searchParams.get("digits") ?? 6);
    period = Number(searchParams.get("period") ?? 30);
    algorithm = (searchParams.get("algorithm") ?? "SHA1").toLowerCase();
  }
  key = key.replace(/[\s-]/g, "").replace(/=+$/, "").toUpperCase();
  if (!/^[A-Z2-7]{16,}$/.test(key) || ![6, 7, 8].includes(digits) || !(period >= 15 && period <= 120) || !["sha1", "sha256", "sha512"].includes(algorithm)) return undefined;
  return { key, digits, period, algorithm: algorithm as Seed["algorithm"] };
}

/** Whether the digits pass the Luhn check every card number passes. */
function luhn(digits: string): boolean {
  let sum = 0;
  for (const [index, digit] of [...digits].reverse().entries()) {
    const doubled = index % 2 === 1 ? Number(digit) * 2 : Number(digit);
    sum += doubled > 9 ? doubled - 9 : doubled;
  }
  return sum % 10 === 0;
}

/** A card's expiry as MM/YY, from MM/YY or MM/YYYY, or undefined if it is neither. */
function expiryOf(given: string): string | undefined {
  const match = /^(0[1-9]|1[0-2])\s*\/\s*(?:20)?([0-9]{2})$/.exec(given.trim());
  return match === null ? undefined : `${match[1]}/${match[2]}`;
}

/** The parts of the kind the body gives, merged into those it had, or why they don't do. */
function partsIn(kind: SecretKind, body: Record<string, unknown>, had: Parts = {}): { parts: Parts } | { refused: string } {
  const parts: Parts = { ...had };
  const kindName = { login: "A login", card: "A card", other: "Another value" }[kind];
  const foreign = Object.values(fieldsOf)
    .flat()
    .find((field) => body[field] !== undefined && !fieldsOf[kind].includes(field));
  if (foreign !== undefined) return { refused: `${kindName} has no ${foreign}. Give ${fieldsOf[kind].join(", ")}.` };
  for (const field of fieldsOf[kind]) {
    const given = body[field];
    if (given === undefined) continue;
    if (field === "totpSeed") {
      if (given === null) {
        delete parts.seed;
        continue;
      }
      const seed = typeof given === "string" ? seedOf(given.trim()) : undefined;
      if (seed === undefined) return { refused: "Give totpSeed as the base32 key or the otpauth:// URI the site's setup shows." };
      parts.seed = seed;
      continue;
    }
    if (typeof given !== "string" || given.trim() === "" || given.length > longestPart) return { refused: `Give ${field} as text, at most ${longestPart} characters.` };
    const value = field === "password" || field === "value" ? given : given.trim();
    if (field === "number") {
      const digits = value.replace(/[\s-]/g, "");
      if (!/^[0-9]{12,19}$/.test(digits) || !luhn(digits)) return { refused: "Give number as the card's number, 12 to 19 digits." };
      parts.number = digits;
    } else if (field === "expiry") {
      const expiry = expiryOf(value);
      if (expiry === undefined) return { refused: "Give expiry as MM/YY, as on the card." };
      parts.expiry = expiry;
    } else if (field === "cvc") {
      if (!/^[0-9]{3,4}$/.test(value)) return { refused: "Give cvc as the card's security code, three or four digits." };
      parts.cvc = value;
    } else parts[field as "username" | "password" | "cardholder" | "value"] = value;
  }
  const missing = { login: ["username", "password"], card: ["number", "expiry", "cvc"], other: ["value"] }[kind].find((part) => parts[part as keyof Parts] === undefined);
  if (missing !== undefined) return { refused: `${kindName} needs its ${missing}. Give ${fieldsOf[kind].join(", ")}.` };
  return { parts };
}

/** The card limits the body gives: set, cleared, unchanged, or why they don't do. */
function limitsIn(kind: SecretKind, body: Record<string, unknown>): { limits: Limits | null | undefined } | { refused: string } {
  const given = limitFields.filter((field) => body[field] !== undefined);
  if (given.length === 0) return { limits: undefined };
  if (kind !== "card") return { refused: "Only a card has limits." };
  const both = "Give currency, perPayment and perMonth together, as SEK, 500.00 and 2000.00, or null for each to clear the limits.";
  if (given.length !== limitFields.length) return { refused: both };
  if (limitFields.every((field) => body[field] === null)) return { limits: null };
  const [perPayment, perMonth] = [hundredthsOf(body.perPayment), hundredthsOf(body.perMonth)];
  if (!isCurrency(body.currency) || perPayment === undefined || perMonth === undefined) return { refused: both };
  if (perPayment === 0 || perMonth < perPayment) return { refused: "Give perPayment above 0, and perMonth at least as much as perPayment." };
  return { limits: { currency: body.currency, perPayment, perMonth } };
}

/**
 * The site a card is given to pay on, as the host it names, from a domain or a page's address there,
 * or undefined if it is neither, or is an ending anyone's site is under, as co.uk or github.io.
 */
export function siteIn(given: string): string | undefined {
  const trimmed = given.trim().toLowerCase();
  const url = /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
  if (trimmed === "" || !URL.canParse(url)) return undefined;
  const host = new URL(url).hostname.replace(/\.$/, "");
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) return undefined;
  return getDomain(host, { allowPrivateDomains: true }) === null ? undefined : host;
}

/** Whether the card pays on the host, as the browser reports a page's: one of its sites, or under one. */
export const paysOn = (card: Pick<StoredSecret, "sites">, host: string) => {
  const bare = host.toLowerCase().replace(/\.$/, "");
  return (card.sites ?? []).some((site) => bare === site || bare.endsWith(`.${site}`));
};

const notASite = (given: unknown) => `${JSON.stringify(given)} isn't a site a card can pay on. Give each as its domain, as sj.se. An ending anyone's site is under, as co.uk, isn't one.`;
const onlyCards = "Only a card names the sites it pays on. Leave sites out for a login or another value.";

/** The sites the body gives a card it adds, or why they don't do. */
function sitesIn(kind: SecretKind, body: Record<string, unknown>): { sites?: string[] } | { refused: string } {
  const given = body.sites;
  if (given === undefined) return {};
  if (kind !== "card") return { refused: onlyCards };
  if (!Array.isArray(given) || given.length > sitesNamed) return { refused: `Give sites as a list of at most ${sitesNamed}, each as its domain, as sj.se.` };
  const sites: string[] = [];
  for (const each of given) {
    const site = typeof each === "string" ? siteIn(each) : undefined;
    if (site === undefined) return { refused: notASite(each) };
    if (!sites.includes(site)) sites.push(site);
  }
  return sites.length === 0 ? {} : { sites };
}

const lastFourOfParts = (kind: SecretKind, parts: Parts) => lastFourOf({ login: parts.username, card: parts.number, other: parts.value }[kind] ?? "");

const nameIn = (body: Record<string, unknown>) => (typeof body.name === "string" ? body.name.trim() : undefined);
const nameRefused = () => refusal(400, `Give name as what to call the secret, at most ${longestName} characters.`);
const nameTaken = (name: string) => refusal(409, `You have a secret called ${name} already. Give this one another name.`);
const kinds: SecretKind[] = ["login", "card", "other"];

/** Only humans have secrets, and each reads only their own. */
export const othersRefused = () => refusal(403, "Only humans keep secrets, and each sees only their own. Your Coo uses its human's while it browses, without reading them.");
const humanOf = (actor: Actor | undefined): Human | undefined => (actor?.kind === "human" ? actor : undefined);

/** The secret the call's path names, of the human's own, or a refusal. */
async function secretAsked(event: Parameters<OperationHandler>[0], table: Table, human: Human): Promise<StoredSecret | ReturnType<typeof refusal>> {
  const found = await findSecret(table, human.id, event.pathParameters?.secret ?? "");
  return found ?? refusal(404, "You have no such secret. List your secrets to find its ID.");
}

/** What the card paid in the month, in hundredths of its limits' currency. */
export const monthKey = (human: string, secret: string, month: string) => ({ [pk]: actorKey(human)[pk]!, [sk]: `card-month#${secret}#${month}` });
export const thisMonth = () => new Date().toISOString().slice(0, 7);
export async function spentIn(table: Table, secret: Pick<StoredSecret, "human" | "id">, month = thisMonth()): Promise<number> {
  const { Item } = await documents(table).send(new GetCommand({ TableName: table.name, Key: monthKey(secret.human, secret.id, month), ConsistentRead: true }));
  return (Item?.spent as number | undefined) ?? 0;
}

const secretShown = async (table: Table, secret: StoredSecret) => secretOf(secret, secret.limits === undefined ? 0 : await spentIn(table, secret));

export const listSecrets: OperationHandler = async (_event, { table }, actor) => {
  const human = humanOf(actor);
  if (human === undefined) return othersRefused();
  const secrets = await Promise.all((await storedSecrets(table, human.id)).map((secret) => secretShown(table, secret)));
  return { statusCode: 200, body: { secrets } satisfies components["schemas"]["SecretList"] };
};

export const addSecret: OperationHandler = async (event, { table, secretKeys }, actor) => {
  const human = humanOf(actor);
  if (human === undefined) return othersRefused();
  const body = jsonBody(event) ?? {};
  const kind = body.kind as SecretKind;
  if (!kinds.includes(kind)) return refusal(400, "Give kind as login, card or other.");
  const name = nameIn(body);
  if (name === undefined || name === "" || name.length > longestName) return nameRefused();
  const given = partsIn(kind, body);
  if ("refused" in given) return refusal(400, given.refused);
  const limited = limitsIn(kind, body);
  if ("refused" in limited) return refusal(400, limited.refused);
  const sited = sitesIn(kind, body);
  if ("refused" in sited) return refusal(400, sited.refused);
  if ((await storedSecrets(table, human.id)).length >= secretsKept) return refusal(409, `You keep ${secretsKept} secrets, the most there can be. Delete one you no longer need first.`);
  const id = randomUUID();
  const stored: StoredSecret = {
    id,
    human: human.id,
    name,
    kind,
    lastFour: lastFourOfParts(kind, given.parts),
    ...(given.parts.seed !== undefined && { oneTimeCodes: true }),
    ...(limited.limits && { limits: limited.limits }),
    ...(sited.sites && { sites: sited.sites }),
    addedAt: new Date().toISOString(),
    sealed: await sealParts(secretKeys, { human: human.id, id }, given.parts),
  };
  try {
    await documents(table).send(
      new TransactWriteCommand({
        TransactItems: [
          { Put: { TableName: table.name, Item: { ...nameKey(human.id, name), secret: id }, ...isNew } },
          { Put: { TableName: table.name, Item: { ...secretKey(human.id, id), ...stored }, ...isNew } },
        ],
      }),
    );
  } catch (error) {
    if (error instanceof TransactionCanceledException && error.CancellationReasons?.[0]?.Code === "ConditionalCheckFailed") return nameTaken(name);
    throw error;
  }
  return { statusCode: 201, body: secretOf(stored) satisfies Secret };
};

export const getSecret: OperationHandler = async (event, { table }, actor) => {
  const human = humanOf(actor);
  if (human === undefined) return othersRefused();
  const secret = await secretAsked(event, table, human);
  if ("statusCode" in secret) return secret;
  return { statusCode: 200, body: { ...(await secretShown(table, secret)), uses: await usesOf(table, secret) } satisfies components["schemas"]["SecretWithHistory"] };
};

export const changeSecret: OperationHandler = async (event, { table, secretKeys }, actor) => {
  const human = humanOf(actor);
  if (human === undefined) return othersRefused();
  const secret = await secretAsked(event, table, human);
  if ("statusCode" in secret) return secret;
  const body = jsonBody(event) ?? {};
  const known = ["name", ...Object.values(fieldsOf).flat(), ...limitFields];
  const unknown = Object.keys(body).find((field) => !known.includes(field));
  if (unknown !== undefined) return refusal(400, `A secret has no ${unknown}. Give name, its kind's parts, or a card's limits. A card's sites are added and removed on their own.`);
  if (Object.keys(body).length === 0) return refusal(400, "Give name to rename it, its kind's parts to replace them, or a card's limits.");
  const name = nameIn(body);
  if (name !== undefined && (name === "" || name.length > longestName)) return nameRefused();
  const replacing = Object.values(fieldsOf)
    .flat()
    .some((field) => body[field] !== undefined);
  let parts: Parts | undefined;
  if (replacing) {
    const given = partsIn(secret.kind, body, await openParts(secretKeys, secret));
    if ("refused" in given) return refusal(400, given.refused);
    parts = given.parts;
  }
  const limited = limitsIn(secret.kind, body);
  if ("refused" in limited) return refusal(400, limited.refused);
  const renamed = name !== undefined && name !== secret.name;
  // Limits given as null are cleared, and those not given stay.
  const { limits: _, ...bare } = secret;
  const limits = limited.limits === undefined ? secret.limits : (limited.limits ?? undefined);
  const changed: StoredSecret = {
    ...bare,
    ...(limits !== undefined && { limits }),
    ...(renamed && { name }),
    ...(parts !== undefined && {
      lastFour: lastFourOfParts(secret.kind, parts),
      sealed: await sealParts(secretKeys, secret, parts),
    }),
    changedAt: new Date().toISOString(),
  };
  if (parts !== undefined) {
    if (parts.seed === undefined) delete changed.oneTimeCodes;
    else changed.oneTimeCodes = true;
  }
  try {
    await documents(table).send(
      new TransactWriteCommand({
        TransactItems: [
          // It changes only as it was read, so two changes at once never mix, nor does a site an approval added meanwhile go.
          {
            Put: {
              TableName: table.name,
              Item: { ...secretKey(human.id, secret.id), ...changed },
              ConditionExpression: `sealed = :sealed AND #name = :name AND ${secret.changedAt === undefined ? "attribute_not_exists(changedAt)" : "changedAt = :changedAt"}`,
              ExpressionAttributeNames: { "#name": "name" },
              ExpressionAttributeValues: { ":sealed": secret.sealed, ":name": secret.name, ...(secret.changedAt !== undefined && { ":changedAt": secret.changedAt }) },
            },
          },
          ...(renamed
            ? [
                { Put: { TableName: table.name, Item: { ...nameKey(human.id, name!), secret: secret.id }, ...isNew } },
                ...(name!.toLowerCase() === secret.name.toLowerCase() ? [] : [{ Delete: { TableName: table.name, Key: nameKey(human.id, secret.name) } }]),
              ]
            : []),
        ],
      }),
    );
  } catch (error) {
    const reasons = error instanceof TransactionCanceledException ? (error.CancellationReasons ?? []) : [];
    if (reasons[1]?.Code === "ConditionalCheckFailed") return nameTaken(name!);
    if (reasons[0]?.Code === "ConditionalCheckFailed") return refusal(409, "The secret changed meanwhile. Read it again, then change it.");
    throw error;
  }
  return { statusCode: 200, body: (await secretShown(table, changed)) satisfies Secret };
};

/** The card the call's path names, of the human's own, or a refusal. */
async function cardAsked(event: Parameters<OperationHandler>[0], table: Table, actor: Actor | undefined): Promise<StoredSecret | ReturnType<typeof refusal>> {
  const human = humanOf(actor);
  if (human === undefined) return othersRefused();
  const secret = await secretAsked(event, table, human);
  if ("statusCode" in secret) return secret;
  return secret.kind === "card" ? secret : refusal(400, onlyCards);
}

/** Adds a site the card pays on, after those it names, unless it names it already. */
export const addCardSite: OperationHandler = async (event, { table }, actor) => {
  const card = await cardAsked(event, table, actor);
  if ("statusCode" in card) return card;
  const given = (jsonBody(event) ?? {}).site;
  const site = typeof given === "string" ? siteIn(given) : undefined;
  if (site === undefined) return refusal(400, notASite(given));
  if ((card.sites ?? []).includes(site)) return { statusCode: 200, body: (await secretShown(table, card)) satisfies Secret };
  if ((card.sites ?? []).length >= sitesNamed) return refusal(409, `${card.name} names ${sitesNamed} sites, the most a card can. Remove one it no longer needs first.`);
  try {
    // Appended where it stands, so a site an approval added meanwhile stays.
    const { Attributes } = await documents(table).send(
      new UpdateCommand({
        TableName: table.name,
        Key: secretKey(card.human, card.id),
        UpdateExpression: "SET sites = list_append(if_not_exists(sites, :none), :site), changedAt = :at",
        ConditionExpression: `attribute_exists(${pk}) AND (attribute_not_exists(sites) OR NOT contains(sites, :one))`,
        ExpressionAttributeValues: { ":none": [], ":site": [site], ":one": site, ":at": new Date().toISOString() },
        ReturnValues: "ALL_NEW",
      }),
    );
    return { statusCode: 200, body: (await secretShown(table, Attributes as StoredSecret)) satisfies Secret };
  } catch (error) {
    if (!(error instanceof ConditionalCheckFailedException)) throw error;
    // Added meanwhile, or the card deleted.
    const now = await findSecret(table, card.human, card.id);
    return now === undefined ? refusal(404, "You have no such secret. List your secrets to find its ID.") : { statusCode: 200, body: (await secretShown(table, now)) satisfies Secret };
  }
};

/** Removes a site the card pays on, each time it names it, unless it names it no more. */
export const removeCardSite: OperationHandler = async (event, { table }, actor) => {
  let card = await cardAsked(event, table, actor);
  if ("statusCode" in card) return card;
  const site = (event.pathParameters?.site ?? "").trim().toLowerCase();
  // Removed where it stands, so a site an approval added meanwhile stays, trying again if the list moved.
  for (let tries = 0; tries < 3; tries++) {
    const at = (card.sites ?? []).flatMap((each, index) => (each === site ? [index] : []));
    if (at.length === 0) break;
    try {
      const { Attributes } = await documents(table).send(
        new UpdateCommand({
          TableName: table.name,
          Key: secretKey(card.human, card.id),
          UpdateExpression: `REMOVE ${at.map((index) => `sites[${index}]`).join(", ")} SET changedAt = :at`,
          ConditionExpression: at.map((index) => `sites[${index}] = :site`).join(" AND "),
          ExpressionAttributeValues: { ":site": site, ":at": new Date().toISOString() },
          ReturnValues: "ALL_NEW",
        }),
      );
      return { statusCode: 200, body: (await secretShown(table, Attributes as StoredSecret)) satisfies Secret };
    } catch (error) {
      if (!(error instanceof ConditionalCheckFailedException)) throw error;
      const now = await findSecret(table, card.human, card.id);
      if (now === undefined) return refusal(404, "You have no such secret. List your secrets to find its ID.");
      card = now;
    }
  }
  return { statusCode: 200, body: (await secretShown(table, card)) satisfies Secret };
};

/** The items that go with a secret: its name, its history and its card's months. */
async function itemsOf(table: Table, secret: StoredSecret) {
  const under = (prefix: string) =>
    allItems(table, {
      KeyConditionExpression: `${pk} = :human AND begins_with(${sk}, :prefix)`,
      ExpressionAttributeValues: { ":human": actorKey(secret.human)[pk], ":prefix": prefix },
      ProjectionExpression: `${pk}, ${sk}`,
    });
  return [...(await under(usePrefix(secret.id))), ...(await under(`card-month#${secret.id}#`)), ...(await under(`secret-reveal#${secret.id}`))];
}

/**
 * Deletes the secret with its name and history, and with `alsoDelete` the items that go with it
 * elsewhere, as its card's payments waiting for approval.
 */
export async function deleteStoredSecret(table: Table, secret: StoredSecret, alsoDelete: Record<string, unknown>[] = []): Promise<void> {
  await documents(table).send(
    new TransactWriteCommand({
      TransactItems: [
        { Delete: { TableName: table.name, Key: secretKey(secret.human, secret.id), ConditionExpression: `attribute_exists(${pk})` } },
        { Delete: { TableName: table.name, Key: nameKey(secret.human, secret.name) } },
      ],
    }),
  );
  for (const item of [...(await itemsOf(table, secret)), ...alsoDelete]) {
    await documents(table).send(new DeleteCommand({ TableName: table.name, Key: { [pk]: item[pk], [sk]: item[sk] } }));
  }
}

export const revealSecret: OperationHandler = async (event, { table, secretKeys, humans }, actor) => {
  const human = humanOf(actor);
  if (human === undefined) return othersRefused();
  const secret = await secretAsked(event, table, human);
  if ("statusCode" in secret) return secret;
  const code = (jsonBody(event) ?? {}).code;
  if (code === undefined) {
    const session = await humans.sendSignInCode(human.email);
    const until = Date.now() + revealWithin;
    await documents(table).send(new PutCommand({ TableName: table.name, Item: { ...revealKey(human.id, secret.id), session, until, [timeToLiveAttribute]: Math.ceil(until / 1000) } }));
    return { statusCode: 202, body: { sentTo: human.email } satisfies components["schemas"]["RevealCodeSent"] };
  }
  if (typeof code !== "string" || code.trim() === "") return refusal(400, "Give code as the sign-in code Duva mailed you, or leave it out to have one mailed.");
  // A code is tried once, so a guess costs a new code.
  const { Attributes: asked } = await documents(table).send(new DeleteCommand({ TableName: table.name, Key: revealKey(human.id, secret.id), ReturnValues: "ALL_OLD" }));
  if (asked === undefined || (asked.until as number) <= Date.now()) return refusal(409, "Ask for a sign-in code first: reveal the secret without code, then give the code Duva mails you within three minutes.");
  if (!(await humans.checkSignInCode(human.email, asked.session as string, code.trim()))) return refusal(403, "That isn't the code Duva mailed you, or it expired. Ask for a new one.");
  const parts = await openParts(secretKeys, secret);
  await recordUse(table, secret, { at: new Date().toISOString(), kind: "revealed" });
  const { seed, ...rest } = parts;
  return {
    statusCode: 200,
    body: { id: secret.id, name: secret.name, kind: secret.kind, ...rest, ...(seed !== undefined && { totpSeed: seed.key }) } satisfies components["schemas"]["RevealedSecret"],
  };
};

/** The part of the secret's parts a page is given, the one-time code computed now. */
export function partIn(parts: Parts, part: SecretPartName): string | undefined {
  if (part === "code") return parts.seed === undefined ? undefined : oneTimeCode(parts.seed);
  if (part === "expiryMonth") return parts.expiry?.slice(0, 2);
  if (part === "expiryYear") return parts.expiry === undefined ? undefined : `20${parts.expiry.slice(3)}`;
  return parts[part as Exclude<SecretPartName, "code" | "expiryMonth" | "expiryYear">];
}

/** What a run's payload names of the human's secrets, for Coo to choose from: each one's ID, name and kind, whether a login has codes, and the sites a card pays on (#188). */
export async function secretsForRun(table: Table, human: string): Promise<NonNullable<RunPayload["secrets"]>> {
  return (await storedSecrets(table, human)).map(({ id, name, kind, oneTimeCodes, sites }) => ({ id, name, kind, ...(oneTimeCodes && { codes: oneTimeCodes }), ...(kind === "card" && { sites: sites ?? [] }) }));
}
