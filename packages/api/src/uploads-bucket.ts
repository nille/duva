// The uploads bucket, which holds the files uploaded to drafts (ADR-0034), each draft's under a
// prefix of its own, without versions. A module of its own, so the sender and the eraser use it
// without the API's handlers.
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListMultipartUploadsCommand,
  ListObjectsV2Command,
  ListPartsCommand,
  NoSuchKey,
  NoSuchUpload,
  NotFound,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/** The uploads bucket, or a stand-in in tests. */
export interface UploadsBucket {
  /** Starts a multipart upload of a file of the media type to the key, and returns its ID. */
  start(key: string, type: string): Promise<string>;
  /** URLs that PUT the parts numbered 1 to `parts` of the upload, each working until `expires`. */
  partUrls(key: string, upload: string, parts: number, expires: Date): Promise<string[]>;
  /** The parts uploaded so far, or undefined once the upload was completed or given up. */
  parts(key: string, upload: string): Promise<UploadedPart[] | undefined>;
  /** Joins the parts into the file at the key. */
  complete(key: string, upload: string, parts: UploadedPart[]): Promise<void>;
  /** Puts the file at the key, as one with the media type. */
  put(key: string, content: Uint8Array, type: string): Promise<void>;
  /** The file at the key, or undefined if there is none. */
  get(key: string): Promise<Uint8Array | undefined>;
  /** Whether there is a file at the key. */
  has(key: string): Promise<boolean>;
  /** A URL that downloads the file at the key, saved under its name, until `expires`. */
  downloadUrl(key: string, file: { name?: string; type: string }, expires: Date): Promise<string>;
  /** Deletes every file under the prefix, and gives up every upload there. */
  remove(prefix: string): Promise<void>;
}

export interface UploadedPart {
  number: number;
  size: number;
  etag: string;
}

/** Where the draft's files are in the uploads bucket. */
export const draftPrefix = (mailbox: string, draft: string) => `${mailboxPrefix(mailbox)}${draft}/`;
/** Where the mailbox's files are in the uploads bucket. */
export const mailboxPrefix = (mailbox: string) => `${mailbox}/`;
export const fileKey = (mailbox: string, draft: string, file: string) => `${draftPrefix(mailbox, draft)}${file}`;

/** The draft's uploaded file with the ID, for the sender, or undefined if the bucket no longer has it. */
export const uploadedFile = (deployment: { uploads: UploadsBucket }, mailbox: string, draft: string, file: string) => deployment.uploads.get(fileKey(mailbox, draft, file));

/**
 * The uploads bucket in S3. The client calculates checksums only where S3 requires them, since a
 * presigned URL would otherwise carry the checksum of an empty body, which no part matches.
 */
export function s3UploadsBucket(bucket: string, s3 = new S3Client({ requestChecksumCalculation: "WHEN_REQUIRED" })): UploadsBucket {
  return {
    async start(key, type) {
      const { UploadId } = await s3.send(new CreateMultipartUploadCommand({ Bucket: bucket, Key: key, ContentType: type }));
      if (UploadId === undefined) throw new Error("S3 started the upload without giving it an ID.");
      return UploadId;
    },
    partUrls(key, upload, parts, expires) {
      const expiresIn = Math.floor((expires.getTime() - Date.now()) / 1000);
      return Promise.all(Array.from({ length: parts }, (_, index) => getSignedUrl(s3, new UploadPartCommand({ Bucket: bucket, Key: key, UploadId: upload, PartNumber: index + 1 }), { expiresIn })));
    },
    async parts(key, upload) {
      const parts: UploadedPart[] = [];
      let marker: string | undefined;
      try {
        do {
          const page = await s3.send(new ListPartsCommand({ Bucket: bucket, Key: key, UploadId: upload, PartNumberMarker: marker }));
          for (const { PartNumber, Size, ETag } of page.Parts ?? []) parts.push({ number: PartNumber!, size: Size!, etag: ETag! });
          marker = page.IsTruncated ? page.NextPartNumberMarker : undefined;
        } while (marker !== undefined);
      } catch (error) {
        if (error instanceof NoSuchUpload) return undefined;
        throw error;
      }
      return parts;
    },
    async complete(key, upload, parts) {
      await s3.send(
        new CompleteMultipartUploadCommand({
          Bucket: bucket,
          Key: key,
          UploadId: upload,
          MultipartUpload: { Parts: [...parts].sort((a, b) => a.number - b.number).map(({ number, etag }) => ({ PartNumber: number, ETag: etag })) },
        }),
      );
    },
    async put(key, content, type) {
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: content, ContentType: type }));
    },
    async get(key) {
      try {
        const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        return await object.Body?.transformToByteArray();
      } catch (error) {
        if (error instanceof NoSuchKey) return undefined;
        throw error;
      }
    },
    async has(key) {
      try {
        await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return true;
      } catch (error) {
        if (error instanceof NotFound) return false;
        throw error;
      }
    },
    downloadUrl(key, { name, type }, expires) {
      const expiresIn = Math.max(1, Math.floor((expires.getTime() - Date.now()) / 1000));
      return getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key, ResponseContentType: type, ResponseContentDisposition: dispositionOf(name) }), { expiresIn });
    },
    async remove(prefix) {
      let token: string | undefined;
      do {
        const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
        const keys = (page.Contents ?? []).map(({ Key }) => ({ Key }));
        if (keys.length > 0) await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys, Quiet: true } }));
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token !== undefined);
      let keyMarker: string | undefined;
      let uploadMarker: string | undefined;
      do {
        const page = await s3.send(new ListMultipartUploadsCommand({ Bucket: bucket, Prefix: prefix, KeyMarker: keyMarker, UploadIdMarker: uploadMarker }));
        for (const { Key, UploadId } of page.Uploads ?? []) await s3.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key, UploadId }));
        keyMarker = page.IsTruncated ? page.NextKeyMarker : undefined;
        uploadMarker = page.NextUploadIdMarker;
      } while (keyMarker !== undefined);
    },
  };
}

/**
 * A Content-Disposition that saves the attachment under its name: in ASCII for old clients, and
 * in UTF-8 (RFC 6266) for the rest, so Swedish and Danish names survive.
 */
export function dispositionOf(name: string | undefined): string {
  if (name === undefined || name.trim() === "") return "attachment";
  const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, "_");
  const utf8 = encodeURIComponent(name).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}
