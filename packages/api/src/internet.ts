// Requests to a URL from someone's mail, as the unsubscriber's one-click POST and the logo
// fetcher's GET are: each from a Lambda of its own that may do nothing else, so the URL can reach
// nothing of Duva's. A request goes only to an allowed scheme on port 80 or 443, at an address that
// is public once resolved, and connects to the address it checked, so DNS can't answer differently
// in between. It sends no cookies and no referrer.
import { lookup } from "node:dns/promises";
import { request } from "node:http";
import { BlockList, connect, isIP, type Socket } from "node:net";
import { connect as connectTls } from "node:tls";

/** How a request reaches the internet: the real one in Lambda, a stand-in in tests. */
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

/** What a server answered: its status, where it redirects to, and with `maxBytes`, its body. */
export interface Answer {
  status: number;
  location?: string;
  body?: Uint8Array;
}

/** Why a request was never sent: its URL's scheme or port isn't allowed, or its host isn't public. */
export type Unsent = "notAllowed" | "notPublic";

/** The body was longer than the request allowed. */
export class TooLarge extends Error {}

/**
 * Sends one request to the URL, if its scheme is among `schemes` and its host public, and answers
 * with what the server said. With `maxBytes`, reads a body of up to that many bytes, and throws
 * TooLarge for a longer one. Throws when the server can't be reached, or `signal` aborts.
 */
export async function sendPublic(
  network: Network,
  at: URL,
  { method, schemes, headers, body, maxBytes, signal }: { method: "GET" | "POST"; schemes: ("http:" | "https:")[]; headers: Record<string, string>; body?: string; maxBytes?: number; signal: AbortSignal },
): Promise<Answer | Unsent> {
  const defaultPort = { "https:": 443, "http:": 80 }[at.protocol];
  const port = at.port === "" ? defaultPort : Number(at.port);
  if (!schemes.includes(at.protocol as "http:") || defaultPort === undefined || port === undefined || ![80, 443].includes(port)) return "notAllowed";
  const host = at.hostname.replace(/^\[(.*)\]$/, "$1");
  const addresses = isIP(host) !== 0 ? [host] : await abortable(network.resolve(host), signal);
  if (addresses.length === 0 || !addresses.every(isPublic)) return "notPublic";
  const address = addresses[0]!;
  return new Promise((resolve, reject) => {
    const outgoing = request(
      {
        method,
        path: `${at.pathname}${at.search}`,
        signal,
        headers: { host: at.host, ...headers, ...(body !== undefined && { "content-length": String(Buffer.byteLength(body)) }) },
        // No agent, so no connection is shared or kept, and the request goes only to the checked address.
        createConnection: () => {
          const socket = network.connect(address, port);
          // The certificate is checked against the URL's host, a name or an address.
          return at.protocol === "https:" ? connectTls({ socket, host, ...(isIP(host) === 0 && { servername: host }), ca: network.ca }) : socket;
        },
      },
      (incoming) => {
        const answer = { status: incoming.statusCode ?? 0, location: incoming.headers.location };
        if (maxBytes === undefined) {
          resolve(answer);
          return void incoming.destroy();
        }
        const chunks: Buffer[] = [];
        let length = 0;
        incoming.on("data", (chunk: Buffer) => {
          length += chunk.length;
          if (length > maxBytes) return void incoming.destroy(new TooLarge(`The answer is longer than ${maxBytes} bytes.`));
          chunks.push(chunk);
        });
        incoming.on("error", reject);
        incoming.on("end", () => resolve({ ...answer, body: new Uint8Array(Buffer.concat(chunks)) }));
      },
    );
    outgoing.on("error", reject);
    outgoing.end(body);
  });
}

export const abortable = <T>(promise: Promise<T>, signal: AbortSignal) =>
  Promise.race([promise, new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }))]);

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
