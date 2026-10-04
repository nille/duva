// The parts every view shows mail with: header fields, addresses, times, and whether Duva can be reached.
import type { ReactNode } from "react";
import type { components } from "@duva/openapi";
import type { Connection as ConnectionState } from "./feed.ts";
import { strings } from "./strings.ts";

type EmailAddress = components["schemas"]["EmailAddress"];

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
  const date = new Date(at);
  return (
    <time dateTime={at} title={short ? date.toLocaleString() : undefined}>
      {format(short ? day(date) : when(date))}
    </time>
  );
}

export const clock = (date: Date) => date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

/** The time alone for today, or the day and time otherwise. */
export function when(date: Date): string {
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return clock(date);
  return date.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    ...(date.getFullYear() !== today.getFullYear() && { year: "numeric" }),
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** The time alone for today, or else the day alone, as a listing shows it. */
export function day(date: Date): string {
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return clock(date);
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", ...(date.getFullYear() !== today.getFullYear() && { year: "numeric" }) });
}

/** The display name of an address, or the address itself. */
export const nameOf = (address: EmailAddress) => address.name || address.address;

export function Connection({ state, unreachable = strings.connection.unreachable }: { state: ConnectionState; unreachable?: string }) {
  if (state === undefined) return null;
  return (
    <p className={state.ok ? "connection" : "connection connection-down"}>
      {state.ok ? strings.connection.upToDate(clock(state.at)) : <span role="alert">{unreachable}</span>}
    </p>
  );
}
