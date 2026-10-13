// Stands in for Cognito's managed login, for clients that sign in through a browser, such as the
// CLI. It speaks the same authorization code flow with PKCE, at the same paths, and issues access
// tokens from the test token issuer, with the scopes the client asked for.
//
// Its sign-in page takes the human's address in a form post, as if the human had entered it and
// the code they were emailed. An address that isn't a human in the organization gets the same page
// back and no code, as with Cognito. A human with passkeys is asked for one first, by the browser's
// WebAuthn with the page's host as the relying party, as Chrome's virtual authenticator answers in
// tests, or can have the code emailed instead. Signing in leaves managed login's session cookie,
// which /passkeys/add needs to register a passkey, as Cognito's does (docs/aws.md).
import { createHash, randomUUID } from "node:crypto";
import type { components } from "@duva/openapi";
import { mcpCallbackPath } from "../src/infrastructure.ts";
import { type TestTokenIssuer, userAdminScope } from "./token-issuer.ts";

/** The app client the stand-in signs clients in for. */
export const managedLoginClientId = "duva-test-client";

/** The app client MCP clients sign in through, by way of the MCP endpoint, which managed login sends back to only. */
export const mcpAppClientId = "duva-test-mcp-client";

/** Whether managed login may send a sign-in for the client back to the URI: the machine itself for its own, the MCP endpoint's callback for MCP's. */
const backTo = (client: string | null, redirectUri: string) =>
  client === managedLoginClientId
    ? /^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d+\//.test(redirectUri)
    : client === mcpAppClientId && URL.canParse(redirectUri) && new URL(redirectUri).pathname === mcpCallbackPath;

export function managedLogin({ ids, passkeys, issuer, accessTokenLifetime }: { ids: Map<string, string>; passkeys: Map<string, Passkey[]>; issuer: TestTokenIssuer; accessTokenLifetime: number }) {
  const codes = new Map<string, { id: string; client: string; challenge: string; redirectUri: string; scope: string }>();
  const refreshTokens = new Map<string, { id: string; client: string; scope: string }>();
  // Managed login's own sessions, by their cookie, each the human it signed in.
  const sessions = new Map<string, string>();
  const signedIn = (request: Request) => sessions.get(/(?:^|;\s*)managed-login=([^;]+)/.exec(request.headers.get("cookie") ?? "")?.[1] ?? "");

  async function authorize(request: Request, url: URL): Promise<Response> {
    const query = url.searchParams;
    const redirectUri = query.get("redirect_uri") ?? "";
    const client = query.get("client_id") ?? "";
    const valid = query.get("response_type") === "code" && query.get("code_challenge_method") === "S256" && query.get("code_challenge") !== null && backTo(client, redirectUri);
    if (!valid) return new Response("Bad sign-in request", { status: 400 });
    if (request.method !== "POST") return page();

    const form = new URLSearchParams(await request.text());
    const email = form.get("email") ?? "";
    const id = ids.get(email);
    if (id === undefined) return page();
    // A human with passkeys signs in with one, unless they chose the emailed code.
    const own = passkeys.get(id) ?? [];
    if (own.length > 0 && form.get("otp") === null && !own.some((passkey) => passkey.id === form.get("passkey"))) return passkeyPage(email);
    const code = randomUUID();
    codes.set(code, { id, client, challenge: query.get("code_challenge") ?? "", redirectUri, scope: query.get("scope") ?? "openid" });
    const back = new URL(redirectUri);
    back.searchParams.set("code", code);
    back.searchParams.set("state", query.get("state") ?? "");
    const session = randomUUID();
    sessions.set(session, id);
    return new Response(null, { status: 303, headers: { location: back.href, "set-cookie": `managed-login=${session}; Path=/; HttpOnly; SameSite=Lax` } });
  }

  /** Registers a passkey for the human managed login's session cookie signed in, and comes back as Cognito does. */
  async function addPasskey(request: Request, url: URL): Promise<Response> {
    const redirectUri = url.searchParams.get("redirect_uri") ?? "";
    if (!backTo(url.searchParams.get("client_id"), redirectUri)) return new Response("Bad passkey request", { status: 400 });
    const back = (result: string) => {
      const to = new URL(redirectUri);
      to.searchParams.set("result", result);
      return new Response(null, { status: 303, headers: { location: to.href } });
    };
    const id = signedIn(request);
    if (id === undefined) return back("invalid_session");
    if (request.method !== "POST") return addPasskeyPage(id, redirectUri);
    const credential = new URLSearchParams(await request.text()).get("credential") ?? "";
    if (credential === "") return addPasskeyPage(id, redirectUri);
    passkeys.set(id, [{ id: credential, name: "Device-bound Passkey", createdAt: new Date().toISOString() }, ...(passkeys.get(id) ?? [])]);
    return back("success");
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
      refreshTokens.set(refreshToken, { id: pending.id, client, scope: pending.scope });
      return Response.json(tokens(pending.id, client, pending.scope, refreshToken));
    }
    if (form.get("grant_type") === "refresh_token") {
      const session = refreshTokens.get(form.get("refresh_token") ?? "");
      // A human deleted from the user pool can't renew their session, which keeps its scopes.
      return session === undefined || session.client !== client || ![...ids.values()].includes(session.id) ? refused() : Response.json(tokens(session.id, client, session.scope));
    }
    return Response.json({ error: "unsupported_grant_type" }, { status: 400 });
  }

  const tokens = (id: string, client: string, scope: string, refreshToken?: string) => ({
    access_token: issuer.issue(id, accessTokenLifetime, client, scope),
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
      if (url.pathname === "/passkeys/add") return addPasskey(request, url);
      return undefined;
    },
    /** Ends every session, so no refresh token renews one any more, and managed login forgets who signed in. */
    endSessions() {
      refreshTokens.clear();
      sessions.clear();
    },
    /**
     * A new session for the human with the ID through the app client, as Cognito gives one signed in
     * through the API, with only the aws.cognito.signin.user.admin scope. Its refresh token renews here.
     */
    session(id: string, client: string) {
      const refreshToken = randomUUID();
      refreshTokens.set(refreshToken, { id, client, scope: userAdminScope });
      const { access_token, expires_in } = tokens(id, client, userAdminScope, refreshToken);
      return { accessToken: access_token, refreshToken, expiresIn: expires_in };
    },
  };
}

