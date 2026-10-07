// The web app's sign-in: managed login with PKCE, and a session kept in this browser that renews
// itself with its refresh token.
import { createDuvaClient, type DuvaClient, type WebAppConfig as Config } from "@duva/client";
import { finishSignIn, renewed, type PendingSignIn, type Session, SessionExpired, signOutUrl, startSignIn } from "@duva/client/sign-in";

export type { Config };

const sessionKey = "duva.session";
const pendingKey = "duva.pendingSignIn";
// Where in the web app the human was when they went to sign in, as a link to an access request, to come back to.
const returnKey = "duva.returnTo";

export async function loadConfig(): Promise<Config> {
  const response = await fetch("/config.json");
  if (!response.ok) throw new Error(`config.json answered ${response.status}`);
  return (await response.json()) as Config;
}

export async function signIn(config: Config): Promise<void> {
  const pending = await startSignIn(config.signIn);
  sessionStorage.setItem(pendingKey, JSON.stringify(pending));
  sessionStorage.setItem(returnKey, location.hash);
  location.assign(pending.authorizeUrl);
}

export function signOut(config: Config): void {
  localStorage.removeItem(sessionKey);
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
