// Settings, a page per sheet, with an index of them in the list column, each line saying what its
// page holds now, and the open page's sheets beside it in the reading pane: the human's own
// preferences, which only they choose, the Screener of their mailboxes, a
// sponsor's agents, where they pause each, set its limits and send what waits for them, and the
// organization's settings, which admins choose for everyone. Then, for admins only, the
// organization's domains, its mailboxes' addresses, its people and its groups. On a phone the index
// is the page Settings opens on, and each sheet links back to it.
import { type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { DuvaClient } from "@duva/client";
import type { components } from "@duva/openapi";
import { AddressesSheet, type Giving } from "./addresses.tsx";
import { AgentSettingsSheet } from "./agent-settings.tsx";
import { agentHref } from "./alerts.tsx";
import { Choice, ModelName, ModelPlace, outsideContinent, wholeNumber } from "./setting-parts.tsx";
import { CopyButton } from "./dns-parts.tsx";
import { datesFor, type Preferences, PreferencesContext } from "./dates.ts";
import { DomainsSheet } from "./domains.tsx";
import { GroupsSheet } from "./groups.tsx";
import { ActorMark } from "./mail-parts.tsx";
import { MyLogoSheet } from "./logos.tsx";
import { PeopleSheet } from "./people.tsx";
import { loadConfig, signOut } from "./session.ts";
import { strings } from "./strings.ts";
import { BackIcon } from "./thread.tsx";

type OrganizationSettings = components["schemas"]["OrganizationSettings"];
type Language = components["schemas"]["SearchLanguage"];
type Mailbox = components["schemas"]["Mailbox"];

type Read<Values> = { status: "loading" } | { status: "failed"; message: string } | { status: "read"; values: Values };
type Saving = { status: "idle" } | { status: "saving" } | { status: "saved" } | { status: "failed"; message: string };
type Answer<Values> = Promise<{ data?: Values; response: Response }>;

/** What a sheet says when Duva can't read or save its values. */
interface SheetCopy {
  failed: (status: number) => string;
  unreachable: string;
  saveFailed: (status: number) => string;
  saveUnreachable: string;
}

interface SheetState<Values> {
  read: Read<Values>;
  /** The values as chosen, once they are read. */
  chosen?: Values;
  choose(changes: Partial<Values>): void;
  saving: Saving;
  save(): Promise<void>;
  load(): Promise<void>;
  /** Whether every choice is as saved, so there is nothing to save. */
  unchanged: boolean;
}

/**
 * A sheet's values as Duva has them, and as the human chooses them until they save. `read` and
 * `write` call Duva, and `onSaved` hears of what Duva saved.
 */
function useSheet<Values extends object>({
  read: readValues,
  write,
  copy,
  onSaved,
  onSignedOut,
}: {
  read: () => Answer<Values>;
  write: (values: Values) => Answer<Values>;
  copy: SheetCopy;
  onSaved?: (values: Values) => void;
  onSignedOut: () => void;
}): SheetState<Values> {
  const [read, setRead] = useState<Read<Values>>({ status: "loading" });
  const [chosen, setChosen] = useState<Values>();
  const [saving, setSaving] = useState<Saving>({ status: "idle" });

  // A sheet reads once when it opens, with the call it was first given.
  const first = useRef({ readValues, copy });
  const load = useCallback(async () => {
    const { readValues, copy } = first.current;
    setRead({ status: "loading" });
    const { data, response } = await readValues().catch(() => ({ data: undefined, response: undefined }));
    if (response?.status === 401) return onSignedOut();
    if (data === undefined) return setRead({ status: "failed", message: response === undefined ? copy.unreachable : copy.failed(response.status) });
    setRead({ status: "read", values: data });
    setChosen(data);
  }, [onSignedOut]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (chosen === undefined) return;
    setSaving({ status: "saving" });
    const { data, response } = await write(chosen).catch(() => ({ data: undefined, response: undefined }));
    if (response?.status === 401) return onSignedOut();
    if (data === undefined) return setSaving({ status: "failed", message: response === undefined ? copy.saveUnreachable : copy.saveFailed(response.status) });
    setRead({ status: "read", values: data });
    setSaving({ status: "saved" });
    onSaved?.(data);
  };

  const choose = (changes: Partial<Values>) => {
    setChosen((current) => (current === undefined ? current : { ...current, ...changes }));
    setSaving({ status: "idle" });
  };

  // A value can be a list, so values are compared as JSON.
  const unchanged = read.status !== "read" || chosen === undefined || Object.entries(chosen).every(([name, value]) => JSON.stringify(read.values[name as keyof Values]) === JSON.stringify(value));
  return { read, chosen, choose, saving, save, load, unchanged };
}

/** Settings' pages, in the index's order: the human's own, then the admins'. */
const pages = ["you", "screener", "agents", "organization", "domains", "addresses", "people", "groups"] as const;
type Page = (typeof pages)[number];
const adminPages: readonly Page[] = ["organization", "domains", "addresses", "people", "groups"];

const pageHref = (page: Page) => `#/settings/${page}`;

/**
 * The page the address's hash names, and the agent whose line opens on the Agents page. Plain
 * `#/settings` is the index, which shows You beside it outside a phone.
 */
function pageOf(hash: string): { page?: Page; agent?: string } {
  const [, page, agent] = /^#\/settings\/([^/]+)(?:\/(.+))?$/.exec(hash) ?? [];
  if (page === "agents" && agent !== undefined) return { page, agent: decodeURIComponent(agent) };
  return { page: (pages as readonly string[]).includes(page ?? "") ? (page as Page) : undefined };
}

function useHash(): string {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const changed = () => setHash(location.hash);
    addEventListener("hashchange", changed);
    return () => removeEventListener("hashchange", changed);
  }, []);
  return hash;
}

/** An agent the human sponsors, as the index lists it: whether it is paused, and how many of its sends wait for its send limits. */
type IndexedAgent = { id: string; name: string; paused: boolean; waiting: number };

/** What a page's line in the index says it holds now, and the function color it says it in, if any. */
type EntryState = { text: string; code?: "call" | "sent" };

/**
 * What the index says beside its pages: the agents the human sponsors, how the Screener stands in
 * their mailboxes, and for an admin, the organization's retention, its domains, which say when DNS
 * records are missing, and how many mailboxes, humans and groups it has. It reads again whenever the
 * human opens another page, so what they changed on one shows, and whenever `changes` counts another
 * change to an agent there. A list Duva can't give now leaves its line without a state.
 */
