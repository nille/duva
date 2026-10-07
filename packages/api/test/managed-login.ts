// Stands in for Cognito's managed login, for clients that sign in through a browser, such as the
// CLI. It speaks the same authorization code flow with PKCE, at the same paths, and issues access
// tokens from the test token issuer.
//
// Its sign-in page takes the human's address in a form post, as if the human had entered it and
// the code they were emailed. An address that isn't a human in the organization gets the same page
// back and no code, as with Cognito.
import { createHash, randomUUID } from "node:crypto";
import { mcpCallbackPath } from "../src/infrastructure.ts";
import type { TestTokenIssuer } from "./token-issuer.ts";

/** The app client the stand-in signs clients in for. */
export const managedLoginClientId = "duva-test-client";

/** The app client MCP clients sign in through, by way of the MCP endpoint, which managed login sends back to only. */
export const mcpAppClientId = "duva-test-mcp-client";

/** Whether managed login may send a sign-in for the client back to the URI: the machine itself for its own, the MCP endpoint's callback for MCP's. */
const backTo = (client: string | null, redirectUri: string) =>
  client === managedLoginClientId
    ? /^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d+\//.test(redirectUri)
    : client === mcpAppClientId && URL.canParse(redirectUri) && new URL(redirectUri).pathname === mcpCallbackPath;

export function managedLogin({ ids, issuer, accessTokenLifetime }: { ids: Map<string, string>; issuer: TestTokenIssuer; accessTokenLifetime: number }) {
  const codes = new Map<string, { id: string; client: string; challenge: string; redirectUri: string }>();
  const refreshTokens = new Map<string, { id: string; client: string }>();

  async function authorize(request: Request, url: URL): Promise<Response> {
    const query = url.searchParams;
    const redirectUri = query.get("redirect_uri") ?? "";
    const client = query.get("client_id") ?? "";
    const valid = query.get("response_type") === "code" && query.get("code_challenge_method") === "S256" && query.get("code_challenge") !== null && backTo(client, redirectUri);
    if (!valid) return new Response("Bad sign-in request", { status: 400 });
    if (request.method !== "POST") return page();

    const email = new URLSearchParams(await request.text()).get("email") ?? "";
    const id = ids.get(email);
    if (id === undefined) return page();
    const code = randomUUID();
    codes.set(code, { id, client, challenge: query.get("code_challenge") ?? "", redirectUri });
    const back = new URL(redirectUri);
    back.searchParams.set("code", code);
    back.searchParams.set("state", query.get("state") ?? "");
    return new Response(null, { status: 303, headers: { location: back.href } });
  }

  async function token(request: Request): Promise<Response> {
    const form = new URLSearchParams(await request.text());
    const refused = () => Response.json({ error: "invalid_grant" }, { status: 400 });
    const client = form.get("client_id") ?? "";
    if (client !== managedLoginClientId && client !== mcpAppClientId) return Response.json({ error: "invalid_client" }, { status: 400 });

    if (form.get("grant_type") === "authorization_code") {
      const pending = codes.get(form.get("code") ?? "");
      codes.delete(form.get("code") ?? "");
      const challenge = createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url");
      if (pending === undefined || pending.client !== client || pending.challenge !== challenge || pending.redirectUri !== form.get("redirect_uri")) return refused();
      const refreshToken = randomUUID();
      refreshTokens.set(refreshToken, { id: pending.id, client });
      return tokens(pending.id, client, refreshToken);
    }
    if (form.get("grant_type") === "refresh_token") {
      const session = refreshTokens.get(form.get("refresh_token") ?? "");
      // A human deleted from the user pool can't renew their session.
      return session === undefined || session.client !== client || ![...ids.values()].includes(session.id) ? refused() : tokens(session.id, client);
    }
    return Response.json({ error: "unsupported_grant_type" }, { status: 400 });
  }

  const tokens = (id: string, client: string, refreshToken?: string) =>
    Response.json({
      access_token: issuer.issue(id, accessTokenLifetime, client),
      ...(refreshToken && { refresh_token: refreshToken }),
      expires_in: accessTokenLifetime,
      token_type: "Bearer",
    });

  return {
    /** Answers the request if it's for managed login, or returns undefined. */
    async handle(request: Request): Promise<Response | undefined> {
      const url = new URL(request.url);
      if (url.pathname === "/oauth2/authorize") return authorize(request, url);
      if (url.pathname === "/oauth2/token" && request.method === "POST") return token(request);
      return undefined;
    },
    /** Ends every session, so no refresh token renews one any more. */
    endSessions() {
      refreshTokens.clear();
    },
  };
}

const page = () => new Response("<form method=post><input name=email><button>Sign in</button></form>", { headers: { "content-type": "text/html" } });
