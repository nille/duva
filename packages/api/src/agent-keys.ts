import { createHash, randomBytes } from "node:crypto";

/** How every agent key starts, so it is recognizable in a config, a log or a leak. */
export const agentKeyPrefix = "duva_agent_";

/** A new agent key: the prefix and 256 random bits. */
export const newAgentKey = () => agentKeyPrefix + randomBytes(32).toString("base64url");

/**
 * What Duva stores in place of the key. A key carries 256 random bits, so a fast hash is enough:
 * there is nothing to guess.
 */
export const agentKeyHash = (key: string) => createHash("sha256").update(key).digest("base64url");
