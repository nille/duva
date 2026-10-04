// Duva's web app. A human signs in and lands on the Inbox of their personal mailbox, where they read
// their mail. Sponsors reach the Approvals view from the bar, where they decide what the agents they
// sponsor ask to send.
import "@fontsource-variable/source-serif-4/opsz.css";
import "./styles.css";
import { StrictMode, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { DuvaClient } from "@duva/client";
import type { components } from "@duva/openapi";
import { Approvals } from "./approvals.tsx";
import { approvalChanges, type Connection, type Follow, mailChanges, type MailboxChange, SignedOut, useFeeds } from "./feed.ts";
import { Inbox } from "./inbox.tsx";
import { type Config, loadConfig, signedInClient, signIn, signOut } from "./session.ts";
import { strings } from "./strings.ts";
import { ThreadView } from "./thread.tsx";

type Human = components["schemas"]["Human"];
type Mailbox = components["schemas"]["Mailbox"];

type State =
  | { status: "loading" }
  | { status: "signedOut"; config: Config; ended?: boolean }
  | { status: "signedIn"; config: Config; client: DuvaClient; actor: Human }
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
      return <SignedIn config={state.config} client={state.client} actor={state.actor} onSignedOut={ended} />;
  }
}

/** Where in the web app the human is, from the address's hash, so links and the back button work without a server. */
type Route = { view: "inbox" } | { view: "approvals" } | { view: "thread"; id: string };

function routeOf(hash: string): Route {
  if (hash === "#/approvals") return { view: "approvals" };
  const thread = /^#\/threads\/(.+)$/.exec(hash)?.[1];
  return thread === undefined ? { view: "inbox" } : { view: "thread", id: decodeURIComponent(thread) };
}

function useRoute(): Route {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const changed = () => setHash(location.hash);
    addEventListener("hashchange", changed);
    return () => removeEventListener("hashchange", changed);
  }, []);
  return routeOf(hash);
}

type Mailboxes = { status: "loading" } | { status: "failed" } | { status: "listed"; mine?: Mailbox; sponsor: boolean };

/** The signed-in app: the bar, and the view the route names, kept current by following the change feeds. */
function SignedIn({ config, client, actor, onSignedOut }: { config: Config; client: DuvaClient; actor: Human; onSignedOut: () => void }) {
  const route = useRoute();
  const [mailboxes, setMailboxes] = useState<Mailboxes>({ status: "loading" });
  const [waiting, setWaiting] = useState<number>();
  const [version, setVersion] = useState(0);
  const [connection, setConnection] = useState<Connection>();

  const listMailboxes = useCallback(async () => {
    setMailboxes({ status: "loading" });
    const { data, response } = await client.GET("/mailboxes").catch(() => ({ data: undefined, response: undefined }));
    if (response?.status === 401) return onSignedOut();
    if (data === undefined) return setMailboxes({ status: "failed" });
    // The human's own mailbox comes first. Those of agents they sponsor come in #29.
    setMailboxes({ status: "listed", mine: data.mailboxes.find((mailbox) => mailbox.owner === actor.id), sponsor: data.mailboxes.some((mailbox) => mailbox.owner !== actor.id) });
  }, [client, actor.id, onSignedOut]);
  useEffect(() => {
    void listMailboxes();
  }, [listMailboxes]);

  // Views that follow the feeds themselves, such as Approvals.
  const followers = useRef(new Set<(changes: MailboxChange[]) => Promise<void>>());
  const follow = useCallback<Follow>((listener) => {
    followers.current.add(listener);
    return () => followers.current.delete(listener);
  }, []);

  const mine = mailboxes.status === "listed" ? mailboxes.mine : undefined;
  useFeeds(client, {
    interval: config.pollInterval,
    async onChanges(changes, first) {
      for (const listener of [...followers.current]) await listener(changes);
      if (first || changes.some(({ change }) => approvalChanges.has(change.type))) {
        const { data, response } = await client.GET("/approvals");
        if (response.status === 401) throw new SignedOut();
        if (data !== undefined) setWaiting(data.approvals.length);
      }
      // The first read passes mail that may have arrived after the view listed it, so it counts too.
      if (changes.some(({ mailbox, change }) => mailbox === mine?.id && mailChanges.has(change.type))) setVersion((current) => current + 1);
    },
    onConnection: setConnection,
    onSignedOut,
  });

  // A screen reader follows the human to the view they opened, and the page starts at its top.
  const navigated = useRef(false);
  const routeKey = route.view === "thread" ? `thread/${route.id}` : route.view;
  useEffect(() => {
    if (!navigated.current) {
      navigated.current = true;
      return;
    }
    scrollTo(0, 0);
    const title = document.querySelector<HTMLElement>("main h1");
    if (title !== null) {
      title.tabIndex = -1;
      title.focus();
    }
  }, [routeKey]);
  useEffect(() => {
    if (route.view === "approvals") document.title = strings.title(strings.approvals.title);
  }, [route.view]);

  const sponsor = (mailboxes.status === "listed" && mailboxes.sponsor) || (waiting ?? 0) > 0;
  return (
    <>
      <header className="bar">
        <p className="wordmark">{strings.nav.label}</p>
        <nav aria-label={strings.nav.label}>
          <a href="#/" aria-current={route.view === "approvals" ? undefined : "page"}>
            {strings.nav.inbox}
          </a>
          {sponsor && (
            <a href="#/approvals" aria-current={route.view === "approvals" ? "page" : undefined}>
              {strings.nav.approvals}
              {waiting !== undefined && waiting > 0 && (
                <>
                  <span className="nav-count" aria-hidden="true">
                    {waiting}
                  </span>
                  <span className="visually-hidden">{strings.nav.waiting(waiting)}</span>
                </>
              )}
            </a>
          )}
        </nav>
        <div className="who">
          <span className="who-email">{strings.signedInAs(actor.email, actor.admin)}</span>
          <button type="button" className="button button-quiet button-small" onClick={() => signOut(config)}>
            {strings.signOut}
          </button>
        </div>
      </header>
      {route.view === "approvals" ? (
        <Approvals client={client} sponsor={actor.email} connection={connection} follow={follow} onSignedOut={onSignedOut} />
      ) : mailboxes.status === "loading" ? (
        <main className="desk" aria-busy="true" />
      ) : mailboxes.status === "failed" ? (
        <main className="desk">
          <div className="notice notice-alert failed-listing" role="alert">
            <p>{strings.mailboxesFailed}</p>
            <button type="button" className="button button-small" onClick={() => void listMailboxes()}>
              {strings.inbox.retry}
            </button>
          </div>
        </main>
      ) : mine === undefined ? (
        <main className="desk">
          <section className="empty" aria-labelledby="empty-title">
            <h1 id="empty-title">{strings.inbox.noMailboxTitle}</h1>
            <p>{strings.inbox.noMailboxLead}</p>
            {sponsor && (
              <p>
                <a href="#/approvals">{strings.inbox.noMailboxSponsor}</a>
              </p>
            )}
          </section>
        </main>
      ) : route.view === "thread" ? (
        <ThreadView key={route.id} client={client} mailbox={mine} id={route.id} me={actor.id} version={version} onSignedOut={onSignedOut} />
      ) : (
        <Inbox client={client} mailbox={mine} version={version} connection={connection} onSignedOut={onSignedOut} />
      )}
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
