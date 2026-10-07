# One OpenAPI contract for every surface

The API is REST, described by one OpenAPI document. The TypeScript client and the CLI commands are generated from it, so web, CLI, mobile and outside agents can all do the same things, and an agent in any language gets a contract. GraphQL suits UIs but is clumsier for a CLI and for non-TypeScript agents. tRPC gives nothing to anyone outside TypeScript.

## Consequences

- Agents with a shell use the CLI. The CLI ships with an agent skill that teaches its commands. The skill is generated from the same command tree so it can't drift, bundled in the CLI binary and installed by a CLI command, and also published in the repo for `npx skills add`. Cloud agents call the API directly.
- There is no MCP server. If an agent without a shell (a chat app connector) needs access, a hosted MCP endpoint can be generated from the same document. ADR-0028 adds it, its tools generated from the mailbox agent's operations.
