import type { paths } from "@duva/openapi";
import type { SignInConfig } from "./sign-in.ts";
import createClient, { type Client } from "openapi-fetch";

export type DuvaClient = Client<paths>;

export interface DuvaClientOptions {
  /** Sends the requests. Defaults to the global fetch. */
  fetch?: (request: Request) => Promise<Response>;
  /** Headers to send with every request, like the signed-in human's authorization. */
  headers?: Record<string, string>;
}

/** A client for the Duva deployment whose API is at `baseUrl`. */
export function createDuvaClient(baseUrl: string, options: DuvaClientOptions = {}): DuvaClient {
  return createClient<paths>({ baseUrl, ...options });
}

/** What the web app needs to know about its deployment, which duva deploy publishes next to it as config.json. */
export interface WebAppConfig {
  apiUrl: string;
  signIn: SignInConfig;
}
