import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
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

test("status prints the version and region of the deployment that deploy saved", async () => {
  const machine = await newMachine();
  const server = await (await startDuva({ version: "2.3.4", region: "eu-west-1" })).listen();
  onTestFinished(() => server.close());
  await machine.saveDeployment(server.url);

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

/** A machine with nothing configured: no AWS settings and no Duva config. */
async function newMachine() {
  const home = await mkdtemp(join(tmpdir(), "duva-cli-"));
  await mkdir(join(home, ".aws"));
  return {
    home,
    duva: (...args: string[]) => run(args, { PATH: process.env.PATH ?? "", HOME: home }),
    /** Saves the deployment's API URL in the CLI's config, as duva deploy does. */
    async saveDeployment(apiUrl: string) {
      await mkdir(join(home, ".config", "duva"), { recursive: true });
      await writeFile(join(home, ".config", "duva", "config.json"), JSON.stringify({ apiUrl }));
    },
  };
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
