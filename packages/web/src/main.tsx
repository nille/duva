// Duva's web app. A human signs in and lands on the Inbox of their personal mailbox, where they read,
// organize, write and send their mail, with its views in the side column. Sponsors also read their
// agents' mailboxes, listed there above the views, and reach the Approvals view from the bar, where
// they decide what the agents they sponsor ask to send. Every human reaches Settings from the bar
// too, where they choose how times and dates show, admins the organization's settings and sponsors
// their agents'.
import "@fontsource-variable/source-serif-4/opsz.css";
import "./styles.css";
import { StrictMode, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { DuvaClient } from "@duva/client";
import type { components } from "@duva/openapi";
import { Approvals } from "./approvals.tsx";
import { Composer } from "./compose.tsx";
import { defaultPreferences, type Preferences, PreferencesContext } from "./dates.ts";
import { Drafts } from "./drafts.tsx";
import { approvalChanges, type Connection, draftChanges, type Follow, labelChanges, mailChanges, type MailboxChange, SignedOut, useFeeds } from "./feed.ts";
import { ThreadIndex } from "./inbox.tsx";
import { type AgentMailbox, MailboxList, mailboxHref } from "./mailboxes.tsx";
import { type Config, loadConfig, signedInClient, signIn, signOut } from "./session.ts";
import { Settings } from "./settings.tsx";
import { strings } from "./strings.ts";
import type { Done, Label } from "./organize.tsx";
import { ThreadView } from "./thread.tsx";
import { hrefOf, MailViews, pathOf, titleOf, type View, viewOf } from "./views.tsx";

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
 * without a server. A listing or thread without a mailbox is in the human's own, and drafts are
 * always the human's own, since only a mailbox's owner writes in it. A thread knows the view it
 * was opened from, to go back there.
 */
type Route =
  | { view: "approvals" | "settings" }
  | { view: "list"; mailbox?: string; list: View }
  | { view: "thread"; mailbox?: string; id: string; from: View }
  | { view: "drafts" | "write" }
  | { view: "draft"; id: string };

function routeOf(hash: string): Route {
  if (hash === "#/approvals") return { view: "approvals" };
  if (hash === "#/settings") return { view: "settings" };
  if (hash === "#/drafts") return { view: "drafts" };
  if (hash === "#/write") return { view: "write" };
  const draft = /^#\/drafts\/(.+)$/.exec(hash)?.[1];
  if (draft !== undefined) return { view: "draft", id: decodeURIComponent(draft) };
  const path = hash.replace(/^#\/?/, "");
  const [, mailbox, inMailbox] = /^mailboxes\/([^/]+)\/?(.*)$/.exec(path) ?? [undefined, undefined, path];
  const decoded = mailbox === undefined ? undefined : decodeURIComponent(mailbox);
  const [, thread, from] = /^threads\/([^?]+)(?:\?from=(.*))?$/.exec(inMailbox ?? "") ?? [];
  if (thread !== undefined) return { view: "thread", mailbox: decoded, id: decodeURIComponent(thread), from: viewOf(decodeURIComponent(from ?? "")) ?? { label: "inbox" } };
  return { view: "list", mailbox: decoded, list: viewOf(inMailbox ?? "") ?? { label: "inbox" } };
}

function useRoute(): Route & { hash: string } {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const changed = () => setHash(location.hash);
    addEventListener("hashchange", changed);
    return () => removeEventListener("hashchange", changed);
  }, []);
  return { ...routeOf(hash), hash };
}

type Mailboxes = { status: "loading" } | { status: "failed" } | { status: "listed"; mine?: Mailbox; agents: AgentMailbox[]; sponsorsAgents: boolean };

