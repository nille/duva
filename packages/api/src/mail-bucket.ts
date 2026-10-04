import { DeleteObjectCommand, GetObjectCommand, ListObjectVersionsCommand, NoSuchKey, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";

/** The mail bucket, which holds raw received mail and the raw MIME of every sent message. */
export interface MailBucket {
  put(key: string, body: Uint8Array): Promise<void>;
  /** The object at `key`, or undefined if there is none. */
  get(key: string): Promise<Uint8Array | undefined>;
  /** Deletes the object at `key` for good, every version of it included. Returns whether there was anything to delete. */
  erase(key: string): Promise<boolean>;
}

export function s3MailBucket(s3: S3Client, bucket: string): MailBucket {
  return {
    async put(key, body) {
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body }));
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
    async erase(key) {
      // The bucket is versioned, so a plain delete would only hide the object behind a delete marker.
      let keyMarker: string | undefined;
      let versionIdMarker: string | undefined;
      let erased = false;
      do {
        const page = await s3.send(new ListObjectVersionsCommand({ Bucket: bucket, Prefix: key, KeyMarker: keyMarker, VersionIdMarker: versionIdMarker }));
        for (const { Key, VersionId } of [...(page.Versions ?? []), ...(page.DeleteMarkers ?? [])]) {
          if (Key !== key) continue;
          await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key, VersionId }));
          erased = true;
        }
        keyMarker = page.IsTruncated ? page.NextKeyMarker : undefined;
        versionIdMarker = page.NextVersionIdMarker;
      } while (keyMarker !== undefined);
      return erased;
    },
  };
}
