// Suggestions (#156): the rest of the sentence, in Third Ink after the cursor, once the human pauses
// in a draft's text with the cursor at its end. A copy of the text lies over the field, clear but
// for the suggestion, so it follows the text's own lines. Tab takes it, typing on passes it by,
// and Escape hides it. A screen reader hears each one once, politely. Typing on aborts an ask on
// its way, and Duva's answer to one superseded is nothing anyway.
import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import type { DuvaClient } from "@duva/client";
import { strings } from "./strings.ts";

/** How long the human pauses before Duva suggests. */
const suggestionDelay = 400;

/** Whether the screen is touched, with no Tab to take a suggestion, so none is asked for. */
const touched = () => matchMedia("(hover: none) and (pointer: coarse)").matches;

/** What a suggestion is asked with besides the text: where the draft lives, and what it is. */
export interface DraftAbout {
  mailbox?: string;
  subject: string;
  to: string[];
  cc: string[];
  answers?: string;
  forwards?: string;
}

/** A suggestion shown: the text it follows, and the rest of the sentence. */
interface Shown {
  after: string;
  rest: string;
}

/**
 * Suggests in the text field as the human writes, while `enabled`. `about` gives what the ask
 * needs at the time, and `onTake` the text with the suggestion taken. A refusal, such as
 * suggestions switched off or the spend cap reached, stops the asks for this draft.
 */
export function useSuggestion({ client, enabled, about, onTake }: { client: DuvaClient; enabled: boolean; about: () => DraftAbout; onTake: (text: string) => void }) {
  const [shown, setShown] = useState<Shown>();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const asking = useRef<AbortController>(undefined);
  const refused = useRef(false);
  const aboutRef = useRef(about);
  aboutRef.current = about;

  const hide = useCallback(() => {
    clearTimeout(timer.current);
    asking.current?.abort();
    setShown(undefined);
  }, []);
  useEffect(() => hide, [hide]);

  /** After the human typed in the field: hides the suggestion, and asks for one once they pause with the cursor at the text's end. */
  const typed = (field: HTMLTextAreaElement) => {
    hide();
    if (!enabled || refused.current || touched()) return;
    timer.current = setTimeout(async () => {
      const text = field.value;
      if (document.activeElement !== field || field.selectionStart !== text.length || field.selectionEnd !== text.length || text.trim() === "") return;
      const { mailbox, ...rest } = aboutRef.current();
      if (mailbox === undefined) return;
      const controller = new AbortController();
      asking.current = controller;
      const { data, response } = await client
        .POST("/mailboxes/{mailbox}/suggestions", { params: { path: { mailbox } }, body: { text, ...rest }, signal: controller.signal })
        .catch(() => ({ data: undefined, response: undefined }));
      if (controller.signal.aborted) return;
      if (response?.status === 403 || response?.status === 409) refused.current = true;
      if (data?.suggestion !== undefined && field.value === text && document.activeElement === field) setShown({ after: text, rest: data.suggestion });
    }, suggestionDelay);
  };

  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (shown === undefined) return;
    if (event.key === "Tab" && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      const field = event.currentTarget;
      const taken = shown.after + shown.rest;
      hide();
      onTake(taken);
      requestAnimationFrame(() => field.setSelectionRange(taken.length, taken.length));
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      hide();
    }
  };

  return { shown, typed, keyDown, hide };
}

/**
 * The suggestion over the text field: the text as typed, clear, then the rest in Third Ink and its
 * key, which only the eye reads, and beside it what a screen reader hears, once.
 */
export function SuggestionShown({ shown }: { shown: Shown | undefined }) {
  return (
    <>
      {shown !== undefined && (
        <div className="compose-ghost" aria-hidden="true">
          <span className="compose-ghost-typed">{shown.after}</span>
          <span className="compose-suggestion">{shown.rest}</span>
          <kbd>{strings.compose.suggestionKey}</kbd>
        </div>
      )}
      <p className="visually-hidden" aria-live="polite">
        {shown === undefined ? "" : strings.compose.suggested(shown.rest.trim())}
      </p>
    </>
  );
}