function useIndex({
  client,
  admin,
  mailboxes,
  hash,
  changes,
  onSignedOut,
}: {
  client: DuvaClient;
  admin: boolean;
  mailboxes: Mailbox[] | undefined;
  hash: string;
  changes: number;
  onSignedOut: () => void;
}): { agents?: IndexedAgent[]; states: Partial<Record<Page, EntryState>> } {
  const [agents, setAgents] = useState<IndexedAgent[]>();
  const [states, setStates] = useState<Partial<Record<Page, EntryState>>>({});
  const listed = useRef(mailboxes);
  listed.current = mailboxes;
  const mailboxesKey = mailboxes?.map(({ id }) => id).join();

  useEffect(() => {
    const mailboxes = listed.current;
    if (mailboxes === undefined) return;
    let current = true;
    const quietly = <T,>(call: Promise<T>) => call.catch(() => ({ data: undefined, response: undefined }));
    const none = Promise.resolve({ data: undefined, response: undefined });
    void (async () => {
      const [list, domains, settings, organizationMailboxes, humans, groups, screeners] = await Promise.all([
        quietly(client.GET("/agents")),
        admin ? quietly(client.GET("/domains")) : none,
        admin ? quietly(client.GET("/organization/settings")) : none,
        admin ? quietly(client.GET("/organization/mailboxes")) : none,
        admin ? quietly(client.GET("/humans")) : none,
        admin ? quietly(client.GET("/groups")) : none,
        Promise.all(mailboxes.map((mailbox) => quietly(client.GET("/mailboxes/{mailbox}/screener", { params: { path: { mailbox: mailbox.id } } })))),
      ]);
      if (!current) return;
      if ([list, domains, settings, organizationMailboxes, humans, groups, ...screeners].some(({ response }) => response?.status === 401)) return onSignedOut();
      // An agent's sends wait in the human's mailboxes, where it sends as them. A list Duva can't give now counts none.
      const drafts = await Promise.all(
        mailboxes.map(async (mailbox) => {
          const { data } = await quietly(client.GET("/mailboxes/{mailbox}/drafts", { params: { path: { mailbox: mailbox.id } } }));
          return (data?.drafts ?? []).filter((draft) => draft.send?.state === "waitingForLimit").map((draft) => draft.updatedBy);
        }),
      );
      if (!current) return;
      const waiting = drafts.flat();
      if (list.data !== undefined) {
        setAgents(
          [...list.data.agents]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((agent) => ({ id: agent.id, name: agent.name, paused: agent.paused !== undefined, waiting: waiting.filter((by) => by === agent.id).length })),
        );
      }
      const copy = strings.settings.index;
      const read: Partial<Record<Page, EntryState>> = {};
      if (list.data !== undefined && list.data.agents.length > 0) read.agents = { text: copy.agents(list.data.agents.length) };
      const on = screeners.map(({ data }) => data?.on);
      if (on.every((each) => each !== undefined)) read.screener = { text: copy.screener(on.filter(Boolean).length, on.length) };
      if (settings.data !== undefined) read.organization = { text: copy.organization(settings.data.retentionDays) };
      if (domains.data !== undefined) {
        const missing = domains.data.domains
          .map(({ domain, records }) => ({ domain, records: records.filter(({ status }) => status === "missing").length }))
          .filter(({ records }) => records > 0);
        // Records missing need an admin at the domain's DNS provider, so they are said in orange.
        read.domains =
          missing.length === 0
            ? { text: copy.domains(domains.data.domains.map(({ domain }) => domain)) }
            : { text: missing.length === 1 ? copy.recordsMissing(missing[0]!.domain, missing[0]!.records) : copy.domainsMissing(missing.length), code: "call" };
      }
      if (organizationMailboxes.data !== undefined) read.addresses = { text: copy.mailboxes(organizationMailboxes.data.mailboxes.length) };
      if (humans.data !== undefined) read.people = { text: copy.humans(humans.data.humans.length) };
      if (groups.data !== undefined) read.groups = { text: copy.groups(groups.data.groups.length) };
      setStates(read);
    })();
    return () => {
      current = false;
    };
  }, [client, admin, mailboxesKey, hash, changes, onSignedOut]);
  return { agents, states };
}

/**
 * The settings view. Its page is in the address's hash, after `#/settings`, so a link, such as an
 * alert's to an agent's line, opens it. `mailboxes` are the human's own, once they are listed: `own` lists every mailbox of the human's, if they have more than `mine`.
 */
