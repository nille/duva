// Send now: the sponsor sends one of their agent's drafts that waits for its send limits, past
// them. The limits stay as they are, and the send still counts toward them.
import { useId, useState } from "react";
import type { DuvaClient } from "@duva/client";
import type { components } from "@duva/openapi";
import { strings } from "./strings.ts";

type Draft = components["schemas"]["Draft"];

type Sending = { status: "idle" } | { status: "sending" } | { status: "sent" } | { status: "failed"; message: string };

/**
 * The button, and what came of it beside it. `onSent` hears of the draft as Duva answered, or of
 * nothing if it no longer waits. Where several wait side by side, `labelledBy` names the element
 * that says which send this is, so the button's name says it too. `done` says it was sent, as
 * from this page before, so it stays said where the button is laid out again.
 */
export function SendNow({
  client,
  mailbox,
  draft,
  labelledBy,
  done = false,
  onSent,
  onSignedOut,
}: {
  client: DuvaClient;
  mailbox: string;
  draft: string;
  labelledBy?: string;
  done?: boolean;
  onSent?: (draft?: Draft) => void;
  onSignedOut: () => void;
}) {
  const [sending, setSending] = useState<Sending>({ status: "idle" });
  const id = useId();
  const copy = strings.sendNow;

  const send = async () => {
    setSending({ status: "sending" });
    const { data, response } = await client
      .POST("/mailboxes/{mailbox}/drafts/{draft}/send-now", { params: { path: { mailbox, draft } } })
      .catch(() => ({ data: undefined, response: undefined }));
    if (response?.status === 401) return onSignedOut();
    if (data !== undefined) {
      setSending({ status: "sent" });
      return onSent?.(data);
    }
    setSending({ status: "failed", message: response === undefined ? copy.unreachable : response.status === 409 || response.status === 404 ? copy.gone : copy.failed(response.status) });
    if (response?.status === 409 || response?.status === 404) onSent?.();
  };

  if (done || sending.status === "sent") {
    return (
      <p className="send-now-done" role="status">
        {copy.sent}
      </p>
    );
  }
  return (
    <div className="send-now">
      <button
        type="button"
        id={id}
        className="button button-small"
        aria-labelledby={labelledBy === undefined ? undefined : `${id} ${labelledBy}`}
        disabled={sending.status === "sending"}
        onClick={() => void send()}>
        {sending.status === "sending" ? copy.sending : copy.send}
      </button>
      {sending.status === "failed" && (
        <p className="send-now-failed" role="alert">
          {sending.message}
        </p>
      )}
    </div>
  );
}
