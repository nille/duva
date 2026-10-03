import { GetObjectCommand, NoSuchKey, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";

/** Where raw mail is kept: the mail bucket in a deployment, memory in tests. */
export interface MailStore {
  put(key: string, body: Uint8Array): Promise<void>;
  /** The object at `key`, or undefined if there is none. */
  get(key: string): Promise<Uint8Array | undefined>;
}

export function s3MailStore(s3: S3Client, bucket: string): MailStore {
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
