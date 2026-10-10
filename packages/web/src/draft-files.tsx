// The files a draft carries, in the composer: those it has, each with its type and size, opened
// through a link that works for minutes and taken off with Remove, and those on their way, each
// going straight to Duva's storage a part at a time (ADR-0034), with how far it got along a
// hairline under its line. A part's link that stopped working is asked for anew, once. A file that
// goes as a linked file carries the Link tag (ADR-0034): the sender may link any by choice, Duva
// links the largest when carrying them all would make the message more than 10 MB, and the links'
// lifetime is chosen under the files.
import { useCallback, useEffect, useRef, useState } from "react";
import type { DuvaClient } from "@duva/client";
import type { components } from "@duva/openapi";
import { useDates } from "./dates.ts";
import { Attachments, ClipIcon } from "./mail-parts.tsx";
import { size, strings } from "./strings.ts";

type Draft = components["schemas"]["Draft"];
type Upload = components["schemas"]["Upload"];
type DraftAttachment = components["schemas"]["DraftAttachment"];

/** A file on its way to the draft, as the composer shows it until Duva lists it among the draft's. */
interface Arriving {
  key: string;
  name: string;
  size: number;
  /** How many of its bytes have arrived. */
  sent: number;
  failed?: string;
  /** Stops it, when the human removes it on its way. */
  cancel: () => void;
}

/**
 * Uploads files to the draft that `draftId` gives, in the mailbox it lives in, once it has one, and
 * tells `onDraft` the draft with each as it is attached. Answers the files on their way, and how to add and drop them.
 */
export function useUploads({
  client,
  draftId,
  onDraft,
  onSignedOut,
}: {
  client: DuvaClient;
  draftId: () => Promise<{ mailbox: string; draft: string } | undefined>;
  onDraft: (draft: Draft) => void;
  onSignedOut: () => void;
}) {
  const [sending, setSending] = useState<Arriving[]>([]);
  const change = (key: string, next: Partial<Arriving>) => setSending((current) => current.map((each) => (each.key === key ? { ...each, ...next } : each)));
  const live = useRef(true);
  useEffect(
    () => () => {
      live.current = false;
    },
    [],
  );

  const add = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      const entries = files.map((file) => {
        let request: XMLHttpRequest | undefined;
        let cancelled = false;
        const entry: Arriving & { file: File; cancelled: () => boolean; current: (xhr: XMLHttpRequest | undefined) => void } = {
          key: crypto.randomUUID(),
          name: file.name,
          size: file.size,
          sent: 0,
          file,
          cancel: () => {
            cancelled = true;
            request?.abort();
            setSending((current) => current.filter((each) => each.key !== entry.key));
          },
          cancelled: () => cancelled,
          current: (xhr) => void (request = xhr),
        };
        return entry;
      });
      setSending((current) => [...current, ...entries]);
      const given = await draftId();
      for (const entry of entries) {
        void (async () => {
          const failed = (reason: string) => live.current && !entry.cancelled() && change(entry.key, { failed: reason });
          if (given === undefined) return failed(strings.compose.uploadFailed);
          if (entry.file.size === 0) return failed(strings.compose.emptyFile);
          const path = given;
          const started = await client
            .POST("/mailboxes/{mailbox}/drafts/{draft}/uploads", { params: { path }, body: { name: entry.file.name, ...(entry.file.type !== "" && { type: entry.file.type }), size: entry.file.size } })
            .catch(() => undefined);
          if (started?.response.status === 401) return onSignedOut();
          if (started?.data === undefined) return failed(started?.error?.message ?? strings.compose.uploadFailed);
          let upload: Upload = started.data;
          for (const { number } of upload.parts) {
            if (entry.cancelled()) return;
            const from = (number - 1) * upload.partSize;
            const part = entry.file.slice(from, Math.min(from + upload.partSize, entry.file.size));
            const put = (url: string) => putPart(url, part, (loaded) => live.current && change(entry.key, { sent: from + loaded }), entry.current);
            let status = await put(upload.parts[number - 1]!.url);
            // The part's link stopped working, so Duva gives new ones.
            if (status === 403) {
              const again = await client.GET("/mailboxes/{mailbox}/drafts/{draft}/uploads/{upload}", { params: { path: { ...path, upload: upload.id } } }).catch(() => undefined);
              if (again?.data === undefined) return failed(strings.compose.uploadFailed);
              upload = again.data;
              status = await put(upload.parts[number - 1]!.url);
            }
            if (entry.cancelled()) return;
            if (status !== 200) return failed(strings.compose.uploadFailed);
          }
          const completed = await client.POST("/mailboxes/{mailbox}/drafts/{draft}/uploads/{upload}/complete", { params: { path: { ...path, upload: upload.id } } }).catch(() => undefined);
          if (entry.cancelled() || !live.current) return;
          if (completed?.data === undefined) return failed(completed?.error?.message ?? strings.compose.uploadFailed);
          setSending((current) => current.filter((each) => each.key !== entry.key));
          onDraft(completed.data);
        })();
      }
    },
    [client, draftId, onDraft, onSignedOut],
  );
  return { sending, add, uploading: sending.some(({ failed }) => failed === undefined) };
}

