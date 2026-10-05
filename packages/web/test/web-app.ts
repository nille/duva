// The web app's test seam: the built web app in headless Chromium, against startDuva()'s in-process
// stack and its managed-login stand-in. Tests drive the page as a human does: click, type and read
// what's on screen.
//
// One local server plays CloudFront and the deployment's other origins at once. It serves the
// build and the config.json duva deploy publishes beside it, and passes /api and /oauth2 on to the
// harness, so the page reaches the API and managed login without CORS. The browser is Chromium
// from the system, found at CHROMIUM or a usual path.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { type Duva, type DuvaOptions, startDuva } from "@duva/api/harness";
import type { WebAppConfig } from "@duva/client";
import { type Browser, chromium, type Page } from "playwright-core";
import { afterAll, onTestFinished } from "vitest";

/** A phone's viewport, for tests of the layout there. */
export const phone = { width: 390, height: 844 };

export interface WebApp {
  duva: Duva;
  /** A page in a fresh browser, with nothing stored, at the web app's address. */
  page: Page;
  /** Opens the web app and signs in on managed login as the human at `email`, as they would with the code they were emailed. */
  signIn(email: string): Promise<void>;
  /** Hides the page's tab, as the browser says through the Page Visibility API when the human switches to another tab. */
  hide(): Promise<void>;
  /** Shows the hidden tab again, as when the human switches back to it. */
  show(): Promise<void>;
}

/**
 * Starts Duva with the options, serves the web app for it, and opens a browser page there. Everything stops when the test ends.
 * The page reads the change feeds every 250 ms, hidden or not, unless `hiddenPollInterval` says how often to while hidden.
 */
export async function startWebApp(options: DuvaOptions & { viewport?: { width: number; height: number }; hiddenPollInterval?: number } = {}): Promise<WebApp> {
  const { viewport, hiddenPollInterval = 250, ...duvaOptions } = options;
  const duva = await startDuva(duvaOptions);
  const harness = await duva.listen();
  const site = await serve(await builtWebApp(), harness, hiddenPollInterval);
  const context = await (await browser()).newContext({ viewport: viewport ?? { width: 1280, height: 800 } });
  onTestFinished(async () => {
    await context.close();
    await site.close();
    await harness.close();
  });
  const page = await context.newPage();
  return {
    duva,
    page,
    async signIn(email) {
      await page.goto(site.url);
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.locator("input[name=email]").fill(email);
      await page.getByRole("button", { name: "Sign in" }).click();
    },
    hide: () => setVisibility(page, false),
    show: () => setVisibility(page, true),
  };
}

async function setVisibility(page: Page, shown: boolean) {
  await page.evaluate((shown) => {
    // A real tab in the background would also have its timers slowed, which a test can't wait for.
    if (shown) {
      delete (document as { hidden?: boolean }).hidden;
      delete (document as { visibilityState?: string }).visibilityState;
    } else {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    }
    document.dispatchEvent(new Event("visibilitychange"));
  }, shown);
}

let built: Promise<string> | undefined;

/** Builds the web app once per test file, with npm run build, into a directory of its own. */
function builtWebApp(): Promise<string> {
  built ??= (async () => {
    const outDir = await mkdtemp(join(tmpdir(), "duva-web-"));
    // Vitest sets NODE_ENV to test, for which Vite would build React's development build, where
    // StrictMode runs every effect twice.
    await promisify(execFile)("npm", ["run", "build", "--", "--outDir", outDir, "--logLevel", "warn"], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: { ...process.env, NODE_ENV: "production" },
    });
    return outDir;
  })();
  return built;
}

let launched: Promise<Browser> | undefined;

function browser(): Promise<Browser> {
  launched ??= chromium.launch({ executablePath: chromiumPath() });
  return launched;
}

afterAll(async () => {
  await (await launched)?.close();
  const outDir = await built?.catch(() => undefined);
  if (outDir !== undefined) await rm(outDir, { recursive: true, force: true });
});

function chromiumPath(): string {
  const found = [process.env.CHROMIUM, "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"].find((path) => path && existsSync(path));
  if (found === undefined) throw new Error("The web app's tests need Chromium. Install it, or set CHROMIUM to its path.");
  return found;
}

const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
};

async function serve(root: string, harness: { url: string; signIn: { clientId: string } }, hiddenPollInterval: number) {
  const server = createServer(async (incoming, outgoing) => {
    const url = new URL(incoming.url ?? "/", origin);
    const passed = url.pathname.startsWith("/api/") ? url.pathname.slice("/api".length) : url.pathname.startsWith("/oauth2/") ? url.pathname : undefined;
    if (passed !== undefined) {
      const chunks: Buffer[] = [];
      for await (const chunk of incoming) chunks.push(chunk);
      const headers = Object.entries(incoming.headers).flatMap(([name, value]) => (typeof value === "string" && name !== "host" ? [[name, value] as [string, string]] : []));
      const answer = await fetch(`${harness.url}${passed}${url.search}`, {
        method: incoming.method,
        headers,
        body: chunks.length > 0 ? Buffer.concat(chunks) : undefined,
        redirect: "manual",
      });
      outgoing.writeHead(answer.status, Object.fromEntries(answer.headers));
      outgoing.end(Buffer.from(await answer.arrayBuffer()));
      return;
    }
    if (url.pathname === "/config.json") {
      // The page reads the change feeds often, so a test sees new mail soon after it arrives, however busy the machine.
      const config: WebAppConfig = { apiUrl: `${origin}/api`, signIn: { url: origin, clientId: harness.signIn.clientId, redirectUri: `${origin}/` }, pollInterval: 250, hiddenPollInterval };
      outgoing.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(config));
      return;
    }
    const path = normalize(url.pathname === "/" ? "/index.html" : url.pathname);
    const body = await readFile(join(root, path)).catch(() => undefined);
    if (body === undefined) outgoing.writeHead(404).end();
    else outgoing.writeHead(200, { "content-type": types[extname(path)] ?? "application/octet-stream" }).end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url: `${origin}/`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}
