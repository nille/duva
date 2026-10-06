// The unsubscriber: the one POST of an RFC 8058 one-click unsubscribe, sent to the sender's server
// from a Lambda of its own that may do nothing else, so a URL in someone's mail can reach nothing of
// Duva's (ADR-0016). It goes only to http or https on port 80 or 443, at an address that is public
// once resolved, and connects to the address it checked, so DNS can't answer differently in between.
// A 307 or 308 repeats it at the new URL, checked again, a few times at most. It sends no cookies
// and no referrer.
import { lookup } from "node:dns/promises";
import { request } from "node:http";
import { BlockList, connect, isIP, type Socket } from "node:net";
import { connect as connectTls } from "node:tls";
import { InvokeCommand, type LambdaClient } from "@aws-sdk/client-lambda";
import type { components } from "@duva/openapi";

export type Unsubscribe = components["schemas"]["Unsubscribe"];

/** Sends the one-click POST to the URL, and says how it went. */
export interface Unsubscriber {
  post(url: string): Promise<Unsubscribe>;
}

/** How the unsubscriber reaches the internet: the real one in Lambda, a stand-in in tests. */
export interface Network {
  /** The addresses the host name resolves to. */
  resolve(hostname: string): Promise<string[]>;
  /** A TCP connection to the address and port. */
  connect(address: string, port: number): Socket;
  /** The certificates to trust instead of Node's, in tests. */
  ca?: string;
}

export const internet: Network = {
  // IPv4 first, since a Lambda outside a VPC has no IPv6 route.
  resolve: async (hostname) => (await lookup(hostname, { all: true })).sort((a, b) => a.family - b.family).map(({ address }) => address),
  connect: (address, port) => connect({ host: address, port }),
};

/** How long the POST may take, redirects included. */
const postTimeout = 5_000;
/** How many redirects the POST follows. */
const redirectsFollowed = 3;
/** The User-Agent the POST carries, the same every time. */
const userAgent = "Duva one-click unsubscribe (RFC 8058)";
/** What RFC 8058 has the POST send. */
const oneClickBody = "List-Unsubscribe=One-Click";

const failed = (reason: NonNullable<Unsubscribe["reason"]>, status?: number): Unsubscribe => ({ outcome: "failed", reason, ...(status !== undefined && { status }) });

/**
 * Sends the one-click POST to the URL. A 307 or 308 repeats it at the new URL. Only a 2xx answer
 * unsubscribes: any other, another redirect included, may lead to a page that asks to confirm.
 */
export async function postOneClick(network: Network, url: string): Promise<Unsubscribe> {
  const signal = AbortSignal.timeout(postTimeout);
  const unreached = (error: unknown) => {
    if (signal.aborted) return failed("timedOut");
    console.log(`The one-click POST failed: ${String(error)}`);
    return failed("unreachable");
  };
  let at: URL;
  try {
    at = new URL(url);
  } catch {
    return failed("notAllowed");
  }
  for (let redirects = 0; ; redirects++) {
    const defaultPort = { "https:": 443, "http:": 80 }[at.protocol];
    const port = at.port === "" ? defaultPort : Number(at.port);
    if (defaultPort === undefined || port === undefined || ![80, 443].includes(port)) return failed("notAllowed");
    const host = at.hostname.replace(/^\[(.*)\]$/, "$1");
    let addresses: string[];
    try {
      addresses = isIP(host) !== 0 ? [host] : await abortable(network.resolve(host), signal);
    } catch (error) {
      return unreached(error);
    }
    if (addresses.length === 0 || !addresses.every(isPublic)) return failed("notPublic");
    let answer: { status: number; location?: string };
    try {
      answer = await send(network, { at, host, address: addresses[0]!, port, signal });
    } catch (error) {
      return unreached(error);
    }
    const { status, location } = answer;
    if ((status === 307 || status === 308) && location !== undefined) {
      if (redirects === redirectsFollowed) return failed("tooManyRedirects");
      try {
        at = new URL(location, at);
      } catch {
        return failed("notAllowed");
      }
      continue;
    }
    return status >= 200 && status < 300 ? { outcome: "unsubscribed" } : failed("refused", status);
  }
}

const abortable = <T>(promise: Promise<T>, signal: AbortSignal) =>
  Promise.race([promise, new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }))]);

/** Sends the POST to the address, for the URL's host, and answers with its status and where it redirects to. */
function send(
  network: Network,
  { at, host, address, port, signal }: { at: URL; host: string; address: string; port: number; signal: AbortSignal },
): Promise<{ status: number; location?: string }> {
  return new Promise((resolve, reject) => {
    const outgoing = request(
      {
        method: "POST",
        path: `${at.pathname}${at.search}`,
        signal,
        headers: {
          host: at.host,
          "user-agent": userAgent,
          "content-type": "application/x-www-form-urlencoded",
          "content-length": String(Buffer.byteLength(oneClickBody)),
        },
        // No agent, so no connection is shared or kept, and the request goes only to the checked address.
        createConnection: () => {
          const socket = network.connect(address, port);
          // The certificate is checked against the URL's host, a name or an address.
          return at.protocol === "https:" ? connectTls({ socket, host, ...(isIP(host) === 0 && { servername: host }), ca: network.ca }) : socket;
        },
      },
      (incoming) => {
        resolve({ status: incoming.statusCode ?? 0, location: incoming.headers.location });
        incoming.destroy();
      },
    );
    outgoing.on("error", reject);
    outgoing.end(oneClickBody);
  });
}

// What isn't on the public internet: private, shared, loopback, link-local (169.254 included),
// documentation, benchmarking, multicast and reserved ranges, and IPv6 forms that embed IPv4. A
// BlockList checks an IPv4-mapped IPv6 address against the IPv4 ranges.
const notPublic = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
] as const) {
  notPublic.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 96],
  ["::ffff:0:0:0", 96],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const) {
  notPublic.addSubnet(network, prefix, "ipv6");
}

/** Whether the IP address is on the public internet. */
export function isPublic(address: string): boolean {
  const family = isIP(address);
  return family !== 0 && !notPublic.check(address, family === 4 ? "ipv4" : "ipv6");
}

/** The unsubscriber Lambda, which the API invokes and waits for. */
export function lambdaUnsubscriber(lambda: LambdaClient, functionName: string): Unsubscriber {
  return {
    async post(url) {
      // The block stands whatever happens here, so a failed invocation is a failed unsubscribe.
      try {
        const { FunctionError, Payload } = await lambda.send(new InvokeCommand({ FunctionName: functionName, Payload: JSON.stringify({ url }) }));
        if (FunctionError !== undefined) throw new Error(`The unsubscriber failed: ${new TextDecoder().decode(Payload)}`);
        return JSON.parse(new TextDecoder().decode(Payload)) as Unsubscribe;
      } catch (error) {
        console.error(error);
        return failed("unreachable");
      }
    },
  };
}