/** PUTs the part to its URL, telling `progress` how many of its bytes went, and answers the status, or 0 if it never got there. */
function putPart(url: string, part: Blob, progress: (loaded: number) => void, current: (xhr: XMLHttpRequest | undefined) => void): Promise<number> {
  return new Promise((resolve) => {
    // Only XMLHttpRequest tells how far an upload got.
    const xhr = new XMLHttpRequest();
    current(xhr);
    xhr.open("PUT", url);
    xhr.upload.onprogress = (event) => progress(event.loaded);
    xhr.onload = () => {
      if (xhr.status === 200) progress(part.size);
      resolve(xhr.status);
    };
    xhr.onerror = xhr.onabort = () => resolve(0);
    xhr.send(part);
  });
}

/**
 * The draft's files and those on their way, under a seam. Each name opens the file, and Remove
 * takes it off, while the draft can change.
 */
export function DraftFiles({
  client,
  mailbox,
  draft,
  sending,
  locked,
  onDraft,
  onSignedOut,
}: {
  client: DuvaClient;
  mailbox: string;
  draft?: Draft;
  sending: Arriving[];
  locked: boolean;
  onDraft: (draft: Draft) => void;
  onSignedOut: () => void;
}) {
  const [busy, setBusy] = useState<string>();
  const [problem, setProblem] = useState<string>();
  const { date } = useDates();
  const files = draft?.attachments ?? [];
  if (files.length === 0 && sending.length === 0) return null;
  const linking = files.some(({ linked }) => linked !== undefined);
  const days = draft?.linkDays ?? 30;

  const path = (attachment: DraftAttachment) => ({ params: { path: { mailbox, draft: draft!.id, attachment: attachment.id } } });
  const open = async (attachment: DraftAttachment) => {
    setBusy(attachment.id);
    setProblem(undefined);
    const { data, response } = await client.GET("/mailboxes/{mailbox}/drafts/{draft}/attachments/{attachment}", path(attachment)).catch(() => ({ data: undefined, response: undefined }));
    setBusy(undefined);
    if (response?.status === 401) return onSignedOut();
    if (data === undefined) return setProblem(strings.thread.downloadFailed);
    const link = document.createElement("a");
    link.href = data.url;
    link.click();
  };
  const relink = async (attachment: DraftAttachment, linked: boolean) => {
    setBusy(attachment.id);
    setProblem(undefined);
    const { data, error, response } = await client
      .PATCH("/mailboxes/{mailbox}/drafts/{draft}/attachments/{attachment}", { ...path(attachment), body: { linked } })
      .catch(() => ({ data: undefined, error: undefined, response: undefined }));
    setBusy(undefined);
    if (response?.status === 401) return onSignedOut();
    if (data === undefined) return setProblem(error?.message ?? strings.compose.linkFailed);
    onDraft(data);
  };
  const lastFor = async (linkDays: 7 | 30 | 365) => {
    setProblem(undefined);
    const { data, error, response } = await client
      .PATCH("/mailboxes/{mailbox}/drafts/{draft}", { params: { path: { mailbox, draft: draft!.id } }, body: { linkDays } })
      .catch(() => ({ data: undefined, error: undefined, response: undefined }));
    if (response?.status === 401) return onSignedOut();
    if (data === undefined) return setProblem(error?.message ?? strings.compose.linkFailed);
    onDraft(data);
  };
  const remove = async (attachment: DraftAttachment) => {
    setBusy(attachment.id);
    setProblem(undefined);
    const { data, error, response } = await client.DELETE("/mailboxes/{mailbox}/drafts/{draft}/attachments/{attachment}", path(attachment)).catch(() => ({ data: undefined, error: undefined, response: undefined }));
    setBusy(undefined);
    if (response?.status === 401) return onSignedOut();
    if (data === undefined) return setProblem(error?.message ?? strings.compose.removeFailed);
    onDraft(data);
  };

  return (
    <section className="letter-attachments draft-files" aria-label={strings.thread.attachments}>
      <ul>
        {files.map((attachment) => {
          const name = attachment.name ?? strings.thread.unnamed;
          const meta = strings.thread.attachment(attachment.type, size(attachment.size));
          const linked = attachment.source === "linked" ? "carried" : attachment.linked;
          // The link of the mail it forwards, or one Duva needs, can't be attached instead.
          const choosable = attachment.source !== "linked" && attachment.linked !== "needed";
          return (
            <li key={attachment.id} className={linked === undefined ? undefined : "draft-file-linked"}>
              <ClipIcon />
              <span>
                {/* A forwarded link opens on its page, which only its recipients have. */}
                {attachment.source === "linked" ? (
                  <span className="attachment-name">{name}</span>
                ) : (
                  <button type="button" className="link attachment-name" aria-label={strings.thread.download(name)} disabled={busy !== undefined} onClick={() => void open(attachment)}>
                    {name}
                  </button>
                )}{" "}
                {linked !== undefined && <span className="file-tag">{strings.compose.linkTag}</span>}{" "}
                <span className="attachment-meta">
                  {busy === attachment.id ? strings.thread.downloading : linked === undefined ? meta : strings.compose.linkedMeta(meta, linked, attachment.until && date(new Date(attachment.until)))}
                </span>
              </span>
              {!locked && (
                <span className="draft-file-actions">
                  {choosable && (
                    <button
                      type="button"
                      className="link draft-file-remove"
                      aria-label={linked === undefined ? strings.compose.linkInsteadFile(name) : strings.compose.attachInsteadFile(name)}
                      disabled={busy !== undefined}
                      onClick={() => void relink(attachment, linked === undefined)}
                    >
                      {linked === undefined ? strings.compose.linkInstead : strings.compose.attachInstead}
                    </button>
                  )}
                  <button type="button" className="link draft-file-remove" aria-label={strings.compose.removeFile(name)} disabled={busy !== undefined} onClick={() => void remove(attachment)}>
                    {strings.compose.remove}
                  </button>
                </span>
              )}
            </li>
          );
        })}
        {sending.map((each) => {
          const percent = each.size === 0 ? 0 : Math.floor((each.sent / each.size) * 100);
          return (
            <li key={each.key} className={each.failed === undefined ? "draft-file-sending" : "draft-file-failed"} style={{ "--sent": `${percent}%` } as React.CSSProperties}>
              <ClipIcon />
              <span>
                <span className="attachment-name">{each.name}</span>{" "}
                {each.failed === undefined ? (
                  <span className="attachment-meta" role="progressbar" aria-label={strings.compose.uploadingFile(each.name)} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={strings.compose.uploading(percent, size(each.size))}>
                    {strings.compose.uploading(percent, size(each.size))}
                  </span>
                ) : (
                  <span className="attachment-meta draft-file-problem" role="alert">
                    {each.failed}
                  </span>
                )}
              </span>
              <button type="button" className="link draft-file-remove" aria-label={strings.compose.removeFile(each.name)} onClick={each.cancel}>
                {strings.compose.remove}
              </button>
            </li>
          );
        })}
      </ul>
      {linking &&
        (locked ? (
          <p className="draft-file-links">{strings.compose.linksFixed(strings.compose.linkDays[days])}</p>
        ) : (
          <p className="draft-file-links">
            <label htmlFor={`link-days-${draft!.id}`}>{strings.compose.linksFor}</label>{" "}
            <select id={`link-days-${draft!.id}`} value={days} onChange={(event) => void lastFor(Number(event.target.value) as 7 | 30 | 365)}>
              {([7, 30, 365] as const).map((each) => (
                <option key={each} value={each}>
                  {strings.compose.linkDays[each]}
                </option>
              ))}
            </select>{" "}
            {strings.compose.linksNote}
          </p>
        ))}
      {problem !== undefined && (
        <p className="draft-file-problem" role="alert">
          {problem}
        </p>
      )}
    </section>
  );
}

