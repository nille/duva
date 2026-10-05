// The parts every view shows mail with: header fields, addresses, times, and whether Duva can be reached.
import type { ReactNode } from "react";
import type { components } from "@duva/openapi";
import { useDates } from "./dates.ts";
import type { Connection as ConnectionState } from "./feed.ts";
import { size, strings } from "./strings.ts";

type EmailAddress = components["schemas"]["EmailAddress"];
type Attachment = components["schemas"]["Attachment"];

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

const ClipIcon = () => (
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

/** The display name of an address, or the address itself. */
export const nameOf = (address: EmailAddress) => address.name || address.address;

export function Connection({ state, unreachable = strings.connection.unreachable }: { state: ConnectionState; unreachable?: string }) {
  const { clock } = useDates();
  if (state === undefined) return null;
  return (
    <p className={state.ok ? "connection" : "connection connection-down"}>
      {state.ok ? strings.connection.upToDate(clock(state.at)) : <span role="alert">{unreachable}</span>}
    </p>
  );
}
