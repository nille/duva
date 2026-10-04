// duva attachments download: gets an attachment's link from Duva, follows it, and saves what it
// downloads to a file.
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { components } from "@duva/openapi";
import { callApi } from "./api-commands.ts";
import { type Command, optionValues } from "./commands.ts";

export const attachmentsDownload: Command = {
  words: ["attachments", "download"],
  summary: "Download one of a message's attachments to a file, and say where it went.",
  description:
    "Without --file, the attachment goes in the working directory under its own name. An existing file is never overwritten. Only those who can read the mailbox can download from it: its owner and, for an agent's mailbox, its sponsor.",
  options: [
    { name: "mailbox", required: true, description: "The mailbox's ID." },
    { name: "message", required: true, description: "The message's ID." },
    { name: "attachment", required: true, description: "The attachment's place among the message's attachments, from 0." },
    { name: "file", required: false, description: "Where to save it. Without it, the working directory, under the attachment's name." },
  ],
  async run(args) {
    const values = optionValues(attachmentsDownload, args);
    for (const name of ["mailbox", "message", "attachment"]) if (typeof values[name] !== "string") throw new Error(`Give --${name}.`);
    if (!/^\d+$/.test(values.attachment as string)) throw new Error(`${JSON.stringify(values.attachment)} isn't a whole number. Give --attachment one from 0.`);
    const link = (await callApi("getAttachment", {
      path: { mailbox: values.mailbox as string, message: values.message as string, attachment: Number(values.attachment) },
    })) as components["schemas"]["AttachmentLink"];
    const response = await fetch(link.url).catch((error: unknown) => {
      throw new Error(`Couldn't download the attachment: ${error instanceof Error ? error.message : error}`);
    });
    if (!response.ok) throw new Error(`Downloading the attachment answered ${response.status}: ${(await response.text()).trim()}`);
    const file = resolve(typeof values.file === "string" ? values.file : fileNameOf(link.name));
    await writeFile(file, new Uint8Array(await response.arrayBuffer()), { flag: "wx" }).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`${file} is already there. Give --file to save the attachment somewhere else.`);
      throw error;
    });
    return { file, ...(link.name !== undefined && { name: link.name }), type: link.type, size: link.size };
  },
};

/** The attachment's name as a file name in the working directory, which the sender's name can't lead out of. */
function fileNameOf(name: string | undefined): string {
  const file = (name ?? "").replace(/[/\\\x00-\x1f]/g, "_").trim().replace(/^\.+/, "");
  return file === "" ? "attachment" : file;
}
