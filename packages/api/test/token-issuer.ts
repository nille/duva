// Stands in for Cognito as the issuer of humans' access tokens. The authorizer trusts it only in
// tests: the harness hands the authorizer this issuer's verify, where a deployment hands it Cognito's.
import { createSign, createVerify, generateKeyPairSync } from "node:crypto";

export class TestTokenIssuer {
  #keys = newKeys();

  /** Signs with new keys from now on, as a new user pool does, so tokens issued before are refused. */
  replaceKeys() {
    this.#keys = newKeys();
  }

  /** An access token for the human with the ID, valid for `lifetime` seconds. */
  issue(id: string, lifetime: number): string {
    const now = Math.floor(Date.now() / 1000);
    const header = encode({ alg: "RS256", typ: "JWT" });
    const payload = encode({ sub: id, token_use: "access", iat: now, exp: now + lifetime });
    const signature = createSign("RSA-SHA256").update(`${header}.${payload}`).sign(this.#keys.privateKey, "base64url");
    return `${header}.${payload}.${signature}`;
  }

  /** The ID the token carries. Throws if this issuer didn't sign it or it has expired. */
  verify = async (token: string): Promise<string> => {
    const [header, payload, signature] = token.split(".");
    if (header === undefined || payload === undefined || signature === undefined) throw new Error("Not a token");
    const signed = createVerify("RSA-SHA256").update(`${header}.${payload}`).verify(this.#keys.publicKey, signature, "base64url");
    if (!signed) throw new Error("Not signed by the test issuer");
    const { sub, exp } = JSON.parse(Buffer.from(payload, "base64url").toString()) as { sub: string; exp: number };
    if (exp * 1000 <= Date.now()) throw new Error("Expired");
    return sub;
  };
}

const newKeys = () => generateKeyPairSync("rsa", { modulusLength: 2048 });
const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
