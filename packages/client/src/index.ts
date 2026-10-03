import type { paths } from "@duva/openapi";
import createClient, { type Client } from "openapi-fetch";

export type DuvaClient = Client<paths>;

export interface DuvaClientOptions {
  /** Sends the requests. Defaults to the global fetch. */
  fetch?: (request: Request) => Promise<Response>;
}

/** A client for the Duva deployment whose API is at `baseUrl`. */
export function createDuvaClient(baseUrl: string, options: DuvaClientOptions = {}): DuvaClient {
  return createClient<paths>({ baseUrl, ...options });
}
