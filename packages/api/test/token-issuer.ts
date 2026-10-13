// Stands in for Cognito as the issuer of humans' access tokens. The authorizer trusts it only in
// tests: the harness hands the authorizer this issuer's verify, where a deployment hands it Cognito's.
import { createSign, createVerify, generateKeyPairSync } from "node:crypto";
import { signInScope } from "@duva/client/sign-in";

export class TestTokenIssuer {
  #keys = newKeys();

  /** Signs with new keys from now on, as a new user pool does, so tokens issued before are refused. */
  replaceKeys() {
    this.#keys = newKeys();
  }

  /**
   * An access token for the human with the ID, issued to the app client, valid for `lifetime`
   * seconds, with the scopes, space-separated, as managed login gives those the client asked for.
   */
  issue(id: string, lifetime: number, client: string, scope = signInScope): string {
    const now = Math.floor(Date.now() / 1000);
    const header = encode({ alg: "RS256", typ: "JWT" });
    const payload = encode({ sub: id, client_id: client, token_use: "access", scope, iat: now, exp: now + lifetime });
    const signature = createSign("RSA-SHA256").update(`${header}.${payload}`).sign(this.#keys.privateKey, "base64url");
    return `${header}.${payload}.${signature}`;
  }

  /** The ID the token carries, the app client it was issued to, and its scopes. Throws if this issuer didn't sign it or it has expired. */
  verify = async (token: string): Promise<{ sub: string; clientId: string; scopes: string[] }> => {
    const [header, payload, signature] = token.split(".");
    if (header === undefined || payload === undefined || signature === undefined) throw new Error("Not a token");
    const signed = createVerify("RSA-SHA256").update(`${header}.${payload}`).verify(this.#keys.publicKey, signature, "base64url");
    if (!signed) throw new Error("Not signed by the test issuer");
    const { sub, client_id: clientId, scope, exp } = JSON.parse(Buffer.from(payload, "base64url").toString()) as { sub: string; client_id: string; scope: string; exp: number };
    if (exp * 1000 <= Date.now()) throw new Error("Expired");
    return { sub, clientId, scopes: scope.split(" ") };
  };
}

/** The scope Cognito gives every session it signs in through the API, as a sign-in link's, and needs to list or remove passkeys. */
export const userAdminScope = "aws.cognito.signin.user.admin";

const newKeys = () => generateKeyPairSync("rsa", { modulusLength: 2048 });
const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
