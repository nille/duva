// The linked files of a message sent from the mailbox, in its letter under the text (ADR-0034):
// each with its size, until when its link works, and how often its page's Download button was
// pressed, and Stop sharing, which ends its link at once and deletes the file.
import { useState } from "react";
import type { components } from "@duva/openapi";
import { useDates } from "./dates.ts";
import { size, strings } from "./strings.ts";

type LinkedFile = components["schemas"]["LinkedFile"];

const copy = strings.linkedFiles;

/** A chain's two links, the linked file's mark beside its name, as the clip is an attachment's. */
const LinkIcon = () => (
  <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2.4-2.4a2.6 2.6 0 0 0-3.7-3.7l-.9.9M9.2 6.8a2.6 2.6 0 0 0-3.7 0L3.1 9.2a2.6 2.6 0 0 0 3.7 3.7l.9-.9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * The message's linked files under a hairline. With `onStop`, each still shared offers Stop
 * sharing, which answers the file as it is then, or why it couldn't.
 */
export function LinkedFiles({ files, onStop }: { files: LinkedFile[]; onStop?: (file: string) => Promise<LinkedFile | string> }) {
  const [changed, setChanged] = useState<ReadonlyMap<string, LinkedFile>>(new Map());
  const [busy, setBusy] = useState<string>();
  const [problem, setProblem] = useState<string>();
  const { date } = useDates();
  const stop = async (id: string) => {
    setBusy(id);
    setProblem(undefined);
    const answer = await onStop!(id);
    setBusy(undefined);
    if (typeof answer === "string") return setProblem(answer);
    setChanged((current) => new Map([...current, [id, answer]]));
  };
  return (
    <section className="letter-attachments linked-files" aria-label={copy.title}>
      <ul>
        {files.map((given) => {
          const file = changed.get(given.id) ?? given;
          const until = date(new Date(file.until));
          return (
            <li key={file.id} className={file.state === "sharing" ? undefined : "linked-file-ended"}>
              <LinkIcon />
              <span>
                <span className="attachment-name">{file.name}</span> <span className="attachment-meta">{copy.meta(size(file.size), file.state, until, file.downloads)}</span>
              </span>
              {file.state === "sharing" && onStop !== undefined && (
                <button type="button" className="link draft-file-remove" aria-label={copy.stopFile(file.name)} disabled={busy !== undefined} onClick={() => void stop(file.id)}>
                  {busy === file.id ? copy.stopping : copy.stop}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {problem !== undefined && (
        <p className="draft-file-problem" role="alert">
          {problem}
        </p>
      )}
    </section>
  );
}
