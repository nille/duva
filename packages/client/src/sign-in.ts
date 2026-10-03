// Signing a human in through managed login, with the authorization code flow and PKCE, and
// renewing their session. The web app and the CLI both sign in this way. Runs in browsers, Bun and Node.

/** Where and how a client signs in: the managed login domain, the client's ID and where to come back to. */
export interface SignInConfig {
  /** The managed login domain's URL, like https://duva-123456789012.auth.eu-north-1.amazoncognito.com. */
  url: string;
  clientId: string;
  redirectUri: string;
}

/** A signed-in human's session. */
export interface Session {
  accessToken: string;
  refreshToken: string;
  /** When the access token expires, in milliseconds since the epoch. */
  expiresAt: number;
}

/** A sign-in under way: the page to send the human to, and what finishing it needs. */
export interface PendingSignIn {
  authorizeUrl: string;
  state: string;
  verifier: string;
}

/** Thrown when a session can't be renewed, so the human must sign in again. */
export class SessionExpired extends Error {
  constructor() {
    super("The session has expired.");
    this.name = "SessionExpired";
  }
}

export async function startSignIn(config: SignInConfig): Promise<PendingSignIn> {
  const verifier = random();
  const state = random();
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  const url = new URL("/oauth2/authorize", config.url);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: "openid email",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  return { authorizeUrl: url.href, state, verifier };
}

/**
 * Finishes a sign-in from the URL managed login redirected to. Throws if the URL doesn't belong
 * to this sign-in, or managed login refused it.
 */
export async function finishSignIn(config: SignInConfig, pending: PendingSignIn, redirectedTo: URL): Promise<Session> {
  const parameters = redirectedTo.searchParams;
  if (parameters.get("state") !== pending.state) throw new Error("The sign-in came back for another sign-in.");
  const error = parameters.get("error");
  if (error !== null) throw new Error(`Sign-in failed: ${parameters.get("error_description") ?? error}.`);
  const code = parameters.get("code");
  if (code === null) throw new Error("Sign-in came back without a code.");
  const tokens = await token(config, {
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri,
    code_verifier: pending.verifier,
  });
  if (tokens.refresh_token === undefined) throw new Error("Sign-in gave no refresh token.");
  return session(tokens, tokens.refresh_token);
}

/**
 * The session, renewed with its refresh token if its access token expires within a minute.
 * Throws SessionExpired once the refresh token no longer works.
 */
export async function renewed(config: SignInConfig, current: Session): Promise<Session> {
  if (current.expiresAt - Date.now() > 60_000) return current;
  // Managed login keeps the refresh token, so a renewed session has the same one.
  const tokens = await token(config, { grant_type: "refresh_token", refresh_token: current.refreshToken });
  return session(tokens, tokens.refresh_token ?? current.refreshToken);
}

/** Where to send the human to sign out of managed login, coming back to `returnTo`. */
export function signOutUrl(config: SignInConfig, returnTo: string): string {
  const url = new URL("/logout", config.url);
  url.search = new URLSearchParams({ client_id: config.clientId, logout_uri: returnTo }).toString();
  return url.href;
}

interface Tokens {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

async function token(config: SignInConfig, grant: Record<string, string>): Promise<Tokens> {
  const response = await fetch(new URL("/oauth2/token", config.url), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: config.clientId, ...grant }),
  });
  const body = (await response.json().catch(() => ({}))) as Partial<Tokens> & { error?: string };
  if (body.error === "invalid_grant" && grant.grant_type === "refresh_token") throw new SessionExpired();
  if (!response.ok || body.access_token === undefined || body.expires_in === undefined) {
    throw new Error(`Managed login answered ${response.status}${body.error ? ` ${body.error}` : ""}.`);
  }
  return body as Tokens;
}

const session = (tokens: Tokens, refreshToken: string): Session => ({
  accessToken: tokens.access_token,
  refreshToken,
  expiresAt: Date.now() + tokens.expires_in * 1000,
});

const random = () => base64url(crypto.getRandomValues(new Uint8Array(32)));

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
