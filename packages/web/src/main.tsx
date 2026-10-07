// Duva's web app. A human signs in and lands on the Inbox of their personal mailbox, where they read,
// organize, write and send their mail. On a desk the mail lies on one plane: the side column, with
// the wordmark, Write, search, Duva's places and the mail's views, then the list, and what is open
// from it beside the list, with a status strip along the foot. A human with more than one mailbox
// finds each listed in the side column above the views, as sponsors find their agents' mailboxes too.
// Sponsors reach the Approvals view from the places, where they decide what the agents they sponsor ask
// to send and the setup changes their agent admins ask for, and the Alerts view, where they read what
// their agents need them for, each with its count. Mail from first-time senders waits in each
// mailbox's Screener, beside its views. Each agent's activity, a summary a day that opens into the
// day's timeline, is reached from its mailbox's views and from Settings. Every human reaches Settings
// from the places too, where they choose how times and dates show and switch their Screeners, admins
// the organization's settings and sponsors their agents', which they pause and limit there. The search
// box searches the mailbox open, or the human's own. On phones the bar is one row, the places lie in
// a tab bar along the screen's foot, one switcher at the view's head opens the mailboxes and views,
// and what is opened from a list takes the screen.
import "@fontsource-variable/jetbrains-mono/wght.css";
import "@fontsource-variable/familjen-grotesk/wght.css";
import "./styles.css";
import { lazy, StrictMode, Suspense, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { DuvaClient } from "@duva/client";
import type { components } from "@duva/openapi";
import { activityHref, AgentActivity, AgentDay } from "./activity.tsx";
import { AskAgent } from "./ask.tsx";
import { Composer } from "./compose.tsx";
import { defaultPreferences, type Preferences, PreferencesContext, useDates } from "./dates.ts";
import { Drafts } from "./drafts.tsx";
import { approvalChanges, type Connection, draftChanges, type Follow, labelChanges, mailChanges, mailboxSetupChanges, screenerChanges, setupChanges, SignedOut, useFeeds } from "./feed.ts";
import { type Marks, ThreadIndex } from "./inbox.tsx";
import { ActorMark } from "./mail-parts.tsx";
import { type AgentMailbox, ChevronIcon, MailboxList, MailboxSelector, mailboxHref, mailboxName, ownInOrder } from "./mailboxes.tsx";
import { type Beside, BesideContext, ListCountContext } from "./panes.tsx";
import { readScreener, ScreenedSenders, type ScreenerRead, ScreenerView } from "./screener.tsx";
import { SenderLinkContext, SenderSheetView } from "./sender.tsx";
import { SearchBox, SearchResults } from "./search.tsx";
import { Shortcuts } from "./shortcuts.tsx";
import { type Config, loadConfig, signedInClient, signIn, signOut } from "./session.ts";
import { strings } from "./strings.ts";
import type { Done, Label } from "./organize.tsx";
import { FeedStream } from "./stream.tsx";
import { ThreadView } from "./thread.tsx";
import { hrefOf, MailViews, pathOf, screenedSendersPath, type SearchView, senderHref, type ThreadsView, titleOf, type View, viewOf } from "./views.tsx";

// Views only some humans open, or open seldom, load when first opened, so the mail opens sooner.
const Approvals = lazy(() => import("./approvals.tsx").then(({ Approvals }) => ({ default: Approvals })));
const Alerts = lazy(() => import("./alerts.tsx").then(({ Alerts }) => ({ default: Alerts })));
const Settings = lazy(() => import("./settings.tsx").then(({ Settings }) => ({ default: Settings })));
const AccessRequestView = lazy(() => import("./access.tsx").then(({ AccessRequestView }) => ({ default: AccessRequestView })));

// Which input the human used last, so the title focused on arriving at a view is ringed only for
// someone on the keyboard, who needs to see where they are.
addEventListener("keydown", () => (document.documentElement.dataset.input = "keyboard"), { capture: true });
addEventListener("pointerdown", () => (document.documentElement.dataset.input = "pointer"), { capture: true });

type Human = components["schemas"]["Human"];
type Mailbox = components["schemas"]["Mailbox"];
type Agent = components["schemas"]["Agent"];

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
      // A link to an access request says what signing in leads to.
      const copy = state.ended ? strings.sessionEnded : routeOf(location.hash).view === "access" ? strings.signedOutToAccess : strings.signedOut;
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
 * without a server. A listing without a mailbox is in the human's first own mailbox. A thread or a
 * draft without one, and Drafts and writing, are in the own mailbox the human was last in, since
 * links to them may not say. A thread knows the view it was opened from, to go back there, and from
 * a search, the message that matched. A sender's sheet knows the view, or the screened senders, it
 * was opened from, at the path `from`. A mailbox's screened senders are reached from its Screener. An
 * agent's activity is in the mail, beside its mailbox's views, if it has a mailbox, and opens into
 * one day. Settings reads which of its pages is open from the rest of the hash.
 */
type Route =
  | { view: "approvals" | "alerts" }
  | { view: "access"; code: string }
  | { view: "settings" }
  | { view: "list"; mailbox?: string; list: ThreadsView }
  | { view: "screener"; mailbox?: string; senders: boolean }
  | { view: "search"; mailbox?: string; search: SearchView }
  | { view: "thread"; mailbox?: string; id: string; from: View; message?: string }
  | { view: "sender"; mailbox?: string; sender: string; from: string }
  | { view: "drafts" | "write" | "agent"; mailbox?: string }
  | { view: "draft"; mailbox?: string; id: string }
  | { view: "activity"; agent: string; day?: string };

function routeOf(hash: string): Route {
  if (hash === "#/approvals") return { view: "approvals" };
  if (hash === "#/alerts") return { view: "alerts" };
  const code = /^#\/access\/([^/]+)$/.exec(hash)?.[1];
  if (code !== undefined) return { view: "access", code: decodeURIComponent(code) };
  if (hash === "#/settings" || hash.startsWith("#/settings/")) return { view: "settings" };
  const [, agent, day] = /^#\/agents\/([^/]+)(?:\/(\d{4}-\d{2}-\d{2}))?$/.exec(hash) ?? [];
  if (agent !== undefined) return { view: "activity", agent: decodeURIComponent(agent), day };
  const path = hash.replace(/^#\/?/, "");
  const [, mailbox, inMailbox = ""] = /^mailboxes\/([^/]+)\/?(.*)$/.exec(path) ?? [undefined, undefined, path];
  const decoded = mailbox === undefined ? undefined : decodeURIComponent(mailbox);
  if (inMailbox === "drafts" || inMailbox === "write" || inMailbox === "agent") return { view: inMailbox, mailbox: decoded };
  const draft = /^drafts\/(.+)$/.exec(inMailbox)?.[1];
  if (draft !== undefined) return { view: "draft", mailbox: decoded, id: decodeURIComponent(draft) };
  const [, thread, asked] = /^threads\/([^?]+)(?:\?(.*))?$/.exec(inMailbox) ?? [];
  if (thread !== undefined) {
    const params = new URLSearchParams(asked);
    return { view: "thread", mailbox: decoded, id: decodeURIComponent(thread), from: viewOf(params.get("from") ?? "") ?? { label: "inbox" }, message: params.get("message") ?? undefined };
  }
  const [, sender, from] = /^senders\/([^?]+)(?:\?(.*))?$/.exec(inMailbox) ?? [];
  if (sender !== undefined) return { view: "sender", mailbox: decoded, sender: decodeURIComponent(sender), from: new URLSearchParams(from).get("from") ?? "" };
  if (inMailbox === screenedSendersPath) return { view: "screener", mailbox: decoded, senders: true };
  const list = viewOf(inMailbox) ?? { label: "inbox" };
  if ("screener" in list) return { view: "screener", mailbox: decoded, senders: false };
  if ("search" in list) return { view: "search", mailbox: decoded, search: list };
  return { view: "list", mailbox: decoded, list };
}

/** Whether the route is one that links reach without naming a mailbox, so it is in the own mailbox the human was last in. */
const followsLastMailbox = (route: Route) =>
  (route.view === "thread" || route.view === "draft" || route.view === "drafts" || route.view === "write" || route.view === "agent") && route.mailbox === undefined;

function useRoute(): Route & { hash: string } {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const changed = () => setHash(location.hash);
    addEventListener("hashchange", changed);
    return () => removeEventListener("hashchange", changed);
  }, []);
  return { ...routeOf(hash), hash };
}

