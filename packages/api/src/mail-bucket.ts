import { GetObjectCommand, NoSuchKey, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";

/** The mail bucket, which holds raw received mail and the raw MIME of every sent message. */
export interface MailBucket {
  put(key: string, body: Uint8Array): Promise<void>;
  /** The object at `key`, or undefined if there is none. */
  get(key: string): Promise<Uint8Array | undefined>;
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
  };
}
