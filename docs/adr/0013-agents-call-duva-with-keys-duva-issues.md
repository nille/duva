# Agents call Duva with keys Duva issues

An agent calls the API with a key Duva gives it when its sponsor creates it, sent as a bearer token like a human's access token, and the one Lambda authorizer resolves either to exactly one actor. A key is `duva_agent_` and 256 random bits. Duva shows it once and stores only its SHA-256 hash, which points at the agent, so the authorizer finds the agent in one consistent read and refuses a rotated key at once. Making agents Cognito users or app clients would put them in the human sign-in flow (ADR-0010) or give them tokens that expire and need renewing, which a long-running agent shouldn't have to handle. A slow password hash isn't needed, since nothing about a random 256-bit key can be guessed.

## Consequences

- A key never expires on its own. Only its sponsor rotating it ends it.
- Losing the key means its sponsor has to rotate it, since Duva can't show it again.