export function Settings({
  client,
  me,
  admin,
  email,
  mailboxes,
  agent: agentAsked,
  onPreferences,
  onSignedOut,
}: {
  client: DuvaClient;
  me: string;
  admin: boolean;
  email: string;
  /** The agent whose line on the Agents page opens first, if the hash doesn't say. */
  agent?: string;
  mailboxes: { mine?: Mailbox; own?: Mailbox[] } | undefined;
  onPreferences: (preferences: Preferences) => void;
  onSignedOut: () => void;
}) {
  const hash = useHash();
  const asked = pageOf(hash);
  const preferences = useContext(PreferencesContext);
  const own = mailboxes === undefined ? [] : (mailboxes.own ?? (mailboxes.mine === undefined ? [] : [mailboxes.mine]));
  // A pause or a send on the Your agents page changes what the index says of the agent.
  const [agentChanges, setAgentChanges] = useState(0);
  const agentChanged = useCallback(() => setAgentChanges((count) => count + 1), []);
  const index = useIndex({ client, admin, mailboxes: mailboxes === undefined ? undefined : own, hash, changes: agentChanges, onSignedOut });
  const sponsors = (index.agents?.length ?? 0) > 0;
  // Pages a human can't open, such as an admin's for a member, or one with nothing on it, open You instead.
  const canOpen = (page: Page) =>
    adminPages.includes(page) ? admin : page === "screener" ? mailboxes === undefined || own.length > 0 : page === "agents" ? sponsors || index.agents === undefined : true;
  const page = asked.page !== undefined && canOpen(asked.page) ? asked.page : "you";
  const agent = asked.agent ?? agentAsked;

  useEffect(() => {
    document.title = strings.title(strings.settings.title);
  }, []);
  // A screen reader follows the human to the page they opened, and a page opened from another starts at its top.
  // A page that can't open and opens You instead counts as opening another.
  const opened = useRef(false);
  const view = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const arriving = !opened.current;
    opened.current = true;
    // Arriving at the index, the focus is the shell's to give, as on every view.
    if (arriving && asked.page === undefined) return;
    const focus = (title: HTMLElement) => {
      title.tabIndex = -1;
      title.focus({ preventScroll: true });
    };
    const sheetTitle = () => (asked.page === undefined ? null : (view.current?.querySelector<HTMLElement>("h2") ?? null));
    if (!arriving) {
      // On a desk the sheet's column scrolls by itself, and on a phone the page does.
      scrollTo(0, 0);
      view.current?.scrollTo(0, 0);
      // Back at the index, as on a phone, the title of Settings takes the focus, since the sheets beside it don't show there.
      const title = sheetTitle() ?? document.querySelector<HTMLElement>("main h1");
      if (title !== null) focus(title);
      return;
    }
    // Arriving at a page, by its address or a reload, its sheet's title takes the focus from the title of Settings, which
    // the shell focuses in its own effect, run after this one since React runs a child's effects first. A sheet that
    // waits for the mailboxes, as the Screener does, shows its title later, unless the human has moved the focus by then.
    const take = () => {
      const title = sheetTitle();
      const active = document.activeElement;
      if (title === null || (active !== document.body && active !== document.querySelector("main h1"))) return false;
      focus(title);
      return true;
    };
    const watching = new MutationObserver(() => {
      if (take()) watching.disconnect();
    });
    const focusing = setTimeout(() => {
      if (!take() && view.current !== null) watching.observe(view.current, { childList: true, subtree: true });
    });
    return () => {
      clearTimeout(focusing);
      watching.disconnect();
    };
  }, [asked.page, page]);

  // A change on one of the admins' sheets can change what the others show, so all read again after each.
  const [setupChanges, setSetupChanges] = useState(0);
  const setupChanged = useCallback(() => setSetupChanges((count) => count + 1), []);
  // The actor the People sheet asked to give a mailbox to, which the Addresses sheet's form takes.
  const [giving, setGiving] = useState<Giving>();

  const copy = strings.settings;
  const states: Partial<Record<Page, EntryState>> = { you: { text: copy.index.you(preferences) }, ...index.states };
  // A line is named by its page alone, and says what the page holds now as its description.
  const line = (key: string, href: string, name: string, current: boolean, state?: EntryState, agent?: IndexedAgent) => {
    const stateId = `settings-state-${key}`;
    return (
      <a
        href={href}
        className={agent?.paused === true ? "settings-entry settings-entry-paused" : "settings-entry"}
        aria-current={current ? "page" : undefined}
        aria-label={name}
        aria-describedby={state === undefined ? undefined : stateId}
      >
        <span className="settings-entry-head">
          {agent !== undefined && <ActorMark kind="agent" agent={agent.id} />}
          <span className="settings-entry-name">{name}</span>
        </span>
        {state !== undefined && (
          <span id={stateId} className={state.code === undefined ? "settings-entry-state" : `settings-entry-state settings-entry-state-${state.code}`}>
            {state.code === "sent" && <span className="settings-light" />}
            {state.text}
          </span>
        )}
      </a>
    );
  };
  const entry = (each: Page, name: string) => line(each, pageHref(each), name, each === page && (each !== "agents" || agent === undefined), states[each]);
  // An agent's line says whether it runs or is paused, and what waits for its send limits, in orange since the human can send it now.
  const agentState = (each: IndexedAgent): EntryState => ({
    text: [each.paused ? copy.index.paused : copy.index.running, ...(each.waiting > 0 ? [copy.index.waiting(each.waiting)] : [])].join(", "),
    ...(each.waiting > 0 ? { code: "call" as const } : each.paused ? {} : { code: "sent" as const }),
  });
  return (
    <main className={asked.page === undefined ? "desk settings-desk settings-at-index" : "desk settings-desk"}>
      <div className="settings-side">
        <h1 tabIndex={-1} className="view-title">
          {copy.title}
        </h1>
        <nav className="settings-index" aria-label={copy.title}>
          <h2 className="settings-index-heading" id="settings-group-you">
            {copy.index.group.you}
          </h2>
          <ul aria-labelledby="settings-group-you">
            <li>{entry("you", copy.you)}</li>
            {own.length > 0 && <li>{entry("screener", copy.screener.title)}</li>}
            {sponsors && (
              <li>
                {entry("agents", strings.agentSettings.title)}
                {index.agents !== undefined && index.agents.length > 0 && (
                  <ul className="settings-index-agents">
                    {index.agents.map((each) => (
                      <li key={each.id}>{line(`agent-${each.id}`, agentHref(each.id), each.name, page === "agents" && agent === each.id, agentState(each), each)}</li>
                    ))}
                  </ul>
                )}
              </li>
            )}
          </ul>
          {/* What the organization shares is the admins' to set, so only they see its group. */}
          {admin && (
            <>
              <h2 className="settings-index-heading" id="settings-group-organization">
                {copy.index.group.organization}
              </h2>
              <ul aria-labelledby="settings-group-organization">
                <li>{entry("organization", copy.organization)}</li>
                <li>{entry("domains", strings.domains.title)}</li>
                <li>{entry("addresses", strings.addresses.title)}</li>
                <li>{entry("people", strings.people.title)}</li>
                <li>{entry("groups", strings.groups.title)}</li>
              </ul>
            </>
          )}
        </nav>
      </div>
      <div className="settings-page" ref={view}>
        <p className="back settings-back">
          <a href="#/settings">
            <BackIcon />
            {copy.index.back}
          </a>
        </p>
        {page === "you" && <YouPage client={client} admin={admin} email={email} mailboxes={own} onPreferences={onPreferences} onSignedOut={onSignedOut} />}
        {page === "screener" && own.length > 0 && (
          <ScreenerSheet key={own.map(({ id }) => id).join()} client={client} mailboxes={own} onSignedOut={onSignedOut} />
        )}
        {page === "agents" && <AgentSettingsSheet client={client} me={me} email={email} admin={admin} mailboxes={mailboxes} open={agent} onChange={agentChanged} onSignedOut={onSignedOut} />}
        {page === "organization" && (
          <>
            <MailSheet client={client} onSignedOut={onSignedOut} />
            <AgentsSheet client={client} onSignedOut={onSignedOut} />
            <MailboxAgentsSheet client={client} onSignedOut={onSignedOut} />
          </>
        )}
        {page === "domains" && <DomainsSheet client={client} changes={setupChanges} onChange={setupChanged} onSignedOut={onSignedOut} />}
        {page === "addresses" && <AddressesSheet client={client} changes={setupChanges} giving={giving} onChange={setupChanged} onSignedOut={onSignedOut} />}
        {page === "people" && (
          <PeopleSheet
            client={client}
            me={email}
            changes={setupChanges}
            onChange={setupChanged}
            onGiveMailbox={(owner) => {
              setGiving((current) => ({ owner, asked: (current?.asked ?? 0) + 1 }));
              location.hash = pageHref("addresses");
            }}
            onSignedOut={onSignedOut}
          />
        )}
        {page === "groups" && <GroupsSheet client={client} changes={setupChanges} onChange={setupChanged} onSignedOut={onSignedOut} />}
      </div>
    </main>
  );
}

/**
 * The You page: the human's preferences and their own logo, then who is signed in, with Sign out,
 * and for a human who isn't an admin, the one organization setting that touches their mail, in a sentence.
 */
function YouPage({
  client,
  admin,
  email,
  mailboxes,
  onPreferences,
  onSignedOut,
}: {
  client: DuvaClient;
  admin: boolean;
  email: string;
  /** The human's own mailboxes, whose own logos they set. */
  mailboxes: Mailbox[];
  onPreferences: (preferences: Preferences) => void;
  onSignedOut: () => void;
}) {
  const [retention, setRetention] = useState<number>();
  useEffect(() => {
    if (admin) return;
    let current = true;
    void client
      .GET("/organization/settings")
      .then(({ data }) => current && data !== undefined && setRetention(data.retentionDays))
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [client, admin]);
  return (
    <>
      <YouSheet client={client} own={mailboxes} onPreferences={onPreferences} onSignedOut={onSignedOut} />
      {mailboxes.length > 0 && <CooModelsSheet client={client} onSignedOut={onSignedOut} />}
      <MyLogoSheet client={client} mailboxes={mailboxes} onSignedOut={onSignedOut} />
      {mailboxes.length > 0 && <McpSheet />}
      <div className="settings-aside">
        {retention !== undefined && <p>{strings.settings.organizationSummary(retention)}</p>}
        <div className="settings-signed-in">
          <p>{strings.settings.signedInAs(email)}</p>
          <button type="button" className="button button-quiet button-small" onClick={() => void loadConfig().then(signOut)}>
            {strings.signOut}
          </button>
        </div>
      </div>
    </>
  );
}

/**
 * Duva's MCP endpoint, on the API's domain, with how to connect Claude Code and Claude Desktop to it
 * (ADR-0028). A human without a mailbox has no mailbox agent for it to reach.
 */
function McpSheet() {
  const copy = strings.settings.mcp;
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let current = true;
    void loadConfig()
      .then((config) => current && setUrl(`${config.apiUrl}/mcp`))
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, []);
  if (url === undefined) return null;
  const command = `claude mcp add --transport http duva ${url}`;
  return (
    <section className="settings mcp-sheet" aria-labelledby="mcp-sheet">
      <div className="settings-head">
        <h2 id="mcp-sheet">{copy.title}</h2>
        <p id="mcp-sheet-lead">{copy.lead}</p>
      </div>
      <div className="setting">
        <h3 className="setting-title">{copy.address}</h3>
        <p className="mcp-line">
          <code>{url}</code>
          <CopyButton text={url} tabStop keysHint="mcp-sheet-lead" onFocus={() => undefined} />
        </p>
      </div>
      <div className="setting">
        <h3 className="setting-title">{copy.claudeCode}</h3>
        <p className="setting-lead">{copy.claudeCodeSteps}</p>
        <p className="mcp-line">
          <code>{command}</code>
          <CopyButton text={command} tabStop keysHint="mcp-sheet-lead" onFocus={() => undefined} />
        </p>
      </div>
      <div className="setting">
        <h3 className="setting-title">{copy.claudeDesktop}</h3>
        <p className="setting-lead">{copy.claudeDesktopSteps}</p>
      </div>
    </section>
  );
}

