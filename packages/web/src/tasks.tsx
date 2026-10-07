// Label prompts and the tasks they give the mailbox agent (ADR-0029): a label's prompt, which its
// owner writes in the label's head, and the tasks a thread's messages got, which the thread shows.
import { useId, useState } from "react";
import type { DuvaClient } from "@duva/client";
import type { components } from "@duva/openapi";
import { ActorMark, Time } from "./mail-parts.tsx";
import type { Done, Label } from "./organize.tsx";
import { strings } from "./strings.ts";

type Task = components["schemas"]["Task"];

/** The labels whose head offers a prompt, besides the mailbox's own. */
export const promptedBuiltIns = ["feed", "paperTrail"];

/** A label's prompt in its head: what the mailbox agent is to do with each message there, and writing it. */
export function LabelPrompt({ client, mailbox, label, onDone, onSignedOut }: { client: DuvaClient; mailbox: string; label: Label; onDone: (done: Done) => void; onSignedOut: () => void }) {
  const [editing, setEditing] = useState(false);
  const [prompt, setPrompt] = useState(label.prompt ?? "");
  const [state, setState] = useState<{ status: "idle" | "busy" } | { status: "failed"; message: string }>({ status: "idle" });
  const fieldId = useId();
  const hintId = useId();
  const errorId = useId();
  const path = { mailbox, label: label.id };

  const refusal = (status: number | undefined) =>
    status === undefined ? strings.labelPrompt.unreachable : status === 409 ? strings.labelPrompt.noAgent : strings.labelPrompt.failed(status);

  const save = async () => {
    if (prompt.trim() === "") return setState({ status: "failed", message: strings.labelPrompt.missing });
    setState({ status: "busy" });
    const { data, response } = await client
      .PUT("/mailboxes/{mailbox}/labels/{label}/prompt", { params: { path }, body: { prompt: prompt.trim() } })
      .catch(() => ({ data: undefined, response: undefined }));
    if (response?.status === 401) return onSignedOut();
    if (data === undefined) return setState({ status: "failed", message: refusal(response?.status) });
    setState({ status: "idle" });
    setEditing(false);
    onDone({ message: strings.labelPrompt.saved(label.name) });
  };

  const remove = async () => {
    setState({ status: "busy" });
    const { data, response } = await client.DELETE("/mailboxes/{mailbox}/labels/{label}/prompt", { params: { path } }).catch(() => ({ data: undefined, response: undefined }));
    if (response?.status === 401) return onSignedOut();
    if (data === undefined) return setState({ status: "failed", message: refusal(response?.status) });
    setState({ status: "idle" });
    setEditing(false);
    setPrompt("");
    onDone({ message: strings.labelPrompt.removed(label.name) });
  };

  if (!editing) {
    return (
      <div className="label-prompt">
        {label.prompt !== undefined && (
          <p className="label-prompt-text">
            <ActorMark kind="coo" />
            <span>
              {strings.labelPrompt.lead} <q>{label.prompt}</q>
            </span>
          </p>
        )}
        <button
          type="button"
          className="button button-small button-quiet"
          onClick={() => {
            setPrompt(label.prompt ?? "");
            setState({ status: "idle" });
            setEditing(true);
          }}
        >
          {label.prompt === undefined ? strings.labelPrompt.add : strings.labelPrompt.edit}
        </button>
      </div>
    );
  }

  return (
    <form
      className="label-form label-prompt-form"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <label htmlFor={fieldId}>{strings.labelPrompt.field(label.name)}</label>
      <p className="label-prompt-hint" id={hintId}>
        {strings.labelPrompt.hint}
      </p>
      <textarea
        id={fieldId}
        value={prompt}
        rows={3}
        maxLength={4000}
        autoFocus
        placeholder={strings.labelPrompt.placeholder}
        aria-invalid={state.status === "failed"}
        aria-describedby={state.status === "failed" ? `${hintId} ${errorId}` : hintId}
        onChange={(event) => setPrompt(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setEditing(false);
        }}
      />
      <div className="label-form-row">
        <button type="submit" className="button button-small button-primary" disabled={state.status === "busy"}>
          {strings.labelPrompt.save}
        </button>
        {label.prompt !== undefined && (
          <button type="button" className="button button-small button-quiet" disabled={state.status === "busy"} onClick={() => void remove()}>
            {strings.labelPrompt.remove}
          </button>
        )}
        <button type="button" className="button button-small button-quiet" onClick={() => setEditing(false)}>
          {strings.labelPrompt.cancel}
        </button>
      </div>
      {state.status === "failed" && (
        <p className="field-error" id={errorId} role="alert">
          {state.message}
        </p>
      )}
    </form>
  );
}

/** The tasks labels' prompts gave the mailbox agent for the thread's messages: each label, its state, and the agent's note. */
export function ThreadTasks({ tasks }: { tasks: Task[] | undefined }) {
  if (tasks === undefined || tasks.length === 0) return null;
  return (
    <section className="tasks" aria-label={strings.tasks.title}>
      <ol>
        {tasks.map((task) => (
          <li key={task.id} className={`task task-${task.state}`}>
            <p className="task-head">
              <ActorMark kind="coo" />
              <span className="task-agent">{strings.tasks.agent}</span>
              <span className="task-label">{strings.tasks.from(task.labelName)}</span>
              <span className="task-state">{strings.tasks.states[task.state]}</span>
              <Time at={task.endedAt ?? task.startedAt ?? task.givenAt} short />
            </p>
            {task.note !== undefined && task.note !== "" && <p className="task-note">{task.note}</p>}
          </li>
        ))}
      </ol>
    </section>
  );
}
