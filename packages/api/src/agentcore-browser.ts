// AgentCore Browser as the mailbox agent's isolated browser (ADR-0031, docs/aws.md): each session is
// a fresh browser in a microVM of its own, wiped when it ends, which Duva drives over the session's
// automation stream, a WebSocket speaking the Chrome DevTools Protocol, signed with SigV4. Pages are
// read and acted on by a script Duva evaluates in them, which numbers their elements.
import { createHash, createHmac } from "node:crypto";
import { BedrockAgentCoreClient, StartBrowserSessionCommand, StopBrowserSessionCommand } from "@aws-sdk/client-bedrock-agentcore";
import { SignatureV4 } from "@smithy/signature-v4";
import { type Browser, type BrowserSession, pageTextAtMost, type PageView } from "./browser.ts";

/** How long a session may last at most, in seconds, in case Duva doesn't stop it. */
const sessionTimeout = 300;
/** How long a page may take to load, in milliseconds. */
const loadTimeout = 15_000;
/** How long a CDP command may take, in milliseconds. */
const commandTimeout = 20_000;

/** The browser with the ID, or undefined where the stack left it out, giving its ID as empty. */
export function agentCoreBrowser(browserId: string): Browser | undefined {
  if (browserId === "") return undefined;
  const agentCore = new BedrockAgentCoreClient({});
  return async () => {
    const { sessionId, streams } = await agentCore.send(new StartBrowserSessionCommand({ browserIdentifier: browserId, sessionTimeoutSeconds: sessionTimeout, viewPort: { width: 1280, height: 900 } }));
    const stop = () => agentCore.send(new StopBrowserSessionCommand({ browserIdentifier: browserId, sessionId })).then(() => undefined);
    try {
      const endpoint = streams!.automationStream!.streamEndpoint!;
      return await devToolsSession(endpoint, await signedHeaders(agentCore, endpoint), stop);
    } catch (error) {
      await stop().catch((stopping: unknown) => console.error(stopping));
      throw error;
    }
  };
}

/**
 * A session of the browser at the CDP endpoint, which the handshake's headers open, on a new page.
 * Closing it closes the connection, then calls `close`.
 */
export async function devToolsSession(endpoint: string, headers: Record<string, string>, close: () => Promise<void>): Promise<BrowserSession> {
  const cdp = await devTools(endpoint, headers);
  const { targetId } = (await cdp.send("Target.createTarget", { url: "about:blank" })) as { targetId: string };
  const { sessionId: page } = (await cdp.send("Target.attachToTarget", { targetId, flatten: true })) as { sessionId: string };
  const evaluate = async (expression: string) => {
    const { result, exceptionDetails } = (await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, page)) as { result: { value?: unknown }; exceptionDetails?: unknown };
    if (exceptionDetails !== undefined) throw new Error(`The page's script failed: ${JSON.stringify(exceptionDetails)}`);
    return result.value;
  };
  // Waits for the page to load, after a navigation or a click that may lead to one, and reads it.
  const settled = async (): Promise<PageView> => {
    const deadline = Date.now() + loadTimeout;
    await sleep(500);
    for (;;) {
      const state = await evaluate("document.readyState").catch(() => "loading");
      if (state === "complete" || Date.now() > deadline) break;
      await sleep(250);
    }
    return (await evaluate(readPage)) as PageView;
  };
  const act = async (script: string) => {
    await evaluate(script);
    return settled();
  };
  const session: BrowserSession = {
    async open(url) {
      await cdp.send("Page.navigate", { url }, page);
      return settled();
    },
    fill: (index, value) => act(`(${fill})(${index}, ${JSON.stringify(value)})`),
    choose: (index, option) => act(`(${choose})(${index}, ${JSON.stringify(option ?? null)})`),
    click: (index) => act(`(${click})(${index})`),
    async close() {
      cdp.close();
      await close();
    },
  };
  return session;
}

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/** The headers that sign the automation stream's WebSocket handshake, a GET to its URL, with the client's credentials. */
async function signedHeaders(agentCore: BedrockAgentCoreClient, endpoint: string): Promise<Record<string, string>> {
  const url = new URL(endpoint);
  const signer = new SignatureV4({ service: "bedrock-agentcore", region: await agentCore.config.region(), credentials: agentCore.config.credentials, sha256: Sha256 });
  const { headers } = await signer.sign({
    method: "GET",
    protocol: "https:",
    hostname: url.hostname,
    path: url.pathname,
    query: Object.fromEntries(url.searchParams),
    headers: { host: url.host },
  });
  return headers;
}