/** The languages search knows, as the contract lists them. */
const searchLanguages: Language[] = ["English", "Swedish", "Danish"];

/** Mail in these is indexed in its own language whatever the list says, so only the others rebuild the indexes. */
const alwaysIndexed: Language[] = ["English", "Swedish"];

type MailSettings = Pick<OrganizationSettings, "retentionDays" | "searchLanguages">;
type AgentsSettings = Pick<OrganizationSettings, "erasureErasesApprovals" | "agentSendsPerHourCap" | "agentNewRecipientsPerDayCap" | "undoWindowSeconds">;

/**
 * A sheet's share of the organization's settings, as Duva has them and as an admin saves them. Each
 * sheet saves only its own, so a save on one leaves the other's as they are.
 */
function useOrganizationSheet<Values extends object>(client: DuvaClient, pick: (settings: OrganizationSettings) => Values, onSignedOut: () => void) {
  // The settings as they were before the last save, so "Saved" can say what changes from now on.
  const before = useRef<Values>(undefined);
  const picked = async (answer: Answer<OrganizationSettings>) => {
    const { data, response } = await answer;
    return { data: data === undefined ? undefined : pick(data), response };
  };
  const sheet = useSheet<Values>({
    read: () => picked(client.GET("/organization/settings")),
    write: (values) => {
      before.current = sheet.read.status === "read" ? sheet.read.values : undefined;
      // Only an agent's change waits for approval, so a human's answer is the settings.
      return picked(client.PATCH("/organization/settings", { body: values }) as Answer<OrganizationSettings>);
    },
    copy: strings.settings,
    onSignedOut,
  });
  return { sheet, before: before.current, after: sheet.read.status === "read" ? sheet.read.values : undefined };
}

/** The organization's Mail sheet: how long Trash and Spam keep mail, and the languages search knows. */
function MailSheet({ client, onSignedOut }: { client: DuvaClient; onSignedOut: () => void }) {
  const { sheet, before, after } = useOrganizationSheet<MailSettings>(client, ({ retentionDays, searchLanguages }) => ({ retentionDays, searchLanguages }), onSignedOut);
  const [daysValid, setDaysValid] = useState(true);
  const copy = strings.settings.searchLanguages;
  // Only the languages mail isn't always indexed in rebuild the indexes, so only a change to one of them says so.
  const indexed = (languages: Language[]) => languages.filter((language) => !alwaysIndexed.includes(language)).join();
  return (
    <Sheet id="mail-settings" name={strings.settings.mail} lead={strings.settings.mailLead} sheet={sheet}>
      {(chosen) => (
        <>
          <Retention
            client={client}
            chosen={chosen.retentionDays}
            saved={after?.retentionDays ?? chosen.retentionDays}
            onChoose={(retentionDays) => {
              setDaysValid(retentionDays !== undefined);
              if (retentionDays !== undefined) sheet.choose({ retentionDays });
            }}
          />
          <fieldset>
            <legend>{copy.legend}</legend>
            <p className="setting-lead">{copy.lead}</p>
            <div className="choices-short">
              {searchLanguages.map((language) => (
                <label className="choice" key={language}>
                  <input
                    type="checkbox"
                    checked={chosen.searchLanguages.includes(language)}
                    onChange={(event) =>
                      sheet.choose({ searchLanguages: searchLanguages.filter((each) => (each === language ? event.target.checked : chosen.searchLanguages.includes(each))) })
                    }
                  />
                  <span className="choice-text">
                    <span className="choice-name">{copy.names[language]}</span>
                  </span>
                </label>
              ))}
            </div>
            {after !== undefined && indexed(after.searchLanguages) !== indexed(chosen.searchLanguages) && <p className="setting-note">{copy.rebuilds}</p>}
          </fieldset>
          <SaveRow
            sheet={sheet}
            saved={strings.settings.saved(
              before === undefined || after === undefined
                ? []
                : [
                    ...(before.retentionDays !== after.retentionDays ? ["retention" as const] : []),
                    ...(before.searchLanguages.join() !== after.searchLanguages.join() ? ["languages" as const] : []),
                    ...(indexed(before.searchLanguages) !== indexed(after.searchLanguages) ? ["indexes" as const] : []),
                  ],
            )}
            invalid={!daysValid}
          />
        </>
      )}
    </Sheet>
  );
}

/**
 * The organization's Agents sheet: how long an approved send waits to be undone, whether erasing a
 * thread erases its approval records, and the caps on agents' send limits.
 */
