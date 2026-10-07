// The entry point of the mailbox agents' AgentCore Runtime. The CDK app bundles it, for Node.js 22 on arm64.
import { createRuntimeServer } from "./agent-runtime.ts";

createRuntimeServer().listen(8080, "0.0.0.0");
