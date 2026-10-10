// What Coo remembers (ADR-0036, #151), a page of Settings: whether Coo learns from mail, and each
// memory it keeps, with when and where it came from, a link to the thread it was learned from or
// "You told me", which the human corrects or forgets one at a time, or forgets all at once.
import { type FormEvent, useCallback, useEffect, useState } from "react";
import type { DuvaClient } from "@duva/client";
import type { components } from "@duva/openapi";
import { type Preferences, useDates } from "./dates.ts";
import { mailboxHref } from "./mailboxes.tsx";
import { SaveRow, Sheet, useSheet } from "./settings.tsx";
import { strings } from "./strings.ts";
import { threadHref } from "./views.tsx";

type Memory = components["schemas"]["Memory"];
type Mailbox = components["schemas"]["Mailbox"];

const copy = strings.settings.memory;

/** The page: the switch for learning from mail, then the memories. */
export function MemoryPage({
  client,
  mailboxes,
  onPreferences,
  onSignedOut,
}: {
  client: DuvaClient;
  /** The human's own mailboxes, in which the threads memories were learned from open. */
  mailboxes: Mailbox[];
  onPreferences: (preferences: Preferences) => void;
  onSignedOut: () => void;
}) {
  return (
    <>
      <LearningSheet client={client} onPreferences={onPreferences} onSignedOut={onSignedOut} />
      <MemoriesSheet client={client} mailboxes={mailboxes} onSignedOut={onSignedOut} />
    </>
  );
}

type Learning = Pick<Preferences, "cooLearnsFromMail">;