function AgentsSheet({ client, onSignedOut }: { client: DuvaClient; onSignedOut: () => void }) {
  const { sheet, before, after } = useOrganizationSheet<AgentsSettings>(
    client,
    ({ erasureErasesApprovals, agentSendsPerHourCap, agentNewRecipientsPerDayCap, undoWindowSeconds }) => ({ erasureErasesApprovals, agentSendsPerHourCap, agentNewRecipientsPerDayCap, undoWindowSeconds }),
    onSignedOut,
  );
  const [capsValid, setCapsValid] = useState({ agentSendsPerHourCap: true, agentNewRecipientsPerDayCap: true });
  const [windowValid, setWindowValid] = useState(true);
  const copy = strings.settings.erasure;
  return (
    <Sheet id="agents-settings" name={strings.settings.agents} lead={strings.settings.agentsLead} sheet={sheet}>
      {(chosen) => (
        <>
          <UndoWindow
            chosen={chosen.undoWindowSeconds}
            onChoose={(seconds) => {
              setWindowValid(seconds !== undefined);
              if (seconds !== undefined) sheet.choose({ undoWindowSeconds: seconds });
            }}
          />
          <fieldset>
            <legend>{copy.legend}</legend>
            <p className="setting-lead">{copy.lead}</p>
            {([false, true] as const).map((value) => (
              <Choice
                key={String(value)}
                name="erasureErasesApprovals"
                checked={chosen.erasureErasesApprovals === value}
                onChoose={() => sheet.choose({ erasureErasesApprovals: value })}
                label={value ? copy.erase : copy.keep}
                hint={value ? copy.eraseHint : copy.keepHint}
              />
            ))}
          </fieldset>
          <fieldset>
            <legend>{strings.settings.caps.legend}</legend>
            <p className="setting-lead">{strings.settings.caps.lead}</p>
            <div className="limits">
              {(["agentSendsPerHourCap", "agentNewRecipientsPerDayCap"] as const).map((cap) => (
                <Cap
                  key={cap}
                  cap={cap}
                  chosen={chosen[cap]}
                  saved={after?.[cap] ?? chosen[cap]}
                  onChoose={(value) => {
                    setCapsValid((current) => ({ ...current, [cap]: value !== undefined }));
                    if (value !== undefined) sheet.choose({ [cap]: value });
                  }}
                />
              ))}
            </div>
          </fieldset>
          <SaveRow
            sheet={sheet}
            saved={strings.settings.saved(
              before === undefined || after === undefined
                ? []
                : [
                    ...(before.undoWindowSeconds !== after.undoWindowSeconds ? ["undo" as const] : []),
                    ...(before.erasureErasesApprovals !== after.erasureErasesApprovals ? ["erasure" as const] : []),
                    ...(after.agentSendsPerHourCap < before.agentSendsPerHourCap || after.agentNewRecipientsPerDayCap < before.agentNewRecipientsPerDayCap ? ["caps" as const] : []),
                  ],
            )}
            invalid={!capsValid.agentSendsPerHourCap || !capsValid.agentNewRecipientsPerDayCap || !windowValid}
          />
        </>
      )}
    </Sheet>
  );
}

type MailboxAgentsSettings = Pick<OrganizationSettings, "mailboxAgentAllowedModels" | "mailboxAgentModel" | "mailboxAgentHarderModel" | "mailboxAgentDecider" | "mailboxAgentSpendCap">;
type Model = MailboxAgentsSettings["mailboxAgentModel"];
type MeasuredModel = components["schemas"]["MeasuredModel"];
const organizationModels = ["mailboxAgentModel", "mailboxAgentHarderModel"] as const;

/** The measured models as Duva lists them for this deployment, or whether they couldn't be. */
function useMeasuredModels(client: DuvaClient): { models?: MeasuredModel[]; failed: boolean } {
  const [read, setRead] = useState<{ models?: MeasuredModel[]; failed: boolean }>({ failed: false });
  useEffect(() => {
    void client
      .GET("/organization/mailbox-agent-models")
      .then(({ data }) => setRead(data === undefined ? { failed: true } : { models: data.models, failed: false }))
      .catch(() => setRead({ failed: true }));
  }, [client]);
  return read;
}

/**
 * The organization's Mailbox agents sheet: the measured models humans may choose, each with its
 * flag, how it did on Coo's evaluation and what a task costs, the organization's everyday and
 * harder models among them, and the spend cap, with what they spent this month (ADR-0027, ADR-0035).
 * Allowing a model that processes mail outside the deployment's continent says so first.
 */