/** SHA-256, or HMAC-SHA-256 with a secret, as the signer takes it. */
class Sha256 {
  private readonly secret: string | ArrayBuffer | ArrayBufferView | undefined;
  private hash: ReturnType<typeof createHash> | ReturnType<typeof createHmac>;
  constructor(secret?: string | ArrayBuffer | ArrayBufferView) {
    this.secret = secret;
    this.hash = this.start();
  }
  private start() {
    if (this.secret === undefined) return createHash("sha256");
    const key = typeof this.secret === "string" ? this.secret : ArrayBuffer.isView(this.secret) ? Buffer.from(this.secret.buffer, this.secret.byteOffset, this.secret.byteLength) : Buffer.from(this.secret);
    return createHmac("sha256", key);
  }
  update(data: string | ArrayBuffer | ArrayBufferView) {
    this.hash.update(typeof data === "string" ? data : ArrayBuffer.isView(data) ? Buffer.from(data.buffer, data.byteOffset, data.byteLength) : Buffer.from(data));
  }
  async digest() {
    return new Uint8Array(this.hash.digest());
  }
  reset() {
    this.hash = this.start();
  }
}

/** A connection to a browser over the Chrome DevTools Protocol, sending each command to the browser or to a page's session. */
async function devTools(endpoint: string, headers: Record<string, string>) {
  // Node's WebSocket takes headers for the handshake, beyond what browsers' does.
  const socket = new WebSocket(endpoint, { headers } as unknown as string[]);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error("The browser's automation stream couldn't be opened.")), { once: true });
  });
  let next = 1;
  const pending = new Map<number, { resolve: (result: unknown) => void; reject: (error: Error) => void }>();
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(String(data)) as { id?: number; result?: unknown; error?: { message: string } };
    const waiting = message.id === undefined ? undefined : pending.get(message.id);
    if (waiting === undefined) return;
    pending.delete(message.id!);
    if (message.error !== undefined) waiting.reject(new Error(message.error.message));
    else waiting.resolve(message.result);
  });
  socket.addEventListener("close", () => {
    for (const { reject } of pending.values()) reject(new Error("The browser's automation stream closed."));
    pending.clear();
  });
  return {
    send(method: string, params: Record<string, unknown>, sessionId?: string): Promise<unknown> {
      const id = next++;
      socket.send(JSON.stringify({ id, method, params, ...(sessionId !== undefined && { sessionId }) }));
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`The browser didn't answer ${method} in time.`));
        }, commandTimeout);
        pending.set(id, {
          resolve: (result) => (clearTimeout(timer), resolve(result)),
          reject: (error) => (clearTimeout(timer), reject(error)),
        });
      });
    },
    close: () => socket.close(),
  };
}

// The scripts evaluated in the page. Each element the agent may act on gets its number in an
// attribute, so acting on a number finds the element read.

/** Reads the page: its URL, title and visible text, and the visible elements, numbered. */
const readPage = `(() => {
  const visible = (element) => {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  };
  const words = (text) => (text || "").replace(/\\s+/g, " ").trim().slice(0, 120);
  const labelOf = (element) => words(element.labels?.[0]?.innerText) || words(element.getAttribute("aria-label")) || words(element.innerText) || words(element.value) || words(element.placeholder) || words(element.name);
  const elements = [...document.querySelectorAll("input, select, textarea, button, a[href], [role=button]")]
    .filter((element) => element.type !== "hidden" && visible(element))
    .map((element, at) => {
      const index = at + 1;
      element.setAttribute("data-duva-element", String(index));
      const tag = element.tagName.toLowerCase();
      const type = (element.getAttribute("type") || "").toLowerCase();
      // A select's own text is its options'.
      if (tag === "select") return { index, kind: "select", label: words(element.labels?.[0]?.innerText) || words(element.getAttribute("aria-label")) || words(element.name), options: [...element.options].map((option) => words(option.text)) };
      if (tag === "a") return { index, kind: "link", label: labelOf(element) };
      if (tag === "button" || element.getAttribute("role") === "button" || ["submit", "button", "image", "reset"].includes(type)) return { index, kind: "button", label: labelOf(element) };
      if (type === "checkbox" || type === "radio") return { index, kind: type, label: labelOf(element), checked: element.checked };
      return { index, kind: "field", label: labelOf(element), type: type || (tag === "textarea" ? "textarea" : "text"), value: element.value };
    });
  return { url: location.href, title: document.title, text: (document.body?.innerText || "").slice(0, ${pageTextAtMost}), elements };
})()`;

const fill = `(index, value) => {
  const element = document.querySelector('[data-duva-element="' + index + '"]');
  element.focus();
  const prototype = element.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value").set.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}`;

const choose = `(index, option) => {
  const element = document.querySelector('[data-duva-element="' + index + '"]');
  if (element.tagName === "SELECT") {
    const chosen = [...element.options].find((each) => each.text.replace(/\\s+/g, " ").trim() === option);
    if (chosen === undefined) throw new Error("The select has no such option.");
    element.value = chosen.value;
    element.dispatchEvent(new Event("change", { bubbles: true }));
  } else element.click();
}`;

const click = `(index) => {
  document.querySelector('[data-duva-element="' + index + '"]').click();
}`;
