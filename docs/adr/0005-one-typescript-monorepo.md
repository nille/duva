# One TypeScript monorepo

Backend, infrastructure (AWS CDK), web, CLI and the later mobile apps are all TypeScript in one repository, so four clients share one set of types and one generated API client. We rejected picking the best language per part (Go or Rust for backend and CLI, Swift and Kotlin for mobile) because one person plus agents can't keep that many codebases in step. A slow hot spot can still be rewritten in another language on its own.
