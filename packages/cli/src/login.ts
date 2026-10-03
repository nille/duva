import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { finishSignIn, type Session, type SignInConfig, startSignIn } from "@duva/client/sign-in";
import { agentKeyVariable, callApi } from "./api-commands.ts";
import { type Command, optionValues } from "./commands.ts";
import { readConfig, saveSession } from "./config.ts";

/** How long login waits for the browser to come back. */
const timeout = 5 * 60_000;

export const login: Command = {
  words: ["login"],
  summary: "Sign in as a human through the browser.",
  options: [],
  async run(args) {
    optionValues(login, args);
    if (process.env[agentKeyVariable]) {
      throw new Error(`${agentKeyVariable} is set, so the CLI calls Duva as that agent, and an agent never signs in. Unset it to sign in as a human.`);
    }
    const { signIn } = await readConfig();
    if (signIn === undefined) throw new Error("No Duva deployment is configured. Run duva deploy first.");
    await saveSession(await signInThroughBrowser(signIn));
    return { signedIn: await callApi("whoami") };
  },
};

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
