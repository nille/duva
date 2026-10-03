// Duva's web app. A human signs in and lands on the Approvals view, where they decide what the
// agents they sponsor ask to send.
import "@fontsource-variable/source-serif-4/opsz.css";
import "./styles.css";
import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { DuvaClient } from "@duva/client";
import type { components } from "@duva/openapi";
import { Approvals } from "./approvals.tsx";
import { type Config, loadConfig, signedInClient, signIn, signOut } from "./session.ts";
import { strings } from "./strings.ts";

type State =
  | { status: "loading" }
  | { status: "signedOut"; config: Config; ended?: boolean }
  | { status: "signedIn"; config: Config; client: DuvaClient; actor: components["schemas"]["Human"] }
  | { status: "failed"; message: string };

function App() {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    (async () => {
      const config = await loadConfig();
      const client = await signedInClient(config);
      const { data: actor, response } = client ? await client.GET("/whoami") : {};
      // Only humans sign in to the web app. Agents call the API with their keys.
      if (client && actor?.kind === "human") setState({ status: "signedIn", config, client, actor });
      else setState({ status: "signedOut", config, ended: response?.status === 401 });
    })().catch((error: unknown) => setState({ status: "failed", message: error instanceof Error ? error.message : String(error) }));
  }, []);

  const ended = useCallback(() => setState((current) => (current.status === "signedIn" ? { status: "signedOut", config: current.config, ended: true } : current)), []);

  switch (state.status) {
    case "loading":
      return (
        <p className="boot" role="status">
          {strings.loading}
        </p>
      );
    case "failed":
      return (
        <p className="boot notice notice-alert" role="alert">
          {strings.failed(state.message)}
        </p>
      );
    case "signedOut": {
      const copy = state.ended ? strings.sessionEnded : strings.signedOut;
      return (
        <main className="door">
          <p className="wordmark">{strings.nav.label}</p>
          <h1>{copy.title}</h1>
          <p>{copy.lead}</p>
          <button type="button" className="button button-primary" onClick={() => signIn(state.config)}>
            {strings.signIn}
          </button>
        </main>
      );
    }
    case "signedIn":
      return (
        <>
          <header className="bar">
            <p className="wordmark">{strings.nav.label}</p>
            <nav aria-label={strings.nav.label}>
              <a href="/" aria-current="page">
                {strings.nav.approvals}
              </a>
            </nav>
            <div className="who">
              <span className="who-email">{strings.signedInAs(state.actor.email, state.actor.admin)}</span>
              <button type="button" className="button button-quiet button-small" onClick={() => signOut(state.config)}>
                {strings.signOut}
              </button>
            </div>
          </header>
          <Approvals client={state.client} sponsor={state.actor.email} onSignedOut={ended} />
        </>
      );
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
