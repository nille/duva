import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** What the CLI remembers between runs, in $XDG_CONFIG_HOME/duva/config.json. */
export interface Config {
  /** The URL of the deployment's API. duva deploy saves it. */
  apiUrl?: string;
}

function configPath(): string {
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "duva", "config.json");
}

export async function readConfig(): Promise<Config> {
  try {
    return JSON.parse(await readFile(configPath(), "utf8")) as Config;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

export async function saveConfig(changes: Config): Promise<void> {
  const config = { ...(await readConfig()), ...changes };
  await mkdir(dirname(configPath()), { recursive: true });
  await writeFile(configPath(), `${JSON.stringify(config, null, 2)}\n`);
}