/**
 * The mailboxes the human reads: their own, in the order `ownInOrder` gives, and their agents', with
 * the names of the agents they sponsor, by ID, mailbox or not.
 */
type Mailboxes =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "listed"; own: Mailbox[]; agents: AgentMailbox[]; agentNames: ReadonlyMap<string, string>; sponsorsAgents: boolean };

/** The signed-in app: the bar, and the view the route names, kept current by following the change feeds. */
function SignedIn({ config, client, actor, onSignedOut }: { config: Config; client: DuvaClient; actor: Human; onSignedOut: () => void }) {
  const route = useRoute();
  const [mailboxes, setMailboxes] = useState<Mailboxes>({ status: "loading" });
  const [waiting, setWaiting] = useState<number>();
  // The threads the agents' sends wait in for the human, which their lists say.
  const [asked, setAsked] = useState<{ mailbox: string; thread: string; agent: string; forward: boolean }[]>([]);
  // How many of the sponsor's alerts are unseen, and the newest one's ID, so the Alerts view reads again when one arrives.
  const [alerts, setAlerts] = useState<{ unseen: number; newest?: string; version: number }>({ unseen: 0, version: 0 });
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
  // How many of the list open are unread, which the phone's switcher says.
  const [listCount, setListCount] = useState(0);
  // On phones, whether the search field and the mailboxes and views are open.
  const [searchOpen, setSearchOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  // The agents the human sponsors, as the status strip says how each stands, and when they were last read.
  const [sponsored, setSponsored] = useState<Agent[]>([]);
  const sponsoredRead = useRef(0);
  // Whether the sheet listing the keyboard's shortcuts is open.
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  useEffect(() => {
    void (async () => {
      const { data, response } = await client.GET("/preferences").catch(() => ({ data: undefined, response: undefined }));
      if (response?.status === 401) return onSignedOut();
      if (data !== undefined) setPreferences(data);
    })();
  }, [client, onSignedOut]);

  /** Lists the mailboxes, showing them as loading first unless `quietly`, as when the feeds say they changed. */
  const listMailboxes = useCallback(
    async (quietly = false) => {
      if (!quietly) setMailboxes({ status: "loading" });
      const { data, response } = await client.GET("/mailboxes").catch(() => ({ data: undefined, response: undefined }));
      if (response?.status === 401) return onSignedOut();
      if (data === undefined) return quietly ? undefined : setMailboxes({ status: "failed" });
      const theirs = data.mailboxes.filter((mailbox) => mailbox.owner !== actor.id);
      // The other mailboxes a human can read are those of agents they sponsor, which are named for them.
      // A sponsor's agents may have no mailbox, and the sponsor still sets their settings.
      const { data: sponsored } = await client.GET("/agents").catch(() => ({ data: undefined }));
      if (sponsored !== undefined) {
        sponsoredRead.current = Date.now();
        setSponsored(sponsored.agents);
      }
      const names = new Map(sponsored?.agents.map((agent) => [agent.id, agent.name]));
      const agents = theirs.map((mailbox) => ({ mailbox, agent: names.get(mailbox.owner) ?? mailbox.defaultAddress ?? mailbox.id })).sort((a, b) => a.agent.localeCompare(b.agent));
      const own = ownInOrder(
        data.mailboxes.filter((mailbox) => mailbox.owner === actor.id),
        actor.email,
      );
      setMailboxes({ status: "listed", own, agents, agentNames: names, sponsorsAgents: agents.length > 0 || (sponsored?.agents.length ?? 0) > 0 });
    },
    [client, actor.id, actor.email, onSignedOut],
  );
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
  // The side column lists the mailboxes when the human has more than one of their own, or sponsors an agent with one.
  const columned = mailboxes.status === "listed" && (mailboxes.own.length > 1 || mailboxes.agents.length > 0);
  // The column lists every mailbox's count once they are listed, and the feeds keep them current.
  useEffect(() => {
    if (mailboxes.status !== "listed" || !columned) return;
    const ids = [...mailboxes.own.map(({ id }) => id), ...mailboxes.agents.map(({ mailbox }) => mailbox.id)];
    countUnread(ids).catch((error: unknown) => {
      if (error instanceof SignedOut) onSignedOut();
    });
  }, [mailboxes, columned, countUnread, onSignedOut]);

  const alertsRef = useRef(alerts);
  alertsRef.current = alerts;

  // Views that follow the feeds themselves, such as Approvals.
  const followers = useRef(new Set<Parameters<Follow>[0]>());
  const follow = useCallback<Follow>((listener) => {
    followers.current.add(listener);
    return () => followers.current.delete(listener);
  }, []);

  const listed = mailboxes.status === "listed" ? mailboxes : undefined;
  const followed = useMemo(() => (listed === undefined ? [] : [...listed.own.map(({ id }) => id), ...listed.agents.map(({ mailbox }) => mailbox.id)]), [listed]);
  useFeeds(client, {
    mailboxes: followed,
    interval: config.pollInterval,
    hiddenInterval: config.hiddenPollInterval,
    // Only admins read the organization's feed, and only an admin sponsors an agent admin, whose setup changes it records.
    organization: actor.admin,
    async onChanges(changes, first, organization, gone) {
      for (const listener of [...followers.current]) await listener(changes, organization);
      // The mailboxes were listed when the app opened, so they are listed again only when an admin's
      // feed says they changed, or one of them can't be read anymore.
      if (!first && (gone || organization.some((change) => mailboxSetupChanges.has(change.type)))) await listMailboxes(true);
      if (first || changes.some(({ change }) => approvalChanges.has(change.type)) || organization.some((change) => setupChanges.has(change.type))) {
        const { data, response } = await client.GET("/approvals");
        if (response.status === 401) throw new SignedOut();
        if (data !== undefined) {
          setWaiting(data.approvals.length + data.setupApprovals.length);
          setAsked(
            data.approvals.flatMap(({ mailbox, agent, draft }) =>
              draft.thread === undefined ? [] : [{ mailbox, thread: draft.thread, agent, forward: draft.forwards !== undefined }],
            ),
          );
        }
      }
      // Alerts come from no feed, so a sponsor's count is read with every read of the feeds. Only a
      // sponsor gets alerts, and one whose agents are gone may still have theirs.
      if (first || (mailboxes.status === "listed" && mailboxes.sponsorsAgents) || alertsRef.current.newest !== undefined) {
        const { data, response } = await client.GET("/alerts", { params: { query: { limit: 1 } } });
        if (response.status === 401) throw new SignedOut();
        if (data !== undefined) {
          const newest = data.alerts[0]?.id;
          // Nothing new keeps what is shown, so an idle read renders nothing again.
          setAlerts((current) => (current.unseen === data.unseen && current.newest === newest ? current : { unseen: data.unseen, newest, version: current.version + (newest === current.newest ? 0 : 1) }));
        }
      }
      // How the sponsor's agents stand is read again when anything changed, as a send or a pause, and
      // once a minute, as sends leave the hour.
      if (mailboxes.status === "listed" && mailboxes.sponsorsAgents && !first && (changes.length > 0 || organization.length > 0 || Date.now() - sponsoredRead.current >= 60_000)) {
        sponsoredRead.current = Date.now();
        // How they stand is said again at the next read if Duva can't say it now.
        const { data, response } = await client.GET("/agents").catch(() => ({ data: undefined, response: undefined }));
        if (response?.status === 401) throw new SignedOut();
        if (data !== undefined) setSponsored(data.agents);
      }
      // The first read passes mail that may have arrived after the views listed it, so it counts too.
      const mail = new Set(changes.filter(({ change }) => mailChanges.has(change.type)).map(({ mailbox }) => mailbox));
      const changed = new Set([
        ...mail,
        ...changes.filter(({ change }) => draftChanges.has(change.type) || labelChanges.has(change.type) || screenerChanges.has(change.type)).map(({ mailbox }) => mailbox),
      ]);
      if (changed.size > 0) {
        setVersions((current) => new Map([...current, ...[...changed].map((mailbox) => [mailbox, (current.get(mailbox) ?? 0) + 1] as const)]));
      }
      if (columned) await countUnread([...mail]);
    },
    // The connection line says the minute it was last up to date, so a read in the same minute keeps what is shown.
    onConnection: (next) =>
      setConnection((current) => (current?.ok === true && next?.ok === true && Math.floor(current.at.getTime() / 60_000) === Math.floor(next.at.getTime() / 60_000) ? current : next)),
    onSignedOut,
  });

  const own = listed?.own ?? noMailboxes;
  const first = own[0];
  const several = own.length > 1;
  const isOwn = (id: string | undefined) => own.some((mailbox) => mailbox.id === id);
  // With one mailbox of their own, a link that names none is in it. With several, every link the web
  // app builds names its mailbox, and one that doesn't, as the composer's and Drafts' don't, says
  // which once it is opened: a draft is in whichever of them holds it, and a thread, Drafts or
  // writing in the own mailbox the human was last in. Any other view that names none is in the first.
  const lastOwn = useRef<string>(undefined);
  const follows = followsLastMailbox(route);
  if (listed !== undefined && !follows) lastOwn.current = "mailbox" in route && isOwn(route.mailbox) ? route.mailbox : undefined;
  const [draftHome, setDraftHome] = useState<{ draft: string; mailbox?: string }>();
  const unplacedDraft = several && route.view === "draft" && route.mailbox === undefined ? route.id : undefined;
  useEffect(() => {
    if (unplacedDraft === undefined) return;
    let looking = true;
    void Promise.all(
      own.map(async (mailbox) => {
        const { response } = await client.GET("/mailboxes/{mailbox}/drafts/{draft}", { params: { path: { mailbox: mailbox.id, draft: unplacedDraft } } }).catch(() => ({ response: undefined }));
        return response?.ok === true ? mailbox.id : undefined;
      }),
    ).then((homes) => {
      if (looking) setDraftHome({ draft: unplacedDraft, mailbox: homes.find((home) => home !== undefined) });
    });
    return () => {
      looking = false;
    };
  }, [client, unplacedDraft, own]);
  const placingDraft = unplacedDraft !== undefined && draftHome?.draft !== unplacedDraft;
  // The mailbox the route names, if it names one. An agent's activity is beside its mailbox, if it has one.
  const named =
    "mailbox" in route
      ? (route.mailbox ?? (follows ? ((unplacedDraft !== undefined ? draftHome?.mailbox : undefined) ?? lastOwn.current) : undefined))
      : route.view === "activity"
        ? listed?.agents.find(({ mailbox }) => mailbox.owner === route.agent)?.mailbox.id
        : undefined;
  useEffect(() => {
    if (several && follows && !placingDraft) location.replace(`#/mailboxes/${encodeURIComponent(named ?? first!.id)}/${route.hash.replace(/^#\/?/, "")}`);
  }, [several, follows, placingDraft, named, first, route.hash]);
  // A mailbox the list doesn't have, as one an admin gave the human since, is looked for again once
  // before the web app says it isn't theirs.
  const known = named === undefined || isOwn(named) || listed?.agents.some(({ mailbox }) => mailbox.id === named) === true;
  const [rechecked, setRechecked] = useState<ReadonlySet<string>>(new Set());
  const checking = listed !== undefined && !known && named !== undefined && !rechecked.has(named);
  useEffect(() => {
    if (!checking) return;
    void listMailboxes(true).then(() => setRechecked((current) => new Set([...current, named])));
  }, [checking, named, listMailboxes]);
  // The views outside the mail.
  const away = route.view === "approvals" || route.view === "alerts" || route.view === "settings" || route.view === "access";
  const routeKey = away
    ? route.view === "access"
      ? `access/${route.code}`
      : route.view
    : route.view === "activity"
      ? `activity/${route.agent}/${route.day ?? ""}`
      : `${route.view}/${named ?? ""}/${"id" in route ? route.id : route.view === "sender" ? route.sender : route.view === "list" ? pathOf(route.list) : route.view === "search" ? pathOf(route.search) : route.view === "screener" ? String(route.senders) : ""}`;
  // A screen reader follows the human to the view they opened, and the page starts at its top.
  const navigated = useRef(false);
  useEffect(() => {
    setSwitching(false);
    if (!navigated.current) {
      navigated.current = true;
      return;
    }
    // On a desk the panes scroll each by itself, and a list keeps its place while what is open from it changes.
    scrollTo(0, 0);
    for (const pane of document.querySelectorAll(".pane-read, .panes-one")) pane.scrollTo(0, 0);
    return focusTitle();
  }, [routeKey]);
  // What was done stops being said once the human goes elsewhere.
  useEffect(() => {
    setDone((current) => (current === undefined || current.at === location.hash ? current : undefined));
  }, [routeKey]);
  // The title counts what waits, so a sponsor sees a new request from another tab.
  useEffect(() => {
    if (route.view === "approvals") document.title = strings.title(strings.approvals.title, waiting);
  }, [route.view, waiting]);

  const agentNames = listed?.agentNames ?? noNames;
  const sponsor = listed?.sponsorsAgents === true || (waiting ?? 0) > 0;
  const alerted = sponsor || alerts.newest !== undefined;
  // The mailbox the route is in, the human's first own if it names none.
  const agent = named !== undefined ? listed?.agents.find(({ mailbox }) => mailbox.id === named) : undefined;
  const shown = away ? undefined : named === undefined ? first : (agent?.mailbox ?? own.find(({ id }) => id === named));
  const shownOwn = shown !== undefined && isOwn(shown.id);
  const base = shown === undefined ? "#/" : mailboxHref(shown, !several && shown.id === first?.id);
  // Outside the mail, the side column keeps the views of the mailbox last open, or the first own.
  const lastShown = useRef<Mailbox>(undefined);
  if (shown !== undefined) lastShown.current = shown;
  const sided = shown ?? (away ? (lastShown.current ?? first) : undefined);
  const sideAgent = sided === undefined ? undefined : listed?.agents.find(({ mailbox }) => mailbox.id === sided.id);
  const sideBase = sided === undefined ? "#/" : mailboxHref(sided, !several && sided.id === first?.id);
  const version = sided === undefined ? 0 : (versions.get(sided.id) ?? 0);

  // The side column's mailbox's labels, with their unread counts, are read again whenever its mail changes, and only the latest read counts.
  const labelsRead = useRef(0);
  useEffect(() => {
    const read = ++labelsRead.current;
    if (sided === undefined) return setLabels([]);
    void (async () => {
      const { data, response } = await client.GET("/mailboxes/{mailbox}/labels", { params: { path: { mailbox: sided.id } } }).catch(() => ({ data: undefined, response: undefined }));
      if (response?.status === 401) return onSignedOut();
      if (data !== undefined && read === labelsRead.current) setLabels(data.labels);
    })();
  }, [client, sided, version, relabelled, onSignedOut]);

  // Its Screener is read whenever its mail changes too, for the side column's count and the Screener
  // view. Another mailbox's shows as loading until it is read.
  const [screener, setScreener] = useState<{ mailbox: string; read: ScreenerRead }>();
  const screenerRead = useRef(0);
  useEffect(() => {
    const read = ++screenerRead.current;
    if (sided === undefined) return;
    void readScreener(client, sided.id, onSignedOut).then((answer) => {
      if (answer !== undefined && read === screenerRead.current) setScreener({ mailbox: sided.id, read: answer });
    });
  }, [client, sided, version, relabelled, onSignedOut]);
  const shownScreener: ScreenerRead = screener !== undefined && screener.mailbox === sided?.id ? screener.read : { status: "loading" };
  // How many senders wait in its Screener, which the Screener's place counts.
  const screening = shownScreener.status === "read" ? shownScreener.screener.senders.length : 0;

  // Something done to the mail changes the labels' counts, so they are read again at once.
  const showDone = (what: Done | undefined) => {
    setDone(what === undefined ? undefined : { done: what, at: location.hash });
    setRelabelled((current) => current + 1);
  };
  // What is done to a thread open beside its list changes the list, which reads it again at once.
  const [acted, setActed] = useState(0);
  const showDoneBeside = (what: Done | undefined) => {
    showDone(what);
    setActed((current) => current + 1);
  };
  // A sender's sheet lies beside the screened senders it was opened from, or a view.
  const fromSenders = route.view === "sender" && route.from === screenedSendersPath;
  const senderFrom: View | undefined = route.view !== "sender" ? undefined : fromSenders ? { screener: true } : (viewOf(route.from) ?? { label: "inbox" });
  // The view the side column marks open: the one listed, or the one a thread or a sheet was opened from.
  const viewed: View | undefined =
    route.view === "list" ? route.list : route.view === "thread" ? route.from : route.view === "screener" ? { screener: true } : route.view === "search" ? route.search : senderFrom;
  // The search box searches the mailbox open, or the human's first own outside the mail, and shows
  // the search open or the one the thread shown was opened from.
  const searched = away ? first : shown;
  const searching = route.view === "search" ? route.search.search : route.view === "thread" && "search" in route.from ? route.from.search : undefined;
  const doneHere = done !== undefined && done.at === route.hash ? done.done : undefined;
  // Who sent the mail listed, beyond what each thread says: Duva, from its address on the mailbox's domains.
  const marks = useMemo<Marks>(
    () => ({
      duva: new Set(shown?.addresses.map((address) => `no-reply@${address.slice(address.lastIndexOf("@") + 1).toLowerCase()}`)),
      waiting: new Map(
        asked.filter(({ mailbox }) => mailbox === shown?.id).map(({ thread, agent, forward }) => [thread, { agent: agentNames.get(agent) ?? strings.galley.anAgent, forward }]),
      ),
    }),
    [shown, asked, agentNames],
  );
  const writing = route.view === "drafts" || route.view === "draft" || route.view === "write";

  // On phones the search field opens from its icon, and stays open while a search is shown.
  const searchId = useId();
  const searchShown = searchOpen || searching !== undefined;
  useEffect(() => {
    if (searchOpen) document.getElementById(searchId)?.querySelector("input")?.focus();
  }, [searchOpen, searchId]);
  useEffect(() => setSearchOpen(false), [routeKey]);

  // What is open from a list, a thread or a draft, lies beside the list it was opened from. Writing
  // and a draft lie beside the list the human was last on in the mailbox, or its Inbox.
  const reading = route.view === "thread" || route.view === "draft" || route.view === "write" || route.view === "sender" || route.view === "agent";
  const lastList = useRef<{ mailbox: string; list: Listing }>(undefined);
  const routeList: Listing | undefined =
    route.view === "list" ? route.list : route.view === "search" ? route.search : route.view === "screener" && !route.senders ? { screener: true } : route.view === "drafts" ? { drafts: true } : undefined;
  if (shown !== undefined && routeList !== undefined) lastList.current = { mailbox: shown.id, list: routeList };
  const listing: Listing | undefined =
    shown === undefined
      ? undefined
      : (routeList ??
        (route.view === "thread" ? route.from : senderFrom !== undefined && !fromSenders ? senderFrom : reading ? (lastList.current?.mailbox === shown.id ? lastList.current.list : { label: "inbox" }) : undefined));
  const openId = "id" in route ? route.id : undefined;
  const besideList = useMemo<Beside>(() => ({ beside: reading, thread: route.view === "thread", open: openId }), [reading, route.view, openId]);
  // A list the human goes to starts at its top, and keeps its place while what is open beside it changes.
  const listKey = shown === undefined || listing === undefined ? undefined : `${shown.id}/${"drafts" in listing ? "drafts" : pathOf(listing)}`;
  useEffect(() => {
    document.querySelector(".pane-list")?.scrollTo(0, 0);
  }, [listKey]);

  const list =
    shown === undefined ? undefined : (route.view === "screener" && route.senders) || fromSenders ? (
      <ScreenedSenders
        key={`${shown.id}/senders`}
        client={client}
        mailbox={shown}
        base={base}
        agent={agent?.agent}
        me={actor.id}
        agentNames={agentNames}
        labels={labels}
        version={version}
        open={route.view === "sender" ? route.sender : undefined}
        done={doneHere}
        onDone={showDone}
        onSignedOut={onSignedOut}
      />
    ) : listing === undefined ? undefined : "drafts" in listing ? (
      <Drafts key={listKey} client={client} mailbox={shown} base={base} agentNames={agentNames} version={version} onSignedOut={onSignedOut} />
    ) : "screener" in listing ? (
      <ScreenerView
        key={listKey}
        client={client}
        mailbox={shown}
        base={base}
        agent={agent?.agent}
        read={shownScreener}
        labels={labels}
        connection={connection}
        done={reading ? undefined : doneHere}
        onDone={showDone}
        onRetry={() => setRelabelled((current) => current + 1)}
        onSignedOut={onSignedOut}
      />
    ) : "search" in listing ? (
      <SearchResults
        key={listKey}
        client={client}
        mailbox={shown}
        base={base}
        view={listing}
        labels={labels}
        acted={acted}
        marks={marks}
        done={reading ? undefined : doneHere}
        onDone={showDone}
        onSignedOut={onSignedOut}
      />
    ) : (
      <ThreadIndex
        key={listKey}
        client={client}
        mailbox={shown}
        base={base}
        agent={agent?.agent}
        view={listing}
        labels={labels}
        version={version + acted}
        connection={connection}
        marks={marks}
        screener={shownScreener.status === "read" ? shownScreener.screener.senders.length : 0}
        done={reading ? undefined : doneHere}
        onDone={showDone}
        onSignedOut={onSignedOut}
      />
    );

  const opened =
    shown === undefined ? undefined : route.view === "thread" ? (
      <ThreadView
        key={`${shown.id}/${route.id}`}
        client={client}
        mailbox={shown}
        id={route.id}
        matched={route.message}
        me={actor.id}
        agent={agent?.agent}
        agentNames={agentNames}
        labels={labels}
        back={hrefOf(route.from, base)}
        backTo={titleOf(route.from, labels, agent?.agent)}
        version={version}
        onDone={showDoneBeside}
        onSignedOut={onSignedOut}
      />
    ) : route.view === "sender" ? (
      <SenderSheetView
        key={`${shown.id}/sender/${route.sender}`}
        client={client}
        mailbox={shown}
        sender={route.sender}
        labels={labels}
        back={fromSenders ? `${base}${screenedSendersPath}` : hrefOf(senderFrom!, base)}
        backTo={fromSenders ? strings.screened.title : titleOf(senderFrom!, labels, agent?.agent)}
        version={version}
        onDone={showDoneBeside}
        onSignedOut={onSignedOut}
      />
    ) : route.view === "agent" ? (
      shownOwn ? (
        <AskAgent
          key={`${shown.id}/agent`}
          client={client}
          config={config}
          mailbox={shown}
          base={base}
          back={listing === undefined || "drafts" in listing ? base : hrefOf(listing, base)}
          backTo={listing === undefined ? strings.views.inbox : "drafts" in listing ? strings.views.drafts : titleOf(listing, labels, agent?.agent)}
          onSignedOut={onSignedOut}
        />
      ) : (
        <main className="desk">
          <p className="notice">{strings.ask.notYours}</p>
        </main>
      )
    ) : route.view === "draft" || route.view === "write" ? (
      <Composer key={routeKey} client={client} mailbox={shown} base={base} id={route.view === "draft" ? route.id : undefined} agentNames={agentNames} version={version} onSignedOut={onSignedOut} />
    ) : undefined;

  // What lies on the plane when it isn't a list and what is open from it. The Feed is read as a
  // stream across the plane while nothing is open from it.
  const elsewhere =
    shown !== undefined && route.view === "list" && "label" in route.list && route.list.label === "feed" ? (
      <FeedStream key={`${shown.id}/stream`} client={client} mailbox={shown} base={base} me={actor.id} agentNames={agentNames} version={version} onSignedOut={onSignedOut} />
    ) : route.view === "activity" ? (
      route.day === undefined ? (
        <AgentActivity key={route.agent} client={client} agent={route.agent} name={agentNames.get(route.agent)} timeZone={preferences.timeZone} onSignedOut={onSignedOut} />
      ) : (
        <AgentDay key={`${route.agent}/${route.day}`} client={client} agent={route.agent} day={route.day} name={agentNames.get(route.agent)} me={actor.id} mine={first?.id} timeZone={preferences.timeZone} onSignedOut={onSignedOut} />
      )
    ) : mailboxes.status === "loading" || placingDraft || checking ? (
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
    ) : undefined;

  // What the phone's switcher names: the view open, and the mailbox it is in.
  const viewName =
    route.view === "activity" ? strings.activity.link : writing ? strings.views.drafts : viewed === undefined ? undefined : titleOf(viewed, labels);
  const mailboxShown = shown !== undefined ? mailboxName(shown, own, agent?.agent) : route.view === "activity" ? agentNames.get(route.agent) : undefined;
  // Whether a mailbox the switcher hides has unread mail.
  const unreadElsewhere = columned && [...unread].some(([id, count]) => id !== shown?.id && count > 0);
  const switcherId = useId();
  const switcherRef = useRef<HTMLButtonElement>(null);
  // Write writes in the own mailbox open, or the first one anywhere else.
  const write = first === undefined ? undefined : () => (location.hash = shownOwn ? `${base}write` : "#/write");
  const shell = ["shell", away && "shell-away", reading && "shell-reading"].filter(Boolean).join(" ");
  // A sender in a letter opens their sheet beside the view the letter was opened from.
  const senderFromPath = viewed === undefined ? "" : pathOf(viewed);
  const senderLink = useMemo(() => (shown === undefined ? undefined : (address: string) => senderHref(address.toLowerCase(), senderFromPath, base)), [shown, senderFromPath, base]);

  return (
    <PreferencesContext value={preferences}>
      <SenderLinkContext value={senderLink}>
        <ListCountContext value={setListCount}>
      <a
        className="skip"
        href={route.hash || "#/"}
        onClick={(event) => {
          event.preventDefault();
          focusTitle(true);
        }}
      >
        {strings.nav.skip}
      </a>
      <div className={shell}>
        <header className="bar">
              {/* The wordmark goes home: the Inbox of the human's first own mailbox, or the start view. */}
              <a className="wordmark" href={first === undefined ? "#/" : hrefOf({ label: "inbox" }, mailboxHref(first, !several))} aria-label={strings.nav.home}>
              {strings.nav.label}
            </a>
          {write !== undefined && (
            <button type="button" className="button button-primary button-small bar-write" aria-keyshortcuts={preferences.keyboardShortcuts === "off" ? undefined : "c"} onClick={write}>
              <WriteIcon />
              {strings.nav.write}
              {preferences.keyboardShortcuts !== "off" && <kbd aria-hidden="true">c</kbd>}
            </button>
          )}
            {/* On a desk the open mailbox heads the side column as a selector; a phone's switcher does its work. */}
            {listed !== undefined && own.length > 0 && (
              <div className="bar-mailbox">
                <MailboxSelector own={own} unread={unread} current={sided !== undefined && isOwn(sided.id) ? sided : undefined} />
              </div>
            )}
          {searched !== undefined && (
            <>
              <button
                type="button"
                className="button button-quiet bar-search-toggle"
                aria-label={strings.nav.search}
                aria-expanded={searchShown}
                aria-controls={searchId}
                onClick={() => setSearchOpen((open) => !open)}
              >
                <SearchIcon />
              </button>
              <div id={searchId} className={searchShown ? "bar-search bar-search-open" : "bar-search"}>
                <SearchBox
                  client={client}
                  mailbox={searched}
                  base={away ? mailboxHref(searched, !several) : base}
                  agent={away ? undefined : agent?.agent}
                  labels={away ? [] : labels}
                  current={searching}
                />
              </div>
            </>
          )}
            {/* On a phone Settings is a gear in the top row; on a desk it is in the status strip. */}
            <a href="#/settings" className="bar-settings" aria-label={strings.nav.settings} aria-current={route.view === "settings" ? "page" : undefined}>
              <SettingsIcon />
            </a>
          <nav aria-label={strings.nav.label}>
            {/* The mail's own views are in the side column, so the places name only the mail as a whole. */}
              <a href={away ? sideBase : base} className="place-mail" aria-current={away || route.view === "screener" ? undefined : "page"}>
              <MailIcon />
              {strings.nav.mail}
            </a>
              {/* Screening is the commonest decision, so the Screener of the mailbox beside is a place of its own. */}
              {sided !== undefined && (
                <a
                  href={hrefOf({ screener: true }, sideBase)}
                  className="place-screener"
                  aria-current={route.view === "screener" ? "page" : undefined}
                  aria-label={`${strings.nav.screener}${screening > 0 ? strings.nav.waiting(screening) : ""}`}
                >
                  <ScreenerIcon />
                  {strings.nav.screener}
                  {screening > 0 && (
                    <span className="nav-count nav-count-quiet" aria-hidden="true">
                      {screening}
                    </span>
                  )}
                </a>
              )}
            {sponsor && (
              <a href="#/approvals" className="place-approvals" aria-current={route.view === "approvals" ? "page" : undefined}>
                <ApprovalsIcon />
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
            {alerted && (
              <a
                href="#/alerts"
                aria-current={route.view === "alerts" ? "page" : undefined}
                aria-label={`${strings.nav.alerts}${alerts.unseen > 0 ? strings.nav.unseen(alerts.unseen) : ""}`}
              >
                <AlertsIcon />
                {strings.nav.alerts}
                {alerts.unseen > 0 && (
                  <span className="nav-count nav-count-alert" aria-hidden="true">
                    {alerts.unseen}
                  </span>
                )}
              </a>
            )}
          </nav>
        </header>
        {(sided !== undefined || columned) && (
          <aside className="side">
            {(viewName !== undefined || mailboxShown !== undefined) && (
              // On phones one switcher opens the mailboxes and views, which the side column lists on a desk.
              <button
                ref={switcherRef}
                type="button"
                className="switcher"
                aria-expanded={switching}
                aria-controls={switcherId}
                      aria-label={[viewName, mailboxShown, listCount > 0 && strings.inbox.unread(listCount), unreadElsewhere && strings.views.elsewhere, strings.views.switcher]
                        .filter(Boolean)
                        .join(", ")}
                onClick={() => setSwitching((open) => !open)}
              >
                <span className="switcher-view">{viewName ?? mailboxShown}</span>
                {viewName !== undefined && mailboxShown !== undefined && <span className="switcher-mailbox">{mailboxShown}</span>}
                      {listCount > 0 && <span className="switcher-count">{strings.inbox.unread(listCount)}</span>}
                {unreadElsewhere && <span className="switcher-dot" aria-hidden="true" />}
                <ChevronIcon />
              </button>
            )}
            <div
              id={switcherId}
              className={switching ? "side-nav side-nav-open" : "side-nav"}
              onKeyDown={(event) => {
                if (event.key !== "Escape" || !switching) return;
                setSwitching(false);
                switcherRef.current?.focus();
              }}
            >
              {columned && listed !== undefined && <MailboxList own={own} agents={listed.agents} unread={unread} current={shown?.id} />}
              {/* Until agents no longer have mailboxes (#126), a desk lists theirs here, as the selector holds only the human's own. */}
              {listed !== undefined && listed.agents.length > 0 && (
                <div className="side-agents">
                  <MailboxList own={noMailboxes} agents={listed.agents} unread={unread} current={shown?.id} label={strings.mailboxes.agentsLabel} />
                </div>
              )}
              {sided !== undefined && (
                <MailViews
                  client={client}
                  mailbox={sided}
                  base={sideBase}
                  labels={labels}
                  current={viewed}
                  // A human writes only in their own mailboxes, so only theirs list Drafts.
                  drafts={isOwn(sided.id) ? { current: writing } : undefined}
                  // Each of the human's own mailboxes has its mailbox agent to ask.
                  ask={isOwn(sided.id) ? { href: `${sideBase}agent`, current: route.view === "agent" } : undefined}
                  // An agent's mailbox lists the agent's activity too.
                  activity={sideAgent === undefined ? undefined : { href: activityHref(sideAgent.mailbox.owner), current: route.view === "activity" }}
                  // A Screener Duva couldn't read is still listed, so its view can say so and try again.
                  screener={
                    shownScreener.status === "read"
                      ? { on: shownScreener.screener.on, waiting: shownScreener.screener.senders.length }
                      : shownScreener.status === "failed"
                        ? { on: true, waiting: 0 }
                        : undefined
                  }
                  onLabelCreated={() => setRelabelled((current) => current + 1)}
                  onSignedOut={onSignedOut}
                />
              )}
                    <UpToDate connection={connection} />
            </div>
          </aside>
        )}
        {/* Escape closes a thread, back to the view it was opened from. */}
        <Shortcuts
          write={write}
          close={route.view === "thread" && shown !== undefined ? () => (location.hash = hrefOf(route.from, base)) : undefined}
          views={shown === undefined ? undefined : { base, drafts: shownOwn }}
          ask={shownOwn ? () => (location.hash = `${base}agent`) : first === undefined ? undefined : () => (location.hash = "#/agent")}
          sheetOpen={shortcutsOpen}
          onSheet={setShortcutsOpen}
        />
        <Suspense
          fallback={
            <div className="panes panes-one">
              <main className="desk" aria-busy="true" />
            </div>
          }
        >
          {route.view === "approvals" ? (
            <div className="panes panes-one">
              <Approvals client={client} me={actor.id} sponsor={actor.email} connection={connection} follow={follow} onSignedOut={onSignedOut} />
            </div>
          ) : route.view === "alerts" ? (
            <div className="panes panes-one">
              <Alerts
                client={client}
                mailboxes={listed === undefined ? [] : [...own, ...listed.agents.map(({ mailbox }) => mailbox)]}
                mine={first?.id}
                agents={new Set(agentNames.keys())}
                version={alerts.version}
                onUnseen={(unseen) => setAlerts((current) => ({ ...current, unseen }))}
                onSignedOut={onSignedOut}
              />
            </div>
          ) : route.view === "access" ? (
            <div className="panes panes-one">
              <AccessRequestView key={route.code} client={client} code={route.code} email={actor.email} onApproved={() => void listMailboxes(true)} onSignedOut={onSignedOut} />
            </div>
          ) : route.view === "settings" ? (
            <div className="panes panes-one">
              <Settings
                client={client}
                me={actor.id}
                admin={actor.admin}
                email={actor.email}
                mailboxes={listed === undefined ? undefined : { mine: first, own, agents: listed.agents }}
                onPreferences={setPreferences}
                onSignedOut={onSignedOut}
              />
            </div>
          ) : elsewhere !== undefined ? (
            <div className="panes panes-one">{elsewhere}</div>
          ) : (
            <div className={opened === undefined ? "panes" : "panes panes-reading"}>
              <div className="pane-list">
                <BesideContext value={besideList}>{list}</BesideContext>
              </div>
              <div className="pane-read">
                {opened ?? (
                  <section className="reader-empty" aria-labelledby="reader-empty-title">
                    <h2 id="reader-empty-title">{strings.reader.title}</h2>
                    <p>{strings.reader.lead}</p>
                  </section>
                )}
              </div>
            </div>
          )}
        </Suspense>
        <Strip
          connection={connection}
          agents={listed?.sponsorsAgents === true ? sponsored : noAgents}
          onShortcuts={preferences.keyboardShortcuts === "off" ? undefined : () => setShortcutsOpen(true)}
          email={actor.email}
          admin={actor.admin}
            settings={route.view === "settings"}
          onSignOut={() => signOut(config)}
        />
      </div>
        </ListCountContext>
      </SenderLinkContext>
    </PreferencesContext>
  );
}

/** What a list beside an open thread or draft is: a view of the mail, or Drafts. */
type Listing = View | { drafts: true };

/** When Duva was last up to date, which the phone's switcher says on its sheet, since a phone has no status strip. */
function UpToDate({ connection }: { connection: Connection }) {
  const { clock } = useDates();
  return connection?.ok ? <p className="side-state">{strings.connection.upToDate(clock(connection.at))}</p> : null;
}

/**
 * The status strip along a desk's foot: whether Duva is up to date, how each agent the human
 * sponsors stands, the key that lists the shortcuts while they are on, Settings, and who is signed
 * in, with Sign out.
 */
function Strip({
  connection,
  agents,
  onShortcuts,
  email,
  admin,
  settings,
  onSignOut,
}: {
  connection: Connection;
  agents: Agent[];
  onShortcuts?: () => void;
  email: string;
  admin: boolean;
  /** Whether Settings is open, which its entry then shows. */
  settings: boolean;
  onSignOut: () => void;
}) {
  const { clock } = useDates();
  return (
    <footer className="strip" aria-label={strings.strip.label}>
      {connection !== undefined && (
        <p className={connection.ok ? "strip-state" : "strip-state strip-state-down"}>
          <span className="strip-light" aria-hidden="true" />
          {connection.ok ? strings.connection.upToDate(clock(connection.at)) : strings.strip.unreachable}
        </p>
      )}
      {agents.length > 0 && (
        <ul className="strip-agents">
          {agents.map((agent) => (
            <li key={agent.id} className={agent.paused === undefined ? "strip-agent" : "strip-agent strip-agent-paused"}>
              <ActorMark kind="agent" />
              {agent.paused === undefined ? strings.strip.running(agent.name, agent.sendsLeftThisHour) : strings.strip.paused(agent.name)}
            </li>
          ))}
        </ul>
      )}
      <div className="strip-end">
        {onShortcuts !== undefined && (
          <button type="button" className="strip-keys" aria-keyshortcuts="?" onClick={onShortcuts}>
            <kbd aria-hidden="true">?</kbd>
            {strings.strip.shortcuts}
          </button>
        )}
        <a href="#/settings" className="strip-settings" aria-current={settings ? "page" : undefined}>
          <SettingsIcon />
          {strings.nav.settings}
        </a>
        <span className="strip-who">
          <ActorMark kind="human" />
          {strings.signedInAs(email, admin)}
        </span>
        <button type="button" className="button button-quiet button-small" onClick={onSignOut}>
          {strings.signOut}
        </button>
      </div>
    </footer>
  );
}

/**
 * Puts focus on the open view's title, so a screen reader starts there, as soon as the view shows
 * it. A view that is still loading shows its title later, and one that loads in place of a skeleton
 * may replace it, so the title is focused again while focus would otherwise fall to the page, until
 * the human goes elsewhere or moves focus themselves. `now` focuses the view itself if it has no
 * title, as the skip link does. Each call ends the one before.
 */
function focusTitle(now = false): () => void {
  stopFocusingTitle();
  const from = document.activeElement;
  let focused: HTMLElement | undefined;
  const focus = () => {
    const active = document.activeElement;
    // Focus the human moved, as into the search box while the view loads, stays where they put it.
    const moved = focused === undefined ? active !== from && active !== document.body && from?.isConnected === true : active !== document.body;
    if (focused?.isConnected === true || moved) return;
    const title = document.querySelector<HTMLElement>("main h1, [role=main] h1") ?? (now ? document.querySelector<HTMLElement>("main, [role=main]") : null);
    if (title === null) return;
    title.tabIndex = -1;
    title.focus();
    focused = title;
  };
  focus();
  const watching = new MutationObserver(focus);
  watching.observe(document.getElementById("root")!, { childList: true, subtree: true });
  const done = setTimeout(() => watching.disconnect(), 10_000);
  stopFocusingTitle = () => {
    clearTimeout(done);
    watching.disconnect();
  };
  return stopFocusingTitle;
}

let stopFocusingTitle = () => {};

const noNames: ReadonlyMap<string, string> = new Map();
const noMailboxes: Mailbox[] = [];
const noAgents: Agent[] = [];

// The bar's icons, drawn on the 16 unit grid in the round stroke. The places' icons show only in the phone's tab bar.
const Stroke = ({ d }: { d: string }) => <path d={d} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />;

const MailIcon = () => (
  <svg className="icon nav-icon" viewBox="0 0 16 16" aria-hidden="true">
    <Stroke d="M2.5 4h11v8h-11zM2.5 4.5 8 9l5.5-4.5" />
  </svg>
);

const ApprovalsIcon = () => (
  <svg className="icon nav-icon" viewBox="0 0 16 16" aria-hidden="true">
    <Stroke d="M4 2.5h8v11H4zM6 8.25l1.5 1.5L10.25 7" />
  </svg>
);

const AlertsIcon = () => (
  <svg className="icon nav-icon" viewBox="0 0 16 16" aria-hidden="true">
    <Stroke d="M4 11.5V7a4 4 0 0 1 8 0v4.5l1 1H3l1-1ZM6.75 14h2.5" />
  </svg>
);

const ScreenerIcon = () => (
  <svg className="icon nav-icon" viewBox="0 0 16 16" aria-hidden="true">
    <Stroke d="M2.5 3.5h11L9.25 8.75v4.25l-2.5-1.25v-3Z" />
  </svg>
);

const SettingsIcon = () => (
  <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
    <Stroke d="M12.8 7.03 14.35 7.23v1.54l-1.55.2-.72 1.74.95 1.24-1.08 1.08-1.24-.95-1.74.72-.2 1.55H7.23l-.2-1.55-1.74-.72-1.24.95-1.08-1.08.95-1.24-.72-1.74-1.55-.2V7.23l1.55-.2.72-1.74-.95-1.24 1.08-1.08 1.24.95 1.74-.72.2-1.55h1.54l.2 1.55 1.74.72 1.24-.95 1.08 1.08-.95 1.24ZM8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
  </svg>
);

const SearchIcon = () => (
  <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
    <Stroke d="M7 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM10.75 10.75 14 14" />
  </svg>
);

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
