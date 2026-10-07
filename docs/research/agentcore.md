# Can Bedrock AgentCore host Duva's mailbox agents?

Research for #121, part of #120. Checked on 2026-10-07 against AWS documentation, the AWS Price List API and read-only Bedrock calls in account 925039213717. Nothing was created.

## Short answer

Yes. AgentCore Runtime bills nothing while no agent runs, so it keeps ADR-0006's near-zero idle cost. It runs in eu-north-1, with CloudFormation resources there and an L2 construct library in the `aws-cdk-lib` Duva already uses. Every Claude model reaches eu-north-1, but only through the `eu.` and `global.` inference profiles.

There are two blockers, and neither is AgentCore's:

- **Claude runs in the test account, called from outside eu-north-1.** The Marketplace agreement fails only in eu-north-1. From eu-central-1, eu-west-1 or eu-west-3 (`eu.` profile) and from us-west-2, Claude answers (docs/aws.md, 2026-10-07). The mailbox agent calls Bedrock in a configured model region.
- **Claude doesn't run inside eu-north-1.** The `eu.` profiles send requests to six EU regions, so mail leaves Stockholm but stays in the EU.

Recommendation: AgentCore as decided, with four changes. Use one shared Runtime per deployment, not one per mailbox. Run Duva's own Converse tool loop on it, and let Duva mint a short-lived token for each run. Let Duva serve MCP itself rather than through AgentCore Gateway. Skip AgentCore Memory.

## Pricing and idle cost