type Passkey = components["schemas"]["Passkey"];

const html = (body: string) => new Response(`<!doctype html><meta charset=utf-8>${body}`, { headers: { "content-type": "text/html" } });

const page = () => html("<form method=post><input name=email><button>Sign in</button></form>");

// The browser signs the challenge with a passkey made for this host, and the form posts which one.
const passkeyPage = (email: string) =>
  html(`<h1>Sign in with a passkey</h1>
<form method=post id=passkey><input type=hidden name=email value="${email}"><input type=hidden name=passkey><button type=button id=continue>Continue</button></form>
<form method=post><input type=hidden name=email value="${email}"><input type=hidden name=otp value=1><button>Email one-time password</button></form>
<script>
document.getElementById("continue").addEventListener("click", async () => {
  const credential = await navigator.credentials.get({ publicKey: { challenge: crypto.getRandomValues(new Uint8Array(32)), rpId: location.hostname, userVerification: "preferred" } });
  const form = document.getElementById("passkey");
  form.elements.passkey.value = credential.id;
  form.submit();
});
</script>`);

// The browser makes a passkey for this host and the human, and the form posts its ID.
const addPasskeyPage = (id: string, redirectUri: string) =>
  html(`<h1>Set up sign-in with a passkey</h1>
<form method=post id=add><input type=hidden name=credential><button type=button id=create>Add passkey</button></form>
<a href="${redirectUri}">Not now</a>
<script>
document.getElementById("create").addEventListener("click", async () => {
  const credential = await navigator.credentials.create({ publicKey: {
    rp: { id: location.hostname, name: "Duva" },
    user: { id: new TextEncoder().encode(${JSON.stringify(id)}), name: ${JSON.stringify(id)}, displayName: ${JSON.stringify(id)} },
    challenge: crypto.getRandomValues(new Uint8Array(32)),
    pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
    authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
  } });
  const form = document.getElementById("add");
  form.elements.credential.value = credential.id;
  form.submit();
});
</script>`);
