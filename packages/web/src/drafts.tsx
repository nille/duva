// The drafts a mailbox's owner hasn't sent, the most recently written first, on one sheet like the
// Inbox's index, each naming the agent that saved it last, if one did. Each opens in the composer.
// In All mailboxes they are every mailbox's, each saying which address it goes from.
import { useCallback, useEffect, useState } from "react";
import type { DuvaClient } from "@duva/client";
import type { components } from "@duva/openapi";
import { Time } from "./mail-parts.tsx";
import { type AllMailboxes, isAll, shortAddress } from "./mailboxes.tsx";
import { useBeside, useViewTitle, ViewMain, ViewTitle } from "./panes.tsx";
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
  base = "#/",
  agentNames,
  version,
  onSignedOut,
}: {
  client: DuvaClient;
  mailbox: Mailbox | AllMailboxes;
  /** Where the mailbox's views are, so each draft's link names it. */
  base?: string;
  agentNames: ReadonlyMap<string, string>;
  version: number;
  onSignedOut: () => void;
}) {
  const [listing, setListing] = useState<Listing>({ status: "loading" });
  // The mailbox's ID, or none for All mailboxes.
  const id = isAll(mailbox) ? undefined : mailbox.id;

  const load = useCallback(async () => {
    const { data, response } = await (id === undefined ? client.GET("/all-mailboxes/drafts") : client.GET("/mailboxes/{mailbox}/drafts", { params: { path: { mailbox: id } } })).catch(() => ({
      data: undefined,
      response: undefined,
    }));
    if (response?.status === 401) return onSignedOut();
    if (data === undefined) {
      // A list on screen stays there when a later read fails.
      setListing((current) =>
        current.status === "listed" ? current : { status: "failed", message: response === undefined ? strings.drafts.unreachable : strings.drafts.failed },
      );
      return;
    }
    // A sent draft lives on as the message in its thread.
    setListing({ status: "listed", drafts: data.drafts.filter((draft) => draft.send?.state !== "sent") });
  }, [client, id, onSignedOut]);

  useEffect(() => {
    void load();
  }, [load, version]);

  useViewTitle(strings.title(strings.drafts.title));
  const { open } = useBeside();

  return (
    <ViewMain className="desk" aria-busy={listing.status === "loading"}>
      <div className="desk-head">
        <ViewTitle tabIndex={-1} className="view-title">
          {strings.drafts.title}
        </ViewTitle>
        <p className="mailbox-address">{isAll(mailbox) ? strings.mailboxes.all : strings.mailboxes.address(mailbox)}</p>
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
              <DraftRow
                key={draft.id}
                draft={draft}
                base={base}
                open={draft.id === open}
                agent={draft.updatedBy === undefined ? undefined : agentNames.get(draft.updatedBy)}
                from={isAll(mailbox) ? shortAddress(draft.from, mailbox.own) : undefined}
              />
            ))}
          </ol>
        </div>
      )}
    </ViewMain>
  );
}

/** A draft in the list, with the name of the agent that saved it last, if one did, and in All mailboxes the address it goes `from`. */
function DraftRow({ draft, base, open, agent, from }: { draft: Draft; base: string; open: boolean; agent?: string; from?: string }) {
  const recipients = [...draft.to, ...draft.cc, ...draft.bcc].map(({ name, address }) => name || address).join(", ");
  const to = recipients === "" ? strings.drafts.noRecipients : strings.drafts.to(recipients);
  const subject = draft.subject || strings.thread.noSubject;
  const state = draft.send === undefined ? undefined : strings.drafts.states[draft.send.state];
  const snippet = draft.text.replace(/\s+/g, " ").trim();
  const by = agent === undefined ? undefined : strings.drafts.by(agent);
  return (
    <li className="thread-row">
      <a className="thread" href={`${base}drafts/${encodeURIComponent(draft.id)}`} aria-label={[by, state, to, subject, from !== undefined && strings.drafts.from(draft.from)].filter(Boolean).join(", ")} aria-current={open ? "true" : undefined}>
        <span className="thread-mark" aria-hidden="true" />
        <span className="thread-sender">
          <span className="thread-sender-name">{to}</span>
        </span>
        {from !== undefined && (
          <span className="thread-labels" aria-hidden="true">
            <span className="thread-to" title={draft.from}>
              {strings.drafts.from(from)}
            </span>
          </span>
        )}
        <span className="thread-text">
          <span className="thread-subject">
            {by !== undefined && <span className="draft-state draft-by">{by}</span>}
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