function MailboxAgentsSheet({ client, onSignedOut }: { client: DuvaClient; onSignedOut: () => void }) {
  const { sheet } = useOrganizationSheet<MailboxAgentsSettings>(
    client,
    ({ mailboxAgentAllowedModels, mailboxAgentModel, mailboxAgentHarderModel, mailboxAgentDecider, mailboxAgentSpendCap }) => ({
      mailboxAgentAllowedModels,
      mailboxAgentModel,
      mailboxAgentHarderModel,
      mailboxAgentDecider,
      mailboxAgentSpendCap,
    }),
    onSignedOut,
  );
  const [capText, setCapText] = useState<string>();
  const [spend, setSpend] = useState<components["schemas"]["MailboxAgentSpend"]>();
  // A model outside the deployment's continent, ticked but not yet allowed, until the admin says.
  const [asking, setAsking] = useState<Model>();
  const saved = sheet.saving.status;
  const { models, failed } = useMeasuredModels(client);
  useEffect(() => {
    void client
      .GET("/organization/mailbox-agent-spend")
      .then(({ data }) => setSpend(data))
      .catch(() => undefined);
  }, [client, saved]);
  const copy = strings.settings.mailboxAgents;
  const money = (dollars: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(dollars);
  return (
    <Sheet id="mailbox-agents-settings" name={copy.title} lead={copy.lead} sheet={sheet}>
      {(chosen) => {
        const text = capText ?? String(chosen.mailboxAgentSpendCap);
        const capValid = /^\d+$/.test(text.trim()) && Number(text.trim()) <= 10_000;
        const allowed = chosen.mailboxAgentAllowedModels;
        // Kept in the measured models' order, as Duva keeps the list.
        const allow = (model: Model, on: boolean) =>
          sheet.choose({ mailboxAgentAllowedModels: (models ?? []).map(({ model }) => model).filter((each) => (each === model ? on : allowed.includes(each))) });
        return (
          <>
            <fieldset>
              <legend>{copy.model.legend}</legend>
              <p className="setting-lead">{copy.model.lead}</p>
              {failed && (
                <p className="field-error" role="alert">
                  {copy.model.modelsFailed}
                </p>
              )}
              {models?.map((model) => {
                const job = organizationModels.find((each) => chosen[each] === model.model);
                return (
                  <div key={model.model} className="model-choice">
                    <label className="choice">
                      <input
                        type="checkbox"
                        checked={allowed.includes(model.model)}
                        disabled={job !== undefined}
                        aria-describedby={`allow-${model.model}-hint`}
                        onChange={(event) => {
                          if (event.target.checked && outsideContinent(model)) return setAsking(model.model);
                          setAsking(undefined);
                          allow(model.model, event.target.checked);
                        }}
                      />
                      <span className="choice-text">
                        <ModelName model={model} />
                        <span className="hint" id={`allow-${model.model}-hint`}>
                          {strings.settings.modelMeasured(model)}
                          {job !== undefined && ` ${copy.model.isDefault(job === "mailboxAgentModel" ? "everyday" : "harder")}`}
                        </span>
                      </span>
                    </label>
                    {asking === model.model && (
                      <div className="notice notice-call model-outside" role="alert">
                        <p>{copy.model.outside(model.name, strings.settings.modelPlaceSaid(model.processedIn, model.profileId, model.region))}</p>
                        <div className="model-outside-actions">
                          <button
                            type="button"
                            className="button button-small button-primary"
                            onClick={() => {
                              setAsking(undefined);
                              allow(model.model, true);
                            }}
                          >
                            {copy.model.allow}
                          </button>
                          <button type="button" className="button button-small button-quiet" onClick={() => setAsking(undefined)}>
                            {copy.model.keepOff}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </fieldset>
            <fieldset>
              <legend>{copy.model.defaultsLegend}</legend>
              <p className="setting-lead">{copy.model.defaultsLead}</p>
              <div className="limits">
                {organizationModels.map((job) => (
                  <div className="limit" key={job}>
                    <label htmlFor={`mailbox-agent-${job}`} className="limit-name">
                      {copy.model.jobs[job]}
                    </label>
                    <select id={`mailbox-agent-${job}`} value={chosen[job]} onChange={(event) => sheet.choose({ [job]: event.target.value as Model })}>
                      {(models ?? [])
                        .filter(({ model }) => allowed.includes(model))
                        .map((model) => (
                          <option key={model.model} value={model.model}>
                            {`${model.name}, ${strings.settings.modelPlaceSaid(model.processedIn, model.profileId, model.region)}`}
                          </option>
                        ))}
                    </select>
                  </div>
                ))}
              </div>
              <label className="choice">
                <input type="checkbox" checked={chosen.mailboxAgentDecider} onChange={(event) => sheet.choose({ mailboxAgentDecider: event.target.checked })} />
                <span className="choice-text">
                  <span className="choice-name">{copy.model.decider}</span>
                  <span className="hint">{copy.model.deciderHint}</span>
                </span>
              </label>
            </fieldset>
            <fieldset>
              <legend>{copy.cap.legend}</legend>
              {spend !== undefined && <p className="setting-lead">{copy.cap.spent(money(spend.spent), spend.month)}</p>}
              <div className="limits">
                <div className="limit">
                  <label htmlFor="mailbox-agent-cap" className="limit-name">
                    {copy.cap.label}
                  </label>
                  <input
                    id="mailbox-agent-cap"
                    type="text"
                    inputMode="numeric"
                    aria-invalid={!capValid}
                    aria-describedby="mailbox-agent-cap-hint"
                    value={text}
                    onChange={(event) => {
                      setCapText(event.target.value);
                      const value = event.target.value.trim();
                      if (/^\d+$/.test(value) && Number(value) <= 10_000) sheet.choose({ mailboxAgentSpendCap: Number(value) });
                    }}
                  />
                  <p id="mailbox-agent-cap-hint" className={capValid ? "hint" : "field-error"}>
                    {capValid ? copy.cap.hint : copy.cap.invalid}
                  </p>
                </div>
              </div>
            </fieldset>
            <SaveRow sheet={sheet} saved={strings.settings.saved([])} invalid={!capValid} />
          </>
        );
      }}
    </Sheet>
  );
}

/** The retention period typed, if it is a whole number of days Duva takes, from 7 to 365. */
function daysOf(text: string): number | undefined {
  const days = /^\d+$/.test(text.trim()) ? Number(text.trim()) : undefined;
  return days !== undefined && days >= 7 && days <= 365 ? days : undefined;
}

/** The undo window typed, if it is a whole number of seconds Duva takes, from 0 to 120. */
function secondsOf(text: string): number | undefined {
  const seconds = /^\d+$/.test(text.trim()) ? Number(text.trim()) : undefined;
  return seconds !== undefined && seconds <= 120 ? seconds : undefined;
}

/** How many seconds an approved send waits, so its sponsor can undo it, as a short field. `onChoose` hears of an invalid one as undefined. */
function UndoWindow({ chosen, onChoose }: { chosen: number; onChoose: (seconds: number | undefined) => void }) {
  const copy = strings.settings.undoWindow;
  const [text, setText] = useState(String(chosen));
  const valid = secondsOf(text) !== undefined;
  return (
    <fieldset>
      <legend>{copy.legend}</legend>
      <p className="setting-lead">{copy.lead}</p>
      <div className="limits">
        <div className="limit">
          <label htmlFor="undo-window" className="limit-name">
            {copy.label}
          </label>
          <input
            id="undo-window"
            type="text"
            inputMode="numeric"
            aria-invalid={!valid}
            aria-describedby="undo-window-hint"
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              onChoose(secondsOf(event.target.value));
            }}
          />
          <p id="undo-window-hint" className={valid ? "hint" : "field-error"}>
            {valid ? copy.hint : copy.invalid}
          </p>
        </div>
      </div>
    </fieldset>
  );
}

/** The most a cap can be, as the contract says. */
const capMost = 10_000;


/**
 * One of the agents' caps, as a short field of a whole number, from 1 to 10,000. A lower cap than
 * the saved one says that saving lowers the agents above it. `onChoose` hears of each valid cap,
 * and of an invalid one as undefined.
 */
function Cap({ cap, chosen, saved, onChoose }: { cap: "agentSendsPerHourCap" | "agentNewRecipientsPerDayCap"; chosen: number; saved: number; onChoose: (value: number | undefined) => void }) {
  const copy = strings.agentSettings.limits;
  const [text, setText] = useState(String(chosen));
  const value = wholeNumber(text, capMost);
  const id = `cap-${cap}`;
  return (
    <div className="limit">
      <label htmlFor={id} className="limit-name">
        {cap === "agentSendsPerHourCap" ? copy.perHour : copy.newPerDay}
      </label>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        aria-invalid={value === undefined}
        aria-describedby={value === undefined || value < saved ? `${id}-hint` : undefined}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          onChoose(wholeNumber(event.target.value, capMost));
        }}
      />
      {value === undefined ? (
        <p id={`${id}-hint`} className="field-error">
          {copy.invalid(capMost)}
        </p>
      ) : value < saved ? (
        <p id={`${id}-hint`} className="setting-note">
          {strings.settings.caps.lowering}
        </p>
      ) : null}
    </div>
  );
}

type Preview = { status: "none" } | { status: "counting" } | { status: "counted"; threads: number; days: number } | { status: "failed" };

/**
 * How many days Trash and Spam keep a thread, as a field of whole days. Shortening it reaches back,
 * so a shorter period than the saved one counts the threads saving it would erase.
 * `onChoose` hears of each valid period, and of an invalid one as undefined.
 */
function Retention({ client, chosen, saved, onChoose }: { client: DuvaClient; chosen: number; saved: number; onChoose: (days: number | undefined) => void }) {
  const copy = strings.settings.retention;
  const [text, setText] = useState(String(chosen));
  const [preview, setPreview] = useState<Preview>({ status: "none" });
  const days = daysOf(text);
  const valid = days !== undefined;
  const shorter = valid && days < saved;

  useEffect(() => {
    if (!shorter) return setPreview({ status: "none" });
    setPreview({ status: "counting" });
    let current = true;
    // Typing a number passes through shorter ones, so it counts only once the typing pauses.
    const counting = setTimeout(() => {
      void client
        .GET("/organization/settings/retention-preview", { params: { query: { retentionDays: days } } })
        .then(({ data }) => current && setPreview(data === undefined ? { status: "failed" } : { status: "counted", threads: data.threads, days }))
        .catch(() => current && setPreview({ status: "failed" }));
    }, 300);
    return () => {
      current = false;
      clearTimeout(counting);
    };
  }, [client, shorter, days]);

  return (
    <fieldset>
      <legend>{copy.legend}</legend>
      <p className="setting-lead">{copy.lead}</p>
      <div className="retention">
        <input
          type="text"
          inputMode="numeric"
          aria-label={copy.legend}
          aria-describedby="retention-hint"
          aria-invalid={!valid}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            onChoose(daysOf(event.target.value));
          }}
        />
        <span>{copy.days}</span>
      </div>
      {valid ? (
        <p id="retention-hint" className="hint">
          {copy.hint}
        </p>
      ) : (
        <p id="retention-hint" className="field-error">
          {copy.invalid}
        </p>
      )}
      {preview.status !== "none" && (
        <p className="setting-note" role="status">
          {preview.status === "counting" ? copy.counting : preview.status === "failed" ? copy.countFailed : copy.erases(preview.threads, preview.days)}
        </p>
      )}
    </fieldset>
  );
}

const hourCycles: Preferences["hourCycle"][] = ["locale", "h12", "h23"];
const dateFormats: Preferences["dateFormat"][] = ["locale", "iso", "dayMonth", "monthDay"];
const mailViews: Preferences["mailView"][] = ["html", "text"];
const keyboardShortcuts: Preferences["keyboardShortcuts"][] = ["on", "off"];
const cooSpeaksUp: Preferences["cooSpeaksUp"][] = ["on", "off"];

/**
 * The human's own preferences: how times and dates show, each choice with an example built from
 * today, how mail shows, whether keyboard shortcuts work, and whether Coo speaks up. With several
 * mailboxes, `own`, also where the web app opens and which address new mail in All mailboxes starts from (ADR-0033).
 */
function YouSheet({
  client,
  own,
  onPreferences,
  onSignedOut,
}: {
  client: DuvaClient;
  own: Mailbox[];
  onPreferences: (preferences: Preferences) => void;
  onSignedOut: () => void;
}) {
  const several = own.length > 1;
  // New mail starts from one of their mailboxes' addresses, which Duva says it does by default.
  const fromChoices = own.flatMap(({ addresses }) => addresses);
  const sheet = useSheet<Preferences>({
    read: () => client.GET("/preferences"),
    // Coo's models are their own sheet's to save, so this one leaves them as they are.
    write: ({ cooEverydayModel: _everyday, cooHarderModel: _harder, ...preferences }) => client.PATCH("/preferences", { body: preferences }),
    copy: {
      failed: strings.settings.preferencesFailed,
      unreachable: strings.settings.preferencesUnreachable,
      saveFailed: strings.settings.preferencesSaveFailed,
      saveUnreachable: strings.settings.preferencesSaveUnreachable,
    },
    onSaved: onPreferences,
    onSignedOut,
  });
  // Today in the afternoon, so 12- and 24-hour time differ.
  const today = new Date();
  today.setHours(14, 30, 0, 0);
  const copy = strings.settings;
  return (
    <Sheet id="your-preferences" name={copy.you} lead={copy.youLead} sheet={sheet}>
      {(chosen) => (
        <>
          <fieldset>
            <legend>{copy.hourCycle.legend}</legend>
            <p className="setting-lead">{copy.hourCycle.lead}</p>
            <div className="choices-short">
              {hourCycles.map((hourCycle) => (
                <Choice
                  key={hourCycle}
                  name="hourCycle"
                  checked={chosen.hourCycle === hourCycle}
                  onChoose={() => sheet.choose({ hourCycle })}
                  label={copy.hourCycle[hourCycle]}
                  hint={datesFor({ ...chosen, hourCycle }).clock(today)}
                />
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>{copy.dateFormat.legend}</legend>
            <p className="setting-lead">{copy.dateFormat.lead}</p>
            <div className="choices-short">
              {dateFormats.map((dateFormat) => (
                <Choice
                  key={dateFormat}
                  name="dateFormat"
                  checked={chosen.dateFormat === dateFormat}
                  onChoose={() => sheet.choose({ dateFormat })}
                  label={copy.dateFormat[dateFormat]}
                  hint={datesFor({ ...chosen, dateFormat }).date(today)}
                />
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>{copy.mailView.legend}</legend>
            <p className="setting-lead">{copy.mailView.lead}</p>
            {mailViews.map((mailView) => (
              <Choice
                key={mailView}
                name="mailView"
                checked={chosen.mailView === mailView}
                onChoose={() => sheet.choose({ mailView })}
                label={copy.mailView[mailView]}
                hint={copy.mailView[`${mailView}Hint`]}
              />
            ))}
          </fieldset>
          <fieldset>
            <legend>{copy.keyboardShortcuts.legend}</legend>
            <p className="setting-lead">{copy.keyboardShortcuts.lead}</p>
            {keyboardShortcuts.map((choice) => (
              <Choice
                key={choice}
                name="keyboardShortcuts"
                checked={chosen.keyboardShortcuts === choice}
                onChoose={() => sheet.choose({ keyboardShortcuts: choice })}
                label={copy.keyboardShortcuts[choice]}
                hint={copy.keyboardShortcuts[`${choice}Hint`]}
              />
            ))}
          </fieldset>
          <fieldset>
            <legend>{copy.cooSpeaksUp.legend}</legend>
            <p className="setting-lead">{copy.cooSpeaksUp.lead}</p>
            {cooSpeaksUp.map((choice) => (
              <Choice
                key={choice}
                name="cooSpeaksUp"
                checked={chosen.cooSpeaksUp === choice}
                onChoose={() => sheet.choose({ cooSpeaksUp: choice })}
                label={copy.cooSpeaksUp[choice]}
                hint={copy.cooSpeaksUp[`${choice}Hint`]}
              />
            ))}
          </fieldset>
          {several && (
            <fieldset>
              <legend>{copy.opensOn.legend}</legend>
              <p className="setting-lead">{copy.opensOn.lead}</p>
              <Choice name="opensOn" checked={!own.some(({ id }) => id === chosen.opensOn)} onChoose={() => sheet.choose({ opensOn: "all" })} label={strings.mailboxes.all} hint={copy.opensOn.allHint} />
              {own.map((mailbox) => (
                <Choice
                  key={mailbox.id}
                  name="opensOn"
                  checked={chosen.opensOn === mailbox.id}
                  onChoose={() => sheet.choose({ opensOn: mailbox.id })}
                  label={strings.mailboxes.address(mailbox)}
                  hint={copy.opensOn.oneHint}
                />
              ))}
            </fieldset>
          )}
          {several && (
            <fieldset>
              <legend>{copy.newMailFrom.legend}</legend>
              <p className="setting-lead">{copy.newMailFrom.lead}</p>
              <div className="setting-select">
                <label htmlFor="new-mail-from" className="visually-hidden">
                  {copy.newMailFrom.legend}
                </label>
                <select id="new-mail-from" value={chosen.newMailFrom ?? fromChoices[0]} onChange={(event) => sheet.choose({ newMailFrom: event.target.value })}>
                  {fromChoices.map((address) => (
                    <option key={address} value={address}>
                      {address}
                    </option>
                  ))}
                </select>
              </div>
            </fieldset>
          )}
          <SaveRow sheet={sheet} saved={copy.preferencesSaved} />
        </>
      )}
    </Sheet>
  );
}

/** A choice of one of Coo's models: one the human picked, or the organization's. */
type CooModels = { cooEverydayModel: Model | "organization"; cooHarderModel: Model | "organization" };
const cooChoices = [
  ["cooEverydayModel", "everyday", "mailboxAgentModel"],
  ["cooHarderModel", "harder", "mailboxAgentHarderModel"],
] as const;

/**
 * The human's picks of their Coo's everyday and harder models, from those admins allow, each with
 * its flag and how it did on Coo's evaluation, or the organization's, as they are by default (ADR-0035).
 */
function CooModelsSheet({ client, onSignedOut }: { client: DuvaClient; onSignedOut: () => void }) {
  const copy = strings.settings.cooModels;
  const { models } = useMeasuredModels(client);
  const [organization, setOrganization] = useState<OrganizationSettings>();
  useEffect(() => {
    void client
      .GET("/organization/settings")
      .then(({ data }) => setOrganization(data))
      .catch(() => undefined);
  }, [client]);
  const picked = async (answer: Answer<Preferences>) => {
    const { data, response } = await answer;
    return { data: data === undefined ? undefined : { cooEverydayModel: data.cooEverydayModel ?? "organization", cooHarderModel: data.cooHarderModel ?? "organization" }, response } as { data?: CooModels; response: Response };
  };
  const sheet = useSheet<CooModels>({
    read: () => picked(client.GET("/preferences")),
    // The organization's is kept by giving no model of one's own.
    write: ({ cooEverydayModel, cooHarderModel }) =>
      picked(client.PATCH("/preferences", { body: { cooEverydayModel: cooEverydayModel === "organization" ? null : cooEverydayModel, cooHarderModel: cooHarderModel === "organization" ? null : cooHarderModel } })),
    copy,
    onSignedOut,
  });
  const allowed = models?.filter(({ allowed }) => allowed) ?? [];
  const named = (model: Model | undefined) => models?.find((each) => each.model === model);
  return (
    <Sheet id="coo-models" name={copy.title} lead={copy.lead} sheet={sheet}>
      {(chosen) => (
        <>
          {cooChoices.map(([name, job, setting]) => {
            const theirs = named(organization?.[setting]);
            return (
              <fieldset key={name}>
                <legend>{copy[job].legend}</legend>
                <p className="setting-lead">{copy[job].lead}</p>
                {theirs !== undefined && (
                  <Choice
                    name={name}
                    checked={chosen[name] === "organization"}
                    onChoose={() => sheet.choose({ [name]: "organization" })}
                    label={
                      <span className="model-name">
                        {copy.organizations(theirs.name)}
                        <ModelPlace model={theirs} />
                      </span>
                    }
                    hint={strings.settings.modelMeasured(theirs)}
                  />
                )}
                {allowed.map((model) => (
                  <Choice
                    key={model.model}
                    name={name}
                    checked={chosen[name] === model.model}
                    onChoose={() => sheet.choose({ [name]: model.model })}
                    label={<ModelName model={model} />}
                    hint={strings.settings.modelMeasured(model)}
                  />
                ))}
              </fieldset>
            );
          })}
          <SaveRow sheet={sheet} saved={copy.saved} invalid={models === undefined} />
        </>
      )}
    </Sheet>
  );
}

/** Whether each of the human's mailboxes' Screener is on, by mailbox ID. */
function ScreenerSheet({ client, mailboxes, onSignedOut }: { client: DuvaClient; mailboxes: Mailbox[]; onSignedOut: () => void }) {
  const copy = strings.settings.screener;
  const sheet = useSheet<Record<string, boolean>>({
    read: async () => {
      const each = await Promise.all(mailboxes.map((mailbox) => client.GET("/mailboxes/{mailbox}/screener", { params: { path: { mailbox: mailbox.id } } })));
      const unread = each.find(({ data }) => data === undefined);
      return { data: unread === undefined ? Object.fromEntries(each.map(({ data }, index) => [mailboxes[index]!.id, data!.on])) : undefined, response: (unread ?? each[0]!).response };
    },
    // Switching a Screener to what it is changes nothing, so every one is switched as chosen, one at a time, stopping at a failure.
    write: async (chosen) => {
      const saved: Record<string, boolean> = {};
      let response = new Response();
      for (const [mailbox, on] of Object.entries(chosen)) {
        const answer = await client.PATCH("/mailboxes/{mailbox}/screener", { params: { path: { mailbox } }, body: { on } });
        response = answer.response;
        if (answer.data === undefined) return { response };
        saved[mailbox] = answer.data.on;
      }
      return { data: saved, response };
    },
    copy,
    onSignedOut,
  });
  return (
    <Sheet id="screener-settings" name={copy.title} lead={copy.lead} sheet={sheet}>
      {(chosen) => (
        <>
          <ul className="screener-lines">
            {mailboxes.map((mailbox) => {
              const releasing = sheet.read.status === "read" && sheet.read.values[mailbox.id] === true && chosen[mailbox.id] === false;
              return (
                <li key={mailbox.id}>
                  <fieldset className="screener-line" aria-labelledby={`screener-${mailbox.id}-name`}>
                    <div className="screener-line-name" id={`screener-${mailbox.id}-name`}>
                      <span className="screener-line-owner">{copy.yours}</span>
                      <span className="screener-line-address">{strings.mailboxes.address(mailbox)}</span>
                    </div>
                    <div className="switch">
                      {([true, false] as const).map((on) => (
                        <label key={String(on)}>
                          <input type="radio" name={`screener-${mailbox.id}`} checked={chosen[mailbox.id] === on} onChange={() => sheet.choose({ [mailbox.id]: on })} />
                          <span>{on ? copy.on : copy.off}</span>
                        </label>
                      ))}
                    </div>
                    {releasing && <p className="setting-note" role="status">{copy.releasing}</p>}
                  </fieldset>
                </li>
              );
            })}
          </ul>
          <SaveRow sheet={sheet} saved={copy.saved} />
        </>
      )}
    </Sheet>
  );
}

/** A sheet: its name and who chooses what's on it, then its settings once they are read. */
function Sheet<Values extends object>({
  id,
  name,
  lead,
  sheet,
  children,
}: {
  id: string;
  name: string;
  lead: string;
  sheet: SheetState<Values>;
  children: (chosen: Values) => ReactNode;
}) {
  return (
    <section className="settings" aria-labelledby={id} aria-busy={sheet.read.status === "loading"}>
      <div className="settings-head">
        <h2 id={id}>{name}</h2>
        <p>{lead}</p>
      </div>
      {sheet.read.status === "failed" ? (
        <div className="notice notice-alert failed-listing" role="alert">
          <p>{sheet.read.message}</p>
          <button type="button" className="button button-small" onClick={() => void sheet.load()}>
            {strings.inbox.retry}
          </button>
        </div>
      ) : (
        sheet.read.status === "read" &&
        sheet.chosen !== undefined && (
          <form
            className="setting"
            onSubmit={(event) => {
              event.preventDefault();
              void sheet.save();
            }}
          >
            {children(sheet.chosen)}
            {sheet.saving.status === "failed" && (
              <p className="notice notice-alert" role="alert">
                {sheet.saving.message}
              </p>
            )}
          </form>
        )
      )}
    </section>
  );
}

/** Save, which waits until a choice differs from what is saved, and "Saved" beside it once it is. */
function SaveRow<Values extends object>({ sheet, saved, invalid = false }: { sheet: SheetState<Values>; saved: string; invalid?: boolean }) {
  return (
    <div className="setting-foot">
      <button type="submit" className="button button-primary" disabled={sheet.unchanged || invalid || sheet.saving.status === "saving"}>
        {sheet.saving.status === "saving" ? strings.settings.saving : strings.settings.save}
      </button>
      <p role="status" className="setting-saved">
        {sheet.saving.status === "saved" ? saved : ""}
      </p>
    </div>
  );
}
