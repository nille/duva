import { renewed, SessionExpired, type SignInConfig } from "@duva/client/sign-in";
import { readSession, saveSession } from "./config.ts";

/** The signed-in human's access token, renewing the session first if it's about to expire. */
export async function accessToken(signIn: SignInConfig | undefined): Promise<string> {
  const session = await readSession();
  if (signIn === undefined || session === undefined) throw new Error("Nobody has signed in. Run duva login.");
  try {
    const current = await renewed(signIn, session);
    if (current !== session) await saveSession(current);
    return current.accessToken;
  } catch (error) {
    if (error instanceof SessionExpired) throw new Error("Your session has expired. Run duva login to sign in again.");
    throw new Error(
      `Couldn't renew your session at ${signIn.url}: ${error instanceof Error ? error.message : error} Try again, or run duva login to sign in again.`,
    );
  }
}
