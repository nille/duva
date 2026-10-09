// A message's full headers, as Show headers in its menu opens them (#145): a sheet over the page
// listing every field as it came, from the top, each name beside its value, and a value with
// encoded words also decoded. Copy puts the header block on the clipboard as it reads, one field
// to a line, and Escape or Done puts the sheet away. On a phone it takes the whole screen.
import { useEffect, useId, useRef, useState } from "react";
import type { DuvaClient } from "@duva/client";
import type { components } from "@duva/openapi";
import { strings } from "./strings.ts";

type HeaderField = components["schemas"]["HeaderField"];

type Reading = { status: "loading" } | { status: "failed"; message: string } | { status: "read"; headers: HeaderField[] };

/** The sheet with the headers of the message in the mailbox, closed by `onClose`, which gives the focus back where it was. */
export function HeadersSheet({
  client,
  mailbox,
  message,
  onClose,
  onSignedOut,
}: {
  client: DuvaClient;
  mailbox: string;
  message: string;
  onClose: () => void;
  onSignedOut: () => void;
}) {
  const words = strings.headers;
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [reading, setReading] = useState<Reading>({ status: "loading" });
  const [copying, setCopying] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    const sheet = dialog.current;
    sheet?.showModal();
    return () => sheet?.close();
  }, []);

  useEffect(() => {
    let current = true;
    void client
      .GET("/mailboxes/{mailbox}/messages/{message}/headers", { params: { path: { mailbox, message } } })
      .catch(() => ({ data: undefined, response: undefined }))
      .then(({ data, response }) => {
        if (!current) return;
        if (response?.status === 401) return onSignedOut();
        setReading(data === undefined ? { status: "failed", message: response === undefined ? words.unreachable : words.failed } : { status: "read", headers: data.headers });
      });
    return () => {
      current = false;
    };
  }, [client, mailbox, message, onSignedOut, words]);

  useEffect(() => {
    if (copying !== "copied") return;
    const shown = setTimeout(() => setCopying("idle"), 2000);
    return () => clearTimeout(shown);
  }, [copying]);

  const block = reading.status === "read" ? reading.headers.map(({ name, value }) => `${name}: ${value}\n`).join("") : undefined;
  return (
    <dialog ref={dialog} className="headers-sheet" aria-labelledby={titleId} aria-busy={reading.status === "loading"} onClose={onClose}>
      <div className="headers-head">
        <h2 id={titleId}>{words.title}</h2>
        <div className="headers-tools">
          {block !== undefined && (
            <button
              type="button"
              className="button button-small"
              onClick={() =>
                void navigator.clipboard.writeText(block).then(
                  () => setCopying("copied"),
                  () => setCopying("failed"),
                )
              }
            >
              {copying === "copied" ? words.copied : words.copy}
            </button>
          )}
          <button type="button" className="button button-small button-quiet" onClick={() => dialog.current?.close()}>
            {words.done}
            <kbd aria-hidden="true">Esc</kbd>
          </button>
        </div>
      </div>
      <p className="headers-lead">{words.lead}</p>
      {copying === "failed" && (
        <p className="field-error" role="alert">
          {words.copyFailed}
        </p>
      )}
      {reading.status === "loading" ? (
        <div className="letter-skeleton headers-skeleton" aria-hidden="true">
          <span className="line" style={{ width: "70%" }} />
          <span className="line" style={{ width: "85%" }} />
          <span className="line" style={{ width: "55%" }} />
        </div>
      ) : reading.status === "failed" ? (
        <p className="notice notice-alert" role="alert">
          {reading.message}
        </p>
      ) : (
        <dl className="headers-list" lang="">
          {reading.headers.map(({ name, value, decoded }, index) => (
            <div key={index} className="header-field">
              <dt>{name}</dt>
              <dd>
                <span className="header-value">{value}</span>
                {decoded !== undefined && (
                  <span className="header-decoded">
                    <span className="header-decoded-name">{words.decoded}</span> {decoded}
                  </span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </dialog>
  );
}