- **Runtime (microVMs) bills per second for CPU and memory a session uses, and nothing without a session.** In eu-north-1 it costs $0.0895 per vCPU-hour and $0.00945 per GB-hour, the same as us-east-1. CPU drops to zero while the agent waits on the model or a tool. Memory is billed from microVM start until the session ends, idle time included, with a 128 MB minimum. No fee is charged per agent, per runtime or per endpoint. _[AgentCore pricing](https://aws.amazon.com/bedrock/agentcore/pricing/); Price List API, `AmazonBedrockAgentCore`, regionCode eu-north-1._
- **Runtime v2 reclaims idle memory after 120 seconds, but it isn't in eu-north-1 yet.** At launch it ran in us-east-1, us-east-2, us-west-2, eu-west-1 and ap-northeast-1, at $0.1276 per vCPU-hour and $0.0169 per GB-hour. With v1, a session left open bills memory until its idle timeout, 15 minutes by default and at least 60 seconds. So Duva ends each session with `StopRuntimeSession` when the run is done. _[New AgentCore Runtime GA](https://aws.amazon.com/about-aws/whats-new/2026/09/new-agentcore-runtime-generally-available/); [lifecycle settings](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-lifecycle-settings.html)._
- **Charges that run with no session are small.** Direct code deployment stores the zip at S3 Standard rates, about $0.0002 a month for 10 MB. Gateway, if used, bills tool indexing at $0.0002 per tool a month, so Duva's 81 operations would cost $0.016. Memory bills long-term records every hour they're kept. Observability is CloudWatch, which only charges for data written. _Same sources._
- **Identity is free through Runtime or Gateway.** Elsewhere it costs $0.010 per 1,000 token or key requests. _[AgentCore pricing](https://aws.amazon.com/bedrock/agentcore/pricing/)._
- **Claude is billed per token through Marketplace, and the `eu.` profile costs 10% more than `global.`.** Per million tokens in eu-north-1, input and output: Claude Haiku 4.5 $1.10 and $5.50 (`global.` $1.00 and $5.00), Claude Sonnet 5.5 $2.20 and $11.00 (`global.` $2.00 and $10.00), Claude Opus 5.5 $4.40 and $22.00 (`global.` $4.00 and $20.00). _Price List API, `AmazonBedrockFoundationModels`, regionCode eu-north-1; [Claude Sonnet 5.5 model card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-sonnet-5-5.html)._

### Estimate for a small organization

Assumptions: 5 humans, each with a mailbox agent used 4 times a day, so 600 runs a month. A run takes 60 seconds, uses 3 CPU-seconds and 512 MB, and makes 5 model calls totalling 20,000 input and 1,500 output tokens.

| Item | Idle month | 600 runs |
| --- | --- | --- |
| Runtime, session stopped after each run | $0.00 | $0.09 |
| Runtime, sessions left to the 15-minute idle timeout | $0.00 | $0.80 |
| Code artifact in S3 | $0.0002 | $0.0002 |
| Identity, Memory, Gateway (not used) | $0.00 | $0.00 |
| Claude Haiku 4.5, `eu.` | $0.00 | $18 |
| Claude Sonnet 5.5, `eu.` | $0.00 | $36 |

So an idle month costs well under a cent, as ADR-0006 asks. A used month costs almost only tokens, and prompt caching would cut the input cost.

## Availability

- **eu-north-1 has everything Duva would use:** Runtime microVMs, the managed harness, Memory, Gateway, Identity, Policy and Observability. It lacks Runtime Instances, which Duva doesn't need. _[Supported AWS Regions](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/agentcore-regions.html)._
- **CloudFormation has `AWS::BedrockAgentCore::Runtime`, `RuntimeEndpoint`, `Gateway`, `GatewayTarget`, `Memory`, `WorkloadIdentity` and `Harness` in eu-north-1.** _AWS regional availability, cfn, 2026-10-07._
- **Of the 22 regions where Duva can deploy (where SES receives mail), 17 have Runtime, Gateway and Identity.** Runtime is missing in af-south-1, ap-northeast-3, ap-southeast-3, il-central-1 and me-south-1. The harness and Memory are also missing in us-west-1 and eu-south-1. So deploy has to leave out mailbox agents in those five regions, or refuse them. _[Supported AWS Regions](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/agentcore-regions.html); `packages/cli/src/regions.ts`._

### Claude on Bedrock in eu-north-1

ListFoundationModels lists 14 Anthropic models there, each supporting `INFERENCE_PROFILE` only. None runs on demand in the region. Each is reached through an `eu.` profile, which sends requests to eu-central-1, eu-north-1, eu-south-1, eu-south-2, eu-west-1 and eu-west-3, or a `global.` profile, which sends them anywhere. Active models:

- Claude Opus 5.5, Opus 5, Opus 4.8, Opus 4.7, Opus 4.6, Opus 4.5
- Claude Sonnet 5.5, Sonnet 5, Sonnet 4.6, Sonnet 4.5
- Claude Haiku 4.5
- Claude Fable 5.1 and Fable 5 (`global.` only)

Claude Sonnet 4 is Legacy. _ListFoundationModels and ListInferenceProfiles in eu-north-1, 2026-10-07; [Claude Sonnet 5.5 model card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-sonnet-5-5.html)._

All of them need a Marketplace subscription, which Bedrock creates the first time a model is called. That's the step that fails in 925039213717. Bedrock's OpenAI, Mistral, Meta, DeepSeek, Qwen and Amazon models aren't sold through Marketplace. _[re:Post, Marketplace permissions errors](https://repost.aws/knowledge-center/bedrock-resolve-marketplace-permission); [Request access to models](https://docs.aws.amazon.com/bedrock/latest/userguide/model-access.html)._

## How the agent calls Duva's API as its agent actor

- **Runtime's inbound auth is IAM SigV4 or a JWT, one per runtime version.** IAM suits calls from Duva's Lambdas, and a JWT suits a browser holding a Cognito token. _[Runtime security best practices](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-security-best-practices.html)._
- **Outbound, the agent can fetch an API key or OAuth token from AgentCore Identity's token vault.** But an account has at most 50 API-key credential providers per region by default. A Gateway OpenAPI target puts a single provider's key on every call. _[AgentCore quotas](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/bedrock-agentcore-limits.html); [OpenAPI schema targets](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/gateway-schema-openapi.html)._
- **Neither fits ADR-0013 as it is.** Duva keeps only the hash of an agent key, so it can't give AgentCore the key later. Keeping a key per mailbox agent in Identity or Secrets Manager would copy a secret that never expires. Secrets Manager would also cost $0.40 per agent each month, idle or not.
- **So Duva should mint a short-lived token for each run.** The Lambda that starts a run issues a token for that mailbox agent and that run, and passes it in the payload. The authorizer resolves it to the agent, as it resolves a key. The agent calls Duva's API over HTTPS with it, as any agent does. Every action is then attributed to the mailbox agent, and the token ends with the run. This adds a credential kind to ADR-0013 and needs a line in an ADR.
- **The tools come from Duva's OpenAPI.** The agent code can build its tool list from `packages/openapi/openapi.yaml` and call the generated client. A Gateway OpenAPI target can't take Duva's contract as it is: it doesn't support `oneOf`, `anyOf` or `allOf`, which the contract uses 53 times, nor security schemes in the spec. _[OpenAPI schema targets](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/gateway-schema-openapi.html)._

## How Duva starts a run

- **A label task, from an event.** The Lambda that sees the label calls `InvokeAgentRuntime` with SigV4 and a new session ID for each task. The agent answers at once and keeps working in the background, reporting `HealthyBusy` on `/ping`, for up to 8 hours. It writes the task's state and note through Duva's API. A synchronous request may last 15 minutes. _[Async and long-running agents](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-long-run.html); [AgentCore quotas](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/bedrock-agentcore-limits.html)._
- **A web chat turn, streamed to the browser.** A runtime takes IAM or JWT, not both, and label tasks need IAM. So the browser should send a turn to a Duva Lambda function URL with `RESPONSE_STREAM` behind CloudFront, as the download Lambda already is. That Lambda checks the human's Cognito token, invokes the runtime with the conversation's session ID, and passes the stream on. A stream may last 60 minutes. Lambda bills its whole duration while it waits. _[AgentCore quotas](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/bedrock-agentcore-limits.html); [Lambda response streaming](https://docs.aws.amazon.com/lambda/latest/dg/configuration-response-streaming.html)._
- **An MCP request.** The MCP endpoint's "ask your agent" tool invokes the runtime the same way and returns the answer, within the 15-minute synchronous limit. "Give it a task" starts a background run, as a label task does.
- **Throttles:** 25 new sessions a second, 1,000 data-plane calls a second, and 2,500 active sessions per account in eu-north-1. All are adjustable, and all are far above a family's or a small company's use. _[AgentCore quotas](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/bedrock-agentcore-limits.html)._

## Can AgentCore Gateway front Duva's MCP endpoint with Cognito OAuth?

- **Yes, technically.** A Gateway with a `CUSTOM_JWT` authorizer takes Cognito's discovery URL and allowed audiences, clients and scopes. It answers a request without a valid token with a 401 whose `WWW-Authenticate` names its `/.well-known/oauth-protected-resource` document, as MCP clients expect. It supports MCP versions up to 2026-07-28. _[Gateway inbound authorization](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/gateway-inbound-auth.html); [Use an AgentCore gateway](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/gateway-using.html)._
- **Cognito can register MCP clients itself.** Dynamic client registration comes with the Essentials plan, which Duva's pool already has. Open registration needs no WAF as long as registered clients can't use the client credentials grant. Registered clients count toward the pool's app client limit. _[Cognito dynamic client registration](https://docs.aws.amazon.com/help-panel/cognito/latest/console/hp-dynamic-client-registration.html); `packages/infra/src/stack.ts`._
- **But Gateway gives Duva little.** Its OpenAPI target can't take Duva's contract (above), and it sends one credential, not the human's. Getting each human's identity through means a Lambda target or an interceptor Lambda that puts the caller's token back on the request. Duva would then still have to write the code behind the tools. _[Gateway header propagation](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/gateway-headers.html)._
- **So Duva should serve MCP itself,** from a Lambda over Streamable HTTP. MCP 2026-07-28 is stateless, which suits Lambda. The Lambda serves its own protected-resource document pointing at the Cognito pool, and Duva's one authorizer resolves the human, so each human sees only their own mailboxes and agent. Its tools call the same API, keeping ADR-0009's single contract. It costs nothing idle. _[Use an AgentCore gateway](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/gateway-using.html)._

## Limits

- Runtime: 8 hours per session and 15 minutes per synchronous request. 2 vCPU and 8 GB per session, and 100 MB payloads. 1,000 agents per account. _[AgentCore quotas](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/bedrock-agentcore-limits.html)._
- Direct code deployment takes Node.js or Python, as a zip of at most 250 MB, 750 MB unzipped. It runs on arm64 only, so native modules must be built for arm64. TypeScript must be compiled first. _[Direct code deployment for Node.js](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-get-started-code-deploy-node.html)._
- Gateway: 100 targets per gateway, 1,000 tools per target, 15 minutes per call, and 200 tool calls a second. _[AgentCore quotas](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/bedrock-agentcore-limits.html)._
- One runtime per mailbox would make mailboxes count against the 1,000-agent quota. A runtime is also a deploy-time resource, while mailboxes appear at runtime. So the mailbox agent should be a Duva actor that one shared runtime serves, with each run's session and token deciding which agent it is.

## CDK

`aws-cdk-lib/aws-bedrockagentcore` is a stable module in `aws-cdk-lib`, and Duva's 2.272.0 includes it. It has L2 constructs for Runtime, with direct code deployment from an asset, IAM, Cognito or JWT auth, and lifecycle settings, and for RuntimeEndpoint, Gateway, its targets, interceptors, Memory and the Policy engine. The deploy role needs `iam:CreateServiceLinkedRole` for AgentCore's service-linked roles. _[AgentCore construct library](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_bedrockagentcore-readme.html)._

## The alternative: a Converse tool loop in Lambda

The same agent loop could run in a Lambda that calls Bedrock Converse.

- **Idle cost:** none, like AgentCore.
- **Per-run cost:** Lambda bills the whole run, including model waits. That's about $0.001 for 60 seconds at 1 GB, against about $0.00015 on Runtime with the session stopped. At this scale both are negligible.
- **Limits:** 15 minutes per invocation. Durable functions in eu-north-1 extend that to a year, with no compute billed while suspended. _[Lambda durable functions in 14 more regions](https://aws.amazon.com/about-aws/whats-new/2025/12/lambda-durable-functions-14-additional-regions/); [Lambda FAQs](https://aws.amazon.com/lambda/faqs/)._
- **Gains:** no new service, no arm64 zip, and Duva's existing streaming function URL. It also reaches all 22 of Duva's regions.
- **Losses:** no microVM per session, no 8-hour background runs without durable functions, and no AgentCore observability.

Because the loop is Duva's own code either way, it can be one module behind a seam. It would be tested in `startDuva()` with recorded model answers, and hosted on Runtime where AgentCore exists or in Lambda where it doesn't.

The managed harness, also in eu-north-1 at no extra charge, would replace that loop with configuration. Its tools are Gateway, remote MCP servers and inline functions. Duva would then depend on how its `remote_mcp` tool authenticates, which this research didn't settle. _[AgentCore harness GA](https://aws.amazon.com/blogs/machine-learning/amazon-bedrock-agentcore-harness-is-now-generally-available-go-from-idea-to-production-grade-agent-in-minutes/)._

## Recommendation

Keep AgentCore as decided. It meets ADR-0006: an idle month costs under a cent, and use costs almost only tokens. Build it this way:

1. One AgentCore Runtime per deployment, platform v1 in eu-north-1. It uses IAM auth, direct Node.js code deployment, and an idle timeout of 60 seconds, the minimum. Each run is a session, ended with `StopRuntimeSession`.
2. Duva's own Converse tool loop on it, kept host-agnostic, with tools generated from the OpenAPI contract and calling Duva's API.
3. A short-lived per-run token for the mailbox agent, minted by Duva. Neither Identity nor Secrets Manager holds a key.
4. Duva's own MCP endpoint in Lambda, with Cognito OAuth and dynamic client registration. No Gateway.
5. Conversations and task notes kept in DynamoDB. No AgentCore Memory.
6. Claude through the `eu.` profiles, Sonnet 5.5 by default or Haiku 4.5 for a lower spend cap. The admin's model choice is a profile ID.

Before #120's real run, AWS Support has to fix the Marketplace terminations in 925039213717, or that run uses a model that isn't sold through Marketplace. Deploy must also decide what happens in the five SES regions without AgentCore: leave out mailbox agents there, or fall back to the Lambda loop.
