// Files uploaded to drafts (ADR-0034). API Gateway takes at most 10 MB a request, so a file goes
// straight to the uploads bucket, never through the API: starting an upload starts a multipart
// upload there and hands out presigned URLs for its parts, and completing it has S3 join them and
// attaches the file to the draft. Every upload is multipart, a small file as one part, so a file
// is in the bucket only once it is whole, and S3's lifecycle gives up an upload never completed.
// Until it is completed, the upload is kept in the mailbox's partition, for a while only. The
// bucket keeps each draft's files under its own prefix and no versions, so deleting a draft, or
// sending it, deletes them for good. A draft's attachment opens through a link that works for
// minutes: a presigned URL for an uploaded file, and a download link for a forwarded one.
import { randomUUID } from "node:crypto";
import { DeleteCommand, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import type { components } from "@duva/openapi";
import { jsonBody, type OperationHandler, refusal } from "./api.ts";
import { mailboxFor } from "./access.ts";
import { downloadLink } from "./attachments.ts";
import type { Deployment } from "./deployment.ts";
import {
  AlreadyApproved,
  AlreadyAttached,
  approvedOutcomes,
  attachFile,
  CarriedLink,
  chooseLink,
  type Draft,
  type DraftFile,
  findDraft,
  draftToSend,
  maxFiles,
  NoSuchAttachment,
  removeAttachment,
  TooManyFiles,
} from "./drafting.ts";
import { timeToLiveAttribute } from "./infrastructure.ts";
import { mediaTypeOf } from "./mime.ts";
import { mailboxKey } from "./organization.ts";
import { fileKey, type UploadedPart } from "./uploads-bucket.ts";
import { documents, isNew, pk, sk } from "./table.ts";

/** How large a file is at most: 5 GB (ADR-0034). */
export const maxFileSize = 5 * 1024 ** 3;
/** How many bytes each part of an upload has, the last one fewer, so a 5 GB file takes 160 parts. */
export const partSize = 32 * 1024 ** 2;
/** How long a part's URL works. */
const partUrlLifetime = 60 * 60 * 1000;
/** How long the table keeps an upload not completed: past the day after which S3 gives it up. */
const uploadKept = 2 * 24 * 60 * 60;

const uploadKey = (mailbox: string, draft: string, upload: string) => ({ [pk]: mailboxKey(mailbox)[pk]!, [sk]: `upload#${draft}#${upload}` });

/** An upload not completed yet, as the table keeps it. */
interface StoredUpload {
  id: string;
  name: string;
  type: string;
  size: number;
  /** The multipart upload's ID in S3. */
  s3Upload: string;
}

export const startUpload: OperationHandler = async (event, deployment, actor) => {
  const mailbox = await mailboxFor(event, deployment, actor!, "draft");
  if ("statusCode" in mailbox) return mailbox;
  const body = jsonBody(event) ?? {};
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (name === "" || name.length > 255 || /[\x00-\x1f\x7f]/.test(name)) return refusal(400, "Give the file's name as one line of 1 to 255 characters.");
  const { size } = body;
  if (typeof size !== "number" || !Number.isInteger(size) || size < 1 || size > maxFileSize) return refusal(400, "Give the file's size in bytes, from 1 to 5 GB. An empty file can't be attached.");
  if (body.type !== undefined && typeof body.type !== "string") return refusal(400, "Give the file's type as a media type, like application/pdf, or leave it out.");
  const type = mediaTypeOf(typeof body.type === "string" ? body.type.trim().toLowerCase() : "");
  const draftId = event.pathParameters?.draft ?? "";
  const draft = await findDraft(deployment.table, mailbox.id, draftId);
  if (draft === undefined) return noDraft(draftId);
  const unchangeable = refusalFor(draft);
  if (unchangeable !== undefined) return unchangeable;
  if ((draft.attachments ?? []).length >= maxFiles) return tooMany();

  const id = randomUUID();
  const upload: StoredUpload = { id, name, type, size, s3Upload: await deployment.uploads.start(fileKey(mailbox.id, draftId, id), type) };
  await documents(deployment.table).send(
    new PutCommand({ TableName: deployment.table.name, Item: { ...uploadKey(mailbox.id, draftId, upload.id), ...upload, [timeToLiveAttribute]: Math.floor(Date.now() / 1000) + uploadKept }, ...isNew }),
  );
  return { statusCode: 201, body: (await uploadOf(deployment, mailbox.id, draftId, upload)) satisfies components["schemas"]["Upload"] };
};

export const getUpload: OperationHandler = async (event, deployment, actor) => {
  const mailbox = await mailboxFor(event, deployment, actor!, "draft");
  if ("statusCode" in mailbox) return mailbox;
  const { draft = "", upload: id = "" } = event.pathParameters ?? {};
  const upload = await storedUpload(deployment, mailbox.id, draft, id);
  if (upload === undefined) return noUpload(id);
  return { statusCode: 200, body: (await uploadOf(deployment, mailbox.id, draft, upload)) satisfies components["schemas"]["Upload"] };
};

export const completeUpload: OperationHandler = async (event, deployment, actor) => {
  const mailbox = await mailboxFor(event, deployment, actor!, "draft");
  if ("statusCode" in mailbox) return mailbox;
  const { draft: draftId = "", upload: id = "" } = event.pathParameters ?? {};
  const draft = await findDraft(deployment.table, mailbox.id, draftId);
  if (draft === undefined) return noDraft(draftId);
  const upload = await storedUpload(deployment, mailbox.id, draftId, id);
  // Completed before, its file is among the draft's attachments.
  if (upload === undefined) return draft.attachments?.some((file) => file.id === id) ? { statusCode: 200, body: draft } : noUpload(id);
  const unchangeable = refusalFor(draft);
  if (unchangeable !== undefined) return unchangeable;
  const key = fileKey(mailbox.id, draftId, id);
  const parts = await deployment.uploads.parts(key, upload.s3Upload);
  // S3 joined the parts for a call that stopped before it attached the file, which this one does.
  if (parts === undefined && !(await deployment.uploads.has(key))) {
    await forget(deployment, mailbox.id, draftId, id);
    return noUpload(id);
  }
  if (parts !== undefined) {
    const wrong = wrongParts(upload.size, parts);
    if (wrong !== undefined) return refusal(409, wrong);
    await deployment.uploads.complete(key, upload.s3Upload, parts);
  }
  const file: DraftFile = { id, name: upload.name, type: upload.type, size: upload.size, source: "uploaded" };
  const items = [{ Delete: { TableName: deployment.table.name, Key: uploadKey(mailbox.id, draftId, id) } }];
  try {
    const attached = await attachFile(deployment.table, { mailbox: mailbox.id, id: draftId, by: actor!.id, file, items });
    if (attached !== undefined) return { statusCode: 200, body: attached satisfies components["schemas"]["Draft"] };
    await deployment.uploads.remove(key);
    return noDraft(draftId);
  } catch (error) {
    // Another call completed it at the same time.
    if (error instanceof AlreadyAttached) return { statusCode: 200, body: (await findDraft(deployment.table, mailbox.id, draftId))! satisfies components["schemas"]["Draft"] };
    if (!(error instanceof AlreadyApproved || error instanceof TooManyFiles)) throw error;
    // The draft moved on while the parts were joined, so the file has no draft to go with.
    await deployment.uploads.remove(key);
    await forget(deployment, mailbox.id, draftId, id);
    if (error instanceof TooManyFiles) return tooMany();
    const now = await findDraft(deployment.table, mailbox.id, draftId);
    return (now && refusalFor(now)) ?? noDraft(draftId);
  }
};

export const getDraftAttachment: OperationHandler = async (event, deployment, actor) => {
  const mailbox = await mailboxFor(event, deployment, actor!, "read");
  if ("statusCode" in mailbox) return mailbox;
  const { draft: draftId = "", attachment: id = "" } = event.pathParameters ?? {};
  const draft = await draftToSend(deployment.table, mailbox.id, draftId);
  if (draft === undefined) return noDraft(draftId);
  const file = draft.files.find((each) => each.id === id);
  if (file === undefined) return noAttachment(id);
  const { place, ...attachment } = file;
  if (file.source === "forwarded") {
    if (draft.forwards === undefined) return noAttachment(id);
    const link = await downloadLink(deployment, { mailbox: mailbox.id, message: draft.forwards, attachment: place! });
    return { statusCode: 200, body: { name: attachment.name, type: attachment.type, size: attachment.size, ...link } satisfies components["schemas"]["AttachmentLink"] };
  }
  // A sent draft's files went with the message, where they are now.
  if (draft.send?.state === "sent") return refusal(404, "The draft was sent, so its files are in the sent message. Open them there.");
  const expires = new Date(Date.now() + deployment.downloads.lifetime * 1000);
  const url = await deployment.uploads.downloadUrl(fileKey(mailbox.id, draftId, id), attachment, expires);
  return { statusCode: 200, body: { name: attachment.name, type: attachment.type, size: attachment.size, url, expiresAt: expires.toISOString() } satisfies components["schemas"]["AttachmentLink"] };
};

export const changeDraftAttachment: OperationHandler = async (event, deployment, actor) => {
  const mailbox = await mailboxFor(event, deployment, actor!, "draft");
  if ("statusCode" in mailbox) return mailbox;
  const { draft: draftId = "", attachment: id = "" } = event.pathParameters ?? {};
  const linked = jsonBody(event)?.linked;
  if (typeof linked !== "boolean") return refusal(400, "Give linked as true to send the file as a linked file, or false to carry it in the message.");
  try {
    const draft = await chooseLink(deployment.table, { mailbox: mailbox.id, id: draftId, by: actor!.id, attachment: id, linked });
    if (draft === undefined) return noDraft(draftId);
    return { statusCode: 200, body: draft satisfies components["schemas"]["Draft"] };
  } catch (error) {
    if (error instanceof NoSuchAttachment) return noAttachment(id);
    if (error instanceof CarriedLink) return refusal(409, "It's a linked file of the message the draft forwards, so it goes as that message's link. Remove it to leave it out.");
    if (error instanceof AlreadyApproved) return refusal(409, `The draft ${approvedOutcomes[error.state]}, so its attachments stay as they are.`);
    throw error;
  }
};

export const removeDraftAttachment: OperationHandler = async (event, deployment, actor) => {
  const mailbox = await mailboxFor(event, deployment, actor!, "draft");
  if ("statusCode" in mailbox) return mailbox;
  const { draft: draftId = "", attachment: id = "" } = event.pathParameters ?? {};
  try {
    const removed = await removeAttachment(deployment.table, { mailbox: mailbox.id, id: draftId, by: actor!.id, attachment: id });
    if (removed === undefined) return noDraft(draftId);
    if (removed.removed.source === "uploaded") await deployment.uploads.remove(fileKey(mailbox.id, draftId, id));
    return { statusCode: 200, body: removed.draft satisfies components["schemas"]["Draft"] };
  } catch (error) {
    if (error instanceof NoSuchAttachment) {
      // A removal that stopped before the file was deleted finishes here.
      await deployment.uploads.remove(fileKey(mailbox.id, draftId, id));
      return noAttachment(id);
    }
    if (error instanceof AlreadyApproved) return refusal(409, `The draft ${approvedOutcomes[error.state]}, so its attachments stay as they are.`);
    throw error;
  }
};

/** The upload with new URLs for its parts. */
async function uploadOf(deployment: Deployment, mailbox: string, draft: string, { id, name, type, size, s3Upload }: StoredUpload): Promise<components["schemas"]["Upload"]> {
  const expires = new Date(Date.now() + partUrlLifetime);
  const urls = await deployment.uploads.partUrls(fileKey(mailbox, draft, id), s3Upload, Math.ceil(size / partSize), expires);
  return { id, name, type, size, partSize, parts: urls.map((url, index) => ({ number: index + 1, url })), expiresAt: expires.toISOString() };
}

async function storedUpload(deployment: Deployment, mailbox: string, draft: string, id: string): Promise<StoredUpload | undefined> {
  const { Item } = await documents(deployment.table).send(new GetCommand({ TableName: deployment.table.name, Key: uploadKey(mailbox, draft, id), ConsistentRead: true }));
  return Item as StoredUpload | undefined;
}

const forget = (deployment: Deployment, mailbox: string, draft: string, id: string) =>
  documents(deployment.table).send(new DeleteCommand({ TableName: deployment.table.name, Key: uploadKey(mailbox, draft, id) }));

/** Why the parts don't make the whole file of the size, saying which are missing or the wrong size, or undefined if they do. */
function wrongParts(size: number, parts: UploadedPart[]): string | undefined {
  const count = Math.ceil(size / partSize);
  const sizeOf = (number: number) => (number < count ? partSize : size - partSize * (count - 1));
  const missing: number[] = [];
  const wrong: number[] = [];
  for (let number = 1; number <= count; number++) {
    const part = parts.find((each) => each.number === number);
    if (part === undefined) missing.push(number);
    else if (part.size !== sizeOf(number)) wrong.push(number);
  }
  if (missing.length === 0 && wrong.length === 0) return undefined;
  const list = (numbers: number[]) => (numbers.length > 10 ? `${numbers.slice(0, 10).join(", ")} and ${numbers.length - 10} more` : numbers.join(", "));
  return [
    ...(missing.length > 0 ? [`Part${missing.length === 1 ? "" : "s"} ${list(missing)} of ${count} ${missing.length === 1 ? "isn't" : "aren't"} uploaded yet.`] : []),
    ...(wrong.length > 0 ? [`Part${wrong.length === 1 ? "" : "s"} ${list(wrong)} ${wrong.length === 1 ? "has" : "have"} the wrong size: each part but the last has ${partSize} bytes.`] : []),
    "Upload them, then complete the upload.",
  ].join(" ");
}

/** Why the draft takes no more files, once it was approved, or undefined while it does. */
function refusalFor(draft: Draft) {
  const state = draft.send?.state;
  const outcome = state === undefined || !(state in approvedOutcomes) ? undefined : approvedOutcomes[state as keyof typeof approvedOutcomes];
  return outcome === undefined ? undefined : refusal(409, `The draft ${outcome}, so it takes no more files. Write a new draft instead.`);
}

const noDraft = (id: string) => refusal(404, `The mailbox has no draft ${JSON.stringify(id)}. List its drafts to find one.`);
const noUpload = (id: string) => refusal(404, `The draft has no upload ${JSON.stringify(id)} waiting: it was completed, or given up after a day. Start it again.`);
const noAttachment = (id: string) => refusal(404, `The draft has no attachment ${JSON.stringify(id)}. Read the draft to see its attachments.`);
const tooMany = () => refusal(409, `The draft carries ${maxFiles} files, as many as it can. Remove one first, or send the rest in another message.`);
