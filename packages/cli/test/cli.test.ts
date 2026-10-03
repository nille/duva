import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startDuva } from "@duva/api/harness";
import { expect, onTestFinished, test } from "vitest";

test("deploy refuses a region where SES can't receive mail", async () => {
  const machine = await newMachine();
  await writeFile(join(machine.home, ".aws", "config"), "[default]\nregion = ca-west-1\n");

  const result = await machine.duva("deploy");

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  expect(errorIn(result.stderr)).toMatch(/ca-west-1/);
});

test("deploy asks for a region when the AWS configuration names none", async () => {
  const machine = await newMachine();

  const result = await machine.duva("deploy");

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  expect(errorIn(result.stderr)).toMatch(/No AWS region.*AWS_REGION/);
});

test("status reaches the deployment saved in the CLI's config", async () => {
  const machine = await newMachine();
  const server = await (await startDuva({ version: "2.3.4", region: "eu-west-1" })).listen();
  onTestFinished(() => server.close());
  await machine.saveDeployment(server);

  const result = await machine.duva("status");

  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({ version: "2.3.4", region: "eu-west-1" });
});

test("status says to run deploy first when no deployment is saved", async () => {
  const machine = await newMachine();

  const result = await machine.duva("status");

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  expect(errorIn(result.stderr)).toMatch(/duva deploy/);
});

test("login signs in through the browser, and whoami then names the signed-in admin", async () => {
  const machine = await newMachine();
  const server = await (await startDuva({ admin: "ada@example.com" })).listen();
  onTestFinished(() => server.close());
  await machine.saveDeployment(server);

  const login = await machine.duva("login", { browserSignsIn: "ada@example.com" });
  const whoami = await machine.duva("whoami");

  expect(login.exitCode).toBe(0);
  expect(JSON.parse(login.stdout)).toEqual({ signedIn: { id: expect.any(String), kind: "human", email: "ada@example.com", admin: true } });
  expect(whoami.exitCode).toBe(0);
  expect(JSON.parse(whoami.stdout)).toEqual({ id: expect.any(String), kind: "human", email: "ada@example.com", admin: true });
});

test("whoami says to run login first when nobody has signed in", async () => {
  const machine = await newMachine();
  const server = await (await startDuva()).listen();
  onTestFinished(() => server.close());
  await machine.saveDeployment(server);

  const result = await machine.duva("whoami");

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  expect(errorIn(result.stderr)).toMatch(/duva login/);
});

test("a session renews itself once its access token has expired", async () => {
  const machine = await newMachine();
  const server = await (await startDuva({ admin: "ada@example.com", accessTokenLifetime: 1 })).listen();
  onTestFinished(() => server.close());
  await machine.saveDeployment(server);
  await machine.duva("login", { browserSignsIn: "ada@example.com" });
  // The CLI runs as its own process, so the test can't stand in for its clock. It waits instead.
  await new Promise((resolve) => setTimeout(resolve, 1100));

  const result = await machine.duva("whoami");

  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ email: "ada@example.com" });
});

test("once the session can't be renewed, whoami says to run login again", async () => {
  const machine = await newMachine();
  const duva = await startDuva({ admin: "ada@example.com", accessTokenLifetime: 1 });
  const server = await duva.listen();
  onTestFinished(() => server.close());
  await machine.saveDeployment(server);
  await machine.duva("login", { browserSignsIn: "ada@example.com" });
  duva.endSessions();

  const result = await machine.duva("whoami");

  expect(result.exitCode).toBe(1);
  expect(errorIn(result.stderr)).toMatch(/expired.*duva login/);
});

test("login fails when the browser comes back from another sign-in", async () => {
  const machine = await newMachine();
  const server = await (await startDuva()).listen();
  onTestFinished(() => server.close());
  await machine.saveDeployment(server);

  const result = await machine.duva("login", { browserOpens: (redirectUri) => `${redirectUri}?code=stolen&state=other` });

  expect(result.exitCode).toBe(1);
  expect(errorIn(result.stderr)).toMatch(/another sign-in/);
});

