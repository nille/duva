import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { hostname } from "node:os";
import { createDuvaClient } from "@duva/client";
import { finishSignIn, type Session, type SignInConfig, startSignIn } from "@duva/client/sign-in";
import { agentKeyVariable, callApi } from "./api-commands.ts";
import { type Command, optionValues } from "./commands.ts";
import { readConfig, readSession, saveAgentKey, saveSession } from "./config.ts";

/** How long login waits for the browser to come back. */
const timeout = 5 * 60_000;

export const login: Command = {
  words: ["login"],
  summary: "Sign in as a human through the browser, or with --agent ask a human for access as an agent.",
  description:
    "With --agent, the CLI prints a code and a link to the web app, and waits up to 10 minutes while the human who will be the agent's sponsor approves it there. Then it saves the agent's key, and every command acts as that agent.",
  options: [
    { name: "agent", required: false, type: "boolean", description: "Ask for access as a new agent instead of signing in as a human." },
    { name: "name", required: false, description: "With --agent, the agent's name. Without it, the agent is named for this computer." },
    { name: "mailbox", required: false, type: "strings", description: "With --agent, the address of a mailbox of the human's to ask for. Without it, the agent asks for all of theirs." },
    { name: "wants", required: false, description: "With --agent, the access to ask for: read, organize, draft or send. Read unless given." },
  ],
  async run(args) {
    const { agent, name, mailbox, wants } = optionValues(login, args);
    if (process.env[agentKeyVariable]) {
      throw new Error(`${agentKeyVariable} is set, so the CLI calls Duva as that agent, and an agent never signs in. Unset it to sign in or ask for access.`);
    }
    if (agent === true) {
      const key = await askForAccess({ name, mailboxes: mailbox, wants });
      // One actor is signed in at a time, so the agent's key takes the place of a human's session.
      if ((await readSession()) !== undefined) process.stderr.write("The human signed in here is signed out, and the CLI acts as the agent from now on. Run duva login to sign in again.\n");
      await saveAgentKey(key);
      return { signedIn: await callApi("whoami") };
    }
    if ([name, mailbox, wants].some((value) => value !== undefined)) throw new Error("--name, --mailbox and --wants go with --agent. Add --agent to ask for access as an agent.");
    const { signIn } = await readConfig();
    if (signIn === undefined) throw new Error("No Duva deployment is configured. Run duva deploy first.");
    await saveSession(await signInThroughBrowser(signIn));
    return { signedIn: await callApi("whoami") };
  },
};

/**
 * Asks a human for access as a new agent, shows the code and the link to approve it at, and waits
 * until they approve or decline it, or it expires. Returns the agent's key.
 */
async function askForAccess(asked: { name?: unknown; mailboxes?: unknown; wants?: unknown }): Promise<string> {
  const { apiUrl, webUrl } = await readConfig();
  if (apiUrl === undefined || webUrl === undefined) throw new Error("No Duva deployment is configured. Copy the CLI's config from a computer where someone ran duva deploy.");
  const client = createDuvaClient(apiUrl);
  const unreachable = (error: unknown) => {
    throw new Error(`Couldn't reach Duva at ${apiUrl}: ${error instanceof Error ? error.message : error}`);
  };
  const body = { host: hostname(), ...(asked as Record<string, string | string[] | undefined>) };
  const { data: started, error, response } = await client.POST("/access-requests", { body: body as never }).catch(unreachable);
  if (started === undefined) throw new Error(`Duva at ${apiUrl} answered ${response.status}: ${error?.message}`);
  const until = new Date(started.expiresAt).toLocaleTimeString();
  process.stderr.write(`To give this agent access, open ${webUrl}/#/access/${started.code} and approve the code ${started.code}. It works until ${until}.\n`);
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, started.interval * 1000));
    const { data, error, response } = await client.POST("/access-requests/collect", { body: { deviceCode: started.deviceCode } }).catch(unreachable);
    if (data !== undefined && "key" in data) return data.key;
    if (response.status !== 202) throw new Error(error?.message ?? `Duva at ${apiUrl} answered ${response.status}.`);
  }
}

/**
 * Signs in through managed login in the browser, which comes back to a loopback address the CLI
 * listens on. The CLI never sees the human's sign-in code.
 */
async function signInThroughBrowser(config: SignInConfig): Promise<Session> {
  const redirect = new URL(config.redirectUri);
  const pending = await startSignIn(config);
  const server = createServer();
  try {
    const session = new Promise<Session>((resolve, reject) => {
      setTimeout(() => reject(new Error("Sign-in timed out. Run duva login again.")), timeout).unref();
      server.on("request", (request, response) => {
        const url = new URL(request.url ?? "/", redirect);
        if (url.pathname !== redirect.pathname) {
          response.writeHead(404).end();
          return;
        }
        finishSignIn(config, pending, url).then(
          (session) => {
            response.writeHead(200, { "content-type": "text/plain" }).end("Signed in to Duva. You can close this tab.");
            resolve(session);
          },
          (error: Error) => {
            const failed = new Error(`${error.message} Run duva login again.`);
            response.writeHead(400, { "content-type": "text/plain" }).end(failed.message);
            reject(failed);
          },
        );
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", (error: NodeJS.ErrnoException) =>
        reject(error.code === "EADDRINUSE" ? new Error(`Port ${redirect.port} is in use, and sign-in comes back to it. Free it and run duva login again.`) : error),
      );
      server.listen(Number(redirect.port), redirect.hostname, resolve);
    });
    process.stderr.write(`Opening ${pending.authorizeUrl} to sign in. If no browser opens, open it yourself.\n`);
    openBrowser(pending.authorizeUrl);
    return await session;
  } finally {
    server.close();
    server.closeAllConnections();
  }
}

/** Opens the URL in $BROWSER, or the system's browser. Failing to open one isn't an error: the URL was printed. */
function openBrowser(url: string) {
  const [command, ...args] = process.env.BROWSER
    ? [process.env.BROWSER, url]
    : process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];
  if (command === undefined) return;
  const child = spawn(command, args, { stdio: "ignore", detached: true });
  child.on("error", () => {});
  child.unref();
}
