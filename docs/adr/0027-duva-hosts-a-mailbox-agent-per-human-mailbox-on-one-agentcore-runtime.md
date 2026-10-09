# Duva hosts a mailbox agent for each human's mailbox, on one AgentCore Runtime, with a token per run

Every human's personal mailbox has a mailbox agent that Duva runs, so a human gets help with their own mail without running an agent anywhere. It is an ordinary agent actor (ADR-0001), created with the mailbox, and the mailbox's owner is its sponsor (ADR-0015). It works only in that mailbox, through sponsor access, at the levels of ADR-0024, by default up to Send on the owner's behalf with every send waiting for their approval, and it owns no mailbox and is never an admin. Its actions go through Duva's API as itself, so they are attributed to it, carry the disclosure, and obey pause, send limits and alerts as any agent's do. Nicklas chose this on 2026-10-07 (#120, #122), with the research in `docs/research/agentcore.md` (#121).

One AgentCore Runtime per deployment serves every mailbox agent. It runs Duva's own Converse tool loop in Node.js, from code the build bundles, and its tools are operations of Duva's OpenAPI contract (ADR-0009), which it calls over HTTPS. A runtime is a deploy-time resource while mailboxes come at run time, and 1,000 per account would cap the mailboxes, so the agent a run is for comes from the run, not the runtime. Each run is a session that the conversation Lambda stops when the run ends, and a session left open ends after a minute idle, so an idle deployment pays nothing and a used one almost only the model's tokens (ADR-0006). No AgentCore Memory, Gateway or Identity: the conversation is kept in DynamoDB, and the tools are Duva's own.

A mailbox agent has no key. Duva keeps only an agent key's hash (ADR-0013), so it has no key to give AgentCore, and keeping one would copy a secret that never expires. Instead, the Lambda that starts a run mints a token for that run, `duva_run_` and 256 random bits, stored as a hash beside the agent and working until the run ends it or 20 minutes pass. The authorizer resolves it to the agent as it resolves a key. This adds a credential kind to ADR-0013.

The web app's Ask Coo posts each turn to the web app's own domain, under `/agent/`, where CloudFront signs the request to the conversation Lambda's function URL, which only the distribution may invoke, as download links do (docs/aws.md). API Gateway's HTTP APIs don't stream, so the turn is outside the API, as downloads are. The Lambda asks the API's `whoami` whose token the turn carries, gives the run its token, invokes the runtime through IAM and streams back, a line of JSON each, what the agent writes as it writes it and each call it makes as it makes it. The conversation's turns are read and cleared through the API.

The agent calls Claude in a model region the organization chooses, separate from the deployment's region, since Claude's Marketplace agreement fails when called from eu-north-1 (docs/aws.md). Admins choose the model, the inference profile, which decides where the mail it reads is processed (`eu`, `us` or `global`), the region it is called from, and a monthly spend cap for all mailbox agents together. By default an EU deployment calls Claude Sonnet 5.5 from eu-central-1 through the `eu` profile, which keeps mail in the EU, and a US one from us-west-2 through `us`. Each run is told what is left of the cap and stops past it, the month's spend is counted from each run's tokens at the model's price, and a run stopped at the cap is an alert to its sponsor, once a month.

## Considered options

- One runtime per mailbox. Rejected: a runtime is created by deploy and counts against 1,000 per account, while mailboxes come and go at run time.
- AgentCore's managed harness, or Gateway with Duva's contract as a target. Rejected for now: Gateway's OpenAPI targets can't take Duva's contract, which uses `oneOf` and `anyOf`, and send one credential for everyone, and the harness's tools reach Duva only through Gateway or remote MCP.
- A key per mailbox agent in AgentCore Identity or Secrets Manager. Rejected: a secret that never expires, copied, and $0.40 a month per agent in Secrets Manager.
- The Converse loop in a Lambda instead of AgentCore. Kept as the fallback: the loop knows nothing of where it runs, and would run there unchanged. AgentCore gives each session its own microVM and runs up to 8 hours, which label tasks (#123) will use.

## Consequences

- Every human with a mailbox sponsors at least one agent, so every human sees Approvals and Alerts.
- A mailbox agent goes only with its mailbox. Its sponsor pauses it or gives it no access to stop it. When its owner leaves, it goes with them as their agents do (ADR-0020), and a mailbox handed over gets a new one for its new owner.
- Deploy's setup gives the mailboxes from before this one their mailbox agents.
- In the five regions where SES receives mail and AgentCore doesn't run, the stack leaves the runtime out, and the conversation Lambda refuses every turn.
- What a mailbox agent reads of the mail goes to Bedrock in the regions the chosen profile names. Settings says where.

## Note

On 2026-10-08 Nicklas named the mailbox agent Coo (#130), for a little personality: a duva, Swedish for dove, which takes the wordmark's place in the web app's corner as its nest. Every mailbox agent is named Coo, so its mail's disclosure says "Sent by Coo for" its owner, and the owner can't rename it. Deploy's setup renames the mailbox agents from before. The web app draws Coo, at first a grey pigeon with the agent's blue neck ring, wherever the mailbox agent appears, and keeps the diamond for self-hosted agents. Coo bobs its head only while it works, and speaks up in its nest only with news, which each human can turn off. Later that day (#134) Nicklas chose a lighter drawing: a pigeon's portrait in one thin line, in the color of where it is, so the neck ring and feet went. On 2026-10-09 (#141) the nest went too: Coo's portrait heads the side column on its own.
