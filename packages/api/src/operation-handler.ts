// What every operation's handler shares: its type, its JSON body, its refusals. The handlers'
// modules import these from here, below api.ts, which imports every handler (#160).
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import type { Deployment } from "./deployment.ts";
import type { Actor } from "./organization.ts";

/**
 * Handles one operation. `actor` is the actor the authorizer resolved the call to, and is
 * undefined only for operations that need no sign-in.
 */
export type OperationHandler = (
  event: APIGatewayProxyEventV2,
  deployment: Deployment,
  actor: Actor | undefined,
) => Promise<{ statusCode: number; body: unknown }>;

/** The call's JSON body, or undefined if it has none that parses. */
export function jsonBody(event: APIGatewayProxyEventV2): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body ?? "", "base64").toString() : (event.body ?? ""));
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** An answer that the call can't be done, with what to do about it. */
export const refusal = (statusCode: number, message: string) => ({ statusCode, body: { message } });
