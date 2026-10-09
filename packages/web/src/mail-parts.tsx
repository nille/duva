// The parts every view shows mail with: header fields, addresses, times, who an actor is, and whether Duva can be reached.
import { type ReactNode, useState, useSyncExternalStore } from "react";
import type { components } from "@duva/openapi";
import { CooMark, useIsCoo } from "./coo.tsx";
import { useDates } from "./dates.ts";
import type { Connection as ConnectionState } from "./feed.ts";
import { size, strings } from "./strings.ts";

type EmailAddress = components["schemas"]["EmailAddress"];
type Attachment = components["schemas"]["Attachment"];
type SenderLogo = components["schemas"]["SenderLogo"];

/**
 * A message's or a forward's attachments under a hairline, each with the clip icon, its name and
 * its type and size. With `onDownload`, each name is a button that downloads it, and `downloading`
 * says which one is on its way.
 */
export function Attachments({ list, onDownload, downloading }: { list: Attachment[]; onDownload?: (index: number) => void; downloading?: number }) {
  return (
    <section className="letter-attachments" aria-label={strings.thread.attachments}>
      <ul>
        {list.map((attachment, index) => {
          const name = attachment.name ?? strings.thread.unnamed;
          return (
            <li key={index}>
              <ClipIcon />
              <span>
                {onDownload === undefined ? (
                  <span className="attachment-name">{name}</span>
                ) : (
                  <button type="button" className="link attachment-name" aria-label={strings.thread.download(name)} disabled={downloading !== undefined} onClick={() => onDownload(index)}>
                    {name}
                  </button>
                )}{" "}
                <span className="attachment-meta">{downloading === index ? strings.thread.downloading : strings.thread.attachment(attachment.type, size(attachment.size))}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export const ClipIcon = () => (
  <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
    <path
      d="M10.5 5.5 6.2 9.8a1.2 1.2 0 0 0 1.7 1.7l4.6-4.6a2.6 2.6 0 0 0-3.7-3.7L4.2 7.8a4 4 0 0 0 5.7 5.7l3.6-3.6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function Addresses({ list }: { list: EmailAddress[] }) {
  return (
    <ul className="addresses">
      {list.map((address) => (
        <li key={address.address}>
          {address.name ? (
            <>
              {address.name} <span className="address">{address.address}</span>
            </>
          ) : (
            address.address
          )}
        </li>
      ))}
    </ul>
  );
}

export function Time({ at, format = (time) => time, short = false }: { at: string; format?: (time: string) => string; short?: boolean }) {
  const { day, when, full } = useDates();
  const date = new Date(at);
  return (
    <time dateTime={at} title={short ? full(date) : undefined}>
      {format(short ? day(date) : when(date))}
    </time>
  );
}

/**
 * Who an actor is, by shape, so it reads without color: a human a filled dot, an agent a blue
 * diamond, Duva itself a ring, and Coo, the mailbox agent, its own silhouette in the agent's blue,
 * as `coo` or as an `agent` whose ID is one of the human's mailbox agents. The name beside it says who.
 */
export function ActorMark({ kind, agent }: { kind: "human" | "agent" | "duva" | "coo"; agent?: string }) {
  const coo = useIsCoo(agent);
  if (kind === "coo" || (kind === "agent" && coo)) {
    return (
      <span className="actor-mark actor-mark-coo" aria-hidden="true">
        <CooMark />
      </span>
    );
  }
  return <span className={`actor-mark actor-mark-${kind}`} aria-hidden="true" />;
}

/**
 * Who sent mail, in a round avatar at the start of a row or a letter's head, so names line up: their
 * logo, when their domain publishes one Duva shows (ADR-0023), with the check at the avatar's corner
 * when a mark certificate verifies it, or else their actor mark in it. An agent keeps its diamond,
 * and a logo that won't load gives way to the mark. Duva serves the logo, so showing it never
 * reaches the sender.
 */
export function SenderMark({ kind, agent, logo, name }: { kind: "human" | "agent" | "duva"; agent?: string; logo?: SenderLogo; name: string }) {
  const [failed, setFailed] = useState<string>();
  if (logo === undefined || kind === "agent" || failed === logo.url) {
    return (
      <span className="avatar">
        <ActorMark kind={kind} agent={agent} />
      </span>
    );
  }
  return (
    <span className="avatar sender-logo">
      <img src={logo.url} alt={logo.verified ? strings.logo.verified(name) : strings.logo.of(name)} onError={() => setFailed(logo.url)} />
      {logo.verified && (
        <svg className="sender-logo-check" viewBox="0 0 10 10" aria-hidden="true">
          <circle cx="5" cy="5" r="4.5" />
          <path d="M2.9 5.1 4.4 6.6 7.2 3.6" />
        </svg>
      )}
    </span>
  );
}

/** The display name of an address, or the address itself. */
export const nameOf = (address: EmailAddress) => address.name || address.address;

/**
 * Whether Duva is up to date, or couldn't be reached. On a desk the status strip says when it is up
 * to date, so a view says only when it couldn't be.
 */
export function Connection({ state, unreachable = strings.connection.unreachable }: { state: ConnectionState; unreachable?: string }) {
  const { clock } = useDates();
  const desk = useSyncExternalStore(watchDesk, () => deskQuery.matches);
  if (state === undefined || (state.ok && desk)) return null;
  return (
    <p className={state.ok ? "connection" : "connection connection-down"}>
      {state.ok ? strings.connection.upToDate(clock(state.at)) : <span role="alert">{unreachable}</span>}
    </p>
  );
}

/** Whether the window is a desk's, wide enough for the status strip. */
const deskQuery = matchMedia("(min-width: 48.0625rem)");
const watchDesk = (changed: () => void) => {
  deskQuery.addEventListener("change", changed);
  return () => deskQuery.removeEventListener("change", changed);
};
