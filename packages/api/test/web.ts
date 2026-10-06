// A stand-in for the internet the unsubscriber reaches: web servers by host name, each at the
// addresses its name resolves to, serving http on port 80 and https on port 443 with a test
// certificate. Connections to those addresses reach the servers in-process, and to any other
// address are refused. Nothing leaves the machine.
import { readFileSync } from "node:fs";
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { AddressInfo } from "node:net";
import { connect, Socket } from "node:net";
import type { Network } from "../src/unsubscriber.ts";

const certificate = readFileSync(new URL("web/cert.pem", import.meta.url), "utf8");
const key = readFileSync(new URL("web/key.pem", import.meta.url), "utf8");

/** A request a stand-in web server got. */
export interface ReceivedRequest {
  method: string;
  /** The URL it was for, with the scheme and host it reached. */
  url: string;
  /** Its headers, by name in lower case. */
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

export interface WebServerOptions {
  /** The addresses the host name resolves to, a public one of its own unless given. */
  addresses?: string[];
  /** How the server answers each request: 200 unless given. A promise that never settles never answers. */
  answer?: (request: ReceivedRequest) => Response | Promise<Response>;
}

export function standInInternet() {
  const hosts = new Map<string, Required<WebServerOptions> & { requests: ReceivedRequest[] }>();
  let ports: Promise<{ http: number; https: number }> | undefined;

  const handle = (scheme: string) => async (incoming: IncomingMessage, outgoing: ServerResponse) => {
    const chunks: Buffer[] = [];
    for await (const chunk of incoming) chunks.push(chunk);
    const hostHeader = incoming.headers.host ?? "";
    const host = hosts.get(hostHeader.replace(/:\d+$/, "").toLowerCase());
    if (host === undefined) return void outgoing.writeHead(421).end();
    const request: ReceivedRequest = { method: incoming.method ?? "", url: `${scheme}://${hostHeader}${incoming.url}`, headers: incoming.headers, body: Buffer.concat(chunks).toString() };
    host.requests.push(request);
    const response = await host.answer(request);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  };
  const listening = async (server: Server) => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    server.unref();
    return (server.address() as AddressInfo).port;
  };
  const started = async () => ({
    http: await listening(createHttpServer(handle("http"))),
    https: await listening(createHttpsServer({ cert: certificate, key }, handle("https"))),
  });

  let listened: { http: number; https: number } | undefined;
  const network: Network = {
    async resolve(hostname) {
      const host = hosts.get(hostname.toLowerCase());
      if (host === undefined) throw new Error(`getaddrinfo ENOTFOUND ${hostname}`);
      return host.addresses;
    },
    connect(address, port) {
      const known = [...hosts.values()].some(({ addresses }) => addresses.includes(address));
      if (!known || listened === undefined || (port !== 80 && port !== 443)) {
        const refused = new Socket();
        process.nextTick(() => refused.destroy(new Error(`connect ECONNREFUSED ${address}:${port}`)));
        return refused;
      }
      return connect({ host: "127.0.0.1", port: port === 443 ? listened.https : listened.http });
    },
    ca: certificate,
  };

  return {
    network,
    /** Puts a web server on the internet at the host name, and returns the requests it gets, as they arrive. */
    async webServer(hostname: string, { addresses, answer = () => new Response(null, { status: 200 }) }: WebServerOptions = {}): Promise<ReceivedRequest[]> {
      ports ??= started();
      listened = await ports;
      const requests: ReceivedRequest[] = [];
      hosts.set(hostname.toLowerCase(), { addresses: addresses ?? [`93.184.215.${10 + hosts.size}`], answer, requests });
      return requests;
    },
  };
}
