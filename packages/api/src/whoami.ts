import type { OperationHandler } from "./operation-handler.ts";

export const whoami: OperationHandler = async (_event, _deployment, actor) => ({ statusCode: 200, body: actor });
