import { operations } from "./operations.gen.ts";

export { operations };
// Kept here, beside the contract that refuses them, so the web app knows not to offer them.
export { isPublicMailProvider } from "./mail-providers.ts";
export { clockValue, fromClockValue, presetAt, reminderPresets, soonestReminder } from "./reminder-presets.ts";
import type { components } from "./schema.gen.ts";
export type { components, paths } from "./schema.gen.ts";

/**
 * An operation in the OpenAPI document, with what the API, the CDK app and the CLI need to know
 * about it. Its routeKey is the one API Gateway gives the operation's route.
 */
export type Operation = (typeof operations)[number];

export type OperationId = Operation["operationId"];

/**
 * What the conversation Lambda streams back for a turn of Ask Coo, a line of JSON each: the
 * human's turn as kept, the agent's text as it comes, each action as it is done, each handover to the harder model, and the agent's turn
 * as kept once it ends. It answers on the web app's domain, outside the API, as download links do,
 * since API Gateway's HTTP APIs don't stream (ADR-0027). A refusal is a JSON body with its message.
 */
export type ConversationEvent =
  | { type: "turn"; turn: components["schemas"]["ConversationTurn"] }
  | { type: "text"; text: string }
  | { type: "action"; action: components["schemas"]["AgentAction"] }
  | { type: "handedOver"; handover: components["schemas"]["Handover"] }
  | { type: "done"; turn: components["schemas"]["ConversationTurn"] };
