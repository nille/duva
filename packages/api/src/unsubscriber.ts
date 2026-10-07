// The unsubscriber: the one POST of an RFC 8058 one-click unsubscribe, sent to the sender's server
// from a Lambda of its own that may do nothing else (ADR-0016), as internet.ts sends it: to http or
// https on port 80 or 443, at an address that is public once resolved. A 307 or 308 repeats it at
// the new URL, checked again, a few times at most.
import { InvokeCommand, type LambdaClient } from "@aws-sdk/client-lambda";
import type { components } from "@duva/openapi";
import { type Answer, type Network, sendPublic } from "./internet.ts";

export type Unsubscribe = components["schemas"]["Unsubscribe"];

/** Sends the one-click POST to the URL, and says how it went. */
export interface Unsubscriber {
  post(url: string): Promise<Unsubscribe>;
}

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
  let at: URL;
  try {
    at = new URL(url);
  } catch {
    return failed("notAllowed");
  }
  for (let redirects = 0; ; redirects++) {
    let answer: Answer | "notAllowed" | "notPublic";
    try {
      answer = await sendPublic(network, at, {
        method: "POST",
        schemes: ["http:", "https:"],
        headers: { "user-agent": userAgent, "content-type": "application/x-www-form-urlencoded" },
        body: oneClickBody,
        signal,
      });
    } catch (error) {
      if (signal.aborted) return failed("timedOut");
      console.log(`The one-click POST failed: ${String(error)}`);
      return failed("unreachable");
    }
    if (typeof answer === "string") return failed(answer);
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