test("organization changes lists the setup changes after a position", async () => {
  const machine = await newMachine();
  const server = await (await startDuva({ domain: "duva.example.com", admin: "ada@example.com" })).listen();
  onTestFinished(() => server.close());
  await machine.saveDeployment(server);
  await machine.duva("login", { browserSignsIn: "ada@example.com" });

  const result = await machine.duva("organization", "changes", "--after", "1");

  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({
    changes: [
      { position: 2, type: "domainAdded", domain: "duva.example.com" },
      { position: 3, type: "actorAdded", added: { email: "ada@example.com" } },
    ],
    position: 3,
  });
});

test("organization changes refuses a position that isn't a number", async () => {
  const machine = await newMachine();

  const result = await machine.duva("organization", "changes", "--after", "first");

  expect(result.exitCode).toBe(1);
  expect(errorIn(result.stderr)).toMatch(/"first" isn't a whole number. Give --after/);
});

/**
 * A machine with nothing configured: no AWS settings and no Duva config. Like the environment,
 * its home directory is input at this seam. The CLI's config file there is part of the CLI's
 * behavior: duva deploy writes it and the API commands read it.
 */
async function newMachine() {
  const home = await mkdtemp(join(tmpdir(), "duva-cli-"));
  await mkdir(join(home, ".aws"));
  let redirectUri = "";
  return {
    home,
    /**
     * Runs duva. With browserSignsIn, the browser login opens signs in as that human. With
     * browserOpens, it opens the URL the function makes from the loopback redirect instead.
     */
    async duva(...args: [...string[], Browser] | string[]) {
      const last = args.at(-1);
      const browser = typeof last === "object" ? last : undefined;
      const words = (browser ? args.slice(0, -1) : args) as string[];
      const env: Record<string, string> = { PATH: process.env.PATH ?? "", HOME: home };
      if (browser !== undefined) env.BROWSER = await browserScript(home, browser, redirectUri);
      return run(words, env);
    },
    /**
     * Saves a deployment in the CLI's config, as duva deploy does: its API, and its managed login
     * with a loopback redirect on a free port.
     */
    async saveDeployment(server: { url: string; signIn: { url: string; clientId: string } }) {
      redirectUri = `http://127.0.0.1:${await freePort()}/callback`;
      await mkdir(join(home, ".config", "duva"), { recursive: true });
      await writeFile(
        join(home, ".config", "duva", "config.json"),
        JSON.stringify({ apiUrl: server.url, signIn: { ...server.signIn, redirectUri } }),
      );
    },
  };
}

type Browser = { browserSignsIn: string } | { browserOpens: (redirectUri: string) => string };

const browserJs = fileURLToPath(new URL("browser.ts", import.meta.url));

/** A script to give duva as $BROWSER, which acts as a browser does: see browser.ts. */
async function browserScript(home: string, browser: Browser, redirectUri: string): Promise<string> {
  const script = join(home, "browser");
  const action = "browserSignsIn" in browser ? `--sign-in-as '${browser.browserSignsIn}'` : `--open '${browser.browserOpens(redirectUri)}'`;
  await writeFile(script, `#!/bin/sh\nexec node '${browserJs}' ${action} "$1"\n`);
  await chmod(script, 0o755);
  return script;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => (typeof address === "object" && address ? resolve(address.port) : reject(new Error("No port"))));
    });
  });
}

const bun = fileURLToPath(new URL("../../../node_modules/.bin/bun", import.meta.url));
const main = fileURLToPath(new URL("../src/main.ts", import.meta.url));

function run(args: string[], env: Record<string, string>) {
  return new Promise<{ exitCode: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(bun, [main, ...args], { env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.once("error", reject);
    child.once("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
}

/** The message of the error the CLI printed as JSON on stderr. */
function errorIn(stderr: string): string {
  const lastLine = stderr.trim().split("\n").at(-1) ?? "";
  return (JSON.parse(lastLine) as { error: string }).error;
}
