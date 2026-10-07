// What the DNS records Duva lists share, on the Domains sheet and for logos: buttons that copy a
// record's name or value, moving between them by the keys, and the tick of a verified one.
import { type KeyboardEvent, useEffect, useState } from "react";
import { strings } from "./strings.ts";

const copy = strings.domains;

/** What of a record a copy button copies. */
export type Field = "name" | "value";

/** Moves the focus between a list's copy buttons, by the arrow keys, Home and End. */
export function moveCopyFocus(event: KeyboardEvent<HTMLUListElement>) {
  const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>(".copy-button")];
  const at = buttons.indexOf(event.target as HTMLButtonElement);
  const to = { ArrowDown: at + 1, ArrowRight: at + 1, ArrowUp: at - 1, ArrowLeft: at - 1, Home: 0, End: buttons.length - 1 }[event.key];
  if (at < 0 || to === undefined) return;
  event.preventDefault();
  buttons[Math.min(Math.max(to, 0), buttons.length - 1)]?.focus();
}

/** A button that copies the text, and says so for two seconds. Only the records' stop is in the Tab order. */
export function CopyButton({ text, tabStop, keysHint, onFocus }: { text: string; tabStop: boolean; keysHint: string; onFocus: () => void }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (state !== "copied") return;
    const shown = setTimeout(() => setState("idle"), 2000);
    return () => clearTimeout(shown);
  }, [state]);
  return (
    <>
      <button
        type="button"
        className="button button-small copy-button"
        tabIndex={tabStop ? 0 : -1}
        aria-describedby={keysHint}
        onFocus={onFocus}
        aria-label={state === "copied" ? copy.copiedWhat(text) : copy.copyWhat(text)}
        onClick={() =>
          void navigator.clipboard.writeText(text).then(
            () => setState("copied"),
            () => setState("failed"),
          )
        }
      >
        {state === "copied" ? copy.copied : copy.copy}
      </button>
      {state === "failed" && (
        <span className="field-error" role="alert">
          {copy.copyFailed}
        </span>
      )}
    </>
  );
}

export const CheckIcon = () => (
  <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
    <path d="m3.5 8.5 3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
