// A registered MCP client's sign-in, step by step as the human's browser takes it, which both the
// API's tests and scripts/check-deployment.ts walk, so the check follows the sign-in the tests pin.
import { createHash } from "node:crypto";

/** A registered client's sign-in, step by step as the human's browser takes it, on the deployment at `url`. */
export async function signInSteps(url: string) {
  const register = async () =>
    (await (await fetch(`${url}/mcp/register`, { method: "POST", body: JSON.stringify({ client_name: "Claude Code", redirect_uris: ["http://localhost:1234/callback"], token_endpoint_auth_method: "none" }) })).json()) as {
      client_id: string;
    };
  const verifier = "a".repeat(43);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const authorize = (client: string, redirect = "http://localhost:1234/callback") =>
    fetch(`${url}/mcp/authorize?${new URLSearchParams({ client_id: client, redirect_uri: redirect, response_type: "code", code_challenge: challenge, code_challenge_method: "S256", state: "mine" })}`);
  const consent = async (asking: Response) => /name="consent" value="([^"]+)"/.exec(await asking.text())![1]!;
  const decide = (consent: string, decision: string) => fetch(`${url}/mcp/authorize`, { method: "POST", body: new URLSearchParams({ consent, decision }), redirect: "manual" });
  const signIn = async (toLogin: string) => {
    const signedIn = await fetch(toLogin, { method: "POST", body: new URLSearchParams({ email: "linus@example.org" }), redirect: "manual" });
    return fetch(signedIn.headers.get("location")!, { redirect: "manual" });
  };
  const exchange = (client: string, code: string) =>
    fetch(`${url}/mcp/token`, { method: "POST", body: new URLSearchParams({ grant_type: "authorization_code", client_id: client, code, redirect_uri: "http://localhost:1234/callback", code_verifier: verifier }) });
  return { register, authorize, consent, decide, signIn, exchange };
}

/**
 * Registers a client at the deployment at `url`, starts its sign-in and allows it, as the human does
 * on Duva's page, and says what is wrong if that doesn't lead to managed login at `signInUrl` for the
 * MCP app client, back to the MCP endpoint, or if an unknown client's sign-in leads anywhere.
 */
export async function managedLoginReached(url: string, signInUrl: string, appClient: string): Promise<string | undefined> {
  const { register, authorize, consent, decide } = await signInSteps(url);
  const { client_id: client } = await register();
  const asking = await authorize(client);
  if (asking.status !== 200) return `authorize answered ${asking.status}, not Duva's page asking to allow the app`;
  const allowed = await decide(await consent(asking), "allow");
  const to = new URL(allowed.headers.get("location") ?? "http://nowhere");
  const unknown = await authorize("0".repeat(32));
  const fine =
    allowed.status === 303 &&
    `${to.origin}${to.pathname}` === `${signInUrl}/oauth2/authorize` &&
    to.searchParams.get("client_id") === appClient &&
    to.searchParams.get("redirect_uri") === `${url}/mcp/callback` &&
    unknown.status === 400;
  return fine ? undefined : `allowing answered ${allowed.status} to ${to.href}, and an unknown client's sign-in ${unknown.status}`;
}
