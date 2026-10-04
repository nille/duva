// Duva's web app. A human signs in and lands on the Inbox of their personal mailbox, where they read
// their mail. Sponsors also read their agents' mailboxes, listed beside their own, and reach the
// Approvals view from the bar, where they decide what the agents they sponsor ask to send.
import "@fontsource-variable/source-serif-4/opsz.css";
import "./styles.css";
import { StrictMode, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { DuvaClient } from "@duva/client";
import type { components } from "@duva/openapi";
import { Approvals } from "./approvals.tsx";
import { approvalChanges, type Connection, type Follow, mailChanges, type MailboxChange, SignedOut, useFeeds } from "./feed.ts";
import { Inbox } from "./inbox.tsx";
import { type AgentMailbox, MailboxList, mailboxHref } from "./mailboxes.tsx";
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

/**
 * Where in the web app the human is, from the address's hash, so links and the back button work
 * without a server. A view without a mailbox is in the human's own.
 */
type Route = { view: "approvals" } | { view: "inbox"; mailbox?: string } | { view: "thread"; mailbox?: string; id: string };

function routeOf(hash: string): Route {
  if (hash === "#/approvals") return { view: "approvals" };
  const decoded = (mailbox: string | undefined) => (mailbox === undefined ? undefined : decodeURIComponent(mailbox));
  const [, mailbox, thread] = /^#\/(?:mailboxes\/([^/]+)\/)?threads\/(.+)$/.exec(hash) ?? [];
  if (thread !== undefined) return { view: "thread", mailbox: decoded(mailbox), id: decodeURIComponent(thread) };
  return { view: "inbox", mailbox: decoded(/^#\/mailboxes\/([^/]+)\/?$/.exec(hash)?.[1]) };
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

type Mailboxes = { status: "loading" } | { status: "failed" } | { status: "listed"; mine?: Mailbox; agents: AgentMailbox[] };

/** The signed-in app: the bar, and the view the route names, kept current by following the change feeds. */
function SignedIn({ config, client, actor, onSignedOut }: { config: Config; client: DuvaClient; actor: Human; onSignedOut: () => void }) {
  const route = useRoute();
  const [mailboxes, setMailboxes] = useState<Mailboxes>({ status: "loading" });
  const [waiting, setWaiting] = useState<number>();
  // How many changes to each mailbox's mail the app has seen, so its views read it again when it grows.
  const [versions, setVersions] = useState<ReadonlyMap<string, number>>(new Map());
  const [unread, setUnread] = useState<ReadonlyMap<string, number>>(new Map());
  const [connection, setConnection] = useState<Connection>();

  const listMailboxes = useCallback(async () => {
    setMailboxes({ status: "loading" });
    const { data, response } = await client.GET("/mailboxes").catch(() => ({ data: undefined, response: undefined }));
    if (response?.status === 401) return onSignedOut();
    if (data === undefined) return setMailboxes({ status: "failed" });
    const theirs = data.mailboxes.filter((mailbox) => mailbox.owner !== actor.id);
    // The other mailboxes a human can read are those of agents they sponsor, which are named for them.
    const { data: sponsored } = theirs.length === 0 ? { data: { agents: [] } } : await client.GET("/agents").catch(() => ({ data: undefined }));
    const names = new Map(sponsored?.agents.map((agent) => [agent.id, agent.name]));
    const agents = theirs.map((mailbox) => ({ mailbox, agent: names.get(mailbox.owner) ?? mailbox.defaultAddress })).sort((a, b) => a.agent.localeCompare(b.agent));
    setMailboxes({ status: "listed", mine: data.mailboxes.find((mailbox) => mailbox.owner === actor.id), agents });
  }, [client, actor.id, onSignedOut]);
  useEffect(() => {
    void listMailboxes();
  }, [listMailboxes]);

  /**
   * Reads how many threads in each mailbox's Inbox are unread. A count Duva can't give now stays as
   * it was until the mailbox's mail changes again.
   */
  const countUnread = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return;
      const counts = await Promise.all(
        ids.map(async (mailbox) => {
          const { data, response } = await client.GET("/mailboxes/{mailbox}", { params: { path: { mailbox } } }).catch(() => ({ data: undefined, response: undefined }));
          if (response?.status === 401) throw new SignedOut();
          return [mailbox, data?.unread] as const;
        }),
      );
      setUnread((current) => new Map([...current, ...counts.flatMap(([mailbox, count]) => (count === undefined ? [] : [[mailbox, count] as const]))]));
    },
    [client],
  );
  // The column lists every mailbox's count once they are listed, and the feeds keep them current.
  useEffect(() => {
    if (mailboxes.status !== "listed" || mailboxes.agents.length === 0) return;
    const ids = [...(mailboxes.mine === undefined ? [] : [mailboxes.mine.id]), ...mailboxes.agents.map(({ mailbox }) => mailbox.id)];
    countUnread(ids).catch((error: unknown) => {
      if (error instanceof SignedOut) onSignedOut();
    });
  }, [mailboxes, countUnread, onSignedOut]);

  // Views that follow the feeds themselves, such as Approvals.
  const followers = useRef(new Set<(changes: MailboxChange[]) => Promise<void>>());
  const follow = useCallback<Follow>((listener) => {
    followers.current.add(listener);
    return () => followers.current.delete(listener);
  }, []);

  useFeeds(client, {
    interval: config.pollInterval,
    async onChanges(changes, first) {
      for (const listener of [...followers.current]) await listener(changes);
      if (first || changes.some(({ change }) => approvalChanges.has(change.type))) {
        const { data, response } = await client.GET("/approvals");
        if (response.status === 401) throw new SignedOut();
        if (data !== undefined) setWaiting(data.approvals.length);
      }
      // The first read passes mail that may have arrived after the views listed it, so it counts too.
      const changed = new Set(changes.filter(({ change }) => mailChanges.has(change.type)).map(({ mailbox }) => mailbox));
      if (changed.size > 0) {
        setVersions((current) => new Map([...current, ...[...changed].map((mailbox) => [mailbox, (current.get(mailbox) ?? 0) + 1] as const)]));
      }
      if (mailboxes.status === "listed" && mailboxes.agents.length > 0) await countUnread([...changed]);
    },
    onConnection: setConnection,
    onSignedOut,
  });

  // A screen reader follows the human to the view they opened, and the page starts at its top.
  const navigated = useRef(false);
  const routeKey = route.view === "approvals" ? route.view : `${route.mailbox ?? ""}/${route.view === "thread" ? route.id : ""}`;
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

  const listed = mailboxes.status === "listed" ? mailboxes : undefined;
  const mine = listed?.mine;
  const sponsor = (listed !== undefined && listed.agents.length > 0) || (waiting ?? 0) > 0;
  // The mailbox the route names, the human's own if it names none.
  const agent = route.view !== "approvals" && route.mailbox !== undefined ? listed?.agents.find(({ mailbox }) => mailbox.id === route.mailbox) : undefined;
  const shown = route.view === "approvals" ? undefined : route.mailbox === undefined ? mine : (agent?.mailbox ?? (mine?.id === route.mailbox ? mine : undefined));
  const base = shown === undefined ? "#/" : mailboxHref(shown, shown === mine);

  const mail =
    route.view === "approvals" ? undefined : mailboxes.status === "loading" ? (
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
    ) : shown === undefined ? (
      <main className="desk">
        <section className="empty" aria-labelledby="empty-title">
          {route.mailbox === undefined ? (
            <>
              <h1 id="empty-title">{strings.inbox.noMailboxTitle}</h1>
              <p>{strings.inbox.noMailboxLead}</p>
              {sponsor && (
                <p>
                  <a href="#/approvals">{strings.inbox.noMailboxSponsor}</a>
                </p>
              )}
            </>
          ) : (
            <>
              <h1 id="empty-title">{strings.inbox.unknownMailboxTitle}</h1>
              <p>{strings.inbox.unknownMailboxLead}</p>
            </>
          )}
        </section>
      </main>
    ) : route.view === "thread" ? (
      <ThreadView
        key={`${shown.id}/${route.id}`}
        client={client}
        mailbox={shown}
        base={base}
        id={route.id}
        me={actor.id}
        agent={agent?.agent}
        version={versions.get(shown.id) ?? 0}
        onSignedOut={onSignedOut}
      />
    ) : (
      <Inbox key={shown.id} client={client} mailbox={shown} base={base} agent={agent?.agent} version={versions.get(shown.id) ?? 0} connection={connection} onSignedOut={onSignedOut} />
    );

  return (
    <>
      <header className="bar">
        <p className="wordmark">{strings.nav.label}</p>
        <nav aria-label={strings.nav.label}>
          <a href={base} aria-current={route.view === "approvals" ? undefined : "page"}>
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
      ) : listed !== undefined && listed.agents.length > 0 ? (
        <div className={route.view === "thread" ? "mail mail-reading" : "mail"}>
          <MailboxList mine={mine} agents={listed.agents} unread={unread} current={shown?.id} />
          {mail}
        </div>
      ) : (
        mail
      )}
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
