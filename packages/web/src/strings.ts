// Every string the web app shows, in one place, so another language can be added later.
export const strings = {
  loading: "Loading…",
  signIn: "Sign in",
  signOut: "Sign out",
  signedInAs: (email: string) => `Signed in as ${email}.`,
  admin: "You are an admin.",
  failed: (message: string) => `Duva couldn't load: ${message}. Reload the page to try again.`,
};
