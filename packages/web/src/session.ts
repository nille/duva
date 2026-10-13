// The web app's sign-in: managed login with PKCE, or a sign-in link through the API (ADR-0041), and
// a session kept in this browser that renews itself with its refresh token. Passkeys are registered
// in managed login, which needs a session of its own there, so after a sign-in link the human signs
// in there first (docs/aws.md).
import { createDuvaClient, type DuvaClient, type WebAppConfig as Config } from "@duva/client";
import { addPasskeyUrl, finishSignIn, linkSession, renewed, type PendingSignIn, type Session, SessionExpired, signOutUrl, startSignIn } from "@duva/client/sign-in";

export type { Config };

const sessionKey = "duva.session";
const pendingKey = "duva.pendingSignIn";
// Where in the web app the human was when they went to sign in, as a link to an access request, to come back to.
const returnKey = "duva.returnTo";
// That the human went to managed login to add a passkey, or must sign in there first.
const passkeyKey = "duva.addingPasskey";
// Whether this page came back from managed login having added a passkey, which Settings says.
let addedPasskey = false;
// That this session came from a sign-in link, so Settings asks the human to register a passkey.
const linkKey = "duva.signedInByLink";
/** Where Settings shows the human's own page, with their passkeys and recovery address. */
export const settingsYou = "#/settings/you";

export async function loadConfig(): Promise<Config> {
  const response = await fetch("/config.json");
  if (!response.ok) throw new Error(`config.json answered ${response.status}`);
  return (await response.json()) as Config;
}

export async function signIn(config: Config): Promise<never> {
  const pending = await startSignIn(config.signIn);
  sessionStorage.setItem(pendingKey, JSON.stringify(pending));
  sessionStorage.setItem(returnKey, location.hash);
  location.assign(pending.authorizeUrl);
  return new Promise(() => {});
}

/** Signs in with a sign-in link's token, and keeps the session it gives. Answers whether the link worked. */
export async function followSignInLink(config: Config, token: string): Promise<boolean> {
  const { data } = await createDuvaClient(config.apiUrl)
    .POST("/sign-in-links/follow", { body: { token } })
    .catch(() => ({ data: undefined }));
  if (data === undefined) return false;
  save(linkSession(config.signIn, data));
  sessionStorage.setItem(linkKey, "yes");
  return true;
}

/** Confirms a new recovery address with the token of the link mailed to it. Answers the address, or why it failed, if Duva said. */
export async function confirmRecoveryAddress(config: Config, token: string): Promise<{ address: string } | { failed?: string }> {
  const { data, error } = await createDuvaClient(config.apiUrl)
    .POST("/recovery-address/confirm", { body: { token } })
    .catch(() => ({ data: undefined, error: undefined }));
  return data !== undefined ? { address: data.address } : { failed: error?.message };
}

/** Whether this tab signed in with a sign-in link, which asks the human to register a passkey. */
export const signedInByLink = () => sessionStorage.getItem(linkKey) !== null;

/** Sends the human to managed login to register a passkey, coming back to Settings. Never resolves, as the page leaves. */
export function addPasskey(config: Config): Promise<never> {
  sessionStorage.setItem(passkeyKey, "asked");
  location.assign(addPasskeyUrl(config.signIn));
  return new Promise(() => {});
}

/** Whether the human came back to this page from adding a passkey in managed login. */
export const passkeyAdded = () => addedPasskey;

export function signOut(config: Config): void {
  localStorage.removeItem(sessionKey);
  sessionStorage.removeItem(linkKey);
  location.assign(signOutUrl(config.signIn, config.signIn.redirectUri));
}

/**
 * A client signed in as the human whose session this browser keeps, or undefined if nobody is
 * signed in. Finishes a sign-in that managed login just redirected back from.
 */
export async function signedInClient(config: Config): Promise<DuvaClient | undefined> {
  const here = new URL(location.href);
  const pending = sessionStorage.getItem(pendingKey);
  if (pending !== null && (here.searchParams.has("code") || here.searchParams.has("error"))) {
    sessionStorage.removeItem(pendingKey);
    history.replaceState(null, "", `/${sessionStorage.getItem(returnKey) ?? ""}`);
    sessionStorage.removeItem(returnKey);
    save(await finishSignIn(config.signIn, JSON.parse(pending) as PendingSignIn, here));
    // Signed in to managed login to add a passkey, the human goes on to add it.
    if (sessionStorage.getItem(passkeyKey) === "signInFirst") return addPasskey(config);
  }
  if (sessionStorage.getItem(passkeyKey) === "asked") {
    sessionStorage.removeItem(passkeyKey);
    history.replaceState(null, "", `/${settingsYou}`);
    const result = here.searchParams.get("result");
    // Managed login has no session of the human's, as after a sign-in link, so they sign in there first.
    if (result === "invalid_session") {
      sessionStorage.setItem(passkeyKey, "signInFirst");
      return signIn(config);
    }
    addedPasskey = result === "success";
  }

  if (localStorage.getItem(sessionKey) === null) return undefined;
  // Each call renews the session first if its access token is about to expire, so an open tab stays signed in.
  return createDuvaClient(config.apiUrl, {
    fetch: async (request) => {
      const session = await current(config);
      if (session !== undefined) request.headers.set("authorization", `Bearer ${session.accessToken}`);
      return fetch(request);
    },
  });
}

/** The session this browser keeps, renewed if need be, or undefined once it has expired. */
async function current(config: Config): Promise<Session | undefined> {
  const stored = localStorage.getItem(sessionKey);
  if (stored === null) return undefined;
  try {
    const session = await renewed(config.signIn, JSON.parse(stored) as Session);
    save(session);
    return session;
  } catch (error) {
    if (!(error instanceof SessionExpired)) throw error;
    localStorage.removeItem(sessionKey);
    return undefined;
  }
}

const save = (session: Session) => localStorage.setItem(sessionKey, JSON.stringify(session));

/**
 * Posts a turn of Ask Coo to the conversation Lambda, on the web app's own domain under
 * /agent/, where CloudFront signs it for the Lambda. CloudFront's signature takes the Authorization
 * header, so the access token goes in a header of its own, and the body's SHA-256 with it, which
 * CloudFront needs to sign a POST. Answers undefined once the session has expired.
 */
export async function postTurn(config: Config, turn: { mailbox?: string; words?: string; harder?: boolean }, signal?: AbortSignal): Promise<Response | undefined> {
  const session = await current(config);
  if (session === undefined) return undefined;
  const body = JSON.stringify(turn);
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body))), (byte) => byte.toString(16).padStart(2, "0")).join("");
  // As infrastructure.ts's conversationPath and tokenHeader name them.
  return fetch("/agent/turns", {
    method: "POST",
    headers: { "content-type": "application/json", "x-duva-token": session.accessToken, "x-amz-content-sha256": hash },
    body,
    signal,
  });
}