/** A draft's files as an approver reads them, each name opening its file before they decide. */
export function DraftFilesToOpen({ client, mailbox, draft, list, onSignedOut }: { client: DuvaClient; mailbox: string; draft: string; list: DraftAttachment[]; onSignedOut: () => void }) {
  const { date } = useDates();
  const [downloading, setDownloading] = useState<number>();
  const [failed, setFailed] = useState(false);
  const open = async (index: number) => {
    setDownloading(index);
    setFailed(false);
    const { data, response } = await client
      .GET("/mailboxes/{mailbox}/drafts/{draft}/attachments/{attachment}", { params: { path: { mailbox, draft, attachment: list[index]!.id } } })
      .catch(() => ({ data: undefined, response: undefined }));
    setDownloading(undefined);
    if (response?.status === 401) return onSignedOut();
    if (data === undefined) return setFailed(true);
    const link = document.createElement("a");
    link.href = data.url;
    link.click();
  };
  return (
    <>
      <Attachments
        list={list}
        onDownload={(index) => void open(index)}
        downloading={downloading}
        linked={(index) => {
          const { source, linked, until } = list[index]!;
          return source === "linked" ? { as: "carried", until: until && date(new Date(until)) } : linked && { as: linked };
        }}
      />
      {failed && (
        <p className="draft-file-problem" role="alert">
          {strings.thread.downloadFailed}
        </p>
      )}
    </>
  );
}
