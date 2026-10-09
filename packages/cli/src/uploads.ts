// duva drafts create and duva drafts edit take files with --attach, once for each. Once the draft
// is written, each file goes straight to Duva's storage, a part at a time, as the web app uploads
// them (ADR-0034), and the command prints the draft with them all.
import { open, stat } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import type { components } from "@duva/openapi";
import { callApi } from "./api-commands.ts";
import { type Command, optionValues } from "./commands.ts";

type Draft = components["schemas"]["Draft"];
type Upload = components["schemas"]["Upload"];

const attach = { name: "attach", required: false, type: "strings", description: "A file to attach, uploaded once the draft is written." } as const;

/** The command, taking files to attach with --attach. Without other changes, drafts edit only attaches them. */
export function withAttachments(command: Command): Command {
  const wrapped: Command = {
    ...command,
    options: [...command.options, attach],
    async run(args) {
      const files = (optionValues(wrapped, args).attach as string[] | undefined) ?? [];
      const rest = withoutAttach(args);
      if (files.length === 0) return command.run(rest);
      const sizes = await Promise.all(
        files.map(async (file) => {
          const found = await stat(resolve(file)).catch(() => undefined);
          if (!found?.isFile()) throw new Error(`There is no file ${file} to attach. Give --attach the path of a file.`);
          return found.size;
        }),
      );
      const given = optionValues(command, rest);
      const changes = Object.entries(given).filter(([name, value]) => value !== undefined && name !== "mailbox" && name !== "draft");
      let draft = (command.words[1] === "edit" && changes.length === 0 ? undefined : await command.run(rest)) as Draft | undefined;
      const mailbox = given.mailbox as string;
      const id = draft?.id ?? (given.draft as string | undefined);
      if (typeof mailbox !== "string" || id === undefined) throw new Error(`Give --mailbox${command.words[1] === "edit" ? " and --draft" : ""}, so Duva knows which draft the files go to.`);
      for (const [index, file] of files.entries()) draft = await upload({ mailbox, draft: id }, resolve(file), sizes[index]!);
      return draft;
    },
  };
  return wrapped;
}

/** The arguments without --attach and its values. */
function withoutAttach(args: string[]): string[] {
  const rest: string[] = [];
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--attach") index++;
    else if (!args[index]!.startsWith("--attach=")) rest.push(args[index]!);
  }
  return rest;
}

/** Uploads the file to the draft, each part to its URL, then completes the upload, and returns the draft with it. */
async function upload(path: { mailbox: string; draft: string }, file: string, size: number): Promise<Draft> {
  if (size === 0) throw new Error(`${file} is empty, and an empty file can't be attached.`);
  let started = (await callApi("startUpload", { path, body: { name: basename(file), type: typeOf(file), size } })) as Upload;
  const handle = await open(file);
  try {
    for (const { number } of started.parts) {
      const bytes = Buffer.alloc(Math.min(started.partSize, size - (number - 1) * started.partSize));
      await handle.read(bytes, 0, bytes.length, (number - 1) * started.partSize);
      const put = (url: string) =>
        fetch(url, { method: "PUT", body: bytes }).catch((error: unknown) => {
          throw new Error(`Couldn't upload ${file}: ${error instanceof Error ? error.message : error}. Check your connection, then attach it again with drafts edit --attach.`);
        });
      let answer = await put(started.parts[number - 1]!.url);
      // A link that stopped working is given anew.
      if (answer.status === 403) {
        started = (await callApi("getUpload", { path: { ...path, upload: started.id } })) as Upload;
        answer = await put(started.parts[number - 1]!.url);
      }
      if (!answer.ok) throw new Error(`Uploading part ${number} of ${file} answered ${answer.status}: ${(await answer.text()).trim().slice(0, 200)}. Attach it again with drafts edit --attach.`);
    }
  } finally {
    await handle.close();
  }
  return (await callApi("completeUpload", { path: { ...path, upload: started.id } })) as Draft;
}

// The media types of common files, by their extensions. Others go as application/octet-stream.
const types: Record<string, string> = {
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".csv": "text/csv",
  ".html": "text/html",
  ".json": "application/json",
  ".zip": "application/zip",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".mp3": "audio/mpeg",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

const typeOf = (file: string) => types[extname(file).toLowerCase()] ?? "application/octet-stream";
