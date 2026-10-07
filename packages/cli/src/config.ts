import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Session, SignInConfig } from "@duva/client/sign-in";

/** What the CLI remembers between runs, in $XDG_CONFIG_HOME/duva/config.json. */
export interface Config {
  /** The URL of the deployment's API. duva deploy saves it. */
  apiUrl?: string;
  /** The URL of the deployment's web app. duva deploy saves it. */
  webUrl?: string;
  /** How the CLI signs a human in. duva deploy saves it. */
  signIn?: SignInConfig;
}

const directory = () => join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "duva");
const configPath = () => join(directory(), "config.json");
/** The signed-in human's session, or the agent's key, apart from the config, readable only by its owner. */
const sessionPath = () => join(directory(), "session.json");

export async function readConfig(): Promise<Config> {
  return (await readJson<Config>(configPath())) ?? {};
}

export async function saveConfig(changes: Config): Promise<void> {
  await writeJson(configPath(), { ...(await readConfig()), ...changes }, 0o644);
}

/** What the session file keeps: the signed-in human's session, or the key of the agent that logged in. */
type SignedIn = Session | { agentKey: string };

/** The session duva login saved, or undefined if no human has signed in. */
export async function readSession(): Promise<Session | undefined> {
  const signedIn = await readJson<SignedIn>(sessionPath());
  return signedIn === undefined || "agentKey" in signedIn ? undefined : signedIn;
}

export async function saveSession(session: Session): Promise<void> {
  await writeJson(sessionPath(), session, 0o600);
}

/** The key duva login --agent saved, or undefined if no agent has logged in. */
export async function readAgentKey(): Promise<string | undefined> {
  const signedIn = await readJson<SignedIn>(sessionPath());
  return signedIn !== undefined && "agentKey" in signedIn ? signedIn.agentKey : undefined;
}

/** Saves the agent's key in place of any session, so the CLI acts as that agent from then on. */
export async function saveAgentKey(agentKey: string): Promise<void> {
  await writeJson(sessionPath(), { agentKey }, 0o600);
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function writeJson(path: string, value: unknown, mode: number) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode });
}
