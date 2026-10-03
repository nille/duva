import type { OperationHandler } from "./api.ts";

export const whoami: OperationHandler = async (_event, _deployment, actor) => ({ statusCode: 200, body: actor });
