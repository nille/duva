// The drafts a mailbox's owner hasn't sent, the most recently written first, on one sheet like the
// Inbox's index, each naming the agent that saved it last, if one did. Each opens in the composer.
import { useCallback, useEffect, useState } from "react";
import type { DuvaClient } from "@duva/client";
import type { components } from "@duva/openapi";
import { Time } from "./mail-parts.tsx";
import { strings } from "./strings.ts";

type Draft = components["schemas"]["Draft"];
type Mailbox = components["schemas"]["Mailbox"];

type Listing = { status: "loading" } | { status: "failed"; message: string } | { status: "listed"; drafts: Draft[] };

/**
 * The mailbox's drafts. `agentNames` names the agents the human sponsors by ID. `version` counts the
 * changes to the mailbox the app has seen, so the list reads them again when they change.
 */
export function Drafts({
  client,
  mailbox,
  agentNames,
  version,
  onSignedOut,
}: {
  client: DuvaClient;
  mailbox: Mailbox;
  agentNames: ReadonlyMap<string, string>;
  version: number;
  onSignedOut: () => void;
}) {
  const [listing, setListing] = useState<Listing>({ status: "loading" });

  const load = useCallback(async () => {
    const { data, response } = await client.GET("/mailboxes/{mailbox}/drafts", { params: { path: { mailbox: mailbox.id } } }).catch(() => ({ data: undefined, response: undefined }));
    if (response?.status === 401) return onSignedOut();
    if (data === undefined) {
      // A list on screen stays there when a later read fails.
      setListing((current) =>
        current.status === "listed" ? current : { status: "failed", message: response === undefined ? strings.drafts.unreachable : strings.drafts.failed(response.status) },
      );
      return;
    }
    // A sent draft lives on as the message in its thread.
    setListing({ status: "listed", drafts: data.drafts.filter((draft) => draft.send?.state !== "sent") });
  }, [client, mailbox.id, onSignedOut]);

  useEffect(() => {
    void load();
  }, [load, version]);

  useEffect(() => {
    document.title = strings.title(strings.drafts.title);
  }, []);

  return (
    <main className="desk" aria-busy={listing.status === "loading"}>
      <div className="desk-head">
        <h1 tabIndex={-1} className="view-title">
          {strings.drafts.title}
        </h1>
        <p className="mailbox-address">{mailbox.defaultAddress}</p>
      </div>
      {listing.status === "loading" ? (
        <div className="index index-skeleton" aria-hidden="true">
          {[0, 1].map((row) => (
            <div className="thread" key={row}>
              <span className="line" style={{ width: "60%" }} />
              <span className="line" style={{ width: `${70 - row * 9}%` }} />
              <span className="line" style={{ width: "3rem" }} />
            </div>
          ))}
        </div>
      ) : listing.status === "failed" ? (
        <div className="notice notice-alert failed-listing" role="alert">
          <p>{listing.message}</p>
          <button type="button" className="button button-small" onClick={() => void load()}>
            {strings.inbox.retry}
          </button>
        </div>
      ) : listing.drafts.length === 0 ? (
        <section className="empty" aria-labelledby="empty-title">
          <h2 id="empty-title">{strings.drafts.emptyTitle}</h2>
          <p>{strings.drafts.emptyLead}</p>
        </section>
      ) : (
        <div className="index">
          <ol className="threads" aria-label={strings.drafts.list}>
            {listing.drafts.map((draft) => (
              <DraftRow key={draft.id} draft={draft} agent={draft.updatedBy === undefined ? undefined : agentNames.get(draft.updatedBy)} />
            ))}
          </ol>
        </div>
      )}
    </main>
  );
}

/** A draft in the list, with the name of the agent that saved it last, if one did. */
function DraftRow({ draft, agent }: { draft: Draft; agent?: string }) {
  const recipients = [...draft.to, ...draft.cc, ...draft.bcc].map(({ name, address }) => name || address).join(", ");
  const to = recipients === "" ? strings.drafts.noRecipients : strings.drafts.to(recipients);
  const subject = draft.subject || strings.thread.noSubject;
  const state = draft.send === undefined ? undefined : strings.drafts.states[draft.send.state];
  const snippet = draft.text.replace(/\s+/g, " ").trim();
  const by = agent === undefined ? undefined : strings.drafts.by(agent);
  return (
    <li className="thread-row">
      <a className="thread" href={`#/drafts/${encodeURIComponent(draft.id)}`} aria-label={[by, state, to, subject].filter(Boolean).join(", ")}>
        <span className="thread-mark" aria-hidden="true" />
        <span className="thread-sender">
          <span className="thread-sender-name">{to}</span>
        </span>
        <span className="thread-text">
          <span className="thread-subject">
            {by !== undefined && <span className="draft-state">{by}</span>}
            {state !== undefined && <span className={`draft-state draft-state-${draft.send!.state}`}>{state}</span>}
            {subject}
          </span>
          {snippet !== "" && (
            <span className="thread-snippet" lang="">
              {snippet}
            </span>
          )}
        </span>
        <span className="thread-date">
          <Time at={draft.updatedAt} short />
        </span>
      </a>
    </li>
  );
}