function LearningSheet({ client, onPreferences, onSignedOut }: { client: DuvaClient; onPreferences: (preferences: Preferences) => void; onSignedOut: () => void }) {
  const picked = async (answer: Promise<{ data?: Preferences; response: Response }>) => {
    const { data, response } = await answer;
    if (data !== undefined) onPreferences(data);
    return { data: data === undefined ? undefined : { cooLearnsFromMail: data.cooLearnsFromMail }, response };
  };
  const sheet = useSheet<Learning>({
    read: () => picked(client.GET("/preferences")),
    write: ({ cooLearnsFromMail }) => picked(client.PATCH("/preferences", { body: { cooLearnsFromMail } })),
    copy: copy.learning,
    onSignedOut,
  });
  return (
    <Sheet id="memory-sheet" name={copy.title} lead={copy.lead} sheet={sheet}>
      {(chosen) => (
        <>
          <fieldset className="memory-learning">
            <legend>{copy.learning.title}</legend>
            <p className="setting-lead">{copy.learning.lead}</p>
            <div className="switch">
              {(["on", "off"] as const).map((value) => (
                <label key={value}>
                  <input type="radio" name="coo-learns-from-mail" checked={chosen.cooLearnsFromMail === value} onChange={() => sheet.choose({ cooLearnsFromMail: value })} />
                  <span>{copy.learning[value]}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <SaveRow sheet={sheet} saved={copy.learning.saved} />
        </>
      )}
    </Sheet>
  );
}

type Listed = { status: "loading" } | { status: "failed"; message: string } | { status: "read"; memories: Memory[] };

/** Each memory as a line, newest first, and Forget everything at the foot. */
function MemoriesSheet({ client, mailboxes, onSignedOut }: { client: DuvaClient; mailboxes: Mailbox[]; onSignedOut: () => void }) {
  const [listed, setListed] = useState<Listed>({ status: "loading" });
  const [said, setSaid] = useState("");
  const [failure, setFailure] = useState<string>();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, response } = await client.GET("/memories").catch(() => ({ data: undefined, response: undefined }));
    if (response?.status === 401) return onSignedOut();
    setListed(data === undefined ? { status: "failed", message: response === undefined ? copy.unreachable : copy.failed(response.status) } : { status: "read", memories: data.memories });
  }, [client, onSignedOut]);
  useEffect(() => {
    void load();
  }, [load]);

  /** Runs a change, and says what it did or why it failed. */
  const change = async (call: () => Promise<{ data?: unknown; response: Response }>, done: (data: never) => string): Promise<boolean> => {
    setBusy(true);
    setFailure(undefined);
    const { data, response } = await call().catch(() => ({ data: undefined, response: undefined }));
    setBusy(false);
    if (response?.status === 401) return onSignedOut(), false;
    if (data === undefined) return setFailure(response === undefined ? copy.changeUnreachable : copy.changeFailed(response.status)), false;
    setSaid(done(data as never));
    await load();
    return true;
  };
  const correct = (memory: Memory, text: string) =>
    change(() => client.PATCH("/memories/{memory}", { params: { path: { memory: memory.id } }, body: { text } }), () => copy.corrected);
  const forget = (memory: Memory) => change(() => client.DELETE("/memories/{memory}", { params: { path: { memory: memory.id } } }), () => copy.forgot(memory.text));
  const forgetAll = async () => {
    if (await change(() => client.DELETE("/memories"), () => copy.forgotAll)) setAsking(false);
  };

  return (
    <section className="settings memories" aria-labelledby="memories-title" aria-busy={listed.status === "loading"}>
      <h3 id="memories-title" className="memories-title">
        {copy.memories}
      </h3>
      <p role="status" className="memories-said">
        {said}
      </p>
      {failure !== undefined && (
        <p className="notice notice-alert" role="alert">
          {failure}
        </p>
      )}
      {listed.status === "failed" && (
        <div className="notice notice-alert failed-listing" role="alert">
          <p>{listed.message}</p>
          <button type="button" className="button button-small" onClick={() => void load()}>
            {strings.inbox.retry}
          </button>
        </div>
      )}
      {listed.status === "read" && listed.memories.length === 0 && <p className="memories-none">{copy.none}</p>}
      {listed.status === "read" && listed.memories.length > 0 && (
        <>
          <ul className="memory-lines">
            {listed.memories.map((memory) => (
              <MemoryLine key={memory.id} memory={memory} mailboxes={mailboxes} busy={busy} onCorrect={(text) => correct(memory, text)} onForget={() => void forget(memory)} />
            ))}
          </ul>
          <div className="memories-foot">
            {asking ? (
              <div className="confirm sender-confirm" role="group" aria-label={copy.forgetAll}>
                <p>{copy.forgetAllAsk(listed.memories.length)}</p>
                <div className="confirm-choices">
                  <button type="button" className="button button-call" disabled={busy} onClick={() => void forgetAll()}>
                    {copy.forgetAll}
                  </button>
                  <button type="button" className="button button-quiet" onClick={() => setAsking(false)}>
                    {copy.cancel}
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" className="button" onClick={() => setAsking(true)}>
                {copy.forgetAll}
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}

/** A memory: what Coo remembers, then where it came from and when, with Correct and Forget. */
function MemoryLine({
  memory,
  mailboxes,
  busy,
  onCorrect,
  onForget,
}: {
  memory: Memory;
  mailboxes: Mailbox[];
  busy: boolean;
  onCorrect: (text: string) => Promise<boolean>;
  onForget: () => void;
}) {
  const dates = useDates();
  const [editing, setEditing] = useState<string>();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (editing !== undefined && editing.trim() !== "" && (await onCorrect(editing.trim()))) setEditing(undefined);
  };
  const id = `memory-${memory.id}`;
  return (
    <li className="memory-line" aria-labelledby={`${id}-text`}>
      {editing === undefined ? (
        <p id={`${id}-text`} className="memory-text">
          {memory.text}
        </p>
      ) : (
        <form className="memory-correct" onSubmit={(event) => void submit(event)}>
          <label className="visually-hidden" htmlFor={`${id}-field`}>
            {copy.correcting(memory.text)}
          </label>
          <textarea id={`${id}-field`} value={editing} maxLength={500} rows={2} autoFocus onChange={(event) => setEditing(event.target.value)} />
          <div className="confirm-choices">
            <button type="submit" className="button button-primary button-small" disabled={busy || editing.trim() === "" || editing.trim() === memory.text}>
              {copy.save}
            </button>
            <button type="button" className="button button-quiet button-small" onClick={() => setEditing(undefined)}>
              {copy.cancel}
            </button>
          </div>
        </form>
      )}
      <p className="memory-source">
        <Source memory={memory} mailboxes={mailboxes} />
        {", "}
        <time dateTime={memory.kept} title={dates.full(new Date(memory.kept))}>
          {copy.kept(dates.date(new Date(memory.kept), true))}
        </time>
      </p>
      {editing === undefined && (
        <div className="memory-actions">
          <button type="button" className="button button-quiet button-small" aria-describedby={`${id}-text`} disabled={busy} onClick={() => setEditing(memory.text)}>
            {copy.correct}
          </button>
          <button type="button" className="button button-quiet button-small" aria-describedby={`${id}-text`} disabled={busy} onClick={onForget}>
            {copy.forget}
          </button>
        </div>
      )}
    </li>
  );
}

/** Where the memory came from: the human's own words, or each thread it was learned from, a link to it. */
function Source({ memory, mailboxes }: { memory: Memory; mailboxes: Mailbox[] }) {
  if (memory.source === "told") return <>{copy.told}</>;
  return (
    <>
      {copy.from}{" "}
      {(memory.threads ?? []).map(({ mailbox, thread, subject }, index) => {
        const found = mailboxes.find(({ id }) => id === mailbox);
        return (
          <span key={thread}>
            {index > 0 && ", "}
            {found === undefined ? subject : <a href={threadHref(thread, { label: "inbox" }, mailboxHref(found, mailboxes.length === 1))}>{subject}</a>}
          </span>
        );
      })}
    </>
  );
}
