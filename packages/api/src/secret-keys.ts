// The stack's own KMS key, which seals the humans' secrets (ADR-0039). Each value is encrypted
// directly, as it is far under KMS's 4 KB, under an encryption context naming its human and its
// secret, which decrypting must give again, so a sealed value copied to another item opens nowhere.
import { DecryptCommand, EncryptCommand, KMSClient } from "@aws-sdk/client-kms";
import type { SecretKeys } from "./secrets.ts";

export function kmsSecretKeys(keyId: string): SecretKeys {
  const kms = new KMSClient({});
  return {
    async seal(value, context) {
      const { CiphertextBlob } = await kms.send(new EncryptCommand({ KeyId: keyId, Plaintext: Buffer.from(value), EncryptionContext: context }));
      return Buffer.from(CiphertextBlob!).toString("base64");
    },
    async open(sealed, context) {
      const { Plaintext } = await kms.send(new DecryptCommand({ KeyId: keyId, CiphertextBlob: Buffer.from(sealed, "base64"), EncryptionContext: context }));
      return Buffer.from(Plaintext!).toString();
    },
  };
}
