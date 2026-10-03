// Duva's web app. For now it signs a human in and shows who is signed in. The real interface comes
// with the Approvals view.
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { components } from "@duva/openapi";
import { type Config, loadConfig, signedInClient, signIn, signOut } from "./session.ts";
import { strings } from "./strings.ts";

type State =
  | { status: "loading" }
  | { status: "signedOut"; config: Config }
  | { status: "signedIn"; config: Config; actor: components["schemas"]["Actor"] }
  | { status: "failed"; message: string };

function App() {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    (async () => {
      const config = await loadConfig();
      const client = await signedInClient(config);
      const { data: actor } = client ? await client.GET("/whoami") : {};
      setState(actor ? { status: "signedIn", config, actor } : { status: "signedOut", config });
    })().catch((error: unknown) => setState({ status: "failed", message: error instanceof Error ? error.message : String(error) }));
  }, []);

  switch (state.status) {
    case "loading":
      return <p>{strings.loading}</p>;
    case "failed":
      return <p role="alert">{strings.failed(state.message)}</p>;
    case "signedOut":
      return (
        <main>
          <h1>Duva</h1>
          <button type="button" onClick={() => signIn(state.config)}>
            {strings.signIn}
          </button>
        </main>
      );
    case "signedIn":
      return (
        <main>
          <h1>Duva</h1>
          <p>{strings.signedInAs(state.actor.email)}</p>
          {state.actor.admin && <p>{strings.admin}</p>}
          <button type="button" onClick={() => signOut(state.config)}>
            {strings.signOut}
          </button>
        </main>
      );
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