/** The signed-in app: the bar, and the view the route names, kept current by following the change feeds. */
function SignedIn({ config, client, actor, onSignedOut }: { config: Config; client: DuvaClient; actor: Human; onSignedOut: () => void }) {
  const route = useRoute();
  const [mailboxes, setMailboxes] = useState<Mailboxes>({ status: "loading" });
  const [waiting, setWaiting] = useState<number>();
  // How many changes to each mailbox's mail the app has seen, so its views read it again when it grows.
  const [versions, setVersions] = useState<ReadonlyMap<string, number>>(new Map());
  const [unread, setUnread] = useState<ReadonlyMap<string, number>>(new Map());
  const [connection, setConnection] = useState<Connection>();
  const [labels, setLabels] = useState<Label[]>([]);
  const [relabelled, setRelabelled] = useState(0);
  // What the human last did, said in the view where it shows, until they go elsewhere.
  const [done, setDone] = useState<{ done: Done; at: string }>();
  // Times and dates show as the browser's language does until the human's preferences are read.
  const [preferences, setPreferences] = useState<Preferences>(defaultPreferences);

  useEffect(() => {
    void (async () => {
      const { data, response } = await client.GET("/preferences").catch(() => ({ data: undefined, response: undefined }));
      if (response?.status === 401) return onSignedOut();
      if (data !== undefined) setPreferences(data);
    })();
  }, [client, onSignedOut]);

  const listMailboxes = useCallback(async () => {
    setMailboxes({ status: "loading" });
    const { data, response } = await client.GET("/mailboxes").catch(() => ({ data: undefined, response: undefined }));
    if (response?.status === 401) return onSignedOut();
    if (data === undefined) return setMailboxes({ status: "failed" });
    const theirs = data.mailboxes.filter((mailbox) => mailbox.owner !== actor.id);
    // The other mailboxes a human can read are those of agents they sponsor, which are named for them.
    // A sponsor's agents may have no mailbox, and the sponsor still sets their settings.
    const { data: sponsored } = await client.GET("/agents").catch(() => ({ data: undefined }));
    const names = new Map(sponsored?.agents.map((agent) => [agent.id, agent.name]));
    const agents = theirs.map((mailbox) => ({ mailbox, agent: names.get(mailbox.owner) ?? mailbox.defaultAddress })).sort((a, b) => a.agent.localeCompare(b.agent));
    setMailboxes({ status: "listed", mine: data.mailboxes.find((mailbox) => mailbox.owner === actor.id), agents, sponsorsAgents: agents.length > 0 || (sponsored?.agents.length ?? 0) > 0 });
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
    hiddenInterval: config.hiddenPollInterval,
    async onChanges(changes, first) {
      for (const listener of [...followers.current]) await listener(changes);
      if (first || changes.some(({ change }) => approvalChanges.has(change.type))) {
        const { data, response } = await client.GET("/approvals");
        if (response.status === 401) throw new SignedOut();
        if (data !== undefined) setWaiting(data.approvals.length);
      }
      // The first read passes mail that may have arrived after the views listed it, so it counts too.
      const mail = new Set(changes.filter(({ change }) => mailChanges.has(change.type)).map(({ mailbox }) => mailbox));
      const changed = new Set([...mail, ...changes.filter(({ change }) => draftChanges.has(change.type) || labelChanges.has(change.type)).map(({ mailbox }) => mailbox)]);
      if (changed.size > 0) {
        setVersions((current) => new Map([...current, ...[...changed].map((mailbox) => [mailbox, (current.get(mailbox) ?? 0) + 1] as const)]));
      }
      if (mailboxes.status === "listed" && mailboxes.agents.length > 0) await countUnread([...mail]);
    },
    onConnection: setConnection,
    onSignedOut,
  });

  // A screen reader follows the human to the view they opened, and the page starts at its top.
  const navigated = useRef(false);
  // The mailbox the route names, if it names one.
  const named = "mailbox" in route ? route.mailbox : undefined;
  // The views outside the mail.
  const away = route.view === "approvals" || route.view === "settings";
  const routeKey = away ? route.view : `${route.view}/${named ?? ""}/${"id" in route ? route.id : route.view === "list" ? pathOf(route.list) : ""}`;
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
  // What was done stops being said once the human goes elsewhere.
  useEffect(() => {
    setDone((current) => (current === undefined || current.at === location.hash ? current : undefined));
  }, [routeKey]);
  // The title counts what waits, so a sponsor sees a new request from another tab.
  useEffect(() => {
    if (route.view === "approvals") document.title = strings.title(strings.approvals.title, waiting);
  }, [route.view, waiting]);

  const listed = mailboxes.status === "listed" ? mailboxes : undefined;
  const mine = listed?.mine;
  const sponsor = listed?.sponsorsAgents === true || (waiting ?? 0) > 0;
  // The mailbox the route is in, the human's own if it names none.
  const agent = named !== undefined ? listed?.agents.find(({ mailbox }) => mailbox.id === named) : undefined;
  const shown = away ? undefined : named === undefined ? mine : (agent?.mailbox ?? (mine?.id === named ? mine : undefined));
  const base = shown === undefined ? "#/" : mailboxHref(shown, shown === mine);
  const version = shown === undefined ? 0 : (versions.get(shown.id) ?? 0);

  // The open mailbox's labels, with their unread counts, are read again whenever its mail changes, and only the latest read counts.
  const labelsRead = useRef(0);
  useEffect(() => {
    const read = ++labelsRead.current;
    if (shown === undefined) return setLabels([]);
    void (async () => {
      const { data, response } = await client.GET("/mailboxes/{mailbox}/labels", { params: { path: { mailbox: shown.id } } }).catch(() => ({ data: undefined, response: undefined }));
      if (response?.status === 401) return onSignedOut();
      if (data !== undefined && read === labelsRead.current) setLabels(data.labels);
    })();
  }, [client, shown, version, relabelled, onSignedOut]);

  // Something done to the mail changes the labels' counts, so they are read again at once.
  const showDone = (what: Done | undefined) => {
    setDone(what === undefined ? undefined : { done: what, at: location.hash });
    setRelabelled((current) => current + 1);
  };
  // The view the side column marks open: the one listed, or the one a thread was opened from.
  const viewed = route.view === "list" ? route.list : route.view === "thread" ? route.from : undefined;
  const writing = route.view === "drafts" || route.view === "draft" || route.view === "write";

  const mail =
    away ? undefined : mailboxes.status === "loading" ? (
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
          {named === undefined ? (
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
        id={route.id}
        me={actor.id}
        agent={agent?.agent}
        labels={labels}
        back={hrefOf(route.from, base)}
        backTo={titleOf(route.from, labels, agent?.agent)}
        version={version}
        onDone={showDone}
        onSignedOut={onSignedOut}
      />
    ) : route.view === "draft" || route.view === "write" ? (
      <Composer key={routeKey} client={client} mailbox={shown} id={route.view === "draft" ? route.id : undefined} version={version} onSignedOut={onSignedOut} />
    ) : route.view !== "list" ? (
      <Drafts client={client} mailbox={shown} version={version} onSignedOut={onSignedOut} />
    ) : (
      <ThreadIndex
        key={`${shown.id}/${pathOf(route.list)}`}
        client={client}
        mailbox={shown}
        base={base}
        agent={agent?.agent}
        view={route.list}
        labels={labels}
        version={version}
        connection={connection}
        done={done !== undefined && done.at === route.hash ? done.done : undefined}
        onDone={showDone}
        onSignedOut={onSignedOut}
      />
    );

  return (
    <PreferencesContext value={preferences}>
      <header className="bar">
        <p className="wordmark">{strings.nav.label}</p>
        <nav aria-label={strings.nav.label}>
          {/* The mail's own views are in the side column, so the bar names only the mail as a whole. */}
          <a href={base} aria-current={away ? undefined : "page"}>
            {strings.nav.mail}
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
          <a href="#/settings" aria-current={route.view === "settings" ? "page" : undefined}>
            {strings.nav.settings}
          </a>
        </nav>
        {mine !== undefined && (
          <button type="button" className="button button-primary button-small bar-write" onClick={() => (location.hash = "#/write")}>
            <WriteIcon />
            {strings.nav.write}
          </button>
        )}
        <div className="who">
          <span className="who-email">{strings.signedInAs(actor.email, actor.admin)}</span>
          <button type="button" className="button button-quiet button-small" onClick={() => signOut(config)}>
            {strings.signOut}
          </button>
        </div>
      </header>
      {route.view === "approvals" ? (
        <Approvals client={client} sponsor={actor.email} connection={connection} follow={follow} onSignedOut={onSignedOut} />
      ) : route.view === "settings" ? (
        <Settings client={client} admin={actor.admin} email={actor.email} onPreferences={setPreferences} onSignedOut={onSignedOut} />
      ) : shown !== undefined || (listed !== undefined && listed.agents.length > 0) ? (
        <div className={route.view === "thread" || route.view === "draft" || route.view === "write" ? "mail mail-reading" : "mail"}>
          <aside className="side">
            {listed !== undefined && listed.agents.length > 0 && <MailboxList mine={mine} agents={listed.agents} unread={unread} current={shown?.id} />}
            {shown !== undefined && (
              <MailViews
                client={client}
                mailbox={shown}
                base={base}
                labels={labels}
                current={viewed}
                // Only a mailbox's owner writes in it, so drafts are always the human's own.
                drafts={shown === mine ? { current: writing } : undefined}
                onLabelCreated={() => setRelabelled((current) => current + 1)}
                onSignedOut={onSignedOut}
              />
            )}
          </aside>
          {mail}
        </div>
      ) : (
        mail
      )}
    </PreferencesContext>
  );
}

const WriteIcon = () => (
  <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M10.5 2.5 13.5 5.5 6 13H3v-3l7.5-7.5ZM9 4l3 3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
